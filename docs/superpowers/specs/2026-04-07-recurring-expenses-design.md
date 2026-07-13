# Recurring Expenses Feature Design

## Overview

Add a recurring expenses feature that allows users to define monthly expense templates (e.g., rent, subscriptions, utilities) and track their payment status each month. When marked as paid, the system automatically creates a transaction with the predefined values.

## Requirements Summary

- **Templates**: Define recurring expenses with name, amount, category, due day, and owner
- **Monthly Status**: View which recurring expenses are paid vs pending for the current month
- **Mark as Paid**: One-click action that creates a transaction with template values
- **Auto-skip**: If a month passes without marking paid, it automatically moves on (no overdue tracking)
- **Integration**: Uses existing category/area system for seamless dashboard/insights integration
- **Summary Stats**: Show total amount, paid vs pending, and percentage change from last month

## Data Model

### `recurring_expenses` Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `workspace_id` | UUID | FK to workspaces |
| `name` | VARCHAR(255) | Expense name (e.g., "Netflix", "Rent") |
| `amount` | DECIMAL(10,2) | Monthly amount |
| `category_id` | UUID (nullable) | FK to categories (area derived from category) |
| `owner` | VARCHAR(255) | Person responsible |
| `due_day` | INT | Day of month (1-31) |
| `last_paid_date` | DATE (nullable) | Last time marked as paid |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### Payment Status Logic

- **Is paid this month?**: Check if `last_paid_date` is within the current month/year
- **Mark as paid**: Set `last_paid_date` to today, create transaction

## API Endpoints

Base path: `/api/v1/workspaces/:workspace_id`

### List Recurring Expenses
```
GET /recurring-expenses
```
Returns all recurring expenses with computed `is_paid_this_month` status.

Response:
```json
{
  "recurring_expenses": [
    {
      "id": "uuid",
      "name": "Netflix",
      "amount": 15.00,
      "category_id": "uuid",
      "category_name": "Entertainment",
      "area_id": "uuid",          // derived from category
      "area_name": "Subscriptions",
      "owner": "John",
      "due_day": 5,
      "last_paid_date": "2026-04-05",
      "is_paid_this_month": true
    }
  ]
}
```

### Get Summary
```
GET /recurring-expenses/summary?month=2026-04
```
Response:
```json
{
  "total_monthly": 2450.00,
  "paid_amount": 1850.00,
  "pending_amount": 600.00,
  "previous_month_total": 2330.00,
  "change_percentage": 5.15
}
```

### Create Recurring Expense
```
POST /recurring-expenses
```
Body:
```json
{
  "name": "Netflix",
  "amount": 15.00,
  "category_id": "uuid",
  "owner": "John",
  "due_day": 5
}
```

### Update Recurring Expense
```
PUT /recurring-expenses/:id
```
Body: Same as create (partial updates allowed)

### Delete Recurring Expense
```
DELETE /recurring-expenses/:id
```

### Mark as Paid
```
POST /recurring-expenses/:id/mark-paid
```
Creates a transaction with:
- `date`: Today's date
- `description`: Recurring expense name
- `amount`: Recurring expense amount
- `type`: "debit"
- `category`: Recurring expense category
- `owner`: Recurring expense owner

Updates `last_paid_date` to today.

Response:
```json
{
  "recurring_expense": { ... },
  "transaction": { ... }
}
```

## Frontend

### New Route
- Path: `/recurring`
- Nav item: "Recurring" in sidebar

### Page Layout

#### Summary Section (Top)
Four stat cards in a row:
1. **Total Monthly** — Sum of all recurring expense amounts
2. **Paid** — Sum of paid recurring expenses (green)
3. **Pending** — Sum of pending recurring expenses (amber)
4. **vs Last Month** — Percentage change in total (red if increase, green if decrease)

#### Recurring Expenses List
Table with columns:
- Name
- Amount
- Category (badge with icon/color)
- Due Day (number only, no ordinal suffix)
- Status (✓ Paid with date, or "Pending")
- Action (Mark Paid button for pending items, or paid date)
- Edit/Delete buttons

#### Add Button
Full-width "+ Add Expense" button at the bottom of the list.

### Add/Edit Modal

Form fields (matching existing transaction form style):
1. **Name** — Text input
2. **Amount** — Number input with 0.01 step
3. **Category** — Autocomplete dropdown (same as transactions)
4. **Due Day of Month** — Number input (1-31) with calendar icon
5. **Owner** — Text input with person icon

Buttons: Cancel (outlined) | Create/Save (primary)

## Component Structure

```
app/src/
├── pages/
│   └── RecurringExpensesPage.tsx    # Main page
├── api/
│   └── recurringExpenses.ts         # API client
├── types/
│   └── index.ts                     # Add RecurringExpense interface
```

## Backend Structure

```
server/internal/
├── models/
│   └── recurring_expense.go         # GORM model
├── services/
│   └── recurring_expense.go         # Business logic
├── api/handlers/
│   └── recurring_expense.go         # HTTP handlers
```

## Error Handling

- 404 if recurring expense not found
- 400 if due_day is outside 1-31 range
- 400 if amount is negative or zero
- Already paid this month: Return success with existing data (idempotent)

## Testing Considerations

- Unit tests for payment status logic (is_paid_this_month calculation)
- Unit tests for month boundary cases (last day of month, February edge cases)
- Integration tests for mark-paid creating transaction correctly
- API tests for CRUD operations
