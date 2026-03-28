import { initials, statusColors } from '../utils/helpers';
import { Home, Calendar, Users, Clock, BedDouble, DollarSign, LogOut, X, Menu } from 'lucide-react';
import { useState } from 'react';

// ── Modal ──
export function Modal({ title, onClose, wide, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-box ${wide ? 'wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ── Badge ──
export function Badge({ status }) {
  const s = statusColors[status] || statusColors.draft;
  return <span className="badge" style={{ background: s.bg, color: s.text }}>{s.label}</span>;
}

// ── Avatar ──
export function Avatar({ name, size = 36, bg = 'var(--brand-l)', color = 'var(--brand)' }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * .35), background: bg, color }}>
      {initials(name || '??')}
    </div>
  );
}

// ── Toast Container ──
export function ToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => <div key={t.id} className="toast">{t.message}</div>)}
    </div>
  );
}

// ── Sidebar ──
const NAV = [
  { id: 'dashboard', label: 'Tableau de bord', icon: Home },
  { id: 'schedules', label: 'Horaires', icon: Calendar },
  { id: 'employees', label: 'Employés', icon: Users },
  { id: 'timesheets', label: 'Feuilles de temps', icon: Clock },
  { id: 'accommodations', label: 'Hébergement', icon: BedDouble },
  { id: 'invoices', label: 'Facturation', icon: DollarSign },
];

export function Sidebar({ currentPage, onNavigate, onLogout, user }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        style={{
          position: 'fixed', top: 12, left: 12, zIndex: 1001,
          background: 'var(--brand)', color: 'white', border: 'none',
          borderRadius: 'var(--r)', padding: '8px 10px', cursor: 'pointer',
          display: 'none', // shown via media query if needed
        }}
      >
        <Menu size={20} />
      </button>

      <aside className="sidebar">
        <div className="sidebar-logo">
          <div>Soins Expert</div>
          <div style={{ fontSize: 12, fontWeight: 500, opacity: .7, marginTop: 2 }}>Plus</div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                className={`nav-item ${currentPage === n.id ? 'active' : ''}`}
                onClick={() => onNavigate(n.id)}
              >
                <Icon size={18} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: '16px 8px', borderTop: '1px solid rgba(255,255,255,.12)' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', padding: '0 14px', marginBottom: 8 }}>
            {user?.email}
          </div>
          <button className="nav-item" onClick={onLogout}>
            <LogOut size={18} />
            Déconnexion
          </button>
        </div>
      </aside>
    </>
  );
}
