package models

import "time"

type Area struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	ClientID    string    `gorm:"size:36;uniqueIndex" json:"client_id"`
	WorkspaceID uint      `gorm:"not null;index" json:"workspace_id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	Color       string    `gorm:"size:50" json:"color"`
	Icon        string    `gorm:"size:100" json:"icon"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
