package services

import (
	"database/sql"
	"errors"
	"time"

	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

type RecurringExpenseService struct {
	db *gorm.DB
}

func NewRecurringExpenseService(db *gorm.DB) *RecurringExpenseService {
	return &RecurringExpenseService{db: db}
}

func (s *RecurringExpenseService) List(workspaceID uint) ([]models.RecurringExpense, error) {
	var expenses []models.RecurringExpense
	err := s.db.Preload("Category").Preload("Category.Area").
		Where("workspace_id = ?", workspaceID).
		Order("due_day ASC").
		Find(&expenses).Error
	return expenses, err
}

func (s *RecurringExpenseService) FindByID(id, workspaceID uint) (*models.RecurringExpense, error) {
	var expense models.RecurringExpense
	err := s.db.Preload("Category").Preload("Category.Area").
		Where("id = ? AND workspace_id = ?", id, workspaceID).
		First(&expense).Error
	return &expense, err
}

func (s *RecurringExpenseService) Create(expense *models.RecurringExpense) error {
	if expense.DueDay < 1 || expense.DueDay > 31 {
		return errors.New("due_day must be between 1 and 31")
	}
	if expense.Amount <= 0 {
		return errors.New("amount must be positive")
	}
	return s.db.Create(expense).Error
}

func (s *RecurringExpenseService) Update(expense *models.RecurringExpense) error {
	if expense.DueDay < 1 || expense.DueDay > 31 {
		return errors.New("due_day must be between 1 and 31")
	}
	if expense.Amount <= 0 {
		return errors.New("amount must be positive")
	}
	return s.db.Save(expense).Error
}

func (s *RecurringExpenseService) Delete(id, workspaceID uint) error {
	return s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).
		Delete(&models.RecurringExpense{}).Error
}

type RecurringExpenseSummary struct {
	TotalMonthly        float64 `json:"total_monthly"`
	PaidAmount          float64 `json:"paid_amount"`
	PendingAmount       float64 `json:"pending_amount"`
	PreviousMonthTotal  float64 `json:"previous_month_total"`
	ChangePercentage    float64 `json:"change_percentage"`
}

func (s *RecurringExpenseService) GetSummary(workspaceID uint, month time.Time) (*RecurringExpenseSummary, error) {
	expenses, err := s.List(workspaceID)
	if err != nil {
		return nil, err
	}

	var totalMonthly, paidAmount, pendingAmount float64
	for _, exp := range expenses {
		totalMonthly += exp.Amount
		if exp.IsPaidThisMonth() {
			paidAmount += exp.Amount
		} else {
			pendingAmount += exp.Amount
		}
	}

	// Get previous month total (sum of amounts of expenses that existed then)
	// For simplicity, we use current total as previous since expenses don't change often
	prevMonth := month.AddDate(0, -1, 0)
	var prevTotal float64
	err = s.db.Model(&models.RecurringExpense{}).
		Where("workspace_id = ? AND created_at <= ?", workspaceID, prevMonth.AddDate(0, 1, 0)).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&prevTotal).Error
	if err != nil {
		return nil, err
	}

	var changePercentage float64
	if prevTotal > 0 {
		changePercentage = ((totalMonthly - prevTotal) / prevTotal) * 100
	}

	return &RecurringExpenseSummary{
		TotalMonthly:       totalMonthly,
		PaidAmount:         paidAmount,
		PendingAmount:      pendingAmount,
		PreviousMonthTotal: prevTotal,
		ChangePercentage:   changePercentage,
	}, nil
}

func (s *RecurringExpenseService) MarkPaid(id, workspaceID uint) (*models.RecurringExpense, *models.Transaction, error) {
	expense, err := s.FindByID(id, workspaceID)
	if err != nil {
		return nil, nil, err
	}

	// If already paid this month, return idempotently
	if expense.IsPaidThisMonth() {
		return expense, nil, nil
	}

	now := time.Now()

	// Create transaction
	categoryName := ""
	if expense.Category != nil {
		categoryName = expense.Category.Name
	}

	transaction := &models.Transaction{
		WorkspaceID: workspaceID,
		Date:        now,
		Description: sql.NullString{String: expense.Name, Valid: true},
		Amount:      sql.NullFloat64{Float64: expense.Amount, Valid: true},
		Type:        sql.NullString{String: "debit", Valid: true},
		Category:    sql.NullString{String: categoryName, Valid: categoryName != ""},
		Owner:       sql.NullString{String: expense.Owner, Valid: expense.Owner != ""},
	}

	// Use transaction to ensure atomicity
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(transaction).Error; err != nil {
			return err
		}
		expense.LastPaidDate = &now
		return tx.Save(expense).Error
	})

	if err != nil {
		return nil, nil, err
	}

	return expense, transaction, nil
}
