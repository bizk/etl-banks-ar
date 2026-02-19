package main

import (
	"database/sql"
	"etl-banks-ar/internal/categorizer"
	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/ocr"
	openAiService "etl-banks-ar/internal/openai"
	"etl-banks-ar/internal/trainingcsv"
	"flag"
	"log"
	"math"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	startedAt := time.Now()
	log.SetFlags(log.LstdFlags)

	trainingDir := flag.String("training-dir", "", "Folder with labeled CSV training data")
	inputPDF := flag.String("input-pdf", "", "Bank statement PDF to analyze")
	outputCSV := flag.String("output-csv", "", "Output CSV path")
	account := flag.String("cuenta", "cash", "Value for the Cuenta column in output")
	examplesPerCategory := flag.Int("examples-per-category", 20, "Max training examples per category sent to OpenAI")
	flag.Parse()

	if *trainingDir == "" || *inputPDF == "" || *outputCSV == "" {
		log.Fatal("usage: go run ./cmd/categorize --training-dir ./data/train --input-pdf ./resources/statement.pdf --output-csv ./out/predictions.csv [--cuenta cash]")
	}

	log.Printf("starting categorize flow")
	log.Printf("training-dir=%s input-pdf=%s output-csv=%s cuenta=%s", *trainingDir, *inputPDF, *outputCSV, *account)

	if err := godotenv.Load(); err != nil {
		log.Printf("warning: .env not loaded, relying on environment variables")
	}

	log.Printf("loading training data")
	_, examples, err := trainingcsv.LoadTrainingData(*trainingDir)
	if err != nil {
		log.Fatalf("failed to load training CSVs: %v", err)
	}
	log.Printf("loaded %d training examples", len(examples))

	log.Printf("extracting transactions from PDF")
	transactions, err := ocr.ReadFile(*inputPDF)
	if err != nil {
		log.Fatalf("failed to parse PDF: %v", err)
	}
	if len(*transactions) == 0 {
		log.Fatal("no transactions parsed from PDF")
	}
	log.Printf("parsed %d transactions", len(*transactions))

	filteredTransactions, skipped := filterTransactionsByDescription(*transactions, "yanzon")
	if len(filteredTransactions) == 0 {
		log.Fatal("all transactions were filtered out")
	}
	log.Printf("filtered %d transactions by description contains 'yanzon' (case-insensitive). Remaining: %d", skipped, len(filteredTransactions))

	log.Printf("requesting OpenAI categorization")
	client := openAiService.NewClient()
	categories, err := categorizer.CategorizeWithOpenAI(client, filteredTransactions, examples, *examplesPerCategory)
	if err != nil {
		log.Fatalf("failed to categorize transactions: %v", err)
	}
	log.Printf("received categories for %d transactions", len(categories))

	for i := range filteredTransactions {
		filteredTransactions[i].Category = sql.NullString{String: categories[i], Valid: true}
		filteredTransactions[i].Amount = sql.NullFloat64{
			Float64: normalizeSignedAmount(filteredTransactions[i]),
			Valid:   filteredTransactions[i].Amount.Valid,
		}
	}

	log.Printf("writing output CSV")
	if err = trainingcsv.WriteCategorizedOutputCSV(*outputCSV, *account, filteredTransactions); err != nil {
		log.Fatalf("failed to export CSV: %v", err)
	}

	log.Printf("done: wrote %d rows to %s in %s", len(filteredTransactions), *outputCSV, time.Since(startedAt).Round(time.Millisecond))
}

func filterTransactionsByDescription(transactions []models.Transaction, blockedTerm string) ([]models.Transaction, int) {
	blocked := strings.ToLower(strings.TrimSpace(blockedTerm))
	if blocked == "" {
		return transactions, 0
	}

	filtered := make([]models.Transaction, 0, len(transactions))
	skipped := 0
	for _, tx := range transactions {
		description := strings.ToLower(tx.Description.String)
		if strings.Contains(description, blocked) {
			skipped++
			continue
		}
		filtered = append(filtered, tx)
	}
	return filtered, skipped
}

func normalizeSignedAmount(tx models.Transaction) float64 {
	if !tx.Amount.Valid {
		return 0
	}

	absAmount := math.Abs(tx.Amount.Float64)
	txType := strings.ToLower(strings.TrimSpace(tx.Type.String))

	if txType == "debit" {
		return -absAmount
	}
	if txType == "credit" {
		return absAmount
	}
	return tx.Amount.Float64
}
