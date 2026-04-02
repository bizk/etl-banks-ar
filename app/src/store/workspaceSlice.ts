import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace } from '../types';

interface WorkspaceWithRole extends Workspace {
  role: string;
}

interface WorkspaceState {
  workspaces: WorkspaceWithRole[];
  currentWorkspace: WorkspaceWithRole | null;
  setWorkspaces: (workspaces: WorkspaceWithRole[]) => void;
  setCurrentWorkspace: (workspace: WorkspaceWithRole | null) => void;
  addWorkspace: (workspace: WorkspaceWithRole) => void;
  clear: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspaces: [],
      currentWorkspace: null,
      setWorkspaces: (workspaces) => set({ workspaces }),
      setCurrentWorkspace: (workspace) => set({ currentWorkspace: workspace }),
      addWorkspace: (workspace) =>
        set((state) => ({ workspaces: [...state.workspaces, workspace] })),
      clear: () => set({ workspaces: [], currentWorkspace: null }),
    }),
    {
      name: 'workspace-storage',
    }
  )
);
