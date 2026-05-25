package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type CategoryHandler struct {
	categoryService *services.CategoryService
}

func NewCategoryHandler(categoryService *services.CategoryService) *CategoryHandler {
	return &CategoryHandler{categoryService: categoryService}
}

type CreateCategoryRequest struct {
	Name   string `json:"name" binding:"required"`
	AreaID *uint  `json:"area_id"`
	Color  string `json:"color"`
	Icon   string `json:"icon"`
}

type UpdateCategoryRequest struct {
	Name   *string          `json:"name"`
	Color  *string          `json:"color"`
	Icon   *string          `json:"icon"`
	AreaID nullableUintJSON `json:"area_id"`
}

// nullableUintJSON distinguishes JSON key omission (Provided=false), explicit JSON null (clear FK),
// and a numeric assignment. This cannot be expressed with *uint alone because null yields nil pointer.
type nullableUintJSON struct {
	Provided bool
	Ptr      *uint
}

func (n *nullableUintJSON) UnmarshalJSON(data []byte) error {
	n.Provided = true
	raw := strings.TrimSpace(string(data))
	if raw == "null" {
		n.Ptr = nil
		return nil
	}
	var val uint64
	if err := json.Unmarshal(data, &val); err != nil {
		return err
	}
	v := uint(val)
	n.Ptr = &v
	return nil
}

func (h *CategoryHandler) List(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	categories, err := h.categoryService.List(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

func (h *CategoryHandler) Create(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req CreateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	category := &models.Category{
		WorkspaceID: uint(workspaceID),
		Name:        req.Name,
		AreaID:      req.AreaID,
		Color:       req.Color,
		Icon:        req.Icon,
	}

	if err := h.categoryService.Create(category); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create category"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"category": category})
}

func (h *CategoryHandler) Get(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	categoryID, _ := strconv.ParseUint(c.Param("cat_id"), 10, 32)

	category, err := h.categoryService.FindByID(uint(categoryID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"category": category})
}

func (h *CategoryHandler) Update(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	categoryID, _ := strconv.ParseUint(c.Param("cat_id"), 10, 32)

	category, err := h.categoryService.FindByID(uint(categoryID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	var req UpdateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	if req.Icon != nil {
		updates["icon"] = *req.Icon
	}

	if req.AreaID.Provided {
		switch {
		case req.AreaID.Ptr == nil:
			updates["area_id"] = nil
		default:
			areaID := *req.AreaID.Ptr
			ok, err := h.categoryService.AreaBelongs(uint(workspaceID), areaID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate area"})
				return
			}
			if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Area not found in this workspace"})
				return
			}
			updates["area_id"] = areaID
		}
	}

	if len(updates) == 0 {
		c.JSON(http.StatusOK, gin.H{"category": category})
		return
	}

	if err := h.categoryService.UpdatePartial(uint(categoryID), uint(workspaceID), updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update category"})
		return
	}

	category, err = h.categoryService.FindByID(uint(categoryID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load updated category"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"category": category})
}

func (h *CategoryHandler) Delete(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	categoryID, _ := strconv.ParseUint(c.Param("cat_id"), 10, 32)

	if err := h.categoryService.Delete(uint(categoryID), uint(workspaceID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete category"})
		return
	}

	c.Status(http.StatusNoContent)
}
