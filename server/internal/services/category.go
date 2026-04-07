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

func (s *CategoryService) Delete(id, workspaceID uint) error {
	return s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).Delete(&models.Category{}).Error
}

func (s *CategoryService) ListByArea(areaID, workspaceID uint) ([]models.Category, error) {
	var categories []models.Category
	err := s.db.Where("area_id = ? AND workspace_id = ?", areaID, workspaceID).Order("name ASC").Find(&categories).Error
	return categories, err
}
