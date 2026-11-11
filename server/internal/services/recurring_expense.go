package services

import (
	"database/sql"
	"errors"
	"time"

	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

func firstNonEmpty(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

type RecurringExpenseService struct {
	db *gorm.DB
}

func NewRecurringExpenseService(db *gorm.DB) *RecurringExpenseService {
	return &RecurringExpenseService{db: db}
}

func (s *RecurringExpenseService) List(workspaceID uint, month string) ([]models.RecurringExpense, error) {
	var expenses []models.RecurringExpense
	if err := s.db.Preload("Category").Preload("Category.Area").Where("workspace_id = ?", workspaceID).Order("due_day ASC").Find(&expenses).Error; err != nil {
		return nil, err
	}
	var payments []models.RecurringExpensePayment
	if err := s.db.Where("month = ? AND recurring_expense_id IN (?)", month, s.db.Model(&models.RecurringExpense{}).Select("id").Where("workspace_id = ?", workspaceID)).Find(&payments).Error; err != nil {
		return nil, err
	}
	paid := make(map[uint]time.Time, len(payments))
	for _, p := range payments {
		paid[p.RecurringExpenseID] = p.PaidAt
	}
	for i := range expenses {
		expenses[i].PaidForMonth = month
		if date, ok := paid[expenses[i].ID]; ok {
			expenses[i].LastPaidDate = &date
		} else {
			expenses[i].LastPaidDate = nil
		}
	}
	return expenses, nil
}

func (s *RecurringExpenseService) FindByID(id, workspaceID uint) (*models.RecurringExpense, error) {
	var expense models.RecurringExpense
	err := s.db.Preload("Category").Preload("Category.Area").
		Where("id = ? AND workspace_id = ?", id, workspaceID).
		First(&expense).Error
	return &expense, err
}

// ValidateRecurringExpense checks the invariants shared by every write path.
func ValidateRecurringExpense(expense *models.RecurringExpense) error {
	if expense.DueDay < 1 || expense.DueDay > 31 {
		return errors.New("due_day must be between 1 and 31")
	}
	if expense.Amount <= 0 {
		return errors.New("amount must be positive")
	}
	return nil
}

func (s *RecurringExpenseService) Create(expense *models.RecurringExpense) error {
	if err := ValidateRecurringExpense(expense); err != nil {
		return err
	}
	return s.db.Create(expense).Error
}

func (s *RecurringExpenseService) Update(expense *models.RecurringExpense) error {
	if err := ValidateRecurringExpense(expense); err != nil {
		return err
	}
	return s.db.Save(expense).Error
}

func (s *RecurringExpenseService) Delete(id, workspaceID uint) error {
	return deleteWithTombstone(s.db, &models.RecurringExpense{}, models.SyncEntityRecurringExpense, workspaceID, "id = ?", id, nil)
}

type RecurringExpenseSummary struct {
	TotalMonthly       float64 `json:"total_monthly"`
	PaidAmount         float64 `json:"paid_amount"`
	PendingAmount      float64 `json:"pending_amount"`
	PreviousMonthTotal float64 `json:"previous_month_total"`
	ChangePercentage   float64 `json:"change_percentage"`
}

func (s *RecurringExpenseService) GetSummary(workspaceID uint, month time.Time) (*RecurringExpenseSummary, error) {
	expenses, err := s.List(workspaceID, month.Format("2006-01"))
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

func (s *RecurringExpenseService) MarkPaid(id, workspaceID uint, month string, userID uint) (*models.RecurringExpense, *models.Transaction, error) {
	return s.MarkPaidAs(id, workspaceID, month, userID, "")
}

// MarkPaidAs is MarkPaid with a caller-chosen client_id for the generated transaction, so an
// offline client that already shows that transaction locally ends up with the same row.
func (s *RecurringExpenseService) MarkPaidAs(id, workspaceID uint, month string, userID uint, transactionClientID string) (*models.RecurringExpense, *models.Transaction, error) {
	expense, err := s.FindByID(id, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	expense.PaidForMonth = month

	monthDate, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, nil, errors.New("month must be YYYY-MM")
	}
	var existing models.RecurringExpensePayment
	if s.db.Where("recurring_expense_id = ? AND month = ?", id, month).First(&existing).Error == nil {
		return expense, nil, nil
	}
	dueDay := expense.DueDay
	lastDay := time.Date(monthDate.Year(), monthDate.Month()+1, 0, 0, 0, 0, 0, monthDate.Location()).Day()
	if dueDay > lastDay {
		dueDay = lastDay
	}
	now := time.Date(monthDate.Year(), monthDate.Month(), dueDay, 12, 0, 0, 0, monthDate.Location())

	// Create transaction
	categoryName := ""
	if expense.Category != nil {
		categoryName = expense.Category.Name
	}

	var user models.User
	_ = s.db.Select("name").First(&user, userID).Error
	owner := firstNonEmpty(expense.Owner, user.Name)
	transaction := &models.Transaction{
		WorkspaceID: workspaceID,
		ClientID:    transactionClientID,
		Date:        now,
		Description: sql.NullString{String: expense.Name, Valid: true},
		Amount:      sql.NullFloat64{Float64: expense.Amount, Valid: true},
		Type:        sql.NullString{String: "debit", Valid: true},
		Category:    sql.NullString{String: categoryName, Valid: categoryName != ""},
		Owner:       sql.NullString{String: owner, Valid: owner != ""},
	}

	// Use transaction to ensure atomicity
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(transaction).Error; err != nil {
			return err
		}
		expense.LastPaidDate = &now
		if err := tx.Save(expense).Error; err != nil {
			return err
		}
		return tx.Create(&models.RecurringExpensePayment{RecurringExpenseID: id, Month: month, TransactionID: transaction.ID, PaidAt: now}).Error
	})

	if err != nil {
		return nil, nil, err
	}

	return expense, transaction, nil
}
