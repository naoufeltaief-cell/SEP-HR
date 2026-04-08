import { initials, statusColors } from '../utils/helpers';
import { Home, Calendar, Users, Clock, BedDouble, DollarSign, LogOut, X, Menu, UserPlus } from 'lucide-react';
import { useState } from 'react';

const LOGO_SRC = "/logo.png";

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

const ADMIN_NAV = [
  { id: 'dashboard', label: 'Tableau de bord', icon: Home },
  { id: 'schedules', label: 'Horaires', icon: Calendar },
  { id: 'employees', label: 'Employés', icon: Users },
  { id: 'candidates', label: 'Candidats', icon: UserPlus },
  { id: 'timesheets', label: 'Feuilles de temps', icon: Clock },
  { id: 'accommodations', label: 'Hébergement', icon: BedDouble },
  { id: 'invoices', label: 'Facturation', icon: DollarSign },
];

const EMPLOYEE_NAV = [
  { id: 'my-schedule', label: 'Mon horaire', icon: Calendar },
];

export function Sidebar({ currentPage, onNavigate, onLogout, user, overdueCount = 0 }) {
  const navItems = user?.role === 'admin' ? ADMIN_NAV : EMPLOYEE_NAV;
  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={LOGO_SRC} alt="Soins Expert Plus" />
        </div>
        <nav className="sidebar-nav">
          {navItems.map(n => {
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
