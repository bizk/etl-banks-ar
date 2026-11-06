package services

import (
	"database/sql"
	"testing"
	"time"

	"etl-banks-ar/internal/models"
)

func strPtr(s string) *string     { return &s }
func floatPtr(f float64) *float64 { return &f }

func TestApplyTransactionPatch(t *testing.T) {
	t.Parallel()
	base := func() models.Transaction {
		return models.Transaction{
			Date:        time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC),
			Description: sql.NullString{String: "Original", Valid: true},
			Amount:      sql.NullFloat64{Float64: -100, Valid: true},
			Type:        sql.NullString{String: "debit", Valid: true},
			Category:    sql.NullString{String: "Super", Valid: true},
			Owner:       sql.NullString{String: "Ana", Valid: true},
		}
	}

	cases := []struct {
		name    string
		patch   TransactionPatch
		wantErr bool
		check   func(t *testing.T, tx models.Transaction)
	}{
		{
			name:  "empty patch changes nothing",
			patch: TransactionPatch{},
			check: func(t *testing.T, tx models.Transaction) {
				if tx != base() {
					t.Fatalf("expected unchanged transaction, got %+v", tx)
				}
			},
		},
		{
			name:  "category trimmed and set",
			patch: TransactionPatch{Category: strPtr("  Transporte ")},
			check: func(t *testing.T, tx models.Transaction) {
				if tx.Category != (sql.NullString{String: "Transporte", Valid: true}) {
					t.Fatalf("got %+v", tx.Category)
				}
			},
		},
		{
			name:  "empty category clears it",
			patch: TransactionPatch{Category: strPtr("")},
			check: func(t *testing.T, tx models.Transaction) {
				if tx.Category.Valid {
					t.Fatalf("expected null category, got %+v", tx.Category)
				}
			},
		},
		{
			name:  "type normalized",
			patch: TransactionPatch{Type: strPtr(" CREDIT ")},
			check: func(t *testing.T, tx models.Transaction) {
				if tx.Type.String != "credit" {
					t.Fatalf("got %q", tx.Type.String)
				}
			},
		},
		{
			name:  "date and amount",
			patch: TransactionPatch{Date: strPtr("2026-11-20"), Amount: floatPtr(-42.5)},
			check: func(t *testing.T, tx models.Transaction) {
				if tx.Date.Format("2006-01-02") != "2026-11-20" || tx.Amount.Float64 != -42.5 {
					t.Fatalf("got date %v amount %v", tx.Date, tx.Amount)
				}
			},
		},
		{name: "invalid type rejected", patch: TransactionPatch{Type: strPtr("transfer")}, wantErr: true},
		{name: "invalid date rejected", patch: TransactionPatch{Date: strPtr("20/11/2026")}, wantErr: true},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			tx := base()
			err := ApplyTransactionPatch(&tx, tt.patch)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			tt.check(t, tx)
		})
	}
}
