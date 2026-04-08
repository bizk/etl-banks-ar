export interface User {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

export interface Workspace {
  id: number;
  name: string;
  owner_id: number;
  role?: string;
  created_at: string;
}

export interface WorkspaceMember {
  id: number;
  workspace_id: number;
  user_id: number;
  role: string;
  joined_at: string;
}

export interface WorkspaceInvite {
  id: number;
  workspace_id: number;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}

export interface Transaction {
  id: number;
  workspace_id: number;
  date: string;
  description: { String: string; Valid: boolean } | string;
  amount: { Float64: number; Valid: boolean } | number;
  balance_after?: { Float64: number; Valid: boolean } | number;
  type: { String: string; Valid: boolean } | string;
  category: { String: string; Valid: boolean } | string;
  owner?: { String: string; Valid: boolean } | string;
  user_confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface TransactionSummary {
  total_amount: number;
  debit_total: number;
  credit_total: number;
}

export interface CategorySummary {
  category: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface MonthlySummary {
  month: string;
  total_spending: number;
  total_income: number;
  net: number;
  by_category: CategorySummary[];
}

export interface MonthlyCategoryAmount {
  month: string;
  amount: number;
}

export interface YearlyCategorySummary {
  category: string;
  amount: number;
  monthly: MonthlyCategoryAmount[];
}

export interface YearlySummary {
  year: string;
  total_spending: number;
  total_income: number;
  net: number;
  by_category: YearlyCategorySummary[];
}

export interface PreviewTransaction {
  temp_id: number;
  date: string;
  description: string;
  amount: number;
  balance_after: number;
  type: 'debit' | 'credit';
  category: string;
}

export interface UploadPreviewSummary {
  total_count: number;
  total_debit: number;
  total_credit: number;
}

export interface UploadPreview {
  transactions: PreviewTransaction[];
  summary: UploadPreviewSummary;
  allowed_categories: string[];
}

export interface Area {
  id: number;
  workspace_id: number;
  name: string;
  color: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  workspace_id: number;
  name: string;
  area_id: number | null;
  area?: Area;
  color: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

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

// Helper to extract string value from nullable string
export function getString(val: { String: string; Valid: boolean } | string | null | undefined): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'String' in val && val.Valid) return val.String;
  return '';
}

// Helper to extract number value from nullable float
export function getNumber(val: { Float64: number; Valid: boolean } | number | null | undefined): number {
  if (typeof val === 'number') return val;
  if (val && typeof val === 'object' && 'Float64' in val && val.Valid) return val.Float64;
  return 0;
}
