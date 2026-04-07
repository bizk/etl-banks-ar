package models

import "time"

type Category struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	WorkspaceID uint      `gorm:"uniqueIndex:idx_ws_cat_name;not null" json:"workspace_id"`
	Name        string    `gorm:"size:255;uniqueIndex:idx_ws_cat_name;not null" json:"name"`
	AreaID      *uint     `json:"area_id"`
	Area        *Area     `gorm:"foreignKey:AreaID" json:"area,omitempty"`
	Color       string    `gorm:"size:50" json:"color"`
	Icon        string    `gorm:"size:100" json:"icon"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
