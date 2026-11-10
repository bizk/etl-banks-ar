package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type ChatHandler struct {
	chatService *services.ChatService
}

func NewChatHandler(chatService *services.ChatService) *ChatHandler {
	return &ChatHandler{chatService: chatService}
}

func chatScope(c *gin.Context) (workspaceID, userID uint) {
	ws, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	return uint(ws), c.MustGet("userID").(uint)
}

func parseConversationID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("conv_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return 0, false
	}
	return uint(id), true
}

func respondChatError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, services.ErrConversationNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
	case errors.Is(err, services.ErrChatUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": fallback})
	}
}

func (h *ChatHandler) ListConversations(c *gin.Context) {
	workspaceID, userID := chatScope(c)
	convs, err := h.chatService.ListConversations(workspaceID, userID)
	if err != nil {
		respondChatError(c, err, "Failed to fetch conversations")
		return
	}
	c.JSON(http.StatusOK, gin.H{"conversations": convs})
}

type CreateConversationRequest struct {
	Title string `json:"title"`
}

func (h *ChatHandler) CreateConversation(c *gin.Context) {
	workspaceID, userID := chatScope(c)
	var req CreateConversationRequest
	// Body is optional.
	_ = c.ShouldBindJSON(&req)
	conv, err := h.chatService.CreateConversation(workspaceID, userID, req.Title)
	if err != nil {
		respondChatError(c, err, "Failed to create conversation")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"conversation": conv})
}

func (h *ChatHandler) GetConversation(c *gin.Context) {
	workspaceID, userID := chatScope(c)
	convID, ok := parseConversationID(c)
	if !ok {
		return
	}
	conv, err := h.chatService.GetConversation(convID, workspaceID, userID)
	if err != nil {
		respondChatError(c, err, "Failed to fetch conversation")
		return
	}
	c.JSON(http.StatusOK, gin.H{"conversation": conv})
}

type RenameConversationRequest struct {
	Title string `json:"title" binding:"required"`
}

func (h *ChatHandler) RenameConversation(c *gin.Context) {
	workspaceID, userID := chatScope(c)
	convID, ok := parseConversationID(c)
	if !ok {
		return
	}
	var req RenameConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	conv, err := h.chatService.RenameConversation(convID, workspaceID, userID, req.Title)
	if err != nil {
		respondChatError(c, err, "Failed to rename conversation")
		return
	}
	c.JSON(http.StatusOK, gin.H{"conversation": conv})
}

func (h *ChatHandler) DeleteConversation(c *gin.Context) {
	workspaceID, userID := chatScope(c)
	convID, ok := parseConversationID(c)
	if !ok {
		return
	}
	if err := h.chatService.DeleteConversation(convID, workspaceID, userID); err != nil {
		respondChatError(c, err, "Failed to delete conversation")
		return
	}
	c.Status(http.StatusNoContent)
}

type SendChatMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

func (h *ChatHandler) SendMessage(c *gin.Context) {
	workspaceID, userID := chatScope(c)
	convID, ok := parseConversationID(c)
	if !ok {
		return
	}
	var req SendChatMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.chatService.SendMessage(c.Request.Context(), convID, workspaceID, userID, req.Content)
	if err != nil {
		if errors.Is(err, services.ErrConversationNotFound) || errors.Is(err, services.ErrChatUnavailable) {
			respondChatError(c, err, "")
			return
		}
		log.Printf("chat: send message failed (workspace %d, conversation %d): %v", workspaceID, convID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "The AI model could not answer right now. Please try again."})
		return
	}
	c.JSON(http.StatusOK, result)
}
