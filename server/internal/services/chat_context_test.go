package services

import (
	"strings"
	"testing"
	"time"
)

func TestTruncateTitle(t *testing.T) {
	tests := []struct {
		name string
		in   string
		max  int
		want string
	}{
		{"empty falls back to default", "   ", 60, DefaultChatTitle},
		{"short is kept", "How much did I spend?", 60, "How much did I spend?"},
		{"whitespace collapsed", "  ¿Cuánto   gasté\n en\tsuper? ", 60, "¿Cuánto gasté en super?"},
		{"exact length kept", "abcde", 5, "abcde"},
		{"cut at word boundary", "Give me tips to reduce restaurant spending", 20, "Give me tips to…"},
		{"no good boundary cuts runes", "Supercalifragilistic", 10, "Supercali…"},
		{"multibyte safe", "ñañañañañañaña", 6, "ñañañ…"},
		{"trailing punctuation trimmed", "Hola, quiero ahorrar más dinero", 8, "Hola…"},
		{"non-positive max keeps all", "anything goes here", 0, "anything goes here"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := TruncateTitle(tt.in, tt.max); got != tt.want {
				t.Errorf("TruncateTitle(%q, %d) = %q, want %q", tt.in, tt.max, got, tt.want)
			}
		})
	}
}

func TestFormatAmount(t *testing.T) {
	tests := []struct {
		in   float64
		want string
	}{
		{0, "0"},
		{999.4, "999"},
		{999.5, "1,000"},
		{1234567.89, "1,234,568"},
		{-1234567, "-1,234,567"},
		{100000, "100,000"},
	}
	for _, tt := range tests {
		if got := FormatAmount(tt.in); got != tt.want {
			t.Errorf("FormatAmount(%v) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestTrimHistory(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		max  int
		want []int
	}{
		{"under limit", []int{1, 2}, 5, []int{1, 2}},
		{"over limit keeps tail", []int{1, 2, 3, 4, 5}, 2, []int{4, 5}},
		{"zero keeps all", []int{1, 2, 3}, 0, []int{1, 2, 3}},
		{"nil", nil, 3, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TrimHistory(tt.in, tt.max)
			if len(got) != len(tt.want) {
				t.Fatalf("len = %d, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("got %v, want %v", got, tt.want)
				}
			}
		})
	}
}

func TestFormatChatContext(t *testing.T) {
	full := ChatContextData{
		WorkspaceName: "Casa",
		Today:         time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC),
		Months: []ChatMonthContext{
			{
				Month: "2026-10", Spending: 500000, Income: 800000,
				Areas: []NamedAmount{{"Hogar", 100000}, {"Comida", 300000}},
				Categories: []NamedAmount{
					{"A", 1}, {"B", 2}, {"C", 3}, {"D", 4}, {"E", 5}, {"F", 6},
					{"G", 7}, {"H", 8}, {"I", 9}, {"J", 10}, {"K", 11}, {"", 0.4},
				},
			},
		},
		Recurring:     []ChatRecurringContext{{Name: "Netflix", Amount: 9999, DueDay: 5, Category: "Streaming", Paid: true}},
		ExchangeRates: []NamedAmount{{"2026-10", 1450}},
		Transactions: []ChatTransactionContext{{
			ID: 42, Date: time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC), Type: "debit", Amount: 12345.6,
			Category: "Supermercado", Description: "COTO   SUC 123\nCABA",
		}},
	}

	tests := []struct {
		name        string
		data        ChatContextData
		contains    []string
		notContains []string
	}{
		{
			name: "full data",
			data: full,
			contains: []string{
				`for workspace "Casa"`,
				"Today: 2026-11-06",
				"- 2026-10: spending 500,000, income 800,000, net 300,000",
				"- 2026-10: Comida 300,000; Hogar 100,000", // areas sorted desc
				"K 11; J 10", // categories sorted desc
				"- Netflix: 9,999, due day 5, paid, category Streaming",
				"2026-10=1,450",
				"Latest 1 transactions",
				"#42 | 2026-11-02 | debit | 12,346 | Supermercado | - | COTO SUC 123 CABA",
			},
			notContains: []string{"A 1", "Uncategorized"}, // only top 10 categories
		},
		{
			name:        "empty data",
			data:        ChatContextData{},
			contains:    []string{"Monthly totals (ARS)\nNo data.", "None configured.", "None recorded.", "Latest 0 transactions", "None."},
			notContains: []string{"Today:", "for workspace"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatChatContext(tt.data)
			for _, want := range tt.contains {
				if !strings.Contains(got, want) {
					t.Errorf("context missing %q\n---\n%s", want, got)
				}
			}
			for _, bad := range tt.notContains {
				if strings.Contains(got, bad) {
					t.Errorf("context unexpectedly contains %q\n---\n%s", bad, got)
				}
			}
		})
	}
}
