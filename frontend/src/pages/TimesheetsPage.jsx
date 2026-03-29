import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { fmtDay, fmtISO, fmtMoney, getWeekDates, DAYS, RATE_KM } from '../utils/helpers';
import { Avatar, Badge, Modal } from '../components/UI';
import { Check, X, Upload, Clock, FileText, ChevronDown, ChevronUp, DollarSign, AlertTriangle, Trash2 } from 'lucide-react';

const GARDE_RATE = 86.23; // $/h facturable pour la garde

// ── Helper: compute pause minutes from schedule data ──
function defaultPauseMin(schedule) {
  const startM = timeToMin(schedule.start);
  let endM = timeToMin(schedule.end);
  if (endM <= startM) endM += 24 * 60;
  const durationH = (endM - startM) / 60;
  const pauseH = Math.round((durationH - schedule.hours) * 100) / 100;
  return Math.max(0, Math.round(pauseH * 60));
}

function timeToMin(t) {
  if (!t) return 0;
  const p = t.split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1] || 0);
}

function recalcHours(startStr, endStr, pauseMin) {
  let startM = timeToMin(startStr);
  let endM = timeToMin(endStr);
  if (endM <= startM) endM += 24 * 60;
  const totalMin = endM - startM - pauseMin;
  return Math.max(0, Math.round(totalMin / 60 * 100) / 100);
}

function padTime(t) {
  if (!t) return '00:00';
  return t.includes(':') ? t.padStart(5, '0') : t;
}

// ══════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════
export default function TimesheetsPage({ toast }) {
  const [timesheets, setTimesheets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitStep, setSubmitStep] = useState(1); // 1=choose emp+period, 2=edit shifts
  const [submitData, setSubmitData] = useState({
    employeeId: '',
    periodStart: '',
    periodEnd: '',
    notes: '',
  });
  const [periodShifts, setPeriodShifts] = useState([]); // editable shift data
  const [expandedTS, setExpandedTS] = useState({}); // track which FDT details are expanded

  const reload = useCallback(async () => {
    try {
      const [ts, emps, scheds] = await Promise.all([
        api.getTimesheets(),
        api.getEmployees(),
        api.getSchedules(),
      ]);
      setTimesheets(ts);
      setEmployees(emps);
      setSchedules(scheds);
    } catch (err) { toast?.('Erreur: ' + err.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`;
  const empObj = (id) => employees.find(e => e.id === id);

  // ── Stats ──
  const pendingCount = timesheets.filter(t => t.status === 'submitted').length;
  const approvedCount = timesheets.filter(t => t.status === 'approved').length;

  // ── Actions ──
  const approve = async (id) => {
    try { await api.approveTimesheet(id); toast?.('FDT approuvée'); reload(); }
    catch (err) { toast?.('Erreur: ' + err.message); }
  };
  const deleteTS = async (id) => {
    if (!confirm('Supprimer cette FDT ? Cette action est irréversible.')) return;
    try { await api.deleteTimesheet(id); toast?.('FDT supprimée'); reload(); }
    catch (err) { toast?.('Erreur: ' + err.message); }
  };

  const reject = async (id) => {
    try { await api.rejectTimesheet(id); toast?.('FDT refusée'); reload(); }
    catch (err) { toast?.('Erreur: ' + err.message); }
  };

  // ── Submit Flow ──
  const openSubmitModal = () => {
    const week = getWeekDates(new Date(), 0);
    setSubmitData({
      employeeId: '',
      periodStart: fmtISO(week[0]),
      periodEnd: fmtISO(week[6]),
      notes: '',
    });
    setSubmitStep(1);
    setPeriodShifts([]);
    setShowSubmitModal(true);
  };

  const loadPeriodShifts = () => {
    const eid = Number(submitData.employeeId);
    if (!eid) { toast?.('Choisir un employé'); return; }

    // Find published shifts for this employee in the period that aren't already in a timesheet
    const submittedScheduleIds = new Set(
      timesheets.flatMap(t => (t.shifts || []).map(s => s.schedule_id))
    );

    const shifts = schedules.filter(s =>
      s.employee_id === eid &&
      s.date >= submitData.periodStart &&
      s.date <= submitData.periodEnd &&
      s.status === 'published' &&
      !submittedScheduleIds.has(s.id)
    ).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

    if (!shifts.length) {
      toast?.('Aucun quart publié non soumis pour cette période');
      return;
    }

    // Initialize editable shift data
    const editableShifts = shifts.map(s => {
      const pauseMin = defaultPauseMin(s);
      return {
        scheduleId: s.id,
        date: s.date,
        location: s.location || '',
        scheduledStart: s.start,
        scheduledEnd: s.end,
        scheduledHours: s.hours,
        // Editable fields
        startActual: padTime(s.start),
        endActual: padTime(s.end),
        pauseMin: pauseMin,
        hoursWorked: s.hours,
        gardeHours: 0,
        rappelHours: 0,
      };
    });

    setPeriodShifts(editableShifts);
    setSubmitStep(2);
  };

  const updateShiftField = (index, field, value) => {
    setPeriodShifts(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };

      // Auto-recalc hours when start/end/pause change
      if (['startActual', 'endActual', 'pauseMin'].includes(field)) {
        const s = updated[index];
        const start = field === 'startActual' ? value : s.startActual;
        const end = field === 'endActual' ? value : s.endActual;
        const pause = field === 'pauseMin' ? Number(value) : s.pauseMin;
        updated[index].hoursWorked = recalcHours(start, end, pause);
      }

      return updated;
    });
  };

  const submitTimesheet = async () => {
    const eid = Number(submitData.employeeId);
    const emp = empObj(eid);
    if (!eid || !periodShifts.length) { toast?.('Données incomplètes'); return; }

    try {
      const payload = {
        employee_id: eid,
        period_start: submitData.periodStart,
        period_end: submitData.periodEnd,
        notes: submitData.notes,
        shifts: periodShifts.map(s => ({
          schedule_id: s.scheduleId,
          date: s.date,
          hours_worked: s.hoursWorked,
          pause: s.pauseMin / 60,
          garde_hours: Number(s.gardeHours) || 0,
          rappel_hours: Number(s.rappelHours) || 0,
          start_actual: s.startActual,
          end_actual: s.endActual,
        })),
      };

      await api.submitTimesheet(payload);
      toast?.(`FDT soumise — ${periodShifts.length} quarts pour ${emp?.name || '?'}`);
      setShowSubmitModal(false);
      reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  // ── Computed totals for submit preview ──
  const submitTotals = useMemo(() => {
    const hours = periodShifts.reduce((s, sh) => s + sh.hoursWorked, 0);
    const garde = periodShifts.reduce((s, sh) => s + (Number(sh.gardeHours) || 0), 0);
    const rappel = periodShifts.reduce((s, sh) => s + (Number(sh.rappelHours) || 0), 0);
    const gardeFacturable = Math.round(garde / 8 * 100) / 100;
    return { hours, garde, rappel, gardeFacturable };
  }, [periodShifts]);

  const toggleExpand = (id) => setExpandedTS(prev => ({ ...prev, [id]: !prev[id] }));

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
      Chargement...
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════
  return (
    <>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          <Clock size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Feuilles de temps
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {approvedCount > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => toast?.('Fonctionnalité brouillon facture — voir onglet Facturation')}>
              <DollarSign size={13} /> Brouillon facture ({approvedCount})
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={openSubmitModal}>
            <Upload size={14} /> Soumettre FDT (période)
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        {timesheets.length} FDT
        {pendingCount > 0 && <> — <strong style={{ color: 'var(--amber)' }}>{pendingCount} en attente</strong></>}
        {approvedCount > 0 && <> — <span style={{ color: 'var(--green)' }}>{approvedCount} approuvée(s)</span></>}
      </div>

      {/* FDT List */}
      {timesheets.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          <p>Aucune feuille de temps soumise</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>
            Cliquez "Soumettre FDT" pour soumettre une période complète (Dim—Sam) par employé.
          </p>
        </div>
      )}

      {timesheets.map(ts => {
        const totalHrs = (ts.shifts || []).reduce((s, sh) => s + sh.hours_worked, 0);
        const totalGarde = (ts.shifts || []).reduce((s, sh) => s + (sh.garde_hours || 0), 0);
        const totalRappel = (ts.shifts || []).reduce((s, sh) => s + (sh.rappel_hours || 0), 0);
        const gardeFacturable = Math.round(totalGarde / 8 * 100) / 100;
        const isExpanded = expandedTS[ts.id];

        return (
          <div key={ts.id} className="card" style={{ marginBottom: 10 }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={empName(ts.employee_id)} size={40} bg="var(--amber-l)" color="var(--amber)" />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{empName(ts.employee_id)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    Période: {ts.period_start} au {ts.period_end} — {(ts.shifts || []).length} quart(s)
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Badge status={ts.status} />
                {ts.status === 'submitted' && (
                  <>
                    <button className="btn btn-success btn-sm" onClick={() => approve(ts.id)}><Check size={14} /> Approuver</button>
                    <button className="btn btn-danger btn-sm" onClick={() => reject(ts.id)}><X size={14} /> Refuser</button>
                  </>
                )}
                {(ts.status === 'approved' || ts.status === 'submitted' || ts.status === 'rejected') && (
                  <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteTS(ts.id)}>Supprimer</button>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="stats-row" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '10px 14px', minWidth: 100 }}>
                <div className="label" style={{ color: 'var(--brand)', fontSize: 10 }}>Heures travaillées</div>
                <div className="value" style={{ color: 'var(--brand)', fontSize: 18 }}>{totalHrs.toFixed(1)}h</div>
              </div>
              {totalGarde > 0 && (
                <div className="stat-card" style={{ background: 'var(--amber-l)', padding: '10px 14px', minWidth: 100 }}>
                  <div className="label" style={{ color: 'var(--amber)', fontSize: 10 }}>
                    Garde ({totalGarde}h = {gardeFacturable}h fact.)
                  </div>
                  <div className="value" style={{ color: 'var(--amber)', fontSize: 18 }}>{totalGarde}h</div>
                </div>
              )}
              {totalRappel > 0 && (
                <div className="stat-card" style={{ background: 'var(--red-l)', padding: '10px 14px', minWidth: 100 }}>
                  <div className="label" style={{ color: 'var(--red)', fontSize: 10 }}>Rappel</div>
                  <div className="value" style={{ color: 'var(--red)', fontSize: 18 }}>{totalRappel}h</div>
                </div>
              )}
            </div>

            {/* Expandable shift details */}
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => toggleExpand(ts.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: 'var(--brand)', fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
                }}
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Détail des {(ts.shifts || []).length} quarts
              </button>
              {isExpanded && (
                <div style={{ marginTop: 8 }}>
                  {(ts.shifts || []).map((sh, i) => {
                    const sched = schedules.find(s => s.id === sh.schedule_id);
                    return (
                      <div key={sh.id || i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 11,
                      }}>
                        <div>
                          <span style={{ fontWeight: 500 }}>{sh.date}</span>
                          {' — '}{(sched?.location || '').slice(0, 30)}
                          {' — '}{sched?.start || '?'}–{sched?.end || '?'}
                        </div>
                        <div style={{ display: 'flex', gap: 8, color: 'var(--text2)' }}>
                          <span>{sh.hours_worked}h trav.</span>
                          {sh.pause > 0 && <span>−{sh.pause}h pause</span>}
                          {sh.garde_hours > 0 && <span style={{ color: 'var(--amber)' }}>{sh.garde_hours}h garde</span>}
                          {sh.rappel_hours > 0 && <span style={{ color: 'var(--red)' }}>{sh.rappel_hours}h rappel</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* ══════════════════════════════════════════ */}
      {/* SUBMIT TIMESHEET MODAL                    */}
      {/* ══════════════════════════════════════════ */}
      {showSubmitModal && (
        <Modal
          title={submitStep === 1
            ? 'Soumettre FDT — Choisir employé et période'
            : `FDT — ${empObj(Number(submitData.employeeId))?.name || '?'} — ${submitData.periodStart} au ${submitData.periodEnd}`
          }
          onClose={() => setShowSubmitModal(false)}
          wide
        >
          {submitStep === 1 ? (
            /* ── Step 1: Choose employee and period ── */
            <>
              <div className="field">
                <label>Employé</label>
                <select className="input" value={submitData.employeeId}
                  onChange={e => setSubmitData(d => ({ ...d, employeeId: e.target.value }))}>
                  <option value="">Choisir...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.position}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Début période (Dimanche)</label>
                  <input type="date" className="input" value={submitData.periodStart}
                    onChange={e => setSubmitData(d => ({ ...d, periodStart: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Fin période (Samedi)</label>
                  <input type="date" className="input" value={submitData.periodEnd}
                    onChange={e => setSubmitData(d => ({ ...d, periodEnd: e.target.value }))} />
                </div>
              </div>

              {/* Upload zone */}
              <div style={{
                background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 20,
                border: '2px dashed var(--brand-m)', textAlign: 'center', cursor: 'pointer',
                marginBottom: 16, transition: 'background .15s',
              }}>
                <Upload size={20} style={{ color: 'var(--brand-m)' }} />
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                  Joindre le PDF de la FDT scannée (optionnel)
                </div>
              </div>

              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                onClick={loadPeriodShifts}>
                Charger les quarts de la période
              </button>
            </>
          ) : (
            /* ── Step 2: Edit shifts ── */
            <>
              {/* Info banner */}
              <div style={{
                background: 'var(--brand-xl)', padding: 12, borderRadius: 'var(--r)',
                marginBottom: 16, fontSize: 12, color: 'var(--brand)', lineHeight: 1.5,
              }}>
                <strong>{periodShifts.length} quart(s)</strong> trouvés pour{' '}
                <strong>{empObj(Number(submitData.employeeId))?.name}</strong> du {submitData.periodStart} au {submitData.periodEnd}.
                <br />
                Modifiez le <strong>début</strong>, la <strong>fin</strong> et la <strong>pause</strong> de chaque quart
                pour matcher la FDT de l'employé. Les heures facturables se recalculent automatiquement.
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text2)' }}>
                  <strong>Pause:</strong> saisir en minutes (ex: 45 min = 0.75h déduit).{' '}
                  <strong>Garde:</strong> chaque 8h = 1h facturable ({fmtMoney(GARDE_RATE)}/h).
                </div>
              </div>

              {/* Totals preview */}
              <div className="stats-row" style={{ marginBottom: 12 }}>
                <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '8px 14px', flex: 1 }}>
                  <div className="label" style={{ color: 'var(--brand)', fontSize: 10 }}>Heures totales</div>
                  <div className="value" style={{ color: 'var(--brand)', fontSize: 18 }}>{submitTotals.hours.toFixed(1)}h</div>
                </div>
                {submitTotals.garde > 0 && (
                  <div className="stat-card" style={{ background: 'var(--amber-l)', padding: '8px 14px', flex: 1 }}>
                    <div className="label" style={{ color: 'var(--amber)', fontSize: 10 }}>
                      Garde ({submitTotals.garde}h = {submitTotals.gardeFacturable}h fact.)
                    </div>
                    <div className="value" style={{ color: 'var(--amber)', fontSize: 18 }}>{submitTotals.garde}h</div>
                  </div>
                )}
                {submitTotals.rappel > 0 && (
                  <div className="stat-card" style={{ background: 'var(--red-l)', padding: '8px 14px', flex: 1 }}>
                    <div className="label" style={{ color: 'var(--red)', fontSize: 10 }}>Rappel</div>
                    <div className="value" style={{ color: 'var(--red)', fontSize: 18 }}>{submitTotals.rappel}h</div>
                  </div>
                )}
              </div>

              {/* Editable shifts list */}
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {periodShifts.map((s, i) => (
                  <div key={s.scheduleId} style={{
                    padding: 12, background: i % 2 ? 'var(--surface)' : 'var(--surface2)',
                    borderRadius: 'var(--r)', marginBottom: 6,
                  }}>
                    {/* Shift header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{s.date}</span>{' '}
                        <span style={{ color: 'var(--text3)', fontSize: 11 }}>
                          Horaire prévu: {s.scheduledStart}—{s.scheduledEnd} ({s.scheduledHours}h)
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{s.location.slice(0, 35)}</span>
                    </div>

                    {/* Row 1: Start, End, Pause, Hours */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 6 }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Début réel</label>
                        <input type="time" className="input" style={{ padding: '6px 8px', fontSize: 12 }}
                          value={s.startActual}
                          onChange={e => updateShiftField(i, 'startActual', e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Fin réelle</label>
                        <input type="time" className="input" style={{ padding: '6px 8px', fontSize: 12 }}
                          value={s.endActual}
                          onChange={e => updateShiftField(i, 'endActual', e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Pause (minutes)</label>
                        <input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }}
                          value={s.pauseMin} min={0} max={480} step={1}
                          onChange={e => updateShiftField(i, 'pauseMin', parseInt(e.target.value) || 0)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Heures facturables</label>
                        <input type="number" className="input"
                          style={{ padding: '6px 8px', fontSize: 12, background: 'var(--brand-xl)', fontWeight: 600 }}
                          value={s.hoursWorked} readOnly />
                      </div>
                    </div>

                    {/* Row 2: Pause display, Garde, Rappel */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10, color: 'var(--amber)' }}>Pause déduite (h)</label>
                        <div style={{ padding: '6px 8px', fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
                          {(s.pauseMin / 60).toFixed(2)}h
                        </div>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Heures de garde</label>
                        <input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }}
                          value={s.gardeHours} min={0} max={24} step={1}
                          onChange={e => updateShiftField(i, 'gardeHours', e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Heures de rappel</label>
                        <input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }}
                          value={s.rappelHours} min={0} max={24} step={0.25}
                          onChange={e => updateShiftField(i, 'rappelHours', e.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Notes */}
              <div className="field" style={{ marginTop: 12 }}>
                <label>Notes générales</label>
                <textarea className="input" rows={2} style={{ resize: 'vertical' }}
                  value={submitData.notes}
                  onChange={e => setSubmitData(d => ({ ...d, notes: e.target.value }))}
                  placeholder="Notes sur la période..." />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setSubmitStep(1)}>
                  ← Retour
                </button>
                <button className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }}
                  onClick={submitTimesheet}>
                  Soumettre la FDT complète ({periodShifts.length} quarts)
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
