import { useState } from 'react';
import { apiBaseUrl, normalizeServerUrl, useServerStore } from '../store/serverSlice';
import { syncNow } from '../sync/engine';

type Check = { state: 'idle' | 'checking' | 'ok' } | { state: 'failed'; message: string };

/** Asks the server anything at all: any HTTP answer, even "unauthorized", means it is there. */
async function reach(serverUrl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${apiBaseUrl(serverUrl)}/auth/me`, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    // The API answers this route with JSON; anything else is some other web server.
    if (body === null || typeof body !== 'object') throw new Error('That address did not answer like a Tostado server.');
  } finally {
    clearTimeout(timer);
  }
}

/** Lets the user point the app at another server address, e.g. after the server's IP changes. */
export function ServerSettings({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { serverUrl, setServerUrl } = useServerStore();
  const [value, setValue] = useState(serverUrl);
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  if (!isOpen) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    let next: string;
    try {
      next = normalizeServerUrl(value);
    } catch {
      setCheck({ state: 'failed', message: 'That does not look like an address. Try something like 192.168.100.181' });
      return;
    }
    setCheck({ state: 'checking' });
    try {
      await reach(next);
    } catch (err) {
      const reason = err instanceof Error && err.message.startsWith('That address') ? err.message : 'Could not reach a server there.';
      setCheck({ state: 'failed', message: `${reason} The address was not changed.` });
      return;
    }
    setServerUrl(next);
    setValue(next);
    setCheck({ state: 'ok' });
    void syncNow();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <button type="button" aria-label="Close server settings" className="absolute inset-0" onClick={onClose} />
      <form onSubmit={save} className="relative w-full rounded-t-2xl bg-surface-container-lowest p-5 shadow-xl sm:max-w-md sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-headline font-bold">Server</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <label className="mb-1 block text-sm font-medium text-on-surface-variant" htmlFor="server-address">Server address</label>
        <input
          id="server-address"
          value={value}
          onChange={(e) => { setValue(e.target.value); setCheck({ state: 'idle' }); }}
          placeholder="192.168.100.181"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-lg border-none bg-surface-container-low px-4 py-3 focus:ring-2 focus:ring-primary-container"
        />
        <p className="mt-2 text-xs text-on-surface-variant">
          The IP or name of the machine running Tostado. Leave it empty to use the address this app was opened from
          {serverUrl === '' && ` (${window.location.origin})`}.
        </p>
        {check.state === 'failed' && <p className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">{check.message}</p>}
        {check.state === 'ok' && <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">Connected. Saved.</p>}
        <button
          type="submit"
          disabled={check.state === 'checking'}
          className="mt-4 w-full rounded-xl bg-primary-container px-4 py-3 font-headline font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {check.state === 'checking' ? 'Checking…' : 'Check and save'}
        </button>
      </form>
    </div>
  );
}
