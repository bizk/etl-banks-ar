package handlers

import (
	"net/http"
	"strconv"

	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type ExchangeRateHandler struct {
	exchangeRateService *services.ExchangeRateService
}

func NewExchangeRateHandler(exchangeRateService *services.ExchangeRateService) *ExchangeRateHandler {
	return &ExchangeRateHandler{
		exchangeRateService: exchangeRateService,
	}
}

func (h *ExchangeRateHandler) List(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	rates, err := h.exchangeRateService.List(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch exchange rates"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"exchange_rates": rates})
}

func (h *ExchangeRateHandler) Get(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	month := c.Param("month")

	rate, err := h.exchangeRateService.GetByMonth(uint(workspaceID), month)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Exchange rate not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"exchange_rate": rate})
}

type UpsertExchangeRateRequest struct {
	Rate float64 `json:"rate" binding:"required,gt=0"`
}

func (h *ExchangeRateHandler) Upsert(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	month := c.Param("month")

	var req UpsertExchangeRateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rate, err := h.exchangeRateService.Upsert(uint(workspaceID), month, req.Rate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save exchange rate"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"exchange_rate": rate})
}

func (h *ExchangeRateHandler) Delete(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	month := c.Param("month")

	if err := h.exchangeRateService.Delete(uint(workspaceID), month); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete exchange rate"})
		return
	}

	c.Status(http.StatusNoContent)
}
