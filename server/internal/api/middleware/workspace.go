package middleware

import (
	"net/http"
	"strconv"

	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

func WorkspaceAccessMiddleware(workspaceService *services.WorkspaceService) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		workspaceIDStr := c.Param("id")

		if workspaceIDStr == "" {
			c.Next()
			return
		}

		workspaceID, err := strconv.ParseUint(workspaceIDStr, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid workspace ID"})
			c.Abort()
			return
		}

		isMember, role, err := workspaceService.IsMember(uint(workspaceID), userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check workspace access"})
			c.Abort()
			return
		}

		if !isMember {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied to this workspace"})
			c.Abort()
			return
		}

		c.Set("workspaceRole", role)
		c.Next()
	}
}
