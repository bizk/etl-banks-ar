package handlers

import (
	"net/http"
	"strconv"

	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type AreaHandler struct {
	areaService     *services.AreaService
	categoryService *services.CategoryService
}

func NewAreaHandler(areaService *services.AreaService, categoryService *services.CategoryService) *AreaHandler {
	return &AreaHandler{
		areaService:     areaService,
		categoryService: categoryService,
	}
}

type CreateAreaRequest struct {
	Name  string `json:"name" binding:"required"`
	Color string `json:"color"`
	Icon  string `json:"icon"`
}

type UpdateAreaRequest struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
	Icon  *string `json:"icon"`
}

func (h *AreaHandler) List(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	areas, err := h.areaService.List(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch areas"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"areas": areas})
}

func (h *AreaHandler) Create(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req CreateAreaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	area := &models.Area{
		WorkspaceID: uint(workspaceID),
		Name:        req.Name,
		Color:       req.Color,
		Icon:        req.Icon,
	}

	if err := h.areaService.Create(area); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create area"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"area": area})
}

func (h *AreaHandler) Get(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	areaID, _ := strconv.ParseUint(c.Param("area_id"), 10, 32)

	area, err := h.areaService.FindByID(uint(areaID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Area not found"})
		return
	}

	// Also get categories in this area
	categories, _ := h.categoryService.ListByArea(uint(areaID), uint(workspaceID))

	c.JSON(http.StatusOK, gin.H{
		"area":       area,
		"categories": categories,
	})
}

func (h *AreaHandler) Update(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	areaID, _ := strconv.ParseUint(c.Param("area_id"), 10, 32)

	area, err := h.areaService.FindByID(uint(areaID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Area not found"})
		return
	}

	var req UpdateAreaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil {
		area.Name = *req.Name
	}
	if req.Color != nil {
		area.Color = *req.Color
	}
	if req.Icon != nil {
		area.Icon = *req.Icon
	}

	if err := h.areaService.Update(area); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update area"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"area": area})
}

func (h *AreaHandler) Delete(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	areaID, _ := strconv.ParseUint(c.Param("area_id"), 10, 32)

	if err := h.areaService.Delete(uint(areaID), uint(workspaceID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete area"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *AreaHandler) GetSummary(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	month := c.Query("month")

	if month == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "month parameter is required (YYYY-MM)"})
		return
	}

	summary, err := h.areaService.GetMonthlySummary(uint(workspaceID), month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch area summary"})
		return
	}

	c.JSON(http.StatusOK, summary)
}

func (h *AreaHandler) GetCategories(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	areaID, _ := strconv.ParseUint(c.Param("area_id"), 10, 32)

	categories, err := h.categoryService.ListByArea(uint(areaID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

func (h *AreaHandler) GetYearlySummary(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	year := c.Query("year")

	if year == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "year parameter is required (YYYY)"})
		return
	}

	summary, err := h.areaService.GetYearlySummary(uint(workspaceID), year)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch yearly area summary"})
		return
	}

	c.JSON(http.StatusOK, summary)
}
