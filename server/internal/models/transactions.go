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
	ID           uint
	Date         time.Time       `json:"date"`
	Description  sql.NullString  `json:"description"`
	Amount       sql.NullFloat64 `json:"amount"`
	BalanceAfter sql.NullFloat64 `json:"balance_after"`
	Type         sql.NullString  `json:"type"` // "debit" | "credit"
}
