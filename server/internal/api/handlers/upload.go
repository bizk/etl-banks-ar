package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type UploadHandler struct {
	uploadService *services.UploadService
}

func NewUploadHandler(uploadService *services.UploadService) *UploadHandler {
	return &UploadHandler{uploadService: uploadService}
}

// Upload handles PDF file upload and returns preview data
func (h *UploadHandler) Upload(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}

	// Validate file type
	ext := filepath.Ext(file.Filename)
	if ext != ".pdf" && ext != ".PDF" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only PDF files are supported"})
		return
	}

	// Create temp directory if it doesn't exist
	tempDir := "temp/uploads"
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create temp directory"})
		return
	}

	// Save file to temp location
	tempPath := filepath.Join(tempDir, file.Filename)
	if err := c.SaveUploadedFile(file, tempPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save uploaded file"})
		return
	}
	defer os.Remove(tempPath) // Clean up after processing

	// Process the file
	preview, err := h.uploadService.ProcessUpload(tempPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"preview": preview})
}

// ConfirmRequest is the request body for confirming transactions
type ConfirmRequest struct {
	Transactions []services.ConfirmTransactionInput `json:"transactions" binding:"required"`
}

// Confirm saves confirmed transactions to the database
func (h *UploadHandler) Confirm(c *gin.Context) {
	workspaceID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid workspace ID"})
		return
	}

	var req ConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	count, err := h.uploadService.ConfirmTransactions(uint(workspaceID), req.Transactions)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"created_count": count})
}
