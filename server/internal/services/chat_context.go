package services

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"etl-banks-ar/internal/models"
)

// DefaultChatTitle is used for conversations that have no user message yet.
const DefaultChatTitle = "New chat"

// chatSystemPrompt instructs the model how to behave. The workspace data
// context is appended as a separate system message.
const chatSystemPrompt = `You are a personal finance assistant inside "Tostado", an expense-tracking app. You help the members of one shared workspace understand their spending and improve their finances.

Rules:
- Ground every claim in the WORKSPACE DATA provided below. Quote concrete numbers (months, categories, areas, merchants, amounts) when relevant. If the data does not contain what is needed, say so plainly instead of inventing figures.
- All amounts are in Argentine pesos (ARS) unless stated otherwise. Monthly USD exchange rates (ARS per USD) are provided when available; use them when the user asks about dollars or when inflation makes peso comparisons misleading.
- "Spending" means debit transactions; "income" means credit transactions.
- Give concrete, actionable recommendations and tips (e.g. which category grew, which recurring expense to review, a realistic monthly target), not generic advice.
- Answer in the same language the user writes in (typically Spanish (rioplatense) or English).
- Be concise. Use short paragraphs, bullet lists and **bold** for key figures. Do not use tables or headings deeper than ###.

Tools — you can read and change this workspace's transactions:
- Use search_transactions / get_transaction to look up data beyond the summary below (the summary only lists the latest transactions).
- Before labeling, call list_categories and use an EXISTING category name (match the user's wording to the closest existing category, e.g. "transporte" -> "Transporte"). Only use a new category name when the user explicitly asks for a new category or nothing reasonable exists; say that you created it.
- Labeling/modifying "all transactions that match X": first call search_transactions with the criteria, then call update_transactions with exactly the ids returned. If truncated is true, page through with narrower filters (e.g. date ranges) until you have every id. Never update ids you did not get from a tool result, and never guess ids.
- Confirmation rule: if MORE THAN 20 transactions would change and the user has not already clearly told you to go ahead (e.g. "hacelo", "dale", "sí", "go ahead", "all of them", "sin preguntar"), DO NOT update yet. Reply with the matched count, the total amount, a sample of up to 5 matches (date, description, amount, current category) and ask for confirmation. When the user confirms, search again with the same criteria and apply. With 20 or fewer, apply directly.
- After any change, state exactly what you changed: how many transactions, the criteria used, and the fields with their new values. Only report changes that a tool result confirmed. If a tool returns an error, explain it and do not pretend it worked.
- Creating a transaction: amounts are positive numbers; use type "debit" for spending and "credit" for income; if no date is given use today's date; ask only if the amount or what it was for is missing.
- Deleting transactions is not supported; tell the user to do it from the Records page.`

// NamedAmount is a label with an ARS amount.
type NamedAmount struct {
	Name   string
	Amount float64
}

// ChatMonthContext summarises one month of activity.
type ChatMonthContext struct {
	Month      string // YYYY-MM
	Spending   float64
	Income     float64
	Areas      []NamedAmount
	Categories []NamedAmount
}

// ChatRecurringContext describes a planned/recurring expense.
type ChatRecurringContext struct {
	Name     string
	Amount   float64
	DueDay   int
	Category string
	Owner    string
	Paid     bool
}

// ChatTransactionContext is a compact view of a single transaction.
type ChatTransactionContext struct {
	ID          uint
	Date        time.Time
	Description string
	Amount      float64
	Type        string
	Category    string
	Owner       string
}

// ChatContextData is everything the model gets to know about the workspace.
type ChatContextData struct {
	WorkspaceName string
	Today         time.Time
	Months        []ChatMonthContext
	Recurring     []ChatRecurringContext
	ExchangeRates []NamedAmount // Name = YYYY-MM, Amount = ARS per USD
	Transactions  []ChatTransactionContext
}

const (
	maxContextCategoriesPerMonth = 10
	maxContextDescriptionLen     = 60
)

// FormatChatContext renders the workspace data as a compact plain-text block
// suitable for a system message.
func FormatChatContext(d ChatContextData) string {
	var b strings.Builder
	b.WriteString("WORKSPACE DATA")
	if d.WorkspaceName != "" {
		fmt.Fprintf(&b, " for workspace %q", d.WorkspaceName)
	}
	b.WriteString("\n")
	if !d.Today.IsZero() {
		fmt.Fprintf(&b, "Today: %s\n", d.Today.Format("2006-01-02"))
	}

	b.WriteString("\n## Monthly totals (ARS)\n")
	if len(d.Months) == 0 {
		b.WriteString("No data.\n")
	}
	for _, m := range d.Months {
		fmt.Fprintf(&b, "- %s: spending %s, income %s, net %s\n",
			m.Month, FormatAmount(m.Spending), FormatAmount(m.Income), FormatAmount(m.Income-m.Spending))
	}

	b.WriteString("\n## Spending by area per month (ARS)\n")
	wroteAny := false
	for _, m := range d.Months {
		if len(m.Areas) == 0 {
			continue
		}
		wroteAny = true
		fmt.Fprintf(&b, "- %s: %s\n", m.Month, joinNamedAmounts(sortedByAmount(m.Areas), 0))
	}
	if !wroteAny {
		b.WriteString("No data.\n")
	}

	fmt.Fprintf(&b, "\n## Top %d spending categories per month (ARS)\n", maxContextCategoriesPerMonth)
	wroteAny = false
	for _, m := range d.Months {
		if len(m.Categories) == 0 {
			continue
		}
		wroteAny = true
		fmt.Fprintf(&b, "- %s: %s\n", m.Month, joinNamedAmounts(sortedByAmount(m.Categories), maxContextCategoriesPerMonth))
	}
	if !wroteAny {
		b.WriteString("No data.\n")
	}

	b.WriteString("\n## Recurring / planned expenses (this month)\n")
	if len(d.Recurring) == 0 {
		b.WriteString("None configured.\n")
	}
	for _, r := range d.Recurring {
		status := "pending"
		if r.Paid {
			status = "paid"
		}
		fmt.Fprintf(&b, "- %s: %s, due day %d, %s", r.Name, FormatAmount(r.Amount), r.DueDay, status)
		if r.Category != "" {
			fmt.Fprintf(&b, ", category %s", r.Category)
		}
		if r.Owner != "" {
			fmt.Fprintf(&b, ", owner %s", r.Owner)
		}
		b.WriteString("\n")
	}

	b.WriteString("\n## USD exchange rates (ARS per USD)\n")
	if len(d.ExchangeRates) == 0 {
		b.WriteString("None recorded.\n")
	} else {
		parts := make([]string, 0, len(d.ExchangeRates))
		for _, r := range d.ExchangeRates {
			parts = append(parts, fmt.Sprintf("%s=%s", r.Name, FormatAmount(r.Amount)))
		}
		b.WriteString(strings.Join(parts, ", "))
		b.WriteString("\n")
	}

	fmt.Fprintf(&b, "\n## Latest %d transactions (id | date | type | amount ARS | category | owner | description)\n", len(d.Transactions))
	if len(d.Transactions) == 0 {
		b.WriteString("None.\n")
	}
	for _, t := range d.Transactions {
		category := t.Category
		if category == "" {
			category = "-"
		}
		owner := t.Owner
		if owner == "" {
			owner = "-"
		}
		fmt.Fprintf(&b, "#%d | %s | %s | %s | %s | %s | %s\n",
			t.ID, t.Date.Format("2006-01-02"), t.Type, FormatAmount(t.Amount), category, owner,
			truncateRunes(collapseWhitespace(t.Description), maxContextDescriptionLen))
	}

	return b.String()
}

// FormatAmount renders a number rounded to whole units with comma thousand
// separators, e.g. -1234567.8 -> "-1,234,568".
func FormatAmount(v float64) string {
	n := int64(math.Round(v))
	neg := n < 0
	if neg {
		n = -n
	}
	digits := fmt.Sprintf("%d", n)
	var out strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out.WriteByte(',')
		}
		out.WriteRune(c)
	}
	if neg {
		return "-" + out.String()
	}
	return out.String()
}

// TruncateTitle builds a conversation title from the first user message:
// whitespace is collapsed and the text is cut to at most max runes,
// preferring a word boundary and appending an ellipsis when truncated.
func TruncateTitle(s string, max int) string {
	s = collapseWhitespace(s)
	if s == "" {
		return DefaultChatTitle
	}
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	cut := string(runes[:max-1])
	if idx := strings.LastIndex(cut, " "); idx > len(cut)/2 {
		cut = cut[:idx]
	}
	return strings.TrimRight(cut, " .,;:-") + "…"
}

// TrimHistory keeps the last max items of a slice (all of it when max <= 0).
func TrimHistory[T any](items []T, max int) []T {
	if max <= 0 || len(items) <= max {
		return items
	}
	return items[len(items)-max:]
}

func collapseWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max-1]) + "…"
}

func sortedByAmount(items []NamedAmount) []NamedAmount {
	out := make([]NamedAmount, len(items))
	copy(out, items)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Amount > out[j].Amount })
	return out
}

func joinNamedAmounts(items []NamedAmount, limit int) string {
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	parts := make([]string, 0, len(items))
	for _, it := range items {
		name := it.Name
		if name == "" {
			name = "Uncategorized"
		}
		parts = append(parts, fmt.Sprintf("%s %s", name, FormatAmount(it.Amount)))
	}
	return strings.Join(parts, "; ")
}

// HistoryContent is what a stored message contributes to the model prompt.
// Assistant turns that changed data get a note of those actions appended so
// follow-up questions ("undo that", "and the rest?") have the context.
func HistoryContent(m models.ChatMessage) string {
	if m.Role != models.ChatRoleAssistant || len(m.Actions) == 0 {
		return m.Content
	}
	summaries := make([]string, len(m.Actions))
	for i, a := range m.Actions {
		summaries[i] = a.Summary
	}
	return m.Content + "\n\n[Actions performed in this turn: " + strings.Join(summaries, "; ") + "]"
}

// FallbackActionsReply is stored when the model failed to produce a final
// answer after tools already changed data, so the user still sees what happened.
func FallbackActionsReply(actions models.ChatActions) string {
	var b strings.Builder
	b.WriteString("I applied the following changes, but couldn't finish writing my answer:\n")
	for _, a := range actions {
		b.WriteString("- ")
		b.WriteString(a.Summary)
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}
