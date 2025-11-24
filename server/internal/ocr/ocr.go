package ocr

import (
	"context"
	"database/sql"
	"encoding/json"
	"etl-banks-ar/internal/models"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/responses"
)

type TransactionList struct {
	Transactions []Transaction `json:"transactions"`
}

type Transaction struct {
	Date         string  `json:"date"`
	Description  string  `json:"description"`
	Amount       float64 `json:"amount"`
	BalanceAfter float64 `json:"balance_after"`
	Type         string  `json:"type"` // "debit" | "credit"
}

func Execute(filePath string) (*[]models.Transaction, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		log.Fatal("OPENAI_API_KEY not set")
	}

	ctx := context.Background()

	client := openai.NewClient(
		option.WithAPIKey(apiKey),
	)

	// 1) Upload the PDF
	file, err := os.Open(filePath)
	if err != nil {
		log.Fatalf("error opening file: %v", err)
	}
	defer file.Close()

	uploaded, err := client.Files.New(ctx, openai.FileNewParams{
		File:    file,
		Purpose: openai.FilePurposeAssistants, // purpose depends on latest SDK, this is typical
	})
	if err != nil {
		log.Fatalf("error uploading file: %v", err)
	}

	fmt.Println("Uploaded file ID:", uploaded.ID)

	// 2) Build the Responses API request, with the PDF as an input_file
	//
	// We send:
	//   - the PDF file
	//   - a text instruction asking for structured JSON
	//
	// The union types (`OfInputItemList`, `OfInputFile`, etc.) follow the same pattern
	// shown in the official Responses examples.
	prompt := `You are an expert OCR and bank-statement parser.

Extract EVERY transaction from the bank statement PDF and return ONLY valid JSON with this exact structure:

{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string",
      "amount": 123.45,
      "balance_after": 456.78,
      "type": "debit" | "credit"
    }
  ]
}

CRITICAL REQUIREMENTS:
1. Output ONLY valid JSON - no markdown code blocks, no explanations, no text before or after
2. The JSON MUST be complete and properly closed:
   - Every transaction object must have all 5 fields: date, description, amount, balance_after, type
   - Every opening brace { must have a closing brace }
   - Every opening bracket [ must have a closing bracket ]
3. Field rules:
   - "date": ISO format YYYY-MM-DD (convert DD/MM/YYYY if needed)
   - "amount": negative for debits, positive for credits, use dot as decimal separator
   - "balance_after": numeric value if available, otherwise 0.0
   - "type": exactly "debit" or "credit" (lowercase)
   - "description": full transaction description as it appears
4. Extract ALL transactions from the statement - do not stop early
5. Ensure the final JSON is valid and parseable - verify all brackets and braces are closed

Return ONLY the JSON object, nothing else.`

	params := responses.ResponseNewParams{
		Model:           openai.ChatModelGPT4o, // or a ResponsesModel like ResponsesModelO4Mini if available
		MaxOutputTokens: openai.Int(16384),     // Increased to handle large statements
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: responses.ResponseInputParam{
				// One "message" that includes: file + text prompt
				responses.ResponseInputItemParamOfMessage(
					responses.ResponseInputMessageContentListParam{
						// 1) The PDF file
						responses.ResponseInputContentUnionParam{
							OfInputFile: &responses.ResponseInputFileParam{
								FileID: openai.String(uploaded.ID),
								Type:   "input_file",
							},
						},
						// 2) The textual instructions
						responses.ResponseInputContentUnionParam{
							OfInputText: &responses.ResponseInputTextParam{
								Text: prompt,
								Type: "input_text",
							},
						},
					},
					"user",
				),
			},
		},
	}

	resp, err := client.Responses.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("error calling Responses API: %w", err)
	}

	raw := resp.OutputText()
	if raw == "" {
		return nil, fmt.Errorf("empty response from model")
	}

	fmt.Println("Raw: ", raw)

	// Clean the response: remove markdown code blocks if present
	cleaned := cleanJSONResponse(raw)

	var parsed TransactionList
	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return nil, fmt.Errorf("error parsing JSON into TransactionList: %w", err)
	}

	return ParseTransactions(parsed), nil
}

func ParseTransactions(transactions TransactionList) *[]models.Transaction {
	var parsed []models.Transaction
	for _, transaction := range transactions.Transactions {
		amount := transaction.Amount
		if transaction.Type == "debit" {
			amount = -amount
		}

		balanceAfter := transaction.BalanceAfter
		if transaction.Type == "debit" {
			balanceAfter = -balanceAfter
		}
		date, err := time.Parse("2006-01-02", transaction.Date)
		if err != nil {
			log.Fatalf("error parsing date: %v", err)
		}

		parsed = append(parsed, models.Transaction{
			ID:           uint(time.Now().Unix()),
			Date:         date,
			Description:  sql.NullString{String: transaction.Description, Valid: true},
			Amount:       sql.NullFloat64{Float64: amount, Valid: true},
			BalanceAfter: sql.NullFloat64{Float64: balanceAfter, Valid: true},
			Type:         sql.NullString{String: transaction.Type, Valid: true},
		})
	}

	return &parsed
}

// cleanJSONResponse removes markdown code blocks and trims whitespace
func cleanJSONResponse(raw string) string {
	cleaned := strings.TrimSpace(raw)

	// Remove markdown code blocks if present
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)

	// Find the first { and last } to extract just the JSON
	firstBrace := strings.Index(cleaned, "{")
	lastBrace := strings.LastIndex(cleaned, "}")

	if firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace {
		cleaned = cleaned[firstBrace : lastBrace+1]
	}

	return cleaned
}
