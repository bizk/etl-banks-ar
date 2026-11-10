import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api/client', () => ({ default: api, apiClient: api }));

import { QueryObserver } from '@tanstack/react-query';
import { areasApi } from '../api/areas';
import { queryClient } from '../lib/queryClient';
import { categoriesApi } from '../api/categories';
import { recurringExpensesApi } from '../api/recurringExpenses';
import { transactionsApi } from '../api/transactions';
import { cursorKey, db, getMeta } from '../local/db';
import { useAuthStore } from '../store/authSlice';
import { useSyncStore } from '../store/syncSlice';
import { useWorkspaceStore } from '../store/workspaceSlice';
import { discardLocalData, syncNow } from './engine';

const WS = 1;
const SERVER_TIME = '2026-03-10T12:00:00Z';

interface Sent { entity: string; op: string; client_id: string; base_updated_at?: string | null; data?: Record<string, unknown> }

const emptyPull = (cursor = 'c1') => ({
  cursor, has_more: false, areas: [], categories: [], transactions: [], recurring_expenses: [],
  recurring_payments: [], exchange_rates: [], deleted: [],
});
const wireTransaction = (clientId: string, id: number, over: Record<string, unknown> = {}) => ({
  client_id: clientId, id, date: '2026-03-05', description: 'Coto', amount: 100, balance_after: null, type: 'debit',
  category: 'Super', owner: 'Ana', area_client_id: null, user_confirmed: false,
  created_at: SERVER_TIME, updated_at: SERVER_TIME, ...over,
});

/** A server that stores whatever is pushed and echoes it back, like the real one on the happy path. */
function acceptingServer() {
  const sent: Sent[] = [];
  let nextId = 100;
  api.post.mockImplementation(async (url: string, body?: { mutations: Sent[] }) => {
    if (url === '/auth/refresh') return { data: { user: { id: 7, name: 'Ana' }, token: 't2' } };
    sent.push(...body!.mutations);
    return {
      data: {
        results: body!.mutations.map((m) => ({
          client_id: m.client_id,
          status: 'applied',
          row: m.op === 'delete' || m.op === 'mark_paid' ? undefined
            : { client_id: m.client_id, id: nextId++, created_at: SERVER_TIME, updated_at: SERVER_TIME, ...m.data },
          payment: m.op === 'mark_paid'
            ? { recurring_expense_client_id: m.client_id, month: m.data!.month, paid_at: '2026-03-05', transaction_client_id: m.data!.transaction_client_id }
            : undefined,
        })),
      },
    };
  });
  return sent;
}

const unreachable = () => { throw new AxiosError('Network Error'); };

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  await discardLocalData(); // also forgets which user the engine last saw
  useAuthStore.setState({ user: { id: 7, email: 'ana@example.com', name: 'Ana', created_at: '' }, token: 't', isAuthenticated: true });
  useWorkspaceStore.setState({ currentWorkspace: { id: WS, name: 'Casa', owner_id: 7, role: 'owner', created_at: '' } });
  useSyncStore.setState({ status: 'idle', pending: 0, rejected: [], error: null });
  api.get.mockResolvedValue({ data: emptyPull() });
  acceptingServer();
});

describe('pull', () => {
  it('downloads the workspace once, then asks only for changes', async () => {
    api.get.mockResolvedValueOnce({ data: { ...emptyPull('c1'), transactions: [wireTransaction('t-1', 5)] } });
    expect(await syncNow()).toBe(true);

    const { transactions } = await transactionsApi.list(WS, { month: '2026-03' });
    expect(transactions).toMatchObject([{ id: 5, description: 'Coto', amount: 100, pending: false }]);
    expect(await getMeta(cursorKey(WS))).toBe('c1');

    await syncNow();
    expect(api.get).toHaveBeenLastCalledWith(`/workspaces/${WS}/sync`, { params: { since: 'c1' } });
  });

  it('follows has_more until the feed is drained', async () => {
    api.get
      .mockResolvedValueOnce({ data: { ...emptyPull('page|5'), has_more: true, transactions: [wireTransaction('t-1', 5)] } })
      .mockResolvedValueOnce({ data: { ...emptyPull('c2'), transactions: [wireTransaction('t-2', 6)] } });
    await syncNow();
    expect(await db.transactions.count()).toBe(2);
    expect(api.get).toHaveBeenNthCalledWith(2, `/workspaces/${WS}/sync`, { params: { since: 'page|5' } });
  });

  it('drops rows the server deleted and unassigns what pointed at them', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        ...emptyPull(),
        areas: [{ client_id: 'a-1', id: 1, name: 'Hogar', color: '', icon: '', created_at: SERVER_TIME, updated_at: SERVER_TIME }],
        categories: [{ client_id: 'c-1', id: 2, name: 'Luz', area_client_id: 'a-1', color: '', icon: '', created_at: SERVER_TIME, updated_at: SERVER_TIME }],
      },
    });
    await syncNow();
    api.get.mockResolvedValueOnce({ data: { ...emptyPull('c2'), deleted: [{ entity: 'area', ref: 'a-1' }] } });
    await syncNow();

    expect((await areasApi.list(WS)).areas).toEqual([]);
    expect((await categoriesApi.list(WS)).categories).toMatchObject([{ name: 'Luz', area_id: null }]);
  });

  it('does not overwrite a row that still has unsent changes', async () => {
    api.get.mockResolvedValueOnce({ data: { ...emptyPull(), transactions: [wireTransaction('t-1', 5)] } });
    await syncNow();

    api.post.mockImplementation(unreachable);
    await transactionsApi.update(WS, 5, { description: 'edited offline' });
    await syncNow();

    // The server is reachable for reads only, and has a newer version of the same row.
    api.post.mockImplementation(async (url: string) => {
      if (url === '/auth/refresh') return { data: { user: { id: 7 }, token: 't' } };
      return unreachable();
    });
    api.get.mockResolvedValueOnce({ data: { ...emptyPull('c2'), transactions: [wireTransaction('t-1', 5, { description: 'server' })] } });
    await syncNow();

    expect((await db.transactions.get('t-1'))!.description).toBe('edited offline');
  });
});

describe('first load', () => {
  it('does not deadlock with a screen whose first query is waiting for the sync', async () => {
    api.get.mockResolvedValueOnce({ data: { ...emptyPull(), transactions: [wireTransaction('t-1', 5)] } });
    // A mounted screen: its query has no data yet and blocks on the first download.
    const observer = new QueryObserver(queryClient, {
      queryKey: ['transactions'],
      queryFn: () => transactionsApi.list(WS, { month: '2026-03' }),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const timedOut = new Promise<string>((resolve) => setTimeout(() => resolve('timed out'), 2000));

    expect(await Promise.race([syncNow(), timedOut])).toBe(true);
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.transactions).toHaveLength(1));
    unsubscribe();
  });
});

describe('offline', () => {
  it('keeps working and keeps the queue when the server is out of reach', async () => {
    await syncNow();
    api.get.mockImplementation(unreachable);
    api.post.mockImplementation(unreachable);

    await transactionsApi.create(WS, { date: '2026-03-07', description: 'Verdulería', amount: 12500, type: 'debit' });
    expect(await syncNow()).toBe(false);

    expect(useSyncStore.getState()).toMatchObject({ status: 'offline', pending: 1 });
    const { transactions, summary } = await transactionsApi.list(WS, { month: '2026-03' });
    expect(transactions).toMatchObject([{ description: 'Verdulería', owner: 'Ana', pending: true }]);
    expect(transactions[0].id).toBeLessThan(0);
    expect(summary.debit_total).toBe(12500);
    expect((await transactionsApi.getSummary(WS, '2026-03')).summary.total_spending).toBe(12500);
  });

  it('refuses to read a workspace that was never downloaded', async () => {
    api.get.mockImplementation(unreachable);
    api.post.mockImplementation(unreachable);
    await expect(transactionsApi.list(WS, { month: '2026-03' })).rejects.toThrow(/No local data yet/);
  });

  it('reports a server failure as an error, not as offline', async () => {
    api.get.mockRejectedValue(new AxiosError('boom', '500', undefined, undefined, { status: 500, data: { error: 'db down' } } as never));
    expect(await syncNow()).toBe(false);
    expect(useSyncStore.getState()).toMatchObject({ status: 'error', error: 'db down' });
  });
});

describe('push', () => {
  it('sends queued changes when the server comes back, exactly once', async () => {
    await syncNow();
    api.post.mockImplementation(unreachable);
    const { transaction } = await transactionsApi.create(WS, { date: '2026-03-07', description: 'Verdulería', amount: 12500, type: 'debit' });
    await syncNow();

    const sent = acceptingServer();
    expect(await syncNow()).toBe(true);
    expect(sent).toMatchObject([{ entity: 'transaction', op: 'create', data: { description: 'Verdulería', amount: 12500, owner: 'Ana' } }]);
    expect(useSyncStore.getState().pending).toBe(0);

    // The UI id is stable across the sync; the row is now known to the server.
    const after = (await transactionsApi.get(WS, transaction.id)).transaction;
    expect(after).toMatchObject({ id: transaction.id, pending: false });

    await syncNow();
    expect(sent).toHaveLength(1);
  });

  it('collapses several edits of a row into one mutation with its final state', async () => {
    await syncNow();
    api.post.mockImplementation(unreachable);
    const { transaction } = await transactionsApi.create(WS, { date: '2026-03-07', description: 'a', amount: 1, type: 'debit' });
    await transactionsApi.update(WS, transaction.id, { description: 'b' });
    await transactionsApi.update(WS, transaction.id, { amount: 3 });
    const gone = await transactionsApi.create(WS, { date: '2026-03-08', description: 'never mind', amount: 9, type: 'debit' });
    await transactionsApi.delete(WS, gone.transaction.id);
    await syncNow();

    const sent = acceptingServer();
    await syncNow();
    expect(sent.map((m) => [m.op, m.data?.description, m.data?.amount])).toEqual([
      ['create', 'b', 3],
      ['delete', undefined, undefined],
    ]);
  });

  it('sends parents before the rows that reference them, and updates with their base version', async () => {
    api.get.mockResolvedValueOnce({ data: { ...emptyPull(), transactions: [wireTransaction('t-1', 5)] } });
    await syncNow();
    api.post.mockImplementation(unreachable);

    // Created child-first on purpose.
    const { category } = await categoriesApi.create(WS, { name: 'Luz' });
    const { area } = await areasApi.create(WS, { name: 'Hogar' });
    await categoriesApi.update(WS, category.id, { area_id: area.id });
    await recurringExpensesApi.create(WS, { name: 'Edesur', amount: 9000, due_day: 10, category_id: category.id });
    await transactionsApi.update(WS, 5, { category: 'Luz' });
    await syncNow();

    const sent = acceptingServer();
    await syncNow();
    expect(sent.map((m) => `${m.entity}:${m.op}`)).toEqual([
      'area:create', 'category:create', 'recurring_expense:create', 'transaction:update',
    ]);
    const [areaMutation, categoryMutation, expenseMutation, txnMutation] = sent;
    expect(categoryMutation.data!.area_client_id).toBe(areaMutation.client_id);
    expect(expenseMutation.data!.category_client_id).toBe(categoryMutation.client_id);
    expect(txnMutation.base_updated_at).toBe(SERVER_TIME);
  });

  it('takes the server row when the offline edit lost', async () => {
    api.get.mockResolvedValueOnce({ data: { ...emptyPull(), transactions: [wireTransaction('t-1', 5)] } });
    await syncNow();
    await transactionsApi.update(WS, 5, { description: 'mine' });

    api.post.mockImplementation(async (url: string) => (url === '/auth/refresh'
      ? { data: { user: { id: 7 }, token: 't' } }
      : { data: { results: [{ client_id: 't-1', status: 'stale', row: wireTransaction('t-1', 5, { description: 'theirs', updated_at: '2026-03-11T00:00:00Z' }) }] } }));
    await syncNow();

    expect((await db.transactions.get('t-1'))!).toMatchObject({ description: 'theirs', server_updated_at: '2026-03-11T00:00:00Z' });
    expect(await db.outbox.count()).toBe(0);
  });

  it('drops a row the server no longer has, and reverts and reports a refused one', async () => {
    api.get.mockResolvedValueOnce({ data: { ...emptyPull(), transactions: [wireTransaction('t-1', 5), wireTransaction('t-2', 6)] } });
    await syncNow();
    await transactionsApi.update(WS, 5, { description: 'edit of a deleted row' });
    await transactionsApi.update(WS, 6, { description: 'bad edit' });

    api.post.mockImplementation(async (url: string) => (url === '/auth/refresh'
      ? { data: { user: { id: 7 }, token: 't' } }
      : { data: { results: [
        { client_id: 't-1', status: 'not_found' },
        { client_id: 't-2', status: 'error', error: 'amount is required', row: wireTransaction('t-2', 6) },
      ] } }));
    await syncNow();

    expect(await db.transactions.get('t-1')).toBeUndefined();
    expect((await db.transactions.get('t-2'))!.description).toBe('Coto');
    expect(useSyncStore.getState().rejected).toEqual(['transaction update: amount is required']);
  });

  it('adopts the existing category when one created offline already existed', async () => {
    await syncNow();
    const { category } = await categoriesApi.create(WS, { name: 'Super' });
    await recurringExpensesApi.create(WS, { name: 'Compra', amount: 100, due_day: 1, category_id: category.id });

    const existing = { client_id: 'c-server', id: 9, name: 'Super', area_client_id: null, color: '#fff', icon: '', created_at: SERVER_TIME, updated_at: SERVER_TIME };
    api.post.mockImplementation(async (url: string, body?: { mutations: Sent[] }) => (url === '/auth/refresh'
      ? { data: { user: { id: 7 }, token: 't' } }
      : { data: { results: body!.mutations.map((m) => (m.entity === 'category'
        ? { client_id: m.client_id, status: 'merged', row: existing }
        : { client_id: m.client_id, status: 'applied', row: { client_id: m.client_id, id: 50, created_at: SERVER_TIME, updated_at: SERVER_TIME, ...m.data, category_client_id: 'c-server' } })) } }));
    await syncNow();

    expect((await categoriesApi.list(WS)).categories).toMatchObject([{ id: 9, name: 'Super', color: '#fff' }]);
    expect((await recurringExpensesApi.list(WS, '2026-03')).recurring_expenses).toMatchObject([{ name: 'Compra', category_id: 9, category_name: 'Super' }]);
  });
});

describe('recurring payments', () => {
  it('shows the payment and its transaction at once, and the server reuses that transaction', async () => {
    await syncNow();
    api.post.mockImplementation(unreachable);
    const { recurring_expense } = await recurringExpensesApi.create(WS, { name: 'Internet', amount: 3000, due_day: 31 });
    const paid = await recurringExpensesApi.markPaid(WS, recurring_expense.id, '2026-02');
    expect(paid.recurring_expense).toMatchObject({ is_paid_this_month: true, last_paid_date: '2026-02-28' });
    expect(paid.transaction).toMatchObject({ date: '2026-02-28', description: 'Internet', amount: 3000, type: 'debit', owner: 'Ana' });
    // Paying twice is a no-op.
    expect((await recurringExpensesApi.markPaid(WS, recurring_expense.id, '2026-02')).transaction).toBeUndefined();
    await syncNow();

    const sent = acceptingServer();
    await syncNow();
    expect(sent.map((m) => `${m.entity}:${m.op}`)).toEqual(['recurring_expense:create', 'recurring_expense:mark_paid']);
    expect(sent[1].data).toMatchObject({ month: '2026-02' });
    expect(await db.transactions.get(sent[1].data!.transaction_client_id as string)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('discards its provisional transaction when the month was already paid elsewhere', async () => {
    await syncNow();
    const { recurring_expense } = await recurringExpensesApi.create(WS, { name: 'Internet', amount: 3000, due_day: 5 });
    await syncNow();
    api.post.mockImplementation(unreachable);
    await recurringExpensesApi.markPaid(WS, recurring_expense.id, '2026-03');
    await syncNow();
    expect(await db.transactions.count()).toBe(1);

    api.post.mockImplementation(async (url: string, body?: { mutations: Sent[] }) => (url === '/auth/refresh'
      ? { data: { user: { id: 7 }, token: 't' } }
      : { data: { results: body!.mutations.map((m) => ({
        client_id: m.client_id, status: 'applied',
        payment: { recurring_expense_client_id: m.client_id, month: '2026-03', paid_at: '2026-03-05', transaction_client_id: 'someone-elses' },
      })) } }));
    await syncNow();

    expect(await db.transactions.count()).toBe(0);
    expect((await recurringExpensesApi.list(WS, '2026-03')).recurring_expenses[0].is_paid_this_month).toBe(true);
  });
});

describe('accounts', () => {
  const download = async () => {
    api.get.mockResolvedValueOnce({ data: { ...emptyPull(), transactions: [wireTransaction('t-1', 5)] } });
    await syncNow();
    expect(await db.transactions.count()).toBe(1);
  };

  it('wipes the local copy when a different user signs in on the device', async () => {
    await download();
    useAuthStore.setState({ user: { id: 8, email: 'beto@example.com', name: 'Beto', created_at: '' } });
    await syncNow();
    // Beto's (empty) workspace was downloaded from scratch; nothing of Ana's is left.
    expect(await db.transactions.count()).toBe(0);
    expect(api.get).toHaveBeenLastCalledWith(`/workspaces/${WS}/sync`, { params: {} });
  });

  it('keeps the local copy across a session that expired and was renewed', async () => {
    await download();
    useAuthStore.getState().logout();
    expect(await syncNow()).toBe(false);
    useAuthStore.setState({ user: { id: 7, email: 'ana@example.com', name: 'Ana', created_at: '' }, token: 't', isAuthenticated: true });
    await syncNow();
    expect(await db.transactions.count()).toBe(1);
  });

  it('forgets everything on sign-out', async () => {
    await download();
    await discardLocalData();
    expect(await db.transactions.count()).toBe(0);
    expect(await getMeta(cursorKey(WS))).toBeUndefined();
  });
});
