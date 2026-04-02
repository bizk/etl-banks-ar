package services

import (
	"database/sql"
	"time"

	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

type TransactionService struct {
	db *gorm.DB
}

func NewTransactionService(db *gorm.DB) *TransactionService {
	return &TransactionService{db: db}
}

type TransactionFilter struct {
	WorkspaceID uint
	Month       string // YYYY-MM format
	Category    string
	Type        string
	Page        int
	PerPage     int
	SortBy      string
	SortOrder   string
}

type PaginatedTransactions struct {
	Transactions []models.Transaction `json:"transactions"`
	Page         int                  `json:"page"`
	PerPage      int                  `json:"per_page"`
	Total        int64                `json:"total"`
	TotalPages   int                  `json:"total_pages"`
}

type TransactionSummary struct {
	TotalAmount float64 `json:"total_amount"`
	DebitTotal  float64 `json:"debit_total"`
	CreditTotal float64 `json:"credit_total"`
}

func (s *TransactionService) List(filter TransactionFilter) (*PaginatedTransactions, *TransactionSummary, error) {
	query := s.db.Model(&models.Transaction{}).Where("workspace_id = ?", filter.WorkspaceID)

	// Filter by month
	if filter.Month != "" {
		startDate, err := time.Parse("2006-01", filter.Month)
		if err == nil {
			endDate := startDate.AddDate(0, 1, 0)
			query = query.Where("date >= ? AND date < ?", startDate, endDate)
		}
	}

	// Filter by category
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}

	// Filter by type
	if filter.Type != "" {
		query = query.Where("type = ?", filter.Type)
	}

	// Count total
	var total int64
	query.Count(&total)

	// Calculate summary
	var summary TransactionSummary
	var debitSum, creditSum sql.NullFloat64

	s.db.Model(&models.Transaction{}).
		Where("workspace_id = ?", filter.WorkspaceID).
		Where("date >= ? AND date < ?", filter.Month+"-01", filter.Month+"-01").
		Where("type = ?", "debit").
		Select("COALESCE(SUM(amount), 0)").
		Scan(&debitSum)

	s.db.Model(&models.Transaction{}).
		Where("workspace_id = ?", filter.WorkspaceID).
		Where("date >= ? AND date < ?", filter.Month+"-01", filter.Month+"-01").
		Where("type = ?", "credit").
		Select("COALESCE(SUM(amount), 0)").
		Scan(&creditSum)

	// Recalculate with proper date range for summary
	if filter.Month != "" {
		startDate, _ := time.Parse("2006-01", filter.Month)
		endDate := startDate.AddDate(0, 1, 0)

		s.db.Model(&models.Transaction{}).
			Where("workspace_id = ? AND date >= ? AND date < ? AND type = ?", filter.WorkspaceID, startDate, endDate, "debit").
			Select("COALESCE(SUM(amount), 0)").
			Scan(&debitSum)

		s.db.Model(&models.Transaction{}).
			Where("workspace_id = ? AND date >= ? AND date < ? AND type = ?", filter.WorkspaceID, startDate, endDate, "credit").
			Select("COALESCE(SUM(amount), 0)").
			Scan(&creditSum)
	}

	summary.DebitTotal = debitSum.Float64
	summary.CreditTotal = creditSum.Float64
	summary.TotalAmount = debitSum.Float64 + creditSum.Float64

	// Sorting
	sortBy := "date"
	if filter.SortBy != "" {
		sortBy = filter.SortBy
	}
	sortOrder := "DESC"
	if filter.SortOrder == "asc" {
		sortOrder = "ASC"
	}
	query = query.Order(sortBy + " " + sortOrder)

	// Pagination
	page := filter.Page
	if page < 1 {
		page = 1
	}
	perPage := filter.PerPage
	if perPage < 1 {
		perPage = 20
	}

	offset := (page - 1) * perPage
	var transactions []models.Transaction
	query.Offset(offset).Limit(perPage).Find(&transactions)

	totalPages := int(total) / perPage
	if int(total)%perPage > 0 {
		totalPages++
	}

	return &PaginatedTransactions{
		Transactions: transactions,
		Page:         page,
		PerPage:      perPage,
		Total:        total,
		TotalPages:   totalPages,
	}, &summary, nil
}

func (s *TransactionService) Create(t *models.Transaction) error {
	return s.db.Create(t).Error
}

func (s *TransactionService) FindByID(id, workspaceID uint) (*models.Transaction, error) {
	var transaction models.Transaction
	err := s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).First(&transaction).Error
	return &transaction, err
}

func (s *TransactionService) Update(t *models.Transaction) error {
	return s.db.Save(t).Error
}

func (s *TransactionService) Delete(id, workspaceID uint) error {
	return s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).Delete(&models.Transaction{}).Error
}

type CategorySummary struct {
	Category   string  `json:"category"`
	Amount     float64 `json:"amount"`
	Count      int     `json:"count"`
	Percentage float64 `json:"percentage"`
}

type MonthlySummary struct {
	Month         string            `json:"month"`
	TotalSpending float64           `json:"total_spending"`
	TotalIncome   float64           `json:"total_income"`
	Net           float64           `json:"net"`
	ByCategory    []CategorySummary `json:"by_category"`
}

func (s *TransactionService) GetMonthlySummary(workspaceID uint, month string) (*MonthlySummary, error) {
	startDate, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, err
	}
	endDate := startDate.AddDate(0, 1, 0)

	var debitTotal, creditTotal sql.NullFloat64

	s.db.Model(&models.Transaction{}).
		Where("workspace_id = ? AND date >= ? AND date < ? AND type = ?", workspaceID, startDate, endDate, "debit").
		Select("COALESCE(SUM(amount), 0)").
		Scan(&debitTotal)

	s.db.Model(&models.Transaction{}).
		Where("workspace_id = ? AND date >= ? AND date < ? AND type = ?", workspaceID, startDate, endDate, "credit").
		Select("COALESCE(SUM(amount), 0)").
		Scan(&creditTotal)

	// Get by category
	var categoryResults []struct {
		Category string
		Amount   float64
		Count    int
	}

	s.db.Model(&models.Transaction{}).
		Select("category, COALESCE(SUM(amount), 0) as amount, COUNT(*) as count").
		Where("workspace_id = ? AND date >= ? AND date < ?", workspaceID, startDate, endDate).
		Group("category").
		Scan(&categoryResults)

	totalAmount := debitTotal.Float64 + creditTotal.Float64
	var categories []CategorySummary
	for _, r := range categoryResults {
		pct := 0.0
		if totalAmount > 0 {
			pct = (r.Amount / totalAmount) * 100
		}
		categories = append(categories, CategorySummary{
			Category:   r.Category,
			Amount:     r.Amount,
			Count:      r.Count,
			Percentage: pct,
		})
	}

	return &MonthlySummary{
		Month:         month,
		TotalSpending: debitTotal.Float64,
		TotalIncome:   creditTotal.Float64,
		Net:           creditTotal.Float64 - debitTotal.Float64,
		ByCategory:    categories,
	}, nil
}

func (s *TransactionService) GetCategories(workspaceID uint) ([]string, error) {
	var categories []string
	err := s.db.Model(&models.Transaction{}).
		Where("workspace_id = ?", workspaceID).
		Distinct("category").
		Pluck("category", &categories).Error
	return categories, err
}
