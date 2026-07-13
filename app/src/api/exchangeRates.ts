import apiClient from './client';
import type { ExchangeRate } from '../types';

export const exchangeRatesApi = {
  list: async (workspaceId: number): Promise<{ exchange_rates: ExchangeRate[] }> => {
    const response = await apiClient.get<{ exchange_rates: ExchangeRate[] }>(
      `/workspaces/${workspaceId}/exchange-rates`
    );
    return response.data;
  },

  get: async (workspaceId: number, month: string): Promise<{ exchange_rate: ExchangeRate }> => {
    const response = await apiClient.get<{ exchange_rate: ExchangeRate }>(
      `/workspaces/${workspaceId}/exchange-rates/${month}`
    );
    return response.data;
  },

  upsert: async (workspaceId: number, month: string, rate: number): Promise<{ exchange_rate: ExchangeRate }> => {
    const response = await apiClient.put<{ exchange_rate: ExchangeRate }>(
      `/workspaces/${workspaceId}/exchange-rates/${month}`,
      { rate }
    );
    return response.data;
  },

  delete: async (workspaceId: number, month: string): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/exchange-rates/${month}`);
  },
};
