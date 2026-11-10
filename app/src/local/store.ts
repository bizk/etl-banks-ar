import { refreshPending, requestSync } from '../sync/engine';
import { useAuthStore } from '../store/authSlice';
import type { Area, Category, Transaction } from '../types';
import {
  db, newClientId, newLocalId, tableFor,
  type LocalArea, type LocalCategory, type LocalTransaction, type OutboxEntry, type SyncEntity,
} from './db';

// Shared plumbing for the local repositories in src/api: every write lands in the local
// database together with an outbox entry, in one transaction, and then asks for a sync.

type QueueExtra = Pick<OutboxEntry, 'month' | 'transaction_client_id'>;

export async function queue(
  workspaceId: number, entity: SyncEntity, op: OutboxEntry['op'], clientId: string, extra: QueueExtra = {},
): Promise<void> {
  await db.outbox.add({
    workspace_id: workspaceId, entity, op, client_id: clientId, client_ts: new Date().toISOString(), ...extra,
  } as OutboxEntry);
}

/** Runs a local write atomically, then schedules a sync. */
export async function write<T>(fn: () => Promise<T>): Promise<T> {
  const result = await db.transaction('rw', db.tables, fn);
  void refreshPending();
  requestSync();
  return result;
}

/** The bookkeeping fields of a row being created on this device. */
export function newRow(workspaceId: number) {
  const now = new Date().toISOString();
  return {
    client_id: newClientId(), workspace_id: workspaceId, lid: newLocalId(),
    server_id: null, server_updated_at: null, created_at: now, updated_at: now,
  };
}

export const touched = () => ({ updated_at: new Date().toISOString() });

/** Finds a row by the id the UI uses. */
export async function byLid<T extends { workspace_id: number }>(entity: SyncEntity, workspaceId: number, lid: number): Promise<T> {
  const row = await tableFor(entity).where('lid').equals(lid).and((r) => r.workspace_id === workspaceId).first();
  if (!row) throw new Error(`${entity.replace('_', ' ')} not found`);
  return row as unknown as T;
}

export const ofWorkspace = <T,>(entity: SyncEntity, workspaceId: number) =>
  tableFor(entity).where('workspace_id').equals(workspaceId).toArray() as unknown as Promise<T[]>;

export const currentUserName = () => useAuthStore.getState().user?.name ?? '';

// ---- Local rows as the UI types -----------------------------------------------------------

export function areaView(a: LocalArea): Area {
  return {
    id: a.lid, workspace_id: a.workspace_id, name: a.name, color: a.color, icon: a.icon,
    created_at: a.created_at, updated_at: a.updated_at,
  };
}

export function categoryView(c: LocalCategory, areas: Map<string, LocalArea>): Category {
  const area = c.area_client_id ? areas.get(c.area_client_id) : undefined;
  return {
    id: c.lid, workspace_id: c.workspace_id, name: c.name, area_id: area?.lid ?? null,
    area: area ? areaView(area) : undefined, color: c.color, icon: c.icon,
    created_at: c.created_at, updated_at: c.updated_at,
  };
}

export function transactionView(t: LocalTransaction): Transaction {
  return {
    id: t.lid, workspace_id: t.workspace_id, date: t.date, description: t.description, amount: t.amount,
    balance_after: t.balance_after ?? undefined, type: t.type, category: t.category, owner: t.owner,
    user_confirmed: t.user_confirmed, created_at: t.created_at, updated_at: t.updated_at,
    pending: t.server_id === null || t.server_updated_at === null,
  };
}

export async function areasByClientId(workspaceId: number): Promise<Map<string, LocalArea>> {
  const areas = await ofWorkspace<LocalArea>('area', workspaceId);
  return new Map(areas.map((a) => [a.client_id, a]));
}
