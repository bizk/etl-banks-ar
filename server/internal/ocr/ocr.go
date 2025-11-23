package ocr

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/responses"
)

// Define the expected JSON structure
type BankMovements struct {
	Transactions []Transaction `json:"transactions"`
}

type Transaction struct {
	Date         *string  `json:"date"`
	Description  *string  `json:"description"`
	Amount       *float64 `json:"amount"`
	BalanceAfter *float64 `json:"balance_after"`
	Category     *string  `json:"category"` // "debit" | "credit"
}

func Execute(filePath string) (*BankMovements, error) {
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
	prompt := `
You are an expert OCR and bank-statement parser.

You are given a PDF that is a bank account statement. 
Extract EVERY transaction you can find and return ONLY JSON, with this exact shape:

{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string",
      "amount": 123.45,
      "balance_after": 456.78,
      "category": "debit" | "credit"
    }
  ]
}

Rules:
- "date": use ISO format YYYY-MM-DD if possible. If you only have DD/MM/YYYY, convert it.
- "amount": negative for debits, positive for credits. Use dot as decimal separator.
- "balance_after": if the statement clearly shows the balance after the operation, use it; otherwise use null.
- "category": "debit" for money going out, "credit" for money coming in.
- Do NOT include any other fields or text. Output must be valid JSON.
`

	params := responses.ResponseNewParams{
		Model:           openai.ChatModelGPT4o, // or a ResponsesModel like ResponsesModelO4Mini if available
		MaxOutputTokens: openai.Int(2048),
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

	// 3) Call the Responses API
	resp, err := client.Responses.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("error calling Responses API: %w", err)
	}

	// 4) Get the text output and unmarshal into our struct
	raw := resp.OutputText() // helper from the SDK
	if raw == "" {
		return nil, fmt.Errorf("empty response from model")
	}

	var parsed BankMovements
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		// Helpful debug log if JSON is malformed
		log.Printf("model output was:\n%s\n", raw)
		return nil, fmt.Errorf("error parsing JSON into BankMovements: %w", err)
	}

	return &parsed, nil
}
