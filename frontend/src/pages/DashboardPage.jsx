import { useState, useEffect } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Avatar } from '../components/UI';
import { AlertTriangle, Home } from 'lucide-react';

export default function DashboardPage({ onNavigate }) {
  const [stats, setStats] = useState({ employees: [], schedules: [], timesheets: [], invoices: [], accommodations: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getSchedules(),
      api.getTimesheets(),
      api.getInvoices(),
      api.getAccommodations(),
    ]).then(([employees, schedules, timesheets, invoices, accommodations]) => {
      setStats({ employees, schedules, timesheets, invoices, accommodations });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Chargement...</div>;

  const { employees, schedules, timesheets, invoices, accommodations } = stats;
  const totalHrs = schedules.reduce((s, x) => s + x.hours, 0);
  const pending = timesheets.filter(t => t.status === 'submitted').length;
  const invoiced = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const empCount = new Set(schedules.map(s => s.employee_id)).size;
  const accomTotal = accommodations.reduce((s, a) => s + (a.total_cost || 0), 0);

  // Overdue invoices
  const overdueList = invoices.filter(inv => {
    if (inv.status === 'paid') return false;
    const d = new Date(inv.date);
    return Math.floor((new Date() - d) / (1000 * 60 * 60 * 24)) > 30;
  });

  // Top employees by hours
  const empHours = {};
  schedules.forEach(s => { empHours[s.employee_id] = (empHours[s.employee_id] || 0) + s.hours; });
  const topEmps = employees
    .filter(e => empHours[e.id])
    .sort((a, b) => (empHours[b.id] || 0) - (empHours[a.id] || 0))
    .slice(0, 10);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">
          <Home size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Tableau de bord
        </h1>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {new Date().toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Overdue alert banner */}
      {overdueList.length > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: 'var(--r)', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500,
          background: 'var(--red-l)', color: 'var(--red)', border: '1px solid var(--red-b)',
        }}>
          <AlertTriangle size={16} />
          <span style={{ background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
            {overdueList.length}
          </span>
          <span>
            <strong>{overdueList.length} facture(s) en retard</strong> — Paiement dépassé de plus de 30 jours.
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('invoices'); }}
              style={{ color: 'var(--red)', fontWeight: 600, textDecoration: 'underline', marginLeft: 4 }}>
              Voir les factures →
            </a>
          </span>
        </div>
      )}

      <div className="stats-row" style={{ marginBottom: 20 }}>
        <div className="stat-card" style={{ background: 'var(--brand-l)' }}>
          <div className="label" style={{ color: 'var(--brand)' }}>Quarts</div>
          <div className="value" style={{ color: 'var(--brand)' }}>{schedules.length}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--brand-xl)' }}>
          <div className="label" style={{ color: 'var(--brand-m)' }}>Employés actifs</div>
          <div className="value" style={{ color: 'var(--brand-m)' }}>{empCount}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--amber-l)' }}>
          <div className="label" style={{ color: 'var(--amber)' }}>FDT en attente</div>
          <div className="value" style={{ color: 'var(--amber)' }}>{pending}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--green-l)' }}>
          <div className="label" style={{ color: 'var(--green)' }}>Total facturé</div>
          <div className="value" style={{ color: 'var(--green)' }}>{fmtMoney(invoiced)}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--purple-l)' }}>
          <div className="label" style={{ color: 'var(--purple)' }}>Hébergement</div>
          <div className="value" style={{ color: 'var(--purple)' }}>{fmtMoney(accomTotal)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--brand-d)' }}>
          Résumé heures par employé
        </div>
        {topEmps.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucune donnée</div>
        )}
        {topEmps.map(e => {
          const hrs = empHours[e.id] || 0;
          const pct = totalHrs ? Math.round(hrs / totalHrs * 100) : 0;
          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <Avatar name={e.name} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--brand)', borderRadius: 2 }} />
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)', minWidth: 45, textAlign: 'right' }}>{hrs.toFixed(1)}h</span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => onNavigate('schedules')}>Voir les horaires →</button>
        <button className="btn btn-outline" onClick={() => onNavigate('invoices')}>Voir la facturation →</button>
        {pending > 0 && <button className="btn btn-amber" onClick={() => onNavigate('timesheets')}>{pending} FDT en attente →</button>}
      </div>
    </>
  );
}
