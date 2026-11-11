package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Sync entity names, shared by tombstones and the sync push protocol.
const (
	SyncEntityArea             = "area"
	SyncEntityCategory         = "category"
	SyncEntityTransaction      = "transaction"
	SyncEntityRecurringExpense = "recurring_expense"
	SyncEntityExchangeRate     = "exchange_rate"
)

// SyncTombstone records a hard-deleted row so offline clients can drop their copy.
// Ref is the row's client_id, or the YYYY-MM month for exchange rates.
type SyncTombstone struct {
	ID          uint      `gorm:"primaryKey" json:"-"`
	WorkspaceID uint      `gorm:"not null;index:idx_tombstone_ws_created" json:"-"`
	Entity      string    `gorm:"size:32;not null" json:"entity"`
	Ref         string    `gorm:"size:64;not null" json:"ref"`
	CreatedAt   time.Time `gorm:"index:idx_tombstone_ws_created" json:"deleted_at"`
}

// ensureClientID gives a row its stable cross-device identity. Clients that create
// rows offline supply their own; everything else gets one here.
func ensureClientID(id *string) {
	if *id == "" {
		*id = uuid.NewString()
	}
}

func (a *Area) BeforeCreate(*gorm.DB) error             { ensureClientID(&a.ClientID); return nil }
func (c *Category) BeforeCreate(*gorm.DB) error         { ensureClientID(&c.ClientID); return nil }
func (t *Transaction) BeforeCreate(*gorm.DB) error      { ensureClientID(&t.ClientID); return nil }
func (r *RecurringExpense) BeforeCreate(*gorm.DB) error { ensureClientID(&r.ClientID); return nil }
