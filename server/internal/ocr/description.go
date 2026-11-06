package ocr

import (
	"strings"
	"unicode"
)

var movementPhraseRemovals = []string{
	"egreso de dinero",
	"ingreso de dinero",
}

// SanitizeMovementDescription removes generic Spanish movement boilerplate ("Egreso/Ingreso de dinero").
// Returns the remaining payee/description text when possible; preserves the original if stripping would erase it.
func SanitizeMovementDescription(desc string) string {
	s := strings.TrimSpace(desc)
	lower := strings.ToLower(s)

	for _, phrase := range movementPhraseRemovals {
		idx := strings.Index(lower, phrase)
		if idx < 0 {
			continue
		}
		// Preserve text strictly before matched phrase (merchant sometimes appears first — keep full string).
		afterPhrase := strings.TrimSpace(s[idx+len(phrase):])
		afterPhrase = trimLeadingNoise(afterPhrase)
		beforePhrase := trimTrailingNoise(strings.TrimSpace(s[:idx]))
		combined := strings.TrimSpace(strings.TrimSpace(beforePhrase + " " + afterPhrase))
		if combined == "" {
			return desc
		}
		s = combined
		lower = strings.ToLower(s)
	}

	return trimOuterNoise(strings.TrimSpace(s))
}

func trimLeadingNoise(s string) string {
	s = strings.TrimSpace(s)
	for {
		prev := s
		s = strings.TrimSpace(strings.TrimPrefix(s, "-"))
		s = strings.TrimSpace(strings.TrimPrefix(s, ":"))
		s = strings.TrimSpace(strings.TrimPrefix(s, "|"))
		if s == prev {
			break
		}
	}
	return s
}

func trimTrailingNoise(s string) string {
	s = strings.TrimSpace(s)
	for {
		prev := s
		s = strings.TrimSpace(strings.TrimSuffix(s, "-"))
		s = strings.TrimSpace(strings.TrimSuffix(s, ":"))
		if s == prev {
			break
		}
	}
	return s
}

func trimOuterNoise(s string) string {
	s = trimLeadingNoise(s)
	s = trimTrailingNoise(s)
	return s
}

// WithCounterparty appends who the money went to (debits) or came from (credits)
// to a movement description, unless the description already names them.
func WithCounterparty(description, counterparty, txType string) string {
	desc := strings.TrimSpace(description)
	cp := strings.Join(strings.Fields(counterparty), " ")
	if cp == "" || strings.Contains(foldForMatch(desc), foldForMatch(cp)) {
		return desc
	}

	direction := "a"
	if strings.EqualFold(strings.TrimSpace(txType), "credit") {
		direction = "de"
	}
	if desc == "" {
		return cp
	}
	return desc + " - " + direction + " " + cp
}

// foldForMatch lowercases and drops punctuation/spacing so "Pérez, Juan" style
// differences in spacing or separators don't cause duplicated names.
func foldForMatch(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
