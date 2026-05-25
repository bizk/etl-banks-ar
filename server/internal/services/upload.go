package services

import (
	"database/sql"
	"etl-banks-ar/internal/categorizer"
	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/ocr"
	openAiService "etl-banks-ar/internal/openai"
	"etl-banks-ar/internal/trainingcsv"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

const maxWorkspaceLabeledExamples = 120

type UploadService struct {
	db              *gorm.DB
	categoryService *CategoryService
}

func NewUploadService(db *gorm.DB, categoryService *CategoryService) *UploadService {
	return &UploadService{db: db, categoryService: categoryService}
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

// ProcessUpload processes a PDF file through OCR and workspace-aware categorization.
func (s *UploadService) ProcessUpload(workspaceID uint, filePath string) (*UploadPreview, error) {
	if err := s.categoryService.EnsureMissingCategory(workspaceID); err != nil {
		return nil, fmt.Errorf("ensure default category: %w", err)
	}

	categories, err := s.categoryService.List(workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to list categories: %w", err)
	}

	allowedCategories := make([]string, 0, len(categories))
	for _, c := range categories {
		n := strings.TrimSpace(c.Name)
		if n != "" {
			allowedCategories = append(allowedCategories, n)
		}
	}

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

	labeledExamples, err := s.loadLabeledExamplesForUpload(workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to load categorized history: %w", err)
	}

	predictedCategories, err := categorizer.CategorizeWithWorkspaceExamples(client, *transactions, labeledExamples, allowedCategories)
	if err != nil {
		return nil, fmt.Errorf("categorization failed: %w", err)
	}

	preview := make([]PreviewTransaction, len(*transactions))
	var totalDebit, totalCredit float64

	for i, tx := range *transactions {
		category := ""
		if i < len(predictedCategories) {
			category = predictedCategories[i]
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

func (s *UploadService) loadLabeledExamplesForUpload(workspaceID uint) ([]trainingcsv.Example, error) {
	since := time.Now().AddDate(0, -2, 0)
	var recent []models.Transaction
	err := s.db.Where("workspace_id = ? AND date >= ?", workspaceID, since).
		Where("category IS NOT NULL AND category != ?", "").
		Order("date DESC").
		Limit(maxWorkspaceLabeledExamples).
		Find(&recent).Error
	if err != nil {
		return nil, err
	}
	if len(recent) > 0 {
		return transactionsToExamples(recent), nil
	}

	var fallback []models.Transaction
	err = s.db.Where("workspace_id = ?", workspaceID).
		Where("category IS NOT NULL AND category != ?", "").
		Order("date DESC").
		Limit(30).
		Find(&fallback).Error
	if err != nil {
		return nil, err
	}
	return transactionsToExamples(fallback), nil
}

func transactionsToExamples(rows []models.Transaction) []trainingcsv.Example {
	out := make([]trainingcsv.Example, 0, len(rows))
	for _, t := range rows {
		if !t.Category.Valid || strings.TrimSpace(t.Category.String) == "" {
			continue
		}
		out = append(out, trainingcsv.Example{
			Date:         t.Date.Format("2006-01-02"),
			Description:  t.Description.String,
			Amount:       t.Amount.Float64,
			BalanceAfter: 0,
			Type:         strings.ToLower(t.Type.String),
			Category:     t.Category.String,
		})
	}
	return out
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

	result := s.db.Create(&models_txns)
	if result.Error != nil {
		return 0, fmt.Errorf("failed to save transactions: %w", result.Error)
	}

	return int(result.RowsAffected), nil
}
