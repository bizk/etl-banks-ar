import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { InsightsPage } from './pages/InsightsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { AreasPage } from './pages/AreasPage';
import { RecurringExpensesPage } from './pages/RecurringExpensesPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/recurring-expenses" element={<RecurringExpensesPage />} />
            <Route path="/areas" element={<AreasPage />} />
            <Route path="/workspaces" element={<WorkspacesPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
