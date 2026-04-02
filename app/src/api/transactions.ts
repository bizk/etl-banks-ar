import apiClient from './client';
import type { Transaction, Pagination, TransactionSummary, MonthlySummary, UploadPreview, PreviewTransaction } from '../types';

interface TransactionListResponse {
  transactions: Transaction[];
  pagination: Pagination;
  summary: TransactionSummary;
}

interface TransactionFilters {
  month: string;
  category?: string;
  type?: string;
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
}

interface UpdateTransactionInput {
  date?: string;
  description?: string;
  amount?: number;
  type?: 'debit' | 'credit';
  category?: string;
  user_confirmed?: boolean;
}

export const transactionsApi = {
  list: async (workspaceId: number, filters: TransactionFilters): Promise<TransactionListResponse> => {
    const params = new URLSearchParams();
    params.append('month', filters.month);
    if (filters.category) params.append('category', filters.category);
    if (filters.type) params.append('type', filters.type);
    if (filters.sort) params.append('sort', filters.sort);
    if (filters.order) params.append('order', filters.order);
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.per_page) params.append('per_page', filters.per_page.toString());

    const response = await apiClient.get<TransactionListResponse>(
      `/workspaces/${workspaceId}/transactions?${params.toString()}`
    );
    return response.data;
  },

  get: async (workspaceId: number, id: number): Promise<{ transaction: Transaction }> => {
    const response = await apiClient.get<{ transaction: Transaction }>(
      `/workspaces/${workspaceId}/transactions/${id}`
    );
    return response.data;
  },

  create: async (workspaceId: number, data: CreateTransactionInput): Promise<{ transaction: Transaction }> => {
    const response = await apiClient.post<{ transaction: Transaction }>(
      `/workspaces/${workspaceId}/transactions`,
      data
    );
    return response.data;
  },

  update: async (workspaceId: number, id: number, data: UpdateTransactionInput): Promise<{ transaction: Transaction }> => {
    const response = await apiClient.put<{ transaction: Transaction }>(
      `/workspaces/${workspaceId}/transactions/${id}`,
      data
    );
    return response.data;
  },

  delete: async (workspaceId: number, id: number): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/transactions/${id}`);
  },

  getSummary: async (workspaceId: number, month: string): Promise<{ summary: MonthlySummary }> => {
    const response = await apiClient.get<{ summary: MonthlySummary }>(
      `/workspaces/${workspaceId}/transactions/summary?month=${month}`
    );
    return response.data;
  },

  getCategories: async (workspaceId: number): Promise<{ categories: string[] }> => {
    const response = await apiClient.get<{ categories: string[] }>(
      `/workspaces/${workspaceId}/categories`
    );
    return response.data;
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
    return response.data;
  },
};
