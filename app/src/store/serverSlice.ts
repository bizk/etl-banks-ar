import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Where the API lives. Empty means "the same place this app was loaded from", which is
// right whenever the app is opened straight from the server. Setting it lets an installed
// app keep working after the server moves to another address.

interface ServerState {
  /** Origin of the server, e.g. http://192.168.100.181, or '' for this app's own origin. */
  serverUrl: string;
  setServerUrl: (url: string) => void;
}

/** Turns what a person types ("192.168.100.181", "pi.local:8080/") into an origin. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme); // throws on nonsense, which callers report
  return url.origin;
}

export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      serverUrl: '',
      setServerUrl: (url) => set({ serverUrl: normalizeServerUrl(url) }),
    }),
    { name: 'server-storage' },
  ),
);

export const API_PATH = '/api/v1';

/** Base URL for API calls, for the configured server or this origin. */
export const apiBaseUrl = (serverUrl = useServerStore.getState().serverUrl) => `${serverUrl}${API_PATH}`;
