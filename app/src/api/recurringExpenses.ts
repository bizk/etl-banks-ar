import apiClient from './client';
import type { RecurringExpense, RecurringExpenseSummary, Transaction } from '../types';

interface CreateRecurringExpenseRequest {
  name: string;
  amount: number;
  category_id?: number | null;
  owner?: string;
  due_day: number;
}

interface UpdateRecurringExpenseRequest {
  name?: string;
  amount?: number;
  category_id?: number | null;
  owner?: string;
  due_day?: number;
}

export const recurringExpensesApi = {
  list: async (workspaceId: number): Promise<{ recurring_expenses: RecurringExpense[] }> => {
    const response = await apiClient.get<{ recurring_expenses: RecurringExpense[] }>(
      `/workspaces/${workspaceId}/recurring-expenses`
    );
    return response.data;
  },

  getSummary: async (workspaceId: number, month?: string): Promise<RecurringExpenseSummary> => {
    const params = month ? { month } : {};
    const response = await apiClient.get<RecurringExpenseSummary>(
      `/workspaces/${workspaceId}/recurring-expenses/summary`,
      { params }
    );
    return response.data;
  },

  get: async (workspaceId: number, id: number): Promise<{ recurring_expense: RecurringExpense }> => {
    const response = await apiClient.get<{ recurring_expense: RecurringExpense }>(
      `/workspaces/${workspaceId}/recurring-expenses/${id}`
    );
    return response.data;
  },

  create: async (workspaceId: number, data: CreateRecurringExpenseRequest): Promise<{ recurring_expense: RecurringExpense }> => {
    const response = await apiClient.post<{ recurring_expense: RecurringExpense }>(
      `/workspaces/${workspaceId}/recurring-expenses`,
      data
    );
    return response.data;
  },

  update: async (workspaceId: number, id: number, data: UpdateRecurringExpenseRequest): Promise<{ recurring_expense: RecurringExpense }> => {
    const response = await apiClient.put<{ recurring_expense: RecurringExpense }>(
      `/workspaces/${workspaceId}/recurring-expenses/${id}`,
      data
    );
    return response.data;
  },

  delete: async (workspaceId: number, id: number): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/recurring-expenses/${id}`);
  },

  markPaid: async (workspaceId: number, id: number): Promise<{ recurring_expense: RecurringExpense; transaction?: Transaction }> => {
    const response = await apiClient.post<{ recurring_expense: RecurringExpense; transaction?: Transaction }>(
      `/workspaces/${workspaceId}/recurring-expenses/${id}/mark-paid`
    );
    return response.data;
  },
};
