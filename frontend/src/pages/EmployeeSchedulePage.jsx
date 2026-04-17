import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Paperclip,
  Plus,
  Send,
  Trash2,
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

function timeToMinutes(value) {
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

function normalizeTimeForInput(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})(?::\d{2})?$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return '';
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeTimeDraft(value) {
  const raw = String(value || '')
    .replace(/[^\d:]/g, '')
    .slice(0, 5);
  if (!raw) return '';
  if (raw.includes(':')) {
    const [hours = '', minutes = ''] = raw.split(':');
    return `${hours.slice(0, 2)}${raw.includes(':') ? ':' : ''}${minutes.slice(0, 2)}`;
  }
  const digits = raw.slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function recalcHours(startStr, endStr, pauseMin) {
  let start = timeToMinutes(startStr);
  let end = timeToMinutes(endStr);
  if (end <= start) end += 24 * 60;
  const totalMinutes = Math.max(0, end - start - Number(pauseMin || 0));
  return Math.round((totalMinutes / 60) * 100) / 100;
}

function hoursToDuration(hoursValue) {
  const totalMinutes = Math.max(0, Math.round(Number(hoursValue || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(Math.min(hours, 23)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function durationToHours(value) {
  if (!value) return 0;
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const hours = Number(match[1]) || 0;
  const minutes = Number(match[2]) || 0;
  return Math.round(((hours * 60 + minutes) / 60) * 100) / 100;
}

function formatHours(value) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function normalizeDecimalDraft(value) {
  const raw = String(value || '').replace(',', '.');
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  const fractional = rest.join('').slice(0, 2);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  return fractional ? `${normalizedWhole || '0'}.${fractional}` : normalizedWhole;
}

function parseDraftNumber(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDays(dateValue, days) {
  const next = new Date(dateValue);
  next.setDate(next.getDate() + days);
  return next;
}

function buildBiWeekDates(anchorDate) {
  const firstWeek = getWeekDates(anchorDate, 0);
  const secondWeek = getWeekDates(addDays(anchorDate, 7), 0);
  return [...firstWeek, ...secondWeek];
}

function defaultPauseMin(schedule) {
  const scheduledHours = Number(schedule?.hours || 0);
  const durationMinutes = Math.max(0, timeToMinutes(schedule?.end) - timeToMinutes(schedule?.start));
  const normalizedDuration = durationMinutes > 0 ? durationMinutes : durationMinutes + 24 * 60;
  const pauseHours = Math.max(0, normalizedDuration / 60 - scheduledHours);
  return Math.round(pauseHours * 60);
}

function buildDraftRow(schedule, existingShift = null) {
  const startActual = normalizeTime(existingShift?.start_actual || schedule?.start || '08:00');
  const endActual = normalizeTime(existingShift?.end_actual || schedule?.end || '16:00');
  const pauseMin = Math.round(Number(existingShift?.pause || 0) * 60) || defaultPauseMin(schedule);
  const gardeHours = Number(existingShift?.garde_hours || 0);
  const rappelHours = Number(existingShift?.rappel_hours || 0);
  const km = Number(existingShift?.km || 0);
  const autreDep = Number(existingShift?.autre_dep || 0);
  return {
    rowId: existingShift?.id || schedule?.id || `manual-${Math.random().toString(36).slice(2, 10)}`,
    scheduleId: existingShift?.schedule_id || schedule?.id || '',
    isManual: !schedule || !schedule?.id,
    date: existingShift?.date || schedule?.date || '',
    location: existingShift?.location || schedule?.location || '',
    scheduledStart: schedule?.start || '',
    scheduledEnd: schedule?.end || '',
    scheduledHours: Number(schedule?.hours || 0),
    startActual,
    endActual,
    pauseMin,
    hoursWorked: Number(existingShift?.hours_worked || recalcHours(startActual, endActual, pauseMin)),
    gardeHours,
    gardeInput: gardeHours ? hoursToDuration(gardeHours) : '',
    rappelHours,
    rappelInput: rappelHours ? hoursToDuration(rappelHours) : '',
    km,
    kmInput: km ? String(km) : '',
    autreDep,
    autreDepInput: autreDep ? String(autreDep) : '',
  };
}

function createManualDraftRow(defaultDate) {
  return buildDraftRow(null, {
    date: defaultDate,
    start_actual: '08:00',
    end_actual: '16:00',
    location: '',
    hours_worked: 8,
    pause: 0,
  });
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
  const [sharedDocuments, setSharedDocuments] = useState([]);
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
      const [employeeDetail, ownSchedules, ownTimesheets, globalDocs, employeeDocs] = await Promise.all([
        user?.employee_id ? api.getEmployee(user.employee_id).catch(() => null) : Promise.resolve(null),
        api.getSchedules(),
        api.getTimesheets(),
        api.getSharedEmployeeDocuments().catch(() => []),
        user?.employee_id ? api.getEmployeeDocuments(user.employee_id).catch(() => []) : Promise.resolve([]),
      ]);
      setEmployee(employeeDetail);
      setSchedules(ownSchedules || []);
      setTimesheets(ownTimesheets || []);
      setSharedDocuments([
        ...(globalDocs || []).map((document) => ({ ...document, portal_scope: 'shared' })),
        ...(employeeDocs || []).map((document) => ({ ...document, portal_scope: 'employee' })),
      ]);
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
  const biWeekDates = useMemo(() => buildBiWeekDates(selectedDate), [selectedDate]);
  const weekIsos = useMemo(() => weekDates.map(fmtISO), [weekDates]);
  const biWeekIsos = useMemo(() => biWeekDates.map(fmtISO), [biWeekDates]);
  const weekStart = weekIsos[0];
  const weekEnd = weekIsos[6];
  const biWeekLabel = `${fmtDay(biWeekDates[0])} - ${fmtDay(biWeekDates[biWeekDates.length - 1])}`;

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

  const biWeekSchedules = useMemo(
    () =>
      schedules
        .filter((shift) => biWeekIsos.includes(shift.date))
        .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`)),
    [biWeekIsos, schedules],
  );

  const weekTimesheet = useMemo(
    () =>
      (timesheets || []).find(
        (timesheet) =>
          String(timesheet.period_start || '') === String(weekStart) &&
          String(timesheet.period_end || '') === String(weekEnd),
      ) || null,
    [timesheets, weekEnd, weekStart],
  );

  const canEditWeekTimesheet = weekTimesheet?.status !== 'approved';

  const loadTimesheetAttachments = useCallback(
    async (timesheetId) => {
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
    },
    [toast],
  );

  useEffect(() => {
    if (weekTimesheet?.id && attachmentsByTimesheet[weekTimesheet.id] == null) {
      loadTimesheetAttachments(weekTimesheet.id);
    }
  }, [attachmentsByTimesheet, loadTimesheetAttachments, weekTimesheet?.id]);

  useEffect(() => {
    const timesheetShiftMap = new Map(
      (weekTimesheet?.shifts || []).map((shift) => [shift.schedule_id || `manual-${shift.id}`, shift]),
    );
    let nextRows = weekSchedules.map((schedule) =>
      buildDraftRow(schedule, timesheetShiftMap.get(schedule.id)),
    );

    const manualRows = (weekTimesheet?.shifts || [])
      .filter((shift) => !shift.schedule_id || !scheduleById.get(shift.schedule_id))
      .map((shift) => buildDraftRow(null, shift));

    nextRows = [...nextRows, ...manualRows];
    setDraftRows(nextRows);
    setWeekNotes(weekTimesheet?.notes || '');
    setPendingSignedFile(null);
  }, [scheduleById, weekSchedules, weekTimesheet]);

  const weekSignedDocuments = weekTimesheet?.id ? attachmentsByTimesheet[weekTimesheet.id] || [] : [];
  const hasAttachmentForSubmission = weekSignedDocuments.length > 0 || Boolean(pendingSignedFile);
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
  const weekDeclaredOtherExpenses = useMemo(
    () => draftRows.reduce((sum, shift) => sum + Number(shift.autreDep || 0), 0),
    [draftRows],
  );
  const historyTimesheets = useMemo(
    () =>
      (timesheets || [])
        .sort((a, b) => `${b.period_start} ${b.created_at || ''}`.localeCompare(`${a.period_start} ${a.created_at || ''}`))
        .slice(0, 8),
    [timesheets],
  );

  const updateDraftRow = (rowId, field, value) => {
    setDraftRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        const next = { ...row };
        if (field === 'startActual' || field === 'endActual') {
          next[field] = normalizeTimeDraft(value);
          const normalizedStart = normalizeTimeForInput(next.startActual);
          const normalizedEnd = normalizeTimeForInput(next.endActual);
          if (normalizedStart && normalizedEnd) {
            next.hoursWorked = recalcHours(normalizedStart, normalizedEnd, next.pauseMin);
          }
          return next;
        }
        if (field === 'pauseMin') {
          next.pauseMin = Number(value || 0);
          const normalizedStart = normalizeTimeForInput(next.startActual);
          const normalizedEnd = normalizeTimeForInput(next.endActual);
          if (normalizedStart && normalizedEnd) {
            next.hoursWorked = recalcHours(normalizedStart, normalizedEnd, next.pauseMin);
          }
          return next;
        }
        if (field === 'gardeInput') {
          next.gardeInput = normalizeTimeDraft(value);
          next.gardeHours = durationToHours(normalizeTimeForInput(next.gardeInput));
          return next;
        }
        if (field === 'rappelInput') {
          next.rappelInput = normalizeTimeDraft(value);
          next.rappelHours = durationToHours(normalizeTimeForInput(next.rappelInput));
          return next;
        }
        if (field === 'kmInput') {
          next.kmInput = normalizeDecimalDraft(value);
          next.km = parseDraftNumber(next.kmInput);
          return next;
        }
        if (field === 'autreDepInput') {
          next.autreDepInput = normalizeDecimalDraft(value);
          next.autreDep = parseDraftNumber(next.autreDepInput);
          return next;
        }
        next[field] = value;
        return next;
      }),
    );
  };

  const addManualShift = () => {
    setDraftRows((prev) => [...prev, createManualDraftRow(weekStart)]);
  };

  const removeManualShift = (rowId) => {
    setDraftRows((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  const submitCurrentWeekTimesheet = async () => {
    if (!user?.employee_id || !draftRows.length) {
      toast?.('Aucun quart a soumettre pour cette semaine');
      return;
    }
    if (!hasAttachmentForSubmission) {
      toast?.('Ajoute la FDT signee avant de soumettre la semaine');
      return;
    }
    for (const shift of draftRows) {
      if (!normalizeTimeForInput(shift.startActual) || !normalizeTimeForInput(shift.endActual)) {
        toast?.(`Completer l'heure de debut et de fin du quart ${shift.date || ''} au format 24 h`);
        return;
      }
      if (shift.gardeInput && !normalizeTimeForInput(shift.gardeInput)) {
        toast?.(`Completer les heures de garde du quart ${shift.date || ''} au format HH:MM`);
        return;
      }
      if (shift.rappelInput && !normalizeTimeForInput(shift.rappelInput)) {
        toast?.(`Completer les heures de rappel du quart ${shift.date || ''} au format HH:MM`);
        return;
      }
    }

    try {
      setSubmitting(true);
      const payload = {
        employee_id: Number(user.employee_id),
        period_start: weekStart,
        period_end: weekEnd,
        notes: weekNotes,
        shifts: draftRows.map((shift) => ({
          schedule_id: shift.scheduleId || null,
          date: shift.date,
          hours_worked: Number(shift.hoursWorked || 0),
          pause: Number(shift.pauseMin || 0) / 60,
          garde_hours: Number(shift.gardeHours || 0),
          rappel_hours: Number(shift.rappelHours || 0),
          km: Number(shift.km || 0),
          deplacement: 0,
          autre_dep: Number(shift.autreDep || 0),
          start_actual: normalizeTimeForInput(shift.startActual) || normalizeTime(shift.startActual),
          end_actual: normalizeTimeForInput(shift.endActual) || normalizeTime(shift.endActual),
          location: shift.location || '',
        })),
      };

      let response;
      if (pendingSignedFile) response = await api.submitTimesheetWithAttachment(payload, pendingSignedFile);
      else response = await api.submitTimesheet(payload);

      setPendingSignedFile(null);
      toast?.(weekTimesheet ? 'FDT mise a jour' : 'FDT soumise');
      if (response?.id) await loadTimesheetAttachments(response.id);
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

  const moveWindow = (delta) => {
    setSelectedDate((current) => addDays(current, delta * 14));
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Chargement de votre horaire...</div>;
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
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Vue calendrier 2 semaines • {biWeekLabel}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => moveWindow(-1)}>
              <ChevronLeft size={14} /> Precedentes
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setSelectedDate(new Date())}>Aujourd'hui</button>
            <button className="btn btn-outline btn-sm" onClick={() => moveWindow(1)}>
              Suivantes <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(7, minmax(0, 1fr))', gap: 10 }}>
          {biWeekDates.map((date) => {
            const iso = fmtISO(date);
            const daySchedules = biWeekSchedules.filter((shift) => shift.date === iso);
            return (
              <div
                key={iso}
                style={{
                  background: 'var(--brand-xl)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 12,
                  minHeight: isMobile ? 0 : 146,
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 700, marginBottom: 10 }}>{fmtDay(date)}</div>
                {daySchedules.length ? (
                  daySchedules.map((shift) => (
                    <div key={shift.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 10px', marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{shift.start} - {shift.end}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{shift.location || 'Lieu a confirmer'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{formatHours(shift.hours)} h</div>
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
              Format 24 h. La FDT signee doit etre jointe avant la soumission.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {weekTimesheet && <Badge status={weekTimesheet.status} />}
            {canEditWeekTimesheet && (
              <button className="btn btn-outline btn-sm" onClick={addManualShift}>
                <Plus size={14} /> Ajouter un quart manuel
              </button>
            )}
          </div>
        </div>

        {!draftRows.length ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Aucun quart a declarer pour cette semaine.</div>
        ) : (
          <>
            {!canEditWeekTimesheet && (
              <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: '#eef8f0', color: '#1f7a3f', fontSize: 13 }}>
                Cette FDT est deja approuvee. Elle reste visible ici, mais ne peut plus etre modifiee.
              </div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              {draftRows.map((row) => (
                <div key={row.rowId} style={{ border: '1px solid var(--border)', borderRadius: 14, background: '#fff', padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>{row.date || 'Date a definir'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                        {row.isManual
                          ? 'Quart manuel ajoute par l\'employe'
                          : `Planifie: ${row.scheduledStart || '--:--'} - ${row.scheduledEnd || '--:--'} (${formatHours(row.scheduledHours)} h)`}
                      </div>
                    </div>
                    {row.isManual && canEditWeekTimesheet ? (
                      <button className="btn btn-outline btn-sm" onClick={() => removeManualShift(row.rowId)}>
                        <Trash2 size={14} /> Supprimer ce quart
                      </button>
                    ) : null}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                    <FieldInput label="Date">
                      <input className="input" type="date" value={row.date} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'date', event.target.value)} />
                    </FieldInput>
                    <FieldInput label="Debut reel">
                      <input className="input" type="text" inputMode="numeric" placeholder="07:00" value={row.startActual} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'startActual', event.target.value)} />
                    </FieldInput>
                    <FieldInput label="Fin reelle">
                      <input className="input" type="text" inputMode="numeric" placeholder="15:00" value={row.endActual} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'endActual', event.target.value)} />
                    </FieldInput>
                    <FieldInput label="Pause (min)">
                      <input className="input" type="number" min="0" step="5" value={row.pauseMin} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'pauseMin', Number(event.target.value || 0))} />
                    </FieldInput>
                    <FieldInput label="Heures">
                      <input className="input" type="number" min="0" step="0.25" value={row.hoursWorked} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'hoursWorked', Number(event.target.value || 0))} />
                    </FieldInput>
                    <FieldInput label="Heures de garde">
                      <input className="input" type="text" inputMode="numeric" placeholder="00:00" value={row.gardeInput || ''} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'gardeInput', event.target.value)} />
                    </FieldInput>
                    <FieldInput label="Heures de rappel">
                      <input className="input" type="text" inputMode="numeric" placeholder="00:00" value={row.rappelInput || ''} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'rappelInput', event.target.value)} />
                    </FieldInput>
                    <FieldInput label="Kilometrage">
                      <input className="input" type="text" inputMode="decimal" placeholder="0" value={row.kmInput || ''} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'kmInput', event.target.value)} onBlur={(event) => updateDraftRow(row.rowId, 'kmInput', event.target.value)} />
                    </FieldInput>
                    <FieldInput label="Autre depense $" fullWidth={isMobile}>
                      <input className="input" type="text" inputMode="decimal" placeholder="0.00" value={row.autreDepInput || ''} disabled={!canEditWeekTimesheet} onChange={(event) => updateDraftRow(row.rowId, 'autreDepInput', event.target.value)} onBlur={(event) => updateDraftRow(row.rowId, 'autreDepInput', event.target.value)} />
                    </FieldInput>
                    <FieldInput label="Lieu" fullWidth>
                      <input className="input" value={row.location || ''} disabled={!canEditWeekTimesheet && !row.isManual} onChange={(event) => updateDraftRow(row.rowId, 'location', event.target.value)} placeholder="Lieu ou details utiles du quart" />
                    </FieldInput>
                  </div>
                  {row.isManual && canEditWeekTimesheet ? (
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeManualShift(row.rowId)}>
                        <Trash2 size={14} /> Retirer ce quart manuel
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Notes pour cette semaine</label>
                <textarea
                  className="input"
                  style={{ minHeight: 96, resize: 'vertical' }}
                  value={weekNotes}
                  disabled={!canEditWeekTimesheet}
                  onChange={(event) => setWeekNotes(event.target.value)}
                  placeholder="Ex.: pause differente, quart ajoute manuellement, commentaire utile..."
                />
              </div>
              <div style={{ background: 'var(--brand-xl)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
                <div style={{ fontWeight: 700, color: 'var(--brand-d)', marginBottom: 8 }}>FDT signee</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                  La piece jointe est obligatoire avant la soumission.
                </div>

                {canEditWeekTimesheet && (
                  <>
                    <label className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}>
                      <Upload size={14} /> {weekTimesheet ? 'Ajouter / remplacer un document signe' : 'Choisir la FDT signee'}
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.gif,.heic,.heif,image/*,application/pdf"
                        style={{ display: 'none' }}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (weekTimesheet?.id) uploadSignedDocument(file);
                          else setPendingSignedFile(file);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    {!weekTimesheet && pendingSignedFile && (
                      <div style={{ fontSize: 12, color: 'var(--brand-d)', marginBottom: 10 }}>Fichier pret: {pendingSignedFile.name}</div>
                    )}
                  </>
                )}

                {weekTimesheet?.id ? (
                  <>
                    {loadingAttachmentIds[weekTimesheet.id] && (
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Chargement des documents...</div>
                    )}
                    {!loadingAttachmentIds[weekTimesheet.id] && weekSignedDocuments.length === 0 && (
                      <div style={{ fontSize: 12, color: '#b42318', marginBottom: 8 }}>Aucun document joint pour cette FDT.</div>
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
                          <button className="btn btn-outline btn-sm" onClick={() => api.openTimesheetAttachment(weekTimesheet.id, attachment.id, attachment.original_filename || attachment.filename || 'fdt')}>
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
                ) : (
                  <div style={{ fontSize: 12, color: hasAttachmentForSubmission ? 'var(--brand-d)' : '#b42318' }}>
                    {hasAttachmentForSubmission ? 'Piece jointe prete pour la soumission.' : 'Aucune piece jointe selectionnee.'}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {draftRows.length} quart(s) • {weekDeclaredHours.toFixed(2)} h • {weekDeclaredKm.toFixed(0)} km • {weekDeclaredOtherExpenses.toFixed(2)} $
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
          <Paperclip size={16} style={{ color: 'var(--brand)' }} />
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Documents partages par l'administration</div>
        </div>
        {sharedDocuments.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
                    {sharedDocuments.map((document) => (
                      <div key={document.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 12, background: '#fff', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{document.original_filename || document.filename}</div>
                          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                            {document.description || document.category || 'Document'}
                            {document.portal_scope === 'shared' ? ' • Partage a tous les employes actifs' : ' • Document individuel'}
                          </div>
                        </div>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() =>
                            document.portal_scope === 'shared'
                              ? api.downloadSharedEmployeeDocument(document.id, document.original_filename || document.filename || 'document')
                              : api.downloadEmployeeDocument(user.employee_id, document.id, document.original_filename || document.filename || 'document')
                          }
                        >
                          <Paperclip size={14} /> Ouvrir
                        </button>
                      </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Aucun document partage pour le moment.</div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <Clock3 size={16} style={{ color: 'var(--brand)' }} />
          <div style={{ fontWeight: 700, color: 'var(--brand-d)' }}>Mes prochains quarts</div>
        </div>
        {biWeekSchedules.length ? (
          biWeekSchedules.map((shift) => (
            <div key={shift.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{shift.date} | {shift.start} - {shift.end}</div>
                <div style={{ color: 'var(--text3)', marginTop: 3 }}>{shift.location || 'Lieu a confirmer'}</div>
              </div>
              <div style={{ color: 'var(--brand-d)', fontWeight: 700 }}>{formatHours(shift.hours)} h</div>
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
        {historyTimesheets.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Aucune FDT soumise pour le moment.</div>
        ) : (
          historyTimesheets.map((timesheet) => {
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
                              garde {formatHours(shift.garde_hours)} h • rappel {formatHours(shift.rappel_hours)} h • {Number(shift.km || 0).toFixed(0)} km • {Number(shift.autre_dep || 0).toFixed(2)} $
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
                          <button className="btn btn-outline btn-sm" onClick={() => api.openTimesheetAttachment(timesheet.id, attachment.id, attachment.original_filename || attachment.filename || 'fdt')}>
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
