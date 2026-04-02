import { initials, statusColors } from '../utils/helpers';
import { Home, Calendar, Users, Clock, BedDouble, DollarSign, LogOut, X, Menu, UserPlus } from 'lucide-react';
import { useState } from 'react';

const LOGO_SRC = "data:image/jpeg;base64,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";

export function Modal({ title, onClose, wide, children, open = true }) {
  if (!open) return null;
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

export function Badge({ status }) {
  const s = statusColors[status] || statusColors.draft;
  return <span className="badge" style={{ background: s.bg, color: s.text }}>{s.label}</span>;
}

export function Avatar({ name, size = 36, bg = 'var(--brand-l)', color = 'var(--brand)' }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * .35), background: bg, color }}>
      {initials(name || '??')}
    </div>
  );
}

export function ToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => <div key={t.id} className="toast">{t.message}</div>)}
    </div>
  );
}

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
