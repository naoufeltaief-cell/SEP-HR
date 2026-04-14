import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Paperclip,
  Send,
  Upload,
} from 'lucide-react';
import api from '../utils/api';
import { Badge } from '../components/UI';
import { fmtDay, fmtISO, getWeekDates } from '../utils/helpers';

function useMobileBreakpoint(maxWidth = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= maxWidth);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= maxWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxWidth]);

  return isMobile;
}

function timeToMin(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function normalizeTime(value) {
  if (!value) return '00:00';
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '00:00';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function defaultPauseMin(schedule) {
  const scheduledHours = Number(schedule?.hours || 0);
  const durationMinutes = Math.max(0, timeToMin(schedule?.end) - timeToMin(schedule?.start));
  const normalizedDuration = durationMinutes > 0 ? durationMinutes : durationMinutes + 24 * 60;
  const pauseHours = Math.max(0, normalizedDuration / 60 - scheduledHours);
  return Math.round(pauseHours * 60);
}

function recalcHours(startStr, endStr, pauseMin) {
  let start = timeToMin(startStr);
  let end = timeToMin(endStr);
  if (end <= start) end += 24 * 60;
  const totalMinutes = Math.max(0, end - start - Number(pauseMin || 0));
  return Math.round((totalMinutes / 60) * 100) / 100;
}

function buildDraftRow(schedule, existingShift = null) {
  const startActual = normalizeTime(existingShift?.start_actual || schedule?.start);
  const endActual = normalizeTime(existingShift?.end_actual || schedule?.end);
  const pauseMin = Math.round(Number(existingShift?.pause || 0) * 60) || defaultPauseMin(schedule);
  return {
    scheduleId: existingShift?.schedule_id || schedule?.id || '',
    date: existingShift?.date || schedule?.date || '',
    location: schedule?.location || '',
    scheduledStart: schedule?.start || '',
    scheduledEnd: schedule?.end || '',
    scheduledHours: Number(schedule?.hours || existingShift?.hours_worked || 0),
    startActual,
    endActual,
    pauseMin,
    hoursWorked: Number(existingShift?.hours_worked || recalcHours(startActual, endActual, pauseMin)),
    gardeHours: Number(existingShift?.garde_hours || 0),
    rappelHours: Number(existingShift?.rappel_hours || 0),
    km: Number(existingShift?.km || 0),
    deplacement: Number(existingShift?.deplacement || 0),
    autreDep: Number(existingShift?.autre_dep || 0),
  };
}

function FieldInput({ label, children, fullWidth = false }) {
  return (
    <div style={{ display: 'grid', gap: 4, gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
      <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

export default function EmployeeSchedulePage({ user, toast }) {
  const isMobile = useMobileBreakpoint();
  const [employee, setEmployee] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [draftRows, setDraftRows] = useState([]);
  const [weekNotes, setWeekNotes] = useState('');
  const [pendingSignedFile, setPendingSignedFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [attachmentsByTimesheet, setAttachmentsByTimesheet] = useState({});
  const [loadingAttachmentIds, setLoadingAttachmentIds] = useState({});
  const [expandedHistory, setExpandedHistory] = useState({});

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const [employeeDetail, ownSchedules, ownTimesheets] = await Promise.all([
        user?.employee_id ? api.getEmployee(user.employee_id).catch(() => null) : Promise.resolve(null),
        api.getSchedules(),
        api.getTimesheets(),
      ]);
      setEmployee(employeeDetail);
      setSchedules(ownSchedules || []);
      setTimesheets(ownTimesheets || []);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const weekDates = useMemo(() => getWeekDates(selectedDate, 0), [selectedDate]);
  const weekIsos = useMemo(() => weekDates.map(fmtISO), [weekDates]);
  const weekStart = weekIsos[0];
  const weekEnd = weekIsos[6];
  const weekLabel = useMemo(
    () => `${fmtDay(weekDates[0])} - ${fmtDay(weekDates[6])}`,
    [weekDates],
  );

  const scheduleById = useMemo(
    () => new Map((schedules || []).map((shift) => [shift.id, shift])),
    [schedules],
  );

  const weekSchedules = useMemo(
    () =>
      schedules
        .filter((shift) => weekIsos.includes(shift.date))
        .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`)),
    [schedules, weekIsos],
  );

  const weekTimesheet = useMemo(
    () =>
      (timesheets || []).find(
        (timesheet) =>
          timesheet.period_start === weekStart && timesheet.period_end === weekEnd,
      ) || null,
    [timesheets, weekEnd, weekStart],
  );

  const canEditWeekTimesheet = weekTimesheet?.status !== 'approved';

  const loadTimesheetAttachments = useCallback(async (timesheetId) => {
    if (!timesheetId) return [];
    try {
      setLoadingAttachmentIds((prev) => ({ ...prev, [timesheetId]: true }));
      const attachments = await api.getTimesheetAttachments(timesheetId);
      setAttachmentsByTimesheet((prev) => ({ ...prev, [timesheetId]: attachments || [] }));
      return attachments || [];
    } catch (err) {
      toast?.('Erreur: ' + err.message);
      return [];
    } finally {
      setLoadingAttachmentIds((prev) => ({ ...prev, [timesheetId]: false }));
    }
  }, [toast]);

  useEffect(() => {
    if (weekTimesheet?.id && attachmentsByTimesheet[weekTimesheet.id] == null) {
      loadTimesheetAttachments(weekTimesheet.id);
    }
  }, [attachmentsByTimesheet, loadTimesheetAttachments, weekTimesheet?.id]);

  useEffect(() => {
    const timesheetShiftMap = new Map(
      (weekTimesheet?.shifts || []).map((shift) => [shift.schedule_id, shift]),
    );
    let nextRows = weekSchedules.map((schedule) =>
      buildDraftRow(schedule, timesheetShiftMap.get(schedule.id)),
    );

    if (!nextRows.length && (weekTimesheet?.shifts || []).length) {
      nextRows = (weekTimesheet.shifts || []).map((shift) =>
        buildDraftRow(scheduleById.get(shift.schedule_id), shift),
      );
    }

    setDraftRows(nextRows);
    setWeekNotes(weekTimesheet?.notes || '');
    setPendingSignedFile(null);
  }, [scheduleById, weekSchedules, weekTimesheet]);

  const updateDraftRow = (index, field, value) => {
    setDraftRows((prev) => {
      const next = [...prev];
      const row = { ...next[index], [field]: value };
      if (field === 'startActual' || field === 'endActual' || field === 'pauseMin') {
        row.hoursWorked = recalcHours(row.startActual, row.endActual, row.pauseMin);
      }
      next[index] = row;
      return next;
    });
  };

  const submitCurrentWeekTimesheet = async () => {
    if (!user?.employee_id || !draftRows.length) {
      toast?.('Aucun quart a soumettre pour cette semaine');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        employee_id: Number(user.employee_id),
        period_start: weekStart,
        period_end: weekEnd,
        notes: weekNotes,
        shifts: draftRows.map((shift) => ({
          schedule_id: shift.scheduleId,
          date: shift.date,
          hours_worked: Number(shift.hoursWorked || 0),
          pause: Number(shift.pauseMin || 0) / 60,
          garde_hours: Number(shift.gardeHours || 0),
          rappel_hours: Number(shift.rappelHours || 0),
          km: Number(shift.km || 0),
          deplacement: Number(shift.deplacement || 0),
          autre_dep: Number(shift.autreDep || 0),
          start_actual: normalizeTime(shift.startActual),
          end_actual: normalizeTime(shift.endActual),
        })),
      };

      const response = await api.submitTimesheet(payload);
      const timesheetId = response?.id;
      if (pendingSignedFile && timesheetId) {
        await api.uploadTimesheetAttachment(timesheetId, pendingSignedFile, 'fdt', pendingSignedFile.name);
      }
      setPendingSignedFile(null);
      toast?.(weekTimesheet ? 'FDT mise a jour' : 'FDT soumise');
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const uploadSignedDocument = async (file) => {
    if (!file || !weekTimesheet?.id) return;
    try {
      await api.uploadTimesheetAttachment(weekTimesheet.id, file, 'fdt', file.name);
      toast?.('Document signe ajoute');
      await loadTimesheetAttachments(weekTimesheet.id);
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const deleteAttachment = async (attachmentId) => {
    if (!weekTimesheet?.id || !attachmentId) return;
    if (!window.confirm('Supprimer cette piece jointe ?')) return;
    try {
      await api.deleteTimesheetAttachment(weekTimesheet.id, attachmentId);
      toast?.('Piece jointe supprimee');
      await loadTimesheetAttachments(weekTimesheet.id);
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const toggleHistory = async (timesheetId) => {
    const nextExpanded = !expandedHistory[timesheetId];
    setExpandedHistory((prev) => ({ ...prev, [timesheetId]: nextExpanded }));
    if (nextExpanded && attachmentsByTimesheet[timesheetId] == null) {
      await loadTimesheetAttachments(timesheetId);
    }
  };

  const moveWeek = (delta) => {
    setSelectedDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + delta * 7);
      return next;
    });
  };

  const weekPlannedHours = useMemo(
    () => weekSchedules.reduce((sum, shift) => sum + Number(shift.hours || 0), 0),
    [weekSchedules],
  );
  const weekDeclaredHours = useMemo(
    () => draftRows.reduce((sum, shift) => sum + Number(shift.hoursWorked || 0), 0),
    [draftRows],
  );
  const weekDeclaredKm = useMemo(
    () => draftRows.reduce((sum, shift) => sum + Number(shift.km || 0), 0),
    [draftRows],
  );
  const weekDeclaredDeplacement = useMemo(
    () => draftRows.reduce((sum, shift) => sum + Number(shift.deplacement || 0), 0),
    [draftRows],
  );
  const weekDeclaredOtherExpenses = useMemo(
    () => draftRows.reduce((sum, shift) => sum + Number(shift.autreDep || 0), 0),
    [draftRows],
  );
  const weekSignedDocuments = weekTimesheet?.id
    ? attachmentsByTimesheet[weekTimesheet.id] || []
    : [];
  const upcomingSchedules = useMemo(
    () =>
      schedules
        .filter((shift) => shift.date >= fmtISO(new Date()))
        .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
        .slice(0, 8),
    [schedules],
  );
  const historyTimesheets = useMemo(
    () =>
      (timesheets || [])
        .filter((timesheet) => timesheet.id !== weekTimesheet?.id)
        .sort((a, b) => `${b.period_start} ${b.created_at || ''}`.localeCompare(`${a.period_start} ${a.created_at || ''}`))
        .slice(0, 6),
    [timesheets, weekTimesheet?.id],
  );

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
        Chargement de votre horaire...
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">
          <Calendar size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Mon horaire
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Ressource</div>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>{employee?.name || user?.name || '-'}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{employee?.position || 'Employe'}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Heures planifiees cette semaine</div>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)', fontSize: 24 }}>{weekPlannedHours.toFixed(2)} h</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Heures saisies cette semaine</div>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)', fontSize: 24 }}>{weekDeclaredHours.toFixed(2)} h</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Statut FDT</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {weekTimesheet ? <Badge status={weekTimesheet.status} /> : <span className="badge" style={{ background: 'var(--brand-xl)', color: 'var(--brand)' }}>Aucune FDT</span>}
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{weekSignedDocuments.length} document(s)</span>
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Frais saisis cette semaine</div>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)', fontSize: 20 }}>{weekDeclaredKm.toFixed(0)} km</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
            {weekDeclaredDeplacement.toFixed(2)} h dep. • {weekDeclaredOtherExpenses.toFixed(2)} $
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Semaine du {weekLabel}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => moveWeek(-1)}>
              <ChevronLeft size={14} /> Precedente
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => moveWeek(1)}>
              Suivante <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(7, minmax(0, 1fr))', gap: 10 }}>
          {weekDates.map((date) => {
            const iso = fmtISO(date);
            const daySchedules = weekSchedules.filter((shift) => shift.date === iso);
            return (
              <div
                key={iso}
                style={{
                  background: 'var(--brand-xl)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 12,
                  minHeight: isMobile ? 0 : 150,
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 700, marginBottom: 10 }}>
                  {fmtDay(date)}
                </div>
                {daySchedules.length ? (
                  daySchedules.map((shift) => (
                    <div key={shift.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 10px', marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{shift.start} - {shift.end}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{shift.location || 'Lieu a confirmer'}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{Number(shift.hours || 0).toFixed(2)} h</span>
                        <Badge status={shift.status || 'published'} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>Aucun quart</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--brand-d)' }}>
              <FileText size={16} style={{ color: 'var(--brand)' }} />
              Saisir ma FDT
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
              Saisissez vos heures reelles pour la semaine, puis joignez votre FDT signee.
            </div>
          </div>
          {weekTimesheet && <Badge status={weekTimesheet.status} />}
        </div>

        {!draftRows.length ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>
            Aucun quart publie pour cette semaine.
          </div>
        ) : (
          <>
            {!canEditWeekTimesheet && (
              <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: '#eef8f0', color: '#1f7a3f', fontSize: 13 }}>
                Cette FDT est deja approuvee. Elle reste visible ici, mais ne peut plus etre modifiee.
              </div>
            )}

            {!isMobile ? (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 920 }}>
                    <thead>
                      <tr>
                        {['Date', 'Planifie', 'Debut reel', 'Fin reelle', 'Pause (min)', 'Heures', 'Garde h', 'Rappel h', 'Lieu'].map((label) => (
                          <th key={label} style={{ background: '#3f8391', color: '#fff', padding: '10px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700 }}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draftRows.map((row, index) => (
                        <tr key={row.scheduleId || `${row.date}-${index}`}>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{row.date}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontWeight: 700, fontSize: 12 }}>{row.scheduledStart || '--:--'} - {row.scheduledEnd || '--:--'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{Number(row.scheduledHours || 0).toFixed(2)} h</div>
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="time" value={row.startActual} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'startActual', event.target.value)} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="time" value={row.endActual} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'endActual', event.target.value)} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="number" min="0" value={row.pauseMin} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'pauseMin', Number(event.target.value || 0))} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="number" min="0" step="0.25" value={row.hoursWorked} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'hoursWorked', Number(event.target.value || 0))} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="number" min="0" step="0.25" value={row.gardeHours} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'gardeHours', Number(event.target.value || 0))} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="number" min="0" step="0.25" value={row.rappelHours} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'rappelHours', Number(event.target.value || 0))} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 12 }}>{row.location || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 14, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 760 }}>
                    <thead>
                      <tr>
                        {['Date', 'Kilometrage', 'Deplacement h', 'Autre depense $', 'Lieu'].map((label) => (
                          <th key={label} style={{ background: '#3f8391', color: '#fff', padding: '10px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700 }}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draftRows.map((row, index) => (
                        <tr key={`${row.scheduleId || `${row.date}-${index}`}-expenses`}>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{row.date}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="number" min="0" step="1" value={row.km} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'km', Number(event.target.value || 0))} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="number" min="0" step="0.25" value={row.deplacement} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'deplacement', Number(event.target.value || 0))} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            <input className="input" type="number" min="0" step="0.01" value={row.autreDep} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'autreDep', Number(event.target.value || 0))} />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 12 }}>{row.location || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {draftRows.map((row, index) => (
                  <div key={row.scheduleId || `${row.date}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 14, background: '#fff', padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>{row.date}</div>
                        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                          Planifie: {row.scheduledStart || '--:--'} - {row.scheduledEnd || '--:--'} ({Number(row.scheduledHours || 0).toFixed(2)} h)
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'right' }}>{row.location || 'Lieu a confirmer'}</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <FieldInput label="Debut reel">
                        <input className="input" type="time" value={row.startActual} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'startActual', event.target.value)} />
                      </FieldInput>
                      <FieldInput label="Fin reelle">
                        <input className="input" type="time" value={row.endActual} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'endActual', event.target.value)} />
                      </FieldInput>
                      <FieldInput label="Pause (min)">
                        <input className="input" type="number" min="0" value={row.pauseMin} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'pauseMin', Number(event.target.value || 0))} />
                      </FieldInput>
                      <FieldInput label="Heures">
                        <input className="input" type="number" min="0" step="0.25" value={row.hoursWorked} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'hoursWorked', Number(event.target.value || 0))} />
                      </FieldInput>
                      <FieldInput label="Garde h">
                        <input className="input" type="number" min="0" step="0.25" value={row.gardeHours} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'gardeHours', Number(event.target.value || 0))} />
                      </FieldInput>
                      <FieldInput label="Rappel h">
                        <input className="input" type="number" min="0" step="0.25" value={row.rappelHours} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'rappelHours', Number(event.target.value || 0))} />
                      </FieldInput>
                    </div>

                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <FieldInput label="Kilometrage">
                        <input className="input" type="number" min="0" step="1" value={row.km} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'km', Number(event.target.value || 0))} />
                      </FieldInput>
                      <FieldInput label="Deplacement h">
                        <input className="input" type="number" min="0" step="0.25" value={row.deplacement} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'deplacement', Number(event.target.value || 0))} />
                      </FieldInput>
                      <FieldInput label="Autre depense $" fullWidth>
                        <input className="input" type="number" min="0" step="0.01" value={row.autreDep} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(index, 'autreDep', Number(event.target.value || 0))} />
                      </FieldInput>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Notes pour cette semaine</label>
                <textarea
                  className="input"
                  style={{ minHeight: 96, resize: 'vertical' }}
                  value={weekNotes}
                  disabled={!canEditWeekTimesheet}
                  onChange={(event) => setWeekNotes(event.target.value)}
                  placeholder="Ex.: quart termine plus tard, rappel, pause differente, commentaire sur la FDT signee..."
                />
              </div>
              <div style={{ background: 'var(--brand-xl)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
                <div style={{ fontWeight: 700, color: 'var(--brand-d)', marginBottom: 8 }}>Document signe</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                  PDF, JPG, PNG, GIF, HEIC ou HEIF.
                </div>

                {canEditWeekTimesheet && (
                  <>
                    <label className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}>
                      <Upload size={14} /> {weekTimesheet ? 'Ajouter un document signe' : 'Choisir la FDT signee'}
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.gif,.heic,.heif,image/*,application/pdf"
                        style={{ display: 'none' }}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (weekTimesheet?.id) {
                            uploadSignedDocument(file);
                          } else {
                            setPendingSignedFile(file);
                          }
                          event.target.value = '';
                        }}
                      />
                    </label>
                    {!weekTimesheet && pendingSignedFile && (
                      <div style={{ fontSize: 12, color: 'var(--brand-d)', marginBottom: 10 }}>
                        Fichier pret: {pendingSignedFile.name}
                      </div>
                    )}
                  </>
                )}

                {weekTimesheet?.id && (
                  <>
                    {loadingAttachmentIds[weekTimesheet.id] && (
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Chargement des documents...</div>
                    )}
                    {!loadingAttachmentIds[weekTimesheet.id] && weekSignedDocuments.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Aucun document joint pour cette FDT.</div>
                    )}
                    {weekSignedDocuments.map((attachment) => (
                      <div key={attachment.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {attachment.original_filename || attachment.filename}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                            {attachment.created_at?.slice(0, 10) || '-'} • {attachment.source === 'email' ? 'Courriel' : 'Portail'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => api.openTimesheetAttachment(weekTimesheet.id, attachment.id, attachment.original_filename || attachment.filename || 'fdt')}
                          >
                            <Paperclip size={14} /> Ouvrir
                          </button>
                          {canEditWeekTimesheet && (
                            <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteAttachment(attachment.id)}>
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {draftRows.length} quart(s) • {weekDeclaredHours.toFixed(2)} h • {weekDeclaredKm.toFixed(0)} km • {weekDeclaredDeplacement.toFixed(2)} h dep. • {weekDeclaredOtherExpenses.toFixed(2)} $
              </div>
              <button className="btn btn-primary" disabled={!canEditWeekTimesheet || !draftRows.length || submitting} onClick={submitCurrentWeekTimesheet}>
                <Send size={16} /> {submitting ? 'Envoi...' : weekTimesheet ? 'Mettre a jour ma FDT' : 'Soumettre ma FDT'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <Clock3 size={16} style={{ color: 'var(--brand)' }} />
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Mes prochains quarts</div>
        </div>
        {upcomingSchedules.length ? (
          upcomingSchedules.map((shift) => (
            <div key={shift.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{shift.date} | {shift.start} - {shift.end}</div>
                <div style={{ color: 'var(--text3)', marginTop: 3 }}>{shift.location || 'Lieu a confirmer'}</div>
              </div>
              <div style={{ color: 'var(--brand-d)', fontWeight: 700 }}>{Number(shift.hours || 0).toFixed(2)} h</div>
            </div>
          ))
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Aucun quart publie a venir.</div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <FileText size={16} style={{ color: 'var(--brand)' }} />
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Historique de mes FDT</div>
        </div>
        {timesheets.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Aucune FDT soumise pour le moment.</div>
        ) : (
          historyTimesheets.concat(weekTimesheet ? [weekTimesheet] : []).sort((a, b) => `${b.period_start} ${b.created_at || ''}`.localeCompare(`${a.period_start} ${a.created_at || ''}`)).map((timesheet) => {
            const isExpanded = Boolean(expandedHistory[timesheet.id]);
            const attachments = attachmentsByTimesheet[timesheet.id] || [];
            const totalHours = (timesheet.shifts || []).reduce((sum, shift) => sum + Number(shift.hours_worked || 0), 0);
            const attachmentCount = Number(timesheet.attachment_count || attachments.length || 0);
            return (
              <div key={timesheet.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{timesheet.period_start} au {timesheet.period_end}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                      {(timesheet.shifts || []).length} quart(s) • {totalHours.toFixed(2)} h • {attachmentCount} document(s)
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Badge status={timesheet.status} />
                    <button className="btn btn-outline btn-sm" onClick={() => toggleHistory(timesheet.id)}>
                      {isExpanded ? 'Masquer' : 'Details'}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                    <div style={{ background: 'var(--brand-xl)', borderRadius: 12, padding: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Quarts declares</div>
                      {(timesheet.shifts || []).map((shift) => (
                        <div key={shift.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,.06)', fontSize: 12 }}>
                          <span>{shift.date}</span>
                          <span style={{ textAlign: 'right' }}>
                            {Number(shift.hours_worked || 0).toFixed(2)} h
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)' }}>
                              {Number(shift.km || 0).toFixed(0)} km • {Number(shift.deplacement || 0).toFixed(2)} h • {Number(shift.autre_dep || 0).toFixed(2)} $
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Documents joints</div>
                      {loadingAttachmentIds[timesheet.id] && (
                        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Chargement...</div>
                      )}
                      {!loadingAttachmentIds[timesheet.id] && attachments.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Aucun document joint.</div>
                      )}
                      {attachments.map((attachment) => (
                        <div key={attachment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {attachment.original_filename || attachment.filename}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{attachment.created_at?.slice(0, 10) || '-'}</div>
                          </div>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => api.openTimesheetAttachment(timesheet.id, attachment.id, attachment.original_filename || attachment.filename || 'fdt')}
                          >
                            <Paperclip size={14} /> Ouvrir
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
