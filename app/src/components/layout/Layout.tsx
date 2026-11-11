import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authSlice';
import { useWorkspaceStore } from '../../store/workspaceSlice';
import { useThemeStore } from '../../store/themeSlice';
import { workspacesApi } from '../../api/workspaces';
import { CurrencyToggle } from '../CurrencyToggle';
import { ExchangeRateModal } from '../ExchangeRateModal';
import { RejectedChanges, SyncIndicator } from '../SyncIndicator';
import { ServerSettings } from '../ServerSettings';
import { discardLocalData, startSync } from '../../sync/engine';
import { useSyncStore } from '../../store/syncSlice';

const navItems = [
  { path: '/', icon: 'dashboard', label: 'Overview' },
  { path: '/transactions', icon: 'receipt_long', label: 'Records' },
  { path: '/recurring-expenses', icon: 'event_repeat', label: 'Planned Spending' },
  { path: '/insights', icon: 'analytics', label: 'Insights' },
  { path: '/chat', icon: 'forum', label: 'AI Chat' },
  { path: '/areas', icon: 'category', label: 'Areas' },
  { path: '/workspaces', icon: 'workspaces', label: 'Workspaces' },
];

// On a phone the first three live in the bottom bar; the rest sit behind "More".
const primaryNav = navItems.slice(0, 3);
const secondaryNav = navItems.slice(3);

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { workspaces, currentWorkspace, setWorkspaces, setCurrentWorkspace } = useWorkspaceStore();
  const { theme, toggleTheme } = useThemeStore();
  const [isExchangeRateModalOpen, setIsExchangeRateModalOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isServerOpen, setIsServerOpen] = useState(false);
  const pending = useSyncStore((state) => state.pending);

  useEffect(() => startSync(), []);
  // Changing screen closes the phone menu.
  useEffect(() => setIsMoreOpen(false), [location.pathname]);

  const { data: workspacesData } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => workspacesApi.list(),
  });

  useEffect(() => {
    if (workspacesData?.workspaces) {
      setWorkspaces(workspacesData.workspaces);
      if (!currentWorkspace && workspacesData.workspaces.length > 0) {
        setCurrentWorkspace(workspacesData.workspaces[0]);
      }
    }
  }, [workspacesData, currentWorkspace, setWorkspaces, setCurrentWorkspace]);

  const handleLogout = async () => {
    if (pending > 0 && !confirm(
      `${pending} change${pending === 1 ? ' has' : 's have'} not reached the server yet and will be lost. Sign out anyway?`,
    )) {
      return;
    }
    logout();
    await discardLocalData();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const workspaceSelect = (className: string) => (
    <select
      value={currentWorkspace?.id || ''}
      onChange={(e) => {
        const ws = workspaces.find((w) => w.id === Number(e.target.value));
        if (ws) setCurrentWorkspace(ws);
      }}
      className={className}
      aria-label="Workspace"
    >
      {workspaces.map((ws) => (
        <option key={ws.id} value={ws.id}>
          {ws.name}
        </option>
      ))}
    </select>
  );

  const navIcon = (item: { path: string; icon: string }) => (
    <span
      className="material-symbols-outlined"
      style={{ fontVariationSettings: isActive(item.path) ? "'FILL' 1" : "'FILL' 0" }}
    >
      {item.icon}
    </span>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col h-screen w-64 bg-surface-container-low py-8 px-6 space-y-8 sticky top-0 border-r border-surface-container">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>spa</span>
          </div>
          <div>
            <h2 className="text-lg font-headline font-black text-primary leading-none">Tostado</h2>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant opacity-60 font-bold mt-1">Gastos</p>
          </div>
        </div>

        {/* Workspace Selector */}
        {workspaces.length > 0 && (
          <div className="px-2">
            <label className="text-[10px] uppercase tracking-widest text-on-surface-variant opacity-60 font-bold">Workspace</label>
            {workspaceSelect('w-full mt-2 px-3 py-2 rounded-lg bg-surface-container-low border-none text-sm font-medium')}
          </div>
        )}

        <nav className="flex-1 space-y-2 mt-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isActive(item.path)
                  ? 'text-primary font-semibold bg-primary/10'
                  : 'text-on-surface-variant hover:bg-primary/10 hover:text-primary'
              }`}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: isActive(item.path) ? "'FILL' 1" : "'FILL' 0" }}
              >
                {item.icon}
              </span>
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto space-y-4">
          <Link
            to="/transactions/new"
            className="w-full bg-primary-container text-white font-headline font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined">add</span>
            New Transaction
          </Link>

          <SyncIndicator />

          {/* Currency controls */}
          <div className="flex items-center justify-between gap-2 px-2">
            <CurrencyToggle />
            <button
              onClick={() => setIsExchangeRateModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-surface-container transition-colors text-on-surface-variant text-sm"
              title="Manage exchange rates"
            >
              <span className="material-symbols-outlined text-base">settings</span>
            </button>
            <button
              onClick={() => setIsServerOpen(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-surface-container transition-colors text-on-surface-variant text-sm"
              title="Server address"
            >
              <span className="material-symbols-outlined text-base">dns</span>
            </button>
          </div>

          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-white text-sm font-bold">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-on-surface-variant truncate">{user?.email}</p>
            </div>
            <button
              onClick={toggleTheme}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              <span className="material-symbols-outlined text-xl">
                {theme === 'light' ? 'dark_mode' : 'light_mode'}
              </span>
            </button>
            <button
              onClick={handleLogout}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
              title="Sign out"
            >
              <span className="material-symbols-outlined text-xl">logout</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-surface-container bg-surface-container-low px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-container">
            <span className="material-symbols-outlined text-lg text-white" style={{ fontVariationSettings: "'FILL' 1" }}>spa</span>
          </div>
          {workspaces.length > 0
            ? workspaceSelect('min-w-0 flex-1 truncate rounded-lg border-none bg-transparent py-1 text-sm font-semibold')
            : <span className="flex-1 font-headline font-black text-primary">Tostado</span>}
          <SyncIndicator compact />
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto px-0 py-4 pb-28 md:px-8 md:py-8 md:pb-8">
          <RejectedChanges />
          <Outlet />
        </main>
      </div>

      {/* Phone bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-surface-container bg-surface-container-low pb-[env(safe-area-inset-bottom)] md:hidden">
        {primaryNav.slice(0, 2).map((item) => (
          <Link key={item.path} to={item.path} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${isActive(item.path) ? 'text-primary' : 'text-on-surface-variant'}`}>
            {navIcon(item)}
            {item.label}
          </Link>
        ))}
        <Link to="/transactions/new" aria-label="New transaction" className="-mt-5 flex h-14 w-14 shrink-0 items-center justify-center self-center rounded-full bg-primary-container text-white shadow-lg">
          <span className="material-symbols-outlined text-3xl">add</span>
        </Link>
        {primaryNav.slice(2).map((item) => (
          <Link key={item.path} to={item.path} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${isActive(item.path) ? 'text-primary' : 'text-on-surface-variant'}`}>
            {navIcon(item)}
            Planned
          </Link>
        ))}
        <button type="button" onClick={() => setIsMoreOpen(true)} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${secondaryNav.some((item) => isActive(item.path)) ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined">menu</span>
          More
        </button>
      </nav>

      {/* Phone "More" sheet */}
      {isMoreOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 space-y-1 rounded-t-3xl bg-surface-container-lowest p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {secondaryNav.map((item) => (
              <Link key={item.path} to={item.path} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${isActive(item.path) ? 'bg-primary/10 font-semibold text-primary' : 'text-on-surface-variant'}`}>
                {navIcon(item)}
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            ))}
            <div className="flex items-center justify-between gap-2 border-t border-surface-container px-2 pt-3">
              <CurrencyToggle />
              <div className="flex items-center gap-1 text-on-surface-variant">
                <button type="button" onClick={() => { setIsMoreOpen(false); setIsExchangeRateModalOpen(true); }} className="rounded-lg p-2" title="Manage exchange rates">
                  <span className="material-symbols-outlined">currency_exchange</span>
                </button>
                <button type="button" onClick={() => { setIsMoreOpen(false); setIsServerOpen(true); }} className="rounded-lg p-2" title="Server address">
                  <span className="material-symbols-outlined">dns</span>
                </button>
                <button type="button" onClick={toggleTheme} className="rounded-lg p-2" title="Switch theme">
                  <span className="material-symbols-outlined">{theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
                </button>
                <button type="button" onClick={handleLogout} className="rounded-lg p-2" title="Sign out">
                  <span className="material-symbols-outlined">logout</span>
                </button>
              </div>
            </div>
            <p className="truncate px-4 pt-1 text-xs text-on-surface-variant">{user?.name} · {user?.email}</p>
          </div>
        </div>
      )}

      <ServerSettings isOpen={isServerOpen} onClose={() => setIsServerOpen(false)} />

      {/* Exchange Rate Modal */}
      <ExchangeRateModal
        isOpen={isExchangeRateModalOpen}
        onClose={() => setIsExchangeRateModalOpen(false)}
      />
    </div>
  );
}
