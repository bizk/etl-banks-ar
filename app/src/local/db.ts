import Dexie, { type EntityTable, type Table } from 'dexie';

// The device's copy of the server data, plus the queue of changes not yet sent.
//
// Rows are keyed by client_id, a UUID that is the same on every device and on the server.
// `lid` is the numeric id the UI works with: the server id for rows that came from the
// server, a negative number for rows created on this device. It never changes, so a screen
// holding an id keeps working after the row is synced.

export type SyncEntity = 'area' | 'category' | 'transaction' | 'recurring_expense';
export type SyncOp = 'upsert' | 'delete' | 'mark_paid';

interface LocalBase {
  client_id: string;
  workspace_id: number;
  lid: number;
  /** null until the server has stored the row. */
  server_id: number | null;
  /** updated_at of the server version this row was last in step with. */
  server_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalArea extends LocalBase {
  name: string;
  color: string;
  icon: string;
}

export interface LocalCategory extends LocalBase {
  name: string;
  area_client_id: string | null;
  color: string;
  icon: string;
}

export interface LocalTransaction extends LocalBase {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  balance_after: number | null;
  type: string;
  category: string;
  owner: string;
  area_client_id: string | null;
  user_confirmed: boolean;
}

export interface LocalRecurringExpense extends LocalBase {
  name: string;
  amount: number;
  category_client_id: string | null;
  owner: string;
  due_day: number;
}

export interface LocalPayment {
  key: string; // workspace|expense client_id|month
  workspace_id: number;
  recurring_expense_client_id: string;
  month: string; // YYYY-MM
  paid_at: string; // YYYY-MM-DD
  transaction_client_id: string;
}

export interface LocalExchangeRate {
  key: string; // workspace|month
  workspace_id: number;
  month: string;
  rate: number;
  updated_at: string;
}

/** One change made on this device that the server has not confirmed yet. */
export interface OutboxEntry {
  seq: number;
  workspace_id: number;
  entity: SyncEntity;
  op: SyncOp;
  client_id: string;
  /** When the user made the change. */
  client_ts: string;
  /** mark_paid only. */
  month?: string;
  transaction_client_id?: string;
}

export interface MetaEntry {
  key: string;
  value: string;
}

export class LocalDB extends Dexie {
  areas!: Table<LocalArea, string>;
  categories!: Table<LocalCategory, string>;
  transactions!: Table<LocalTransaction, string>;
  recurringExpenses!: Table<LocalRecurringExpense, string>;
  payments!: Table<LocalPayment, string>;
  exchangeRates!: Table<LocalExchangeRate, string>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('tostado');
    this.version(1).stores({
      areas: 'client_id, workspace_id, lid',
      categories: 'client_id, workspace_id, lid',
      transactions: 'client_id, workspace_id, lid, [workspace_id+date]',
      recurringExpenses: 'client_id, workspace_id, lid',
      payments: 'key, workspace_id, recurring_expense_client_id',
      exchangeRates: 'key, workspace_id',
      outbox: '++seq, workspace_id, [entity+client_id]',
      meta: 'key',
    });
  }
}

export const db = new LocalDB();

export const paymentKey = (workspaceId: number, expenseClientId: string, month: string) =>
  `${workspaceId}|${expenseClientId}|${month}`;
export const rateKey = (workspaceId: number, month: string) => `${workspaceId}|${month}`;
export const cursorKey = (workspaceId: number) => `cursor:${workspaceId}`;
export const OWNER_KEY = 'owner_user_id';

export function tableFor(entity: SyncEntity): Table<LocalBase, string> {
  switch (entity) {
    case 'area': return db.areas as unknown as Table<LocalBase, string>;
    case 'category': return db.categories as unknown as Table<LocalBase, string>;
    case 'transaction': return db.transactions as unknown as Table<LocalBase, string>;
    case 'recurring_expense': return db.recurringExpenses as unknown as Table<LocalBase, string>;
  }
}

export function newClientId(): string {
  // randomUUID only exists on secure origins; over plain http on a LAN it is missing.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A UI id for a row created on this device: negative, so it can never match a server id. */
export function newLocalId(): number {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

/** Drops every local row and queued change. */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

/**
 * Makes sure the local data belongs to this user: a different account signing in on the
 * same device must not see, or push, the previous account's rows.
 */
export async function claimLocalData(userId: number): Promise<void> {
  const owner = await getMeta(OWNER_KEY);
  if (owner !== undefined && owner !== String(userId)) {
    await clearLocalData();
  }
  await setMeta(OWNER_KEY, String(userId));
}
