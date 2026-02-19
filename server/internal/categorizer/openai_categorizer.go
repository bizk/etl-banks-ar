package categorizer

import (
	"encoding/json"
	"etl-banks-ar/internal/models"
	openAiService "etl-banks-ar/internal/openai"
	"etl-banks-ar/internal/trainingcsv"
	"fmt"
	"sort"
	"strings"
)

type requestPayload struct {
	AllowedCategories []string                    `json:"allowed_categories"`
	TrainingExamples  []trainingcsv.Example       `json:"training_examples"`
	Transactions      []categorizationTransaction `json:"transactions"`
}

type categorizationTransaction struct {
	Index       int     `json:"index"`
	Date        string  `json:"date"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	Type        string  `json:"type"`
}

type categorizationResponse struct {
	Results []result `json:"results"`
}

type result struct {
	Index    int    `json:"index"`
	Category string `json:"category"`
	Reason   string `json:"reason"`
}

func CategorizeWithOpenAI(client *openAiService.OpenAIClient, transactions []models.Transaction, examples []trainingcsv.Example, examplesPerCategory int) ([]string, error) {
	if len(transactions) == 0 {
		return nil, nil
	}

	if examplesPerCategory <= 0 {
		examplesPerCategory = 20
	}

	allowedCategories := uniqueCategories(examples)
	if len(allowedCategories) == 0 {
		return nil, fmt.Errorf("training data has no categories")
	}

	selectedExamples := selectExamples(examples, examplesPerCategory)
	payload := requestPayload{
		AllowedCategories: allowedCategories,
		TrainingExamples:  selectedExamples,
		Transactions:      make([]categorizationTransaction, 0, len(transactions)),
	}
	for i, tx := range transactions {
		payload.Transactions = append(payload.Transactions, categorizationTransaction{
			Index:       i,
			Date:        tx.Date.Format("2006-01-02"),
			Description: tx.Description.String,
			Amount:      tx.Amount.Float64,
			Type:        strings.ToLower(tx.Type.String),
		})
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	prompt := fmt.Sprintf(`You classify bank transactions into one category based on provided labeled examples.
Rules:
1. Use only categories listed in "allowed_categories".
2. If uncertain, still choose the closest category.
3. Keep indexes unchanged.
4. Return only valid JSON (no markdown, no extra text) with this format:
{"results":[{"index":0,"category":"string","reason":"short reason"}]}

DATA:
%s`, string(payloadJSON))

	raw, err := client.PromptText(prompt)
	if err != nil {
		return nil, err
	}

	var parsed categorizationResponse
	if err = json.Unmarshal([]byte(cleanJSON(raw)), &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse categorization response: %w", err)
	}

	mapped := make([]string, len(transactions))
	for _, res := range parsed.Results {
		if res.Index < 0 || res.Index >= len(transactions) {
			continue
		}
		if !contains(allowedCategories, res.Category) {
			continue
		}
		mapped[res.Index] = res.Category
	}

	for i := range mapped {
		if mapped[i] == "" {
			mapped[i] = allowedCategories[0]
		}
	}

	return mapped, nil
}

func selectExamples(examples []trainingcsv.Example, perCategory int) []trainingcsv.Example {
	buckets := make(map[string][]trainingcsv.Example)
	for _, ex := range examples {
		if ex.Category == "" {
			continue
		}
		buckets[ex.Category] = append(buckets[ex.Category], ex)
	}

	categories := make([]string, 0, len(buckets))
	for category := range buckets {
		categories = append(categories, category)
	}
	sort.Strings(categories)

	selected := make([]trainingcsv.Example, 0)
	for _, category := range categories {
		rows := buckets[category]
		limit := perCategory
		if len(rows) < limit {
			limit = len(rows)
		}
		selected = append(selected, rows[:limit]...)
	}
	return selected
}

func uniqueCategories(examples []trainingcsv.Example) []string {
	set := make(map[string]struct{})
	for _, ex := range examples {
		category := strings.TrimSpace(ex.Category)
		if category == "" {
			continue
		}
		set[category] = struct{}{}
	}
	categories := make([]string, 0, len(set))
	for category := range set {
		categories = append(categories, category)
	}
	sort.Strings(categories)
	return categories
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func cleanJSON(raw string) string {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)

	firstBrace := strings.Index(cleaned, "{")
	lastBrace := strings.LastIndex(cleaned, "}")
	if firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace {
		return cleaned[firstBrace : lastBrace+1]
	}

	return cleaned
}
