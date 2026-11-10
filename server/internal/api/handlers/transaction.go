package handlers

import (
	"database/sql"
	"errors"
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
	Owner       string  `json:"owner"`
	AreaID      *uint   `json:"area_id"`
}

type UpdateTransactionRequest = services.TransactionPatch

type BulkUpdateTransactionsRequest struct {
	Transactions []services.TransactionPatchItem `json:"transactions" binding:"required"`
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
		DateFrom:    c.Query("date_from"),
		DateTo:      c.Query("date_to"),
		Categories:  c.QueryArray("category"),
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

	owner := req.Owner
	if owner == "" {
		owner = h.transactionService.UserName(c.MustGet("userID").(uint))
	}
	transaction := &models.Transaction{
		WorkspaceID: uint(workspaceID),
		Date:        date,
		Description: sql.NullString{String: req.Description, Valid: true},
		Amount:      sql.NullFloat64{Float64: req.Amount, Valid: true},
		Type:        sql.NullString{String: req.Type, Valid: true},
		Category:    sql.NullString{String: req.Category, Valid: req.Category != ""},
		Owner:       sql.NullString{String: owner, Valid: owner != ""},
		AreaID:      req.AreaID,
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

	if err := services.ApplyTransactionPatch(transaction, req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.transactionService.Update(transaction); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"transaction": transaction})
}

// BulkUpdate applies several partial updates in one database transaction.
func (h *TransactionHandler) BulkUpdate(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req BulkUpdateTransactionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updated, err := h.transactionService.BulkUpdate(uint(workspaceID), req.Transactions)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, services.ErrBulkTransactionNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"updated": len(updated), "transactions": updated})
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

func (h *TransactionHandler) GetYearlySummary(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	year := c.Query("year")

	if year == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "year parameter is required (YYYY)"})
		return
	}

	summary, err := h.transactionService.GetYearlySummary(uint(workspaceID), year)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch yearly summary"})
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

func (h *TransactionHandler) GetOwners(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	owners, err := h.transactionService.GetOwners(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch owners"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"owners": owners})
}
