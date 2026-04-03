import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { fmtDay, fmtISO, fmtMoney, getWeekDates, getMonthDates, RATE_KM } from '../utils/helpers';
import { Avatar, Modal } from '../components/UI';
import { ChevronLeft, ChevronRight, Plus, Send, Calendar, Search, FileText, Trash2, Eye, Upload, Download } from 'lucide-react';

const MONTHS_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

function calcHours(start, end, pause = 0) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, Math.round((((endMin - startMin) / 60) - pause) * 100) / 100);
}

function normalizeTimeForInput(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return '';
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function pauseHoursToMinutes(value) { return Math.round(Number(value || 0) * 60); }
function pauseMinutesToHours(value) { return Math.round((Number(value || 0) / 60) * 100) / 100; }
function normalizeEditableShift(s) {
  return {
    ...s,
    start: normalizeTimeForInput(s.start),
    end: normalizeTimeForInput(s.end),
    other_dep: s.autre_dep ?? s.other_dep ?? 0,
    pause_minutes: pauseHoursToMinutes(s.pause),
    is_new: false,
  };
}

function computeAccommodationEstimate(accommodation, allEmployeeSchedules, billedShifts) {
  const allWorkedDates = [...new Set((allEmployeeSchedules || []).filter(s => s.date >= accommodation.start_date && s.date <= accommodation.end_date).map(s => s.date))].sort();
  const billedWorkedDates = [...new Set((billedShifts || []).filter(s => s.date >= accommodation.start_date && s.date <= accommodation.end_date).map(s => s.date))].sort();
  const totalCost = Number(accommodation.total_cost || 0);
  const fallbackCount = Number(accommodation.days_worked || 0);
  const denominator = allWorkedDates.length || fallbackCount || 1;
  const costPerWorkedDay = totalCost > 0 ? totalCost / denominator : Number(accommodation.cost_per_day || 0);
  return { days: billedWorkedDates.length, costPerDay: costPerWorkedDay, amount: billedWorkedDates.length * costPerWorkedDay };
}

export default function SchedulesPage({ toast, onNavigate }) {
  const [schedules, setSchedules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [viewMode, setViewMode] = useState('week');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filterText, setFilterText] = useState('');
  const [modal, setModal] = useState(null);
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
  const viewDates = useMemo(() => viewMode === 'week' ? getWeekDates(selectedDate, 0) : getMonthDates(selectedDate), [viewMode, selectedDate]);
  const viewISOs = useMemo(() => viewDates.map(fmtISO), [viewDates]);
  const activeEmpIds = useMemo(() => [...new Set(schedules.filter(s => viewISOs.includes(s.date)).map(s => s.employee_id))], [schedules, viewISOs]);
  const activeEmps = useMemo(() => { let emps = employees.filter(e => activeEmpIds.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name)); if (filterText) { const q = filterText.toLowerCase(); emps = emps.filter(e => (e.name.toLowerCase() + ' ' + (e.position || '').toLowerCase()).includes(q)); } return emps; }, [employees, activeEmpIds, filterText]);
  const navigate = (dir) => setSelectedDate(d => { const n = new Date(d); if (viewMode === 'week') n.setDate(n.getDate() + dir * 7); else n.setMonth(n.getMonth() + dir); return n; });
  const periodLabel = useMemo(() => viewMode === 'week' && viewDates.length >= 7 ? `${fmtDay(viewDates[0])} — ${fmtDay(viewDates[viewDates.length - 1])}` : `${MONTHS_FULL[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`, [viewMode, viewDates, selectedDate]);
  const getWeekStart = () => (viewMode === 'week' && viewDates.length >= 7 ? fmtISO(viewDates[0]) : null);
  const getWeekEnd = () => (viewMode === 'week' && viewDates.length >= 7 ? fmtISO(viewDates[6]) : null);
  const getWeekApprovalStatus = (employeeId, clientId) => approvals.find(a => a.employee_id === employeeId && a.client_id === clientId && a.week_start === getWeekStart());
  const getEmployeeClientIds = (employee, periodShifts) => { const ids = [...new Set(periodShifts.map(s => s.client_id).filter(Boolean))]; if (ids.length) return ids; if (employee?.client_id) return [employee.client_id]; return []; };
  const getClientWeekShifts = (employeeId, clientId, fallbackClientId = null) => schedules.filter(s => s.employee_id === employeeId && viewISOs.includes(s.date) && (s.client_id === clientId || (!s.client_id && fallbackClientId && fallbackClientId === clientId)));
  const getClientWeekHours = (employeeId, clientId, fallbackClientId = null) => getClientWeekShifts(employeeId, clientId, fallbackClientId).reduce((sum, s) => sum + (Number(s.hours) || 0), 0);

  const openAdd = (employeeId = '', date = fmtISO(viewDates[0] || new Date())) => setModal({ type: 'add', data: { employeeId, date, start: '07:00', end: '15:00', pause: 0.5, pauseMinutes: 30, hours: 7.5, location: '', clientId: '', km: 0, deplacement: 0, autreDep: 0, notes: '' } });
  const openEdit = (shift) => setModal({ type: 'edit', data: { id: shift.id, employeeId: shift.employee_id, date: shift.date, start: normalizeTimeForInput(shift.start), end: normalizeTimeForInput(shift.end), pause: Number(shift.pause || 0), pauseMinutes: pauseHoursToMinutes(shift.pause || 0), hours: Number(shift.hours || 0), location: shift.location || '', clientId: shift.client_id || '', km: shift.km || 0, deplacement: shift.deplacement || 0, autreDep: shift.autre_dep || 0, notes: shift.notes || '' } });
  const updateModalField = (field, value) => setModal(m => { const next = { ...m, data: { ...m.data, [field]: value } }; if (field === 'start' || field === 'end' || field === 'pauseMinutes') { next.data.pause = pauseMinutesToHours(next.data.pauseMinutes); next.data.hours = calcHours(next.data.start, next.data.end, Number(next.data.pause || 0)); } return next; });
  const saveShift = async () => { try { const d = modal.data; const payload = { employee_id: Number(d.employeeId), date: d.date, start: normalizeTimeForInput(d.start), end: normalizeTimeForInput(d.end), pause: Number(d.pause || 0), hours: Number(d.hours || 0), location: d.location || '', client_id: d.clientId ? Number(d.clientId) : null, km: Number(d.km || 0), deplacement: Number(d.deplacement || 0), autre_dep: Number(d.autreDep || 0), notes: d.notes || '', billable_rate: 0, status: 'published' }; if (modal.type === 'add') await api.createSchedule(payload); else await api.updateSchedule(d.id, payload); toast?.(modal.type === 'add' ? 'Quart ajouté' : 'Quart modifié'); setModal(null); await reload(); } catch (err) { toast?.('Erreur: ' + err.message); } };
  const deleteShift = async () => { try { await api.deleteSchedule(modal.data.id); toast?.('Quart supprimé'); setModal(null); await reload(); } catch (err) { toast?.('Erreur: ' + err.message); } };
  const toggleBillingPanel = async (empId, clientId, fallbackClientId = null) => { if (expandedEmp?.empId === empId && expandedEmp?.clientId === clientId) { setExpandedEmp(null); setCurrentReview(null); setCurrentInvoice(null); setReviewAttachments([]); return; } const ws = getWeekStart(), we = getWeekEnd(); if (!ws || !we || !empId || !clientId) return; setBillingLoading(true); setExpandedEmp({ empId, clientId, fallbackClientId }); setCurrentReview(null); setCurrentInvoice(null); setReviewAttachments([]); const plannedHours = Number(getClientWeekHours(empId, clientId, fallbackClientId).toFixed(2)); setReviewDraft({ approvedHours: plannedHours, notes: '' }); try { const [reviews, invoices] = await Promise.all([api.getScheduleReviews({ employee_id: empId, client_id: clientId, week_start: ws }), api.getInvoices({ employee_id: empId, client_id: clientId, period_start: ws, period_end: we })]); const review = (reviews || [])[0] || null; const invoice = (invoices || [])[0] || null; setCurrentReview(review); setCurrentInvoice(invoice); if (review?.id) { setReviewDraft({ approvedHours: Number(review.approved_hours || plannedHours), notes: review.notes || '' }); const att = await api.getScheduleReviewAttachments(review.id).catch(() => []); setReviewAttachments(att || []); } } catch (err) { toast?.('Erreur: ' + err.message); } finally { setBillingLoading(false); } };
  const saveReview = async (empId, clientId, fallbackClientId = null, approve = false) => { const ws = getWeekStart(); if (!ws || !empId || !clientId) return; try { setBillingLoading(true); const approvedHours = Number(reviewDraft?.approvedHours || getClientWeekHours(empId, clientId, fallbackClientId) || 0); const notes = reviewDraft?.notes || ''; let review = approve ? await api.approveReviewedWeek({ employee_id: empId, client_id: clientId, week_start: ws, approved_hours: approvedHours, notes }) : await api.reviewWeek({ employee_id: empId, client_id: clientId, week_start: ws, approved_hours: approvedHours, notes }); if (approve && (!review || review.status !== 'approved')) review = { ...(review || {}), employee_id: empId, client_id: clientId, week_start: ws, status: 'approved' }; setCurrentReview(review || null); setApprovals(prev => { const rest = prev.filter(a => !(a.employee_id === empId && a.client_id === clientId && a.week_start === ws)); return review ? [review, ...rest] : rest; }); if (approve) await reload(); toast?.(approve ? 'Heures approuvées' : 'Révision enregistrée'); } catch (err) { toast?.('Erreur: ' + err.message); } finally { setBillingLoading(false); } };
  const revokeWeek = async (employeeId, clientId) => { const ws = getWeekStart(); if (!ws || !employeeId || !clientId) return; try { await api.revokeReviewedWeek({ employee_id: employeeId, client_id: clientId, week_start: ws }); toast?.('Approbation révoquée'); await reload(); setCurrentReview(r => r ? { ...r, status: 'rejected' } : r); setCurrentInvoice(null); } catch (err) { toast?.('Erreur: ' + err.message); } };
  const handleReviewAttachment = async (e, empId, clientId, fallbackClientId = null) => { const file = e.target.files?.[0]; if (!file || !empId || !clientId) return; try { let review = currentReview; if (!review?.id) { review = await api.reviewWeek({ employee_id: empId, client_id: clientId, week_start: getWeekStart(), approved_hours: Number(reviewDraft?.approvedHours || getClientWeekHours(empId, clientId, fallbackClientId) || 0), notes: reviewDraft?.notes || '' }); setCurrentReview(review || null); } if (!review?.id) throw new Error('Révision introuvable'); await api.uploadScheduleReviewAttachment(review.id, file, 'justificatif', file.name); const att = await api.getScheduleReviewAttachments(review.id); setReviewAttachments(att || []); toast?.('Justificatif ajouté'); } catch (err) { toast?.('Erreur: ' + err.message); } finally { e.target.value = ''; } };
  const deleteReviewAttachment = async (attId) => { if (!currentReview?.id || !attId) return; try { await api.deleteScheduleReviewAttachment(currentReview.id, attId); const att = await api.getScheduleReviewAttachments(currentReview.id); setReviewAttachments(att || []); toast?.('Justificatif supprimé'); } catch (err) { toast?.('Erreur: ' + err.message); } };
  const openReviewAttachment = async (attId) => { if (!currentReview?.id || !attId) return; const base = import.meta.env.VITE_API_URL || '/api'; window.open(`${base}/schedule-reviews/${currentReview.id}/attachments/${attId}`, '_blank'); };
  const generateInvoice = async (empId, clientId) => { const ws = getWeekStart(), we = getWeekEnd(); if (!ws || !we || !empId || !clientId) return; if (currentReview?.status !== 'approved') { toast?.('Approuve les heures avant de générer la facture'); return; } try { setBillingLoading(true); const result = await api.generateFromSchedules({ employee_id: empId, client_id: clientId, period_start: ws, period_end: we }); setCurrentInvoice(result || null); toast?.(`Facture ${result.number} générée`); } catch (err) { const msg = err.message || ''; const isNetworkError = msg === 'Failed to fetch' || msg === 'NetworkError when attempting to fetch resource.' || msg === 'Load failed'; toast?.('Erreur: ' + (isNetworkError ? 'Impossible de joindre le serveur.' : (msg || 'Erreur réseau'))); } finally { setBillingLoading(false); } };
  const generateAllApproved = async () => { const ws = getWeekStart(), we = getWeekEnd(); if (!ws || !we) { toast?.('Période invalide — sélectionnez une semaine valide'); return; } try { setBulkLoading(true); const result = await api.generateAllApprovedInvoices({ period_start: ws, period_end: we }); const skippedMsg = (result.skipped && result.skipped.length > 0) ? ` (${result.skipped.length} ignorée(s))` : ''; toast?.(`${result.count || 0} facture(s) approuvée(s) générée(s)${skippedMsg}`); if ((result.count || 0) > 0 && onNavigate) onNavigate('invoices'); } catch (err) { const msg = err.message || ''; const isNetworkError = msg === 'Failed to fetch' || msg === 'NetworkError when attempting to fetch resource.' || msg === 'Load failed'; toast?.('Erreur génération: ' + (isNetworkError ? 'Impossible de joindre le serveur. Vérifiez que le backend est démarré.' : (msg || 'Erreur réseau'))); } finally { setBulkLoading(false); } };
  // ── Import / Export CSV/Excel ──
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exportModal, setExportModal] = useState(false);
  const [exportOpts, setExportOpts] = useState({ date_start: '', date_end: '', employee_id: '', client_id: '', format: 'csv' });
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = React.useRef(null);

  const handleImport = async () => {
    if (!importFile) { toast?.('Sélectionnez un fichier'); return; }
    setImporting(true); setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const base = import.meta.env.VITE_API_URL || '/api';
      const token = localStorage.getItem('token');
      const resp = await fetch(`${base}/schedules/import-csv`, {
        method: 'POST', body: formData,
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.detail || `Erreur ${resp.status}`); }
      const data = await resp.json();
      setImportResult(data);
      if (data.success > 0) { reload(); toast?.(`${data.success} quart(s) importé(s)`); }
    } catch (err) { setImportResult({ success: 0, errors: 1, error_details: [{ row: 0, error: err.message }], message: err.message }); toast?.('Erreur import: ' + err.message); }
    finally { setImporting(false); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const base = import.meta.env.VITE_API_URL || '/api';
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (exportOpts.date_start) params.set('date_start', exportOpts.date_start);
      if (exportOpts.date_end) params.set('date_end', exportOpts.date_end);
      if (exportOpts.employee_id) params.set('employee_id', exportOpts.employee_id);
      if (exportOpts.client_id) params.set('client_id', exportOpts.client_id);
      params.set('format', exportOpts.format);
      const resp = await fetch(`${base}/schedules/export-csv?${params}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `horaires_export.${exportOpts.format === 'xlsx' ? 'xlsx' : 'csv'}`;
      a.click(); URL.revokeObjectURL(url);
      setExportModal(false); toast?.('Export téléchargé');
    } catch (err) { toast?.('Erreur export: ' + err.message); }
    finally { setExporting(false); }
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) setImportFile(f); };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Chargement des horaires...</div>;
  return <><div className="page-header"><h1 className="page-title"><Calendar size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />Horaires</h1><div style={{ display: 'flex', gap: 8 }}>{viewMode === 'week' && <button className="btn btn-outline btn-sm" onClick={generateAllApproved} disabled={bulkLoading}><FileText size={13} /> {bulkLoading ? 'Génération…' : 'Générer toutes les factures approuvées'}</button>}<button className="btn btn-outline btn-sm" onClick={() => api.publishAll().then(() => { toast?.('Quarts publiés'); reload(); }).catch(err => toast?.('Erreur: ' + err.message))}><Send size={13} /> Publier tout</button><button className="btn btn-outline btn-sm" onClick={() => { setImportFile(null); setImportResult(null); setImportModal(true); }}><Upload size={13} /> Importer</button><button className="btn btn-outline btn-sm" onClick={() => setExportModal(true)}><Download size={13} /> Exporter</button><button className="btn btn-primary btn-sm" onClick={() => openAdd()}><Plus size={14} /> Ajouter</button></div></div><div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><button className="btn btn-outline btn-sm" onClick={() => navigate(-1)}><ChevronLeft size={16} /></button><span style={{ fontSize: 13, fontWeight: 600, minWidth: 230, textAlign: 'center' }}>{periodLabel}</span><button className="btn btn-outline btn-sm" onClick={() => navigate(1)}><ChevronRight size={16} /></button></div><div style={{ display: 'flex', gap: 6 }}><button className={`btn btn-sm ${viewMode === 'week' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('week')}>Semaine</button><button className={`btn btn-sm ${viewMode === 'month' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('month')}>Mois</button></div></div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><div style={{ position: 'relative', maxWidth: 300 }}><Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} /><input className="input" style={{ paddingLeft: 32, padding: '7px 12px 7px 32px', fontSize: 12 }} placeholder="Rechercher un employé..." value={filterText} onChange={e => setFilterText(e.target.value)} /></div><div style={{ fontSize: 12, color: 'var(--text3)' }}>{schedules.length} quarts · {employees.length} employés</div></div></div><div className="schedule-grid"><table><thead><tr><th>Employé</th>{viewDates.map((d, i) => <th key={i}>{fmtDay(d)}</th>)}<th style={{ minWidth: 120, background: 'var(--brand-xl)' }}>Total</th></tr></thead><tbody>{activeEmps.map(e => { const periodShifts = schedules.filter(s => s.employee_id === e.id && viewISOs.includes(s.date)); const totalHrs = periodShifts.reduce((sum, s) => sum + Number(s.hours || 0), 0); const totalKm = periodShifts.reduce((sum, s) => sum + Number(s.km || 0), 0); const totalDep = periodShifts.reduce((sum, s) => sum + Number(s.deplacement || 0) + Number(s.autre_dep || 0), 0); const totalFrais = totalDep + totalKm * RATE_KM; const empClientIds = getEmployeeClientIds(e, periodShifts); return <React.Fragment key={e.id}><tr><td><div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('employees')}><Avatar name={e.name} size={30} /><div><div style={{ fontWeight: 600, fontSize: 12 }}>{e.name}</div><div style={{ fontSize: 10, color: 'var(--text3)' }}>{(e.position || '').slice(0, 24)}</div></div></div></td>{viewDates.map((d, i) => { const iso = fmtISO(d); const shifts = schedules.filter(s => s.employee_id === e.id && s.date === iso); return <td key={i} onDoubleClick={() => openAdd(e.id, iso)}>{shifts.map(s => <ShiftPill key={s.id} shift={s} onClick={() => openEdit(s)} />)}{shifts.length === 0 && <div onClick={() => openAdd(e.id, iso)} style={{ opacity: .25, textAlign: 'center', fontSize: 16, lineHeight: '30px', color: 'var(--brand)', cursor: 'pointer' }}>+</div>}</td>; })}<td style={{ minWidth: 160, textAlign: 'center', verticalAlign: 'middle', background: 'var(--brand-xl)', borderLeft: '2px solid var(--border)' }}><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand)' }}>{totalHrs.toFixed(1)}h</div>{totalFrais > 0 && <div style={{ fontSize: 10, color: 'var(--purple)', marginTop: 2 }}>{fmtMoney(totalFrais)} frais</div>}{totalKm > 0 && <div style={{ fontSize: 9, color: 'var(--text3)' }}>{totalKm} km</div>}{viewMode === 'week' && empClientIds.map(cid => { const appr = getWeekApprovalStatus(e.id, cid); const isApproved = appr && appr.status === 'approved'; const cl = clients.find(c => c.id === cid); return <div key={cid} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}><div style={{ fontSize: 9, color: 'var(--text3)' }}>{(cl?.name || 'Client').slice(0, 18)}</div><button style={{ display: 'block', width: '100%', padding: '2px 6px', fontSize: 9, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', background: isApproved ? '#28A745' : '#FFC107', color: isApproved ? '#fff' : '#000' }} onClick={() => isApproved ? revokeWeek(e.id, cid) : saveReview(e.id, cid, e.client_id || null, true)}>{isApproved ? '✓ Approuvé' : 'Approuver heures'}</button><button style={{ display: 'block', width: '100%', padding: '2px 6px', fontSize: 9, fontWeight: 500, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: expandedEmp?.empId === e.id && expandedEmp?.clientId === cid ? 'var(--brand)' : 'var(--surface)', color: expandedEmp?.empId === e.id && expandedEmp?.clientId === cid ? '#fff' : 'var(--text2)' }} onClick={() => toggleBillingPanel(e.id, cid, e.client_id || null)}>📋 {expandedEmp?.empId === e.id && expandedEmp?.clientId === cid ? 'Fermer' : 'Détails'}</button></div>; })}</td></tr>{viewMode === 'week' && expandedEmp?.empId === e.id && empClientIds.includes(expandedEmp?.clientId) && <tr><td colSpan={viewDates.length + 2} style={{ padding: 0 }}><div style={{ background: '#f0f9fa', borderTop: '2px solid var(--brand)', borderBottom: '2px solid var(--brand)', padding: '14px 18px' }}>{billingLoading ? <div style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>Chargement...</div> : <ApprovalPanel employee={e} client={clients.find(c => c.id === expandedEmp.clientId)} shifts={getClientWeekShifts(e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null)} allEmployeeSchedules={schedules.filter(s => s.employee_id === e.id && s.status !== 'cancelled')} reviewDraft={reviewDraft} setReviewDraft={setReviewDraft} currentReview={currentReview} currentInvoice={currentInvoice} reviewAttachments={reviewAttachments} onSave={() => saveReview(e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null, false)} onApprove={() => saveReview(e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null, true)} onRevoke={() => revokeWeek(e.id, expandedEmp.clientId)} onGenerateInvoice={() => generateInvoice(e.id, expandedEmp.clientId)} onUpload={(ev) => handleReviewAttachment(ev, e.id, expandedEmp.clientId, expandedEmp?.fallbackClientId || e.client_id || null)} onDeleteAttachment={deleteReviewAttachment} onOpenAttachment={openReviewAttachment} onGoInvoices={() => onNavigate && onNavigate('invoices')} onRefreshParent={reload} toast={toast} />}</div></td></tr>}</React.Fragment>; })}</tbody></table></div><Modal open={!!modal} onClose={() => setModal(null)} title={modal?.type === 'edit' ? 'Modifier le quart' : 'Ajouter un quart'}>{modal && <div style={{ display: 'grid', gap: 10 }}><div><label>Employé</label><select className="input" value={modal.data.employeeId} onChange={e => updateModalField('employeeId', e.target.value)}><option value="">Choisir</option>{employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><div><label>Date</label><input className="input" type="date" value={modal.data.date} onChange={e => updateModalField('date', e.target.value)} /></div><div><label>Client</label><select className="input" value={modal.data.clientId} onChange={e => updateModalField('clientId', e.target.value)}><option value="">—</option>{clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}</select></div></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}><div><label>Début</label><input className="input" type="time" value={modal.data.start} onChange={e => updateModalField('start', e.target.value)} /></div><div><label>Fin</label><input className="input" type="time" value={modal.data.end} onChange={e => updateModalField('end', e.target.value)} /></div><div><label>Pause min</label><input className="input" type="number" value={modal.data.pauseMinutes} onChange={e => updateModalField('pauseMinutes', e.target.value)} /></div></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}><div><label>Heures</label><input className="input" value={Number(modal.data.hours || 0).toFixed(2)} readOnly /></div><div><label>KM</label><input className="input" type="number" value={modal.data.km} onChange={e => updateModalField('km', e.target.value)} /></div><div><label>Déplacement (heures)</label><input className="input" type="number" step="0.25" value={modal.data.deplacement} onChange={e => updateModalField('deplacement', e.target.value)} /></div></div><div><label>Autre dépense ($)</label><input className="input" type="number" step="0.01" value={modal.data.autreDep} onChange={e => updateModalField('autreDep', e.target.value)} /></div><div><label>Lieu</label><input className="input" value={modal.data.location} onChange={e => updateModalField('location', e.target.value)} /></div><div><label>Notes</label><input className="input" value={modal.data.notes} onChange={e => updateModalField('notes', e.target.value)} /></div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}><div>{modal.type === 'edit' && <button className="btn btn-outline btn-sm" onClick={deleteShift}><Trash2 size={14} /> Supprimer</button>}</div><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-outline btn-sm" onClick={() => setModal(null)}>Annuler</button><button className="btn btn-primary btn-sm" onClick={saveShift}>Sauvegarder</button></div></div></div>}</Modal>

{/* ── Import Modal ── */}
<Modal open={importModal} onClose={() => setImportModal(false)} title="Importer des horaires (CSV / Excel)" wide>
  <div style={{ display: 'grid', gap: 16 }}>
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? 'var(--brand)' : 'var(--border)'}`,
        borderRadius: 8, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
        background: dragOver ? 'var(--brand-xl)' : 'var(--surface)',
        transition: 'all .2s',
      }}
    >
      <Upload size={28} style={{ color: 'var(--brand)', marginBottom: 8 }} />
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {importFile ? importFile.name : 'Glissez un fichier ici ou cliquez pour sélectionner'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
        Formats acceptés: .csv, .xlsx, .xls
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.[0]) setImportFile(e.target.files[0]); }}
      />
    </div>

    {importResult && (
      <div style={{
        padding: 14, borderRadius: 8,
        background: importResult.success > 0 ? '#d4edda' : '#f8d7da',
        border: `1px solid ${importResult.success > 0 ? '#c3e6cb' : '#f5c6cb'}`,
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
          {importResult.message}
        </div>
        {importResult.success > 0 && (
          <div style={{ fontSize: 12, color: '#155724' }}>
            ✅ {importResult.success} quart(s) importé(s) sur {importResult.total_rows} lignes
          </div>
        )}
        {importResult.errors > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#721c24', marginBottom: 4 }}>
              ⚠️ {importResult.errors} erreur(s):
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 11 }}>
              {(importResult.error_details || []).slice(0, 20).map((err, i) => (
                <div key={i} style={{ padding: '2px 0', color: '#721c24' }}>
                  Ligne {err.row}: {err.error}
                </div>
              ))}
              {importResult.errors > 20 && (
                <div style={{ fontStyle: 'italic', marginTop: 4 }}>
                  ... et {importResult.errors - 20} autres erreurs
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )}

    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <button className="btn btn-outline btn-sm" onClick={() => setImportModal(false)}>Fermer</button>
      <button
        className="btn btn-primary btn-sm"
        onClick={handleImport}
        disabled={!importFile || importing}
      >
        {importing ? '⏳ Importation en cours...' : '📥 Importer'}
      </button>
    </div>
  </div>
</Modal>

{/* ── Export Modal ── */}
<Modal open={exportModal} onClose={() => setExportModal(false)} title="Exporter les horaires">
  <div style={{ display: 'grid', gap: 12 }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Date début</label>
        <input className="input" type="date" value={exportOpts.date_start} onChange={e => setExportOpts(p => ({ ...p, date_start: e.target.value }))} />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Date fin</label>
        <input className="input" type="date" value={exportOpts.date_end} onChange={e => setExportOpts(p => ({ ...p, date_end: e.target.value }))} />
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Employé</label>
        <select className="input" value={exportOpts.employee_id} onChange={e => setExportOpts(p => ({ ...p, employee_id: e.target.value }))}>
          <option value="">Tous</option>
          {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Client</label>
        <select className="input" value={exportOpts.client_id} onChange={e => setExportOpts(p => ({ ...p, client_id: e.target.value }))}>
          <option value="">Tous</option>
          {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
        </select>
      </div>
    </div>
    <div>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Format</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className={`btn btn-sm ${exportOpts.format === 'csv' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setExportOpts(p => ({ ...p, format: 'csv' }))}>CSV</button>
        <button className={`btn btn-sm ${exportOpts.format === 'xlsx' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setExportOpts(p => ({ ...p, format: 'xlsx' }))}>Excel (.xlsx)</button>
      </div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
      <button className="btn btn-outline btn-sm" onClick={() => setExportModal(false)}>Annuler</button>
      <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={exporting}>
        {exporting ? '⏳ Exportation...' : '📤 Exporter'}
      </button>
    </div>
  </div>
</Modal>

</>; }

function ApprovalPanel({ employee, client, shifts, allEmployeeSchedules, reviewDraft, setReviewDraft, currentReview, currentInvoice, reviewAttachments, onSave, onApprove, onRevoke, onGenerateInvoice, onUpload, onDeleteAttachment, onOpenAttachment, onGoInvoices, onRefreshParent, toast }) {
  const [editableShifts, setEditableShifts] = useState([]);
  const [savingShiftId, setSavingShiftId] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [accommodations, setAccommodations] = useState([]);
  const [loadingAccommodations, setLoadingAccommodations] = useState(false);
  const [accomForm, setAccomForm] = useState({ total_cost: '', start_date: '', end_date: '', notes: '' });
  const [savingAccommodation, setSavingAccommodation] = useState(false);
  const isSavingRef = React.useRef(false);

  useEffect(() => { if (isSavingRef.current) return; setEditableShifts((shifts || []).map(normalizeEditableShift)); setDirtyIds(new Set()); }, [shifts]);
  const loadAccommodations = useCallback(async () => { if (!employee?.id) { setAccommodations([]); return; } try { setLoadingAccommodations(true); const all = await api.getAccommodations(); setAccommodations((all || []).filter(a => a.employee_id === employee.id)); } catch { setAccommodations([]); } finally { setLoadingAccommodations(false); } }, [employee]);
  useEffect(() => { loadAccommodations(); }, [loadAccommodations]);
  const updateEditableShift = (id, field, value) => { setDirtyIds(prev => new Set(prev).add(id)); setEditableShifts(prev => prev.map(s => { if (s.id !== id) return s; const next = { ...s, [field]: value }; if (field === 'start' || field === 'end' || field === 'pause_minutes') { next.pause = pauseMinutesToHours(next.pause_minutes); next.hours = calcHours(next.start, next.end, Number(next.pause || 0)); } return next; })); };
  const addQuickShiftRow = () => { const baseDate = shifts?.[0]?.date || fmtISO(new Date()); const newId = `new-${Date.now()}-${editableShifts.length}`; setDirtyIds(prev => new Set(prev).add(newId)); setEditableShifts(prev => [...prev, { id: newId, is_new: true, employee_id: employee.id, client_id: client?.id || null, date: baseDate, start: '07:00', end: '15:00', pause: 0, pause_minutes: 0, hours: 8, km: 0, deplacement: 0, other_dep: 0, notes: '', billable_rate: Number(employee?.rate || 0), status: 'published', location: '' }]); };
  const saveShiftLine = async (shift) => {
    const snapshot = editableShifts.map(s => ({ ...s }));
    try {
      setSavingShiftId(shift.id);
      isSavingRef.current = true;
      const payload = { start: normalizeTimeForInput(shift.start), end: normalizeTimeForInput(shift.end), pause: Number(shift.pause || 0), hours: Number(shift.hours || 0), km: Number(shift.km || 0), deplacement: Number(shift.deplacement || 0), autre_dep: Number(shift.other_dep || 0), notes: shift.notes || '' };
      let saved;
      if (shift.is_new) {
        saved = await api.createSchedule({ employee_id: employee.id, client_id: client?.id || null, date: shift.date, ...payload, billable_rate: Number(shift.billable_rate || employee?.rate || 0), status: 'published', location: shift.location || '' });
        // Handle both response formats: full object (single) or {created, ids} (batch)
        if (saved && saved.id) {
          setEditableShifts(prev => prev.map(s => s.id === shift.id ? normalizeEditableShift(saved) : s));
        } else if (saved && saved.ids && saved.ids.length) {
          // Fetch the created schedule to get full data
          await onRefreshParent?.();
          setDirtyIds(prev => { const next = new Set(prev); next.delete(shift.id); return next; });
          return;
        }
      } else {
        saved = await api.updateSchedule(shift.id, payload);
        if (saved && saved.id) {
          setEditableShifts(prev => prev.map(s => s.id === shift.id ? normalizeEditableShift(saved) : s));
        }
      }
      setDirtyIds(prev => { const next = new Set(prev); next.delete(shift.id); return next; });
      toast?.(shift.is_new ? 'Quart ajouté' : 'Quart modifié');
      await onRefreshParent?.();
    } catch (err) {
      setEditableShifts(snapshot);
      toast?.('Erreur: ' + (err.message || 'Échec de la sauvegarde'));
    } finally {
      isSavingRef.current = false;
      setSavingShiftId(null);
    }
  };
  const saveAllDirtyShifts = async () => {
    const dirtyShifts = editableShifts.filter(s => dirtyIds.has(s.id));
    if (dirtyShifts.length === 0) return true;
    setSavingAll(true);
    isSavingRef.current = true;
    let allOk = true;
    for (const shift of dirtyShifts) {
      try {
        const payload = { start: normalizeTimeForInput(shift.start), end: normalizeTimeForInput(shift.end), pause: Number(shift.pause || 0), hours: Number(shift.hours || 0), km: Number(shift.km || 0), deplacement: Number(shift.deplacement || 0), autre_dep: Number(shift.other_dep || 0), notes: shift.notes || '' };
        let saved;
        if (shift.is_new) {
          saved = await api.createSchedule({ employee_id: employee.id, client_id: client?.id || null, date: shift.date, ...payload, billable_rate: Number(shift.billable_rate || employee?.rate || 0), status: 'published', location: shift.location || '' });
          if (saved && saved.id) {
            setEditableShifts(prev => prev.map(s => s.id === shift.id ? normalizeEditableShift(saved) : s));
          }
        } else {
          saved = await api.updateSchedule(shift.id, payload);
          if (saved && saved.id) {
            setEditableShifts(prev => prev.map(s => s.id === shift.id ? normalizeEditableShift(saved) : s));
          }
        }
        setDirtyIds(prev => { const next = new Set(prev); next.delete(shift.id); return next; });
      } catch (err) {
        allOk = false;
        toast?.(`Erreur sauvegarde ligne ${shift.date}: ` + (err.message || 'Échec'));
      }
    }
    isSavingRef.current = false;
    setSavingAll(false);
    if (allOk && dirtyShifts.length > 0) {
      toast?.(`${dirtyShifts.length} ligne(s) sauvegardée(s)`);
      await onRefreshParent?.();
    }
    return allOk;
  };
  const handleEnregistrer = async () => {
    await saveAllDirtyShifts();
    onSave?.();
  };
  const handleApprove = async () => {
    await saveAllDirtyShifts();
    onApprove?.();
  };
  const removeShiftLine = async (shift) => { if (shift.is_new) { setEditableShifts(prev => prev.filter(s => s.id !== shift.id)); setDirtyIds(prev => { const next = new Set(prev); next.delete(shift.id); return next; }); return; } const snapshot = editableShifts.map(s => ({ ...s })); try { setSavingShiftId(shift.id); isSavingRef.current = true; setEditableShifts(prev => prev.filter(s => s.id !== shift.id)); await api.deleteSchedule(shift.id); setDirtyIds(prev => { const next = new Set(prev); next.delete(shift.id); return next; }); toast?.('Quart supprimé'); await onRefreshParent?.(); } catch (err) { setEditableShifts(snapshot); toast?.('Erreur: ' + (err.message || 'Échec de la suppression')); } finally { isSavingRef.current = false; setSavingShiftId(null); } };
  const saveQuickAccommodation = async () => { if (!accomForm.total_cost || !accomForm.start_date || !accomForm.end_date) return; try { setSavingAccommodation(true); await api.createAccommodation({ employee_id: employee.id, total_cost: Number(accomForm.total_cost || 0), start_date: accomForm.start_date, end_date: accomForm.end_date, days_worked: 0, cost_per_day: 0, notes: accomForm.notes || '' }); setAccomForm({ total_cost: '', start_date: '', end_date: '', notes: '' }); toast?.('Hébergement ajouté'); await loadAccommodations(); } catch (err) { toast?.('Erreur: ' + (err.message || 'Échec de l\'ajout')); } finally { setSavingAccommodation(false); } };
  const accommodationEstimates = useMemo(() => (accommodations || []).map(a => ({ ...a, estimate: computeAccommodationEstimate(a, allEmployeeSchedules, editableShifts) })).filter(a => a.estimate.days > 0), [accommodations, allEmployeeSchedules, editableShifts]);
  const effectiveRate = Number(employee?.rate || editableShifts.find(s => Number(s.billable_rate || 0))?.billable_rate || 0);
  const totals = useMemo(() => { const service = editableShifts.reduce((sum, s) => sum + Number(s.hours || 0) * effectiveRate, 0); const km = editableShifts.reduce((sum, s) => sum + Number(s.km || 0) * RATE_KM, 0); const dep = editableShifts.reduce((sum, s) => sum + Number(s.deplacement || 0) * effectiveRate, 0); const autres = editableShifts.reduce((sum, s) => sum + Number(s.other_dep || 0), 0); const accom = accommodationEstimates.reduce((sum, a) => sum + Number(a.estimate.amount || 0), 0); const subtotal = service + km + dep + autres + accom; const includeTax = !client?.tax_exempt; const tps = includeTax ? subtotal * TPS_RATE : 0; const tvq = includeTax ? subtotal * TVQ_RATE : 0; return { service, km, dep, autres, accom, subtotal, tps, tvq, total: subtotal + tps + tvq }; }, [editableShifts, accommodationEstimates, effectiveRate, client]);
  const plannedHours = editableShifts.reduce((sum, s) => sum + (Number(s.hours) || 0), 0); const totalKm = editableShifts.reduce((sum, s) => sum + (Number(s.km) || 0), 0); const totalDep = editableShifts.reduce((sum, s) => sum + (Number(s.deplacement) || 0) + (Number(s.other_dep) || 0), 0); const canGenerateInvoice = currentReview?.status === 'approved';
  return <><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-d)' }}>📋 Validation hebdomadaire — {employee?.name || ''} / {client?.name || 'Client'}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{currentReview?.status ? `Statut: ${currentReview.status}` : 'Aucune approbation enregistrée'}</div></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Quarts</div><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)' }}>{editableShifts.length}</div></div><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Heures affichées</div><div style={{ fontSize: 16, fontWeight: 700 }}>{plannedHours.toFixed(2)}h</div></div><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Kilométrage</div><div style={{ fontSize: 16, fontWeight: 700 }}>{totalKm} km</div></div><div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text3)' }}>Frais</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtMoney(totalDep + totalKm * RATE_KM)}</div></div></div><div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'start', marginBottom: 12 }}><div style={{ background: '#fff', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><div style={{ fontSize: 12, fontWeight: 700 }}>Édition rapide des quarts / frais</div><button className="btn btn-outline btn-sm" onClick={addQuickShiftRow}>+ Ajouter ligne</button></div><div style={{ display: 'grid', gridTemplateColumns: '96px 88px 88px 88px 82px 72px 90px 90px 90px 88px 88px', gap: 6, fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}><div>Date</div><div>Début</div><div>Fin</div><div>Pause min</div><div>Heures</div><div>KM</div><div>Dépl. (h)</div><div>Autre</div><div>Notes</div><div></div><div></div></div>{editableShifts.map(s => <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '96px 88px 88px 88px 82px 72px 90px 90px 90px 88px 88px', gap: 6, marginBottom: 6, alignItems: 'center' }}><input className="input" type="date" style={{ padding: '6px 8px', fontSize: 12 }} value={s.date} onChange={e => updateEditableShift(s.id, 'date', e.target.value)} /><input className="input" type="time" style={{ padding: '6px 8px', fontSize: 12 }} value={normalizeTimeForInput(s.start)} onChange={e => updateEditableShift(s.id, 'start', e.target.value)} /><input className="input" type="time" style={{ padding: '6px 8px', fontSize: 12 }} value={normalizeTimeForInput(s.end)} onChange={e => updateEditableShift(s.id, 'end', e.target.value)} /><input className="input" type="number" step="1" style={{ padding: '6px 8px', fontSize: 12 }} value={s.pause_minutes || 0} onChange={e => updateEditableShift(s.id, 'pause_minutes', e.target.value)} /><input className="input" type="number" step="0.25" style={{ padding: '6px 8px', fontSize: 12, background: '#f8f9fa' }} value={Number(s.hours || 0).toFixed(2)} readOnly /><input className="input" type="number" step="1" style={{ padding: '6px 8px', fontSize: 12 }} value={s.km || 0} onChange={e => updateEditableShift(s.id, 'km', e.target.value)} /><input className="input" type="number" step="0.01" style={{ padding: '6px 8px', fontSize: 12 }} value={s.deplacement || 0} onChange={e => updateEditableShift(s.id, 'deplacement', e.target.value)} /><input className="input" type="number" step="0.01" style={{ padding: '6px 8px', fontSize: 12 }} value={s.other_dep || 0} onChange={e => updateEditableShift(s.id, 'other_dep', e.target.value)} /><input className="input" type="text" style={{ padding: '6px 8px', fontSize: 12 }} value={s.notes || ''} onChange={e => updateEditableShift(s.id, 'notes', e.target.value)} /><button className="btn btn-outline btn-sm" style={dirtyIds.has(s.id) ? { borderColor: '#FFC107', background: '#fff8e1' } : {}} onClick={() => saveShiftLine(s)} disabled={savingShiftId === s.id || savingAll}>{savingShiftId === s.id ? '...' : 'Sauver'}</button><button className="btn btn-outline btn-sm" onClick={() => removeShiftLine(s)} disabled={savingShiftId === s.id}><Trash2 size={12} /></button></div>)}</div><div style={{ background: '#fff', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Résumé estimatif</div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span>Services</span><strong>{fmtMoney(totals.service)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span>KM</span><strong>{fmtMoney(totals.km)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span>Déplacement (h)</span><strong>{fmtMoney(totals.dep)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span>Autres frais</span><strong>{fmtMoney(totals.autres)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span>Hébergement</span><strong>{fmtMoney(totals.accom)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderTop: '1px solid #dee2e6', marginTop: 6 }}><span>Sous-total</span><strong>{fmtMoney(totals.subtotal)}</strong></div>{!client?.tax_exempt && <><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span>TPS</span><strong>{fmtMoney(totals.tps)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span>TVQ</span><strong>{fmtMoney(totals.tvq)}</strong></div></>}{client?.tax_exempt && <div style={{ fontSize: 11, color: '#28A745', paddingTop: 6 }}>Client exempté de taxes</div>}<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, padding: '10px 12px', marginTop: 8, background: '#2A7B88', color: '#fff', borderRadius: 8 }}><span>Total estimé</span><strong>{fmtMoney(totals.total)}</strong></div></div></div><div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 12 }}><div style={{ background: '#fff', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><div style={{ fontSize: 12, fontWeight: 700 }}>Hébergement lié à la semaine</div><div style={{ fontSize: 10, color: 'var(--text3)' }}>{loadingAccommodations ? 'Chargement…' : `${accommodationEstimates.length} ligne(s)`}</div></div>{accommodationEstimates.length === 0 ? <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>Aucun hébergement trouvé pour cette semaine.</div> : <div>{accommodationEstimates.map(a => <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr .7fr .8fr .8fr', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}><span>{a.start_date} → {a.end_date}</span><span>{a.estimate.days} jour(s)</span><span>{fmtMoney(a.estimate.costPerDay)}/jour</span><strong>{fmtMoney(a.estimate.amount)}</strong></div>)}</div>}<div style={{ borderTop: '1px solid #f0f0f0', marginTop: 8, paddingTop: 8 }}><div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Ajout rapide hébergement</div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr auto', gap: 6 }}><input className="input" type="date" style={{ padding: '6px 8px', fontSize: 12 }} value={accomForm.start_date} onChange={e => setAccomForm(f => ({ ...f, start_date: e.target.value }))} /><input className="input" type="date" style={{ padding: '6px 8px', fontSize: 12 }} value={accomForm.end_date} onChange={e => setAccomForm(f => ({ ...f, end_date: e.target.value }))} /><input className="input" type="number" step="0.01" style={{ padding: '6px 8px', fontSize: 12 }} placeholder="Coût total" value={accomForm.total_cost} onChange={e => setAccomForm(f => ({ ...f, total_cost: e.target.value }))} /><input className="input" type="text" style={{ padding: '6px 8px', fontSize: 12 }} placeholder="Notes" value={accomForm.notes} onChange={e => setAccomForm(f => ({ ...f, notes: e.target.value }))} /><button className="btn btn-outline btn-sm" onClick={saveQuickAccommodation} disabled={savingAccommodation}>{savingAccommodation ? '...' : 'Ajouter'}</button></div></div></div><div style={{ background: '#fff', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Approbation / justificatifs</div><div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 12 }}><div><label style={{ fontSize: 11, color: 'var(--text3)' }}>Heures approuvées</label><input className="input" type="number" step="0.25" value={reviewDraft.approvedHours} onChange={e => setReviewDraft(d => ({ ...d, approvedHours: e.target.value }))} /></div><div><label style={{ fontSize: 11, color: 'var(--text3)' }}>Notes</label><input className="input" value={reviewDraft.notes} onChange={e => setReviewDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes de vérification" /></div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>{dirtyIds.size > 0 && <div style={{ fontSize: 11, color: '#856404', background: '#fff3cd', border: '1px solid #ffe69c', padding: '4px 10px', borderRadius: 6, display: 'flex', alignItems: 'center' }}>⚠️ {dirtyIds.size} modification(s) non sauvegardée(s)</div>}<button className="btn btn-outline btn-sm" onClick={handleEnregistrer} disabled={savingAll}>{savingAll ? '⏳ Sauvegarde…' : 'Enregistrer'}</button><button className="btn btn-primary btn-sm" style={{ background: currentReview?.status === 'approved' ? '#28A745' : undefined }} onClick={handleApprove} disabled={!editableShifts.length || savingAll}>{savingAll ? '⏳…' : 'Approuver les heures'}</button><button className="btn btn-outline btn-sm" onClick={onRevoke} disabled={!currentReview}>Révoquer</button><button className="btn btn-primary btn-sm" onClick={onGenerateInvoice} disabled={!canGenerateInvoice}>Générer la facture approuvée</button><label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>Ajouter justificatif<input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif" style={{ display: 'none' }} onChange={onUpload} /></label>{currentInvoice && <button className="btn btn-outline btn-sm" onClick={onGoInvoices}>Voir dans Facturation</button>}</div>{!canGenerateInvoice && <div style={{ fontSize: 11, color: '#856404', background: '#fff3cd', border: '1px solid #ffe69c', padding: '8px 10px', borderRadius: 8, marginBottom: 10 }}>Approuve la semaine avant de générer la facture approuvée.</div>}{currentInvoice && <div style={{ background: '#eef7ff', border: '1px solid #c7e1ff', borderRadius: 8, padding: 10, marginBottom: 12 }}><div style={{ fontSize: 11, color: 'var(--text3)' }}>Facture générée</div><div style={{ fontWeight: 700 }}>{currentInvoice.number} — {fmtMoney(currentInvoice.total || 0)}</div></div>}<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Justificatifs ({reviewAttachments.length})</div>{reviewAttachments.length === 0 ? <div style={{ fontSize: 11, color: 'var(--text3)' }}>Aucune pièce jointe</div> : reviewAttachments.map(att => <div key={att.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}><span>{att.filename}</span><div style={{ display: 'flex', gap: 6 }}><button className="btn btn-outline btn-sm" style={{ padding: '2px 8px' }} onClick={() => onOpenAttachment(att.id)}><Eye size={12} /></button><button className="btn btn-outline btn-sm" style={{ padding: '2px 8px' }} onClick={() => onDeleteAttachment(att.id)}><Trash2 size={12} /></button></div></div>)}</div></div></>; }
function ShiftPill({ shift, onClick }) { return <div className="shift-pill" onClick={onClick} style={{ background: shift.status === 'draft' ? 'var(--surface2)' : 'var(--brand-l)', cursor: 'pointer' }}><div style={{ fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap' }}>{normalizeTimeForInput(shift.start) || shift.start}–{normalizeTimeForInput(shift.end) || shift.end}</div><div style={{ color: 'var(--text3)', fontSize: 9 }}>{shift.hours}h{shift.pause > 0 && <span style={{ color: 'var(--amber)' }}> (−{pauseHoursToMinutes(shift.pause)} min)</span>}</div></div>; }
