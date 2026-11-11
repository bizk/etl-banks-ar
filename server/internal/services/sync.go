package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"etl-banks-ar/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Offline sync.
//
// Clients keep a local copy of a workspace and talk to the server through two calls:
//   - Pull returns every row changed since a cursor, plus tombstones for deleted rows.
//   - Push applies a batch of offline mutations, resolving conflicts with last-write-wins.
//
// Rows are identified by client_id (a UUID) rather than the numeric id, because a client
// creates rows while offline, before the server has assigned one.

const (
	// syncCursorOverlap is subtracted from the server clock when issuing a cursor, so rows
	// committed while a pull was running are returned again by the next one. Clients upsert,
	// so the repetition is harmless.
	syncCursorOverlap = 5 * time.Second

	DefaultSyncPageSize = 2000
	MaxSyncPageSize     = 5000
	MaxSyncMutations    = 500

	// syncTimeTolerance absorbs the sub-millisecond rounding the database applies to timestamps.
	syncTimeTolerance = time.Millisecond
)

const (
	SyncOpCreate   = "create"
	SyncOpUpdate   = "update"
	SyncOpDelete   = "delete"
	SyncOpMarkPaid = "mark_paid"

	SyncStatusApplied  = "applied"
	SyncStatusStale    = "stale"     // the server row is newer; the client must take it
	SyncStatusNotFound = "not_found" // the row no longer exists on the server
	SyncStatusMerged   = "merged"    // the create matched an existing row; the client must adopt it
	SyncStatusError    = "error"
)

type SyncService struct {
	db        *gorm.DB
	recurring *RecurringExpenseService
}

func NewSyncService(db *gorm.DB, recurring *RecurringExpenseService) *SyncService {
	return &SyncService{db: db, recurring: recurring}
}

// ---- Wire types -------------------------------------------------------------------------

type SyncArea struct {
	ClientID  string    `json:"client_id"`
	ID        uint      `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	Icon      string    `json:"icon"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SyncCategory struct {
	ClientID     string    `json:"client_id"`
	ID           uint      `json:"id"`
	Name         string    `json:"name"`
	AreaClientID *string   `json:"area_client_id"`
	Color        string    `json:"color"`
	Icon         string    `json:"icon"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type SyncTransaction struct {
	ClientID      string    `json:"client_id"`
	ID            uint      `json:"id"`
	Date          string    `json:"date"` // YYYY-MM-DD
	Description   string    `json:"description"`
	Amount        float64   `json:"amount"`
	BalanceAfter  *float64  `json:"balance_after"`
	Type          string    `json:"type"`
	Category      string    `json:"category"`
	Owner         string    `json:"owner"`
	AreaClientID  *string   `json:"area_client_id"`
	UserConfirmed bool      `json:"user_confirmed"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type SyncRecurringExpense struct {
	ClientID         string    `json:"client_id"`
	ID               uint      `json:"id"`
	Name             string    `json:"name"`
	Amount           float64   `json:"amount"`
	CategoryClientID *string   `json:"category_client_id"`
	Owner            string    `json:"owner"`
	DueDay           int       `json:"due_day"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type SyncPayment struct {
	RecurringExpenseClientID string `json:"recurring_expense_client_id"`
	Month                    string `json:"month"`   // YYYY-MM
	PaidAt                   string `json:"paid_at"` // YYYY-MM-DD
	TransactionClientID      string `json:"transaction_client_id"`
}

type SyncExchangeRate struct {
	Month     string    `json:"month"`
	Rate      float64   `json:"rate"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SyncPullResponse struct {
	Cursor            string                 `json:"cursor"`
	HasMore           bool                   `json:"has_more"`
	Areas             []SyncArea             `json:"areas"`
	Categories        []SyncCategory         `json:"categories"`
	Transactions      []SyncTransaction      `json:"transactions"`
	RecurringExpenses []SyncRecurringExpense `json:"recurring_expenses"`
	RecurringPayments []SyncPayment          `json:"recurring_payments"`
	ExchangeRates     []SyncExchangeRate     `json:"exchange_rates"`
	Deleted           []models.SyncTombstone `json:"deleted"`
}

// SyncMutation is one offline change. Data carries the full row, not a partial patch.
type SyncMutation struct {
	Entity   string `json:"entity"`
	Op       string `json:"op"`
	ClientID string `json:"client_id"`
	// ClientTS is when the user made the change on the device.
	ClientTS time.Time `json:"client_ts"`
	// BaseUpdatedAt is the server updated_at of the copy the change was made on, if any.
	BaseUpdatedAt *time.Time      `json:"base_updated_at"`
	Data          json.RawMessage `json:"data"`
}

type SyncResult struct {
	ClientID string `json:"client_id"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	// Row is the server's current version of the row, when it exists.
	Row any `json:"row,omitempty"`
	// Payment is set for mark_paid: the payment now recorded for that month.
	Payment *SyncPayment `json:"payment,omitempty"`
}

// ---- Cursor -----------------------------------------------------------------------------

// syncCursor is a position in the change feed: a timestamp, plus the id of the last
// transaction already delivered at that exact timestamp while paging.
type syncCursor struct {
	since   time.Time
	afterID uint
}

func parseSyncCursor(raw string) (syncCursor, error) {
	var c syncCursor
	if raw == "" {
		return c, nil
	}
	ts, id, paged := strings.Cut(raw, "|")
	since, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return c, fmt.Errorf("invalid cursor")
	}
	c.since = since
	if paged {
		n, err := strconv.ParseUint(id, 10, 64)
		if err != nil {
			return c, fmt.Errorf("invalid cursor")
		}
		c.afterID = uint(n)
	}
	return c, nil
}

func (c syncCursor) String() string {
	s := c.since.Format(time.RFC3339Nano)
	if c.afterID > 0 {
		s += "|" + strconv.FormatUint(uint64(c.afterID), 10)
	}
	return s
}

// ---- Pull -------------------------------------------------------------------------------

// Pull returns the rows changed at or after the cursor. An empty cursor returns everything.
// Transactions are paged; the caller keeps pulling with the returned cursor while HasMore.
func (s *SyncService) Pull(workspaceID uint, rawCursor string, limit int) (*SyncPullResponse, error) {
	cursor, err := parseSyncCursor(rawCursor)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = DefaultSyncPageSize
	}
	if limit > MaxSyncPageSize {
		limit = MaxSyncPageSize
	}
	// Taken before any query runs: whatever commits after this point is covered by the next pull.
	nextSince := time.Now().Add(-syncCursorOverlap)

	changed := func(column string) *gorm.DB {
		q := s.db.Where("workspace_id = ?", workspaceID)
		if !cursor.since.IsZero() {
			q = q.Where(column+" >= ?", cursor.since)
		}
		return q
	}

	refs, err := loadSyncRefs(s.db, workspaceID)
	if err != nil {
		return nil, err
	}

	var areas []models.Area
	if err := changed("updated_at").Find(&areas).Error; err != nil {
		return nil, err
	}
	var categories []models.Category
	if err := changed("updated_at").Find(&categories).Error; err != nil {
		return nil, err
	}
	var expenses []models.RecurringExpense
	if err := changed("updated_at").Find(&expenses).Error; err != nil {
		return nil, err
	}
	var rates []models.ExchangeRate
	if err := changed("updated_at").Find(&rates).Error; err != nil {
		return nil, err
	}
	tombstones := []models.SyncTombstone{}
	if err := changed("created_at").Order("id ASC").Find(&tombstones).Error; err != nil {
		return nil, err
	}

	txQuery := s.db.Where("workspace_id = ?", workspaceID)
	if !cursor.since.IsZero() {
		txQuery = txQuery.Where("updated_at > ? OR (updated_at = ? AND id > ?)", cursor.since, cursor.since, cursor.afterID)
	}
	var transactions []models.Transaction
	if err := txQuery.Order("updated_at ASC, id ASC").Limit(limit + 1).Find(&transactions).Error; err != nil {
		return nil, err
	}

	payments, err := s.pullPayments(workspaceID, cursor.since)
	if err != nil {
		return nil, err
	}

	resp := &SyncPullResponse{
		Areas:             make([]SyncArea, 0, len(areas)),
		Categories:        make([]SyncCategory, 0, len(categories)),
		Transactions:      make([]SyncTransaction, 0, len(transactions)),
		RecurringExpenses: make([]SyncRecurringExpense, 0, len(expenses)),
		RecurringPayments: payments,
		ExchangeRates:     make([]SyncExchangeRate, 0, len(rates)),
		Deleted:           tombstones,
	}

	if len(transactions) > limit {
		transactions = transactions[:limit]
		last := transactions[len(transactions)-1]
		resp.HasMore = true
		resp.Cursor = syncCursor{since: last.UpdatedAt, afterID: last.ID}.String()
	} else {
		resp.Cursor = syncCursor{since: nextSince}.String()
	}

	for i := range areas {
		resp.Areas = append(resp.Areas, toSyncArea(&areas[i]))
	}
	for i := range categories {
		resp.Categories = append(resp.Categories, toSyncCategory(&categories[i], refs))
	}
	for i := range transactions {
		resp.Transactions = append(resp.Transactions, toSyncTransaction(&transactions[i], refs))
	}
	for i := range expenses {
		resp.RecurringExpenses = append(resp.RecurringExpenses, toSyncRecurringExpense(&expenses[i], refs))
	}
	for i := range rates {
		resp.ExchangeRates = append(resp.ExchangeRates, SyncExchangeRate{Month: rates[i].Month, Rate: rates[i].Rate, UpdatedAt: rates[i].UpdatedAt})
	}
	return resp, nil
}

type syncPaymentRow struct {
	RecurringExpenseClientID string
	Month                    string
	PaidAt                   time.Time
	TransactionClientID      *string
}

func (r syncPaymentRow) toSync() SyncPayment {
	p := SyncPayment{RecurringExpenseClientID: r.RecurringExpenseClientID, Month: r.Month, PaidAt: r.PaidAt.UTC().Format("2006-01-02")}
	if r.TransactionClientID != nil {
		p.TransactionClientID = *r.TransactionClientID
	}
	return p
}

func (s *SyncService) paymentQuery(workspaceID uint) *gorm.DB {
	return s.db.Table("recurring_expense_payments AS p").
		Select("r.client_id AS recurring_expense_client_id, p.month AS month, p.paid_at AS paid_at, t.client_id AS transaction_client_id").
		Joins("JOIN recurring_expenses AS r ON r.id = p.recurring_expense_id").
		Joins("LEFT JOIN transactions AS t ON t.id = p.transaction_id").
		Where("r.workspace_id = ?", workspaceID)
}

func (s *SyncService) pullPayments(workspaceID uint, since time.Time) ([]SyncPayment, error) {
	q := s.paymentQuery(workspaceID)
	if !since.IsZero() {
		q = q.Where("p.created_at >= ?", since)
	}
	var rows []syncPaymentRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, err
	}
	payments := make([]SyncPayment, 0, len(rows))
	for _, r := range rows {
		payments = append(payments, r.toSync())
	}
	return payments, nil
}

// ---- Reference resolution ---------------------------------------------------------------

// syncRefs translates between numeric foreign keys and client ids for one workspace.
type syncRefs struct {
	areaClient     map[uint]string
	areaID         map[string]uint
	categoryClient map[uint]string
	categoryID     map[string]uint
}

func loadSyncRefs(db *gorm.DB, workspaceID uint) (*syncRefs, error) {
	refs := &syncRefs{
		areaClient: map[uint]string{}, areaID: map[string]uint{},
		categoryClient: map[uint]string{}, categoryID: map[string]uint{},
	}
	var areas []models.Area
	if err := db.Select("id", "client_id").Where("workspace_id = ?", workspaceID).Find(&areas).Error; err != nil {
		return nil, err
	}
	for _, a := range areas {
		refs.areaClient[a.ID] = a.ClientID
		refs.areaID[a.ClientID] = a.ID
	}
	var categories []models.Category
	if err := db.Select("id", "client_id").Where("workspace_id = ?", workspaceID).Find(&categories).Error; err != nil {
		return nil, err
	}
	for _, c := range categories {
		refs.categoryClient[c.ID] = c.ClientID
		refs.categoryID[c.ClientID] = c.ID
	}
	return refs, nil
}

func lookupClient(m map[uint]string, id *uint) *string {
	if id == nil {
		return nil
	}
	if clientID, ok := m[*id]; ok {
		return &clientID
	}
	return nil
}

// lookupID resolves a client id to a numeric id. A reference to a row that no longer
// exists resolves to nil instead of failing: the row was deleted elsewhere.
func lookupID(m map[string]uint, clientID *string) *uint {
	if clientID == nil {
		return nil
	}
	if id, ok := m[*clientID]; ok {
		return &id
	}
	return nil
}

func toSyncArea(a *models.Area) SyncArea {
	return SyncArea{ClientID: a.ClientID, ID: a.ID, Name: a.Name, Color: a.Color, Icon: a.Icon, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt}
}

func toSyncCategory(c *models.Category, refs *syncRefs) SyncCategory {
	return SyncCategory{
		ClientID: c.ClientID, ID: c.ID, Name: c.Name, AreaClientID: lookupClient(refs.areaClient, c.AreaID),
		Color: c.Color, Icon: c.Icon, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

func toSyncTransaction(t *models.Transaction, refs *syncRefs) SyncTransaction {
	out := SyncTransaction{
		ClientID: t.ClientID, ID: t.ID,
		// Dates are written as midnight UTC; reading them back in UTC keeps the calendar day
		// whatever timezone the server runs in.
		Date:        t.Date.UTC().Format("2006-01-02"),
		Description: t.Description.String, Amount: t.Amount.Float64, Type: t.Type.String,
		Category: t.Category.String, Owner: t.Owner.String,
		AreaClientID:  lookupClient(refs.areaClient, t.AreaID),
		UserConfirmed: t.UserConfirmed, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
	if t.BalanceAfter.Valid {
		out.BalanceAfter = &t.BalanceAfter.Float64
	}
	return out
}

func toSyncRecurringExpense(e *models.RecurringExpense, refs *syncRefs) SyncRecurringExpense {
	return SyncRecurringExpense{
		ClientID: e.ClientID, ID: e.ID, Name: e.Name, Amount: e.Amount,
		CategoryClientID: lookupClient(refs.categoryClient, e.CategoryID),
		Owner:            e.Owner, DueDay: e.DueDay, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt,
	}
}

// ---- Deletes ----------------------------------------------------------------------------

// deleteWithTombstone hard-deletes the workspace rows of model matching cond and records a
// tombstone for each, atomically. before, if set, runs first for every row about to go.
// Deleting nothing is not an error.
func deleteWithTombstone(db *gorm.DB, model any, entity string, workspaceID uint, cond string, arg any, before func(tx *gorm.DB, id uint) error) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var rows []struct {
			ID       uint
			ClientID string
		}
		if err := tx.Model(model).Select("id, client_id").Where("workspace_id = ?", workspaceID).Where(cond, arg).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if before != nil {
				if err := before(tx, row.ID); err != nil {
					return err
				}
			}
			if err := tx.Where("id = ?", row.ID).Delete(model).Error; err != nil {
				return err
			}
			if err := tx.Create(&models.SyncTombstone{WorkspaceID: workspaceID, Entity: entity, Ref: row.ClientID}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// detachArea unassigns everything pointing at an area that is about to be deleted.
// Updates goes through gorm so updated_at moves and clients pull the change.
func detachArea(tx *gorm.DB, areaID uint) error {
	if err := tx.Model(&models.Category{}).Where("area_id = ?", areaID).Updates(map[string]any{"area_id": nil}).Error; err != nil {
		return err
	}
	return tx.Model(&models.Transaction{}).Where("area_id = ?", areaID).Updates(map[string]any{"area_id": nil}).Error
}

// detachCategory unassigns the recurring expenses of a category that is about to be deleted.
// Transactions reference categories by name and keep theirs.
func detachCategory(tx *gorm.DB, categoryID uint) error {
	return tx.Model(&models.RecurringExpense{}).Where("category_id = ?", categoryID).Updates(map[string]any{"category_id": nil}).Error
}

// ---- Push -------------------------------------------------------------------------------

// syncConflict reports whether an offline update must yield to the server row.
// There is no conflict when the client edited the very version the server still has.
// Otherwise the most recent change wins: the server row stays if it changed after the edit.
func syncConflict(rowUpdatedAt time.Time, base *time.Time, clientTS time.Time) bool {
	if base != nil {
		if d := rowUpdatedAt.Sub(*base); d < syncTimeTolerance && d > -syncTimeTolerance {
			return false
		}
	}
	return rowUpdatedAt.After(clientTS)
}

// pushState carries what earlier mutations of the same batch established.
type pushState struct {
	workspaceID uint
	userID      uint
	// aliases maps a client id whose create was merged into an existing row to that row's client id.
	aliases map[string]string
	// touched holds rows this batch already wrote; their updated_at reflects our own write,
	// so later mutations of the batch must not be judged stale against it.
	touched map[string]bool
}

func (p *pushState) resolve(clientID string) string {
	if alias, ok := p.aliases[clientID]; ok {
		return alias
	}
	return clientID
}

func (p *pushState) resolvePtr(clientID *string) *string {
	if clientID == nil || *clientID == "" {
		return nil
	}
	resolved := p.resolve(*clientID)
	return &resolved
}

// Push applies mutations in order. Each one is independent: a failure is reported in its
// result and does not stop the rest.
func (s *SyncService) Push(workspaceID, userID uint, mutations []SyncMutation) ([]SyncResult, error) {
	if len(mutations) > MaxSyncMutations {
		return nil, fmt.Errorf("too many mutations: %d (max %d)", len(mutations), MaxSyncMutations)
	}
	state := &pushState{workspaceID: workspaceID, userID: userID, aliases: map[string]string{}, touched: map[string]bool{}}
	results := make([]SyncResult, 0, len(mutations))
	for _, m := range mutations {
		res := s.apply(state, m)
		res.ClientID = m.ClientID
		results = append(results, res)
	}
	return results, nil
}

func syncError(err error) SyncResult {
	return SyncResult{Status: SyncStatusError, Error: err.Error()}
}

func (s *SyncService) apply(state *pushState, m SyncMutation) SyncResult {
	if _, err := uuid.Parse(m.ClientID); err != nil {
		return syncError(errors.New("client_id must be a UUID"))
	}
	m.ClientID = state.resolve(m.ClientID)

	var h syncEntityHandler
	switch m.Entity {
	case models.SyncEntityArea:
		h = areaSync{}
	case models.SyncEntityCategory:
		h = categorySync{}
	case models.SyncEntityTransaction:
		h = transactionSync{}
	case models.SyncEntityRecurringExpense:
		h = recurringExpenseSync{}
	default:
		return syncError(fmt.Errorf("unknown entity %q", m.Entity))
	}

	switch m.Op {
	case SyncOpCreate, SyncOpUpdate:
		return s.upsert(state, h, m)
	case SyncOpDelete:
		if err := h.delete(s.db, state.workspaceID, m.ClientID); err != nil {
			return syncError(err)
		}
		return SyncResult{Status: SyncStatusApplied}
	case SyncOpMarkPaid:
		if m.Entity != models.SyncEntityRecurringExpense {
			return syncError(errors.New("mark_paid only applies to recurring_expense"))
		}
		return s.markPaid(state, m)
	default:
		return syncError(fmt.Errorf("unknown op %q", m.Op))
	}
}

// syncEntityHandler is the per-entity part of a push.
type syncEntityHandler interface {
	// find loads the workspace row with this client id, or gorm.ErrRecordNotFound.
	find(tx *gorm.DB, workspaceID uint, clientID string) (syncRow, error)
	// blank returns a new, unsaved row.
	blank(workspaceID uint, clientID string) syncRow
	// duplicate returns an existing row the new one would collide with, or nil.
	duplicate(tx *gorm.DB, workspaceID uint, data json.RawMessage) (syncRow, error)
	delete(db *gorm.DB, workspaceID uint, clientID string) error
}

// syncRow is one row being written by a push.
type syncRow interface {
	updatedAt() time.Time
	clientID() string
	// assign validates data and copies it onto the row.
	assign(tx *gorm.DB, state *pushState, refs *syncRefs, data json.RawMessage, creating bool) error
	// model returns the gorm model to save.
	model() any
	wire(refs *syncRefs) any
}

func (s *SyncService) upsert(state *pushState, h syncEntityHandler, m SyncMutation) SyncResult {
	var res SyncResult
	err := s.db.Transaction(func(tx *gorm.DB) error {
		refs, err := loadSyncRefs(tx, state.workspaceID)
		if err != nil {
			return err
		}
		row, err := h.find(tx, state.workspaceID, m.ClientID)
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		switch {
		case !exists && m.Op == SyncOpUpdate:
			// Deleted on the server while the client was offline: the delete wins.
			res = SyncResult{Status: SyncStatusNotFound}
			return nil
		case !exists:
			dup, err := h.duplicate(tx, state.workspaceID, m.Data)
			if err != nil {
				return err
			}
			if dup != nil {
				state.aliases[m.ClientID] = dup.clientID()
				res = SyncResult{Status: SyncStatusMerged, Row: dup.wire(refs)}
				return nil
			}
			row = h.blank(state.workspaceID, m.ClientID)
		// A create for a row that exists is a retry whose first response was lost. It is judged
		// like an update, so edits made on the device since that first attempt still land.
		case !state.touched[m.ClientID] && syncConflict(row.updatedAt(), m.BaseUpdatedAt, m.ClientTS):
			res = SyncResult{Status: SyncStatusStale, Row: row.wire(refs)}
			return nil
		}

		if err := row.assign(tx, state, refs, m.Data, m.Op == SyncOpCreate); err != nil {
			res = syncError(err)
			if exists {
				res.Row = row.wire(refs) // unchanged in the database; assign only touched our copy
				if fresh, ferr := h.find(tx, state.workspaceID, m.ClientID); ferr == nil {
					res.Row = fresh.wire(refs)
				}
			}
			return nil
		}
		if exists {
			err = tx.Save(row.model()).Error
		} else {
			err = tx.Create(row.model()).Error
		}
		if err != nil {
			return err
		}
		// Reload so the returned updated_at is exactly what the database stored.
		saved, err := h.find(tx, state.workspaceID, m.ClientID)
		if err != nil {
			return err
		}
		refs, err = loadSyncRefs(tx, state.workspaceID)
		if err != nil {
			return err
		}
		state.touched[m.ClientID] = true
		res = SyncResult{Status: SyncStatusApplied, Row: saved.wire(refs)}
		return nil
	})
	if err != nil {
		return syncError(err)
	}
	return res
}

func (s *SyncService) markPaid(state *pushState, m SyncMutation) SyncResult {
	var data struct {
		Month               string `json:"month"`
		TransactionClientID string `json:"transaction_client_id"`
	}
	if err := json.Unmarshal(m.Data, &data); err != nil {
		return syncError(errors.New("invalid data"))
	}
	if data.TransactionClientID != "" {
		if _, err := uuid.Parse(data.TransactionClientID); err != nil {
			return syncError(errors.New("transaction_client_id must be a UUID"))
		}
	}

	var expense models.RecurringExpense
	err := s.db.Where("workspace_id = ? AND client_id = ?", state.workspaceID, m.ClientID).First(&expense).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return SyncResult{Status: SyncStatusNotFound}
	}
	if err != nil {
		return syncError(err)
	}
	if _, _, err := s.recurring.MarkPaidAs(expense.ID, state.workspaceID, data.Month, state.userID, data.TransactionClientID); err != nil {
		return syncError(err)
	}
	state.touched[m.ClientID] = true
	if data.TransactionClientID != "" {
		// The device may also have edited the transaction it showed for this payment.
		state.touched[data.TransactionClientID] = true
	}

	// Report the payment on record, which is someone else's if the month was already paid.
	var row syncPaymentRow
	if err := s.paymentQuery(state.workspaceID).Where("p.recurring_expense_id = ? AND p.month = ?", expense.ID, data.Month).Scan(&row).Error; err != nil {
		return syncError(err)
	}
	payment := row.toSync()
	return SyncResult{Status: SyncStatusApplied, Payment: &payment}
}

// ---- Entity handlers --------------------------------------------------------------------

func findByClientID[T any](tx *gorm.DB, workspaceID uint, clientID string) (*T, error) {
	var row T
	err := tx.Where("workspace_id = ? AND client_id = ?", workspaceID, clientID).First(&row).Error
	return &row, err
}

func decodeSyncData(data json.RawMessage, into any) error {
	if err := json.Unmarshal(data, into); err != nil {
		return errors.New("invalid data")
	}
	return nil
}

// Areas.

type areaSync struct{}
type areaRow struct{ *models.Area }

func (areaSync) find(tx *gorm.DB, workspaceID uint, clientID string) (syncRow, error) {
	row, err := findByClientID[models.Area](tx, workspaceID, clientID)
	return areaRow{row}, err
}
func (areaSync) blank(workspaceID uint, clientID string) syncRow {
	return areaRow{&models.Area{WorkspaceID: workspaceID, ClientID: clientID}}
}
func (areaSync) duplicate(*gorm.DB, uint, json.RawMessage) (syncRow, error) { return nil, nil }
func (areaSync) delete(db *gorm.DB, workspaceID uint, clientID string) error {
	return deleteWithTombstone(db, &models.Area{}, models.SyncEntityArea, workspaceID, "client_id = ?", clientID, detachArea)
}

func (r areaRow) updatedAt() time.Time { return r.UpdatedAt }
func (r areaRow) clientID() string     { return r.ClientID }
func (r areaRow) model() any           { return r.Area }
func (r areaRow) wire(*syncRefs) any   { return toSyncArea(r.Area) }
func (r areaRow) assign(_ *gorm.DB, _ *pushState, _ *syncRefs, raw json.RawMessage, _ bool) error {
	var data struct {
		Name  string `json:"name"`
		Color string `json:"color"`
		Icon  string `json:"icon"`
	}
	if err := decodeSyncData(raw, &data); err != nil {
		return err
	}
	if strings.TrimSpace(data.Name) == "" {
		return errors.New("name is required")
	}
	r.Name, r.Color, r.Icon = data.Name, data.Color, data.Icon
	return nil
}

// Categories.

type categorySync struct{}
type categoryRow struct{ *models.Category }

type categorySyncData struct {
	Name         string  `json:"name"`
	AreaClientID *string `json:"area_client_id"`
	Color        string  `json:"color"`
	Icon         string  `json:"icon"`
}

func (categorySync) find(tx *gorm.DB, workspaceID uint, clientID string) (syncRow, error) {
	row, err := findByClientID[models.Category](tx, workspaceID, clientID)
	return categoryRow{row}, err
}
func (categorySync) blank(workspaceID uint, clientID string) syncRow {
	return categoryRow{&models.Category{WorkspaceID: workspaceID, ClientID: clientID}}
}

// duplicate: category names are unique per workspace, so a category created offline under
// a name that already exists is the same category.
func (categorySync) duplicate(tx *gorm.DB, workspaceID uint, raw json.RawMessage) (syncRow, error) {
	var data categorySyncData
	if err := decodeSyncData(raw, &data); err != nil {
		return nil, nil // assign reports the bad payload
	}
	var existing models.Category
	err := tx.Where("workspace_id = ? AND name = ?", workspaceID, data.Name).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return categoryRow{&existing}, nil
}
func (categorySync) delete(db *gorm.DB, workspaceID uint, clientID string) error {
	return deleteWithTombstone(db, &models.Category{}, models.SyncEntityCategory, workspaceID, "client_id = ?", clientID, detachCategory)
}

func (r categoryRow) updatedAt() time.Time    { return r.UpdatedAt }
func (r categoryRow) clientID() string        { return r.ClientID }
func (r categoryRow) model() any              { return r.Category }
func (r categoryRow) wire(refs *syncRefs) any { return toSyncCategory(r.Category, refs) }
func (r categoryRow) assign(tx *gorm.DB, state *pushState, refs *syncRefs, raw json.RawMessage, _ bool) error {
	var data categorySyncData
	if err := decodeSyncData(raw, &data); err != nil {
		return err
	}
	if strings.TrimSpace(data.Name) == "" {
		return errors.New("name is required")
	}
	if data.Name != r.Name {
		var taken int64
		if err := tx.Model(&models.Category{}).
			Where("workspace_id = ? AND name = ? AND client_id <> ?", r.WorkspaceID, data.Name, r.ClientID).
			Count(&taken).Error; err != nil {
			return err
		}
		if taken > 0 {
			return fmt.Errorf("a category named %q already exists", data.Name)
		}
	}
	r.Name, r.Color, r.Icon = data.Name, data.Color, data.Icon
	r.AreaID = lookupID(refs.areaID, state.resolvePtr(data.AreaClientID))
	r.Area = nil
	return nil
}

// Transactions.

type transactionSync struct{}
type transactionRow struct{ *models.Transaction }

func (transactionSync) find(tx *gorm.DB, workspaceID uint, clientID string) (syncRow, error) {
	row, err := findByClientID[models.Transaction](tx, workspaceID, clientID)
	return transactionRow{row}, err
}
func (transactionSync) blank(workspaceID uint, clientID string) syncRow {
	return transactionRow{&models.Transaction{WorkspaceID: workspaceID, ClientID: clientID}}
}
func (transactionSync) duplicate(*gorm.DB, uint, json.RawMessage) (syncRow, error) { return nil, nil }
func (transactionSync) delete(db *gorm.DB, workspaceID uint, clientID string) error {
	return deleteWithTombstone(db, &models.Transaction{}, models.SyncEntityTransaction, workspaceID, "client_id = ?", clientID, nil)
}

func (r transactionRow) updatedAt() time.Time    { return r.UpdatedAt }
func (r transactionRow) clientID() string        { return r.ClientID }
func (r transactionRow) model() any              { return r.Transaction }
func (r transactionRow) wire(refs *syncRefs) any { return toSyncTransaction(r.Transaction, refs) }
func (r transactionRow) assign(tx *gorm.DB, state *pushState, refs *syncRefs, raw json.RawMessage, creating bool) error {
	var data struct {
		Date          string  `json:"date"`
		Description   string  `json:"description"`
		Amount        float64 `json:"amount"`
		Type          string  `json:"type"`
		Category      string  `json:"category"`
		Owner         string  `json:"owner"`
		AreaClientID  *string `json:"area_client_id"`
		UserConfirmed bool    `json:"user_confirmed"`
	}
	if err := decodeSyncData(raw, &data); err != nil {
		return err
	}
	if data.Amount == 0 {
		return errors.New("amount is required")
	}
	if creating && strings.TrimSpace(data.Owner) == "" {
		// Same default as the REST create.
		var user models.User
		if tx.Select("name").First(&user, state.userID).Error == nil {
			data.Owner = user.Name
		}
	}
	patch := TransactionPatch{
		Date: &data.Date, Description: &data.Description, Amount: &data.Amount, Type: &data.Type,
		Category: &data.Category, Owner: &data.Owner, UserConfirmed: &data.UserConfirmed,
	}
	if err := ApplyTransactionPatch(r.Transaction, patch); err != nil {
		return err
	}
	r.AreaID = lookupID(refs.areaID, state.resolvePtr(data.AreaClientID))
	r.Area = nil
	return nil
}

// Recurring expenses.

type recurringExpenseSync struct{}
type recurringExpenseRow struct{ *models.RecurringExpense }

func (recurringExpenseSync) find(tx *gorm.DB, workspaceID uint, clientID string) (syncRow, error) {
	row, err := findByClientID[models.RecurringExpense](tx, workspaceID, clientID)
	return recurringExpenseRow{row}, err
}
func (recurringExpenseSync) blank(workspaceID uint, clientID string) syncRow {
	return recurringExpenseRow{&models.RecurringExpense{WorkspaceID: workspaceID, ClientID: clientID}}
}
func (recurringExpenseSync) duplicate(*gorm.DB, uint, json.RawMessage) (syncRow, error) {
	return nil, nil
}
func (recurringExpenseSync) delete(db *gorm.DB, workspaceID uint, clientID string) error {
	return deleteWithTombstone(db, &models.RecurringExpense{}, models.SyncEntityRecurringExpense, workspaceID, "client_id = ?", clientID, nil)
}

func (r recurringExpenseRow) updatedAt() time.Time { return r.UpdatedAt }
func (r recurringExpenseRow) clientID() string     { return r.ClientID }
func (r recurringExpenseRow) model() any           { return r.RecurringExpense }
func (r recurringExpenseRow) wire(refs *syncRefs) any {
	return toSyncRecurringExpense(r.RecurringExpense, refs)
}
func (r recurringExpenseRow) assign(_ *gorm.DB, state *pushState, refs *syncRefs, raw json.RawMessage, _ bool) error {
	var data struct {
		Name             string  `json:"name"`
		Amount           float64 `json:"amount"`
		CategoryClientID *string `json:"category_client_id"`
		Owner            string  `json:"owner"`
		DueDay           int     `json:"due_day"`
	}
	if err := decodeSyncData(raw, &data); err != nil {
		return err
	}
	if strings.TrimSpace(data.Name) == "" {
		return errors.New("name is required")
	}
	r.Name, r.Amount, r.Owner, r.DueDay = data.Name, data.Amount, data.Owner, data.DueDay
	r.CategoryID = lookupID(refs.categoryID, state.resolvePtr(data.CategoryClientID))
	r.Category = nil
	return ValidateRecurringExpense(r.RecurringExpense)
}

// ---- Migration --------------------------------------------------------------------------

// BackfillSyncColumns fills the sync columns of rows that predate them: a client_id for
// every syncable row, and created_at for recurring payments.
func BackfillSyncColumns(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		for _, model := range []any{&models.Area{}, &models.Category{}, &models.Transaction{}, &models.RecurringExpense{}} {
			var ids []uint
			if err := tx.Model(model).Where("client_id IS NULL OR client_id = ''").Pluck("id", &ids).Error; err != nil {
				return err
			}
			for _, id := range ids {
				// UpdateColumn: this is not a user-visible change, so updated_at must not move.
				if err := tx.Model(model).Where("id = ?", id).UpdateColumn("client_id", uuid.NewString()).Error; err != nil {
					return err
				}
			}
		}
		return tx.Model(&models.RecurringExpensePayment{}).
			Where("created_at IS NULL").
			UpdateColumn("created_at", gorm.Expr("paid_at")).Error
	})
}
