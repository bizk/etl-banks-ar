package models

import (
	"time"

	"gorm.io/gorm"
)

type Workspace struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Name      string         `gorm:"not null" json:"name"`
	OwnerID   uint           `gorm:"not null;index" json:"owner_id"`
	Owner     User           `gorm:"foreignKey:OwnerID" json:"-"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type WorkspaceMember struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	WorkspaceID uint      `gorm:"uniqueIndex:idx_ws_user;not null" json:"workspace_id"`
	Workspace   Workspace `gorm:"foreignKey:WorkspaceID" json:"-"`
	UserID      uint      `gorm:"uniqueIndex:idx_ws_user;not null" json:"user_id"`
	User        User      `gorm:"foreignKey:UserID" json:"-"`
	Role        string    `gorm:"default:'member'" json:"role"` // owner, admin, member
	JoinedAt    time.Time `json:"joined_at"`
}

type WorkspaceInvite struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	WorkspaceID uint       `gorm:"not null;index" json:"workspace_id"`
	Workspace   Workspace  `gorm:"foreignKey:WorkspaceID" json:"-"`
	Email       string     `gorm:"type:varchar(255)" json:"email"`
	Token       string     `gorm:"type:varchar(255);uniqueIndex" json:"-"`
	InvitedBy   uint       `json:"invited_by"`
	Role        string     `gorm:"type:varchar(50);default:'member'" json:"role"`
	ExpiresAt   time.Time  `json:"expires_at"`
	AcceptedAt  *time.Time `json:"accepted_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}
