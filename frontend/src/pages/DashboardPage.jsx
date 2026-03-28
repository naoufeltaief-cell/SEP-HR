import { useState, useEffect } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Avatar } from '../components/UI';

export default function DashboardPage({ onNavigate }) {
  const [stats, setStats] = useState({ employees: [], schedules: [], timesheets: [], invoices: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getSchedules(),
      api.getTimesheets(),
      api.getInvoices(),
    ]).then(([employees, schedules, timesheets, invoices]) => {
      setStats({ employees, schedules, timesheets, invoices });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Chargement...</div>;

  const { employees, schedules, timesheets, invoices } = stats;
  const totalHrs = schedules.reduce((s, x) => s + x.hours, 0);
  const pending = timesheets.filter(t => t.status === 'submitted').length;
  const invoiced = invoices.reduce((s, i) => s + i.total, 0);
  const empCount = new Set(schedules.map(s => s.employee_id)).size;

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
        <h1 className="page-title">Tableau de bord</h1>
      </div>

      <div className="stats-row">
        <div className="stat-card" style={{ background: 'var(--brand-l)' }}>
          <div className="label" style={{ color: 'var(--brand)' }}>Employés actifs</div>
          <div className="value" style={{ color: 'var(--brand)' }}>{empCount}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--brand-l)' }}>
          <div className="label" style={{ color: 'var(--brand)' }}>Quarts</div>
          <div className="value" style={{ color: 'var(--brand)' }}>{schedules.length}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--amber-l)' }}>
          <div className="label" style={{ color: 'var(--amber)' }}>FDT en attente</div>
          <div className="value" style={{ color: 'var(--amber)' }}>{pending}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--green-l)' }}>
          <div className="label" style={{ color: 'var(--green)' }}>Facturé</div>
          <div className="value" style={{ color: 'var(--green)' }}>{fmtMoney(invoiced)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--brand-d)' }}>
          Top employés par heures
        </div>
        {topEmps.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucune donnée</div>
        )}
        {topEmps.map(e => {
          const hrs = empHours[e.id] || 0;
          const pct = totalHrs ? Math.round(hrs / totalHrs * 100) : 0;
          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <Avatar name={e.name} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.position}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 14 }}>{hrs.toFixed(1)}h</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{pct}%</div>
              </div>
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
