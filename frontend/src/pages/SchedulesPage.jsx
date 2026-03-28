import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { fmtDay, fmtISO, fmtMoney, getWeekDates, getMonthDates, DAYS, RATE_KM } from '../utils/helpers';
import { Avatar, Badge, Modal } from '../components/UI';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

export default function SchedulesPage({ toast }) {
  const [schedules, setSchedules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewMode, setViewMode] = useState('week');
  const [refDate, setRefDate] = useState(new Date());
  const [filterText, setFilterText] = useState('');
  const [modal, setModal] = useState(null); // { type: 'add'|'edit', data }
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [scheds, emps] = await Promise.all([api.getSchedules(), api.getEmployees()]);
      setSchedules(scheds);
      setEmployees(emps);
    } catch (err) { toast?.('Erreur: ' + err.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  const viewDates = viewMode === 'week' ? getWeekDates(refDate, weekOffset) : getMonthDates(refDate);
  const viewISOs = viewDates.map(fmtISO);

  const activeEmpIds = [...new Set(schedules.filter(s => viewISOs.includes(s.date)).map(s => s.employee_id))];
  let activeEmps = employees.filter(e => activeEmpIds.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (filterText) activeEmps = activeEmps.filter(e => e.name.toLowerCase().includes(filterText.toLowerCase()));

  const otherEmps = employees.filter(e => !activeEmpIds.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name));

  const nav = (dir) => {
    if (viewMode === 'week') setWeekOffset(o => o + dir);
    else setRefDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + dir); return n; });
  };

  const periodLabel = viewMode === 'week'
    ? `${fmtDay(viewDates[0])} — ${fmtDay(viewDates[6])}`
    : `${refDate.toLocaleString('fr-CA', { month: 'long', year: 'numeric' })}`;

  const openAdd = (employeeId, date) => {
    setModal({ type: 'add', data: { employeeId, date, start: '07:00', end: '15:00', hours: 7.5, pause: 0.5, location: '', billableRate: employees.find(e => e.id === employeeId)?.rate || 0, status: 'draft', notes: '' } });
  };
  const openEdit = (shift) => setModal({ type: 'edit', data: { ...shift } });

  const saveShift = async () => {
    const d = modal.data;
    try {
      if (modal.type === 'add') {
        await api.createSchedule({ employee_id: d.employeeId, date: d.date, start: d.start, end: d.end, hours: d.hours, pause: d.pause, location: d.location, billable_rate: d.billableRate, status: d.status, notes: d.notes });
        toast?.('Quart ajouté');
      } else {
        await api.updateSchedule(d.id, { start: d.start, end: d.end, hours: d.hours, pause: d.pause, location: d.location, billable_rate: d.billableRate, status: d.status, notes: d.notes });
        toast?.('Quart modifié');
      }
      setModal(null);
      reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  const deleteShift = async () => {
    try {
      await api.deleteSchedule(modal.data.id);
      toast?.('Quart supprimé');
      setModal(null);
      reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  const publishAll = async () => {
    try {
      const res = await api.publishAll();
      toast?.(`${res.published} quart(s) publié(s)`);
      reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  const updateField = (key, val) => setModal(m => ({ ...m, data: { ...m.data, [key]: val } }));

  // Auto-calc hours when start/end/pause change
  const recalcHours = (start, end, pause) => {
    if (!start || !end) return;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let startM = sh * 60 + sm, endM = eh * 60 + em;
    if (endM <= startM) endM += 24 * 60;
    return Math.max(0, Math.round(((endM - startM) / 60 - (pause || 0)) * 100) / 100);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Chargement...</div>;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Horaires</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-outline btn-sm" onClick={publishAll}>Tout publier</button>
          <button className="btn btn-primary btn-sm" onClick={() => openAdd(employees[0]?.id, fmtISO(viewDates[0]))}><Plus size={14} /> Nouveau quart</button>
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['week', 'month'].map(m => (
            <button key={m} className={`tab-btn ${viewMode === m ? 'active' : ''}`} onClick={() => setViewMode(m)}>
              {m === 'week' ? 'Semaine' : 'Mois'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => nav(-1)}><ChevronLeft size={16} /></button>
          <span style={{ fontWeight: 600, fontSize: 14, minWidth: 200, textAlign: 'center' }}>{periodLabel}</span>
          <button className="btn btn-outline btn-sm" onClick={() => nav(1)}><ChevronRight size={16} /></button>
          <button className="btn btn-outline btn-sm" onClick={() => { setWeekOffset(0); setRefDate(new Date()); }}>Aujourd'hui</button>
        </div>
        <input className="input" style={{ maxWidth: 200, padding: '6px 10px' }} placeholder="Filtrer employé..."
          value={filterText} onChange={e => setFilterText(e.target.value)} />
      </div>

      {/* Schedule Grid */}
      <div className="schedule-grid">
        <table>
          <thead>
            <tr>
              <th>Employé</th>
              {viewDates.map((d, i) => (
                <th key={i} style={viewMode === 'month' ? { minWidth: 38, fontSize: 9, padding: '6px 2px' } : {}}>
                  {viewMode === 'month' ? <>{DAYS[d.getDay()]}<br />{d.getDate()}</> : fmtDay(d)}
                </th>
              ))}
              <th style={{ minWidth: 100, background: 'var(--brand-xl)' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {activeEmps.length === 0 && (
              <tr><td colSpan={viewDates.length + 2} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Aucun quart pour cette période</td></tr>
            )}
            {activeEmps.map(e => {
              const periodShifts = schedules.filter(s => s.employee_id === e.id && viewISOs.includes(s.date));
              const totalHrs = periodShifts.reduce((sum, s) => sum + s.hours, 0);
              const totalKm = periodShifts.reduce((sum, s) => sum + (s.km || 0), 0);
              const totalDep = periodShifts.reduce((sum, s) => sum + (s.deplacement || 0) + (s.autre_dep || 0), 0);
              const totalFrais = totalDep + totalKm * RATE_KM;

              return (
                <tr key={e.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={e.name} size={30} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{e.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{e.position?.slice(0, 24)}</div>
                      </div>
                    </div>
                  </td>
                  {viewDates.map((d, i) => {
                    const iso = fmtISO(d);
                    const shifts = schedules.filter(s => s.employee_id === e.id && s.date === iso);
                    return (
                      <td key={i} style={{ cursor: 'pointer', minHeight: 40 }} onClick={(ev) => { if (ev.target === ev.currentTarget) openAdd(e.id, iso); }}>
                        {shifts.map(s => {
                          const bg = s.status === 'draft' ? 'var(--surface2)' : s.status === 'published' ? 'var(--brand-l)' : 'var(--green-l)';
                          return (
                            <div key={s.id} className="shift-pill" style={{ background: bg }} onClick={() => openEdit(s)}
                              title={`${s.location}\n${s.start}—${s.end} (${s.hours}h)`}>
                              <div style={{ fontWeight: 600 }}>{s.start}–{s.end}</div>
                              <div style={{ color: 'var(--text3)', fontSize: 9 }}>{s.hours}h</div>
                              <div style={{ color: 'var(--text3)', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                                {s.location?.split(' ').slice(0, 3).join(' ')}
                              </div>
                            </div>
                          );
                        })}
                        {shifts.length === 0 && (
                          <div style={{ opacity: .2, textAlign: 'center', fontSize: 16, lineHeight: '30px', color: 'var(--brand)' }}>+</div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ minWidth: 100, textAlign: 'center', verticalAlign: 'middle', background: 'var(--brand-xl)', borderLeft: '2px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand)' }}>{totalHrs.toFixed(1)}h</div>
                    {totalFrais > 0 && <div style={{ fontSize: 10, color: 'var(--purple)', marginTop: 2 }}>{fmtMoney(totalFrais)} frais</div>}
                    {totalKm > 0 && <div style={{ fontSize: 9, color: 'var(--text3)' }}>{totalKm} km</div>}
                  </td>
                </tr>
              );
            })}
            {/* Add row for employees not on grid */}
            {otherEmps.length > 0 && viewMode === 'week' && (
              <tr>
                <td colSpan={viewDates.length + 2} style={{ padding: '8px 16px', background: 'var(--surface2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>Ajouter :</span>
                    {otherEmps.map(e => (
                      <button key={e.id} className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => openAdd(e.id, fmtISO(viewDates[0]))}>
                        {e.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {modal && (
        <Modal title={modal.type === 'add' ? 'Nouveau quart' : 'Modifier le quart'} onClose={() => setModal(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Employé</label>
              <select className="input" value={modal.data.employeeId || modal.data.employee_id}
                onChange={e => { updateField('employeeId', Number(e.target.value)); updateField('employee_id', Number(e.target.value)); const emp = employees.find(x => x.id === Number(e.target.value)); if (emp) updateField('billableRate', emp.rate); }}>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Date</label>
              <input className="input" type="date" value={modal.data.date} onChange={e => updateField('date', e.target.value)} />
            </div>
            <div className="field">
              <label>Début</label>
              <input className="input" type="time" value={modal.data.start} onChange={e => {
                updateField('start', e.target.value);
                const h = recalcHours(e.target.value, modal.data.end, modal.data.pause);
                if (h != null) updateField('hours', h);
              }} />
            </div>
            <div className="field">
              <label>Fin</label>
              <input className="input" type="time" value={modal.data.end} onChange={e => {
                updateField('end', e.target.value);
                const h = recalcHours(modal.data.start, e.target.value, modal.data.pause);
                if (h != null) updateField('hours', h);
              }} />
            </div>
            <div className="field">
              <label>Pause (h)</label>
              <input className="input" type="number" value={modal.data.pause} min={0} step={0.25} onChange={e => {
                const p = parseFloat(e.target.value) || 0;
                updateField('pause', p);
                const h = recalcHours(modal.data.start, modal.data.end, p);
                if (h != null) updateField('hours', h);
              }} />
            </div>
            <div className="field">
              <label>Heures nettes</label>
              <input className="input" type="number" value={modal.data.hours} step={0.25} style={{ background: 'var(--brand-xl)', fontWeight: 700 }}
                onChange={e => updateField('hours', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="field" style={{ gridColumn: '1/-1' }}>
              <label>Lieu</label>
              <input className="input" value={modal.data.location} onChange={e => updateField('location', e.target.value)} placeholder="Ex: Sept-Îles — CISSS Côte-Nord" />
            </div>
            <div className="field">
              <label>Taux ($/h)</label>
              <input className="input" type="number" value={modal.data.billableRate || modal.data.billable_rate} step={0.01}
                onChange={e => { updateField('billableRate', parseFloat(e.target.value) || 0); updateField('billable_rate', parseFloat(e.target.value) || 0); }} />
            </div>
            <div className="field">
              <label>Statut</label>
              <select className="input" value={modal.data.status} onChange={e => updateField('status', e.target.value)}>
                <option value="draft">Brouillon</option>
                <option value="published">Publié</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea className="input" rows={2} value={modal.data.notes} onChange={e => updateField('notes', e.target.value)} style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>Annuler</button>
            {modal.type === 'edit' && <button className="btn btn-danger" onClick={deleteShift}>Supprimer</button>}
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveShift}>
              {modal.type === 'add' ? 'Ajouter' : 'Sauvegarder'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
