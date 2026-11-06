package ocr_test

import (
	"testing"

	"etl-banks-ar/internal/ocr"
)

func TestSanitizeMovementDescription(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "egreso prefix with dash",
			input:    "EGRESO DE DINERO - MERCADOPAGO RETIRO",
			expected: "MERCADOPAGO RETIRO",
		},
		{
			name:     "ingreso prefix lower",
			input:    "ingreso de dinero CUENTA SUELDO",
			expected: "CUENTA SUELDO",
		},
		{
			name:     "suffix egreso",
			input:    "MERCADO LIBRE - EGRESO DE DINERO",
			expected: "MERCADO LIBRE",
		},
		{
			name:     "no boilerplate unchanged",
			input:    "SUPERMERCADO DIA 123",
			expected: "SUPERMERCADO DIA 123",
		},
		{
			name:     "only boilerplate keeps original",
			input:    " EGRESO DE DINERO   ",
			expected: " EGRESO DE DINERO   ",
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			actual := ocr.SanitizeMovementDescription(tt.input)
			if actual != tt.expected {
				t.Fatalf("expected %q, got %q", tt.expected, actual)
			}
		})
	}
}

func TestWithCounterparty(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		description  string
		counterparty string
		txType       string
		expected     string
	}{
		{"debit transfer gets recipient", "Transferencia enviada", "JUAN PEREZ CUIT 20-12345678-9", "debit", "Transferencia enviada - a JUAN PEREZ CUIT 20-12345678-9"},
		{"credit transfer gets sender", "Transferencia recibida", "Maria Gomez", "credit", "Transferencia recibida - de Maria Gomez"},
		{"no counterparty unchanged", "SUPERMERCADO DIA 123", "", "debit", "SUPERMERCADO DIA 123"},
		{"already named is not duplicated", "Transferencia a JUAN PEREZ", "Juan  Perez", "debit", "Transferencia a JUAN PEREZ"},
		{"punctuation differences ignored", "Pago a PEREZ, JUAN", "Perez Juan", "debit", "Pago a PEREZ, JUAN"},
		{"empty description uses counterparty", "  ", "alias juan.mp", "debit", "alias juan.mp"},
		{"type casing", "DEBIN", "ACME SA", "CREDIT", "DEBIN - de ACME SA"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			actual := ocr.WithCounterparty(tt.description, tt.counterparty, tt.txType)
			if actual != tt.expected {
				t.Fatalf("expected %q, got %q", tt.expected, actual)
			}
		})
	}
}
