package services

import (
	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

type ExchangeRateService struct {
	db *gorm.DB
}

func NewExchangeRateService(db *gorm.DB) *ExchangeRateService {
	return &ExchangeRateService{db: db}
}

func (s *ExchangeRateService) List(workspaceID uint) ([]models.ExchangeRate, error) {
	var rates []models.ExchangeRate
	err := s.db.Where("workspace_id = ?", workspaceID).Order("month DESC").Find(&rates).Error
	return rates, err
}

func (s *ExchangeRateService) GetByMonth(workspaceID uint, month string) (*models.ExchangeRate, error) {
	var rate models.ExchangeRate
	err := s.db.Where("workspace_id = ? AND month = ?", workspaceID, month).First(&rate).Error
	if err != nil {
		return nil, err
	}
	return &rate, nil
}

func (s *ExchangeRateService) Upsert(workspaceID uint, month string, rate float64) (*models.ExchangeRate, error) {
	var exchangeRate models.ExchangeRate

	// Try to find existing record
	err := s.db.Where("workspace_id = ? AND month = ?", workspaceID, month).First(&exchangeRate).Error
	if err == gorm.ErrRecordNotFound {
		// Create new record
		exchangeRate = models.ExchangeRate{
			WorkspaceID: workspaceID,
			Month:       month,
			Rate:        rate,
		}
		err = s.db.Create(&exchangeRate).Error
	} else if err == nil {
		// Update existing record
		exchangeRate.Rate = rate
		err = s.db.Save(&exchangeRate).Error
	}

	if err != nil {
		return nil, err
	}
	return &exchangeRate, nil
}

func (s *ExchangeRateService) Delete(workspaceID uint, month string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Where("workspace_id = ? AND month = ?", workspaceID, month).Delete(&models.ExchangeRate{})
		if res.Error != nil || res.RowsAffected == 0 {
			return res.Error
		}
		return tx.Create(&models.SyncTombstone{WorkspaceID: workspaceID, Entity: models.SyncEntityExchangeRate, Ref: month}).Error
	})
}
