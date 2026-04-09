import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Eye, Trash2 } from 'lucide-react';
import api from '../utils/api';
import { fmtISO, fmtMoney, RATE_KM } from '../utils/helpers';

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const GARDE_RATE = 86.23;
const ORIENTATION_NOTE_TAG = "[[orientation]]";
const POSITION_RATE_HINTS = [
  { match: /auxiliaire/, rate: 57.18 },
  { match: /prepose|beneficiaire|pab/, rate: 50.35 },
  { match: /clinicienne|clinicien|infirmier|infirmiere/, rate: 86.23 },
];

function calcHours(start, end, pause = 0) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  if ([sh, sm, eh, em].some(v => Number.isNaN(v))) return 0;
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, Math.round((((endMin - startMin) / 60) - pause) * 100) / 100);
}

function normalizeTimeForInput(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function pauseHoursToMinutes(value) {
  return Math.round(Number(value || 0) * 60);
}

function pauseMinutesToHours(value) {
  return Math.round((Number(value || 0) / 60) * 100) / 100;
}

function stripOrientationTag(value) {
  return String(value || "")
    .replaceAll(ORIENTATION_NOTE_TAG, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateRateFromPosition(label, fallbackRate = 0) {
  const raw = String(label || "").toLowerCase();
  const match = POSITION_RATE_HINTS.find((item) => item.match.test(raw));
  return match ? match.rate : Number(fallbackRate || 0);
}

function hasOrientationFlag(shift) {
  const notes = String(shift?.notes || "");
  return notes.includes(ORIENTATION_NOTE_TAG) || Boolean(shift?.is_orientation);
}

function buildShiftNotes(notes, isOrientation) {
  const clean = stripOrientationTag(notes);
  return isOrientation ? `${ORIENTATION_NOTE_TAG} ${clean}`.trim() : clean;
}

function getEffectiveShiftRate(shift, employeeRate = 0) {
  if (shift?.is_orientation) return 0;
  const rate = Number(shift?.billable_rate || 0);
  return rate > 0 ? rate : Number(employeeRate || 0);
}

function normalizeEditableShift(shift) {
  return {
    ...shift,
    date: shift.date ? String(shift.date).substring(0, 10) : '',
    start: normalizeTimeForInput(shift.start),
    end: normalizeTimeForInput(shift.end),
    hours: Number(shift.hours || 0),
    pause: Number(shift.pause || 0),
    billable_rate: Number(shift.billable_rate || 0),
    km: Number(shift.km || 0),
    deplacement: Number(shift.deplacement || 0),
    garde_hours: Number(shift.garde_hours || 0),
    rappel_hours: Number(shift.rappel_hours || 0),
    notes: stripOrientationTag(shift.notes || ''),
    is_orientation: hasOrientationFlag(shift),
    location: shift.location || '',
    client_id: shift.client_id || null,
    other_dep: shift.autre_dep ?? shift.other_dep ?? 0,
    pause_minutes: pauseHoursToMinutes(shift.pause),
    is_new: false,
  };
}

function getFallbackRegularRate(shift, originalShift = null, employee = null) {
  const candidates = [
    Number(shift?.billable_rate || 0),
    Number(originalShift?.billable_rate || 0),
    Number(employee?.rate || 0),
    estimateRateFromPosition(employee?.position || '', 0),
  ];
  return candidates.find((value) => Number.isFinite(value) && value > 0) || 0;
}

function computeAccommodationEstimate(accommodation, allEmployeeSchedules, billedShifts) {
  const allWorkedDates = [...new Set((allEmployeeSchedules || [])
    .filter(s => s.date >= accommodation.start_date && s.date <= accommodation.end_date)
    .map(s => s.date))].sort();
  const billedWorkedDates = [...new Set((billedShifts || [])
    .filter(s => s.date >= accommodation.start_date && s.date <= accommodation.end_date)
    .map(s => s.date))].sort();
  const totalCost = Number(accommodation.total_cost || 0);
  const fallbackCount = Number(accommodation.days_worked || 0);
  const denominator = allWorkedDates.length || fallbackCount || 1;
  const costPerWorkedDay = totalCost > 0 ? totalCost / denominator : Number(accommodation.cost_per_day || 0);
  return {
    days: billedWorkedDates.length,
    costPerDay: costPerWorkedDay,
    amount: billedWorkedDates.length * costPerWorkedDay,
  };
}

export default function ScheduleApprovalPanel({
  employee,
  client,
  shifts,
  allEmployeeSchedules,
  validationSummary,
  reviewDraft,
  setReviewDraft,
  currentReview,
  currentTimesheet,
  timesheetAttachments,
  currentInvoice,
  reviewAttachments,
  busy = false,
  onApprove,
  onRevoke,
  onGenerateInvoice,
  onUpload,
  onDeleteAttachment,
  onOpenAttachment,
  onGoInvoices,
  onRefreshParent,
  toast,
}) {
  const [editableShifts, setEditableShifts] = useState([]);
  const [savingShiftId, setSavingShiftId] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [accommodations, setAccommodations] = useState([]);
  const [loadingAccommodations, setLoadingAccommodations] = useState(false);
  const [accomForm, setAccomForm] = useState({ total_cost: '', start_date: '', end_date: '', notes: '' });
  const [savingAccommodation, setSavingAccommodation] = useState(false);
  const isSavingRef = React.useRef(false);
  const editableShiftsRef = React.useRef([]);
  const dirtyIdsRef = React.useRef(new Set());
  const approvedHoursManualRef = React.useRef(false);

  useEffect(() => {
    editableShiftsRef.current = editableShifts;
  }, [editableShifts]);

  useEffect(() => {
    dirtyIdsRef.current = dirtyIds;
  }, [dirtyIds]);

  useEffect(() => {
    if (isSavingRef.current) return;
    const normalizedIncoming = (shifts || []).map((shift) => normalizeEditableShift(shift));
    const currentEditableShifts = editableShiftsRef.current;
    const currentDirtyIds = dirtyIdsRef.current;

    if (!currentEditableShifts.length || currentDirtyIds.size === 0) {
      setEditableShifts(normalizedIncoming);
      return;
    }

    const currentById = new Map(currentEditableShifts.map(shift => [shift.id, shift]));
    const mergedShifts = normalizedIncoming.map(shift => currentDirtyIds.has(shift.id) ? (currentById.get(shift.id) || shift) : shift);

    currentEditableShifts.forEach(shift => {
      const isLocalOnly = shift.is_new || String(shift.id).startsWith('new-');
      if (isLocalOnly && currentDirtyIds.has(shift.id)) {
        mergedShifts.push(shift);
      }
    });

    setEditableShifts(mergedShifts);
  }, [employee?.position, shifts]);

  const loadAccommodations = useCallback(async () => {
    if (!employee?.id) {
      setAccommodations([]);
      return;
    }
    try {
      setLoadingAccommodations(true);
      const all = await api.getAccommodations();
      setAccommodations((all || []).filter(a => a.employee_id === employee.id));
    } catch {
      setAccommodations([]);
    } finally {
      setLoadingAccommodations(false);
    }
  }, [employee]);

  useEffect(() => {
    loadAccommodations();
  }, [loadAccommodations]);

  const originalShiftMap = useMemo(
    () => new Map((shifts || []).map(shift => {
      const normalized = normalizeEditableShift(shift);
      return [normalized.id, normalized];
    })),
    [shifts]
  );

  const updateEditableShift = (id, field, value) => {
    setDirtyIds(prev => new Set(prev).add(id));
    setEditableShifts(prev => prev.map(shift => {
      if (shift.id !== id) return shift;
      const next = { ...shift, [field]: value };
      if (field === 'is_orientation') {
        if (value) {
          next.billable_rate = 0;
        } else {
          next.billable_rate = getFallbackRegularRate(next, originalShiftMap.get(id), employee);
        }
      }
      if (field === 'start' || field === 'end' || field === 'pause_minutes') {
        next.pause = pauseMinutesToHours(next.pause_minutes);
        next.hours = calcHours(next.start, next.end, Number(next.pause || 0));
      }
      return next;
    }));
  };

  const addQuickShiftRow = () => {
    const baseDate = shifts?.[0]?.date || fmtISO(new Date());
    const newId = `new-${Date.now()}-${editableShifts.length}`;
    setDirtyIds(prev => new Set(prev).add(newId));
    setEditableShifts(prev => [
      ...prev,
      {
        id: newId,
        is_new: true,
        employee_id: employee.id,
        client_id: client?.id || null,
        date: baseDate,
        start: '07:00',
        end: '15:00',
        pause: 0.5,
        pause_minutes: 30,
        hours: 7.5,
        km: 0,
        deplacement: 0,
        other_dep: 0,
        notes: '',
        is_orientation: false,
        billable_rate: Number(employee?.rate || 0),
        garde_hours: 0,
        rappel_hours: 0,
        status: 'published',
        location: '',
      },
    ]);
  };

  const getValidatedTimeRange = (shift) => {
    const start = normalizeTimeForInput(shift.start);
    const end = normalizeTimeForInput(shift.end);
    if (!start || !end) {
      throw new Error(`Heure invalide pour le quart du ${shift.date || 'jour en cours'}. Utilise HH:MM en 24 h.`);
    }
    return { start, end };
  };

  const buildBaseShiftPayload = (shift) => {
    const { start, end } = getValidatedTimeRange(shift);
    return {
      start,
      end,
      pause: Number(shift.pause || 0),
      hours: Number(shift.hours || 0),
      km: Number(shift.km || 0),
      deplacement: Number(shift.deplacement || 0),
      autre_dep: Number(shift.other_dep || 0),
      notes: buildShiftNotes(shift.notes || '', Boolean(shift.is_orientation)),
    };
  };

  const buildCreatePayload = (shift) => ({
    employee_id: employee.id,
    client_id: client?.id || shift.client_id || null,
    date: shift.date,
    ...buildBaseShiftPayload(shift),
    billable_rate: shift.is_orientation ? 0 : getFallbackRegularRate(shift, null, employee),
    garde_hours: Number(shift.garde_hours || 0),
    rappel_hours: Number(shift.rappel_hours || 0),
    status: 'published',
    location: shift.location || '',
  });

  const buildUpdatePayload = (shift) => {
    const payload = buildBaseShiftPayload(shift);
    const original = originalShiftMap.get(shift.id);

    if (!original) {
      return {
        ...payload,
        date: shift.date,
        billable_rate: Number(shift.billable_rate || employee?.rate || 0),
        garde_hours: Number(shift.garde_hours || 0),
        rappel_hours: Number(shift.rappel_hours || 0),
        location: shift.location || '',
      };
    }

    if ((shift.date || '') !== (original.date || '')) {
      payload.date = shift.date;
    }
    if ((shift.location || '') !== (original.location || '')) {
      payload.location = shift.location || '';
    }
    const nextBillableRate = shift.is_orientation ? 0 : getFallbackRegularRate(shift, original, employee);
    if (Number(nextBillableRate || 0) !== Number(original.billable_rate || 0)) {
      payload.billable_rate = Number(nextBillableRate || 0);
    }
    if (Number(shift.garde_hours || 0) !== Number(original.garde_hours || 0)) {
      payload.garde_hours = Number(shift.garde_hours || 0);
    }
    if (Number(shift.rappel_hours || 0) !== Number(original.rappel_hours || 0)) {
      payload.rappel_hours = Number(shift.rappel_hours || 0);
    }

    return payload;
  };

  const buildFallbackUpdatePayload = (shift) => {
    const payload = buildBaseShiftPayload(shift);
    const original = originalShiftMap.get(shift.id);
    if ((shift.date || '') !== (original?.date || '')) {
      payload.date = shift.date;
    }
    return payload;
  };

  const persistShift = async (shift) => {
    if (shift.is_new) {
      return api.createSchedule(buildCreatePayload(shift));
    }

    const updatePayload = buildUpdatePayload(shift);
    try {
      return await api.updateSchedule(shift.id, updatePayload);
    } catch (err) {
      const fallbackPayload = buildFallbackUpdatePayload(shift);
      const updateKeys = Object.keys(updatePayload).sort().join('|');
      const fallbackKeys = Object.keys(fallbackPayload).sort().join('|');
      if (updateKeys === fallbackKeys) {
        throw err;
      }
      return await api.updateSchedule(shift.id, fallbackPayload);
    }
  };

  const saveAllDirtyShifts = async () => {
    const dirtyShifts = editableShifts.filter(shift => dirtyIds.has(shift.id));
    if (dirtyShifts.length === 0) return true;

    setSavingAll(true);
    isSavingRef.current = true;
    let allOk = true;
    const savedShiftIds = [];
    const savedShiftMap = new Map();

    for (const shift of dirtyShifts) {
      try {
        const saved = await persistShift(shift);
        if (saved && saved.id) {
          savedShiftMap.set(shift.id, normalizeEditableShift(saved));
        }

        savedShiftIds.push(shift.id);
      } catch (err) {
        allOk = false;
        toast?.(`Erreur sauvegarde ${shift.date || ''}: ${err.message || 'Échec'}`);
      }
    }

    if (allOk && dirtyShifts.length > 0) {
      toast?.(`${dirtyShifts.length} quart(s) sauvegardé(s)`);
      if (savedShiftIds.length > 0) {
        const nextEditableShifts = editableShiftsRef.current.map(row => savedShiftMap.get(row.id) || row);
        editableShiftsRef.current = nextEditableShifts;
        setEditableShifts(nextEditableShifts);
        const nextDirtyIds = new Set(dirtyIdsRef.current);
        savedShiftIds.forEach(id => nextDirtyIds.delete(id));
        dirtyIdsRef.current = nextDirtyIds;
        setDirtyIds(nextDirtyIds);
      }
      await onRefreshParent?.();
    }

    isSavingRef.current = false;
    setSavingAll(false);

    return allOk;
  };

  const handleEnregistrer = async () => {
    if (dirtyIds.size === 0) {
      toast?.('Aucune modification de quart a sauvegarder');
      return;
    }
    await saveAllDirtyShifts();
  };

  const handleApprove = async () => {
    const ok = await saveAllDirtyShifts();
    if (ok) {
      await onApprove?.();
    }
  };

  const handleGenerateInvoice = async () => {
    const ok = await saveAllDirtyShifts();
    if (ok) {
      await onGenerateInvoice?.();
    }
  };

  const removeShiftLine = async (shift) => {
    if (shift.is_new) {
      setEditableShifts(prev => prev.filter(row => row.id !== shift.id));
      setDirtyIds(prev => {
        const next = new Set(prev);
        next.delete(shift.id);
        return next;
      });
      return;
    }

    const snapshot = editableShifts.map(row => ({ ...row }));
    try {
      setSavingShiftId(shift.id);
      isSavingRef.current = true;
      setEditableShifts(prev => prev.filter(row => row.id !== shift.id));
      await api.deleteSchedule(shift.id);
      setDirtyIds(prev => {
        const next = new Set(prev);
        next.delete(shift.id);
        return next;
      });
      toast?.('Quart supprimé');
      await onRefreshParent?.();
    } catch (err) {
      setEditableShifts(snapshot);
      toast?.('Erreur: ' + (err.message || 'Échec de la suppression'));
    } finally {
      isSavingRef.current = false;
      setSavingShiftId(null);
    }
  };

  const saveQuickAccommodation = async () => {
    if (!accomForm.total_cost || !accomForm.start_date || !accomForm.end_date) return;
    try {
      setSavingAccommodation(true);
      await api.createAccommodation({
        employee_id: employee.id,
        total_cost: Number(accomForm.total_cost || 0),
        start_date: accomForm.start_date,
        end_date: accomForm.end_date,
        days_worked: 0,
        cost_per_day: 0,
        notes: accomForm.notes || '',
      });
      setAccomForm({ total_cost: '', start_date: '', end_date: '', notes: '' });
      toast?.('Hébergement ajouté');
      await loadAccommodations();
    } catch (err) {
      toast?.('Erreur: ' + (err.message || "Échec de l'ajout"));
    } finally {
      setSavingAccommodation(false);
    }
  };

  const accommodationEstimates = useMemo(
    () => (accommodations || [])
      .map(a => ({ ...a, estimate: computeAccommodationEstimate(a, allEmployeeSchedules, editableShifts) }))
      .filter(a => a.estimate.days > 0),
    [accommodations, allEmployeeSchedules, editableShifts]
  );

  const totals = useMemo(() => {
    const summary = editableShifts.reduce((acc, shift) => {
      const rate = getEffectiveShiftRate(shift, employee?.rate || 0);
      acc.service += Number(shift.hours || 0) * rate;
      acc.garde += (Number(shift.garde_hours || 0) / 8) * GARDE_RATE;
      acc.rappel += Number(shift.rappel_hours || 0) * rate;
      acc.km += Number(shift.km || 0) * RATE_KM;
      acc.dep += Number(shift.deplacement || 0) * rate;
      acc.autres += Number(shift.other_dep || 0);
      return acc;
    }, { service: 0, garde: 0, rappel: 0, km: 0, dep: 0, autres: 0 });

    const accom = accommodationEstimates.reduce((sum, a) => sum + Number(a.estimate.amount || 0), 0);
    const subtotal = summary.service + summary.garde + summary.rappel + summary.km + summary.dep + summary.autres + accom;
    const includeTax = !client?.tax_exempt;
    const tps = includeTax ? subtotal * TPS_RATE : 0;
    const tvq = includeTax ? subtotal * TVQ_RATE : 0;

    return {
      ...summary,
      accom,
      subtotal,
      tps,
      tvq,
      total: subtotal + tps + tvq,
    };
  }, [editableShifts, accommodationEstimates, client, employee]);

  const plannedHours = editableShifts.reduce((sum, shift) => sum + (Number(shift.hours) || 0), 0);
  const totalKm = editableShifts.reduce((sum, shift) => sum + (Number(shift.km) || 0), 0);
  const totalFrais = totals.km + totals.dep + totals.autres;
  const canGenerateInvoice = currentReview?.status === 'approved';
  const actionBusy = busy || savingAll;

  useEffect(() => {
    approvedHoursManualRef.current = Boolean(
      currentReview?.id &&
      Math.abs(Number(reviewDraft?.approvedHours || 0) - Number(plannedHours || 0)) > 0.009
    );
  }, [client?.id, currentReview?.id, employee?.id, plannedHours, reviewDraft?.approvedHours]);

  useEffect(() => {
    const currentApprovedHours = Number(reviewDraft?.approvedHours || 0);
    const shouldSync =
      !approvedHoursManualRef.current ||
      reviewDraft?.approvedHours === '' ||
      reviewDraft?.approvedHours == null;

    if (shouldSync && Math.abs(currentApprovedHours - Number(plannedHours || 0)) > 0.009) {
      setReviewDraft((draft) => ({
        ...draft,
        approvedHours: Number(Number(plannedHours || 0).toFixed(2)),
      }));
    }
  }, [plannedHours, reviewDraft?.approvedHours, setReviewDraft]);

  const openTimesheetDocument = async (attId) => {
    if (!currentTimesheet?.id || !attId) return;
    try {
      const attachment = (timesheetAttachments || []).find((item) => item.id === attId);
      await api.openTimesheetAttachment(
        currentTimesheet.id,
        attId,
        attachment?.original_filename || attachment?.filename || 'fdt'
      );
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const sectionCard = { background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #dfe7ea', boxShadow: '0 2px 12px rgba(16, 24, 40, 0.04)' };
  const editorCard = { background: '#f8fbfc', borderRadius: 12, padding: 16, border: '1px solid #e2ecef' };
  const tableWrap = { overflowX: 'auto' };
  const tableStyle = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, minWidth: 960 };
  const thStyle = { background: '#3f8391', color: '#fff', padding: '10px 6px', textAlign: 'left', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' };
  const tdStyle = { padding: '8px 4px', borderBottom: '1px solid #e8eef1', verticalAlign: 'middle', background: '#fff' };
  const inputStyle = { width: '100%', padding: '7px 10px', borderRadius: 10, border: '1px solid #d3dce2', fontSize: 12, background: '#fff', boxSizing: 'border-box' };
  const readOnlyInputStyle = { ...inputStyle, background: '#f4f7f8', color: '#44515c' };
  const getDirtyInputStyle = (isDirty, readOnly = false) => ({
    ...(readOnly ? readOnlyInputStyle : inputStyle),
    ...(isDirty ? { borderColor: '#e0b53b', background: readOnly ? '#fff7dc' : '#fffdf1' } : {}),
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-d)' }}>
          📋 Validation hebdomadaire — {employee?.name || ''} / {client?.name || 'Client'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
          {currentReview?.status ? `Statut: ${currentReview.status}` : 'Aucune approbation enregistrée'}
        </div>
      </div>

      {validationSummary && (
        <div style={{ ...sectionCard, marginBottom: 12, background: '#fcfefe' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Conciliation automatique</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                Confiance <strong>{validationSummary.confidence_level || 'moyen'}</strong> ({Math.round(Number(validationSummary.confidence_score || 0) * 100)}%)
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge" style={{ background: '#eef7ff', color: '#1d4f91' }}>
                FDT: {validationSummary.timesheet_id ? `${validationSummary.timesheet_attachment_count || 0} doc` : 'manquante'}
              </span>
              <span className="badge" style={{ background: '#f5f5ff', color: '#5546b3' }}>
                Facture: {validationSummary.invoice_id ? (validationSummary.invoice_number || 'generee') : 'non generee'}
              </span>
              <span className="badge" style={{ background: '#effaf2', color: '#1f7a3f' }}>
                Hebergement: {fmtMoney(validationSummary.accommodation_amount || 0)}
              </span>
            </div>
          </div>

          {!!validationSummary.flags?.length && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {validationSummary.flags.map((flag) => (
                <span key={flag} className="badge" style={{ background: '#f4f7f8', color: '#35515a' }}>
                  {String(flag).replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, fontSize: 11 }}>
            <div style={{ background: '#f7fafb', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ color: 'var(--text3)' }}>Horaire vs FDT</div>
              <strong>
                {validationSummary.timesheet_id
                  ? (validationSummary.timesheet_hours == null
                    ? `${Number(validationSummary.scheduled_hours || 0).toFixed(2)} h / document recu`
                    : `${Number(validationSummary.scheduled_hours || 0).toFixed(2)} h / ${Number(validationSummary.timesheet_hours || 0).toFixed(2)} h`)
                  : 'FDT manquante'}
              </strong>
            </div>
            <div style={{ background: '#f7fafb', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ color: 'var(--text3)' }}>Orientation</div>
              <strong>{validationSummary.orientation_shift_count || 0} quart(s) a verifier</strong>
            </div>
            <div style={{ background: '#f7fafb', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ color: 'var(--text3)' }}>Prochaine action</div>
              <strong>{validationSummary.recommendations?.[0] || 'Verification finale'}</strong>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
        <div style={sectionCard}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Quarts</div><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)' }}>{editableShifts.length}</div></div>
        <div style={sectionCard}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Heures affichées</div><div style={{ fontSize: 16, fontWeight: 700 }}>{plannedHours.toFixed(2)} h</div></div>
        <div style={sectionCard}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Kilométrage</div><div style={{ fontSize: 16, fontWeight: 700 }}>{totalKm.toFixed(0)} km</div></div>
        <div style={sectionCard}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Frais estimés</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtMoney(totalFrais)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'start', marginBottom: 12 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={editorCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#2A7B88' }}>📋 Quarts / Services</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Heures au format 24 h, par exemple 07:00 ou 15:30.</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={addQuickShiftRow}>+ Ajouter quart</button>
            </div>

            {editableShifts.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: 12 }}>Aucun quart à modifier</div>
            ) : (
              <div style={tableWrap}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {['DATE', 'DÉBUT', 'FIN', 'PAUSE (MIN)', 'HEURES', 'ORIENTATION', 'TAUX', 'GARDE H', 'RAPPEL H', ''].map(header => (
                        <th key={header} style={thStyle}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {editableShifts.map(shift => {
                      const rowDirty = dirtyIds.has(shift.id);
                      return (
                        <tr key={shift.id}>
                          <td style={tdStyle}><input className="input" type="date" style={getDirtyInputStyle(rowDirty)} value={shift.date || ''} onChange={e => updateEditableShift(shift.id, 'date', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="time" step="60" lang="fr-CA" style={getDirtyInputStyle(rowDirty)} value={shift.start || ''} onChange={e => updateEditableShift(shift.id, 'start', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="time" step="60" lang="fr-CA" style={getDirtyInputStyle(rowDirty)} value={shift.end || ''} onChange={e => updateEditableShift(shift.id, 'end', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="number" step="1" style={getDirtyInputStyle(rowDirty)} value={shift.pause_minutes || 0} onChange={e => updateEditableShift(shift.id, 'pause_minutes', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="number" step="0.25" style={getDirtyInputStyle(rowDirty, true)} value={Number(shift.hours || 0).toFixed(2)} readOnly /></td>
                          <td style={tdStyle}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                              <input
                                type="checkbox"
                                checked={Boolean(shift.is_orientation)}
                                onChange={e => updateEditableShift(shift.id, 'is_orientation', e.target.checked)}
                              />
                              Orientation
                            </label>
                          </td>
                          <td style={tdStyle}><input className="input" type="number" step="0.01" style={getDirtyInputStyle(rowDirty, Boolean(shift.is_orientation))} value={shift.is_orientation ? 0 : (shift.billable_rate || 0)} readOnly={Boolean(shift.is_orientation)} onChange={e => updateEditableShift(shift.id, 'billable_rate', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="number" step="0.5" style={getDirtyInputStyle(rowDirty)} value={shift.garde_hours || 0} onChange={e => updateEditableShift(shift.id, 'garde_hours', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="number" step="0.5" style={getDirtyInputStyle(rowDirty)} value={shift.rappel_hours || 0} onChange={e => updateEditableShift(shift.id, 'rappel_hours', e.target.value)} /></td>
                          <td style={{ ...tdStyle, width: 54, textAlign: 'center' }}>
                            <button className="btn btn-outline btn-sm" style={{ padding: '6px 8px', color: '#DC3545', borderColor: '#DC3545' }} onClick={() => removeShiftLine(shift)} disabled={savingShiftId === shift.id || savingAll}>
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={editorCard}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2A7B88', marginBottom: 10 }}>💲 Frais / Notes</div>
            {editableShifts.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: 12 }}>Aucun frais lié à des quarts</div>
            ) : (
              <div style={tableWrap}>
                <table style={{ ...tableStyle, minWidth: 760 }}>
                  <thead>
                    <tr>
                      {['DATE', 'KM', 'DÉPLACEMENT H', 'AUTRE $', 'NOTES'].map(header => (
                        <th key={header} style={thStyle}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {editableShifts.map(shift => {
                      const rowDirty = dirtyIds.has(shift.id);
                      return (
                        <tr key={`${shift.id}-expenses`}>
                          <td style={tdStyle}><input className="input" type="date" style={getDirtyInputStyle(rowDirty, true)} value={shift.date || ''} readOnly /></td>
                          <td style={tdStyle}><input className="input" type="number" step="1" style={getDirtyInputStyle(rowDirty)} value={shift.km || 0} onChange={e => updateEditableShift(shift.id, 'km', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="number" step="0.25" style={getDirtyInputStyle(rowDirty)} value={shift.deplacement || 0} onChange={e => updateEditableShift(shift.id, 'deplacement', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="number" step="0.01" style={getDirtyInputStyle(rowDirty)} value={shift.other_dep || 0} onChange={e => updateEditableShift(shift.id, 'other_dep', e.target.value)} /></td>
                          <td style={tdStyle}><input className="input" type="text" style={getDirtyInputStyle(rowDirty)} value={shift.notes || ''} onChange={e => updateEditableShift(shift.id, 'notes', e.target.value)} placeholder="Notes du quart" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div style={sectionCard}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Résumé estimatif</div>
          <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Services</span><strong>{fmtMoney(totals.service)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Garde</span><strong>{fmtMoney(totals.garde)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Rappel</span><strong>{fmtMoney(totals.rappel)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Kilométrage</span><strong>{fmtMoney(totals.km)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Déplacement</span><strong>{fmtMoney(totals.dep)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Autres frais</span><strong>{fmtMoney(totals.autres)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Hébergement</span><strong>{fmtMoney(totals.accom)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTop: '1px solid #dde5e8', fontSize: 13 }}><span>Sous-total</span><strong>{fmtMoney(totals.subtotal)}</strong></div>
            {!client?.tax_exempt && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TPS</span><strong>{fmtMoney(totals.tps)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TVQ</span><strong>{fmtMoney(totals.tvq)}</strong></div>
              </>
            )}
            {client?.tax_exempt && <div style={{ fontSize: 11, color: '#28A745', paddingTop: 4 }}>Client exempté de taxes</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 16, padding: '12px 14px', marginTop: 12, background: '#2A7B88', color: '#fff', borderRadius: 10 }}>
            <span>Total estimé</span>
            <strong>{fmtMoney(totals.total)}</strong>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={sectionCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Hébergement lié à la semaine</div>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>{loadingAccommodations ? 'Chargement…' : `${accommodationEstimates.length} ligne(s)`}</div>
          </div>
          {accommodationEstimates.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>Aucun hébergement trouvé pour cette semaine.</div>
          ) : (
            <div>
              {accommodationEstimates.map(a => (
                <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr .7fr .8fr .8fr', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                  <span>{a.start_date} → {a.end_date}</span>
                  <span>{a.estimate.days} jour(s)</span>
                  <span>{fmtMoney(a.estimate.costPerDay)}/jour</span>
                  <strong>{fmtMoney(a.estimate.amount)}</strong>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 8, paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Ajout rapide hébergement</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr auto', gap: 6 }}>
              <input className="input" type="date" style={{ padding: '6px 8px', fontSize: 12 }} value={accomForm.start_date} onChange={e => setAccomForm(f => ({ ...f, start_date: e.target.value }))} />
              <input className="input" type="date" style={{ padding: '6px 8px', fontSize: 12 }} value={accomForm.end_date} onChange={e => setAccomForm(f => ({ ...f, end_date: e.target.value }))} />
              <input className="input" type="number" step="0.01" style={{ padding: '6px 8px', fontSize: 12 }} placeholder="Coût total" value={accomForm.total_cost} onChange={e => setAccomForm(f => ({ ...f, total_cost: e.target.value }))} />
              <input className="input" type="text" style={{ padding: '6px 8px', fontSize: 12 }} placeholder="Notes" value={accomForm.notes} onChange={e => setAccomForm(f => ({ ...f, notes: e.target.value }))} />
              <button className="btn btn-outline btn-sm" onClick={saveQuickAccommodation} disabled={savingAccommodation}>{savingAccommodation ? '...' : 'Ajouter'}</button>
            </div>
          </div>
        </div>

        <div style={sectionCard}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Approbation / justificatifs</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text3)' }}>Heures approuvées</label>
              <input className="input" type="number" step="0.25" value={reviewDraft.approvedHours} onChange={e => {
                const nextValue = e.target.value;
                const numericValue = Number(nextValue || 0);
                approvedHoursManualRef.current = nextValue !== '' && Math.abs(numericValue - Number(plannedHours || 0)) > 0.009;
                setReviewDraft(d => ({ ...d, approvedHours: nextValue }));
              }} />
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                Laisser la meme valeur que les heures affichees si aucun ajustement manuel n'est requis.
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text3)' }}>Notes</label>
              <input className="input" value={reviewDraft.notes} onChange={e => setReviewDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes de vérification" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {dirtyIds.size > 0 && <div style={{ fontSize: 11, color: '#856404', background: '#fff3cd', border: '1px solid #ffe69c', padding: '4px 10px', borderRadius: 6, display: 'flex', alignItems: 'center' }}>⚠️ {dirtyIds.size} modification(s) non sauvegardée(s)</div>}
              <button className="btn btn-outline btn-sm" onClick={handleEnregistrer} disabled={actionBusy}>{actionBusy ? '⏳ Sauvegarde…' : 'Sauvegarder'}</button>
              <button className="btn btn-primary btn-sm" style={{ background: currentReview?.status === 'approved' ? '#28A745' : undefined }} onClick={handleApprove} disabled={!editableShifts.length || actionBusy}>{actionBusy ? '⏳…' : 'Approuver les heures'}</button>
              <button className="btn btn-outline btn-sm" onClick={onRevoke} disabled={!currentReview || busy}>Révoquer</button>
              <button className="btn btn-primary btn-sm" onClick={handleGenerateInvoice} disabled={!canGenerateInvoice || actionBusy}>Générer la facture approuvée</button>
            <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>Ajouter justificatif<input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif" style={{ display: 'none' }} onChange={onUpload} /></label>
            {currentInvoice && <button className="btn btn-outline btn-sm" onClick={onGoInvoices}>Voir dans Facturation</button>}
          </div>

          {!canGenerateInvoice && <div style={{ fontSize: 11, color: '#856404', background: '#fff3cd', border: '1px solid #ffe69c', padding: '8px 10px', borderRadius: 8, marginBottom: 10 }}>Approuve la semaine avant de générer la facture approuvée.</div>}
          {currentInvoice && <div style={{ background: '#eef7ff', border: '1px solid #c7e1ff', borderRadius: 8, padding: 10, marginBottom: 12 }}><div style={{ fontSize: 11, color: 'var(--text3)' }}>Facture générée</div><div style={{ fontWeight: 700 }}>{currentInvoice.number} — {fmtMoney(currentInvoice.total || 0)}</div></div>}

          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>FDT indexee ({timesheetAttachments.length})</div>
          {timesheetAttachments.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
              {currentTimesheet?.id ? 'Aucune piece jointe FDT sur cette periode.' : 'Aucune FDT indexee pour cette periode.'}
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              {timesheetAttachments.map(att => (
                <div key={`timesheet-${att.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                  <span>{att.original_filename || att.filename}</span>
                  <button className="btn btn-outline btn-sm" style={{ padding: '2px 8px' }} onClick={() => openTimesheetDocument(att.id)}><Eye size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Justificatifs ({reviewAttachments.length})</div>
          {reviewAttachments.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Aucune pièce jointe</div>
          ) : reviewAttachments.map(att => (
            <div key={att.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
              <span>{att.filename}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm" style={{ padding: '2px 8px' }} onClick={() => onOpenAttachment(att.id)}><Eye size={12} /></button>
                <button className="btn btn-outline btn-sm" style={{ padding: '2px 8px' }} onClick={() => onDeleteAttachment(att.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
