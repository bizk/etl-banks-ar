import { syncNow } from '../sync/engine';
import { useSyncStore } from '../store/syncSlice';

/** Shows whether this device is in step with the server; tap to sync now. */
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const { status, pending, error } = useSyncStore();

  const view = {
    syncing: { icon: 'sync', label: 'Syncing…', tone: 'text-on-surface-variant' },
    offline: { icon: 'cloud_off', label: 'Offline', tone: 'text-tertiary' },
    error: { icon: 'sync_problem', label: 'Sync failed', tone: 'text-error' },
    idle: pending > 0
      ? { icon: 'cloud_upload', label: 'Waiting to sync', tone: 'text-on-surface-variant' }
      : { icon: 'cloud_done', label: 'Up to date', tone: 'text-primary' },
  }[status];
  const waiting = pending > 0 ? `${pending} unsent change${pending === 1 ? '' : 's'}` : null;

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={[view.label, waiting, error].filter(Boolean).join(' · ')}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors hover:bg-surface-container ${view.tone}`}
    >
      <span className={`material-symbols-outlined text-lg ${status === 'syncing' ? 'animate-spin' : ''}`}>{view.icon}</span>
      {!compact && <span className="truncate">{waiting ?? view.label}</span>}
      {compact && pending > 0 && <span className="tabular-nums">{pending}</span>}
    </button>
  );
}

/** Lists changes the server refused, so a reverted edit never goes unnoticed. */
export function RejectedChanges() {
  const { rejected, dismissRejected } = useSyncStore();
  if (rejected.length === 0) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-error/10 px-4 py-3 text-sm text-error">
      <span className="material-symbols-outlined text-lg">sync_problem</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Some changes made offline could not be saved</p>
        <ul className="mt-1 list-disc pl-4">
          {rejected.map((message, i) => <li key={i}>{message}</li>)}
        </ul>
      </div>
      <button type="button" onClick={dismissRejected} title="Dismiss">
        <span className="material-symbols-outlined text-lg">close</span>
      </button>
    </div>
  );
}

/** For screens that only work with the server in reach. */
export function OfflineNotice({ feature }: { feature: string }) {
  const offline = useSyncStore((state) => state.status === 'offline');
  if (!offline) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
      <span className="material-symbols-outlined text-lg">cloud_off</span>
      <span>{feature} needs a connection to the server. It will work again once you are back online.</span>
    </div>
  );
}
