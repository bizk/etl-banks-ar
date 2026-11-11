import type {
  CategorySummary, MonthlySummary, RecurringExpenseSummary, TransactionSummary, YearlyAreaSummary,
  YearlyCategorySummary, YearlySummary,
} from '../types';
import type { AreaSummaryResponse } from '../api/areas';
import type { LocalArea, LocalCategory, LocalRecurringExpense, LocalTransaction } from './db';

// Aggregations the server computes in SQL, reproduced over the local copy so that totals
// include changes made offline. Each mirrors its server counterpart in
// server/internal/services (transaction.go, area.go, recurring_expense.go).

const UNCATEGORIZED = 'Uncategorized';

const monthOf = (date: string) => date.slice(0, 7);

export function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

export function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`;
}

function totals(transactions: LocalTransaction[]) {
  let debit = 0;
  let credit = 0;
  for (const t of transactions) {
    if (t.type === 'debit') debit += t.amount;
    else if (t.type === 'credit') credit += t.amount;
  }
  return { debit, credit };
}

export function listSummary(monthTransactions: LocalTransaction[]): TransactionSummary {
  const { debit, credit } = totals(monthTransactions);
  return { total_amount: debit + credit, debit_total: debit, credit_total: credit };
}

export function monthlySummary(month: string, monthTransactions: LocalTransaction[]): MonthlySummary {
  const { debit, credit } = totals(monthTransactions);
  const total = debit + credit;
  const byCategory = new Map<string, CategorySummary>();
  for (const t of monthTransactions) {
    let entry = byCategory.get(t.category);
    if (!entry) {
      entry = { category: t.category, amount: 0, count: 0, percentage: 0 };
      byCategory.set(t.category, entry);
    }
    entry.amount += t.amount;
    entry.count += 1;
  }
  const categories = [...byCategory.values()];
  for (const c of categories) c.percentage = total > 0 ? (c.amount / total) * 100 : 0;
  return { month, total_spending: debit, total_income: credit, net: credit - debit, by_category: categories };
}

export function yearlySummary(year: string, yearTransactions: LocalTransaction[]): YearlySummary {
  const months = monthsOfYear(year);
  const { debit, credit } = totals(yearTransactions);
  const monthly = months.map((month) => ({ month, spending: 0, income: 0 }));
  const byCategory = new Map<string, YearlyCategorySummary>();

  for (const t of yearTransactions) {
    const index = months.indexOf(monthOf(t.date));
    if (index < 0) continue;
    if (t.type === 'debit') monthly[index].spending += t.amount;
    else if (t.type === 'credit') monthly[index].income += t.amount;
    if (t.type !== 'debit') continue;

    const name = t.category || UNCATEGORIZED;
    let entry = byCategory.get(name);
    if (!entry) {
      entry = { category: name, amount: 0, monthly: months.map((month) => ({ month, amount: 0 })) };
      byCategory.set(name, entry);
    }
    entry.amount += t.amount;
    entry.monthly[index].amount += t.amount;
  }

  return {
    year,
    total_spending: debit,
    total_income: credit,
    net: credit - debit,
    monthly,
    by_category: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
  };
}

interface AreaBucket {
  area: LocalArea | null;
  amount: number;
  count: number;
  monthly: { month: string; amount: number }[];
  categories: Map<string, { id: number; name: string; amount: number; count: number; monthly: { month: string; amount: number }[] }>;
}

/**
 * Groups debit transactions by area, then by category. A transaction's own area wins over
 * its category's; with neither (or with an area that no longer exists) it is uncategorized.
 */
function bucketByArea(transactions: LocalTransaction[], categories: LocalCategory[], areas: LocalArea[], months: string[]) {
  const areaByClientId = new Map(areas.map((a) => [a.client_id, a]));
  const categoryByName = new Map(categories.map((c) => [c.name, c]));
  const buckets = new Map<string, AreaBucket>();
  const emptyMonthly = () => months.map((month) => ({ month, amount: 0 }));
  let total = 0;

  for (const t of transactions) {
    if (t.type !== 'debit') continue;
    total += t.amount;
    const category = categoryByName.get(t.category);
    const area = areaByClientId.get(t.area_client_id ?? category?.area_client_id ?? '') ?? null;
    const key = area?.client_id ?? '';

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { area, amount: 0, count: 0, monthly: emptyMonthly(), categories: new Map() };
      buckets.set(key, bucket);
    }
    const monthIndex = months.indexOf(monthOf(t.date));
    bucket.amount += t.amount;
    bucket.count += 1;
    if (monthIndex >= 0) bucket.monthly[monthIndex].amount += t.amount;

    const name = t.category || UNCATEGORIZED;
    let cat = bucket.categories.get(name);
    if (!cat) {
      cat = { id: category?.lid ?? 0, name, amount: 0, count: 0, monthly: emptyMonthly() };
      bucket.categories.set(name, cat);
    }
    cat.amount += t.amount;
    cat.count += 1;
    if (monthIndex >= 0) cat.monthly[monthIndex].amount += t.amount;
  }

  // Real areas first, uncategorized last, as the server returns them.
  const ordered = [...buckets.values()].sort((a, b) => Number(a.area === null) - Number(b.area === null));
  return { total, buckets: ordered };
}

export function areaMonthlySummary(
  month: string, monthTransactions: LocalTransaction[], categories: LocalCategory[], areas: LocalArea[],
): AreaSummaryResponse {
  const { total, buckets } = bucketByArea(monthTransactions, categories, areas, [month]);
  return {
    month,
    total_spent: total,
    areas: buckets.map((b) => ({
      area_id: b.area?.lid ?? null,
      area_name: b.area?.name ?? UNCATEGORIZED,
      color: b.area?.color ?? '',
      icon: b.area?.icon ?? '',
      amount: b.amount,
      count: b.count,
      percentage: total > 0 ? (b.amount / total) * 100 : 0,
      categories: [...b.categories.values()].map((c) => ({
        category_id: c.id, category_name: c.name, amount: c.amount, count: c.count,
      })),
    })),
  };
}

export function areaYearlySummary(
  year: string, yearTransactions: LocalTransaction[], categories: LocalCategory[], areas: LocalArea[],
): YearlyAreaSummary {
  const { total, buckets } = bucketByArea(yearTransactions, categories, areas, monthsOfYear(year));
  return {
    year,
    total_spent: total,
    areas: buckets.map((b) => ({
      area_id: b.area?.lid ?? null,
      area_name: b.area?.name ?? UNCATEGORIZED,
      color: b.area?.color ?? '',
      icon: b.area?.icon ?? '',
      amount: b.amount,
      monthly: b.monthly,
      categories: [...b.categories.values()].map((c) => ({
        category_id: c.id, category_name: c.name, amount: c.amount, count: c.count, monthly: c.monthly,
      })),
    })),
  };
}

export function recurringSummary(
  month: string, expenses: LocalRecurringExpense[], paidClientIds: Set<string>,
): RecurringExpenseSummary {
  let total = 0;
  let paid = 0;
  for (const e of expenses) {
    total += e.amount;
    if (paidClientIds.has(e.client_id)) paid += e.amount;
  }
  // "Previous month" is what already existed when this month began.
  const monthStart = new Date(`${month}-01T00:00:00`).getTime();
  const previous = expenses
    .filter((e) => new Date(e.created_at).getTime() <= monthStart)
    .reduce((sum, e) => sum + e.amount, 0);
  return {
    total_monthly: total,
    paid_amount: paid,
    pending_amount: total - paid,
    previous_month_total: previous,
    change_percentage: previous > 0 ? ((total - previous) / previous) * 100 : 0,
  };
}

/** The date a recurring expense is booked on: its due day, clamped to the month's length. */
export function dueDate(month: string, dueDay: number): string {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return `${month}-${String(Math.min(dueDay, lastDay)).padStart(2, '0')}`;
}
