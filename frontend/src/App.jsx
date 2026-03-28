import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useToast } from './hooks/useToast';
import { Sidebar, ToastContainer } from './components/UI';
import ChatWidget from './components/ChatWidget';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SchedulesPage from './pages/SchedulesPage';
import EmployeesPage from './pages/EmployeesPage';
import TimesheetsPage from './pages/TimesheetsPage';
import InvoicesPage from './pages/InvoicesPage';
import AccommodationsPage from './pages/AccommodationsPage';

export default function App() {
  const { user, loading, logout } = useAuth();
  const { toasts, show: toast } = useToast();
  const [page, setPage] = useState('dashboard');

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface2)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--brand)', marginBottom: 8 }}>Soins Expert Plus</div>
          <div style={{ color: 'var(--text3)' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const pages = {
    dashboard: <DashboardPage onNavigate={setPage} />,
    schedules: <SchedulesPage toast={toast} />,
    employees: <EmployeesPage toast={toast} />,
    timesheets: <TimesheetsPage toast={toast} />,
    invoices: <InvoicesPage toast={toast} />,
    accommodations: <AccommodationsPage toast={toast} />,
  };

  return (
    <div className="app-layout">
      <Sidebar currentPage={page} onNavigate={setPage} onLogout={logout} user={user} />
      <main className="main-content">
        {pages[page] || pages.dashboard}
      </main>
      <ToastContainer toasts={toasts} />
      {user.role === 'admin' && <ChatWidget />}
    </div>
  );
}
