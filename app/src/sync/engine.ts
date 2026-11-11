import { isAxiosError } from 'axios';
import apiClient from '../api/client';
import { queryClient } from '../lib/queryClient';
import {
  claimLocalData, clearLocalData, cursorKey, db, getMeta, paymentKey, rateKey, setMeta, tableFor,
  type LocalArea, type LocalCategory, type LocalRecurringExpense, type LocalTransaction,
  type OutboxEntry, type SyncEntity,
} from '../local/db';
import { useAuthStore } from '../store/authSlice';
import { useSyncStore } from '../store/syncSlice';
import { useWorkspaceStore } from '../store/workspaceSlice';

// Keeps the local database and the server in step.
//
// One cycle pushes the queued changes, then pulls everything that changed on the server
// since the last cycle. It runs when the app opens, when it comes back to the foreground,
// when the browser reports a connection, on a timer, and after every local change.
// Reaching the server is the only test of being online: on a phone with wifi but no
// tailnet, navigator.onLine is true and the server is still unreachable.

const PUSH_BATCH = 200;
const SYNC_INTERVAL_MS = 60_000;
const TOKEN_REFRESH_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESHED_KEY = 'token-refreshed-at';
const UPSERT_ORDER: SyncEntity[] = ['area', 'category', 'recurring_expense', 'transaction'];

// ---- Wire types (server/internal/services/sync.go) ----------------------------------------

interface WireBase { client_id: string; id: number; created_at: string; updated_at: string }
interface WireArea extends WireBase { name: string; color: string; icon: string }
interface WireCategory extends WireBase { name: string; area_client_id: string | null; color: string; icon: string }
interface WireTransaction extends WireBase {
  date: string; description: string; amount: number; balance_after: number | null; type: string;
  category: string; owner: string; area_client_id: string | null; user_confirmed: boolean;
}
interface WireRecurringExpense extends WireBase {
  name: string; amount: number; category_client_id: string | null; owner: string; due_day: number;
}
interface WirePayment { recurring_expense_client_id: string; month: string; paid_at: string; transaction_client_id: string }
type WireRow = WireArea | WireCategory | WireTransaction | WireRecurringExpense;

interface PullResponse {
  cursor: string;
  has_more: boolean;
  areas: WireArea[];
  categories: WireCategory[];
  transactions: WireTransaction[];
  recurring_expenses: WireRecurringExpense[];
  recurring_payments: WirePayment[];
  exchange_rates: { month: string; rate: number; updated_at: string }[];
  deleted: { entity: SyncEntity | 'exchange_rate'; ref: string }[];
}

interface Mutation {
  entity: SyncEntity;
  op: 'create' | 'update' | 'delete' | 'mark_paid';
  client_id: string;
  client_ts: string;
  base_updated_at?: string | null;
  data?: unknown;
}

interface PushResult {
  client_id: string;
  status: 'applied' | 'stale' | 'not_found' | 'merged' | 'error';
  error?: string;
  row?: WireRow;
  payment?: WirePayment;
}

// ---- Storing server rows ------------------------------------------------------------------

/** Converts a server row to its local form, keeping the UI id of a row we already hold. */
function toLocal(workspaceId: number, row: WireRow, existingLid: number | undefined) {
  const { id, ...fields } = row;
  return {
    ...fields,
    workspace_id: workspaceId,
    lid: existingLid ?? id,
    server_id: id,
    server_updated_at: row.updated_at,
  };
}

async function storeServerRows(workspaceId: number, entity: SyncEntity, rows: WireRow[]): Promise<void> {
  if (rows.length === 0) return;
  const table = tableFor(entity);
  const existing = await table.bulkGet(rows.map((r) => r.client_id));
  await table.bulkPut(rows.map((row, i) => toLocal(workspaceId, row, existing[i]?.lid)) as never[]);
}

async function removeLocalRow(workspaceId: number, entity: SyncEntity, clientId: string): Promise<void> {
  await tableFor(entity).delete(clientId);
  await db.outbox.where('[entity+client_id]').equals([entity, clientId]).delete();
  if (entity === 'area') {
    await db.categories.where('workspace_id').equals(workspaceId)
      .and((c) => c.area_client_id === clientId).modify({ area_client_id: null });
    await db.transactions.where('workspace_id').equals(workspaceId)
      .and((t) => t.area_client_id === clientId).modify({ area_client_id: null });
  } else if (entity === 'category') {
    await db.recurringExpenses.where('workspace_id').equals(workspaceId)
      .and((e) => e.category_client_id === clientId).modify({ category_client_id: null });
  } else if (entity === 'recurring_expense') {
    await db.payments.where('recurring_expense_client_id').equals(clientId).delete();
  }
}

async function storePayments(workspaceId: number, payments: WirePayment[]): Promise<void> {
  await db.payments.bulkPut(payments.map((p) => ({
    ...p, workspace_id: workspaceId, key: paymentKey(workspaceId, p.recurring_expense_client_id, p.month),
  })));
}

// ---- Pull ---------------------------------------------------------------------------------

async function applyPull(workspaceId: number, page: PullResponse): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    // Rows with queued changes keep the device's version: the push decides who wins.
    const queued = new Set(
      (await db.outbox.where('workspace_id').equals(workspaceId).toArray()).map((e) => `${e.entity}|${e.client_id}`),
    );
    const settled = <T extends WireRow>(entity: SyncEntity, rows: T[]) =>
      rows.filter((r) => !queued.has(`${entity}|${r.client_id}`));

    // Deletes first: a tombstone can be older than a row recreated under the same key.
    for (const { entity, ref } of page.deleted) {
      if (entity === 'exchange_rate') await db.exchangeRates.delete(rateKey(workspaceId, ref));
      else await removeLocalRow(workspaceId, entity, ref);
    }
    await storeServerRows(workspaceId, 'area', settled('area', page.areas));
    await storeServerRows(workspaceId, 'category', settled('category', page.categories));
    await storeServerRows(workspaceId, 'recurring_expense', settled('recurring_expense', page.recurring_expenses));
    await storeServerRows(workspaceId, 'transaction', settled('transaction', page.transactions));
    await storePayments(workspaceId, page.recurring_payments);
    await db.exchangeRates.bulkPut(page.exchange_rates.map((r) => ({
      ...r, workspace_id: workspaceId, key: rateKey(workspaceId, r.month),
    })));
    await setMeta(cursorKey(workspaceId), page.cursor);
  });
}

async function pull(workspaceId: number): Promise<boolean> {
  let cursor = await getMeta(cursorKey(workspaceId));
  let changed = false;
  for (;;) {
    const { data } = await apiClient.get<PullResponse>(`/workspaces/${workspaceId}/sync`, {
      params: cursor ? { since: cursor } : {},
    });
    await applyPull(workspaceId, data);
    changed ||= data.deleted.length + data.areas.length + data.categories.length + data.transactions.length
      + data.recurring_expenses.length + data.recurring_payments.length + data.exchange_rates.length > 0;
    cursor = data.cursor;
    if (!data.has_more) return changed;
  }
}

// ---- Push ---------------------------------------------------------------------------------

interface Target {
  entity: SyncEntity;
  clientId: string;
  ts: string;
  kind: 'upsert' | 'delete' | 'mark_paid';
  entry?: OutboxEntry;
}

/**
 * Collapses the queue to one mutation per row (its current state is what gets sent) and
 * orders them so references resolve: parents before children, deletes last.
 */
async function buildTargets(entries: OutboxEntry[]): Promise<Target[]> {
  const rows = new Map<string, Target>();
  const payments: Target[] = [];
  for (const e of entries) {
    if (e.op === 'mark_paid') {
      payments.push({ entity: e.entity, clientId: e.client_id, ts: e.client_ts, kind: 'mark_paid', entry: e });
      continue;
    }
    const key = `${e.entity}|${e.client_id}`;
    const exists = (await tableFor(e.entity).get(e.client_id)) !== undefined;
    rows.set(key, { entity: e.entity, clientId: e.client_id, ts: e.client_ts, kind: exists ? 'upsert' : 'delete' });
  }
  const all = [...rows.values()];
  const upserts = (entity: SyncEntity) => all.filter((t) => t.kind === 'upsert' && t.entity === entity);
  return [
    ...upserts('area'), ...upserts('category'), ...upserts('recurring_expense'),
    // Payments before transactions: paying creates the transaction the device already shows.
    ...payments,
    ...upserts('transaction'),
    ...[...UPSERT_ORDER].reverse().flatMap((entity) => all.filter((t) => t.kind === 'delete' && t.entity === entity)),
  ];
}

function rowData(entity: SyncEntity, row: unknown): unknown {
  switch (entity) {
    case 'area': {
      const { name, color, icon } = row as LocalArea;
      return { name, color, icon };
    }
    case 'category': {
      const { name, area_client_id, color, icon } = row as LocalCategory;
      return { name, area_client_id, color, icon };
    }
    case 'transaction': {
      const { date, description, amount, type, category, owner, area_client_id, user_confirmed } = row as LocalTransaction;
      return { date, description, amount, type, category, owner, area_client_id, user_confirmed };
    }
    case 'recurring_expense': {
      const { name, amount, category_client_id, owner, due_day } = row as LocalRecurringExpense;
      return { name, amount, category_client_id, owner, due_day };
    }
  }
}

async function toMutation(target: Target): Promise<Mutation | null> {
  const base = { entity: target.entity, client_id: target.clientId, client_ts: target.ts };
  if (target.kind === 'delete') return { ...base, op: 'delete' };
  const row = await tableFor(target.entity).get(target.clientId);
  if (!row) return null; // deleted since the queue was read; the delete is queued behind us
  if (target.kind === 'mark_paid') {
    return { ...base, op: 'mark_paid', data: { month: target.entry!.month, transaction_client_id: target.entry!.transaction_client_id } };
  }
  return {
    ...base,
    op: row.server_id === null ? 'create' : 'update',
    base_updated_at: row.server_updated_at,
    data: rowData(target.entity, row),
  };
}

const describe = (m: Mutation) => `${m.entity.replace('_', ' ')} ${m.op.replace('_', ' ')}`;

async function applyResult(workspaceId: number, target: Target, mutation: Mutation, result: PushResult, maxSeq: number, rejected: string[]): Promise<void> {
  const { entity, clientId } = target;
  // Edits made while this push was in flight are still queued and must survive it.
  const editedSince = (await db.outbox.where('[entity+client_id]').equals([entity, clientId])
    .and((e) => e.seq > maxSeq && e.op !== 'mark_paid').count()) > 0;

  if (target.kind === 'mark_paid') {
    const { month, transaction_client_id: ours } = target.entry!;
    if (result.status === 'applied' && result.payment) {
      await storePayments(workspaceId, [result.payment]);
      // Someone else had already paid this month: our provisional transaction never existed.
      if (ours && result.payment.transaction_client_id !== ours) await removeLocalRow(workspaceId, 'transaction', ours);
      return;
    }
    await db.payments.delete(paymentKey(workspaceId, clientId, month!));
    if (ours) await removeLocalRow(workspaceId, 'transaction', ours);
    if (result.status === 'error') rejected.push(`${describe(mutation)}: ${result.error}`);
    return;
  }

  if (target.kind === 'delete') {
    if (result.status === 'error') rejected.push(`${describe(mutation)}: ${result.error}`);
    return;
  }

  if (result.status === 'not_found') {
    await removeLocalRow(workspaceId, entity, clientId);
    return;
  }
  if (result.status === 'error') rejected.push(`${describe(mutation)}: ${result.error}`);
  if (!result.row) {
    // A rejected create: the server has nothing to fall back to.
    await removeLocalRow(workspaceId, entity, clientId);
    return;
  }
  if (result.status === 'merged') {
    // The server already had this row under another client_id: adopt it.
    const merged = result.row.client_id;
    await removeLocalRow(workspaceId, entity, clientId);
    await storeServerRows(workspaceId, entity, [result.row]);
    if (entity === 'category') {
      await db.recurringExpenses.where('workspace_id').equals(workspaceId)
        .and((e) => e.category_client_id === clientId).modify({ category_client_id: merged });
    }
    return;
  }
  if (editedSince) {
    await tableFor(entity).update(clientId, { server_id: result.row.id, server_updated_at: result.row.updated_at });
  } else {
    await storeServerRows(workspaceId, entity, [result.row]);
  }
}

async function push(workspaceId: number): Promise<boolean> {
  const entries = await db.outbox.where('workspace_id').equals(workspaceId).sortBy('seq');
  if (entries.length === 0) return false;
  const maxSeq = entries[entries.length - 1].seq;
  const targets = await buildTargets(entries);
  const rejected: string[] = [];

  for (let start = 0; start < targets.length; start += PUSH_BATCH) {
    const batch: { target: Target; mutation: Mutation }[] = [];
    for (const target of targets.slice(start, start + PUSH_BATCH)) {
      const mutation = await toMutation(target);
      if (mutation) batch.push({ target, mutation });
    }
    if (batch.length === 0) continue;
    const { data } = await apiClient.post<{ results: PushResult[] }>(`/workspaces/${workspaceId}/sync/push`, {
      mutations: batch.map((b) => b.mutation),
    });
    await db.transaction('rw', db.tables, async () => {
      for (let i = 0; i < batch.length; i++) {
        await applyResult(workspaceId, batch[i].target, batch[i].mutation, data.results[i], maxSeq, rejected);
      }
      // This batch is settled: drop its queue entries so a failure later on does not resend it.
      for (const { target } of batch) {
        await db.outbox.where('[entity+client_id]').equals([target.entity, target.clientId])
          .and((e) => e.seq <= maxSeq && (e.op === 'mark_paid') === (target.kind === 'mark_paid')).delete();
      }
    });
  }
  // Entries whose row vanished before it could be sent.
  await db.outbox.where('workspace_id').equals(workspaceId).and((e) => e.seq <= maxSeq).delete();
  if (rejected.length > 0) {
    useSyncStore.getState().set({ rejected: [...useSyncStore.getState().rejected, ...rejected] });
  }
  return true;
}

// ---- Cycle --------------------------------------------------------------------------------

async function refreshToken(): Promise<void> {
  const last = Number(localStorage.getItem(TOKEN_REFRESHED_KEY) ?? 0);
  if (Date.now() - last < TOKEN_REFRESH_MS) return;
  const { data } = await apiClient.post('/auth/refresh');
  useAuthStore.getState().setAuth(data.user, data.token);
  localStorage.setItem(TOKEN_REFRESHED_KEY, String(Date.now()));
}

export async function refreshPending(): Promise<void> {
  useSyncStore.getState().set({ pending: await db.outbox.count() });
}

/** Workspaces a caller explicitly asked for, on top of the current one. */
const requested = new Set<number>();

let claimedFor: number | null = null;

/** Before touching local data, make sure it belongs to the signed-in user. */
async function ensureOwner(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (userId == null || claimedFor === userId) return;
  await claimLocalData(userId);
  claimedFor = userId;
}

async function cycle(): Promise<void> {
  await ensureOwner();
  await refreshToken();
  const current = useWorkspaceStore.getState().currentWorkspace?.id;
  const queued = (await db.outbox.orderBy('workspace_id').uniqueKeys()) as number[];
  const workspaceIds = [...new Set([current, ...requested, ...queued])].filter((id): id is number => id != null);
  requested.clear();

  let changed = false;
  for (const workspaceId of workspaceIds) {
    if (await push(workspaceId)) changed = true;
    if (await pull(workspaceId)) changed = true;
  }
  await refreshPending();
  // Not awaited: a screen loading for the first time is itself waiting on this sync, and
  // waiting for its query here would deadlock the two.
  if (changed) void queryClient.invalidateQueries();
}

let running: Promise<boolean> | null = null;
let rerun = false;

/** Runs a sync cycle, or joins the one in progress. Resolves to whether it succeeded. */
export function syncNow(workspaceId?: number): Promise<boolean> {
  if (workspaceId != null) requested.add(workspaceId);
  if (running) {
    rerun = true;
    return running;
  }
  if (!useAuthStore.getState().isAuthenticated) return Promise.resolve(false);

  const store = useSyncStore.getState();
  store.set({ status: 'syncing' });
  const exclusive = <T,>(fn: () => Promise<T>) =>
    navigator.locks ? navigator.locks.request('tostado-sync', fn) : fn();

  running = exclusive(async () => {
    try {
      do {
        rerun = false;
        await cycle();
      } while (rerun);
      store.set({ status: 'idle', lastSyncedAt: Date.now(), error: null });
      return true;
    } catch (err) {
      await refreshPending().catch(() => undefined);
      // No response at all means the server is out of reach; anything else is a real failure.
      const unreachable = isAxiosError(err) && !err.response;
      store.set(unreachable
        ? { status: 'offline', error: null }
        : { status: 'error', error: isAxiosError(err) ? (err.response?.data?.error ?? err.message) : String(err) });
      return false;
    } finally {
      running = null;
    }
  }) as Promise<boolean>;
  return running;
}

let debounce: ReturnType<typeof setTimeout> | undefined;

/** Schedules a sync shortly, coalescing bursts of local changes. */
export function requestSync(): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), 400);
}

/**
 * Resolves once the workspace has a local copy to read. Only the very first sync of a
 * workspace needs the server; after that, reads never wait on the network.
 */
export async function ensureLocalCopy(workspaceId: number): Promise<void> {
  await ensureOwner();
  if ((await getMeta(cursorKey(workspaceId))) !== undefined) return;
  await syncNow(workspaceId);
  if ((await getMeta(cursorKey(workspaceId))) === undefined) {
    throw new Error('No local data yet. Connect to the server once to download it.');
  }
}

/** Starts the background triggers. Returns a function that stops them. */
export function startSync(): () => void {
  const trigger = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  void refreshPending();
  trigger();
  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', trigger);
  const timer = setInterval(trigger, SYNC_INTERVAL_MS);
  return () => {
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', trigger);
    clearInterval(timer);
  };
}

/** Signs the device out of its data: drops the local copy and anything still queued. */
export async function discardLocalData(): Promise<void> {
  clearTimeout(debounce);
  await running?.catch(() => undefined);
  await clearLocalData();
  claimedFor = null;
  localStorage.removeItem(TOKEN_REFRESHED_KEY);
  useSyncStore.getState().set({ status: 'idle', pending: 0, lastSyncedAt: null, error: null, rejected: [] });
  queryClient.clear();
}
