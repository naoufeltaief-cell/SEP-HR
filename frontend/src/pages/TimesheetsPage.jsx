import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { fmtISO, fmtMoney, getWeekDates } from '../utils/helpers';
import { Avatar, Badge, Modal } from '../components/UI';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Eye,
  FileText,
  Paperclip,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

const GARDE_RATE = 86.23;

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
  const p = String(t).split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || 0, 10);
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
  return String(t).includes(':') ? String(t).padStart(5, '0') : t;
}

function groupTimesheets(timesheets, mode = 'month') {
  const grouped = {};
  (timesheets || []).forEach((timesheet) => {
    const periodStart = timesheet.period_start || '';
    const key = mode === 'month' ? periodStart.slice(0, 7) : periodStart;
    if (!key) return;
    if (!grouped[key]) {
      grouped[key] = { key, timesheetCount: 0, documentCount: 0, hours: 0 };
    }
    grouped[key].timesheetCount += 1;
    grouped[key].documentCount += Number(timesheet.attachment_count || 0);
    grouped[key].hours += (timesheet.shifts || []).reduce((sum, shift) => sum + Number(shift.hours_worked || 0), 0);
  });
  return Object.values(grouped)
    .sort((a, b) => String(b.key).localeCompare(String(a.key)))
    .map((item) => ({ ...item, hours: Math.round(item.hours * 100) / 100 }));
}

export default function TimesheetsPage({ toast }) {
  const [timesheets, setTimesheets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitStep, setSubmitStep] = useState(1);
  const [submitData, setSubmitData] = useState({
    employeeId: '',
    periodStart: '',
    periodEnd: '',
    notes: '',
  });
  const [periodShifts, setPeriodShifts] = useState([]);
  const [submitAttachmentFile, setSubmitAttachmentFile] = useState(null);
  const [expandedTS, setExpandedTS] = useState({});
  const [attachmentsByTimesheet, setAttachmentsByTimesheet] = useState({});
  const [loadingAttachmentIds, setLoadingAttachmentIds] = useState({});

  const reload = useCallback(async () => {
    try {
      const [ts, emps, scheds] = await Promise.all([
        api.getTimesheets(),
        api.getEmployees(),
        api.getSchedules(),
      ]);
      setTimesheets(ts || []);
      setEmployees(emps || []);
      setSchedules(scheds || []);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  const empName = (id) => employees.find((employee) => employee.id === id)?.name || `#${id}`;
  const empObj = (id) => employees.find((employee) => employee.id === id);

  const pendingCount = timesheets.filter((timesheet) => ['submitted', 'received'].includes(timesheet.status)).length;
  const approvedCount = timesheets.filter((timesheet) => timesheet.status === 'approved').length;
  const totalDocuments = timesheets.reduce((sum, timesheet) => sum + Number(timesheet.attachment_count || 0), 0);
  const monthSummary = useMemo(() => groupTimesheets(timesheets, 'month').slice(0, 4), [timesheets]);
  const weekSummary = useMemo(() => groupTimesheets(timesheets, 'week').slice(0, 4), [timesheets]);

  const loadTimesheetAttachments = useCallback(async (timesheetId) => {
    try {
      setLoadingAttachmentIds((prev) => ({ ...prev, [timesheetId]: true }));
      const attachments = await api.getTimesheetAttachments(timesheetId);
      setAttachmentsByTimesheet((prev) => ({ ...prev, [timesheetId]: attachments || [] }));
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setLoadingAttachmentIds((prev) => ({ ...prev, [timesheetId]: false }));
    }
  }, [toast]);

  const approve = async (id) => {
    try {
      await api.approveTimesheet(id);
      toast?.('FDT approuvée');
      reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const reject = async (id) => {
    try {
      await api.rejectTimesheet(id);
      toast?.('FDT refusée');
      reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const deleteTS = async (id) => {
    if (!confirm('Supprimer cette FDT ? Cette action est irréversible.')) return;
    try {
      await api.deleteTimesheet(id);
      toast?.('FDT supprimée');
      setAttachmentsByTimesheet((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

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
    setSubmitAttachmentFile(null);
    setShowSubmitModal(true);
  };

  const loadPeriodShifts = () => {
    const employeeId = Number(submitData.employeeId);
    if (!employeeId) {
      toast?.('Choisir un employé');
      return;
    }

    const submittedScheduleIds = new Set(
      timesheets.flatMap((timesheet) => (timesheet.shifts || []).map((shift) => shift.schedule_id))
    );

    const shifts = schedules
      .filter((schedule) =>
        schedule.employee_id === employeeId &&
        schedule.date >= submitData.periodStart &&
        schedule.date <= submitData.periodEnd &&
        schedule.status === 'published' &&
        !submittedScheduleIds.has(schedule.id)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

    if (!shifts.length) {
      toast?.('Aucun quart publié non soumis pour cette période');
      return;
    }

    setPeriodShifts(
      shifts.map((schedule) => ({
        scheduleId: schedule.id,
        date: schedule.date,
        location: schedule.location || '',
        scheduledStart: schedule.start,
        scheduledEnd: schedule.end,
        scheduledHours: schedule.hours,
        startActual: padTime(schedule.start),
        endActual: padTime(schedule.end),
        pauseMin: defaultPauseMin(schedule),
        hoursWorked: schedule.hours,
        gardeHours: 0,
        rappelHours: 0,
      }))
    );
    setSubmitStep(2);
  };

  const updateShiftField = (index, field, value) => {
    setPeriodShifts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (['startActual', 'endActual', 'pauseMin'].includes(field)) {
        const shift = next[index];
        const start = field === 'startActual' ? value : shift.startActual;
        const end = field === 'endActual' ? value : shift.endActual;
        const pause = field === 'pauseMin' ? Number(value) : shift.pauseMin;
        next[index].hoursWorked = recalcHours(start, end, pause);
      }
      return next;
    });
  };

  const submitTimesheet = async () => {
    const employeeId = Number(submitData.employeeId);
    const employee = empObj(employeeId);
    if (!employeeId || !periodShifts.length) {
      toast?.('Données incomplètes');
      return;
    }

    try {
      const payload = {
        employee_id: employeeId,
        period_start: submitData.periodStart,
        period_end: submitData.periodEnd,
        notes: submitData.notes,
        shifts: periodShifts.map((shift) => ({
          schedule_id: shift.scheduleId,
          date: shift.date,
          hours_worked: shift.hoursWorked,
          pause: shift.pauseMin / 60,
          garde_hours: Number(shift.gardeHours) || 0,
          rappel_hours: Number(shift.rappelHours) || 0,
          start_actual: shift.startActual,
          end_actual: shift.endActual,
        })),
      };

      const response = await api.submitTimesheet(payload);
      const timesheetId = response?.id;
      if (submitAttachmentFile && timesheetId) {
        await api.uploadTimesheetAttachment(timesheetId, submitAttachmentFile, 'fdt', submitAttachmentFile.name);
      }
      toast?.(`FDT soumise — ${periodShifts.length} quarts pour ${employee?.name || '?'}`);
      setShowSubmitModal(false);
      setSubmitAttachmentFile(null);
      reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const uploadAttachment = async (timesheetId, file) => {
    if (!file) return;
    try {
      await api.uploadTimesheetAttachment(timesheetId, file, 'fdt', file.name);
      toast?.('Pièce jointe FDT ajoutée');
      await loadTimesheetAttachments(timesheetId);
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const deleteAttachment = async (timesheetId, attachmentId) => {
    try {
      await api.deleteTimesheetAttachment(timesheetId, attachmentId);
      toast?.('Pièce jointe supprimée');
      await loadTimesheetAttachments(timesheetId);
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const toggleExpand = async (timesheetId) => {
    const nextExpanded = !expandedTS[timesheetId];
    setExpandedTS((prev) => ({ ...prev, [timesheetId]: nextExpanded }));
    if (nextExpanded && !attachmentsByTimesheet[timesheetId]) {
      await loadTimesheetAttachments(timesheetId);
    }
  };

  const submitTotals = useMemo(() => {
    const hours = periodShifts.reduce((sum, shift) => sum + shift.hoursWorked, 0);
    const garde = periodShifts.reduce((sum, shift) => sum + (Number(shift.gardeHours) || 0), 0);
    const rappel = periodShifts.reduce((sum, shift) => sum + (Number(shift.rappelHours) || 0), 0);
    return {
      hours,
      garde,
      rappel,
      gardeFacturable: Math.round(garde / 8 * 100) / 100,
    };
  }, [periodShifts]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
        Chargement...
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    );
  }

  return (
    <>
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

      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        {timesheets.length} FDT
        {pendingCount > 0 && <> — <strong style={{ color: 'var(--amber)' }}>{pendingCount} en attente</strong></>}
        {approvedCount > 0 && <> — <span style={{ color: 'var(--green)' }}>{approvedCount} approuvée(s)</span></>}
        {totalDocuments > 0 && <> — <span style={{ color: 'var(--brand)' }}>{totalDocuments} document(s)</span></>}
      </div>

      {(monthSummary.length > 0 || weekSummary.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Résumé FDT par mois</div>
            {monthSummary.map((item) => (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{item.key}</span>
                <strong>{item.timesheetCount} FDT • {item.documentCount} doc • {item.hours.toFixed(1)}h</strong>
              </div>
            ))}
          </div>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Résumé FDT par semaine</div>
            {weekSummary.map((item) => (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{item.key}</span>
                <strong>{item.timesheetCount} FDT • {item.documentCount} doc • {item.hours.toFixed(1)}h</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {timesheets.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          <p>Aucune feuille de temps soumise</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>
            Cliquez "Soumettre FDT" pour soumettre une période complète (Dim-Sam) par employé.
          </p>
        </div>
      )}

      {timesheets.map((timesheet) => {
        const totalHours = (timesheet.shifts || []).reduce((sum, shift) => sum + Number(shift.hours_worked || 0), 0);
        const totalGarde = (timesheet.shifts || []).reduce((sum, shift) => sum + Number(shift.garde_hours || 0), 0);
        const totalRappel = (timesheet.shifts || []).reduce((sum, shift) => sum + Number(shift.rappel_hours || 0), 0);
        const gardeFacturable = Math.round(totalGarde / 8 * 100) / 100;
        const isExpanded = !!expandedTS[timesheet.id];
        const attachments = attachmentsByTimesheet[timesheet.id] || [];
        const attachmentCount = Number(timesheet.attachment_count || attachments.length || 0);

        return (
          <div key={timesheet.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={empName(timesheet.employee_id)} size={40} bg="var(--amber-l)" color="var(--amber)" />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{empName(timesheet.employee_id)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    Période: {timesheet.period_start} au {timesheet.period_end} — {(timesheet.shifts || []).length} quart(s)
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {attachmentCount > 0 && (
                  <span className="badge" style={{ background: 'var(--brand-xl)', color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Paperclip size={11} /> {attachmentCount}
                  </span>
                )}
                <Badge status={timesheet.status} />
                {timesheet.status === 'submitted' && (
                  <>
                    <button className="btn btn-success btn-sm" onClick={() => approve(timesheet.id)}><Check size={14} /> Approuver</button>
                    <button className="btn btn-danger btn-sm" onClick={() => reject(timesheet.id)}><X size={14} /> Refuser</button>
                  </>
                )}
                {['approved', 'submitted', 'rejected', 'received'].includes(timesheet.status) && (
                  <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteTS(timesheet.id)}>Supprimer</button>
                )}
              </div>
            </div>

            <div className="stats-row" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '10px 14px', minWidth: 120 }}>
                <div className="label" style={{ color: 'var(--brand)', fontSize: 10 }}>Heures travaillées</div>
                <div className="value" style={{ color: 'var(--brand)', fontSize: 18 }}>{totalHours.toFixed(1)}h</div>
              </div>
              {totalGarde > 0 && (
                <div className="stat-card" style={{ background: 'var(--amber-l)', padding: '10px 14px', minWidth: 120 }}>
                  <div className="label" style={{ color: 'var(--amber)', fontSize: 10 }}>Garde ({totalGarde}h = {gardeFacturable}h fact.)</div>
                  <div className="value" style={{ color: 'var(--amber)', fontSize: 18 }}>{totalGarde}h</div>
                </div>
              )}
              {totalRappel > 0 && (
                <div className="stat-card" style={{ background: 'var(--red-l)', padding: '10px 14px', minWidth: 120 }}>
                  <div className="label" style={{ color: 'var(--red)', fontSize: 10 }}>Rappel</div>
                  <div className="value" style={{ color: 'var(--red)', fontSize: 18 }}>{totalRappel}h</div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => toggleExpand(timesheet.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--brand)',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: 'inherit',
                }}
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Détail des {(timesheet.shifts || []).length} quarts
              </button>

              {isExpanded && (
                <div style={{ marginTop: 8 }}>
                  {(timesheet.shifts || []).length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', paddingBottom: 8 }}>
                      Aucun quart détaillé n’a encore été saisi pour cette FDT.
                    </div>
                  )}
                  {(timesheet.shifts || []).map((shift, index) => {
                    const schedule = schedules.find((item) => item.id === shift.schedule_id);
                    return (
                      <div
                        key={shift.id || index}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 0',
                          borderBottom: '1px solid var(--border)',
                          fontSize: 11,
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 500 }}>{shift.date}</span>
                          {' — '}{(schedule?.location || '').slice(0, 30)}
                          {' — '}{schedule?.start || shift.start_actual || '?'}–{schedule?.end || shift.end_actual || '?'}
                        </div>
                        <div style={{ display: 'flex', gap: 8, color: 'var(--text2)' }}>
                          <span>{shift.hours_worked}h trav.</span>
                          {shift.pause > 0 && <span>−{shift.pause}h pause</span>}
                          {shift.garde_hours > 0 && <span style={{ color: 'var(--amber)' }}>{shift.garde_hours}h garde</span>}
                          {shift.rappel_hours > 0 && <span style={{ color: 'var(--red)' }}>{shift.rappel_hours}h rappel</span>}
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 12, background: 'var(--surface2)', borderRadius: 'var(--r)', padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>Documents FDT ({attachmentCount})</div>
                      <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                        Ajouter document
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.gif"
                          style={{ display: 'none' }}
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            await uploadAttachment(timesheet.id, file);
                            event.target.value = '';
                          }}
                        />
                      </label>
                    </div>

                    {loadingAttachmentIds[timesheet.id] && (
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Chargement des documents…</div>
                    )}

                    {!loadingAttachmentIds[timesheet.id] && attachments.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Aucun document FDT rattaché à cette période.</div>
                    )}

                    {attachments.map((attachment) => (
                      <div key={attachment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <FileText size={14} style={{ color: 'var(--brand)' }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{attachment.filename}</div>
                            <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                              {attachment.source === 'email' ? 'Courriel' : 'Manuel'} • {attachment.created_at?.slice(0, 10) || '—'}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ padding: '2px 8px' }}
                            onClick={async () => {
                              try {
                                await api.openTimesheetAttachment(timesheet.id, attachment.id, attachment.original_filename || attachment.filename || 'fdt');
                              } catch (err) {
                                toast?.('Erreur: ' + err.message);
                              }
                            }}
                          >
                            <Eye size={12} />
                          </button>
                          <button className="btn btn-outline btn-sm" style={{ padding: '2px 8px' }} onClick={() => deleteAttachment(timesheet.id, attachment.id)}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

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
            <>
              <div className="field">
                <label>Employé</label>
                <select className="input" value={submitData.employeeId} onChange={(event) => setSubmitData((prev) => ({ ...prev, employeeId: event.target.value }))}>
                  <option value="">Choisir...</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} — {employee.position}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Début période (Dimanche)</label>
                  <input type="date" className="input" value={submitData.periodStart} onChange={(event) => setSubmitData((prev) => ({ ...prev, periodStart: event.target.value }))} />
                </div>
                <div className="field">
                  <label>Fin période (Samedi)</label>
                  <input type="date" className="input" value={submitData.periodEnd} onChange={(event) => setSubmitData((prev) => ({ ...prev, periodEnd: event.target.value }))} />
                </div>
              </div>

              <label style={{ display: 'block', background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 20, border: '2px dashed var(--brand-m)', textAlign: 'center', cursor: 'pointer', marginBottom: 16 }}>
                <Upload size={20} style={{ color: 'var(--brand-m)' }} />
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                  Joindre le PDF ou l’image de la FDT (optionnel)
                </div>
                <div style={{ fontSize: 11, color: 'var(--brand)', marginTop: 6 }}>
                  {submitAttachmentFile ? submitAttachmentFile.name : 'Clique pour sélectionner un document'}
                </div>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.gif"
                  style={{ display: 'none' }}
                  onChange={(event) => setSubmitAttachmentFile(event.target.files?.[0] || null)}
                />
              </label>

              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={loadPeriodShifts}>
                Charger les quarts de la période
              </button>
            </>
          ) : (
            <>
              <div style={{ background: 'var(--brand-xl)', padding: 12, borderRadius: 'var(--r)', marginBottom: 16, fontSize: 12, color: 'var(--brand)', lineHeight: 1.5 }}>
                <strong>{periodShifts.length} quart(s)</strong> trouvés pour <strong>{empObj(Number(submitData.employeeId))?.name}</strong> du {submitData.periodStart} au {submitData.periodEnd}.
                <br />
                Modifie le <strong>début</strong>, la <strong>fin</strong> et la <strong>pause</strong> de chaque quart pour matcher la FDT de l’employé. Les heures facturables se recalculent automatiquement.
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text2)' }}>
                  <strong>Pause:</strong> saisir en minutes. <strong>Garde:</strong> chaque 8h = 1h facturable ({fmtMoney(GARDE_RATE)}/h).
                </div>
              </div>

              <div className="stats-row" style={{ marginBottom: 12 }}>
                <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '8px 14px', flex: 1 }}>
                  <div className="label" style={{ color: 'var(--brand)', fontSize: 10 }}>Heures totales</div>
                  <div className="value" style={{ color: 'var(--brand)', fontSize: 18 }}>{submitTotals.hours.toFixed(1)}h</div>
                </div>
                {submitTotals.garde > 0 && (
                  <div className="stat-card" style={{ background: 'var(--amber-l)', padding: '8px 14px', flex: 1 }}>
                    <div className="label" style={{ color: 'var(--amber)', fontSize: 10 }}>Garde ({submitTotals.garde}h = {submitTotals.gardeFacturable}h fact.)</div>
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

              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {periodShifts.map((shift, index) => (
                  <div key={shift.scheduleId} style={{ padding: 12, background: index % 2 ? 'var(--surface)' : 'var(--surface2)', borderRadius: 'var(--r)', marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{shift.date}</span>{' '}
                        <span style={{ color: 'var(--text3)', fontSize: 11 }}>
                          Horaire prévu: {shift.scheduledStart}—{shift.scheduledEnd} ({shift.scheduledHours}h)
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{shift.location.slice(0, 35)}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 6 }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Début réel</label>
                        <input type="time" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={shift.startActual} onChange={(event) => updateShiftField(index, 'startActual', event.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Fin réelle</label>
                        <input type="time" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={shift.endActual} onChange={(event) => updateShiftField(index, 'endActual', event.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Pause (minutes)</label>
                        <input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={shift.pauseMin} min={0} max={480} step={1} onChange={(event) => updateShiftField(index, 'pauseMin', parseInt(event.target.value || '0', 10) || 0)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Heures facturables</label>
                        <input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12, background: 'var(--brand-xl)', fontWeight: 600 }} value={shift.hoursWorked} readOnly />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10, color: 'var(--amber)' }}>Pause déduite (h)</label>
                        <div style={{ padding: '6px 8px', fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
                          {(shift.pauseMin / 60).toFixed(2)}h
                        </div>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Heures de garde</label>
                        <input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={shift.gardeHours} min={0} max={24} step={1} onChange={(event) => updateShiftField(index, 'gardeHours', event.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 10 }}>Heures de rappel</label>
                        <input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={shift.rappelHours} min={0} max={24} step={0.25} onChange={(event) => updateShiftField(index, 'rappelHours', event.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>Notes générales</label>
                <textarea className="input" rows={2} style={{ resize: 'vertical' }} value={submitData.notes} onChange={(event) => setSubmitData((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Notes sur la période..." />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setSubmitStep(1)}>
                  ← Retour
                </button>
                <button className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={submitTimesheet}>
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
