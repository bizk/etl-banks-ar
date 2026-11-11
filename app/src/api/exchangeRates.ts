import apiClient from './client';
import { db, rateKey } from '../local/db';
import { ensureLocalCopy, syncNow } from '../sync/engine';
import type { ExchangeRate } from '../types';

export const exchangeRatesApi = {
  // Rates are read from the local copy, so currency conversion works offline. Editing them
  // needs the server; the local copy is refreshed right after.
  list: async (workspaceId: number): Promise<{ exchange_rates: ExchangeRate[] }> => {
    await ensureLocalCopy(workspaceId);
    const rates = await db.exchangeRates.where('workspace_id').equals(workspaceId).toArray();
    return {
      exchange_rates: rates
        .sort((a, b) => b.month.localeCompare(a.month))
        .map((r, i) => ({ id: i + 1, workspace_id: workspaceId, month: r.month, rate: r.rate, created_at: r.updated_at, updated_at: r.updated_at })),
    };
  },

  get: async (workspaceId: number, month: string): Promise<{ exchange_rate: ExchangeRate }> => {
    await ensureLocalCopy(workspaceId);
    const r = await db.exchangeRates.get(rateKey(workspaceId, month));
    if (!r) throw new Error('Exchange rate not found');
    return { exchange_rate: { id: 1, workspace_id: workspaceId, month: r.month, rate: r.rate, created_at: r.updated_at, updated_at: r.updated_at } };
  },

  upsert: async (workspaceId: number, month: string, rate: number): Promise<{ exchange_rate: ExchangeRate }> => {
    const response = await apiClient.put<{ exchange_rate: ExchangeRate }>(
      `/workspaces/${workspaceId}/exchange-rates/${month}`,
      { rate }
    );
    await syncNow(workspaceId);
    return response.data;
  },

  delete: async (workspaceId: number, month: string): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/exchange-rates/${month}`);
    await syncNow(workspaceId);
  },
};
