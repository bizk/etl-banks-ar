import apiClient from './client';
import type { Area } from '../types';

interface CreateAreaRequest {
  name: string;
  color?: string;
  icon?: string;
}

interface UpdateAreaRequest {
  name?: string;
  color?: string;
  icon?: string;
}

export interface AreaCategorySummary {
  category_id: number;
  category_name: string;
  amount: number;
  count: number;
}

export interface AreaSummaryItem {
  area_id: number | null;
  area_name: string;
  color: string;
  icon: string;
  amount: number;
  count: number;
  percentage: number;
  categories: AreaCategorySummary[];
}

export interface AreaSummaryResponse {
  month: string;
  total_spent: number;
  areas: AreaSummaryItem[];
}

export const areasApi = {
  list: async (workspaceId: number): Promise<{ areas: Area[] }> => {
    const response = await apiClient.get<{ areas: Area[] }>(
      `/workspaces/${workspaceId}/areas`
    );
    return response.data;
  },

  get: async (workspaceId: number, areaId: number): Promise<{ area: Area }> => {
    const response = await apiClient.get<{ area: Area }>(
      `/workspaces/${workspaceId}/areas/${areaId}`
    );
    return response.data;
  },

  create: async (workspaceId: number, data: CreateAreaRequest): Promise<{ area: Area }> => {
    const response = await apiClient.post<{ area: Area }>(
      `/workspaces/${workspaceId}/areas`,
      data
    );
    return response.data;
  },

  update: async (workspaceId: number, areaId: number, data: UpdateAreaRequest): Promise<{ area: Area }> => {
    const response = await apiClient.put<{ area: Area }>(
      `/workspaces/${workspaceId}/areas/${areaId}`,
      data
    );
    return response.data;
  },

  delete: async (workspaceId: number, areaId: number): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/areas/${areaId}`);
  },

  getSummary: async (workspaceId: number, month: string): Promise<AreaSummaryResponse> => {
    const response = await apiClient.get<AreaSummaryResponse>(
      `/workspaces/${workspaceId}/areas/summary?month=${month}`
    );
    return response.data;
  },
};
