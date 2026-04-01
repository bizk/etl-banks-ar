package main

import (
	"database/sql"
	"etl-banks-ar/internal/categorizer"
	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/ocr"
	openAiService "etl-banks-ar/internal/openai"
	"etl-banks-ar/internal/trainingcsv"
	"flag"
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	startedAt := time.Now()
	ui := newCLIPrinter(os.Stdout, os.Stderr)

	trainingDir := flag.String("training-dir", "", "Folder with labeled CSV training data")
	inputPDF := flag.String("input-pdf", "", "Bank statement PDF to analyze")
	outputCSV := flag.String("output-csv", "", "Output CSV path")
	account := flag.String("cuenta", "cash", "Value for the Cuenta column in output")
	examplesPerCategory := flag.Int("examples-per-category", 20, "Max training examples per category sent to OpenAI")
	flag.Parse()

	if *trainingDir == "" || *inputPDF == "" || *outputCSV == "" {
		ui.fail("usage: go run ./cmd/categorize --training-dir ./data/train --input-pdf ./resources/statement.pdf --output-csv ./out/predictions.csv [--cuenta cash]")
	}

	ui.header("Bank Statement Categorizer")
	ui.info("training-dir=%s", *trainingDir)
	ui.info("input-pdf=%s", *inputPDF)
	ui.info("output-csv=%s", *outputCSV)
	ui.info("cuenta=%s", *account)

	if err := godotenv.Load(); err != nil {
		ui.warn(".env not loaded, relying on environment variables")
	}

	ui.step(1, "Loading training data")
	_, examples, err := trainingcsv.LoadTrainingData(*trainingDir)
	if err != nil {
		ui.fail("failed to load training CSVs: %v", err)
	}
	ui.ok("loaded %d training examples", len(examples))

	ui.step(2, "Extracting transactions from PDF")
	transactions, err := ocr.ReadFile(*inputPDF)
	if err != nil {
		ui.fail("failed to parse PDF: %v", err)
	}
	if len(*transactions) == 0 {
		ui.fail("no transactions parsed from PDF")
	}
	ui.ok("parsed %d transactions", len(*transactions))

	filteredTransactions, skipped := filterTransactionsByDescription(*transactions, "yanzon")
	if len(filteredTransactions) == 0 {
		ui.fail("all transactions were filtered out")
	}
	ui.ok("filtered %d transactions by 'yanzon' (case-insensitive). Remaining: %d", skipped, len(filteredTransactions))

	ui.step(3, "Categorizing with OpenAI")
	client := openAiService.NewClient()
	categories, err := categorizer.CategorizeWithOpenAI(client, filteredTransactions, examples, *examplesPerCategory)
	if err != nil {
		ui.fail("failed to categorize transactions: %v", err)
	}
	ui.ok("received categories for %d transactions", len(categories))

	for i := range filteredTransactions {
		filteredTransactions[i].Category = sql.NullString{String: categories[i], Valid: true}
		filteredTransactions[i].Amount = sql.NullFloat64{
			Float64: normalizeSignedAmount(filteredTransactions[i]),
			Valid:   filteredTransactions[i].Amount.Valid,
		}
	}

	ui.step(4, "Writing output CSV")
	if err = trainingcsv.WriteCategorizedOutputCSV(*outputCSV, *account, filteredTransactions); err != nil {
		ui.fail("failed to export CSV: %v", err)
	}

	ui.summary(len(filteredTransactions), skipped, *outputCSV, time.Since(startedAt).Round(time.Millisecond))
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

type cliPrinter struct {
	out        *os.File
	err        *os.File
	useColor   bool
	resetColor string
}

func newCLIPrinter(out *os.File, err *os.File) cliPrinter {
	term := strings.ToLower(strings.TrimSpace(os.Getenv("TERM")))
	noColor := os.Getenv("NO_COLOR") != ""
	useColor := term != "dumb" && !noColor && isTerminal(out)
	return cliPrinter{
		out:        out,
		err:        err,
		useColor:   useColor,
		resetColor: "\033[0m",
	}
}

func (c cliPrinter) header(title string) {
	line := strings.Repeat("=", 52)
	fmt.Fprintln(c.out, c.decorate(line, "1;36"))
	fmt.Fprintln(c.out, c.decorate("  "+title, "1;37"))
	fmt.Fprintln(c.out, c.decorate(line, "1;36"))
}

func (c cliPrinter) step(num int, message string) {
	fmt.Fprintln(c.out, c.decorate(fmt.Sprintf("[STEP %d] %s", num, message), "1;34"))
}

func (c cliPrinter) info(format string, args ...any) {
	c.print(c.out, "INFO", "0;36", format, args...)
}

func (c cliPrinter) warn(format string, args ...any) {
	c.print(c.out, "WARN", "1;33", format, args...)
}

func (c cliPrinter) ok(format string, args ...any) {
	c.print(c.out, " OK ", "1;32", format, args...)
}

func (c cliPrinter) fail(format string, args ...any) {
	c.print(c.err, "ERR!", "1;31", format, args...)
	os.Exit(1)
}

func (c cliPrinter) summary(writtenRows int, skipped int, outputPath string, elapsed time.Duration) {
	fmt.Fprintln(c.out, c.decorate(strings.Repeat("-", 52), "1;36"))
	c.print(c.out, "DONE", "1;32", "wrote %d rows", writtenRows)
	c.print(c.out, "INFO", "0;36", "skipped by filter: %d", skipped)
	c.print(c.out, "INFO", "0;36", "output file: %s", outputPath)
	c.print(c.out, "INFO", "0;36", "elapsed: %s", elapsed)
	fmt.Fprintln(c.out, c.decorate(strings.Repeat("-", 52), "1;36"))
}

func (c cliPrinter) print(stream *os.File, label string, color string, format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	ts := time.Now().Format("15:04:05")
	decoratedLabel := c.decorate(label, color)
	fmt.Fprintf(stream, "[%s] %s %s\n", ts, decoratedLabel, message)
}

func (c cliPrinter) decorate(text string, color string) string {
	if !c.useColor {
		return text
	}
	return "\033[" + color + "m" + text + c.resetColor
}

func isTerminal(f *os.File) bool {
	if f == nil {
		return false
	}
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}
