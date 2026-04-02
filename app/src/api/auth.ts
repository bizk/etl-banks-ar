import apiClient from './client';
import type { User } from '../types';

interface AuthResponse {
  user: User;
  token: string;
}

export const authApi = {
  register: async (email: string, password: string, name: string): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/register', {
      email,
      password,
      name,
    });
    return response.data;
  },

  login: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', {
      email,
      password,
    });
    return response.data;
  },

  me: async (): Promise<{ user: User }> => {
    const response = await apiClient.get<{ user: User }>('/auth/me');
    return response.data;
  },
};
