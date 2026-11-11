import { describe, expect, it } from 'vitest';
import type { LocalArea, LocalCategory, LocalRecurringExpense, LocalTransaction } from './db';
import {
  areaMonthlySummary, areaYearlySummary, dueDate, listSummary, monthlySummary, previousMonth, recurringSummary,
  yearlySummary,
} from './summaries';

const base = (clientId: string, lid: number) => ({
  client_id: clientId, workspace_id: 1, lid, server_id: lid, server_updated_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const area = (clientId: string, lid: number, name: string): LocalArea => ({ ...base(clientId, lid), name, color: '#111', icon: 'home' });
const category = (clientId: string, lid: number, name: string, areaClientId: string | null): LocalCategory =>
  ({ ...base(clientId, lid), name, area_client_id: areaClientId, color: '', icon: '' });
let n = 0;
const txn = (date: string, amount: number, type: string, cat: string, areaClientId: string | null = null): LocalTransaction => ({
  ...base(`t${++n}`, n), date, description: '', amount, balance_after: null, type, category: cat, owner: '',
  area_client_id: areaClientId, user_confirmed: false,
});

const areas = [area('a-home', 10, 'Hogar'), area('a-fun', 11, 'Ocio')];
const categories = [category('c-light', 20, 'Luz', 'a-home'), category('c-cine', 21, 'Cine', 'a-fun'), category('c-misc', 22, 'Varios', null)];
const march = [
  txn('2026-03-02', 100, 'debit', 'Luz'),
  txn('2026-03-10', 50, 'debit', 'Cine'),
  txn('2026-03-11', 30, 'debit', 'Varios'),
  txn('2026-03-12', 20, 'debit', ''),
  txn('2026-03-15', 40, 'debit', 'Cine', 'a-home'), // its own area overrides the category's
  txn('2026-03-20', 500, 'credit', 'Sueldo'),
];

describe('transaction summaries', () => {
  it('totals debits and credits for the list header', () => {
    expect(listSummary(march)).toEqual({ total_amount: 740, debit_total: 240, credit_total: 500 });
  });

  it('summarises a month by category, as a share of all movement', () => {
    const summary = monthlySummary('2026-03', march);
    expect(summary).toMatchObject({ total_spending: 240, total_income: 500, net: 260 });
    const cine = summary.by_category.find((c) => c.category === 'Cine')!;
    expect(cine).toMatchObject({ amount: 90, count: 2 });
    expect(cine.percentage).toBeCloseTo((90 / 740) * 100);
  });

  it('summarises a year month by month, spending categories only', () => {
    const summary = yearlySummary('2026', [...march, txn('2026-01-05', 70, 'debit', 'Luz')]);
    expect(summary.monthly).toHaveLength(12);
    expect(summary.monthly[0]).toEqual({ month: '2026-01', spending: 70, income: 0 });
    expect(summary.monthly[2]).toEqual({ month: '2026-03', spending: 240, income: 500 });
    expect(summary.by_category.map((c) => c.category)).toEqual(['Luz', 'Cine', 'Varios', 'Uncategorized']);
    expect(summary.by_category[0].monthly[0].amount).toBe(70);
    expect(summary.by_category.some((c) => c.category === 'Sueldo')).toBe(false);
  });
});

describe('area summaries', () => {
  it('groups spending by effective area, with uncategorized last', () => {
    const summary = areaMonthlySummary('2026-03', march, categories, areas);
    expect(summary.total_spent).toBe(240);
    expect(summary.areas.map((a) => [a.area_id, a.area_name, a.amount, a.count])).toEqual([
      [10, 'Hogar', 140, 2],
      [11, 'Ocio', 50, 1],
      [null, 'Uncategorized', 50, 2],
    ]);
    const home = summary.areas[0];
    expect(home.percentage).toBeCloseTo((140 / 240) * 100);
    expect(home.categories).toEqual([
      { category_id: 20, category_name: 'Luz', amount: 100, count: 1 },
      { category_id: 21, category_name: 'Cine', amount: 40, count: 1 },
    ]);
  });

  it('treats a reference to a deleted area as uncategorized', () => {
    const summary = areaMonthlySummary('2026-03', [txn('2026-03-01', 10, 'debit', 'Luz', 'a-gone')], categories, areas);
    expect(summary.areas).toHaveLength(1);
    expect(summary.areas[0].area_id).toBeNull();
  });

  it('spreads a year over its months', () => {
    const summary = areaYearlySummary('2026', [...march, txn('2026-12-31', 5, 'debit', 'Luz')], categories, areas);
    const home = summary.areas.find((a) => a.area_id === 10)!;
    expect(home.amount).toBe(145);
    expect(home.monthly[2].amount).toBe(140);
    expect(home.monthly[11].amount).toBe(5);
    expect(home.categories.find((c) => c.category_name === 'Luz')!.monthly[11].amount).toBe(5);
  });
});

describe('recurring expenses', () => {
  const expense = (clientId: string, amount: number, createdAt: string): LocalRecurringExpense =>
    ({ ...base(clientId, 1), name: clientId, amount, category_client_id: null, owner: '', due_day: 5, created_at: createdAt });

  it('splits the month into paid and pending, against what existed before it', () => {
    const expenses = [expense('rent', 1000, '2025-12-01T00:00:00'), expense('gym', 200, '2026-03-10T00:00:00')];
    expect(recurringSummary('2026-03', expenses, new Set(['rent']))).toEqual({
      total_monthly: 1200, paid_amount: 1000, pending_amount: 200, previous_month_total: 1000, change_percentage: 20,
    });
  });

  it('books a payment on the due day, clamped to the month', () => {
    expect(dueDate('2026-02', 31)).toBe('2026-02-28');
    expect(dueDate('2028-02', 31)).toBe('2028-02-29');
    expect(dueDate('2026-03', 5)).toBe('2026-03-05');
  });

  it('steps back a month across a year boundary', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-03')).toBe('2026-02');
  });
});
