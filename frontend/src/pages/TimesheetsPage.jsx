import { useState, useEffect } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Badge, Avatar } from '../components/UI';
import { Check, X } from 'lucide-react';

export default function TimesheetsPage({ toast }) {
  const [timesheets, setTimesheets] = useState([]);
  const [employees, setEmployees] = useState([]);

  const reload = async () => {
    const [ts, emps] = await Promise.all([api.getTimesheets(), api.getEmployees()]);
    setTimesheets(ts); setEmployees(emps);
  };
  useEffect(() => { reload(); }, []);

  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`;

  const approve = async (id) => { await api.approveTimesheet(id); toast?.('FDT approuvée'); reload(); };
  const reject = async (id) => { await api.rejectTimesheet(id); toast?.('FDT refusée'); reload(); };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Feuilles de temps</h1>
      </div>

      {timesheets.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          Aucune feuille de temps soumise
        </div>
      )}

      {timesheets.map(ts => {
        const totalHrs = ts.shifts.reduce((s, sh) => s + sh.hours_worked, 0);
        const totalGarde = ts.shifts.reduce((s, sh) => s + (sh.garde_hours || 0), 0);
        const totalRappel = ts.shifts.reduce((s, sh) => s + (sh.rappel_hours || 0), 0);

        return (
          <div key={ts.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={empName(ts.employee_id)} size={36} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{empName(ts.employee_id)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    Période: {ts.period_start} au {ts.period_end} — {ts.shifts.length} quart(s)
                  </div>
                </div>
              </div>
              <Badge status={ts.status} />
            </div>

            <div className="stats-row" style={{ marginTop: 12, marginBottom: 8 }}>
              <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '10px 14px', minWidth: 100 }}>
                <div className="label" style={{ color: 'var(--brand)', fontSize: 10 }}>Heures</div>
                <div className="value" style={{ color: 'var(--brand)', fontSize: 18 }}>{totalHrs.toFixed(1)}h</div>
              </div>
              {totalGarde > 0 && (
                <div className="stat-card" style={{ background: 'var(--amber-l)', padding: '10px 14px', minWidth: 100 }}>
                  <div className="label" style={{ color: 'var(--amber)', fontSize: 10 }}>Garde</div>
                  <div className="value" style={{ color: 'var(--amber)', fontSize: 18 }}>{totalGarde.toFixed(1)}h</div>
                </div>
              )}
              {totalRappel > 0 && (
                <div className="stat-card" style={{ background: 'var(--red-l)', padding: '10px 14px', minWidth: 100 }}>
                  <div className="label" style={{ color: 'var(--red)', fontSize: 10 }}>Rappel</div>
                  <div className="value" style={{ color: 'var(--red)', fontSize: 18 }}>{totalRappel.toFixed(1)}h</div>
                </div>
              )}
            </div>

            {ts.status === 'submitted' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button className="btn btn-success btn-sm" onClick={() => approve(ts.id)}><Check size={14} /> Approuver</button>
                <button className="btn btn-danger btn-sm" onClick={() => reject(ts.id)}><X size={14} /> Refuser</button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
