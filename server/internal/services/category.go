package services

import (
	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

type CategoryService struct {
	db *gorm.DB
}

func NewCategoryService(db *gorm.DB) *CategoryService {
	return &CategoryService{db: db}
}

func (s *CategoryService) List(workspaceID uint) ([]models.Category, error) {
	var categories []models.Category
	err := s.db.Preload("Area").Where("workspace_id = ?", workspaceID).Order("name ASC").Find(&categories).Error
	return categories, err
}

func (s *CategoryService) Create(category *models.Category) error {
	return s.db.Create(category).Error
}

func (s *CategoryService) FindByID(id, workspaceID uint) (*models.Category, error) {
	var category models.Category
	err := s.db.Preload("Area").Where("id = ? AND workspace_id = ?", id, workspaceID).First(&category).Error
	return &category, err
}

func (s *CategoryService) FindByName(name string, workspaceID uint) (*models.Category, error) {
	var category models.Category
	err := s.db.Preload("Area").Where("name = ? AND workspace_id = ?", name, workspaceID).First(&category).Error
	return &category, err
}

func (s *CategoryService) Update(category *models.Category) error {
	return s.db.Save(category).Error
}

// UpdatePartial applies only the given columns. Use map values (not structs) so nullable FK columns
// like area_id reliably persist with gorm.DB.Updates without struct Updatable metadata dropping them.
func (s *CategoryService) UpdatePartial(categoryID uint, workspaceID uint, updates map[string]interface{}) error {
	if len(updates) == 0 {
		return nil
	}
	return s.db.Model(&models.Category{}).
		Where("id = ? AND workspace_id = ?", categoryID, workspaceID).
		Updates(updates).
		Error
}

// AreaBelongs reports whether areaID exists within the workspace.
func (s *CategoryService) AreaBelongs(workspaceID uint, areaID uint) (bool, error) {
	var count int64
	err := s.db.Model(&models.Area{}).
		Where("id = ? AND workspace_id = ?", areaID, workspaceID).
		Limit(1).
		Count(&count).Error
	return count > 0, err
}

func (s *CategoryService) Delete(id, workspaceID uint) error {
	return s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).Delete(&models.Category{}).Error
}

func (s *CategoryService) ListByArea(areaID, workspaceID uint) ([]models.Category, error) {
	var categories []models.Category
	err := s.db.Where("area_id = ? AND workspace_id = ?", areaID, workspaceID).Order("name ASC").Find(&categories).Error
	return categories, err
}

// EnsureMissingCategory creates the reserved Missing category row for a workspace when absent.
func (s *CategoryService) EnsureMissingCategory(workspaceID uint) error {
	var count int64
	if err := s.db.Model(&models.Category{}).
		Where("workspace_id = ? AND name = ?", workspaceID, models.MissingCategoryName).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	missing := &models.Category{
		WorkspaceID: workspaceID,
		Name:        models.MissingCategoryName,
	}
	return s.db.Create(missing).Error
}

// BackfillMissingCategories inserts the Missing category for every workspace missing it (existing DBs).
func (s *CategoryService) BackfillMissingCategories() error {
	var workspaces []models.Workspace
	if err := s.db.Find(&workspaces).Error; err != nil {
		return err
	}
	for i := range workspaces {
		if err := s.EnsureMissingCategory(workspaces[i].ID); err != nil {
			return err
		}
	}
	return nil
}
