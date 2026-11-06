package services

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"etl-banks-ar/internal/models"
	openAiService "etl-banks-ar/internal/openai"
)

func fp(v float64) *float64 { return &v }

func TestParseSearchArgs(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    SearchTransactionsArgs
		wantErr string
	}{
		{"empty uses defaults", "", SearchTransactionsArgs{Limit: searchDefaultLimit, DescriptionContains: StringOrList{}}, ""},
		{"single description string", `{"description_contains":"  uber "}`, SearchTransactionsArgs{Limit: 50, DescriptionContains: StringOrList{"uber"}}, ""},
		{"description list drops blanks", `{"description_contains":["uber"," ","cabify"]}`, SearchTransactionsArgs{Limit: 50, DescriptionContains: StringOrList{"uber", "cabify"}}, ""},
		{"type normalized", `{"type":"DEBIT"}`, SearchTransactionsArgs{Type: "debit", Limit: 50, DescriptionContains: StringOrList{}}, ""},
		{"limit clamped", `{"limit":5000}`, SearchTransactionsArgs{Limit: searchMaxLimit, DescriptionContains: StringOrList{}}, ""},
		{"negative limit -> default", `{"limit":-3}`, SearchTransactionsArgs{Limit: searchDefaultLimit, DescriptionContains: StringOrList{}}, ""},
		{"dates + amounts", `{"date_from":"2026-01-01","date_to":"2026-01-31","amount_min":10,"amount_max":20}`,
			SearchTransactionsArgs{DateFrom: "2026-01-01", DateTo: "2026-01-31", AmountMin: fp(10), AmountMax: fp(20), Limit: 50, DescriptionContains: StringOrList{}}, ""},
		{"bad type", `{"type":"expense"}`, SearchTransactionsArgs{}, `type must be "debit" or "credit"`},
		{"bad date", `{"date_from":"01/02/2026"}`, SearchTransactionsArgs{}, "date_from must be a date"},
		{"inverted dates", `{"date_from":"2026-02-01","date_to":"2026-01-01"}`, SearchTransactionsArgs{}, "date_to must not be before"},
		{"inverted amounts", `{"amount_min":30,"amount_max":20}`, SearchTransactionsArgs{}, "amount_min must not be greater"},
		{"unknown field", `{"workspace_id":7}`, SearchTransactionsArgs{}, "invalid arguments"},
		{"bad description type", `{"description_contains":5}`, SearchTransactionsArgs{}, "description_contains must be"},
		{"malformed json", `{"type":`, SearchTransactionsArgs{}, "invalid arguments"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseSearchArgs(tt.raw)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestBuildSearchFilter(t *testing.T) {
	jan1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	feb1 := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		args       SearchTransactionsArgs
		wantWhere  string
		wantParams []any
	}{
		{"workspace only", SearchTransactionsArgs{}, "workspace_id = ?", []any{uint(7)}},
		{
			"date range inclusive end",
			SearchTransactionsArgs{DateFrom: "2026-01-01", DateTo: "2026-01-31"},
			"workspace_id = ? AND date >= ? AND date < ?",
			[]any{uint(7), jan1, feb1},
		},
		{
			"uncategorized keyword",
			SearchTransactionsArgs{Category: "Uncategorized"},
			"workspace_id = ? AND (category IS NULL OR category = '' OR category = ?)",
			[]any{uint(7), models.MissingCategoryName},
		},
		{"exact category", SearchTransactionsArgs{Category: "Supermercado"}, "workspace_id = ? AND category = ?", []any{uint(7), "Supermercado"}},
		{
			"description OR with escaping and lowercase",
			SearchTransactionsArgs{DescriptionContains: StringOrList{"MERCADOPAGO*UBER", "100%_off"}},
			"workspace_id = ? AND (LOWER(description) LIKE ? OR LOWER(description) LIKE ?)",
			[]any{uint(7), "%mercadopago*uber%", `%100\%\_off%`},
		},
		{
			"type owner amounts",
			SearchTransactionsArgs{Type: "credit", Owner: "Ana", AmountMin: fp(1), AmountMax: fp(2)},
			"workspace_id = ? AND type = ? AND LOWER(owner) = ? AND amount >= ? AND amount <= ?",
			[]any{uint(7), "credit", "ana", 1.0, 2.0},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			where, params := BuildSearchFilter(7, tt.args)
			if where != tt.wantWhere {
				t.Errorf("where = %q, want %q", where, tt.wantWhere)
			}
			if !reflect.DeepEqual(params, tt.wantParams) {
				t.Errorf("params = %#v, want %#v", params, tt.wantParams)
			}
		})
	}
}

func TestParseUpdateTransactionsArgs(t *testing.T) {
	manyIDs := "[" + strings.TrimSuffix(strings.Repeat("1,", updateMaxIDs+1), ",") + "]"
	tooMany := make([]string, updateMaxIDs+1)
	for i := range tooMany {
		tooMany[i] = strconv.Itoa(i + 1)
	}
	tests := []struct {
		name        string
		raw         string
		wantIDs     []uint
		wantColumns map[string]any
		wantChanges map[string]any
		wantErr     string
	}{
		{
			name:        "category label with dedupe",
			raw:         `{"ids":[3,1,3],"set":{"category":" Transporte "}}`,
			wantIDs:     []uint{3, 1},
			wantColumns: map[string]any{"category": "Transporte"},
			wantChanges: map[string]any{"category": "Transporte"},
		},
		{
			name:        "clear category",
			raw:         `{"ids":[1],"set":{"category":""}}`,
			wantIDs:     []uint{1},
			wantColumns: map[string]any{"category": sql.NullString{}},
			wantChanges: map[string]any{"category": ""},
		},
		{
			name:        "several fields",
			raw:         `{"ids":[5],"set":{"type":"Credit","amount":10.5,"date":"2026-03-04","user_confirmed":true}}`,
			wantIDs:     []uint{5},
			wantColumns: map[string]any{"type": "credit", "amount": 10.5, "date": time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC), "user_confirmed": true},
			wantChanges: map[string]any{"type": "credit", "amount": 10.5, "date": "2026-03-04", "user_confirmed": true},
		},
		{name: "dedupe keeps under cap", raw: `{"ids":` + manyIDs + `,"set":{"owner":"Ana"}}`, wantIDs: []uint{1},
			wantColumns: map[string]any{"owner": "Ana"}, wantChanges: map[string]any{"owner": "Ana"}},
		{name: "no ids", raw: `{"ids":[],"set":{"category":"X"}}`, wantErr: "at least one transaction id"},
		{name: "zero id", raw: `{"ids":[0],"set":{"category":"X"}}`, wantErr: "positive integers"},
		{name: "negative id", raw: `{"ids":[-1],"set":{"category":"X"}}`, wantErr: "invalid arguments"},
		{name: "too many ids", raw: `{"ids":[` + strings.Join(tooMany, ",") + `],"set":{"category":"X"}}`, wantErr: "at most 500 ids"},
		{name: "empty set", raw: `{"ids":[1],"set":{}}`, wantErr: "at least one field"},
		{name: "bad type", raw: `{"ids":[1],"set":{"type":"x"}}`, wantErr: "set.type"},
		{name: "bad date", raw: `{"ids":[1],"set":{"date":"2026-13-01"}}`, wantErr: "set.date"},
		{name: "non-positive amount", raw: `{"ids":[1],"set":{"amount":0}}`, wantErr: "set.amount"},
		{name: "empty description", raw: `{"ids":[1],"set":{"description":"  "}}`, wantErr: "set.description"},
		{name: "unknown set field", raw: `{"ids":[1],"set":{"workspace_id":2}}`, wantErr: "invalid arguments"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ids, cols, changes, err := ParseUpdateTransactionsArgs(tt.raw)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(ids, tt.wantIDs) {
				t.Errorf("ids = %v, want %v", ids, tt.wantIDs)
			}
			if !reflect.DeepEqual(cols, tt.wantColumns) {
				t.Errorf("columns = %#v, want %#v", cols, tt.wantColumns)
			}
			if !reflect.DeepEqual(changes, tt.wantChanges) {
				t.Errorf("changes = %#v, want %#v", changes, tt.wantChanges)
			}
		})
	}
}

func TestParseCreateTransactionArgs(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr string
	}{
		{"valid", `{"date":"2026-11-01","description":" Coto ","amount":1500,"type":"debit","category":"Supermercado"}`, ""},
		{"missing date", `{"description":"x","amount":1,"type":"debit"}`, "date must be"},
		{"missing description", `{"date":"2026-11-01","amount":1,"type":"debit"}`, "description is required"},
		{"missing amount", `{"date":"2026-11-01","description":"x","type":"debit"}`, "amount is required"},
		{"negative amount", `{"date":"2026-11-01","description":"x","amount":-5,"type":"debit"}`, "amount is required"},
		{"bad type", `{"date":"2026-11-01","description":"x","amount":5,"type":"gasto"}`, `type must be`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseCreateTransactionArgs(tt.raw)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Description != "Coto" || got.parsedDate.IsZero() || got.Type != "debit" {
				t.Errorf("unexpected parse result %+v", got)
			}
		})
	}
}

func TestParseGetTransactionArgs(t *testing.T) {
	tests := []struct {
		raw     string
		want    uint
		wantErr bool
	}{
		{`{"id":12}`, 12, false},
		{`{}`, 0, true},
		{`{"id":"x"}`, 0, true},
	}
	for _, tt := range tests {
		got, err := ParseGetTransactionArgs(tt.raw)
		if (err != nil) != tt.wantErr || got.ID != tt.want {
			t.Errorf("ParseGetTransactionArgs(%s) = %v, %v", tt.raw, got, err)
		}
	}
}

func TestSummarizeUpdate(t *testing.T) {
	tests := []struct {
		count   int
		changes map[string]any
		want    string
	}{
		{34, map[string]any{"category": "Supermercado"}, "Updated 34 transactions → category: Supermercado"},
		{1, map[string]any{"user_confirmed": true, "amount": 1234.5}, "Updated 1 transaction → amount: 1,235, user_confirmed: true"},
		{2, map[string]any{"category": ""}, "Updated 2 transactions → category: (empty)"},
	}
	for _, tt := range tests {
		if got := SummarizeUpdate(tt.count, tt.changes); got != tt.want {
			t.Errorf("SummarizeUpdate = %q, want %q", got, tt.want)
		}
	}
}

func TestHistoryContentAndFallback(t *testing.T) {
	actions := models.ChatActions{{Tool: toolUpdateTransactions, Summary: "Updated 3 transactions → category: Transporte", Count: 3}}
	tests := []struct {
		name string
		msg  models.ChatMessage
		want string
	}{
		{"user unchanged", models.ChatMessage{Role: "user", Content: "hola"}, "hola"},
		{"assistant without actions", models.ChatMessage{Role: "assistant", Content: "ok"}, "ok"},
		{"assistant with actions", models.ChatMessage{Role: "assistant", Content: "Listo", Actions: actions},
			"Listo\n\n[Actions performed in this turn: Updated 3 transactions → category: Transporte]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := HistoryContent(tt.msg); got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
	if got := FallbackActionsReply(actions); !strings.Contains(got, "- Updated 3 transactions") {
		t.Errorf("fallback reply missing action: %q", got)
	}
}

type scriptedCompleter struct {
	replies []openAiService.ChatMessage
	err     error
	calls   int
	tools   []int // number of tools offered per call
	prompts [][]openAiService.ChatMessage
}

func (s *scriptedCompleter) ChatCompletionWithTools(_ context.Context, msgs []openAiService.ChatMessage, tools []openAiService.ToolDefinition) (openAiService.ChatMessage, error) {
	s.tools = append(s.tools, len(tools))
	s.prompts = append(s.prompts, append([]openAiService.ChatMessage(nil), msgs...))
	if s.err != nil {
		return openAiService.ChatMessage{}, s.err
	}
	i := s.calls
	s.calls++
	if i >= len(s.replies) {
		return s.replies[len(s.replies)-1], nil
	}
	return s.replies[i], nil
}

func TestRunToolLoop(t *testing.T) {
	toolCall := openAiService.ChatMessage{Role: "assistant", ToolCalls: []openAiService.ToolCall{{ID: "c1", Name: toolSearchTransactions, Arguments: "{}"}}}
	final := openAiService.ChatMessage{Role: "assistant", Content: " done "}
	tools := chatToolDefinitions()

	tests := []struct {
		name          string
		replies       []openAiService.ChatMessage
		err           error
		wantReply     string
		wantErr       bool
		wantCalls     int
		wantExecuted  int
		wantLastTools int
	}{
		{"direct answer", []openAiService.ChatMessage{final}, nil, "done", false, 1, 0, len(tools)},
		{"one tool round", []openAiService.ChatMessage{toolCall, final}, nil, "done", false, 2, 1, len(tools)},
		{"cap forces final call without tools", []openAiService.ChatMessage{toolCall}, nil, "", false, 4, 3, 0},
		{"model error", nil, errors.New("boom"), "", true, 1, 0, len(tools)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &scriptedCompleter{replies: tt.replies, err: tt.err}
			executed := 0
			exec := func(call openAiService.ToolCall) string { executed++; return `{"ok":true}` }
			got, err := runToolLoop(context.Background(), c, []openAiService.ChatMessage{{Role: "user", Content: "hi"}}, tools, exec, 3)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v", err)
			}
			if got != tt.wantReply {
				t.Errorf("reply = %q, want %q", got, tt.wantReply)
			}
			if len(c.tools) != tt.wantCalls {
				t.Errorf("calls = %d, want %d", len(c.tools), tt.wantCalls)
			}
			if executed != tt.wantExecuted {
				t.Errorf("executed = %d, want %d", executed, tt.wantExecuted)
			}
			if c.tools[len(c.tools)-1] != tt.wantLastTools {
				t.Errorf("tools on last call = %d, want %d", c.tools[len(c.tools)-1], tt.wantLastTools)
			}
		})
	}

	// Tool results are fed back with the matching call id.
	c := &scriptedCompleter{replies: []openAiService.ChatMessage{toolCall, final}}
	_, _ = runToolLoop(context.Background(), c, nil, tools, func(openAiService.ToolCall) string { return "R" }, 3)
	second := c.prompts[1]
	if len(second) != 2 || second[0].Role != "assistant" || second[1].Role != "tool" || second[1].ToolCallID != "c1" || second[1].Content != "R" {
		t.Errorf("unexpected second prompt: %+v", second)
	}
}

func TestChatActionsValueScan(t *testing.T) {
	tests := []struct {
		name string
		in   models.ChatActions
	}{
		{"nil", nil},
		{"one", models.ChatActions{{Tool: "update_transactions", Summary: "s", Count: 2, IDs: []uint{1, 2}, Changes: map[string]any{"category": "X"}}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := tt.in.Value()
			if err != nil {
				t.Fatal(err)
			}
			var out models.ChatActions
			if err := out.Scan(v); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(out, tt.in) {
				t.Errorf("round trip = %#v, want %#v", out, tt.in)
			}
		})
	}
}
