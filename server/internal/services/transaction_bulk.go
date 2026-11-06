package services

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

// MaxBulkTransactionUpdates caps how many rows a single bulk update may touch.
const MaxBulkTransactionUpdates = 1000

// TransactionPatch is a partial update: nil fields are left untouched.
type TransactionPatch struct {
	Date          *string  `json:"date"`
	Description   *string  `json:"description"`
	Amount        *float64 `json:"amount"`
	Type          *string  `json:"type"`
	Category      *string  `json:"category"`
	Owner         *string  `json:"owner"`
	AreaID        *uint    `json:"area_id"`
	UserConfirmed *bool    `json:"user_confirmed"`
}

// TransactionPatchItem is one row of a bulk update.
type TransactionPatchItem struct {
	ID uint `json:"id"`
	TransactionPatch
}

// ApplyTransactionPatch validates the patch and applies its non-nil fields to t.
func ApplyTransactionPatch(t *models.Transaction, p TransactionPatch) error {
	if p.Date != nil {
		date, err := time.Parse("2006-01-02", strings.TrimSpace(*p.Date))
		if err != nil {
			return fmt.Errorf("invalid date %q, use YYYY-MM-DD", *p.Date)
		}
		t.Date = date
	}
	if p.Type != nil {
		typ := strings.ToLower(strings.TrimSpace(*p.Type))
		if typ != "debit" && typ != "credit" {
			return fmt.Errorf("invalid type %q, use debit or credit", *p.Type)
		}
		t.Type = sql.NullString{String: typ, Valid: true}
	}
	if p.Description != nil {
		t.Description = sql.NullString{String: *p.Description, Valid: true}
	}
	if p.Amount != nil {
		t.Amount = sql.NullFloat64{Float64: *p.Amount, Valid: true}
	}
	if p.Category != nil {
		category := strings.TrimSpace(*p.Category)
		t.Category = sql.NullString{String: category, Valid: category != ""}
	}
	if p.Owner != nil {
		owner := strings.TrimSpace(*p.Owner)
		t.Owner = sql.NullString{String: owner, Valid: owner != ""}
	}
	if p.AreaID != nil {
		t.AreaID = p.AreaID
	}
	if p.UserConfirmed != nil {
		t.UserConfirmed = *p.UserConfirmed
	}
	return nil
}

// ErrBulkTransactionNotFound is returned when an id is not in the workspace.
var ErrBulkTransactionNotFound = errors.New("transaction not found in workspace")

// BulkUpdate applies all patches atomically: either every row is saved or none is.
func (s *TransactionService) BulkUpdate(workspaceID uint, items []TransactionPatchItem) ([]models.Transaction, error) {
	if len(items) == 0 {
		return []models.Transaction{}, nil
	}
	if len(items) > MaxBulkTransactionUpdates {
		return nil, fmt.Errorf("too many transactions: %d (max %d)", len(items), MaxBulkTransactionUpdates)
	}

	ids := make([]uint, 0, len(items))
	seen := make(map[uint]bool, len(items))
	for _, item := range items {
		if seen[item.ID] {
			return nil, fmt.Errorf("transaction %d appears more than once", item.ID)
		}
		seen[item.ID] = true
		ids = append(ids, item.ID)
	}

	var updated []models.Transaction
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var rows []models.Transaction
		if err := tx.Where("workspace_id = ? AND id IN ?", workspaceID, ids).Find(&rows).Error; err != nil {
			return err
		}
		byID := make(map[uint]*models.Transaction, len(rows))
		for i := range rows {
			byID[rows[i].ID] = &rows[i]
		}

		updated = make([]models.Transaction, 0, len(items))
		for _, item := range items {
			row, ok := byID[item.ID]
			if !ok {
				return fmt.Errorf("%w: %d", ErrBulkTransactionNotFound, item.ID)
			}
			if err := ApplyTransactionPatch(row, item.TransactionPatch); err != nil {
				return fmt.Errorf("transaction %d: %w", item.ID, err)
			}
			if err := tx.Save(row).Error; err != nil {
				return err
			}
			updated = append(updated, *row)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}
