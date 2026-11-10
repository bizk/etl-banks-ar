import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  /** Changes made on this device that the server has not confirmed yet. */
  pending: number;
  lastSyncedAt: number | null;
  /** Why the last sync failed, when status is 'error'. */
  error: string | null;
  /** Changes the server refused; the local copy was reverted to the server's. */
  rejected: string[];
  set: (patch: Partial<Omit<SyncState, 'set' | 'dismissRejected'>>) => void;
  dismissRejected: () => void;
}

export const useSyncStore = create<SyncState>()((set) => ({
  status: 'idle',
  pending: 0,
  lastSyncedAt: null,
  error: null,
  rejected: [],
  set: (patch) => set(patch),
  dismissRejected: () => set({ rejected: [] }),
}));

/** True when the last attempt to reach the server failed. */
export const useIsOffline = () => useSyncStore((state) => state.status === 'offline');
