package services

import (
	"encoding/json"
	"testing"
	"time"

	"etl-banks-ar/internal/models"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const testWorkspace = uint(1)

func newSyncTestDB(t *testing.T) (*gorm.DB, *SyncService) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// One connection: every connection to :memory: is its own database.
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(
		&models.User{}, &models.Workspace{}, &models.Area{}, &models.Category{}, &models.Transaction{},
		&models.RecurringExpense{}, &models.RecurringExpensePayment{}, &models.ExchangeRate{}, &models.SyncTombstone{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Create(&models.User{ID: 1, Email: "ana@example.com", Name: "Ana"})
	db.Create(&models.Workspace{ID: testWorkspace, Name: "Casa", OwnerID: 1})
	return db, NewSyncService(db, NewRecurringExpenseService(db))
}

func mutation(t *testing.T, entity, op, clientID string, data any) SyncMutation {
	t.Helper()
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	return SyncMutation{Entity: entity, Op: op, ClientID: clientID, ClientTS: time.Now(), Data: raw}
}

func push(t *testing.T, s *SyncService, mutations ...SyncMutation) []SyncResult {
	t.Helper()
	results, err := s.Push(testWorkspace, 1, mutations)
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if len(results) != len(mutations) {
		t.Fatalf("got %d results for %d mutations", len(results), len(mutations))
	}
	return results
}

func wantStatus(t *testing.T, res SyncResult, status string) {
	t.Helper()
	if res.Status != status {
		t.Fatalf("status = %q (error %q), want %q", res.Status, res.Error, status)
	}
}

func txnData(description string, amount float64) map[string]any {
	return map[string]any{"date": "2026-03-05", "description": description, "amount": amount, "type": "debit", "category": "Super"}
}

func TestSyncConflict(t *testing.T) {
	serverAt := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	before, after := serverAt.Add(-time.Hour), serverAt.Add(time.Hour)
	rounded := serverAt.Add(400 * time.Microsecond)

	tests := []struct {
		name     string
		base     *time.Time
		clientTS time.Time
		want     bool
	}{
		{"server changed after the offline edit", &before, before.Add(time.Minute), true},
		{"offline edit is the most recent change", &before, after, false},
		{"client edited the current version, even with a slow clock", &serverAt, before, false},
		{"base matches up to database rounding", &rounded, before, false},
		{"no base, older edit", nil, before, true},
		{"no base, newer edit", nil, after, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := syncConflict(serverAt, tt.base, tt.clientTS); got != tt.want {
				t.Errorf("syncConflict = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSyncCursorRoundTrip(t *testing.T) {
	at := time.Date(2026, 3, 10, 12, 0, 0, 123000000, time.UTC)
	for _, c := range []syncCursor{{}, {since: at}, {since: at, afterID: 42}} {
		raw := ""
		if !c.since.IsZero() {
			raw = c.String()
		}
		got, err := parseSyncCursor(raw)
		if err != nil {
			t.Fatalf("parse %q: %v", raw, err)
		}
		if !got.since.Equal(c.since) || got.afterID != c.afterID {
			t.Errorf("round trip of %q = %+v, want %+v", raw, got, c)
		}
	}
	if _, err := parseSyncCursor("yesterday"); err == nil {
		t.Error("expected an error for a malformed cursor")
	}
}

func TestPushCreateIsIdempotent(t *testing.T) {
	db, s := newSyncTestDB(t)
	id := uuid.NewString()
	create := mutation(t, models.SyncEntityTransaction, SyncOpCreate, id, txnData("Coto", 1500))

	wantStatus(t, push(t, s, create)[0], SyncStatusApplied)
	// Retry after a lost response: nothing newer to apply, the client takes the server row.
	retry := push(t, s, create)[0]
	wantStatus(t, retry, SyncStatusStale)
	if retry.Row == nil {
		t.Error("the retry must return the stored row")
	}
	// The same retry carrying an edit made after the first attempt applies it.
	edited := mutation(t, models.SyncEntityTransaction, SyncOpCreate, id, txnData("Coto", 1500))
	edited.ClientTS = time.Now().Add(time.Minute)
	wantStatus(t, push(t, s, edited)[0], SyncStatusApplied)

	var rows []models.Transaction
	db.Find(&rows)
	if len(rows) != 1 {
		t.Fatalf("got %d transactions, want 1", len(rows))
	}
	if rows[0].ClientID != id || rows[0].Owner.String != "Ana" || rows[0].Amount.Float64 != 1500 {
		t.Errorf("unexpected row: %+v", rows[0])
	}
}

func TestPushResolvesReferencesCreatedInTheSameBatch(t *testing.T) {
	db, s := newSyncTestDB(t)
	areaID, catID, expenseID := uuid.NewString(), uuid.NewString(), uuid.NewString()

	results := push(t, s,
		mutation(t, models.SyncEntityArea, SyncOpCreate, areaID, map[string]any{"name": "Hogar"}),
		mutation(t, models.SyncEntityCategory, SyncOpCreate, catID, map[string]any{"name": "Luz", "area_client_id": areaID}),
		mutation(t, models.SyncEntityRecurringExpense, SyncOpCreate, expenseID, map[string]any{"name": "Edesur", "amount": 9000, "due_day": 10, "category_client_id": catID}),
		// An edit made offline right after the create: must not be judged stale against our own write.
		mutation(t, models.SyncEntityArea, SyncOpUpdate, areaID, map[string]any{"name": "Casa"}),
	)
	for _, res := range results {
		wantStatus(t, res, SyncStatusApplied)
	}

	var area models.Area
	db.Where("client_id = ?", areaID).First(&area)
	var cat models.Category
	db.Where("client_id = ?", catID).First(&cat)
	var expense models.RecurringExpense
	db.Where("client_id = ?", expenseID).First(&expense)

	if area.Name != "Casa" {
		t.Errorf("area name = %q, want Casa", area.Name)
	}
	if cat.AreaID == nil || *cat.AreaID != area.ID {
		t.Errorf("category area_id = %v, want %d", cat.AreaID, area.ID)
	}
	if expense.CategoryID == nil || *expense.CategoryID != cat.ID {
		t.Errorf("expense category_id = %v, want %d", expense.CategoryID, cat.ID)
	}
}

func TestPushMergesCategoryCreatedUnderAnExistingName(t *testing.T) {
	db, s := newSyncTestDB(t)
	existing := models.Category{WorkspaceID: testWorkspace, Name: "Super"}
	db.Create(&existing)

	offlineID, expenseID := uuid.NewString(), uuid.NewString()
	results := push(t, s,
		mutation(t, models.SyncEntityCategory, SyncOpCreate, offlineID, map[string]any{"name": "Super"}),
		mutation(t, models.SyncEntityRecurringExpense, SyncOpCreate, expenseID, map[string]any{"name": "Compra", "amount": 100, "due_day": 1, "category_client_id": offlineID}),
	)
	wantStatus(t, results[0], SyncStatusMerged)
	if got := results[0].Row.(SyncCategory).ClientID; got != existing.ClientID {
		t.Errorf("merged into %q, want %q", got, existing.ClientID)
	}
	wantStatus(t, results[1], SyncStatusApplied)

	var count int64
	db.Model(&models.Category{}).Count(&count)
	if count != 1 {
		t.Errorf("got %d categories, want 1", count)
	}
	var expense models.RecurringExpense
	db.Where("client_id = ?", expenseID).First(&expense)
	if expense.CategoryID == nil || *expense.CategoryID != existing.ID {
		t.Errorf("expense category_id = %v, want the existing category %d", expense.CategoryID, existing.ID)
	}
}

func TestPushUpdateLastWriteWins(t *testing.T) {
	db, s := newSyncTestDB(t)
	row := models.Transaction{WorkspaceID: testWorkspace, Date: time.Now()}
	db.Create(&row)
	db.First(&row, row.ID)
	stored := row.UpdatedAt

	update := func(base time.Time, clientTS time.Time, description string) SyncResult {
		m := mutation(t, models.SyncEntityTransaction, SyncOpUpdate, row.ClientID, txnData(description, 10))
		m.BaseUpdatedAt, m.ClientTS = &base, clientTS
		return push(t, s, m)[0]
	}
	description := func() string {
		var got models.Transaction
		db.First(&got, row.ID)
		return got.Description.String
	}

	// The server row changed after the client's copy was taken, and after the offline edit.
	staleBase := stored.Add(-time.Hour)
	res := update(staleBase, stored.Add(-time.Minute), "offline, older")
	wantStatus(t, res, SyncStatusStale)
	if description() != "" {
		t.Errorf("stale update was applied: %q", description())
	}
	if res.Row == nil {
		t.Error("a stale result must carry the server row")
	}

	// Same divergence, but the offline edit is the most recent change.
	wantStatus(t, update(staleBase, time.Now().Add(time.Minute), "offline, newer"), SyncStatusApplied)
	if description() != "offline, newer" {
		t.Errorf("description = %q", description())
	}

	// Editing the current version always applies, whatever the device clock says.
	db.First(&row, row.ID)
	wantStatus(t, update(row.UpdatedAt, time.Unix(0, 0), "slow clock"), SyncStatusApplied)
	if description() != "slow clock" {
		t.Errorf("description = %q", description())
	}
}

func TestPushUpdateOfDeletedRowIsNotFound(t *testing.T) {
	_, s := newSyncTestDB(t)
	res := push(t, s, mutation(t, models.SyncEntityTransaction, SyncOpUpdate, uuid.NewString(), txnData("gone", 1)))[0]
	wantStatus(t, res, SyncStatusNotFound)
}

func TestPushRejectsInvalidRows(t *testing.T) {
	db, s := newSyncTestDB(t)
	results := push(t, s,
		mutation(t, models.SyncEntityTransaction, SyncOpCreate, uuid.NewString(), map[string]any{"date": "05/03/2026", "amount": 1, "type": "debit"}),
		mutation(t, models.SyncEntityTransaction, SyncOpCreate, uuid.NewString(), map[string]any{"date": "2026-03-05", "amount": 0, "type": "debit"}),
		mutation(t, models.SyncEntityRecurringExpense, SyncOpCreate, uuid.NewString(), map[string]any{"name": "x", "amount": 5, "due_day": 40}),
		mutation(t, models.SyncEntityArea, SyncOpCreate, "not-a-uuid", map[string]any{"name": "x"}),
		mutation(t, "budget", SyncOpCreate, uuid.NewString(), map[string]any{}),
		// A valid mutation after failures still goes through.
		mutation(t, models.SyncEntityArea, SyncOpCreate, uuid.NewString(), map[string]any{"name": "Hogar"}),
	)
	for _, res := range results[:5] {
		wantStatus(t, res, SyncStatusError)
	}
	wantStatus(t, results[5], SyncStatusApplied)

	var txns, expenses int64
	db.Model(&models.Transaction{}).Count(&txns)
	db.Model(&models.RecurringExpense{}).Count(&expenses)
	if txns != 0 || expenses != 0 {
		t.Errorf("invalid rows were stored: %d transactions, %d expenses", txns, expenses)
	}
}

func TestPushIsScopedToTheWorkspace(t *testing.T) {
	db, s := newSyncTestDB(t)
	other := models.Transaction{WorkspaceID: 2, Date: time.Now()}
	db.Create(&other)

	wantStatus(t, push(t, s, mutation(t, models.SyncEntityTransaction, SyncOpUpdate, other.ClientID, txnData("hijack", 1)))[0], SyncStatusNotFound)
	wantStatus(t, push(t, s, mutation(t, models.SyncEntityTransaction, SyncOpDelete, other.ClientID, nil))[0], SyncStatusApplied)

	var got models.Transaction
	if err := db.First(&got, other.ID).Error; err != nil || got.Description.Valid {
		t.Errorf("another workspace's row was touched: %+v (err %v)", got, err)
	}
}

func TestMarkPaidUsesTheClientTransactionAndIsIdempotent(t *testing.T) {
	db, s := newSyncTestDB(t)
	expense := models.RecurringExpense{WorkspaceID: testWorkspace, Name: "Internet", Amount: 3000, DueDay: 31}
	db.Create(&expense)

	txnID := uuid.NewString()
	pay := mutation(t, models.SyncEntityRecurringExpense, SyncOpMarkPaid, expense.ClientID, map[string]any{"month": "2026-02", "transaction_client_id": txnID})

	res := push(t, s, pay)[0]
	wantStatus(t, res, SyncStatusApplied)
	want := SyncPayment{RecurringExpenseClientID: expense.ClientID, Month: "2026-02", PaidAt: "2026-02-28", TransactionClientID: txnID}
	if res.Payment == nil || *res.Payment != want {
		t.Fatalf("payment = %+v, want %+v", res.Payment, want)
	}

	// Paying the same month again from another device keeps the first payment.
	again := mutation(t, models.SyncEntityRecurringExpense, SyncOpMarkPaid, expense.ClientID, map[string]any{"month": "2026-02", "transaction_client_id": uuid.NewString()})
	res = push(t, s, again)[0]
	wantStatus(t, res, SyncStatusApplied)
	if res.Payment == nil || res.Payment.TransactionClientID != txnID {
		t.Errorf("second payment = %+v, want the original transaction %s", res.Payment, txnID)
	}

	var txns int64
	db.Model(&models.Transaction{}).Count(&txns)
	if txns != 1 {
		t.Errorf("got %d transactions, want 1", txns)
	}
}

func TestPullReturnsChangesSinceCursor(t *testing.T) {
	db, s := newSyncTestDB(t)
	area := models.Area{WorkspaceID: testWorkspace, Name: "Hogar"}
	db.Create(&area)
	cat := models.Category{WorkspaceID: testWorkspace, Name: "Luz", AreaID: &area.ID}
	db.Create(&cat)
	old := models.Transaction{WorkspaceID: testWorkspace, Date: time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC), AreaID: &area.ID}
	db.Create(&old)
	db.Create(&models.Transaction{WorkspaceID: 2, Date: time.Now()}) // another workspace
	db.Create(&models.ExchangeRate{WorkspaceID: testWorkspace, Month: "2026-03", Rate: 1200})

	first, err := s.Pull(testWorkspace, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Areas) != 1 || len(first.Categories) != 1 || len(first.Transactions) != 1 || len(first.ExchangeRates) != 1 {
		t.Fatalf("first pull: %d areas, %d categories, %d transactions, %d rates", len(first.Areas), len(first.Categories), len(first.Transactions), len(first.ExchangeRates))
	}
	if got := first.Categories[0].AreaClientID; got == nil || *got != area.ClientID {
		t.Errorf("category area_client_id = %v, want %s", got, area.ClientID)
	}
	if got := first.Transactions[0]; got.Date != "2026-03-05" || got.AreaClientID == nil || *got.AreaClientID != area.ClientID {
		t.Errorf("unexpected transaction: %+v", got)
	}
	if first.HasMore {
		t.Error("has_more on a complete pull")
	}

	// Step past the cursor overlap, then change one row and delete another.
	future := time.Now().Add(time.Minute)
	cursor := syncCursor{since: future}.String()
	db.Model(&models.Area{}).Where("id = ?", area.ID).UpdateColumns(map[string]any{"name": "Casa", "updated_at": future.Add(time.Second)})
	if err := NewTransactionService(db).Delete(old.ID, testWorkspace); err != nil {
		t.Fatal(err)
	}
	db.Model(&models.SyncTombstone{}).Where("1 = 1").UpdateColumn("created_at", future.Add(time.Second))

	second, err := s.Pull(testWorkspace, cursor, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Areas) != 1 || second.Areas[0].Name != "Casa" {
		t.Errorf("second pull areas = %+v", second.Areas)
	}
	if len(second.Categories) != 0 || len(second.Transactions) != 0 {
		t.Errorf("unchanged rows were returned: %d categories, %d transactions", len(second.Categories), len(second.Transactions))
	}
	if len(second.Deleted) != 1 || second.Deleted[0].Entity != models.SyncEntityTransaction || second.Deleted[0].Ref != old.ClientID {
		t.Errorf("deleted = %+v", second.Deleted)
	}
}

func TestPullPagesTransactions(t *testing.T) {
	db, s := newSyncTestDB(t)
	// Identical timestamps force the pager to rely on the id tiebreak.
	at := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		row := models.Transaction{WorkspaceID: testWorkspace, Date: at}
		db.Create(&row)
		db.Model(&models.Transaction{}).Where("id = ?", row.ID).UpdateColumn("updated_at", at)
	}

	seen := map[string]bool{}
	cursor, pages := "", 0
	for {
		page, err := s.Pull(testWorkspace, cursor, 2)
		if err != nil {
			t.Fatal(err)
		}
		pages++
		for _, txn := range page.Transactions {
			if seen[txn.ClientID] {
				t.Errorf("transaction %s delivered twice", txn.ClientID)
			}
			seen[txn.ClientID] = true
		}
		cursor = page.Cursor
		if !page.HasMore {
			break
		}
		if pages > 10 {
			t.Fatal("pager does not terminate")
		}
	}
	if len(seen) != 5 || pages != 3 {
		t.Errorf("got %d transactions in %d pages, want 5 in 3", len(seen), pages)
	}
}

func TestDeletingAnAreaDetachesItsRows(t *testing.T) {
	db, _ := newSyncTestDB(t)
	area := models.Area{WorkspaceID: testWorkspace, Name: "Hogar"}
	db.Create(&area)
	cat := models.Category{WorkspaceID: testWorkspace, Name: "Luz", AreaID: &area.ID}
	db.Create(&cat)

	if err := NewAreaService(db).Delete(area.ID, testWorkspace); err != nil {
		t.Fatal(err)
	}
	db.First(&cat, cat.ID)
	if cat.AreaID != nil {
		t.Errorf("category still points at the deleted area: %v", *cat.AreaID)
	}
	var tombstones []models.SyncTombstone
	db.Find(&tombstones)
	if len(tombstones) != 1 || tombstones[0].Ref != area.ClientID || tombstones[0].Entity != models.SyncEntityArea {
		t.Errorf("tombstones = %+v", tombstones)
	}
}

func TestBackfillSyncColumns(t *testing.T) {
	db, _ := newSyncTestDB(t)
	db.Create(&models.Area{WorkspaceID: testWorkspace, Name: "a"})
	db.Create(&models.Area{WorkspaceID: testWorkspace, Name: "b"})
	db.Exec("UPDATE areas SET client_id = NULL")

	if err := BackfillSyncColumns(db); err != nil {
		t.Fatal(err)
	}
	var areas []models.Area
	db.Find(&areas)
	if areas[0].ClientID == "" || areas[1].ClientID == "" || areas[0].ClientID == areas[1].ClientID {
		t.Errorf("client ids not backfilled: %q %q", areas[0].ClientID, areas[1].ClientID)
	}
}
