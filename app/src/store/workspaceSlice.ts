import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace } from '../types';

interface WorkspaceWithRole extends Workspace {
  role: string;
}

interface WorkspaceState {
  workspaces: WorkspaceWithRole[];
  currentWorkspace: WorkspaceWithRole | null;
  selectedMonth: Date;
  setWorkspaces: (workspaces: WorkspaceWithRole[]) => void;
  setCurrentWorkspace: (workspace: WorkspaceWithRole | null) => void;
  setSelectedMonth: (date: Date) => void;
  addWorkspace: (workspace: WorkspaceWithRole) => void;
  clear: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspaces: [],
      currentWorkspace: null,
      selectedMonth: new Date(),
      setWorkspaces: (workspaces) => set({ workspaces }),
      setCurrentWorkspace: (workspace) => set({ currentWorkspace: workspace }),
      setSelectedMonth: (date) => set({ selectedMonth: date }),
      addWorkspace: (workspace) =>
        set((state) => ({ workspaces: [...state.workspaces, workspace] })),
      clear: () => set({ workspaces: [], currentWorkspace: null, selectedMonth: new Date() }),
    }),
    {
      name: 'workspace-storage',
      partialize: (state) => ({
        workspaces: state.workspaces,
        currentWorkspace: state.currentWorkspace,
        selectedMonth: state.selectedMonth,
      }),
    }
  )
);
