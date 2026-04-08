package services

import (
	"database/sql"
	"etl-banks-ar/internal/categorizer"
	"etl-banks-ar/internal/configs"
	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/ocr"
	openAiService "etl-banks-ar/internal/openai"
	"etl-banks-ar/internal/trainingcsv"
	"fmt"
	"time"

	"gorm.io/gorm"
)

var trainingDataDir = configs.GetEnvOrDefault("TRAINING_DATA_DIR", "temp/training_data")

type UploadService struct {
	db *gorm.DB
}

func NewUploadService(db *gorm.DB) *UploadService {
	return &UploadService{db: db}
}

// PreviewTransaction represents a transaction ready for user review
type PreviewTransaction struct {
	TempID       int     `json:"temp_id"`
	Date         string  `json:"date"`
	Description  string  `json:"description"`
	Amount       float64 `json:"amount"`
	BalanceAfter float64 `json:"balance_after"`
	Type         string  `json:"type"`
	Category     string  `json:"category"`
}

// UploadPreviewSummary contains summary statistics for the upload
type UploadPreviewSummary struct {
	TotalCount  int     `json:"total_count"`
	TotalDebit  float64 `json:"total_debit"`
	TotalCredit float64 `json:"total_credit"`
}

// UploadPreview is the response for the upload endpoint
type UploadPreview struct {
	Transactions      []PreviewTransaction `json:"transactions"`
	Summary           UploadPreviewSummary `json:"summary"`
	AllowedCategories []string             `json:"allowed_categories"`
}

// ProcessUpload processes a PDF file through OCR and categorization
func (s *UploadService) ProcessUpload(filePath string) (*UploadPreview, error) {
	// Step 1: Load training data for categories
	_, examples, err := trainingcsv.LoadTrainingData(trainingDataDir)
	if err != nil {
		return nil, fmt.Errorf("failed to load training data: %w", err)
	}

	// Extract allowed categories from training data
	allowedCategories := extractCategories(examples)

	// Step 2: OCR the PDF
	client := openAiService.NewClient()
	transactions, err := ocr.ReadFileWithClient(client, filePath)
	if err != nil {
		return nil, fmt.Errorf("OCR failed: %w", err)
	}

	if transactions == nil || len(*transactions) == 0 {
		return &UploadPreview{
			Transactions:      []PreviewTransaction{},
			Summary:           UploadPreviewSummary{},
			AllowedCategories: allowedCategories,
		}, nil
	}

	// Step 3: Categorize transactions
	categories, err := categorizer.CategorizeWithOpenAI(client, *transactions, examples, 20)
	if err != nil {
		return nil, fmt.Errorf("categorization failed: %w", err)
	}

	// Step 4: Build preview response
	preview := make([]PreviewTransaction, len(*transactions))
	var totalDebit, totalCredit float64

	for i, tx := range *transactions {
		category := ""
		if i < len(categories) {
			category = categories[i]
		}

		amount := tx.Amount.Float64
		if amount < 0 {
			totalDebit += amount
		} else {
			totalCredit += amount
		}

		preview[i] = PreviewTransaction{
			TempID:       i,
			Date:         tx.Date.Format("2006-01-02"),
			Description:  tx.Description.String,
			Amount:       amount,
			BalanceAfter: tx.BalanceAfter.Float64,
			Type:         tx.Type.String,
			Category:     category,
		}
	}

	return &UploadPreview{
		Transactions: preview,
		Summary: UploadPreviewSummary{
			TotalCount:  len(preview),
			TotalDebit:  totalDebit,
			TotalCredit: totalCredit,
		},
		AllowedCategories: allowedCategories,
	}, nil
}

// ConfirmTransactionInput is the input for confirming a transaction
type ConfirmTransactionInput struct {
	Date        string  `json:"date"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	Type        string  `json:"type"`
	Category    string  `json:"category"`
}

// ConfirmTransactions saves the confirmed transactions to the database
func (s *UploadService) ConfirmTransactions(workspaceID uint, transactions []ConfirmTransactionInput) (int, error) {
	if len(transactions) == 0 {
		return 0, nil
	}

	var models_txns []models.Transaction
	for _, tx := range transactions {
		date, err := time.Parse("2006-01-02", tx.Date)
		if err != nil {
			return 0, fmt.Errorf("invalid date format '%s': %w", tx.Date, err)
		}

		models_txns = append(models_txns, models.Transaction{
			WorkspaceID:   workspaceID,
			Date:          date,
			Description:   sql.NullString{String: tx.Description, Valid: tx.Description != ""},
			Amount:        sql.NullFloat64{Float64: tx.Amount, Valid: true},
			Type:          sql.NullString{String: tx.Type, Valid: tx.Type != ""},
			Category:      sql.NullString{String: tx.Category, Valid: tx.Category != ""},
			UserConfirmed: true,
		})
	}

	// Bulk insert
	result := s.db.Create(&models_txns)
	if result.Error != nil {
		return 0, fmt.Errorf("failed to save transactions: %w", result.Error)
	}

	return int(result.RowsAffected), nil
}

// extractCategories returns unique categories from training examples
func extractCategories(examples []trainingcsv.Example) []string {
	seen := make(map[string]bool)
	var categories []string

	for _, ex := range examples {
		if ex.Category != "" && !seen[ex.Category] {
			seen[ex.Category] = true
			categories = append(categories, ex.Category)
		}
	}

	return categories
}
