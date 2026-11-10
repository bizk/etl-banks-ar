import apiClient from './client';
import { db, type LocalTransaction } from '../local/db';
import { byLid, currentUserName, newRow, ofWorkspace, queue, touched, transactionView, write } from '../local/store';
import { listSummary, monthlySummary, yearlySummary } from '../local/summaries';
import { ensureLocalCopy, syncNow } from '../sync/engine';
import type { Transaction, Pagination, TransactionSummary, MonthlySummary, YearlySummary, UploadPreview, PreviewTransaction } from '../types';

interface TransactionListResponse {
  transactions: Transaction[];
  pagination: Pagination;
  summary: TransactionSummary;
}

interface TransactionFilters {
  month: string;
  category?: string[];
  type?: string;
  date_from?: string;
  date_to?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}

interface CreateTransactionInput {
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  category?: string;
  owner?: string;
}

interface UpdateTransactionInput {
  date?: string;
  description?: string;
  amount?: number;
  type?: 'debit' | 'credit';
  category?: string;
  owner?: string;
  user_confirmed?: boolean;
}

/** Transactions dated within [from, to], both YYYY-MM-DD prefixes, straight from the date index. */
export async function transactionsBetween(workspaceId: number, from: string, to: string): Promise<LocalTransaction[]> {
  await ensureLocalCopy(workspaceId);
  return db.transactions.where('[workspace_id+date]').between([workspaceId, from], [workspaceId, `${to}\uffff`], true, true).toArray();
}

export const transactionsInMonth = (workspaceId: number, month: string) =>
  transactionsBetween(workspaceId, `${month}-01`, `${month}-31`);

export const transactionsInYear = (workspaceId: number, year: string) =>
  transactionsBetween(workspaceId, `${year}-01-01`, `${year}-12-31`);

function applyInput(row: LocalTransaction, data: UpdateTransactionInput): void {
  if (data.date !== undefined) row.date = data.date.slice(0, 10);
  if (data.description !== undefined) row.description = data.description;
  if (data.amount !== undefined) row.amount = data.amount;
  if (data.type !== undefined) row.type = data.type;
  if (data.category !== undefined) row.category = data.category.trim();
  if (data.owner !== undefined) row.owner = data.owner.trim();
  if (data.user_confirmed !== undefined) row.user_confirmed = data.user_confirmed;
}

async function updateLocal(workspaceId: number, id: number, data: UpdateTransactionInput): Promise<LocalTransaction> {
  const row = await byLid<LocalTransaction>('transaction', workspaceId, id);
  applyInput(row, data);
  Object.assign(row, touched());
  await db.transactions.put(row);
  await queue(workspaceId, 'transaction', 'upsert', row.client_id);
  return row;
}

// Reads and writes go to the local database; the sync engine carries them to the server.
// Only the PDF import talks to the server directly.
export const transactionsApi = {
  list: async (workspaceId: number, filters: TransactionFilters): Promise<TransactionListResponse> => {
    const inMonth = await transactionsInMonth(workspaceId, filters.month);
    const categories = filters.category?.filter(Boolean) ?? [];
    const rows = inMonth.filter((t) =>
      (!filters.date_from || t.date >= filters.date_from)
      && (!filters.date_to || t.date <= filters.date_to)
      && (categories.length === 0 || categories.includes(t.category))
      && (!filters.type || t.type === filters.type));

    const direction = filters.order === 'asc' ? 1 : -1;
    const key = (filters.sort ?? 'date') as keyof LocalTransaction;
    const compare = (a: unknown, b: unknown) => (a === b ? 0 : (a ?? '') < (b ?? '') ? -1 : 1);
    rows.sort((a, b) => direction * (compare(a[key], b[key]) || compare(a.created_at, b.created_at)));

    const page = Math.max(filters.page ?? 1, 1);
    const perPage = filters.per_page && filters.per_page > 0 ? filters.per_page : 20;
    return {
      transactions: rows.slice((page - 1) * perPage, page * perPage).map(transactionView),
      pagination: { page, per_page: perPage, total: rows.length, total_pages: Math.ceil(rows.length / perPage) },
      summary: listSummary(inMonth),
    };
  },

  get: async (workspaceId: number, id: number): Promise<{ transaction: Transaction }> => {
    await ensureLocalCopy(workspaceId);
    return { transaction: transactionView(await byLid<LocalTransaction>('transaction', workspaceId, id)) };
  },

  create: async (workspaceId: number, data: CreateTransactionInput): Promise<{ transaction: Transaction }> => {
    const row: LocalTransaction = {
      ...newRow(workspaceId), date: '', description: '', amount: 0, balance_after: null, type: 'debit',
      category: '', owner: '', area_client_id: null, user_confirmed: false,
    };
    applyInput(row, data);
    if (!row.owner) row.owner = currentUserName();
    await write(async () => {
      await db.transactions.add(row);
      await queue(workspaceId, 'transaction', 'upsert', row.client_id);
    });
    return { transaction: transactionView(row) };
  },

  update: async (workspaceId: number, id: number, data: UpdateTransactionInput): Promise<{ transaction: Transaction }> => {
    const row = await write(() => updateLocal(workspaceId, id, data));
    return { transaction: transactionView(row) };
  },

  bulkUpdate: async (
    workspaceId: number,
    transactions: Array<UpdateTransactionInput & { id: number }>
  ): Promise<{ updated: number; transactions: Transaction[] }> => {
    // One transaction, so a bad row leaves the others untouched, as the server's bulk edit does.
    const rows = await write(async () => {
      const updated: LocalTransaction[] = [];
      for (const { id, ...data } of transactions) updated.push(await updateLocal(workspaceId, id, data));
      return updated;
    });
    return { updated: rows.length, transactions: rows.map(transactionView) };
  },

  delete: async (workspaceId: number, id: number): Promise<void> => {
    await write(async () => {
      const row = await byLid<LocalTransaction>('transaction', workspaceId, id);
      await db.transactions.delete(row.client_id);
      await queue(workspaceId, 'transaction', 'delete', row.client_id);
    });
  },

  getSummary: async (workspaceId: number, month: string): Promise<{ summary: MonthlySummary }> => {
    return { summary: monthlySummary(month, await transactionsInMonth(workspaceId, month)) };
  },

  getYearlySummary: async (workspaceId: number, year: string): Promise<{ summary: YearlySummary }> => {
    return { summary: yearlySummary(year, await transactionsInYear(workspaceId, year)) };
  },

  getCategories: async (workspaceId: number): Promise<{ categories: string[] }> => {
    await ensureLocalCopy(workspaceId);
    const categories = await ofWorkspace<{ name: string }>('category', workspaceId);
    return { categories: categories.map((c) => c.name) };
  },

  uploadPDF: async (workspaceId: number, file: File): Promise<{ preview: UploadPreview }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<{ preview: UploadPreview }>(
      `/workspaces/${workspaceId}/transactions/upload`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response.data;
  },

  confirmUpload: async (
    workspaceId: number,
    transactions: Omit<PreviewTransaction, 'temp_id' | 'balance_after'>[]
  ): Promise<{ created_count: number }> => {
    const response = await apiClient.post<{ created_count: number }>(
      `/workspaces/${workspaceId}/transactions/confirm`,
      { transactions }
    );
    // The server created the rows; bring them into the local copy before the UI refetches.
    await syncNow(workspaceId);
    return response.data;
  },
};
