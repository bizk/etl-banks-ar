# Recurring Expenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring expenses feature for defining monthly expense templates with mark-as-paid functionality that creates transactions.

**Architecture:** Backend follows existing service/handler pattern with GORM model. Frontend adds new page following TransactionsPage patterns with React Query for data fetching.

**Tech Stack:** Go/Gin/GORM (backend), React/TypeScript/TanStack Query/Tailwind (frontend)

---

## File Structure

### Backend (server/internal/)
- **Create:** `models/recurring_expense.go` — GORM model for recurring expenses
- **Create:** `services/recurring_expense.go` — Business logic (CRUD, mark-paid, summary)
- **Create:** `api/handlers/recurring_expense.go` — HTTP handlers
- **Modify:** `api/router.go` — Add routes
- **Modify:** `db/db.go` — Add to migration

### Frontend (app/src/)
- **Modify:** `types/index.ts` — Add RecurringExpense interface
- **Create:** `api/recurringExpenses.ts` — API client
- **Create:** `pages/RecurringExpensesPage.tsx` — Main page component
- **Modify:** `App.tsx` — Add route
- **Modify:** `components/layout/Layout.tsx` — Add nav item

---

## Task 1: Backend Model

**Files:**
- Create: `server/internal/models/recurring_expense.go`

- [ ] **Step 1: Create the recurring expense model**

```go
package models

import "time"

type RecurringExpense struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	WorkspaceID  uint       `gorm:"not null;index" json:"workspace_id"`
	Name         string     `gorm:"size:255;not null" json:"name"`
	Amount       float64    `gorm:"not null" json:"amount"`
	CategoryID   *uint      `json:"category_id"`
	Category     *Category  `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
	Owner        string     `gorm:"size:255" json:"owner"`
	DueDay       int        `gorm:"not null" json:"due_day"`
	LastPaidDate *time.Time `json:"last_paid_date"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// IsPaidThisMonth checks if the expense was marked paid in the current month
func (r *RecurringExpense) IsPaidThisMonth() bool {
	if r.LastPaidDate == nil {
		return false
	}
	now := time.Now()
	return r.LastPaidDate.Year() == now.Year() && r.LastPaidDate.Month() == now.Month()
}
```

- [ ] **Step 2: Add model to database migration**

Edit `server/internal/db/db.go`, add `&models.RecurringExpense{}` to the AutoMigrate call:

```go
err := db.AutoMigrate(
	&models.User{},
	&models.Workspace{},
	&models.WorkspaceMember{},
	&models.WorkspaceInvite{},
	&models.Area{},
	&models.Category{},
	&models.Transaction{},
	&models.RecurringExpense{},
)
```

- [ ] **Step 3: Verify compilation**

Run: `cd server && go build ./...`
Expected: No errors

- [ ] **Step 4: Commit**

Message: "feat(backend): add RecurringExpense model"

---

## Task 2: Backend Service

**Files:**
- Create: `server/internal/services/recurring_expense.go`

- [ ] **Step 1: Create the recurring expense service**

```go
package services

import (
	"database/sql"
	"errors"
	"time"

	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

type RecurringExpenseService struct {
	db *gorm.DB
}

func NewRecurringExpenseService(db *gorm.DB) *RecurringExpenseService {
	return &RecurringExpenseService{db: db}
}

func (s *RecurringExpenseService) List(workspaceID uint) ([]models.RecurringExpense, error) {
	var expenses []models.RecurringExpense
	err := s.db.Preload("Category").Preload("Category.Area").
		Where("workspace_id = ?", workspaceID).
		Order("due_day ASC").
		Find(&expenses).Error
	return expenses, err
}

func (s *RecurringExpenseService) FindByID(id, workspaceID uint) (*models.RecurringExpense, error) {
	var expense models.RecurringExpense
	err := s.db.Preload("Category").Preload("Category.Area").
		Where("id = ? AND workspace_id = ?", id, workspaceID).
		First(&expense).Error
	return &expense, err
}

func (s *RecurringExpenseService) Create(expense *models.RecurringExpense) error {
	if expense.DueDay < 1 || expense.DueDay > 31 {
		return errors.New("due_day must be between 1 and 31")
	}
	if expense.Amount <= 0 {
		return errors.New("amount must be positive")
	}
	return s.db.Create(expense).Error
}

func (s *RecurringExpenseService) Update(expense *models.RecurringExpense) error {
	if expense.DueDay < 1 || expense.DueDay > 31 {
		return errors.New("due_day must be between 1 and 31")
	}
	if expense.Amount <= 0 {
		return errors.New("amount must be positive")
	}
	return s.db.Save(expense).Error
}

func (s *RecurringExpenseService) Delete(id, workspaceID uint) error {
	return s.db.Where("id = ? AND workspace_id = ?", id, workspaceID).
		Delete(&models.RecurringExpense{}).Error
}

type RecurringExpenseSummary struct {
	TotalMonthly        float64 `json:"total_monthly"`
	PaidAmount          float64 `json:"paid_amount"`
	PendingAmount       float64 `json:"pending_amount"`
	PreviousMonthTotal  float64 `json:"previous_month_total"`
	ChangePercentage    float64 `json:"change_percentage"`
}

func (s *RecurringExpenseService) GetSummary(workspaceID uint, month time.Time) (*RecurringExpenseSummary, error) {
	expenses, err := s.List(workspaceID)
	if err != nil {
		return nil, err
	}

	var totalMonthly, paidAmount, pendingAmount float64
	for _, exp := range expenses {
		totalMonthly += exp.Amount
		if exp.IsPaidThisMonth() {
			paidAmount += exp.Amount
		} else {
			pendingAmount += exp.Amount
		}
	}

	// Get previous month total (sum of amounts of expenses that existed then)
	// For simplicity, we use current total as previous since expenses don't change often
	prevMonth := month.AddDate(0, -1, 0)
	var prevTotal float64
	s.db.Model(&models.RecurringExpense{}).
		Where("workspace_id = ? AND created_at <= ?", workspaceID, prevMonth.AddDate(0, 1, 0)).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&prevTotal)

	var changePercentage float64
	if prevTotal > 0 {
		changePercentage = ((totalMonthly - prevTotal) / prevTotal) * 100
	}

	return &RecurringExpenseSummary{
		TotalMonthly:       totalMonthly,
		PaidAmount:         paidAmount,
		PendingAmount:      pendingAmount,
		PreviousMonthTotal: prevTotal,
		ChangePercentage:   changePercentage,
	}, nil
}

func (s *RecurringExpenseService) MarkPaid(id, workspaceID uint) (*models.RecurringExpense, *models.Transaction, error) {
	expense, err := s.FindByID(id, workspaceID)
	if err != nil {
		return nil, nil, err
	}

	// If already paid this month, return idempotently
	if expense.IsPaidThisMonth() {
		return expense, nil, nil
	}

	now := time.Now()

	// Create transaction
	categoryName := ""
	if expense.Category != nil {
		categoryName = expense.Category.Name
	}

	transaction := &models.Transaction{
		WorkspaceID: workspaceID,
		Date:        now,
		Description: sql.NullString{String: expense.Name, Valid: true},
		Amount:      sql.NullFloat64{Float64: expense.Amount, Valid: true},
		Type:        sql.NullString{String: "debit", Valid: true},
		Category:    sql.NullString{String: categoryName, Valid: categoryName != ""},
		Owner:       sql.NullString{String: expense.Owner, Valid: expense.Owner != ""},
	}

	// Use transaction to ensure atomicity
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(transaction).Error; err != nil {
			return err
		}
		expense.LastPaidDate = &now
		return tx.Save(expense).Error
	})

	if err != nil {
		return nil, nil, err
	}

	return expense, transaction, nil
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && go build ./...`
Expected: No errors

- [ ] **Step 3: Commit**

Message: "feat(backend): add RecurringExpenseService with CRUD and mark-paid"

---

## Task 3: Backend Handler

**Files:**
- Create: `server/internal/api/handlers/recurring_expense.go`

- [ ] **Step 1: Create the handler**

```go
package handlers

import (
	"net/http"
	"strconv"
	"time"

	"etl-banks-ar/internal/models"
	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
)

type RecurringExpenseHandler struct {
	service *services.RecurringExpenseService
}

func NewRecurringExpenseHandler(service *services.RecurringExpenseService) *RecurringExpenseHandler {
	return &RecurringExpenseHandler{service: service}
}

type CreateRecurringExpenseRequest struct {
	Name       string  `json:"name" binding:"required"`
	Amount     float64 `json:"amount" binding:"required"`
	CategoryID *uint   `json:"category_id"`
	Owner      string  `json:"owner"`
	DueDay     int     `json:"due_day" binding:"required"`
}

type UpdateRecurringExpenseRequest struct {
	Name       *string  `json:"name"`
	Amount     *float64 `json:"amount"`
	CategoryID *uint    `json:"category_id"`
	Owner      *string  `json:"owner"`
	DueDay     *int     `json:"due_day"`
}

type RecurringExpenseResponse struct {
	ID              uint    `json:"id"`
	WorkspaceID     uint    `json:"workspace_id"`
	Name            string  `json:"name"`
	Amount          float64 `json:"amount"`
	CategoryID      *uint   `json:"category_id"`
	CategoryName    string  `json:"category_name,omitempty"`
	AreaID          *uint   `json:"area_id,omitempty"`
	AreaName        string  `json:"area_name,omitempty"`
	Owner           string  `json:"owner"`
	DueDay          int     `json:"due_day"`
	LastPaidDate    *string `json:"last_paid_date"`
	IsPaidThisMonth bool    `json:"is_paid_this_month"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

func toRecurringExpenseResponse(exp *models.RecurringExpense) RecurringExpenseResponse {
	resp := RecurringExpenseResponse{
		ID:              exp.ID,
		WorkspaceID:     exp.WorkspaceID,
		Name:            exp.Name,
		Amount:          exp.Amount,
		CategoryID:      exp.CategoryID,
		Owner:           exp.Owner,
		DueDay:          exp.DueDay,
		IsPaidThisMonth: exp.IsPaidThisMonth(),
		CreatedAt:       exp.CreatedAt.Format(time.RFC3339),
		UpdatedAt:       exp.UpdatedAt.Format(time.RFC3339),
	}
	if exp.LastPaidDate != nil {
		formatted := exp.LastPaidDate.Format("2006-01-02")
		resp.LastPaidDate = &formatted
	}
	if exp.Category != nil {
		resp.CategoryName = exp.Category.Name
		if exp.Category.Area != nil {
			resp.AreaID = &exp.Category.Area.ID
			resp.AreaName = exp.Category.Area.Name
		}
	}
	return resp
}

func (h *RecurringExpenseHandler) List(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	expenses, err := h.service.List(uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch recurring expenses"})
		return
	}

	responses := make([]RecurringExpenseResponse, len(expenses))
	for i, exp := range expenses {
		responses[i] = toRecurringExpenseResponse(&exp)
	}

	c.JSON(http.StatusOK, gin.H{"recurring_expenses": responses})
}

func (h *RecurringExpenseHandler) GetSummary(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	month := time.Now()
	if monthStr := c.Query("month"); monthStr != "" {
		if parsed, err := time.Parse("2006-01", monthStr); err == nil {
			month = parsed
		}
	}

	summary, err := h.service.GetSummary(uint(workspaceID), month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch summary"})
		return
	}

	c.JSON(http.StatusOK, summary)
}

func (h *RecurringExpenseHandler) Create(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var req CreateRecurringExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	expense := &models.RecurringExpense{
		WorkspaceID: uint(workspaceID),
		Name:        req.Name,
		Amount:      req.Amount,
		CategoryID:  req.CategoryID,
		Owner:       req.Owner,
		DueDay:      req.DueDay,
	}

	if err := h.service.Create(expense); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Reload with associations
	expense, _ = h.service.FindByID(expense.ID, uint(workspaceID))
	c.JSON(http.StatusCreated, gin.H{"recurring_expense": toRecurringExpenseResponse(expense)})
}

func (h *RecurringExpenseHandler) Get(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	expense, err := h.service.FindByID(uint(expenseID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recurring expense not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"recurring_expense": toRecurringExpenseResponse(expense)})
}

func (h *RecurringExpenseHandler) Update(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	expense, err := h.service.FindByID(uint(expenseID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recurring expense not found"})
		return
	}

	var req UpdateRecurringExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil {
		expense.Name = *req.Name
	}
	if req.Amount != nil {
		expense.Amount = *req.Amount
	}
	if req.CategoryID != nil {
		expense.CategoryID = req.CategoryID
	}
	if req.Owner != nil {
		expense.Owner = *req.Owner
	}
	if req.DueDay != nil {
		expense.DueDay = *req.DueDay
	}

	if err := h.service.Update(expense); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Reload with associations
	expense, _ = h.service.FindByID(expense.ID, uint(workspaceID))
	c.JSON(http.StatusOK, gin.H{"recurring_expense": toRecurringExpenseResponse(expense)})
}

func (h *RecurringExpenseHandler) Delete(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	if err := h.service.Delete(uint(expenseID), uint(workspaceID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete recurring expense"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *RecurringExpenseHandler) MarkPaid(c *gin.Context) {
	workspaceID, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	expenseID, _ := strconv.ParseUint(c.Param("re_id"), 10, 32)

	expense, transaction, err := h.service.MarkPaid(uint(expenseID), uint(workspaceID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response := gin.H{"recurring_expense": toRecurringExpenseResponse(expense)}
	if transaction != nil {
		response["transaction"] = transaction
	}

	c.JSON(http.StatusOK, response)
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && go build ./...`
Expected: No errors

- [ ] **Step 3: Commit**

Message: "feat(backend): add RecurringExpenseHandler with all endpoints"

---

## Task 4: Wire Up Backend Routes

**Files:**
- Modify: `server/internal/api/router.go`

- [ ] **Step 1: Add service and handler initialization**

After line 24 (after `areaService := services.NewAreaService(db)`), add:

```go
recurringExpenseService := services.NewRecurringExpenseService(db)
```

After line 32 (after `areaHandler := ...`), add:

```go
recurringExpenseHandler := handlers.NewRecurringExpenseHandler(recurringExpenseService)
```

- [ ] **Step 2: Add routes**

After line 95 (after the areas routes block, before the closing `}` of workspace group), add:

```go
					// Recurring Expenses CRUD
					workspace.GET("/recurring-expenses", recurringExpenseHandler.List)
					workspace.GET("/recurring-expenses/summary", recurringExpenseHandler.GetSummary)
					workspace.POST("/recurring-expenses", recurringExpenseHandler.Create)
					workspace.GET("/recurring-expenses/:re_id", recurringExpenseHandler.Get)
					workspace.PUT("/recurring-expenses/:re_id", recurringExpenseHandler.Update)
					workspace.DELETE("/recurring-expenses/:re_id", recurringExpenseHandler.Delete)
					workspace.POST("/recurring-expenses/:re_id/mark-paid", recurringExpenseHandler.MarkPaid)
```

- [ ] **Step 3: Verify compilation and run**

Run: `cd server && go build ./...`
Expected: No errors

- [ ] **Step 4: Commit**

Message: "feat(backend): wire up recurring expenses routes"

---

## Task 5: Frontend Types

**Files:**
- Modify: `app/src/types/index.ts`

- [ ] **Step 1: Add RecurringExpense interface**

Add at the end of the file (before the helper functions):

```typescript
export interface RecurringExpense {
  id: number;
  workspace_id: number;
  name: string;
  amount: number;
  category_id: number | null;
  category_name?: string;
  area_id?: number | null;
  area_name?: string;
  owner: string;
  due_day: number;
  last_paid_date: string | null;
  is_paid_this_month: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecurringExpenseSummary {
  total_monthly: number;
  paid_amount: number;
  pending_amount: number;
  previous_month_total: number;
  change_percentage: number;
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd app && npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

Message: "feat(frontend): add RecurringExpense types"

---

## Task 6: Frontend API Client

**Files:**
- Create: `app/src/api/recurringExpenses.ts`

- [ ] **Step 1: Create the API client**

```typescript
import apiClient from './client';
import type { RecurringExpense, RecurringExpenseSummary, Transaction } from '../types';

interface CreateRecurringExpenseRequest {
  name: string;
  amount: number;
  category_id?: number | null;
  owner?: string;
  due_day: number;
}

interface UpdateRecurringExpenseRequest {
  name?: string;
  amount?: number;
  category_id?: number | null;
  owner?: string;
  due_day?: number;
}

export const recurringExpensesApi = {
  list: async (workspaceId: number): Promise<{ recurring_expenses: RecurringExpense[] }> => {
    const response = await apiClient.get<{ recurring_expenses: RecurringExpense[] }>(
      `/workspaces/${workspaceId}/recurring-expenses`
    );
    return response.data;
  },

  getSummary: async (workspaceId: number, month?: string): Promise<RecurringExpenseSummary> => {
    const params = month ? { month } : {};
    const response = await apiClient.get<RecurringExpenseSummary>(
      `/workspaces/${workspaceId}/recurring-expenses/summary`,
      { params }
    );
    return response.data;
  },

  get: async (workspaceId: number, id: number): Promise<{ recurring_expense: RecurringExpense }> => {
    const response = await apiClient.get<{ recurring_expense: RecurringExpense }>(
      `/workspaces/${workspaceId}/recurring-expenses/${id}`
    );
    return response.data;
  },

  create: async (workspaceId: number, data: CreateRecurringExpenseRequest): Promise<{ recurring_expense: RecurringExpense }> => {
    const response = await apiClient.post<{ recurring_expense: RecurringExpense }>(
      `/workspaces/${workspaceId}/recurring-expenses`,
      data
    );
    return response.data;
  },

  update: async (workspaceId: number, id: number, data: UpdateRecurringExpenseRequest): Promise<{ recurring_expense: RecurringExpense }> => {
    const response = await apiClient.put<{ recurring_expense: RecurringExpense }>(
      `/workspaces/${workspaceId}/recurring-expenses/${id}`,
      data
    );
    return response.data;
  },

  delete: async (workspaceId: number, id: number): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/recurring-expenses/${id}`);
  },

  markPaid: async (workspaceId: number, id: number): Promise<{ recurring_expense: RecurringExpense; transaction?: Transaction }> => {
    const response = await apiClient.post<{ recurring_expense: RecurringExpense; transaction?: Transaction }>(
      `/workspaces/${workspaceId}/recurring-expenses/${id}/mark-paid`
    );
    return response.data;
  },
};
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd app && npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

Message: "feat(frontend): add recurring expenses API client"

---

## Task 7: Frontend Page Component

**Files:**
- Create: `app/src/pages/RecurringExpensesPage.tsx`

- [ ] **Step 1: Create the page component**

```typescript
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { recurringExpensesApi } from '../api/recurringExpenses';
import { categoriesApi } from '../api/categories';
import { useWorkspaceStore } from '../store/workspaceSlice';
import type { RecurringExpense, Category } from '../types';
import {
  getCategoryMeta,
  normalizeCategory,
} from '../components/transactions/categoryMeta';

interface RecurringExpenseFormData {
  name: string;
  amount: string;
  category_id: number | null;
  owner: string;
  due_day: string;
}

export function RecurringExpensesPage() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const queryClient = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [formData, setFormData] = useState<RecurringExpenseFormData>({
    name: '',
    amount: '',
    category_id: null,
    owner: '',
    due_day: '',
  });

  const { data: expensesData, isLoading } = useQuery({
    queryKey: ['recurringExpenses', currentWorkspace?.id],
    queryFn: () => recurringExpensesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const { data: summaryData } = useQuery({
    queryKey: ['recurringExpensesSummary', currentWorkspace?.id],
    queryFn: () => recurringExpensesApi.getSummary(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categoriesList', currentWorkspace?.id],
    queryFn: () => categoriesApi.list(currentWorkspace!.id),
    enabled: !!currentWorkspace?.id,
  });

  const categoryMap = useMemo(() => {
    const map = new Map<number, Category>();
    categoriesData?.categories?.forEach((cat) => {
      map.set(cat.id, cat);
    });
    return map;
  }, [categoriesData]);

  const getCategoryDisplay = (categoryName: string) => {
    const meta = getCategoryMeta(categoryName);
    return {
      icon: meta.icon,
      badgeClassName: meta.badgeClassName,
    };
  };

  const createMutation = useMutation({
    mutationFn: (data: RecurringExpenseFormData) =>
      recurringExpensesApi.create(currentWorkspace!.id, {
        name: data.name,
        amount: parseFloat(data.amount),
        category_id: data.category_id,
        owner: data.owner || undefined,
        due_day: parseInt(data.due_day),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RecurringExpenseFormData }) =>
      recurringExpensesApi.update(currentWorkspace!.id, id, {
        name: data.name,
        amount: parseFloat(data.amount),
        category_id: data.category_id,
        owner: data.owner || undefined,
        due_day: parseInt(data.due_day),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recurringExpensesApi.delete(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: (id: number) => recurringExpensesApi.markPaid(currentWorkspace!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['recurringExpensesSummary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({ name: '', amount: '', category_id: null, owner: '', due_day: '' });
    setCategorySearch('');
    setShowModal(true);
  };

  const openEditModal = (expense: RecurringExpense) => {
    setEditingId(expense.id);
    setFormData({
      name: expense.name,
      amount: expense.amount.toString(),
      category_id: expense.category_id,
      owner: expense.owner,
      due_day: expense.due_day.toString(),
    });
    setCategorySearch(expense.category_name || '');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setShowCategorySuggestions(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this recurring expense?')) {
      deleteMutation.mutate(id);
    }
  };

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <span className="material-symbols-outlined text-6xl text-on-surface-variant opacity-30 mb-4">workspaces</span>
        <h2 className="text-xl font-headline font-bold text-on-surface-variant">No Workspace Selected</h2>
        <p className="text-on-surface-variant mt-2">Create or select a workspace to get started</p>
      </div>
    );
  }

  const expenses = expensesData?.recurring_expenses || [];
  const summary = summaryData;
  const categories = categoriesData?.categories || [];

  const filteredCategories = categories.filter((cat) =>
    normalizeCategory(cat.name).includes(normalizeCategory(categorySearch))
  );

  return (
    <div>
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">Recurring Expenses</h1>
        <p className="text-on-surface-variant mt-2 font-medium opacity-60">
          Monthly expense templates for {format(new Date(), 'MMMM yyyy')}
        </p>
      </header>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Total Monthly</p>
            <p className="text-xl font-bold">
              ${summary.total_monthly.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Paid</p>
            <p className="text-xl font-bold text-primary">
              ${summary.paid_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">Pending</p>
            <p className="text-xl font-bold text-amber-500">
              ${summary.pending_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">vs Last Month</p>
            <p className={`text-xl font-bold ${summary.change_percentage > 0 ? 'text-error' : 'text-primary'}`}>
              {summary.change_percentage > 0 ? '+' : ''}{summary.change_percentage.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Expenses Table */}
      <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-container"></div>
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl mb-4">event_repeat</span>
            <p>No recurring expenses yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Name</th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Amount</th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Category</th>
                <th className="text-center px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Due Day</th>
                <th className="text-left px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Status</th>
                <th className="text-center px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Action</th>
                <th className="text-right px-6 py-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {expenses.map((expense) => {
                const display = getCategoryDisplay(expense.category_name || '');
                return (
                  <tr key={expense.id} className="hover:bg-surface-container-low/50">
                    <td className="px-6 py-4 text-sm font-medium">{expense.name}</td>
                    <td className="px-6 py-4 text-sm font-bold text-right">
                      ${expense.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4">
                      {expense.category_name && (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${display.badgeClassName}`}>
                          <span className="material-symbols-outlined text-sm">{display.icon}</span>
                          {expense.category_name}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-center text-on-surface-variant">{expense.due_day}</td>
                    <td className="px-6 py-4">
                      {expense.is_paid_this_month ? (
                        <span className="text-primary flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">check_circle</span>
                          Paid
                        </span>
                      ) : (
                        <span className="text-amber-500">Pending</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {expense.is_paid_this_month ? (
                        <span className="text-xs text-on-surface-variant">
                          {expense.last_paid_date && format(new Date(expense.last_paid_date), 'MMM d')}
                        </span>
                      ) : (
                        <button
                          onClick={() => markPaidMutation.mutate(expense.id)}
                          disabled={markPaidMutation.isPending}
                          className="bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openEditModal(expense)}
                        className="text-on-surface-variant hover:text-primary p-1"
                      >
                        <span className="material-symbols-outlined text-xl">edit</span>
                      </button>
                      <button
                        onClick={() => handleDelete(expense.id)}
                        className="text-on-surface-variant hover:text-error p-1 ml-2"
                      >
                        <span className="material-symbols-outlined text-xl">delete</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Add Button */}
        <div className="p-4 border-t border-surface-container-low">
          <button
            onClick={openCreateModal}
            className="w-full bg-primary-container text-white font-headline font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined">add</span>
            Add Expense
          </button>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container-lowest rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-headline font-bold mb-6">
              {editingId ? 'Edit Recurring Expense' : 'New Recurring Expense'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="e.g., Netflix, Rent, Gym"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Category</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <span className="material-symbols-outlined text-on-surface-variant">category</span>
                  </div>
                  <input
                    type="text"
                    value={categorySearch}
                    onChange={(e) => {
                      setCategorySearch(e.target.value);
                      setFormData({ ...formData, category_id: null });
                      setShowCategorySuggestions(true);
                    }}
                    onFocus={() => setShowCategorySuggestions(true)}
                    onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 120)}
                    className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-12 pr-4"
                    placeholder="Search categories"
                  />
                  {showCategorySuggestions && filteredCategories.length > 0 && (
                    <div className="absolute z-10 mt-2 max-h-48 w-full overflow-y-auto rounded-xl border border-surface-container bg-surface-container-lowest p-2 shadow-xl">
                      {filteredCategories.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setFormData({ ...formData, category_id: category.id });
                            setCategorySearch(category.name);
                            setShowCategorySuggestions(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-container-low"
                        >
                          <span className="text-sm font-medium">{category.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Due Day of Month</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <span className="material-symbols-outlined text-on-surface-variant">calendar_today</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={formData.due_day}
                    onChange={(e) => setFormData({ ...formData, due_day: e.target.value })}
                    className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-12 pr-4"
                    placeholder="1-31"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Owner</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <span className="material-symbols-outlined text-on-surface-variant">person</span>
                  </div>
                  <input
                    type="text"
                    value={formData.owner}
                    onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                    className="w-full rounded-lg border-none bg-surface-container-low py-3 pl-12 pr-4"
                    placeholder="Who is responsible?"
                  />
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-3 rounded-xl border border-surface-container font-medium hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {editingId ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd app && npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

Message: "feat(frontend): add RecurringExpensesPage component"

---

## Task 8: Wire Up Frontend Routes and Navigation

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/layout/Layout.tsx`

- [ ] **Step 1: Add import and route in App.tsx**

Add import after line 10:
```typescript
import { RecurringExpensesPage } from './pages/RecurringExpensesPage';
```

Add route after line 24 (after `/areas` route):
```typescript
            <Route path="/recurring" element={<RecurringExpensesPage />} />
```

- [ ] **Step 2: Add nav item in Layout.tsx**

Update the `navItems` array (around line 9) to include recurring:

```typescript
const navItems = [
  { path: '/', icon: 'dashboard', label: 'Overview' },
  { path: '/transactions', icon: 'receipt_long', label: 'Records' },
  { path: '/recurring', icon: 'event_repeat', label: 'Recurring' },
  { path: '/insights', icon: 'analytics', label: 'Insights' },
  { path: '/areas', icon: 'category', label: 'Areas' },
  { path: '/workspaces', icon: 'workspaces', label: 'Workspaces' },
];
```

- [ ] **Step 3: Verify the app runs**

Run: `cd app && npm run dev`
Expected: App starts, navigate to /recurring, page renders

- [ ] **Step 4: Commit**

Message: "feat(frontend): add recurring expenses route and navigation"

---

## Task 9: Integration Testing

- [ ] **Step 1: Start the backend**

Run: `cd server && go run ./cmd`
Expected: Server starts on port 8080

- [ ] **Step 2: Start the frontend**

Run: `cd app && npm run dev`
Expected: App starts on port 5173

- [ ] **Step 3: Manual integration test**

1. Login to the app
2. Navigate to "Recurring" in the sidebar
3. Click "Add Expense" and create a recurring expense
4. Verify it appears in the list
5. Click "Mark Paid" on a pending expense
6. Verify status changes to "Paid"
7. Navigate to "Records" and verify the transaction was created
8. Go back to "Recurring" and edit the expense
9. Delete the expense and verify it's removed

- [ ] **Step 4: Final commit**

Message: "feat: complete recurring expenses feature"
