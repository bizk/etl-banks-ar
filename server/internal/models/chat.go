package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

const (
	ChatRoleUser      = "user"
	ChatRoleAssistant = "assistant"
)

// ChatConversation is an AI chat thread owned by a user inside a workspace.
type ChatConversation struct {
	ID          uint          `gorm:"primaryKey" json:"id"`
	WorkspaceID uint          `gorm:"not null;index:idx_chat_ws_user" json:"workspace_id"`
	UserID      uint          `gorm:"not null;index:idx_chat_ws_user" json:"user_id"`
	Title       string        `gorm:"size:255;not null" json:"title"`
	Messages    []ChatMessage `gorm:"foreignKey:ConversationID;constraint:OnDelete:CASCADE" json:"messages,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

// ChatMessage is a single user or assistant turn in a ChatConversation.
// Assistant messages record the data-changing tool actions they performed.
type ChatMessage struct {
	ID             uint        `gorm:"primaryKey" json:"id"`
	ConversationID uint        `gorm:"not null;index" json:"conversation_id"`
	Role           string      `gorm:"size:20;not null" json:"role"`
	Content        string      `gorm:"type:text;not null" json:"content"`
	Actions        ChatActions `gorm:"type:text" json:"actions"`
	CreatedAt      time.Time   `json:"created_at"`
}

// ChatAction records one mutating tool call executed by the assistant.
type ChatAction struct {
	Tool    string         `json:"tool"`
	Summary string         `json:"summary"`
	Count   int            `json:"count"`
	IDs     []uint         `json:"ids,omitempty"`
	Changes map[string]any `json:"changes,omitempty"`
}

// ChatActions is stored as a JSON text column.
type ChatActions []ChatAction

func (a ChatActions) Value() (driver.Value, error) {
	if len(a) == 0 {
		return nil, nil
	}
	b, err := json.Marshal(a)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (a *ChatActions) Scan(value any) error {
	var raw []byte
	switch v := value.(type) {
	case nil:
		*a = nil
		return nil
	case []byte:
		raw = v
	case string:
		raw = []byte(v)
	default:
		return fmt.Errorf("unsupported ChatActions value type %T", value)
	}
	if len(raw) == 0 {
		*a = nil
		return nil
	}
	return json.Unmarshal(raw, a)
}
