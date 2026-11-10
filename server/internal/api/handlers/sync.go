package handlers

import (
	"net/http"
	"strconv"

	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type SyncHandler struct {
	service *services.SyncService
}

func NewSyncHandler(service *services.SyncService) *SyncHandler {
	return &SyncHandler{service: service}
}

// Pull returns the workspace rows changed since the `since` cursor (everything when empty).
func (h *SyncHandler) Pull(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	limit, _ := strconv.Atoi(c.Query("limit"))

	resp, err := h.service.Pull(uint(workspaceID), c.Query("since"), limit)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

type SyncPushRequest struct {
	Mutations []services.SyncMutation `json:"mutations"`
}

// Push applies a batch of offline mutations and reports the outcome of each, in order.
func (h *SyncHandler) Push(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req SyncPushRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	results, err := h.service.Push(uint(workspaceID), c.MustGet("userID").(uint), req.Mutations)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}
