package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBuildTransactionAssignsOwnerID(t *testing.T) {
	ownerID := uint(42)
	transaction := buildTransaction(7, ownerID, CreateTransactionRequest{
		Date:        "2026-08-28",
		Description: "Coffee",
		Amount:      12.5,
		Type:        "debit",
	}, time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC))

	if transaction.OwnerID != ownerID {
		t.Fatalf("expected owner ID %d, got %d", ownerID, transaction.OwnerID)
	}

	payload, err := json.Marshal(transaction)
	if err != nil {
		t.Fatalf("marshal transaction: %v", err)
	}
	if !strings.Contains(string(payload), `"owner_id":42`) {
		t.Fatalf("expected owner_id in transaction JSON, got %s", payload)
	}
	if strings.Contains(string(payload), `"owner"`) {
		t.Fatalf("expected legacy owner name to be absent, got %s", payload)
	}
}
