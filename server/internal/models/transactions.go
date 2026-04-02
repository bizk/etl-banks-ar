package models

import (
	"database/sql"
	"time"
)

// Define the expected JSON structure
type BankMovements struct {
	Transactions []Transaction `json:"transactions"`
}

type Transaction struct {
	ID            uint            `gorm:"primaryKey" json:"id"`
	WorkspaceID   uint            `gorm:"not null;index" json:"workspace_id"`
	Workspace     Workspace       `gorm:"foreignKey:WorkspaceID" json:"-"`
	Date          time.Time       `json:"date"`
	Description   sql.NullString  `json:"description"`
	Amount        sql.NullFloat64 `json:"amount"`
	BalanceAfter  sql.NullFloat64 `json:"balance_after"`
	Type          sql.NullString  `json:"type"` // "debit" | "credit"
	Category      sql.NullString  `json:"category"`
	EmbeddingJSON string          `gorm:"column:embedding_json" json:"-"`
	UserConfirmed bool            `gorm:"column:user_confirmed" json:"user_confirmed"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}
