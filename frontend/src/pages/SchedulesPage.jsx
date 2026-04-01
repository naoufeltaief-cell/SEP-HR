import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { fmtDay, fmtISO, fmtMoney, getWeekDates, getMonthDates, DAYS, RATE_KM } from '../utils/helpers';
import { Avatar, Modal } from '../components/UI';
import { ChevronLeft, ChevronRight, Plus, Send, Calendar, Search, FileText, MapPin, DollarSign, Truck, CalendarRange, Trash2 } from 'lucide-react';

const MONTHS_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MONTHS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const LOCATIONS = ["CH de Rouyn-Noranda", "Villa des Brises", "CLSC de Grande-Vallée-Gaspésie", "CSSS de Sept-Iles", "Dispensaire de Baie-Johan-Beetz", "Bureau Soins Expert Plus", "Centre Multi Services de Havre-Saint-Pierre", "CISSS des Îles", "CHSLD de New Carlisle", "La Balise (Bonaventure)", "Hôpital de Matane", "CHSLD Ville-Marie (Abitibi)", "Hôpital de Notre-Dame-du-Lac", "Hôpital de Gaspésie", "Centre de santé Basse Côte-Nord", "CH régional du Grand-Portage", "Résidence Plaisance - CISSS des Îles", "Forestville, QC", "CHSLD de Sept-Îles", "CHSLD – Pavillon Eudore-Labrie", "CHSLD de Chauffailles", "CHSLD SEPT ILES", "CHSLD de Senneterre", "CHSLD de Cap-Chat", "CHSLD Mgr-Ross", "CHSLD RIMOUSKI", "CHSLD BASQUES", "Centre de Santé et de Services sociaux de Sept-Iles", "Centre hospitalier régional du Grand-Portage", "Centre de santé de la Basse Côte-Nord - Blanc sablon", "Hôpital régional de Rimouski", "CRSSS de la Baie-James", "CISSS de la Gaspésie", "CISSS de la Côte-Nord", "Baie-Comeau", "Les Escoumins", "AIDE A DOMICILE", "Centre Jeunesse Sept Iles", "CHSLD St-Eusèbe", "CHSLD Villa Maria", "CHSLD de Val-d'Or", "CH MARIA // CISSS de la Gaspésie", "CRDI AMOS", "CHSLD de Rigaud", "CHSLD Désy"];
const PAUSE_OPTIONS = [{ value: '0', label: 'Aucune' }, { value: '0.25', label: '15 min' }, { value: '0.5', label: '30 min' }, { value: '0.75', label: '45 min' }, { value: '1', label: '1 heure' }, { value: 'custom', label: 'Personnalisée...' }];
const RECURRENCE_OPTIONS = [{ value: 'once', label: 'Une seule fois' }, { value: 'daily', label: 'Chaque jour' }, { value: 'weekdays', label: 'Lundi au vendredi' }, { value: 'custom', label: 'Jours spécifiques...' }];

function calcHours(start, end, pause = 0) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let startMin = sh * 60 + sm, endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, Math.round(((endMin - startMin) / 60 - pause) * 100) / 100);
}
function getRecurrenceDates(startDate, mode, endDate, customDays = []) {
  if (mode === 'once') return [startDate];
  if (!endDate) return [startDate];
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  if (end < start) return [startDate];
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    const iso = fmtISO(cur);
    const dow = cur.getDay();
    if (mode === 'daily') dates.push(iso);
    else if (mode === 'weekdays' && dow >= 1 && dow <= 5) dates.push(iso);
    else if (mode === 'custom' && customDays.includes(dow)) dates.push(iso);
    cur.setDate(cur.getDate() + 1);
    if (dates.length > 60) break;
  }
  return dates.length ? dates : [startDate];
}

export default function SchedulesPage({ toast, onNavigate }) {
  const [schedules, setSchedules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [viewMode, setViewMode] = useState('week');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filterText, setFilterText] = useState('');
  const [modal, setModal] = useState(null);
  const [empDetail, setEmpDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState([]);
  const [expandedEmp, setExpandedEmp] = useState(null);
  const [reviewDraft, setReviewDraft] = useState({ approvedHours: 0, notes: '' });
  const [reviewAttachments, setReviewAttachments] = useState([]);
  const [currentReview, setCurrentReview] = useState(null);
  const [currentInvoice, setCurrentInvoice] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [scheds, emps, cls, reviews] = await Promise.all([
        api.getSchedules(),
        api.getEmployees(),
        api.getClients(),
        api.getScheduleReviews().catch(() => []),
      ]);
      setSchedules(scheds || []);
      setEmployees(emps || []);
      setClients(cls || []);
      setApprovals(reviews || []);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { reload(); }, [reload]);

  const viewDates = useMemo(() => {
    if (viewMode === 'week') return getWeekDates(selectedDate, 0);
    if (viewMode === 'month') return getMonthDates(selectedDate);
    return [];
  }, [viewMode, selectedDate]);
  const viewISOs = useMemo(() => viewDates.map(fmtISO), [viewDates]);

  const activeEmpIds = useMemo(() => {
    if (viewMode === 'year') {
      const y = String(selectedDate.getFullYear());
      return [...new Set(schedules.filter(s => s.date.startsWith(y)).map(s => s.employee_id))];
    }
    return [...new Set(schedules.filter(s => viewISOs.includes(s.date)).map(s => s.employee_id))];
  }, [schedules, viewISOs, viewMode, selectedDate]);

  const activeEmps = useMemo(() => {
    let emps = employees.filter(e => activeEmpIds.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name));
    if (filterText) {
      const q = filterText.toLowerCase();
      emps = emps.filter(e => (e.name.toLowerCase() + ' ' + (e.position || '').toLowerCase()).includes(q));
    }
    return emps;
  }, [employees, activeEmpIds, filterText]);
  const otherEmps = useMemo(() => employees.filter(e => !activeEmpIds.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name)), [employees, activeEmpIds]);

  const navigate = (dir) => setSelectedDate(d => {
    const n = new Date(d);
    if (viewMode === 'week') n.setDate(n.getDate() + dir * 7);
    else if (viewMode === 'month') n.setMonth(n.getMonth() + dir);
    else n.setFullYear(n.getFullYear() + dir);
    return n;
  });
  const goToDate = (dateStr) => { if (dateStr) setSelectedDate(new Date(dateStr + 'T12:00:00')); };
  const periodLabel = useMemo(() => {
    if (viewMode === 'week' && viewDates.length >= 7) return `${fmtDay(viewDates[0])} — ${fmtDay(viewDates[6])}`;
    if (viewMode === 'month') return `${MONTHS_FULL[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
    return `Année ${selectedDate.getFullYear()}`;
  }, [viewMode, viewDates, selectedDate]);

  const getWeekStart = () => (viewMode === 'week' && viewDates.length >= 7 ? fmtISO(viewDates[0]) : null);
  const getWeekEnd = () => (viewMode === 'week' && viewDates.length >= 7 ? fmtISO(viewDates[6]) : null);
  const getWeekApprovalStatus = (employeeId, clientId) => approvals.find(a => a.employee_id === employeeId && a.client_id === clientId && a.week_start === getWeekStart());

  const getEmployeeClientIds = (employee, periodShifts) => {
    const ids = [...new Set(periodShifts.map(s => s.client_id).filter(Boolean))];
    if (ids.length) return ids;
    if (employee?.client_id) return [employee.client_id];
    return [];
  };
  const getClientWeekShifts = (employeeId, clientId, fallbackClientId = null) => schedules.filter(s => s.employee_id === employeeId && viewISOs.includes(s.date) && (s.client_id === clientId || (!s.client_id && fallbackClientId && fallbackClientId === clientId)));
  const getClientWeekHours = (employeeId, clientId, fallbackClientId = null) => getClientWeekShifts(employeeId, clientId, fallbackClientId).reduce((sum, s) => sum + (Number(s.hours) || 0), 0);

  const openAdd = (employeeId, date) => {
    const emp = employees.find(e => e.id === employeeId);
    setModal({ type: 'add', data: { employeeId: employeeId || '', date: date || fmtISO(viewDates[0] || new Date()), start: '07:00', end: '15:00', pause: 0.75, pauseMode: '0.75', pauseCustomMin: '', hours: 7.25, location: LOCATIONS[0], billableRate: emp?.rate || 0, status: 'draft', notes: '', clientId: emp?.client_id || 0, mandatStart: '', mandatEnd: '', km: 0, deplacement: 0, autreDep: 0, depNote: '', recurrence: 'once', recurrenceEnd: '', customDays: [] } });
  };
  const openEdit = (shift) => {
    const pauseVal = shift.pause || 0;
    const isCustom = ![0, 0.25, 0.5, 0.75, 1].includes(pauseVal) && pauseVal > 0;
    setModal({ type: 'edit', data: { ...shift, employeeId: shift.employee_id, billableRate: shift.billable_rate, clientId: shift.client_id || 0, mandatStart: shift.mandat_start || '', mandatEnd: shift.mandat_end || '', autreDep: shift.autre_dep || 0, depNote: shift.dep_note || '', pauseMode: isCustom ? 'custom' : String(pauseVal), pauseCustomMin: isCustom ? String(Math.round(pauseVal * 60)) : '' } });
  };

  const saveShift = async () => {
    const d = modal.data;
    if (!d.employeeId || !d.date) { toast?.('Remplir employé et date'); return; }
    try {
      if (modal.type === 'add') {
        const payload = { employee_id: Number(d.employeeId), date: d.date, start: d.start, end: d.end, hours: d.hours, pause: d.pause, location: d.location, billable_rate: d.billableRate || 0, status: d.status, notes: d.notes, client_id: d.clientId || null, km: d.km || 0, deplacement: d.deplacement || 0, autre_dep: d.autreDep || 0, mandat_start: d.mandatStart || null, mandat_end: d.mandatEnd || null, recurrence: d.recurrence, recurrence_end: d.recurrenceEnd || null, recurrence_days: d.recurrence === 'custom' ? d.customDays : null };
        const result = await api.createSchedule(payload);
        toast?.(`${result.created || 1} quart(s) ajouté(s)`);
      } else {
        await api.updateSchedule(d.id, { start: d.start, end: d.end, hours: d.hours, pause: d.pause, location: d.location, billable_rate: d.billableRate || 0, status: d.status, notes: d.notes, km: d.km || 0, deplacement: d.deplacement || 0, autre_dep: d.autreDep || 0, mandat_start: d.mandatStart || null, mandat_end: d.mandatEnd || null });
        toast?.('Quart modifié');
      }
      setModal(null);
      reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };
  const deleteShift = async () => {
    try {
      await api.deleteSchedule(modal.data.id);
      toast?.('Quart supprimé');
      setModal(null);
      reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };
  const publishAll = async () => {
    try {
      const res = await api.publishAll();
      toast?.(`${res.published} quart(s) publié(s)`);
      reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const loadReviewPanel = async (empId, clientId, fallbackClientId = null) => {
    const ws = getWeekStart();
    const we = getWeekEnd();
    if (!ws || !we || !empId || !clientId) return;
    setBillingLoading(true);
    setExpandedEmp({ empId, clientId, fallbackClientId });
    setCurrentReview(null);
    setCurrentInvoice(null);
    setReviewAttachments([]);
    const plannedHours = Number(getClientWeekHours(empId, clientId, fallbackClientId).toFixed(2));
    setReviewDraft({ approvedHours: plannedHours, notes: '' });
    try {
      const [reviews, invoices] = await Promise.all([
        api.getScheduleReviews({ employee_id: empId, client_id: clientId, week_start: ws }),
        api.getInvoices({ employee_id: empId, client_id: clientId, period_start: ws, period_end: we }),
      ]);
      const review = (reviews || [])[0] || null;
      const invoice = (invoices || [])[0] || null;
      setCurrentReview(review);
      setCurrentInvoice(invoice);
      if (review?.id) {
        setReviewDraft({ approvedHours: Number(review.approved_hours || plannedHours), notes: review.notes || '' });
        const att = await api.getScheduleReviewAttachments(review.id).catch(() => []);
        setReviewAttachments(att || []);
      }
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setBillingLoading(false);
    }
  };

  const toggleBillingPanel = async (empId, clientId, fallbackClientId = null) => {
    if (!empId || !clientId) return;
    if (expandedEmp?.empId === empId && expandedEmp?.clientId === clientId) {
      setExpandedEmp(null);
      return;
    }
    await loadReviewPanel(empId, clientId, fallbackClientId);
  };

  const saveReview = async (empId, clientId, fallbackClientId = null, approve = false) => {
    const ws = getWeekStart();
    if (!ws || !empId || !clientId) return;
    try {
      setBillingLoading(true);
      const approvedHours = Number(reviewDraft?.approvedHours || getClientWeekHours(empId, clientId, fallbackClientId) || 0);
      const notes = reviewDraft?.notes || '';
      const review = approve
        ? await api.approveReviewedWeek({ employee_id: empId, client_id: clientId, week_start: ws, approved_hours: approvedHours, notes })
        : await api.reviewWeek({ employee_id: empId, client_id: clientId, week_start: ws, approved_hours: approvedHours, notes });
      setCurrentReview(review || null);
      setApprovals(prev => {
        const rest = prev.filter(a => !(a.employee_id === empId && a.client_id === clientId && a.week_start === ws));
        return review ? [review, ...rest] : rest;
      });
      if (review?.id) {
        const att = await api.getScheduleReviewAttachments(review.id).catch(() => []);
        setReviewAttachments(att || []);
      }
      toast?.(approve ? 'Heures approuvées' : 'Révision enregistrée');
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setBillingLoading(false);
    }
  };

  const revokeWeek = async (employeeId, clientId) => {
    const ws = getWeekStart();
    if (!ws || !employeeId || !clientId) return;
    try {
      await api.revokeReviewedWeek({ employee_id: employeeId, client_id: clientId, week_start: ws });
      toast?.('Approbation révoquée');
      reload();
      if (expandedEmp?.empId === employeeId && expandedEmp?.clientId === clientId) {
        setCurrentReview(r => r ? { ...r, status: 'rejected' } : r);
      }
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const handleReviewAttachment = async (e, empId, clientId, fallbackClientId = null) => {
    const file = e.target.files?.[0];
    if (!file || !empId || !clientId) return;
    try {
      let review = currentReview;
      if (!review?.id) {
        review = await api.reviewWeek({ employee_id: empId, client_id: clientId, week_start: getWeekStart(), approved_hours: Number(reviewDraft?.approvedHours || getClientWeekHours(empId, clientId, fallbackClientId) || 0), notes: reviewDraft?.notes || '' });
        setCurrentReview(review || null);
      }
      if (!review?.id) throw new Error('Révision introuvable');
      await api.uploadScheduleReviewAttachment(review.id, file, 'justificatif', file.name);
      const att = await api.getScheduleReviewAttachments(review.id);
      setReviewAttachments(att || []);
      toast?.('Justificatif ajouté');
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };

  const deleteReviewAttachment = async (attId) => {
    if (!currentReview?.id || !attId) return;
    try {
      await api.deleteScheduleReviewAttachment(currentReview.id, attId);
      const att = await api.getScheduleReviewAttachments(currentReview.id);
      setReviewAttachments(att || []);
      toast?.('Justificatif supprimé');
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const generateInvoice = async (empId, clientId) => {
    const ws = getWeekStart();
    const we = getWeekEnd();
    if (!ws || !we || !empId || !clientId) return;
    try {
      setBillingLoading(true);
      const result = await api.generateFromSchedules({ employee_id: empId, client_id: clientId, period_start: ws, period_end: we });
      setCurrentInvoice(result || null);
      toast?.(`Facture ${result.number} générée`);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setBillingLoading(false);
    }
  };

  const generateAllApproved = async () => {
    const ws = getWeekStart();
    const we = getWeekEnd();
    if (!ws || !we) return;
    try {
      setBulkLoading(true);
      const result = await api.generateAllApprovedInvoices({ period_start: ws, period_end: we });
      toast?.(`${result.count || 0} facture(s) approuvée(s) générée(s)`);
      if ((result.count || 0) > 0 && onNavigate) onNavigate('invoices');
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setBulkLoading(false);
    }
  };

  const updateField = (key, val) => {
    setModal(m => {
      const newData = { ...m.data, [key]: val };
      if (['start', 'end', 'pause'].includes(key)) {
        const p = key === 'pause' ? val : newData.pause;
        const s = key === 'start' ? val : newData.start;
        const e = key === 'end' ? val : newData.end;
        newData.hours = calcHours(s, e, p);
      }
      return { ...m, data: newData };
    });
  };
  const handlePauseChange = (mode) => {
    if (mode === 'custom') updateField('pauseMode', 'custom');
    else {
      const val = parseFloat(mode) || 0;
      setModal(m => {
        const newData = { ...m.data, pauseMode: mode, pauseCustomMin: '', pause: val };
        newData.hours = calcHours(newData.start, newData.end, val);
        return { ...m, data: newData };
      });
    }
  };
  const handleCustomPause = (mins) => {
    const pauseHours = Math.round((parseFloat(mins) || 0) / 60 * 100) / 100;
    setModal(m => {
      const newData = { ...m.data, pauseCustomMin: mins, pause: pauseHours };
      newData.hours = calcHours(newData.start, newData.end, pauseHours);
      return { ...m, data: newData };
    });
  };
  const handleEmployeeChange = (empId) => {
    const emp = employees.find(e => e.id === Number(empId));
    setModal(m => ({ ...m, data: { ...m.data, employeeId: Number(empId), employee_id: Number(empId), billableRate: emp?.rate || m.data.billableRate || 0, clientId: emp?.client_id || 0 } }));
  };
  const recurrencePreview = useMemo(() => {
    if (!modal || modal.type !== 'add') return '';
    const { date, recurrence, recurrenceEnd, customDays } = modal.data;
    if (!date) return 'Sélectionnez une date de début.';
    if (recurrence === 'once') return `Un seul quart le ${date}`;
    if (!recurrenceEnd) return 'Sélectionnez une date de fin pour la récurrence.';
    const dates = getRecurrenceDates(date, recurrence, recurrenceEnd, customDays);
    const labels = { daily: 'Chaque jour', weekdays: 'Lundi au vendredi', custom: 'Jours sélectionnés' };
    const preview = dates.length > 7 ? dates.slice(0, 5).join(', ') + `... +${dates.length - 5} autres` : dates.join(', ');
    return `${labels[recurrence] || recurrence} — du ${date} au ${recurrenceEnd} → ${dates.length} quart(s) (${preview})`;
  }, [modal]);
  const selectedClient = useMemo(() => modal ? clients.find(c => c.id === modal.data.clientId) : null, [modal, clients]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}><div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} /><style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>Chargement des horaires...</div>;

  return <>
    <div className="page-header">
      <h1 className="page-title"><Calendar size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />Horaires</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        {viewMode === 'week' && <button className="btn btn-outline btn-sm" onClick={generateAllApproved} disabled={bulkLoading}><FileText size={13} /> {bulkLoading ? 'Génération…' : 'Générer toutes les factures approuvées'}</button>}
        <button className="btn btn-outline btn-sm" onClick={publishAll}><Send size={13} /> Publier tout</button>
        <button className="btn btn-primary btn-sm" onClick={() => openAdd(employees[0]?.id, fmtISO(viewDates[0] || new Date()))}><Plus size={14} /> Ajouter</button>
      </div>
    </div>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate(-1)}><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 230, textAlign: 'center' }}>{periodLabel}</span>
          <button className="btn btn-outline btn-sm" onClick={() => navigate(1)}><ChevronRight size={16} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 8, padding: 2 }}>{['week', 'month', 'year'].map(m => <button key={m} className="btn btn-sm" style={{ background: viewMode === m ? 'var(--brand)' : 'transparent', color: viewMode === m ? '#fff' : 'var(--text2)', border: 'none' }} onClick={() => setViewMode(m)}>{{ week: 'Semaine', month: 'Mois', year: 'Année' }[m]}</button>)}</div>
          <input type="date" className="input" style={{ width: 150, padding: '5px 8px', fontSize: 12 }} value={fmtISO(selectedDate)} onChange={e => goToDate(e.target.value)} />
          <button className="btn btn-outline btn-sm" onClick={() => setSelectedDate(new Date())}>Aujourd'hui</button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ position: 'relative', maxWidth: 300 }}><Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} /><input className="input" style={{ paddingLeft: 32, padding: '7px 12px 7px 32px', fontSize: 12 }} placeholder="Rechercher un employé..." value={filterText} onChange={e => setFilterText(e.target.value)} /></div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{schedules.length} quarts · {employees.length} employés</div>
      </div>
    </div>

    {viewMode === 'year' ? <YearView schedules={schedules} employees={activeEmps} selectedDate={selectedDate} /> : <div className="schedule-grid"><table><thead><tr><th>Employé</th>{viewDates.map((d, i) => <th key={i} style={viewMode === 'month' ? { minWidth: 38, fontSize: 9, padding: '6px 2px' } : {}}>{viewMode === 'month' ? <>{DAYS[d.getDay()]}<br />{d.getDate()}</> : fmtDay(d)}</th>)}<th style={{ minWidth: 120, background: 'var(--brand-xl)' }}>Total</th></tr></thead><tbody>
      {activeEmps.length === 0 && <tr><td colSpan={viewDates.length + 2} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Aucun quart pour cette période</td></tr>}
      {activeEmps.map(e => {
        const periodShifts = schedules.filter(s => s.employee_id === e.id && viewISOs.includes(s.date));
        const totalHrs = periodShifts.reduce((sum, s) => sum + s.hours, 0);
        const totalKm = periodShifts.reduce((sum, s) => sum + (s.km || 0), 0);
        const totalDep = periodShifts.reduce((sum, s) => sum + (s.deplacement || 0) + (s.autre_dep || 0), 0);
        const totalFrais = totalDep + totalKm * RATE_KM;
        const empClientIds = getEmployeeClientIds(e, periodShifts);
        return <React.Fragment key={e.id}><tr><td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={e.name} size={30} /><div><div style={{ fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--brand-d)' }} onClick={(ev) => { ev.stopPropagation(); setEmpDetail(e); }} title="Voir le profil">{e.name}</div><div style={{ fontSize: 10, color: 'var(--text3)' }}>{(e.position || '').slice(0, 24)}</div></div></div></td>
          {viewDates.map((d, i) => { const iso = fmtISO(d); const shifts = schedules.filter(s => s.employee_id === e.id && s.date === iso); return <td key={i} style={{ cursor: 'pointer', minHeight: 40 }} onClick={(ev) => { if (ev.target === ev.currentTarget) openAdd(e.id, iso); }} title="Cliquer pour ajouter un quart">{shifts.map(s => <ShiftPill key={s.id} shift={s} onClick={() => openEdit(s)} />)}{shifts.length === 0 && <div style={{ opacity: .2, textAlign: 'center', fontSize: 16, lineHeight: '30px', color: 'var(--brand)' }} onMouseOver={ev => ev.currentTarget.style.opacity = 0.6} onMouseOut={ev => ev.currentTarget.style.opacity = 0.2}>+</div>}</td>; })}
          <td style={{ minWidth: 160, textAlign: 'center', verticalAlign: 'middle', background: 'var(--brand-xl)', borderLeft: '2px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand)' }}>{totalHrs.toFixed(1)}h</div>
            {totalFrais > 0 && <div style={{ fontSize: 10, color: 'var(--purple)', marginTop: 2 }}>{fmtMoney(totalFrais)} frais</div>}
            {totalKm > 0 && <div style={{ fontSize: 9, color: 'var(--text3)' }}>{totalKm} km</div>}
            {viewMode === 'week' && empClientIds.map(cid => {
              const appr = getWeekApprovalStatus(e.id, cid);
              const isApproved = appr && appr.status === 'approved';
              const cl = clients.find(c => c.id === cid);
              return <div key={cid} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>{(cl?.name || 'Client').slice(0, 18)}</div>
                <button style={{ display: 'block', width: '100%', padding: '2px 6px', fontSize: 9, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', background: isApproved ? '#28A745' : '#FFC107', color: isApproved ? '#fff' : '#000' }} onClick={() => isApproved ? revokeWeek(e.id, cid) : saveReview(e.id, cid, e.client_id || null, true)}>{isApproved ? '✓ Approuvé' : 'Approuver heures'}</button>
                <button style={{ display: 'block', width: '100%', padding: '2px 6px', fontSize: 9, fontWeight: 500, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: expandedEmp?.empId === e.id && expandedEmp?.clientId === cid ? 'var(--brand)' : 'var(--surface)', color: expandedEmp?.empId === e.id && expandedEmp?.clientId === cid ? '#fff' : 'var(--text2)' }} onClick={() => toggleBillingPanel(e.id, cid, e.client_id || null)}>📋 {expandedEmp?.empId === e.id && expandedEmp?.clientId === cid ? 'Fermer' : 'Détails'}</button>
              </div>; })}
          </td></tr>
          {viewMode === 'week' && expandedEmp?.empId === e.id && empClientIds.includes(expandedEmp?.clientId) && <tr><td colSpan={viewDates.length + 2} style={{ padding: 0 }}><div style={{ background: '#f0f9fa', borderTop: '2px solid var(--brand)', borderBottom: '2px solid var(--brand)', padding: '14px 18px' }}>{billingLoading ? <div style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>Chargement...</div> : <ApprovalPanel employee={e} client={clients.find(c => c.id === expandedEmp.clientId)} shifts={getClientWeekShifts(e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null)} reviewDraft={reviewDraft} setReviewDraft={setReviewDraft} currentReview={currentReview} currentInvoice={currentInvoice} reviewAttachments={reviewAttachments} onSave={() => saveReview(e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null, false)} onApprove={() => saveReview(e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null, true)} onRevoke={() => revokeWeek(e.id, expandedEmp.clientId)} onGenerateInvoice={() => generateInvoice(e.id, expandedEmp.clientId)} onUpload={(ev) => handleReviewAttachment(ev, e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null)} onDeleteAttachment={deleteReviewAttachment} onGoInvoices={() => onNavigate && onNavigate('invoices')} />}</div></td></tr>}
        </React.Fragment>; })}
      {otherEmps.length > 0 && viewMode === 'week' && <tr><td colSpan={viewDates.length + 2} style={{ padding: '8px 16px', background: 'var(--surface2)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span style={{ fontSize: 11, color: 'var(--text3)' }}>Ajouter un employé :</span>{otherEmps.slice(0, 20).map(e => <button key={e.id} className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => openAdd(e.id, fmtISO(viewDates[0]))}>{e.name.split(' ')[0]} {(e.name.split(' ').slice(-1)[0] || '')[0]}.</button>)}{otherEmps.length > 20 && <span style={{ fontSize: 10, color: 'var(--text3)' }}>+{otherEmps.length - 20} autres</span>}</div></td></tr>}
    </tbody></table></div>}

    {modal && <Modal title={modal.type === 'add' ? 'Nouveau quart' : `Modifier — ${employees.find(e => e.id === modal.data.employeeId)?.name || '?'}`} onClose={() => setModal(null)} wide>{/* modal content unchanged */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div className="field"><label>Employé</label><select className="input" value={modal.data.employeeId || ''} onChange={e => handleEmployeeChange(e.target.value)} disabled={modal.type === 'edit'}><option value="">Choisir...</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.position}</option>)}</select></div><div className="field"><label>Client (CISSS/CIUSSS)</label><select className="input" value={modal.data.clientId || 0} onChange={e => updateField('clientId', Number(e.target.value))}><option value={0}>— Aucun / Non assigné —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
      {selectedClient && <div style={{ background: 'var(--teal-l)', padding: '8px 12px', borderRadius: 'var(--r)', marginBottom: 12, fontSize: 11, color: 'var(--teal)' }}><div style={{ fontWeight: 600, marginBottom: 2 }}>🏥 {selectedClient.name}</div>{selectedClient.address && <div>📍 {selectedClient.address}</div>}{selectedClient.email && <div>📧 {selectedClient.email}</div>}{selectedClient.tax_exempt && <div style={{ marginTop: 4, fontWeight: 700, color: '#059669' }}>✅ Client exempté de taxes</div>}</div>}
      <div className="field"><label>Date</label><input type="date" className="input" value={modal.data.date} onChange={e => updateField('date', e.target.value)} /></div>
      {modal.type === 'add' && <div style={{ background: 'var(--brand-xl)', padding: '12px 14px', borderRadius: 'var(--r)', marginBottom: 16, border: '1px solid var(--brand-l)' }}><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand-d)', display: 'block', marginBottom: 8 }}><CalendarRange size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Récurrence du quart</label><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}><select className="input" style={{ fontSize: 12 }} value={modal.data.recurrence} onChange={e => updateField('recurrence', e.target.value)}>{RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><div className="field" style={{ margin: 0 }}><label style={{ fontSize: 10 }}>Jusqu'au (inclus)</label><input type="date" className="input" style={{ fontSize: 12 }} value={modal.data.recurrenceEnd} onChange={e => updateField('recurrenceEnd', e.target.value)} /></div></div>{modal.data.recurrence === 'custom' && <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>{DAYS.map((d, i) => <button key={i} className="btn btn-sm" style={{ background: modal.data.customDays.includes(i) ? 'var(--brand)' : 'var(--surface)', color: modal.data.customDays.includes(i) ? '#fff' : 'var(--text2)', border: '1px solid var(--border)', fontSize: 11, padding: '4px 8px' }} onClick={() => { const days = modal.data.customDays.includes(i) ? modal.data.customDays.filter(x => x !== i) : [...modal.data.customDays, i]; updateField('customDays', days); }}>{d}</button>)}</div>}<div style={{ fontSize: 11, color: 'var(--brand)', lineHeight: 1.4 }}>{recurrencePreview}</div></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}><div className="field"><label>Début</label><input type="time" className="input" value={modal.data.start} onChange={e => updateField('start', e.target.value)} /></div><div className="field"><label>Fin</label><input type="time" className="input" value={modal.data.end} onChange={e => updateField('end', e.target.value)} /></div><div className="field"><label>Pause repas</label><div style={{ display: 'flex', gap: 6 }}><select className="input" style={{ flex: 1 }} value={modal.data.pauseMode} onChange={e => handlePauseChange(e.target.value)}>{PAUSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{modal.data.pauseMode === 'custom' && <input type="number" className="input" style={{ width: 90, padding: '6px 8px', fontSize: 12 }} placeholder="min" min={0} max={480} step={1} value={modal.data.pauseCustomMin} onChange={e => handleCustomPause(e.target.value)} />}</div></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div className="field"><label>Heures nettes facturables</label><input type="number" className="input" min={0} max={24} step={0.25} value={modal.data.hours} onChange={e => updateField('hours', parseFloat(e.target.value) || 0)} style={{ background: 'var(--brand-xl)', fontWeight: 600 }} /></div><div className="field"><label>Calcul auto</label><div style={{ padding: '9px 14px', fontSize: 12, color: 'var(--brand)', background: 'var(--brand-xl)', borderRadius: 'var(--r)', fontWeight: 500 }}>{(() => { const brut = calcHours(modal.data.start, modal.data.end, 0); return `${brut.toFixed(2)}h brut − ${modal.data.pause}h pause = ${modal.data.hours}h net`; })()}</div></div></div>
      <div className="field"><label><MapPin size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Lieu de service</label><select className="input" value={modal.data.location} onChange={e => updateField('location', e.target.value)}>{LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div className="field"><label><DollarSign size={12} style={{ verticalAlign: 'text-bottom', marginRight: 2 }} />Taux facturable ($/h)</label><input type="number" className="input" value={modal.data.billableRate || ''} min={0} onChange={e => updateField('billableRate', parseFloat(e.target.value) || 0)} /></div><div className="field"><label>Statut</label><select className="input" value={modal.data.status} onChange={e => updateField('status', e.target.value)}><option value="draft">Brouillon</option><option value="published">Publié</option></select></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div className="field"><label><FileText size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Début de mandat</label><input type="date" className="input" value={modal.data.mandatStart} onChange={e => updateField('mandatStart', e.target.value)} /></div><div className="field"><label>Fin de mandat</label><input type="date" className="input" value={modal.data.mandatEnd} onChange={e => updateField('mandatEnd', e.target.value)} /></div></div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}><Truck size={13} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Dépenses associées au quart</label><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}><div className="field" style={{ margin: 0 }}><label style={{ fontSize: 10 }}>Kilométrage (km)</label><input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={modal.data.km} min={0} step={1} onChange={e => updateField('km', parseFloat(e.target.value) || 0)} /></div><div className="field" style={{ margin: 0 }}><label style={{ fontSize: 10 }}>Frais déplacement ($)</label><input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={modal.data.deplacement} min={0} step={0.01} onChange={e => updateField('deplacement', parseFloat(e.target.value) || 0)} /></div><div className="field" style={{ margin: 0 }}><label style={{ fontSize: 10 }}>Autre dépense ($)</label><input type="number" className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={modal.data.autreDep} min={0} step={0.01} onChange={e => updateField('autreDep', parseFloat(e.target.value) || 0)} /></div></div>{(modal.data.km > 0 || modal.data.deplacement > 0 || modal.data.autreDep > 0) && <div style={{ background: 'var(--purple-l)', padding: '6px 10px', borderRadius: 'var(--r)', fontSize: 11, color: 'var(--purple)', marginTop: 6, fontWeight: 500 }}>Total dépenses : {fmtMoney(modal.data.km * RATE_KM + modal.data.deplacement + modal.data.autreDep)}</div>}</div>
      <div className="field" style={{ marginTop: 12 }}><label>Notes du quart</label><textarea className="input" rows={2} style={{ resize: 'vertical' }} value={modal.data.notes} onChange={e => updateField('notes', e.target.value)} placeholder="Optionnel..." /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>Annuler</button>{modal.type === 'edit' && <button className="btn btn-danger" onClick={deleteShift}>Supprimer</button>}<button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveShift}>{modal.type === 'add' ? 'Ajouter le quart' : 'Sauvegarder'}</button></div>
    </Modal>}

    {empDetail && <Modal title={empDetail.name} onClose={() => setEmpDetail(null)}><div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}><Avatar name={empDetail.name} size={56} /><div><div style={{ fontSize: 18, fontWeight: 700 }}>{empDetail.name}</div><div style={{ fontSize: 13, color: 'var(--text2)' }}>{empDetail.position}</div></div></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, fontSize: 13 }}><div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Taux horaire</span><div style={{ fontWeight: 600 }}>{empDetail.rate ? fmtMoney(empDetail.rate) + '/h' : '—'}</div></div><div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Courriel</span><div>{empDetail.email || '—'}</div></div><div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Téléphone</span><div>{empDetail.phone || '—'}</div></div><div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Heures (période)</span><div style={{ fontWeight: 700, color: 'var(--brand)' }}>{schedules.filter(s => s.employee_id === empDetail.id).reduce((sum, s) => sum + s.hours, 0).toFixed(1)}h</div></div></div><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEmpDetail(null)}>Fermer</button><button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setEmpDetail(null); if (onNavigate) onNavigate('employees'); }}>Voir profil complet →</button></div></Modal>}
  </>;
}

function ApprovalPanel({ employee, client, shifts, reviewDraft, setReviewDraft, currentReview, currentInvoice, reviewAttachments, onSave, onApprove, onRevoke, onGenerateInvoice, onUpload, onDeleteAttachment, onGoInvoices }) {
  const plannedHours = shifts.reduce((sum, s) => sum + (Number(s.hours) || 0), 0);
  const totalKm = shifts.reduce((sum, s) => sum + (s.km || 0), 0);
  const totalDep = shifts.reduce((sum, s) => sum + (s.deplacement || 0) + (s.autre_dep || 0), 0);
  return <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-d)' }}>📋 Validation hebdomadaire — {employee?.name || ''} / {client?.name || 'Client'}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{currentReview?.status ? `Statut: ${currentReview.status}` : 'Aucune approbation enregistrée'}</div></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Quarts</div><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)' }}>{shifts.length}</div></div><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Heures affichées</div><div style={{ fontSize: 16, fontWeight: 700 }}>{plannedHours.toFixed(2)}h</div></div><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Kilométrage</div><div style={{ fontSize: 16, fontWeight: 700 }}>{totalKm} km</div></div><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Frais</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtMoney(totalDep + totalKm * RATE_KM)}</div></div></div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}><div><label style={{ fontSize: 11, color: 'var(--text3)' }}>Heures approuvées</label><input className="input" type="number" step="0.25" value={reviewDraft.approvedHours} onChange={e => setReviewDraft(d => ({ ...d, approvedHours: e.target.value }))} /></div><div><label style={{ fontSize: 11, color: 'var(--text3)' }}>Notes / pièces justificatives</label><input className="input" value={reviewDraft.notes} onChange={e => setReviewDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes de vérification" /></div></div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}><button className="btn btn-outline btn-sm" onClick={onSave}>Enregistrer</button><button className="btn btn-primary btn-sm" onClick={onApprove} disabled={!shifts.length}>Approuver les heures</button><button className="btn btn-outline btn-sm" onClick={onRevoke} disabled={!currentReview}>Révoquer</button><button className="btn btn-primary btn-sm" onClick={onGenerateInvoice} disabled={currentReview?.status !== 'approved'}>Générer la facture approuvée</button><label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>Ajouter justificatif<input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif" style={{ display: 'none' }} onChange={onUpload} /></label>{currentInvoice && <button className="btn btn-outline btn-sm" onClick={onGoInvoices}>Voir dans Facturation</button>}</div>
    {currentInvoice && <div style={{ background: '#eef7ff', border: '1px solid #c7e1ff', borderRadius: 8, padding: 10, marginBottom: 12 }}><div style={{ fontSize: 11, color: 'var(--text3)' }}>Facture générée</div><div style={{ fontWeight: 700 }}>{currentInvoice.number} — {fmtMoney(currentInvoice.total || 0)}</div></div>}
    <div style={{ background: '#fff', borderRadius: 8, padding: 12, border: '1px solid var(--border)', marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Justificatifs ({reviewAttachments.length})</div>{reviewAttachments.length === 0 ? <div style={{ fontSize: 11, color: 'var(--text3)' }}>Aucune pièce jointe</div> : reviewAttachments.map(att => <div key={att.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}><span>{att.filename}</span><button className="btn btn-outline btn-sm" style={{ padding: '2px 8px' }} onClick={() => onDeleteAttachment(att.id)}><Trash2 size={12} /></button></div>)}</div>
    <div style={{ background: '#fff', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Quarts de la semaine</div>{shifts.map(s => <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: '1px solid #f0f0f0', fontSize: 11 }}><span>{s.date} — {s.start}–{s.end} — {(s.location || '').slice(0, 30)}</span><strong>{Number(s.hours || 0).toFixed(2)}h</strong></div>)}</div>
  </>;
}

function ShiftPill({ shift, onClick }) {
  const bg = shift.status === 'draft' ? 'var(--surface2)' : shift.status === 'published' ? 'var(--brand-l)' : 'var(--green-l)';
  const hasDep = shift.km || shift.deplacement || shift.autre_dep;
  const hasMandat = shift.mandat_start || shift.mandat_end;
  return <div className="shift-pill" style={{ background: bg }} onClick={onClick} title={`${shift.location}\n${shift.start}—${shift.end} (${shift.hours}h net)`}><div style={{ fontWeight: 600 }}>{shift.start}–{shift.end}</div><div style={{ color: 'var(--text3)', fontSize: 9 }}>{shift.hours}h{shift.pause > 0 && <span style={{ color: 'var(--amber)' }}> (−{shift.pause}h)</span>}</div><div style={{ color: 'var(--text3)', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{shift.location?.split(' ').slice(0, 3).join(' ')}</div>{shift.notes && <div style={{ fontSize: 8, color: 'var(--amber)', marginTop: 1 }}>✏ note</div>}{hasDep > 0 && <div style={{ fontSize: 8, color: 'var(--purple)', marginTop: 1 }}>$ dépense</div>}{hasMandat && <div style={{ fontSize: 8, color: 'var(--teal)', marginTop: 1 }}>📅 mandat</div>}</div>;
}

function YearView({ schedules, employees, selectedDate }) {
  const y = selectedDate.getFullYear();
  return <div className="schedule-grid"><table><thead><tr><th>Employé</th>{MONTHS_SHORT.map(m => <th key={m}>{m}</th>)}<th style={{ background: 'var(--brand-xl)' }}>Total</th></tr></thead><tbody>{employees.length === 0 && <tr><td colSpan={14} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Aucun quart cette année</td></tr>}{employees.map(e => { let total = 0; return <tr key={e.id}><td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={e.name} size={26} /><div style={{ fontWeight: 600, fontSize: 11 }}>{e.name}</div></div></td>{Array.from({ length: 12 }, (_, m) => { const prefix = `${y}-${String(m + 1).padStart(2, '0')}`; const hrs = schedules.filter(s => s.employee_id === e.id && s.date.startsWith(prefix)).reduce((sum, s) => sum + s.hours, 0); total += hrs; return <td key={m} style={{ fontSize: 11, fontWeight: hrs ? 500 : 400, color: hrs ? 'var(--text)' : 'var(--text3)' }}>{hrs ? hrs.toFixed(1) : '—'}</td>; })}<td style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', background: 'var(--brand-xl)' }}>{total.toFixed(1)}h</td></tr>; })}</tbody></table></div>;
}
