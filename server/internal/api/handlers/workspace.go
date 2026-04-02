package handlers

import (
	"net/http"
	"strconv"

	"etl-banks-ar/internal/configs"
	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type WorkspaceHandler struct {
	workspaceService *services.WorkspaceService
}

func NewWorkspaceHandler(workspaceService *services.WorkspaceService) *WorkspaceHandler {
	return &WorkspaceHandler{workspaceService: workspaceService}
}

type CreateWorkspaceRequest struct {
	Name string `json:"name" binding:"required"`
}

type InviteRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (h *WorkspaceHandler) List(c *gin.Context) {
	userID := c.MustGet("userID").(uint)

	workspaces, err := h.workspaceService.FindByUserID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch workspaces"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workspaces": workspaces})
}

func (h *WorkspaceHandler) Create(c *gin.Context) {
	userID := c.MustGet("userID").(uint)

	var req CreateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	workspace, err := h.workspaceService.Create(req.Name, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create workspace"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"workspace": workspace})
}

func (h *WorkspaceHandler) Get(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	workspace, err := h.workspaceService.FindByID(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workspace": workspace})
}

func (h *WorkspaceHandler) GetMembers(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	members, err := h.workspaceService.GetMembers(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch members"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"members": members})
}

func (h *WorkspaceHandler) CreateInvite(c *gin.Context) {
	userID := c.MustGet("userID").(uint)
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req InviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	role := req.Role
	if role == "" {
		role = "member"
	}

	invite, err := h.workspaceService.CreateInvite(uint(workspaceID), userID, req.Email, role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create invite"})
		return
	}

	baseURL := configs.GetEnvOrDefault("BASE_URL", "http://localhost:5173")
	inviteLink := baseURL + "/join/" + invite.Token

	c.JSON(http.StatusCreated, gin.H{
		"invite":      invite,
		"invite_link": inviteLink,
	})
}

func (h *WorkspaceHandler) JoinByToken(c *gin.Context) {
	userID := c.MustGet("userID").(uint)
	token := c.Param("token")

	workspace, membership, err := h.workspaceService.AcceptInvite(token, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"workspace":  workspace,
		"membership": membership,
	})
}

func (h *WorkspaceHandler) RemoveMember(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	memberUserID, _ := strconv.ParseUint(c.Param("user_id"), 10, 32)

	// Check if requester has permission (owner or admin)
	requesterID := c.MustGet("userID").(uint)
	isMember, role, _ := h.workspaceService.IsMember(uint(workspaceID), requesterID)
	if !isMember || (role != "owner" && role != "admin") {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions"})
		return
	}

	if err := h.workspaceService.RemoveMember(uint(workspaceID), uint(memberUserID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove member"})
		return
	}

	c.Status(http.StatusNoContent)
}
