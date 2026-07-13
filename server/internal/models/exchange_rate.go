package models

import "time"

type ExchangeRate struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	WorkspaceID uint      `gorm:"uniqueIndex:idx_ws_month" json:"workspace_id"`
	Month       string    `gorm:"size:7;uniqueIndex:idx_ws_month" json:"month"` // YYYY-MM format
	Rate        float64   `json:"rate"`                                         // ARS per USD
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
