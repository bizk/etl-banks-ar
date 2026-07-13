package handlers

import (
	"encoding/json"
	"testing"
)

func TestUpdateCategoryRequest_unmarshal_area_id_only(t *testing.T) {
	var req UpdateCategoryRequest
	if err := json.Unmarshal([]byte(`{"area_id":1}`), &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !req.AreaID.Provided {
		t.Fatal("expected area_id key to set Provided")
	}
	if req.AreaID.Ptr == nil || *req.AreaID.Ptr != 1 {
		t.Fatalf("expected area_id 1, got %#v", req.AreaID.Ptr)
	}
}

func TestUpdateCategoryRequest_unmarshal_area_id_null(t *testing.T) {
	var req UpdateCategoryRequest
	if err := json.Unmarshal([]byte(`{"area_id":null}`), &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !req.AreaID.Provided {
		t.Fatal("expected explicit null to set Provided")
	}
	if req.AreaID.Ptr != nil {
		t.Fatalf("expected nil pointer to clear area, got %v", *req.AreaID.Ptr)
	}
}

func TestUpdateCategoryRequest_unmarshal_omit_area_id(t *testing.T) {
	var req UpdateCategoryRequest
	if err := json.Unmarshal([]byte(`{"name":"x"}`), &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if req.AreaID.Provided {
		t.Fatal("expected omitted area_id to leave Provided false")
	}
}
