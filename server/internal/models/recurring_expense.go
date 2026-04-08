package models

import "time"

type RecurringExpense struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	WorkspaceID  uint       `gorm:"not null;index" json:"workspace_id"`
	Name         string     `gorm:"size:255;not null" json:"name"`
	Amount       float64    `gorm:"not null" json:"amount"`
	CategoryID   *uint      `json:"category_id"`
	Category     *Category  `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
	Owner        string     `gorm:"size:255" json:"owner"`
	DueDay       int        `gorm:"not null" json:"due_day"`
	LastPaidDate *time.Time `json:"last_paid_date"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// IsPaidThisMonth checks if the expense was marked paid in the current month
func (r *RecurringExpense) IsPaidThisMonth() bool {
	if r.LastPaidDate == nil {
		return false
	}
	now := time.Now()
	return r.LastPaidDate.Year() == now.Year() && r.LastPaidDate.Month() == now.Month()
}
