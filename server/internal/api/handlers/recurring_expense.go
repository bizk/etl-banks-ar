package handlers

import (
	"net/http"
	"strconv"
	"time"

	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type RecurringExpenseHandler struct {
	service *services.RecurringExpenseService
}

func NewRecurringExpenseHandler(service *services.RecurringExpenseService) *RecurringExpenseHandler {
	return &RecurringExpenseHandler{service: service}
}

type CreateRecurringExpenseRequest struct {
	Name       string  `json:"name" binding:"required"`
	Amount     float64 `json:"amount" binding:"required"`
	CategoryID *uint   `json:"category_id"`
	Owner      string  `json:"owner"`
	DueDay     int     `json:"due_day" binding:"required"`
}

type UpdateRecurringExpenseRequest struct {
	Name       *string  `json:"name"`
	Amount     *float64 `json:"amount"`
	CategoryID *uint    `json:"category_id"`
	Owner      *string  `json:"owner"`
	DueDay     *int     `json:"due_day"`
}

type RecurringExpenseResponse struct {
	ID              uint    `json:"id"`
	WorkspaceID     uint    `json:"workspace_id"`
	Name            string  `json:"name"`
	Amount          float64 `json:"amount"`
	CategoryID      *uint   `json:"category_id"`
	CategoryName    string  `json:"category_name,omitempty"`
	AreaID          *uint   `json:"area_id,omitempty"`
	AreaName        string  `json:"area_name,omitempty"`
	Owner           string  `json:"owner"`
	DueDay          int     `json:"due_day"`
	LastPaidDate    *string `json:"last_paid_date"`
	IsPaidThisMonth bool    `json:"is_paid_this_month"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

func toRecurringExpenseResponse(exp *models.RecurringExpense) RecurringExpenseResponse {
	resp := RecurringExpenseResponse{
		ID:              exp.ID,
		WorkspaceID:     exp.WorkspaceID,
		Name:            exp.Name,
		Amount:          exp.Amount,
		CategoryID:      exp.CategoryID,
		Owner:           exp.Owner,
		DueDay:          exp.DueDay,
		IsPaidThisMonth: exp.IsPaidThisMonth(),
		CreatedAt:       exp.CreatedAt.Format(time.RFC3339),
		UpdatedAt:       exp.UpdatedAt.Format(time.RFC3339),
	}
	if exp.LastPaidDate != nil {
		formatted := exp.LastPaidDate.Format("2006-01-02")
		resp.LastPaidDate = &formatted
	}
	if exp.Category != nil {
		resp.CategoryName = exp.Category.Name
		if exp.Category.Area != nil {
			resp.AreaID = &exp.Category.Area.ID
			resp.AreaName = exp.Category.Area.Name
		}
	}
	return resp
}

func (h *RecurringExpenseHandler) List(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	expenses, err := h.service.List(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch recurring expenses"})
		return
	}

	responses := make([]RecurringExpenseResponse, len(expenses))
	for i, exp := range expenses {
		responses[i] = toRecurringExpenseResponse(&exp)
	}

	c.JSON(http.StatusOK, gin.H{"recurring_expenses": responses})
}

func (h *RecurringExpenseHandler) GetSummary(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	month := time.Now()
	if monthStr := c.Query("month"); monthStr != "" {
		if parsed, err := time.Parse("2006-01", monthStr); err == nil {
			month = parsed
		}
	}

	summary, err := h.service.GetSummary(uint(workspaceID), month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch summary"})
		return
	}

	c.JSON(http.StatusOK, summary)
}

func (h *RecurringExpenseHandler) Create(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req CreateRecurringExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	expense := &models.RecurringExpense{
		WorkspaceID: uint(workspaceID),
		Name:        req.Name,
		Amount:      req.Amount,
		CategoryID:  req.CategoryID,
		Owner:       req.Owner,
		DueDay:      req.DueDay,
	}

	if err := h.service.Create(expense); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Reload with associations
	expense, _ = h.service.FindByID(expense.ID, uint(workspaceID))
	c.JSON(http.StatusCreated, gin.H{"recurring_expense": toRecurringExpenseResponse(expense)})
}

func (h *RecurringExpenseHandler) Get(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	expense, err := h.service.FindByID(uint(expenseID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recurring expense not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"recurring_expense": toRecurringExpenseResponse(expense)})
}

func (h *RecurringExpenseHandler) Update(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	expense, err := h.service.FindByID(uint(expenseID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recurring expense not found"})
		return
	}

	var req UpdateRecurringExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil {
		expense.Name = *req.Name
	}
	if req.Amount != nil {
		expense.Amount = *req.Amount
	}
	if req.CategoryID != nil {
		expense.CategoryID = req.CategoryID
	}
	if req.Owner != nil {
		expense.Owner = *req.Owner
	}
	if req.DueDay != nil {
		expense.DueDay = *req.DueDay
	}

	if err := h.service.Update(expense); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Reload with associations
	expense, _ = h.service.FindByID(expense.ID, uint(workspaceID))
	c.JSON(http.StatusOK, gin.H{"recurring_expense": toRecurringExpenseResponse(expense)})
}

func (h *RecurringExpenseHandler) Delete(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	if err := h.service.Delete(uint(expenseID), uint(workspaceID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete recurring expense"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *RecurringExpenseHandler) MarkPaid(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	expense, transaction, err := h.service.MarkPaid(uint(expenseID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response := gin.H{"recurring_expense": toRecurringExpenseResponse(expense)}
	if transaction != nil {
		response["transaction"] = transaction
	}

	c.JSON(http.StatusOK, response)
}
