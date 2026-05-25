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
