import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useToast } from './hooks/useToast';
import { Sidebar, ToastContainer } from './components/UI';
import ChatWidget from './components/ChatWidget';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SchedulesPage from './pages/SchedulesPage';
import EmployeesPage from './pages/EmployeesPage';
import CandidatesPage from './pages/CandidatesPage';
import TimesheetsPage from './pages/TimesheetsPage';
import InvoicesPage from './pages/InvoicesPage';
import AccommodationsPage from './pages/AccommodationsPage';
import api from './utils/api';

export default function App() {
  const { user, loading, logout } = useAuth();
  const { toasts, show: toast } = useToast();
  const [page, setPage] = useState('dashboard');
  const [overdueCount, setOverdueCount] = useState(0);

  // Load overdue count for sidebar badge
  useEffect(() => {
    if (!user) return;
    api.getInvoices().then(invoices => {
      const count = invoices.filter(inv => {
        if (inv.status === 'paid') return false;
        const d = new Date(inv.date);
        return Math.floor((new Date() - d) / (1000 * 60 * 60 * 24)) > 30;
      }).length;
      setOverdueCount(count);
    }).catch(() => {});
  }, [user, page]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
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
    schedules: <SchedulesPage toast={toast} onNavigate={setPage} />,
    employees: <EmployeesPage toast={toast} />,
    candidates: <CandidatesPage toast={toast} />,
    timesheets: <TimesheetsPage toast={toast} />,
    invoices: <InvoicesPage toast={toast} />,
    accommodations: <AccommodationsPage toast={toast} />,
  };

  return (
    <div className="app-layout">
      <Sidebar currentPage={page} onNavigate={setPage} onLogout={logout} user={user} overdueCount={overdueCount} />
      <main className="main-content">
        {pages[page] || pages.dashboard}
      </main>
      <ToastContainer toasts={toasts} />
      {user.role === 'admin' && <ChatWidget />}
    </div>
  );
}
