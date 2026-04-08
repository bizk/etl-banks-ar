import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authSlice';
import { useWorkspaceStore } from '../../store/workspaceSlice';
import { useThemeStore } from '../../store/themeSlice';
import { workspacesApi } from '../../api/workspaces';

const navItems = [
  { path: '/', icon: 'dashboard', label: 'Overview' },
  { path: '/transactions', icon: 'receipt_long', label: 'Records' },
  { path: '/recurring-expenses', icon: 'event_repeat', label: 'Planned Spending' },
  { path: '/insights', icon: 'analytics', label: 'Insights' },
  { path: '/areas', icon: 'category', label: 'Areas' },
  { path: '/workspaces', icon: 'workspaces', label: 'Workspaces' },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { workspaces, currentWorkspace, setWorkspaces, setCurrentWorkspace } = useWorkspaceStore();
  const { theme, toggleTheme } = useThemeStore();

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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

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
            <select
              value={currentWorkspace?.id || ''}
              onChange={(e) => {
                const ws = workspaces.find((w) => w.id === Number(e.target.value));
                if (ws) setCurrentWorkspace(ws);
              }}
              className="w-full mt-2 px-3 py-2 rounded-lg bg-surface-container-low border-none text-sm font-medium"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
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

      {/* Main Content */}
      <main className="flex-1 px-8 py-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
