import apiClient from './client';
import type { Workspace, WorkspaceMember, WorkspaceInvite } from '../types';

interface WorkspaceWithRole extends Workspace {
  role: string;
}

export const workspacesApi = {
  list: async (): Promise<{ workspaces: WorkspaceWithRole[] }> => {
    const response = await apiClient.get<{ workspaces: WorkspaceWithRole[] }>('/workspaces');
    return response.data;
  },

  create: async (name: string): Promise<{ workspace: Workspace }> => {
    const response = await apiClient.post<{ workspace: Workspace }>('/workspaces', { name });
    return response.data;
  },

  get: async (id: number): Promise<{ workspace: Workspace }> => {
    const response = await apiClient.get<{ workspace: Workspace }>(`/workspaces/${id}`);
    return response.data;
  },

  getMembers: async (id: number): Promise<{ members: WorkspaceMember[] }> => {
    const response = await apiClient.get<{ members: WorkspaceMember[] }>(`/workspaces/${id}/members`);
    return response.data;
  },

  createInvite: async (id: number, email?: string, role?: string): Promise<{ invite: WorkspaceInvite; invite_link: string }> => {
    const response = await apiClient.post<{ invite: WorkspaceInvite; invite_link: string }>(`/workspaces/${id}/invite`, {
      email,
      role: role || 'member',
    });
    return response.data;
  },

  joinByToken: async (token: string): Promise<{ workspace: Workspace; membership: WorkspaceMember }> => {
    const response = await apiClient.post<{ workspace: Workspace; membership: WorkspaceMember }>(`/workspaces/join/${token}`);
    return response.data;
  },

  removeMember: async (workspaceId: number, userId: number): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/members/${userId}`);
  },
};
