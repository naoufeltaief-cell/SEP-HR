import { initials, statusColors } from '../utils/helpers';
import { Home, Calendar, Users, Clock, BedDouble, DollarSign, LogOut, X, Menu, UserPlus } from 'lucide-react';
import { useState } from 'react';

const LOGO_SRC = "data:image/jpeg;base64,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";

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
  { id: 'candidates', label: 'Candidats', icon: UserPlus },
  { id: 'timesheets', label: 'Feuilles de temps', icon: Clock },
  { id: 'accommodations', label: 'Hébergement', icon: BedDouble },
  { id: 'invoices', label: 'Facturation', icon: DollarSign },
];

export function Sidebar({ currentPage, onNavigate, onLogout, user, overdueCount = 0 }) {
  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={LOGO_SRC} alt="Soins Expert Plus" />
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
                {n.id === 'invoices' && overdueCount > 0 && (
                  <span className="nav-badge">{overdueCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="avatar" style={{ width: 34, height: 34, fontSize: 12, background: 'rgba(255,255,255,.15)', color: '#fff' }}>
            {initials(user?.name || user?.email || 'NT')}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{user?.name || 'Admin'}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)' }}>{user?.role === 'admin' ? 'Administrateur' : 'Employé'}</div>
          </div>
          <button onClick={onLogout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', padding: 4 }}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
