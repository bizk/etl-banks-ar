package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type TransactionHandler struct {
	transactionService *services.TransactionService
}

func NewTransactionHandler(transactionService *services.TransactionService) *TransactionHandler {
	return &TransactionHandler{transactionService: transactionService}
}

type CreateTransactionRequest struct {
	Date        string  `json:"date" binding:"required"`
	Description string  `json:"description" binding:"required"`
	Amount      float64 `json:"amount" binding:"required"`
	Type        string  `json:"type" binding:"required,oneof=debit credit"`
	Category    string  `json:"category"`
}

type UpdateTransactionRequest struct {
	Date          *string  `json:"date"`
	Description   *string  `json:"description"`
	Amount        *float64 `json:"amount"`
	Type          *string  `json:"type"`
	Category      *string  `json:"category"`
	UserConfirmed *bool    `json:"user_confirmed"`
}

func (h *TransactionHandler) List(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	month := c.Query("month")

	if month == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "month parameter is required (YYYY-MM)"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))

	filter := services.TransactionFilter{
		WorkspaceID: uint(workspaceID),
		Month:       month,
		Category:    c.Query("category"),
		Type:        c.Query("type"),
		Page:        page,
		PerPage:     perPage,
		SortBy:      c.DefaultQuery("sort", "date"),
		SortOrder:   c.DefaultQuery("order", "desc"),
	}

	result, summary, err := h.transactionService.List(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"transactions": result.Transactions,
		"pagination": gin.H{
			"page":        result.Page,
			"per_page":    result.PerPage,
			"total":       result.Total,
			"total_pages": result.TotalPages,
		},
		"summary": summary,
	})
}

func (h *TransactionHandler) Create(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req CreateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid date format. Use YYYY-MM-DD"})
		return
	}

	transaction := &models.Transaction{
		WorkspaceID: uint(workspaceID),
		Date:        date,
		Description: sql.NullString{String: req.Description, Valid: true},
		Amount:      sql.NullFloat64{Float64: req.Amount, Valid: true},
		Type:        sql.NullString{String: req.Type, Valid: true},
		Category:    sql.NullString{String: req.Category, Valid: req.Category != ""},
	}

	if err := h.transactionService.Create(transaction); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create transaction"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"transaction": transaction})
}

func (h *TransactionHandler) Get(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	transactionID, _ := strconv.ParseUint(c.Param("txn_id"), 10, 32)

	transaction, err := h.transactionService.FindByID(uint(transactionID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"transaction": transaction})
}

func (h *TransactionHandler) Update(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	transactionID, _ := strconv.ParseUint(c.Param("txn_id"), 10, 32)

	transaction, err := h.transactionService.FindByID(uint(transactionID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found"})
		return
	}

	var req UpdateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Date != nil {
		date, err := time.Parse("2006-01-02", *req.Date)
		if err == nil {
			transaction.Date = date
		}
	}
	if req.Description != nil {
		transaction.Description = sql.NullString{String: *req.Description, Valid: true}
	}
	if req.Amount != nil {
		transaction.Amount = sql.NullFloat64{Float64: *req.Amount, Valid: true}
	}
	if req.Type != nil {
		transaction.Type = sql.NullString{String: *req.Type, Valid: true}
	}
	if req.Category != nil {
		transaction.Category = sql.NullString{String: *req.Category, Valid: *req.Category != ""}
	}
	if req.UserConfirmed != nil {
		transaction.UserConfirmed = *req.UserConfirmed
	}

	if err := h.transactionService.Update(transaction); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"transaction": transaction})
}

func (h *TransactionHandler) Delete(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	transactionID, _ := strconv.ParseUint(c.Param("txn_id"), 10, 32)

	if err := h.transactionService.Delete(uint(transactionID), uint(workspaceID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete transaction"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *TransactionHandler) GetSummary(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	month := c.Query("month")

	if month == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "month parameter is required (YYYY-MM)"})
		return
	}

	summary, err := h.transactionService.GetMonthlySummary(uint(workspaceID), month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch summary"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"summary": summary})
}

func (h *TransactionHandler) GetCategories(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	categories, err := h.transactionService.GetCategories(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}
