package services

import (
	"errors"
	"time"

	"etl-banks-ar/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type WorkspaceService struct {
	db *gorm.DB
}

func NewWorkspaceService(db *gorm.DB) *WorkspaceService {
	return &WorkspaceService{db: db}
}

func (s *WorkspaceService) Create(name string, ownerID uint) (*models.Workspace, error) {
	workspace := &models.Workspace{
		Name:    name,
		OwnerID: ownerID,
	}

	if err := s.db.Create(workspace).Error; err != nil {
		return nil, err
	}

	// Add owner as a member with 'owner' role
	member := &models.WorkspaceMember{
		WorkspaceID: workspace.ID,
		UserID:      ownerID,
		Role:        "owner",
		JoinedAt:    time.Now(),
	}

	if err := s.db.Create(member).Error; err != nil {
		return nil, err
	}

	return workspace, nil
}

func (s *WorkspaceService) FindByID(id uint) (*models.Workspace, error) {
	var workspace models.Workspace
	if err := s.db.First(&workspace, id).Error; err != nil {
		return nil, err
	}
	return &workspace, nil
}

type WorkspaceWithRole struct {
	models.Workspace
	Role string `json:"role"`
}

func (s *WorkspaceService) FindByUserID(userID uint) ([]WorkspaceWithRole, error) {
	var results []WorkspaceWithRole

	err := s.db.Table("workspaces").
		Select("workspaces.*, workspace_members.role").
		Joins("JOIN workspace_members ON workspace_members.workspace_id = workspaces.id").
		Where("workspace_members.user_id = ? AND workspaces.deleted_at IS NULL", userID).
		Scan(&results).Error

	return results, err
}

func (s *WorkspaceService) IsMember(workspaceID, userID uint) (bool, string, error) {
	var member models.WorkspaceMember
	err := s.db.Where("workspace_id = ? AND user_id = ?", workspaceID, userID).First(&member).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, "", nil
		}
		return false, "", err
	}
	return true, member.Role, nil
}

func (s *WorkspaceService) GetMembers(workspaceID uint) ([]models.WorkspaceMember, error) {
	var members []models.WorkspaceMember
	err := s.db.Where("workspace_id = ?", workspaceID).Preload("User").Find(&members).Error
	return members, err
}

func (s *WorkspaceService) RemoveMember(workspaceID, userID uint) error {
	return s.db.Where("workspace_id = ? AND user_id = ?", workspaceID, userID).Delete(&models.WorkspaceMember{}).Error
}

func (s *WorkspaceService) CreateInvite(workspaceID, invitedBy uint, email, role string) (*models.WorkspaceInvite, error) {
	token := uuid.New().String()

	invite := &models.WorkspaceInvite{
		WorkspaceID: workspaceID,
		Email:       email,
		Token:       token,
		InvitedBy:   invitedBy,
		Role:        role,
		ExpiresAt:   time.Now().Add(7 * 24 * time.Hour), // 7 days
	}

	if err := s.db.Create(invite).Error; err != nil {
		return nil, err
	}

	return invite, nil
}

func (s *WorkspaceService) AcceptInvite(token string, userID uint) (*models.Workspace, *models.WorkspaceMember, error) {
	var invite models.WorkspaceInvite
	if err := s.db.Where("token = ? AND accepted_at IS NULL AND expires_at > ?", token, time.Now()).First(&invite).Error; err != nil {
		return nil, nil, errors.New("invalid or expired invite")
	}

	// Check if already a member
	isMember, _, _ := s.IsMember(invite.WorkspaceID, userID)
	if isMember {
		return nil, nil, errors.New("already a member of this workspace")
	}

	// Mark invite as accepted
	now := time.Now()
	invite.AcceptedAt = &now
	s.db.Save(&invite)

	// Create membership
	member := &models.WorkspaceMember{
		WorkspaceID: invite.WorkspaceID,
		UserID:      userID,
		Role:        invite.Role,
		JoinedAt:    now,
	}

	if err := s.db.Create(member).Error; err != nil {
		return nil, nil, err
	}

	workspace, _ := s.FindByID(invite.WorkspaceID)
	return workspace, member, nil
}

func (s *WorkspaceService) GetInviteByToken(token string) (*models.WorkspaceInvite, error) {
	var invite models.WorkspaceInvite
	if err := s.db.Where("token = ?", token).First(&invite).Error; err != nil {
		return nil, err
	}
	return &invite, nil
}
