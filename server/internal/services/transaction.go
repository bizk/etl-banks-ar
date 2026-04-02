package services

import (
	"database/sql"
	"sort"
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
	Categories  []string
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
	if len(filter.Categories) > 0 {
		query = query.Where("category IN ?", filter.Categories)
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

type MonthlyCategoryAmount struct {
	Month  string  `json:"month"`
	Amount float64 `json:"amount"`
}

type YearlyCategorySummary struct {
	Category string                  `json:"category"`
	Amount   float64                 `json:"amount"`
	Monthly  []MonthlyCategoryAmount `json:"monthly"`
}

type YearlySummary struct {
	Year          string                  `json:"year"`
	TotalSpending float64                 `json:"total_spending"`
	TotalIncome   float64                 `json:"total_income"`
	Net           float64                 `json:"net"`
	ByCategory    []YearlyCategorySummary `json:"by_category"`
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

func (s *TransactionService) GetYearlySummary(workspaceID uint, year string) (*YearlySummary, error) {
	startDate, err := time.Parse("2006", year)
	if err != nil {
		return nil, err
	}
	endDate := startDate.AddDate(1, 0, 0)

	var debitTotal, creditTotal sql.NullFloat64

	s.db.Model(&models.Transaction{}).
		Where("workspace_id = ? AND date >= ? AND date < ? AND type = ?", workspaceID, startDate, endDate, "debit").
		Select("COALESCE(SUM(amount), 0)").
		Scan(&debitTotal)

	s.db.Model(&models.Transaction{}).
		Where("workspace_id = ? AND date >= ? AND date < ? AND type = ?", workspaceID, startDate, endDate, "credit").
		Select("COALESCE(SUM(amount), 0)").
		Scan(&creditTotal)

	var categoryRows []struct {
		Category string
		Month    string
		Amount   float64
	}

	s.db.Model(&models.Transaction{}).
		Select("category, DATE_FORMAT(MIN(date), '%Y-%m-01') as month, COALESCE(SUM(amount), 0) as amount").
		Where("workspace_id = ? AND date >= ? AND date < ? AND type = ?", workspaceID, startDate, endDate, "debit").
		Group("category, YEAR(date), MONTH(date)").
		Order("amount DESC, month ASC").
		Scan(&categoryRows)

	monthlyTemplate := make([]MonthlyCategoryAmount, 12)
	for i := range monthlyTemplate {
		monthlyTemplate[i] = MonthlyCategoryAmount{
			Month:  startDate.AddDate(0, i, 0).Format("2006-01"),
			Amount: 0,
		}
	}

	categoriesByName := map[string]*YearlyCategorySummary{}
	for _, row := range categoryRows {
		name := row.Category
		if name == "" {
			name = "Uncategorized"
		}

		summary, exists := categoriesByName[name]
		if !exists {
			monthly := make([]MonthlyCategoryAmount, len(monthlyTemplate))
			copy(monthly, monthlyTemplate)
			summary = &YearlyCategorySummary{
				Category: name,
				Monthly:  monthly,
			}
			categoriesByName[name] = summary
		}

		rowMonth, err := time.Parse("2006-01-02", row.Month)
		if err != nil {
			continue
		}

		monthIndex := int(rowMonth.Month()) - 1
		if monthIndex >= 0 && monthIndex < len(summary.Monthly) {
			summary.Monthly[monthIndex].Amount = row.Amount
		}
		summary.Amount += row.Amount
	}

	categories := make([]YearlyCategorySummary, 0, len(categoriesByName))
	for _, category := range categoriesByName {
		categories = append(categories, *category)
	}

	sort.Slice(categories, func(i, j int) bool {
		return categories[i].Amount > categories[j].Amount
	})

	return &YearlySummary{
		Year:          year,
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
