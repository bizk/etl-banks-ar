import apiClient from './client';
import type { Category } from '../types';

interface CreateCategoryRequest {
  name: string;
  area_id?: number | null;
  color?: string;
  icon?: string;
}

interface UpdateCategoryRequest {
  name?: string;
  area_id?: number | null;
  color?: string;
  icon?: string;
}

export const categoriesApi = {
  list: async (workspaceId: number): Promise<{ categories: Category[] }> => {
    const response = await apiClient.get<{ categories: Category[] }>(
      `/workspaces/${workspaceId}/categories`
    );
    return response.data;
  },

  get: async (workspaceId: number, categoryId: number): Promise<{ category: Category }> => {
    const response = await apiClient.get<{ category: Category }>(
      `/workspaces/${workspaceId}/categories/${categoryId}`
    );
    return response.data;
  },

  create: async (workspaceId: number, data: CreateCategoryRequest): Promise<{ category: Category }> => {
    const response = await apiClient.post<{ category: Category }>(
      `/workspaces/${workspaceId}/categories`,
      data
    );
    return response.data;
  },

  update: async (workspaceId: number, categoryId: number, data: UpdateCategoryRequest): Promise<{ category: Category }> => {
    const response = await apiClient.put<{ category: Category }>(
      `/workspaces/${workspaceId}/categories/${categoryId}`,
      data
    );
    return response.data;
  },

  delete: async (workspaceId: number, categoryId: number): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/categories/${categoryId}`);
  },
};
