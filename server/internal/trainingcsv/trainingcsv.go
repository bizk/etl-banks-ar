package trainingcsv

import (
	"encoding/csv"
	"errors"
	"etl-banks-ar/internal/models"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type fieldKind int

const (
	fieldUnknown fieldKind = iota
	fieldDate
	fieldDescription
	fieldAmount
	fieldBalanceAfter
	fieldType
	fieldCategory
)

type Schema struct {
	Headers []string
	Mapping []fieldKind
}

type Example struct {
	Date         string  `json:"date"`
	Description  string  `json:"description"`
	Amount       float64 `json:"amount"`
	BalanceAfter float64 `json:"balance_after"`
	Type         string  `json:"type"`
	Category     string  `json:"category"`
}

func LoadTrainingData(dir string) (Schema, []Example, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return Schema{}, nil, err
	}

	csvFiles := make([]string, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".csv") {
			csvFiles = append(csvFiles, filepath.Join(dir, entry.Name()))
		}
	}
	sort.Strings(csvFiles)

	if len(csvFiles) == 0 {
		return Schema{}, nil, fmt.Errorf("no CSV files found in %s", dir)
	}

	schema, examples, err := loadCSV(csvFiles[0], true)
	if err != nil {
		return Schema{}, nil, err
	}
	schema = ensureOutputColumns(schema)

	for _, file := range csvFiles[1:] {
		_, rows, loadErr := loadCSV(file, false)
		if loadErr != nil {
			return Schema{}, nil, loadErr
		}
		examples = append(examples, rows...)
	}

	if len(examples) == 0 {
		return Schema{}, nil, errors.New("training CSVs have no rows")
	}

	return schema, examples, nil
}

func WriteTransactionsCSV(path string, schema Schema, transactions []models.Transaction) error {
	if len(schema.Headers) == 0 {
		return errors.New("empty output schema")
	}
	if len(schema.Mapping) != len(schema.Headers) {
		return errors.New("invalid schema mapping")
	}

	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	outFile, err := os.Create(path)
	if err != nil {
		return err
	}
	defer outFile.Close()

	writer := csv.NewWriter(outFile)
	defer writer.Flush()

	if err = writer.Write(schema.Headers); err != nil {
		return err
	}

	for _, tx := range transactions {
		row := make([]string, len(schema.Headers))
		for i, mapped := range schema.Mapping {
			switch mapped {
			case fieldDate:
				if !tx.Date.IsZero() {
					row[i] = tx.Date.Format("2006-01-02")
				}
			case fieldDescription:
				if tx.Description.Valid {
					row[i] = tx.Description.String
				}
			case fieldAmount:
				if tx.Amount.Valid {
					row[i] = strconv.FormatFloat(tx.Amount.Float64, 'f', 2, 64)
				}
			case fieldBalanceAfter:
				if tx.BalanceAfter.Valid {
					row[i] = strconv.FormatFloat(tx.BalanceAfter.Float64, 'f', 2, 64)
				}
			case fieldType:
				if tx.Type.Valid {
					row[i] = tx.Type.String
				}
			case fieldCategory:
				if tx.Category.Valid {
					row[i] = tx.Category.String
				}
			default:
				row[i] = ""
			}
		}
		if err = writer.Write(row); err != nil {
			return err
		}
	}

	if err = writer.Error(); err != nil {
		return err
	}

	return nil
}

func WriteCategorizedOutputCSV(path string, account string, transactions []models.Transaction) error {
	if strings.TrimSpace(account) == "" {
		account = "cash"
	}

	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	outFile, err := os.Create(path)
	if err != nil {
		return err
	}
	defer outFile.Close()

	writer := csv.NewWriter(outFile)
	defer writer.Flush()

	header := []string{"Cuenta", "categoria", "amount", "date", "Descripcion"}
	if err = writer.Write(header); err != nil {
		return err
	}

	for _, tx := range transactions {
		row := []string{
			account,
			"",
			"",
			"",
			"",
		}
		if tx.Category.Valid {
			row[1] = tx.Category.String
		}
		if tx.Amount.Valid {
			row[2] = strconv.FormatFloat(tx.Amount.Float64, 'f', 2, 64)
		}
		if !tx.Date.IsZero() {
			row[3] = tx.Date.Format("2006-01-02")
		}
		if tx.Description.Valid {
			row[4] = tx.Description.String
		}

		if err = writer.Write(row); err != nil {
			return err
		}
	}

	if err = writer.Error(); err != nil {
		return err
	}

	return nil
}

func loadCSV(path string, exportSchema bool) (Schema, []Example, error) {
	f, err := os.Open(path)
	if err != nil {
		return Schema{}, nil, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.FieldsPerRecord = -1

	records, err := reader.ReadAll()
	if err != nil {
		return Schema{}, nil, err
	}
	if len(records) == 0 {
		return Schema{}, nil, fmt.Errorf("empty CSV: %s", path)
	}

	header := records[0]
	mapping := make([]fieldKind, len(header))
	for i, col := range header {
		mapping[i] = detectField(col)
	}

	examples := make([]Example, 0, len(records)-1)
	for _, row := range records[1:] {
		example := Example{}
		for i, value := range row {
			if i >= len(mapping) {
				continue
			}
			switch mapping[i] {
			case fieldDate:
				example.Date = strings.TrimSpace(value)
			case fieldDescription:
				example.Description = strings.TrimSpace(value)
			case fieldAmount:
				example.Amount = parseNumber(value)
			case fieldBalanceAfter:
				example.BalanceAfter = parseNumber(value)
			case fieldType:
				example.Type = strings.ToLower(strings.TrimSpace(value))
			case fieldCategory:
				example.Category = strings.TrimSpace(value)
			}
		}
		if example.Description == "" && example.Category == "" {
			continue
		}
		examples = append(examples, example)
	}

	if exportSchema {
		return Schema{Headers: header, Mapping: mapping}, examples, nil
	}
	return Schema{}, examples, nil
}

func parseNumber(raw string) float64 {
	value := strings.TrimSpace(raw)
	value = strings.ReplaceAll(value, "$", "")
	value = strings.ReplaceAll(value, "ARS", "")
	value = strings.ReplaceAll(value, " ", "")

	if strings.Count(value, ",") > 0 && strings.Count(value, ".") > 0 {
		value = strings.ReplaceAll(value, ".", "")
		value = strings.ReplaceAll(value, ",", ".")
	} else if strings.Count(value, ",") > 0 {
		value = strings.ReplaceAll(value, ",", ".")
	}

	n, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return n
}

func detectField(header string) fieldKind {
	n := normalizeHeader(header)
	switch n {
	case "date", "fecha", "transaction_date", "fecha_operacion":
		return fieldDate
	case "description", "descripcion", "detail", "details", "concepto", "merchant":
		return fieldDescription
	case "amount", "monto", "importe", "value":
		return fieldAmount
	case "balance_after", "balance", "saldo", "saldo_posterior":
		return fieldBalanceAfter
	case "type", "tipo", "kind":
		return fieldType
	case "category", "categoria", "rubro":
		return fieldCategory
	default:
		return fieldUnknown
	}
}

func normalizeHeader(header string) string {
	value := strings.ToLower(strings.TrimSpace(header))
	replacer := strings.NewReplacer("-", "_", " ", "_", "/", "_", "\\", "_", ".", "_")
	value = replacer.Replace(value)
	for strings.Contains(value, "__") {
		value = strings.ReplaceAll(value, "__", "_")
	}
	value = strings.Trim(value, "_")
	return value
}

func ensureOutputColumns(schema Schema) Schema {
	if !hasField(schema.Mapping, fieldDescription) {
		schema.Headers = append(schema.Headers, "descripcion")
		schema.Mapping = append(schema.Mapping, fieldDescription)
	}
	if !hasField(schema.Mapping, fieldCategory) {
		schema.Headers = append(schema.Headers, "category")
		schema.Mapping = append(schema.Mapping, fieldCategory)
	}
	return schema
}

func hasField(mapping []fieldKind, target fieldKind) bool {
	for _, kind := range mapping {
		if kind == target {
			return true
		}
	}
	return false
}
