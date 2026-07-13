package services

import (
	"time"

	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

type AreaService struct {
	db *gorm.DB
}

func NewAreaService(db *gorm.DB) *AreaService {
	return &AreaService{db: db}
}

func (s *AreaService) List(workspaceID uint) ([]models.Area, error) {
	var areas []models.Area
	err := s.db.Where("workspace_id = ?", workspaceID).Order("name ASC").Find(&areas).Error
	return areas, err
}

func (s *AreaService) Create(area *models.Area) error {
	return s.db.Create(area).Error
}

func (s *AreaService) FindByID(id, workspaceID uint) (*models.Area, error) {
	var area models.Area
	err := s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).First(&area).Error
	return &area, err
}

func (s *AreaService) Update(area *models.Area) error {
	return s.db.Save(area).Error
}

func (s *AreaService) Delete(id, workspaceID uint) error {
	return s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).Delete(&models.Area{}).Error
}

type AreaCategorySummary struct {
	CategoryID   uint    `json:"category_id"`
	CategoryName string  `json:"category_name"`
	Amount       float64 `json:"amount"`
	Count        int     `json:"count"`
}

type AreaSummaryItem struct {
	AreaID     *uint                 `json:"area_id"`
	AreaName   string                `json:"area_name"`
	Color      string                `json:"color"`
	Amount     float64               `json:"amount"`
	Count      int                   `json:"count"`
	Percentage float64               `json:"percentage"`
	Categories []AreaCategorySummary `json:"categories"`
}

type AreaSummaryResponse struct {
	Month      string            `json:"month"`
	TotalSpent float64           `json:"total_spent"`
	Areas      []AreaSummaryItem `json:"areas"`
}

func (s *AreaService) GetMonthlySummary(workspaceID uint, month string) (*AreaSummaryResponse, error) {
	startDate, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, err
	}
	endDate := startDate.AddDate(0, 1, 0)

	// Get all transactions for the month with their categories
	var transactions []struct {
		ID           uint
		Amount       float64
		Category     string
		TxnAreaID    *uint
		CategoryID   *uint
		CategoryArea *uint
	}

	// Query transactions joined with categories to get effective area
	query := `
		SELECT
			t.id,
			COALESCE(t.amount, 0) as amount,
			COALESCE(t.category, '') as category,
			t.area_id as txn_area_id,
			c.id as category_id,
			c.area_id as category_area
		FROM transactions t
		LEFT JOIN categories c ON c.name = t.category AND c.workspace_id = t.workspace_id
		WHERE t.workspace_id = ?
			AND t.date >= ?
			AND t.date < ?
			AND t.type = 'debit'
	`
	s.db.Raw(query, workspaceID, startDate, endDate).Scan(&transactions)

	// Get all areas for the workspace
	areas, _ := s.List(workspaceID)
	areaMap := make(map[uint]*models.Area)
	for i := range areas {
		areaMap[areas[i].ID] = &areas[i]
	}

	// Build summary by area
	type categoryData struct {
		id     uint
		name   string
		amount float64
		count  int
	}
	type areaData struct {
		area       *models.Area
		amount     float64
		count      int
		categories map[string]*categoryData
	}

	areaSummaries := make(map[uint]*areaData)        // keyed by area ID
	uncategorized := &areaData{categories: make(map[string]*categoryData)}

	var totalSpent float64

	for _, txn := range transactions {
		totalSpent += txn.Amount

		// Determine effective area: txn.area_id overrides category.area_id
		var effectiveAreaID *uint
		if txn.TxnAreaID != nil {
			effectiveAreaID = txn.TxnAreaID
		} else if txn.CategoryArea != nil {
			effectiveAreaID = txn.CategoryArea
		}

		var target *areaData
		if effectiveAreaID != nil {
			if _, exists := areaSummaries[*effectiveAreaID]; !exists {
				areaSummaries[*effectiveAreaID] = &areaData{
					area:       areaMap[*effectiveAreaID],
					categories: make(map[string]*categoryData),
				}
			}
			target = areaSummaries[*effectiveAreaID]
		} else {
			target = uncategorized
		}

		target.amount += txn.Amount
		target.count++

		catName := txn.Category
		if catName == "" {
			catName = "Uncategorized"
		}
		if _, exists := target.categories[catName]; !exists {
			target.categories[catName] = &categoryData{
				id:   0,
				name: catName,
			}
			if txn.CategoryID != nil {
				target.categories[catName].id = *txn.CategoryID
			}
		}
		target.categories[catName].amount += txn.Amount
		target.categories[catName].count++
	}

	// Build response
	response := &AreaSummaryResponse{
		Month:      month,
		TotalSpent: totalSpent,
		Areas:      []AreaSummaryItem{},
	}

	for areaID, data := range areaSummaries {
		item := AreaSummaryItem{
			AreaID:     &areaID,
			Amount:     data.amount,
			Count:      data.count,
			Categories: []AreaCategorySummary{},
		}
		if data.area != nil {
			item.AreaName = data.area.Name
			item.Color = data.area.Color
		}
		if totalSpent > 0 {
			item.Percentage = (data.amount / totalSpent) * 100
		}
		for _, cat := range data.categories {
			item.Categories = append(item.Categories, AreaCategorySummary{
				CategoryID:   cat.id,
				CategoryName: cat.name,
				Amount:       cat.amount,
				Count:        cat.count,
			})
		}
		response.Areas = append(response.Areas, item)
	}

	// Add uncategorized if present
	if uncategorized.count > 0 {
		item := AreaSummaryItem{
			AreaID:     nil,
			AreaName:   "Uncategorized",
			Amount:     uncategorized.amount,
			Count:      uncategorized.count,
			Categories: []AreaCategorySummary{},
		}
		if totalSpent > 0 {
			item.Percentage = (uncategorized.amount / totalSpent) * 100
		}
		for _, cat := range uncategorized.categories {
			item.Categories = append(item.Categories, AreaCategorySummary{
				CategoryID:   cat.id,
				CategoryName: cat.name,
				Amount:       cat.amount,
				Count:        cat.count,
			})
		}
		response.Areas = append(response.Areas, item)
	}

	return response, nil
}

// Yearly summary types
type MonthlyAreaAmount struct {
	Month  string  `json:"month"`
	Amount float64 `json:"amount"`
}

type YearlyAreaCategorySummary struct {
	CategoryID   uint    `json:"category_id"`
	CategoryName string  `json:"category_name"`
	Amount       float64 `json:"amount"`
	Count        int     `json:"count"`
}

type YearlyAreaItem struct {
	AreaID     *uint                       `json:"area_id"`
	AreaName   string                      `json:"area_name"`
	Color      string                      `json:"color"`
	Icon       string                      `json:"icon"`
	Amount     float64                     `json:"amount"`
	Monthly    []MonthlyAreaAmount         `json:"monthly"`
	Categories []YearlyAreaCategorySummary `json:"categories"`
}

type YearlyAreaSummaryResponse struct {
	Year       string           `json:"year"`
	TotalSpent float64          `json:"total_spent"`
	Areas      []YearlyAreaItem `json:"areas"`
}

func (s *AreaService) GetYearlySummary(workspaceID uint, year string) (*YearlyAreaSummaryResponse, error) {
	startDate, err := time.Parse("2006", year)
	if err != nil {
		return nil, err
	}
	endDate := startDate.AddDate(1, 0, 0)

	// Get all transactions for the year with their categories
	var transactions []struct {
		ID           uint
		Amount       float64
		Category     string
		TxnAreaID    *uint
		CategoryID   *uint
		CategoryArea *uint
		Month        string
	}

	query := `
		SELECT
			t.id,
			COALESCE(t.amount, 0) as amount,
			COALESCE(t.category, '') as category,
			t.area_id as txn_area_id,
			c.id as category_id,
			c.area_id as category_area,
			DATE_FORMAT(t.date, '%Y-%m') as month
		FROM transactions t
		LEFT JOIN categories c ON c.name = t.category AND c.workspace_id = t.workspace_id
		WHERE t.workspace_id = ?
			AND t.date >= ?
			AND t.date < ?
			AND t.type = 'debit'
	`
	s.db.Raw(query, workspaceID, startDate, endDate).Scan(&transactions)

	// Get all areas for the workspace
	areas, _ := s.List(workspaceID)
	areaMap := make(map[uint]*models.Area)
	for i := range areas {
		areaMap[areas[i].ID] = &areas[i]
	}

	// Build monthly template
	monthlyTemplate := make([]MonthlyAreaAmount, 12)
	for i := range monthlyTemplate {
		monthlyTemplate[i] = MonthlyAreaAmount{
			Month:  startDate.AddDate(0, i, 0).Format("2006-01"),
			Amount: 0,
		}
	}

	// Build summary by area
	type categoryData struct {
		id     uint
		name   string
		amount float64
		count  int
	}
	type areaData struct {
		area       *models.Area
		amount     float64
		monthly    []MonthlyAreaAmount
		categories map[string]*categoryData
	}

	areaSummaries := make(map[uint]*areaData)
	uncategorized := &areaData{
		monthly:    make([]MonthlyAreaAmount, len(monthlyTemplate)),
		categories: make(map[string]*categoryData),
	}
	copy(uncategorized.monthly, monthlyTemplate)

	var totalSpent float64

	for _, txn := range transactions {
		totalSpent += txn.Amount

		// Determine effective area
		var effectiveAreaID *uint
		if txn.TxnAreaID != nil {
			effectiveAreaID = txn.TxnAreaID
		} else if txn.CategoryArea != nil {
			effectiveAreaID = txn.CategoryArea
		}

		var target *areaData
		if effectiveAreaID != nil {
			if _, exists := areaSummaries[*effectiveAreaID]; !exists {
				monthly := make([]MonthlyAreaAmount, len(monthlyTemplate))
				copy(monthly, monthlyTemplate)
				areaSummaries[*effectiveAreaID] = &areaData{
					area:       areaMap[*effectiveAreaID],
					monthly:    monthly,
					categories: make(map[string]*categoryData),
				}
			}
			target = areaSummaries[*effectiveAreaID]
		} else {
			target = uncategorized
		}

		target.amount += txn.Amount

		// Update monthly amount
		txnMonth, err := time.Parse("2006-01", txn.Month)
		if err == nil {
			monthIndex := int(txnMonth.Month()) - 1
			if monthIndex >= 0 && monthIndex < len(target.monthly) {
				target.monthly[monthIndex].Amount += txn.Amount
			}
		}

		// Update category data
		catName := txn.Category
		if catName == "" {
			catName = "Uncategorized"
		}
		if _, exists := target.categories[catName]; !exists {
			target.categories[catName] = &categoryData{name: catName}
			if txn.CategoryID != nil {
				target.categories[catName].id = *txn.CategoryID
			}
		}
		target.categories[catName].amount += txn.Amount
		target.categories[catName].count++
	}

	// Build response
	response := &YearlyAreaSummaryResponse{
		Year:       year,
		TotalSpent: totalSpent,
		Areas:      []YearlyAreaItem{},
	}

	for areaID, data := range areaSummaries {
		item := YearlyAreaItem{
			AreaID:     &areaID,
			Amount:     data.amount,
			Monthly:    data.monthly,
			Categories: []YearlyAreaCategorySummary{},
		}
		if data.area != nil {
			item.AreaName = data.area.Name
			item.Color = data.area.Color
			item.Icon = data.area.Icon
		}
		for _, cat := range data.categories {
			item.Categories = append(item.Categories, YearlyAreaCategorySummary{
				CategoryID:   cat.id,
				CategoryName: cat.name,
				Amount:       cat.amount,
				Count:        cat.count,
			})
		}
		response.Areas = append(response.Areas, item)
	}

	// Add uncategorized if present
	if uncategorized.amount > 0 {
		item := YearlyAreaItem{
			AreaID:     nil,
			AreaName:   "Uncategorized",
			Amount:     uncategorized.amount,
			Monthly:    uncategorized.monthly,
			Categories: []YearlyAreaCategorySummary{},
		}
		for _, cat := range uncategorized.categories {
			item.Categories = append(item.Categories, YearlyAreaCategorySummary{
				CategoryID:   cat.id,
				CategoryName: cat.name,
				Amount:       cat.amount,
				Count:        cat.count,
			})
		}
		response.Areas = append(response.Areas, item)
	}

	return response, nil
}
