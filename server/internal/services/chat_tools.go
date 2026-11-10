package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"etl-banks-ar/internal/models"
	openAiService "etl-banks-ar/internal/openai"

	"gorm.io/gorm"
)

const (
	toolSearchTransactions = "search_transactions"
	toolGetTransaction     = "get_transaction"
	toolCreateTransaction  = "create_transaction"
	toolUpdateTransactions = "update_transactions"
	toolListCategories     = "list_categories"

	searchDefaultLimit      = 50
	searchMaxLimit          = 200
	searchMaxDescriptionAny = 20
	updateMaxIDs            = 500
	uncategorizedKeyword    = "uncategorized"
)

// ---------------------------------------------------------------------------
// Tool definitions (JSON schema)
// ---------------------------------------------------------------------------

func chatToolDefinitions() []openAiService.ToolDefinition {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	num := func(desc string) map[string]any { return map[string]any{"type": "number", "description": desc} }
	typeEnum := map[string]any{"type": "string", "enum": []string{"debit", "credit"}, "description": "debit = spending/outflow, credit = income/inflow"}

	return []openAiService.ToolDefinition{
		{
			Name: toolSearchTransactions,
			Description: "Search this workspace's transactions. All filters are optional and combined with AND. " +
				"Returns total_matches and sum_amount over ALL matches, plus up to `limit` rows (newest first). " +
				"Use it before updating transactions to collect their ids.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"date_from": str("Inclusive start date YYYY-MM-DD"),
					"date_to":   str("Inclusive end date YYYY-MM-DD"),
					"type":      typeEnum,
					"category":  str(`Exact category name, or "uncategorized" for transactions without a category (empty or "Missing")`),
					"description_contains": map[string]any{
						"description": "Case-insensitive substring of the description. A list matches if ANY term matches (OR).",
						"anyOf": []any{
							map[string]any{"type": "string"},
							map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
						},
					},
					"owner":      str("Exact owner name (case-insensitive)"),
					"amount_min": num("Minimum amount (inclusive), in ARS as stored"),
					"amount_max": num("Maximum amount (inclusive), in ARS as stored"),
					"limit":      map[string]any{"type": "integer", "description": fmt.Sprintf("Rows to return, default %d, max %d", searchDefaultLimit, searchMaxLimit)},
				},
				"additionalProperties": false,
			},
		},
		{
			Name:        toolGetTransaction,
			Description: "Get a single transaction of this workspace by id.",
			Parameters: map[string]any{
				"type":                 "object",
				"properties":           map[string]any{"id": map[string]any{"type": "integer"}},
				"required":             []string{"id"},
				"additionalProperties": false,
			},
		},
		{
			Name:        toolCreateTransaction,
			Description: "Create a new transaction in this workspace. Amount is a positive number in ARS.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"date":        str("YYYY-MM-DD"),
					"description": str("Merchant or concept"),
					"amount":      num("Positive amount in ARS"),
					"type":        typeEnum,
					"category":    str("Category name; prefer an existing one from list_categories"),
					"owner":       str("Who made the transaction; defaults to the current user"),
				},
				"required":             []string{"date", "description", "amount", "type"},
				"additionalProperties": false,
			},
		},
		{
			Name: toolUpdateTransactions,
			Description: fmt.Sprintf("Bulk-update transactions of this workspace by id (max %d ids per call). "+
				"Only fields present in `set` are changed. Use ids obtained from search_transactions.", updateMaxIDs),
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"ids": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "description": "Transaction ids to update"},
					"set": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"category":       str(`Category name. Empty string clears the category.`),
							"type":           typeEnum,
							"owner":          str("Owner name"),
							"description":    str("New description"),
							"date":           str("YYYY-MM-DD"),
							"amount":         num("New positive amount in ARS"),
							"user_confirmed": map[string]any{"type": "boolean", "description": "Mark the categorization as reviewed by the user"},
						},
						"additionalProperties": false,
					},
				},
				"required":             []string{"ids", "set"},
				"additionalProperties": false,
			},
		},
		{
			Name:        toolListCategories,
			Description: "List the workspace's categories with their area, plus category names used by transactions.",
			Parameters:  map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
		},
	}
}

// ---------------------------------------------------------------------------
// Argument parsing & validation (pure)
// ---------------------------------------------------------------------------

// StringOrList accepts either a JSON string or an array of strings.
type StringOrList []string

func (s *StringOrList) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "null" {
		*s = nil
		return nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var list []string
		if err := json.Unmarshal(data, &list); err != nil {
			return errors.New("description_contains must be a string or a list of strings")
		}
		*s = list
		return nil
	}
	var one string
	if err := json.Unmarshal(data, &one); err != nil {
		return errors.New("description_contains must be a string or a list of strings")
	}
	*s = []string{one}
	return nil
}

type SearchTransactionsArgs struct {
	DateFrom            string       `json:"date_from"`
	DateTo              string       `json:"date_to"`
	Type                string       `json:"type"`
	Category            string       `json:"category"`
	DescriptionContains StringOrList `json:"description_contains"`
	Owner               string       `json:"owner"`
	AmountMin           *float64     `json:"amount_min"`
	AmountMax           *float64     `json:"amount_max"`
	Limit               int          `json:"limit"`
}

func decodeArgs(raw string, dst any) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "{}"
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid arguments: %v", err)
	}
	return nil
}

func parseDateArg(field, value string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be a date in YYYY-MM-DD format", field)
	}
	return t, nil
}

func normalizeType(field, value string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(value))
	if v != "debit" && v != "credit" {
		return "", fmt.Errorf(`%s must be "debit" or "credit"`, field)
	}
	return v, nil
}

// ParseSearchArgs decodes and validates search_transactions arguments.
func ParseSearchArgs(raw string) (SearchTransactionsArgs, error) {
	var a SearchTransactionsArgs
	if err := decodeArgs(raw, &a); err != nil {
		return a, err
	}
	a.DateFrom = strings.TrimSpace(a.DateFrom)
	a.DateTo = strings.TrimSpace(a.DateTo)
	var from, to time.Time
	var err error
	if a.DateFrom != "" {
		if from, err = parseDateArg("date_from", a.DateFrom); err != nil {
			return a, err
		}
	}
	if a.DateTo != "" {
		if to, err = parseDateArg("date_to", a.DateTo); err != nil {
			return a, err
		}
	}
	if !from.IsZero() && !to.IsZero() && to.Before(from) {
		return a, errors.New("date_to must not be before date_from")
	}
	if strings.TrimSpace(a.Type) != "" {
		if a.Type, err = normalizeType("type", a.Type); err != nil {
			return a, err
		}
	} else {
		a.Type = ""
	}
	a.Category = strings.TrimSpace(a.Category)
	a.Owner = strings.TrimSpace(a.Owner)

	terms := make([]string, 0, len(a.DescriptionContains))
	for _, t := range a.DescriptionContains {
		if t = strings.TrimSpace(t); t != "" {
			terms = append(terms, t)
		}
	}
	if len(terms) > searchMaxDescriptionAny {
		return a, fmt.Errorf("description_contains accepts at most %d terms", searchMaxDescriptionAny)
	}
	a.DescriptionContains = terms

	if a.AmountMin != nil && a.AmountMax != nil && *a.AmountMin > *a.AmountMax {
		return a, errors.New("amount_min must not be greater than amount_max")
	}
	switch {
	case a.Limit <= 0:
		a.Limit = searchDefaultLimit
	case a.Limit > searchMaxLimit:
		a.Limit = searchMaxLimit
	}
	return a, nil
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// BuildSearchFilter turns validated search args into a WHERE clause and its
// parameters. The workspace condition always comes first and is taken from
// the server-side conversation, never from model input.
func BuildSearchFilter(workspaceID uint, a SearchTransactionsArgs) (string, []any) {
	clauses := []string{"workspace_id = ?"}
	params := []any{workspaceID}

	if a.DateFrom != "" {
		if t, err := time.Parse("2006-01-02", a.DateFrom); err == nil {
			clauses = append(clauses, "date >= ?")
			params = append(params, t)
		}
	}
	if a.DateTo != "" {
		if t, err := time.Parse("2006-01-02", a.DateTo); err == nil {
			clauses = append(clauses, "date < ?")
			params = append(params, t.AddDate(0, 0, 1))
		}
	}
	if a.Type != "" {
		clauses = append(clauses, "type = ?")
		params = append(params, a.Type)
	}
	if a.Category != "" {
		if strings.EqualFold(a.Category, uncategorizedKeyword) {
			clauses = append(clauses, "(category IS NULL OR category = '' OR category = ?)")
			params = append(params, models.MissingCategoryName)
		} else {
			clauses = append(clauses, "category = ?")
			params = append(params, a.Category)
		}
	}
	if len(a.DescriptionContains) > 0 {
		ors := make([]string, len(a.DescriptionContains))
		for i, term := range a.DescriptionContains {
			ors[i] = "LOWER(description) LIKE ?"
			params = append(params, "%"+escapeLike(strings.ToLower(term))+"%")
		}
		clauses = append(clauses, "("+strings.Join(ors, " OR ")+")")
	}
	if a.Owner != "" {
		clauses = append(clauses, "LOWER(owner) = ?")
		params = append(params, strings.ToLower(a.Owner))
	}
	if a.AmountMin != nil {
		clauses = append(clauses, "amount >= ?")
		params = append(params, *a.AmountMin)
	}
	if a.AmountMax != nil {
		clauses = append(clauses, "amount <= ?")
		params = append(params, *a.AmountMax)
	}
	return strings.Join(clauses, " AND "), params
}

type GetTransactionArgs struct {
	ID uint `json:"id"`
}

func ParseGetTransactionArgs(raw string) (GetTransactionArgs, error) {
	var a GetTransactionArgs
	if err := decodeArgs(raw, &a); err != nil {
		return a, err
	}
	if a.ID == 0 {
		return a, errors.New("id is required")
	}
	return a, nil
}

type CreateTransactionArgs struct {
	Date        string   `json:"date"`
	Description string   `json:"description"`
	Amount      *float64 `json:"amount"`
	Type        string   `json:"type"`
	Category    string   `json:"category"`
	Owner       string   `json:"owner"`

	parsedDate time.Time
}

func ParseCreateTransactionArgs(raw string) (CreateTransactionArgs, error) {
	var a CreateTransactionArgs
	if err := decodeArgs(raw, &a); err != nil {
		return a, err
	}
	var err error
	if a.parsedDate, err = parseDateArg("date", a.Date); err != nil {
		return a, err
	}
	a.Description = strings.TrimSpace(a.Description)
	if a.Description == "" {
		return a, errors.New("description is required")
	}
	if a.Amount == nil || *a.Amount <= 0 {
		return a, errors.New("amount is required and must be a positive number")
	}
	if a.Type, err = normalizeType("type", a.Type); err != nil {
		return a, err
	}
	a.Category = strings.TrimSpace(a.Category)
	a.Owner = strings.TrimSpace(a.Owner)
	return a, nil
}

type TransactionFieldsArgs struct {
	Category      *string  `json:"category"`
	Type          *string  `json:"type"`
	Owner         *string  `json:"owner"`
	Description   *string  `json:"description"`
	Date          *string  `json:"date"`
	Amount        *float64 `json:"amount"`
	UserConfirmed *bool    `json:"user_confirmed"`
}

type UpdateTransactionsArgs struct {
	IDs []uint                `json:"ids"`
	Set TransactionFieldsArgs `json:"set"`
}

// ParseUpdateTransactionsArgs validates update_transactions arguments and
// returns the de-duplicated ids together with the column updates to apply
// and a human/JSON-friendly view of the changes.
func ParseUpdateTransactionsArgs(raw string) (ids []uint, columns map[string]any, changes map[string]any, err error) {
	var a UpdateTransactionsArgs
	if err = decodeArgs(raw, &a); err != nil {
		return nil, nil, nil, err
	}
	seen := make(map[uint]bool, len(a.IDs))
	for _, id := range a.IDs {
		if id == 0 {
			return nil, nil, nil, errors.New("ids must be positive integers")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil, nil, errors.New("ids must contain at least one transaction id")
	}
	if len(ids) > updateMaxIDs {
		return nil, nil, nil, fmt.Errorf("at most %d ids per call; split the update into several calls", updateMaxIDs)
	}

	columns = map[string]any{}
	changes = map[string]any{}
	s := a.Set
	if s.Category != nil {
		c := strings.TrimSpace(*s.Category)
		if c == "" || strings.EqualFold(c, uncategorizedKeyword) {
			columns["category"] = sql.NullString{}
			changes["category"] = ""
		} else {
			columns["category"] = c
			changes["category"] = c
		}
	}
	if s.Type != nil {
		t, err := normalizeType("set.type", *s.Type)
		if err != nil {
			return nil, nil, nil, err
		}
		columns["type"] = t
		changes["type"] = t
	}
	if s.Owner != nil {
		o := strings.TrimSpace(*s.Owner)
		if o == "" {
			columns["owner"] = sql.NullString{}
		} else {
			columns["owner"] = o
		}
		changes["owner"] = o
	}
	if s.Description != nil {
		d := strings.TrimSpace(*s.Description)
		if d == "" {
			return nil, nil, nil, errors.New("set.description must not be empty")
		}
		columns["description"] = d
		changes["description"] = d
	}
	if s.Date != nil {
		t, err := parseDateArg("set.date", *s.Date)
		if err != nil {
			return nil, nil, nil, err
		}
		columns["date"] = t
		changes["date"] = t.Format("2006-01-02")
	}
	if s.Amount != nil {
		if *s.Amount <= 0 {
			return nil, nil, nil, errors.New("set.amount must be a positive number")
		}
		columns["amount"] = *s.Amount
		changes["amount"] = *s.Amount
	}
	if s.UserConfirmed != nil {
		columns["user_confirmed"] = *s.UserConfirmed
		changes["user_confirmed"] = *s.UserConfirmed
	}
	if len(columns) == 0 {
		return nil, nil, nil, errors.New("set must contain at least one field to change")
	}
	return ids, columns, changes, nil
}

// SummarizeUpdate renders e.g. `Updated 34 transactions → category: Supermercado`.
func SummarizeUpdate(count int, changes map[string]any) string {
	keys := make([]string, 0, len(changes))
	for k := range changes {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		v := changes[k]
		if s, ok := v.(string); ok && s == "" {
			v = "(empty)"
		}
		if f, ok := v.(float64); ok {
			v = FormatAmount(f)
		}
		parts = append(parts, fmt.Sprintf("%s: %v", k, v))
	}
	noun := "transactions"
	if count == 1 {
		noun = "transaction"
	}
	return fmt.Sprintf("Updated %d %s → %s", count, noun, strings.Join(parts, ", "))
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

type toolTransaction struct {
	ID            uint    `json:"id"`
	Date          string  `json:"date"`
	Description   string  `json:"description"`
	Amount        float64 `json:"amount"`
	Type          string  `json:"type"`
	Category      string  `json:"category"`
	Owner         string  `json:"owner"`
	UserConfirmed bool    `json:"user_confirmed"`
}

func toToolTransaction(t models.Transaction) toolTransaction {
	return toolTransaction{
		ID:            t.ID,
		Date:          t.Date.Format("2006-01-02"),
		Description:   t.Description.String,
		Amount:        t.Amount.Float64,
		Type:          t.Type.String,
		Category:      t.Category.String,
		Owner:         t.Owner.String,
		UserConfirmed: t.UserConfirmed,
	}
}

// chatToolExecutor runs tool calls for one assistant turn. workspaceID and
// userID come from the authenticated request, never from the model.
type chatToolExecutor struct {
	s           *ChatService
	workspaceID uint
	userID      uint
	actions     models.ChatActions
}

// Execute runs a tool call and returns a JSON string for the model. Errors are
// returned to the model as {"error": "..."} instead of failing the request.
func (e *chatToolExecutor) Execute(call openAiService.ToolCall) string {
	var (
		result any
		err    error
	)
	switch call.Name {
	case toolSearchTransactions:
		result, err = e.search(call.Arguments)
	case toolGetTransaction:
		result, err = e.get(call.Arguments)
	case toolCreateTransaction:
		result, err = e.create(call.Arguments)
	case toolUpdateTransactions:
		result, err = e.update(call.Arguments)
	case toolListCategories:
		result, err = e.listCategories()
	default:
		err = fmt.Errorf("unknown tool %q", call.Name)
	}
	if err != nil {
		result = map[string]string{"error": err.Error()}
	}
	b, mErr := json.Marshal(result)
	if mErr != nil {
		return `{"error":"failed to encode tool result"}`
	}
	return string(b)
}

func (e *chatToolExecutor) search(raw string) (any, error) {
	args, err := ParseSearchArgs(raw)
	if err != nil {
		return nil, err
	}
	where, params := BuildSearchFilter(e.workspaceID, args)
	q := func() *gorm.DB { return e.s.db.Model(&models.Transaction{}).Where(where, params...) }

	var total int64
	if err := q().Count(&total).Error; err != nil {
		return nil, fmt.Errorf("search failed")
	}
	var sum sql.NullFloat64
	if err := q().Select("COALESCE(SUM(amount), 0)").Scan(&sum).Error; err != nil {
		return nil, fmt.Errorf("search failed")
	}
	var txns []models.Transaction
	if err := q().Order("date DESC, id DESC").Limit(args.Limit).Find(&txns).Error; err != nil {
		return nil, fmt.Errorf("search failed")
	}
	rows := make([]toolTransaction, len(txns))
	for i, t := range txns {
		rows[i] = toToolTransaction(t)
	}
	return map[string]any{
		"total_matches": total,
		"sum_amount":    sum.Float64,
		"returned":      len(rows),
		"truncated":     int64(len(rows)) < total,
		"transactions":  rows,
	}, nil
}

func (e *chatToolExecutor) get(raw string) (any, error) {
	args, err := ParseGetTransactionArgs(raw)
	if err != nil {
		return nil, err
	}
	t, err := e.s.transactions.FindByID(args.ID, e.workspaceID)
	if err != nil {
		return nil, fmt.Errorf("transaction %d not found in this workspace", args.ID)
	}
	return map[string]any{"transaction": toToolTransaction(*t)}, nil
}

// ensureCategory makes sure a category row exists so the name shows up in
// the Areas/Categories UI. Returns true when a new category was created.
func (e *chatToolExecutor) ensureCategory(name string) (bool, error) {
	if name == "" {
		return false, nil
	}
	if _, err := e.s.categories.FindByName(name, e.workspaceID); err == nil {
		return false, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	if err := e.s.categories.Create(&models.Category{WorkspaceID: e.workspaceID, Name: name}); err != nil {
		return false, err
	}
	return true, nil
}

func (e *chatToolExecutor) create(raw string) (any, error) {
	args, err := ParseCreateTransactionArgs(raw)
	if err != nil {
		return nil, err
	}
	createdCategory, err := e.ensureCategory(args.Category)
	if err != nil {
		return nil, fmt.Errorf("could not prepare category %q", args.Category)
	}
	owner := args.Owner
	if owner == "" {
		owner = e.s.transactions.UserName(e.userID)
	}
	t := &models.Transaction{
		WorkspaceID: e.workspaceID,
		Date:        args.parsedDate,
		Description: sql.NullString{String: args.Description, Valid: true},
		Amount:      sql.NullFloat64{Float64: *args.Amount, Valid: true},
		Type:        sql.NullString{String: args.Type, Valid: true},
		Category:    sql.NullString{String: args.Category, Valid: args.Category != ""},
		Owner:       sql.NullString{String: owner, Valid: owner != ""},
	}
	if err := e.s.transactions.Create(t); err != nil {
		return nil, fmt.Errorf("failed to create transaction")
	}

	summary := fmt.Sprintf("Created transaction #%d: %s, %s ARS (%s)", t.ID, args.Description, FormatAmount(*args.Amount), args.Type)
	if args.Category != "" {
		summary += ", category " + args.Category
	}
	if createdCategory {
		summary += " (new category)"
	}
	e.actions = append(e.actions, models.ChatAction{
		Tool:    toolCreateTransaction,
		Summary: summary,
		Count:   1,
		IDs:     []uint{t.ID},
		Changes: map[string]any{"date": args.Date, "description": args.Description, "amount": *args.Amount, "type": args.Type, "category": args.Category, "owner": owner},
	})
	return map[string]any{"created": toToolTransaction(*t), "created_category": createdCategory}, nil
}

func (e *chatToolExecutor) update(raw string) (any, error) {
	ids, columns, changes, err := ParseUpdateTransactionsArgs(raw)
	if err != nil {
		return nil, err
	}

	var found []uint
	if err := e.s.db.Model(&models.Transaction{}).
		Where("workspace_id = ? AND id IN ?", e.workspaceID, ids).
		Pluck("id", &found).Error; err != nil {
		return nil, fmt.Errorf("failed to look up transactions")
	}
	foundSet := make(map[uint]bool, len(found))
	for _, id := range found {
		foundSet[id] = true
	}
	var missing []uint
	for _, id := range ids {
		if !foundSet[id] {
			missing = append(missing, id)
		}
	}
	if len(found) == 0 {
		return nil, errors.New("none of the given ids belong to this workspace")
	}

	createdCategory := false
	if c, ok := columns["category"].(string); ok {
		if createdCategory, err = e.ensureCategory(c); err != nil {
			return nil, fmt.Errorf("could not prepare category %q", c)
		}
	}

	columns["updated_at"] = time.Now()
	if err := e.s.db.Model(&models.Transaction{}).
		Where("workspace_id = ? AND id IN ?", e.workspaceID, found).
		Updates(columns).Error; err != nil {
		return nil, fmt.Errorf("failed to update transactions")
	}

	summary := SummarizeUpdate(len(found), changes)
	if createdCategory {
		summary += " (new category)"
	}
	sort.Slice(found, func(i, j int) bool { return found[i] < found[j] })
	e.actions = append(e.actions, models.ChatAction{
		Tool:    toolUpdateTransactions,
		Summary: summary,
		Count:   len(found),
		IDs:     found,
		Changes: changes,
	})
	return map[string]any{
		"updated_count":    len(found),
		"not_found_ids":    missing,
		"changes":          changes,
		"created_category": createdCategory,
	}, nil
}

func (e *chatToolExecutor) listCategories() (any, error) {
	cats, err := e.s.categories.List(e.workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to list categories")
	}
	type item struct {
		Name string `json:"name"`
		Area string `json:"area,omitempty"`
	}
	known := make(map[string]bool, len(cats))
	items := make([]item, 0, len(cats))
	for _, c := range cats {
		it := item{Name: c.Name}
		if c.Area != nil {
			it.Area = c.Area.Name
		}
		known[c.Name] = true
		items = append(items, it)
	}
	used, _ := e.s.transactions.GetCategories(e.workspaceID)
	var extra []string
	for _, name := range used {
		if name != "" && !known[name] {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	return map[string]any{"categories": items, "used_in_transactions_without_category_row": extra}, nil
}
