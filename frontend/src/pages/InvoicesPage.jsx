import React, { useState, useEffect, useCallback, useMemo } from 'react';

const API = import.meta.env.VITE_API_URL || '/api';
const fmt = (n) => { if (n == null || isNaN(n)) return '$0.00'; return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n); };
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }); };
const fmtDateTime = (d) => { if (!d) return '—'; return new Date(d).toLocaleString('fr-CA'); };
const getToken = () => localStorage.getItem('sep_token');
const apiFetch = async (path, opts = {}) => {
  const token = getToken();
  if (!token && !path.includes('/auth/')) {
    throw new Error('Non authentifié — veuillez vous reconnecter');
  }
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = err.detail || 'API Error';
    if (res.status === 401 && detail.includes('authentifié')) {
      throw new Error('Session expirée — veuillez vous reconnecter');
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
};

const statusConfig = {
  draft: { label: 'Brouillon', bg: '#6C757D', text: '#fff' },
  validated: { label: 'Validée', bg: '#2A7B88', text: '#fff' },
  sent: { label: 'Envoyée', bg: '#0D6EFD', text: '#fff' },
  partially_paid: { label: 'Partiel', bg: '#FFC107', text: '#000' },
  paid: { label: 'Payée', bg: '#28A745', text: '#fff' },
  cancelled: { label: 'Annulée', bg: '#DC3545', text: '#fff' }
};

const StatusBadge = ({ status }) => {
  const cfg = statusConfig[status] || statusConfig.draft;
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, backgroundColor: cfg.bg, color: cfg.text, letterSpacing: 0.3 }}>
      {cfg.label}
    </span>
  );
};

const getLastSunday = () => {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d;
};
const getSaturday = (sun) => {
  const d = new Date(sun);
  d.setDate(d.getDate() + 6);
  return d;
};
const toISO = (d) => d.toISOString().split('T')[0];

const S = {
  page: { fontFamily: "'Plus Jakarta Sans', 'Segoe UI', sans-serif", color: '#212529', minHeight: '100vh' },
  tabs: { display: 'flex', gap: 4, borderBottom: '2px solid #e9ecef', marginBottom: 20, flexWrap: 'wrap' },
  tab: (active) => ({
    padding: '10px 18px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? '#2A7B88' : '#6C757D',
    borderBottom: active ? '3px solid #2A7B88' : '3px solid transparent',
    transition: 'all 0.2s',
    background: 'none',
    border: 'none',
    marginBottom: -2
  }),
  card: { background: '#fff', borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.07)', padding: 20, marginBottom: 16 },
  statCard: (color) => ({
    background: '#fff',
    borderRadius: 10,
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
    padding: '16px 20px',
    borderLeft: `4px solid ${color}`,
    flex: '1 1 200px',
    minWidth: 180
  }),
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 },
  th: {
    padding: '10px 12px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#fff',
    background: '#2A7B88',
    whiteSpace: 'nowrap'
  },
  td: { padding: '9px 12px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' },
  trHover: { cursor: 'pointer', transition: 'background 0.15s' },
  btn: (variant = 'primary', size = 'sm') => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: size === 'sm' ? '6px 14px' : '10px 20px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: size === 'sm' ? 12 : 14,
    fontWeight: 600,
    transition: 'all 0.2s',
    letterSpacing: 0.2,
    ...(variant === 'primary' ? { background: '#2A7B88', color: '#fff' } : {}),
    ...(variant === 'success' ? { background: '#28A745', color: '#fff' } : {}),
    ...(variant === 'danger' ? { background: '#DC3545', color: '#fff' } : {}),
    ...(variant === 'warning' ? { background: '#FFC107', color: '#000' } : {}),
    ...(variant === 'outline' ? { background: 'transparent', color: '#2A7B88', border: '1.5px solid #2A7B88' } : {}),
    ...(variant === 'ghost' ? { background: 'transparent', color: '#6C757D' } : {})
  }),
  input: { padding: '8px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, outline: 'none', fontFamily: 'inherit' },
  select: { padding: '8px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#fff' },
  flexRow: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  flexBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#2A7B88', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 },
  empty: { textAlign: 'center', padding: 40, color: '#adb5bd', fontSize: 14 },
  modal: { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' },
  modalContent: { position: 'relative', background: '#fff', borderRadius: 12, padding: 24, maxWidth: 960, width: '95%', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
};

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={S.modal}>
      <div style={S.modalOverlay} onClick={onClose} />
      <div style={S.modalContent}>
        <div style={{ ...S.flexBetween, marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#2A7B88' }}>{title}</h3>
          <button onClick={onClose} style={{ ...S.btn('ghost'), fontSize: 18, padding: 4 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function InvoicesPage() {
  const [activeTab, setActiveTab] = useState('list');
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [filterStatus, setFilterStatus] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [filterClientId, setFilterClientId] = useState('');
  const [filterEmployeeId, setFilterEmployeeId] = useState('');

  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const sun = getLastSunday();
  const [genStart, setGenStart] = useState(toISO(sun));
  const [genEnd, setGenEnd] = useState(toISO(getSaturday(sun)));
  const [genSingleClientId, setGenSingleClientId] = useState('');
  const [genSingleEmployeeId, setGenSingleEmployeeId] = useState('');

  // Manual invoice creation state
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualClientId, setManualClientId] = useState('');
  const [manualEmployeeId, setManualEmployeeId] = useState('');
  const [manualPeriodStart, setManualPeriodStart] = useState('');
  const [manualPeriodEnd, setManualPeriodEnd] = useState('');
  const [manualDueDate, setManualDueDate] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualPoNumber, setManualPoNumber] = useState('');
  const [manualIncludeTax, setManualIncludeTax] = useState(true);
  const [manualLines, setManualLines] = useState([]);
  const [manualExpenseLines, setManualExpenseLines] = useState([]);

  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [reportData, setReportData] = useState(null);
  const [reportType, setReportType] = useState('by-client');
  const [anomalies, setAnomalies] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [selected, setSelected] = useState(new Set());

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterSearch) params.set('search', filterSearch);
      if (filterClientId) params.set('client_id', filterClientId);
      if (filterEmployeeId) params.set('employee_id', filterEmployeeId);
      const qs = params.toString();
      const data = await apiFetch(`/invoices/${qs ? '?' + qs : ''}`);
      setInvoices(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [filterStatus, filterSearch, filterClientId, filterEmployeeId]);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiFetch('/invoices/stats');
      setStats(data);
    } catch (_) {}
  }, []);

  const loadClients = useCallback(async () => {
    try { setClients(await apiFetch('/clients/')); } catch (_) {}
  }, []);

  const loadEmployees = useCallback(async () => {
    try { setEmployees(await apiFetch('/employees/')); } catch (_) {}
  }, []);

  useEffect(() => {
    loadInvoices();
    loadStats();
    loadClients();
    loadEmployees();
  }, []);

  useEffect(() => { loadInvoices(); }, [filterStatus, filterSearch, filterClientId, filterEmployeeId]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(''), 4000);
      return () => clearTimeout(t);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(''), 6000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const openDetail = async (id) => {
    try {
      const inv = await apiFetch(`/invoices/${id}`);
      setSelectedInvoice(inv);
      setActiveTab('detail');
    } catch (e) {
      setError(e.message);
    }
  };

  const changeStatus = async (id, newStatus) => {
    try {
      await apiFetch(`/invoices/${id}/status`, { method: 'POST', body: JSON.stringify({ new_status: newStatus }) });
      setSuccess(`Statut changé → ${statusConfig[newStatus]?.label || newStatus}`);
      if (selectedInvoice?.id === id) openDetail(id);
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const markPaid = async (id) => {
    try {
      await apiFetch(`/invoices/${id}/mark-paid`, { method: 'POST' });
      setSuccess('Facture marquée payée');
      if (selectedInvoice?.id === id) openDetail(id);
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const duplicateInvoice = async (id) => {
    try {
      const inv = await apiFetch(`/invoices/${id}/duplicate`, { method: 'POST' });
      setSuccess(`Facture dupliquée: ${inv.number}`);
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteInvoice = async (id) => {
    if (!confirm('Supprimer cette facture?')) return;
    try {
      await apiFetch(`/invoices/${id}`, { method: 'DELETE' });
      setSuccess('Facture supprimée');
      if (selectedInvoice?.id === id) {
        setSelectedInvoice(null);
        setActiveTab('list');
      }
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const openPdf = (id) => {
    const token = getToken();
    window.open(`${API}/invoices/${id}/pdf?token=${token}`, '_blank');
  };

  const emailInvoice = async (id) => {
    try {
      const res = await apiFetch(`/invoices/${id}/email`, { method: 'POST' });
      setSuccess(res.message || 'Courriel envoyé');
      if (selectedInvoice?.id === id) openDetail(id);
      loadInvoices();
    } catch (e) {
      setError(e.message);
    }
  };

  const testBillingEmail = async () => {
    const toEmail = window.prompt("Adresse pour le test de courriel (laisser vide = votre compte admin):", "") || "";
    try {
      const res = await apiFetch('/invoices/test-email', {
        method: 'POST',
        body: JSON.stringify({ to_email: toEmail || null })
      });
      setSuccess(res.message || 'Test courriel OK');
    } catch (e) {
      setError(e.message);
    }
  };

  const generateInvoices = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/invoices/generate', {
        method: 'POST',
        body: JSON.stringify({ period_start: genStart, period_end: genEnd })
      });
      setSuccess(`${data.length} facture(s) générée(s)`);
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const generateSingleInvoice = async () => {
    if (!genSingleEmployeeId || !genSingleClientId) {
      setError('Sélectionne un employé et un client');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch('/invoices/generate-from-schedules', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: Number(genSingleEmployeeId),
          client_id: Number(genSingleClientId),
          period_start: genStart,
          period_end: genEnd
        })
      });
      setSuccess(`Facture ${data.number} générée`);
      await loadInvoices();
      await loadStats();
      if (data.id) await openDetail(data.id);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const calcHoursUtil = (start, end, pauseMin = 0) => {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    if (endMins <= startMins) endMins += 24 * 60;
    return Math.round(Math.max(0, (endMins - startMins - (parseFloat(pauseMin) || 0)) / 60) * 100) / 100;
  };

  const addManualLine = () => {
    setManualLines(prev => [...prev, { date: manualPeriodStart || '', employee: '', location: '', start: '07:00', end: '15:00', pause_min: 0, hours: 8, rate: 86.23, service_amount: 689.84, garde_hours: 0, garde_amount: 0, rappel_hours: 0, rappel_amount: 0 }]);
  };

  const updateManualLine = (idx, field, value) => {
    setManualLines(prev => {
      const next = [...prev];
      const updated = { ...next[idx], [field]: value };
      if (['start', 'end', 'pause_min'].includes(field)) {
        const s = field === 'start' ? value : updated.start;
        const e = field === 'end' ? value : updated.end;
        const p = field === 'pause_min' ? value : updated.pause_min;
        if (s && e) {
          updated.hours = calcHoursUtil(s, e, p);
          updated.service_amount = parseFloat((updated.hours * (parseFloat(updated.rate) || 0)).toFixed(2));
        }
      }
      if (['hours', 'rate'].includes(field)) {
        const h = field === 'hours' ? parseFloat(value) || 0 : parseFloat(updated.hours) || 0;
        const r = field === 'rate' ? parseFloat(value) || 0 : parseFloat(updated.rate) || 0;
        updated.service_amount = parseFloat((h * r).toFixed(2));
      }
      next[idx] = updated;
      return next;
    });
  };

  const addManualExpense = () => {
    setManualExpenseLines(prev => [...prev, { type: 'km', description: 'Kilométrage', quantity: 0, rate: 0.525, amount: 0 }]);
  };

  const updateManualExpense = (idx, field, value) => {
    setManualExpenseLines(prev => {
      const next = [...prev];
      const updated = { ...next[idx], [field]: value };
      if (['quantity', 'rate'].includes(field)) {
        updated.amount = parseFloat(((parseFloat(updated.quantity) || 0) * (parseFloat(updated.rate) || 0)).toFixed(2));
      }
      next[idx] = updated;
      return next;
    });
  };

  const createManualInvoice = async () => {
    if (!manualClientId) { setError('Client requis'); return; }
    if (!manualPeriodStart || !manualPeriodEnd) { setError('Période requise'); return; }
    setLoading(true);
    try {
      const processedLines = manualLines.map(l => ({
        ...l,
        hours: parseFloat(l.hours) || 0,
        pause_min: parseFloat(l.pause_min) || 0,
        rate: parseFloat(l.rate) || 0,
        service_amount: (parseFloat(l.hours) || 0) * (parseFloat(l.rate) || 0),
        garde_hours: parseFloat(l.garde_hours) || 0,
        garde_amount: ((parseFloat(l.garde_hours) || 0) / 8) * 86.23,
        rappel_hours: parseFloat(l.rappel_hours) || 0,
        rappel_amount: (parseFloat(l.rappel_hours) || 0) * (parseFloat(l.rate) || 0),
      }));
      const processedExpenses = manualExpenseLines.map(e => ({
        ...e,
        quantity: parseFloat(e.quantity) || 0,
        rate: parseFloat(e.rate) || 0,
        amount: (parseFloat(e.quantity) || 0) * (parseFloat(e.rate) || 0),
      }));
      const data = await apiFetch('/invoices/', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(manualClientId),
          employee_id: manualEmployeeId ? Number(manualEmployeeId) : null,
          period_start: manualPeriodStart,
          period_end: manualPeriodEnd,
          due_date: manualDueDate || null,
          notes: manualNotes,
          po_number: manualPoNumber,
          include_tax: manualIncludeTax,
          lines: processedLines,
          expense_lines: processedExpenses,
          accommodation_lines: [],
          extra_lines: [],
        })
      });
      setSuccess(`Facture ${data.number} créée manuellement`);
      setShowManualForm(false);
      setManualLines([]);
      setManualExpenseLines([]);
      setManualClientId(''); setManualEmployeeId(''); setManualNotes(''); setManualPoNumber('');
      await loadInvoices();
      await loadStats();
      if (data.id) await openDetail(data.id);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const loadReport = async (type) => {
    setReportType(type);
    try {
      const data = await apiFetch(`/invoices/reports/${type}`);
      setReportData(data);
    } catch (e) {
      setError(e.message);
    }
  };

  const loadAnomalies = async () => {
    try {
      const data = await apiFetch('/invoices/anomalies/check');
      setAnomalies(data);
    } catch (e) {
      setError(e.message);
    }
  };

  const loadCreditNotes = async () => {
    try {
      const data = await apiFetch('/invoices/credit-notes/all');
      setCreditNotes(data);
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === invoices.length) setSelected(new Set());
    else setSelected(new Set(invoices.map(i => i.id)));
  };

  const bulkValidate = async () => {
    try {
      const res = await apiFetch('/invoices/bulk/validate', { method: 'POST', body: JSON.stringify([...selected]) });
      setSuccess(`${res.validated?.length || 0} facture(s) validée(s)`);
      setSelected(new Set());
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const bulkSend = async () => {
    try {
      const res = await apiFetch('/invoices/bulk/send', { method: 'POST', body: JSON.stringify([...selected]) });
      const sentCount = res.sent?.length || 0;
      const skipped = res.skipped || [];
      if (sentCount === 0 && skipped.length > 0) {
        const reasons = skipped.slice(0, 3).map(item => item.reason).filter(Boolean).join(' | ');
        setError(`Aucune facture envoyee. ${reasons || `${skipped.length} facture(s) ignoree(s)`}`);
        setSelected(new Set());
        loadInvoices();
        loadStats();
        return;
      }
      setSuccess(`${res.sent?.length || 0} facture(s) envoyée(s)`);
      setSelected(new Set());
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const bulkDelete = async () => {
    if (!confirm(`Supprimer ${selected.size} facture(s) sélectionnée(s)? (brouillon/validées/annulées seulement)`)) return;
    try {
      const res = await apiFetch('/invoices/bulk/delete', { method: 'POST', body: JSON.stringify([...selected]) });
      const count = res.deleted?.length || 0;
      const skippedCount = res.skipped?.length || 0;
      let msg = `${count} facture(s) supprimée(s)`;
      if (skippedCount > 0) msg += ` — ${skippedCount} ignorée(s)`;
      setSuccess(msg);
      setSelected(new Set());
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div style={S.page}>
      {success && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, background: '#28A745', color: '#fff', padding: '12px 20px', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', fontSize: 13, fontWeight: 600, maxWidth: 400 }}>
          ✓ {success}
        </div>
      )}
      {error && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, background: '#DC3545', color: '#fff', padding: '12px 20px', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', fontSize: 13, fontWeight: 600, maxWidth: 400 }}>
          ✗ {error}
        </div>
      )}

      {stats && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={S.statCard('#2A7B88')}>
            <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>Total facturé</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#2A7B88' }}>{fmt(stats.total_invoiced)}</div>
          </div>
          <div style={S.statCard('#28A745')}>
            <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>Payé</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#28A745' }}>{fmt(stats.total_paid)}</div>
          </div>
          <div style={S.statCard('#FFC107')}>
            <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>En cours</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#FFC107' }}>{fmt(stats.total_outstanding)}</div>
          </div>
          <div style={S.statCard('#DC3545')}>
            <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>En retard</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#DC3545' }}>{fmt(stats.total_overdue)}</div>
          </div>
          <div style={S.statCard('#6C757D')}>
            <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>Factures</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#212529' }}>{stats.count}</div>
          </div>
        </div>
      )}

      <nav style={S.tabs}>
        {[
          { id: 'list', label: '📋 Factures' },
          { id: 'generate', label: '⚡ Générer' },
          { id: 'detail', label: '🔍 Détail', hidden: !selectedInvoice },
          { id: 'reports', label: '📊 Rapports' },
          { id: 'creditNotes', label: '📝 Notes de crédit' },
          { id: 'anomalies', label: '⚠️ Anomalies' },
        ].filter(t => !t.hidden).map(t => (
          <button
            key={t.id}
            style={S.tab(activeTab === t.id)}
            onClick={() => {
              setActiveTab(t.id);
              if (t.id === 'reports' && !reportData) loadReport('by-client');
              if (t.id === 'anomalies') loadAnomalies();
              if (t.id === 'creditNotes') loadCreditNotes();
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'list' && (
        <div>
          <div style={{ ...S.flexBetween, marginBottom: 16 }}>
            <div style={S.flexRow}>
              <input
                style={{ ...S.input, width: 220 }}
                placeholder="Rechercher (# facture, client, employé)..."
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
              />
              <select style={S.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">Tous les statuts</option>
                {Object.entries(statusConfig).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <select style={S.select} value={filterClientId} onChange={e => setFilterClientId(e.target.value)}>
                <option value="">Tous les clients</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select style={S.select} value={filterEmployeeId} onChange={e => setFilterEmployeeId(e.target.value)}>
                <option value="">Tous les employés</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
              <button style={S.btn('outline')} onClick={testBillingEmail}>Tester courriel</button>
            </div>
            <div style={S.flexRow}>
              {selected.size > 0 && (
                <>
                  <span style={{ fontSize: 12, color: '#6C757D' }}>{selected.size} sélectionnée(s)</span>
                  <button style={S.btn('primary')} onClick={bulkValidate}>✓ Valider</button>
                  <button style={S.btn('outline')} onClick={bulkSend}>📤 Envoyer</button>
                  <button style={S.btn('danger')} onClick={bulkDelete}>🗑 Supprimer</button>
                </>
              )}
              <button style={S.btn('primary')} onClick={() => setActiveTab('generate')}>+ Générer factures</button>
            </div>
          </div>

          {loading ? (
            <div style={S.empty}>Chargement...</div>
          ) : invoices.length === 0 ? (
            <div style={S.empty}>Aucune facture trouvée</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, borderRadius: '8px 0 0 0', width: 30 }}>
                      <input type="checkbox" checked={selected.size === invoices.length && invoices.length > 0} onChange={toggleAll} />
                    </th>
                    <th style={S.th}>Numéro</th>
                    <th style={S.th}>Date</th>
                    <th style={S.th}>Période</th>
                    <th style={S.th}>Client</th>
                    <th style={S.th}>Employé</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Payé</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Solde</th>
                    <th style={S.th}>Statut</th>
                    <th style={{ ...S.th, borderRadius: '0 8px 0 0' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, i) => (
                    <tr
                      key={inv.id}
                      style={{ ...S.trHover, background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#e8f4f6'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#f8f9fa'}
                    >
                      <td style={S.td} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleSelect(inv.id)} />
                      </td>
                      <td style={{ ...S.td, fontWeight: 600, color: '#2A7B88', cursor: 'pointer' }} onClick={() => openDetail(inv.id)}>
                        {inv.number}
                      </td>
                      <td style={S.td}>{fmtDate(inv.date)}</td>
                      <td style={{ ...S.td, fontSize: 11 }}>{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</td>
                      <td style={S.td}>{inv.client_name}</td>
                      <td style={S.td}>
                        <div>{inv.employee_name}</div>
                        <div style={{ fontSize: 10, color: '#6C757D' }}>{inv.employee_title}</div>
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(inv.total)}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: '#28A745' }}>{fmt(inv.amount_paid)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: inv.balance_due > 0 ? '#DC3545' : '#28A745' }}>{fmt(inv.balance_due)}</td>
                      <td style={S.td}><StatusBadge status={inv.status} /></td>
                      <td style={S.td} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button style={S.btn('ghost')} title="PDF" onClick={() => openPdf(inv.id)}>📄</button>
                          <button style={S.btn('ghost')} title="Détail" onClick={() => openDetail(inv.id)}>👁</button>
                          {(inv.status === 'draft' || inv.status === 'validated' || inv.status === 'cancelled') && (
                            <button style={S.btn('ghost')} title="Supprimer" onClick={() => deleteInvoice(inv.id)}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'generate' && (
        <div style={S.card}>
          <h3 style={S.sectionTitle}>⚡ Générer les factures brouillon</h3>
          <p style={{ fontSize: 13, color: '#6C757D', marginBottom: 16 }}>
            Génère automatiquement 1 facture par employé par client pour la période sélectionnée, à partir des horaires et FDT soumises.
          </p>

          <div style={{ ...S.flexRow, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Début période (Dimanche)</label>
              <input type="date" style={S.input} value={genStart} onChange={e => setGenStart(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fin période (Samedi)</label>
              <input type="date" style={S.input} value={genEnd} onChange={e => setGenEnd(e.target.value)} />
            </div>
          </div>

          <div style={S.flexRow}>
            <button style={S.btn('primary', 'md')} onClick={generateInvoices} disabled={loading}>
              {loading ? 'Génération en cours...' : '⚡ Générer les factures'}
            </button>
            <button style={S.btn('outline')} onClick={() => setActiveTab('list')}>← Retour à la liste</button>
          </div>

          <div style={{ marginTop: 20, padding: 16, background: '#E8F4F6', borderRadius: 8, fontSize: 12, color: '#1D5A63' }}>
            <strong>Règles de génération:</strong>
            <ul style={{ margin: '8px 0 0 16px', lineHeight: 1.8 }}>
              <li>1 facture par employé par client pour la période</li>
              <li>Les doublons (même employé + même période) sont ignorés</li>
              <li>Taux: Inf. 86.23$/h, Inf. aux. 57.18$/h, PAB 50.35$/h</li>
              <li>Garde: 8h = 1h facturable à 86.23$/h</li>
              <li>Km: 0.525$/km (max 750km), Déplacement: heures × taux</li>
              <li>Clients exemptés TPS/TVQ: Inuulitsivik, Conseil Cri</li>
            </ul>
          </div>

          <div style={{ ...S.card, marginTop: 20, background: '#f8f9fa', border: '1px solid #dee2e6' }}>
            <h4 style={{ ...S.sectionTitle, fontSize: 13 }}>🎯 Générer une facture unique</h4>
            <div style={{ ...S.flexRow, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Employé</label>
                <select style={S.select} value={genSingleEmployeeId} onChange={e => setGenSingleEmployeeId(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label>
                <select style={S.select} value={genSingleClientId} onChange={e => setGenSingleClientId(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button style={S.btn('primary', 'md')} onClick={generateSingleInvoice} disabled={loading || !genSingleEmployeeId || !genSingleClientId}>
              {loading ? 'Génération en cours...' : 'Créer la facture unique (depuis horaire)'}
            </button>
            <p style={{ fontSize: 10, color: '#6C757D', marginTop: 6 }}>⚠️ Requiert des quarts existants dans l'horaire</p>
          </div>

          {/* Manual invoice creation — no schedule needed */}
          <div style={{ ...S.card, marginTop: 20, background: '#FFF3E0', border: '1px solid #FFB74D' }}>
            <div style={{ ...S.flexBetween, marginBottom: 10 }}>
              <h4 style={{ ...S.sectionTitle, fontSize: 13, margin: 0 }}>📝 Créer une facture manuelle</h4>
              <button style={S.btn(showManualForm ? 'outline' : 'primary')} onClick={() => { setShowManualForm(!showManualForm); if (!showManualForm && manualLines.length === 0) addManualLine(); }}>
                {showManualForm ? 'Masquer' : '+ Nouvelle facture manuelle'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: '#6C757D', marginBottom: 8 }}>Créer une facture sans avoir besoin de quarts dans l'horaire</p>

            {showManualForm && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Client *</label>
                    <select style={S.select} value={manualClientId} onChange={e => setManualClientId(e.target.value)}>
                      <option value="">— Sélectionner —</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Employé (optionnel)</label>
                    <select style={S.select} value={manualEmployeeId} onChange={e => setManualEmployeeId(e.target.value)}>
                      <option value="">— Aucun —</option>
                      {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Début période *</label>
                    <input type="date" style={S.input} value={manualPeriodStart} onChange={e => setManualPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Fin période *</label>
                    <input type="date" style={S.input} value={manualPeriodEnd} onChange={e => setManualPeriodEnd(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>No PO</label>
                    <input style={S.input} value={manualPoNumber} onChange={e => setManualPoNumber(e.target.value)} placeholder="PO-001" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Date échéance</label>
                    <input type="date" style={S.input} value={manualDueDate} onChange={e => setManualDueDate(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Notes</label>
                    <input style={S.input} value={manualNotes} onChange={e => setManualNotes(e.target.value)} placeholder="Notes..." />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={manualIncludeTax} onChange={e => setManualIncludeTax(e.target.checked)} /> Inclure TPS/TVQ
                    </label>
                  </div>
                </div>

                {/* Service lines */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ ...S.flexBetween, marginBottom: 6 }}>
                    <h5 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Lignes de service (quarts)</h5>
                    <button style={{ ...S.btn('outline'), fontSize: 10, padding: '2px 8px' }} onClick={addManualLine}>+ Ajouter ligne</button>
                  </div>
                  {manualLines.length > 0 && (
                    <table style={{ ...S.table, fontSize: 11 }}>
                      <thead>
                        <tr>
                          {['Date', 'Début', 'Fin', 'Pause (min)', 'Heures', 'Taux', 'Montant', ''].map(h => (
                            <th key={h} style={{ ...S.th, fontSize: 10, padding: '4px 6px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {manualLines.map((l, i) => (
                          <tr key={i}>
                            <td style={S.td}><input type="date" style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 110 }} value={l.date} onChange={e => updateManualLine(i, 'date', e.target.value)} /></td>
                            <td style={S.td}><input style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 55 }} value={l.start} onChange={e => updateManualLine(i, 'start', e.target.value)} placeholder="07:00" /></td>
                            <td style={S.td}><input style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 55 }} value={l.end} onChange={e => updateManualLine(i, 'end', e.target.value)} placeholder="15:00" /></td>
                            <td style={S.td}><input type="number" style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 50 }} value={l.pause_min} onChange={e => updateManualLine(i, 'pause_min', e.target.value)} /></td>
                            <td style={S.td}><input type="number" step="0.25" style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 50 }} value={l.hours} onChange={e => updateManualLine(i, 'hours', e.target.value)} /></td>
                            <td style={S.td}><input type="number" step="0.01" style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 60 }} value={l.rate} onChange={e => updateManualLine(i, 'rate', e.target.value)} /></td>
                            <td style={{ ...S.td, fontWeight: 600, textAlign: 'right' }}>{fmt(l.service_amount || 0)}</td>
                            <td style={S.td}><button style={{ color: '#DC3545', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12 }} onClick={() => setManualLines(p => p.filter((_, j) => j !== i))}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Expense lines */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ ...S.flexBetween, marginBottom: 6 }}>
                    <h5 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Frais / Dépenses</h5>
                    <button style={{ ...S.btn('outline'), fontSize: 10, padding: '2px 8px' }} onClick={addManualExpense}>+ Ajouter frais</button>
                  </div>
                  {manualExpenseLines.length > 0 && (
                    <table style={{ ...S.table, fontSize: 11 }}>
                      <thead>
                        <tr>
                          {['Type', 'Description', 'Quantité', 'Taux', 'Montant', ''].map(h => (
                            <th key={h} style={{ ...S.th, fontSize: 10, padding: '4px 6px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {manualExpenseLines.map((e, i) => (
                          <tr key={i}>
                            <td style={S.td}>
                              <select style={{ ...S.select, fontSize: 10, padding: '3px 4px', width: 100 }} value={e.type} onChange={ev => updateManualExpense(i, 'type', ev.target.value)}>
                                <option value="km">Kilométrage</option>
                                <option value="deplacement">Déplacement</option>
                                <option value="autre">Autre</option>
                              </select>
                            </td>
                            <td style={S.td}><input style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 130 }} value={e.description} onChange={ev => updateManualExpense(i, 'description', ev.target.value)} /></td>
                            <td style={S.td}><input type="number" step="0.01" style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 60 }} value={e.quantity} onChange={ev => updateManualExpense(i, 'quantity', ev.target.value)} /></td>
                            <td style={S.td}><input type="number" step="0.01" style={{ ...S.input, fontSize: 10, padding: '3px 4px', width: 60 }} value={e.rate} onChange={ev => updateManualExpense(i, 'rate', ev.target.value)} /></td>
                            <td style={{ ...S.td, fontWeight: 600, textAlign: 'right' }}>{fmt(e.amount || 0)}</td>
                            <td style={S.td}><button style={{ color: '#DC3545', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12 }} onClick={() => setManualExpenseLines(p => p.filter((_, j) => j !== i))}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div style={S.flexRow}>
                  <button style={S.btn('primary', 'md')} onClick={createManualInvoice} disabled={loading || !manualClientId}>
                    {loading ? 'Création en cours...' : '📝 Créer la facture manuelle'}
                  </button>
                  <button style={S.btn('outline')} onClick={() => { setShowManualForm(false); setManualLines([]); setManualExpenseLines([]); }}>Annuler</button>
                  <span style={{ fontSize: 11, color: '#6C757D' }}>
                    Total lignes: {fmt(manualLines.reduce((s, l) => s + (parseFloat(l.service_amount) || 0), 0) + manualExpenseLines.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'detail' && selectedInvoice && (
        <InvoiceDetail
          invoice={selectedInvoice}
          onBack={() => setActiveTab('list')}
          onRefresh={() => openDetail(selectedInvoice.id)}
          onStatusChange={changeStatus}
          onMarkPaid={markPaid}
          onDuplicate={duplicateInvoice}
          onDelete={deleteInvoice}
          onPdf={openPdf}
          onEmail={emailInvoice}
          setError={setError}
          setSuccess={setSuccess}
          loadInvoices={loadInvoices}
          loadStats={loadStats}
          clients={clients}
          employees={employees}
        />
      )}

      {activeTab === 'reports' && (
        <ReportsTab
          reportData={reportData}
          reportType={reportType}
          onLoadReport={loadReport}
          onOpenInvoice={openDetail}
          onMarkPaid={markPaid}
          clients={clients}
          setError={setError}
          setSuccess={setSuccess}
          loadClients={loadClients}
        />
      )}

      {activeTab === 'creditNotes' && (
        <CreditNotesTab
          creditNotes={creditNotes}
          onRefresh={loadCreditNotes}
          setError={setError}
          setSuccess={setSuccess}
          clients={clients}
          invoices={invoices}
        />
      )}

      {activeTab === 'anomalies' && (
        <AnomaliesTab anomalies={anomalies} onRefresh={loadAnomalies} onOpenInvoice={openDetail} />
      )}
    </div>
  );
}

function InvoiceDetail({ invoice: inv, onBack, onRefresh, onStatusChange, onMarkPaid, onDuplicate, onDelete, onPdf, onEmail, setError, setSuccess, loadInvoices, loadStats, clients, employees }) {
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(toISO(new Date()));
  const [payRef, setPayRef] = useState('');
  const [payMethod, setPayMethod] = useState('virement');
  const [detailTab, setDetailTab] = useState('lines');

  const [showEdit, setShowEdit] = useState(false);
  const [editClientId, setEditClientId] = useState(inv.client_id || '');
  const [editEmployeeId, setEditEmployeeId] = useState(inv.employee_id || '');
  const [editNotes, setEditNotes] = useState(inv.notes || '');
  const [editPoNumber, setEditPoNumber] = useState(inv.po_number || '');
  const [editDueDate, setEditDueDate] = useState(inv.due_date || '');
  const [editIncludeTax, setEditIncludeTax] = useState(!!inv.include_tax);
  const [editLines, setEditLines] = useState(JSON.parse(JSON.stringify(inv.lines || [])));
  const [editExpenseLines, setEditExpenseLines] = useState(JSON.parse(JSON.stringify(inv.expense_lines || [])));
  const [editAccomLines, setEditAccomLines] = useState(JSON.parse(JSON.stringify(inv.accommodation_lines || [])));

  useEffect(() => {
    setEditClientId(inv.client_id || '');
    setEditEmployeeId(inv.employee_id || '');
    setEditNotes(inv.notes || '');
    setEditPoNumber(inv.po_number || '');
    setEditDueDate(inv.due_date || '');
    setEditIncludeTax(!!inv.include_tax);
    setEditLines(JSON.parse(JSON.stringify(inv.lines || [])));
    setEditExpenseLines(JSON.parse(JSON.stringify(inv.expense_lines || [])));
    setEditAccomLines(JSON.parse(JSON.stringify(inv.accommodation_lines || [])));
  }, [inv.id]);

  const [attachments, setAttachments] = useState([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attUploading, setAttUploading] = useState(false);
  const [attCategory, setAttCategory] = useState('hebergement');
  const [attDescription, setAttDescription] = useState('');

  const loadAttachments = useCallback(async () => {
    try {
      setAttLoading(true);
      const data = await apiFetch(`/invoices/${inv.id}/attachments`);
      setAttachments(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setAttLoading(false);
    }
  }, [inv.id]);

  useEffect(() => { loadAttachments(); }, [loadAttachments]);

  const saveInvoiceEdits = async () => {
    try {
      // Recalculate service_amount for each line
      const processedLines = editLines.map(l => ({
        ...l,
        hours: parseFloat(l.hours) || 0,
        pause_min: parseFloat(l.pause_min) || 0,
        rate: parseFloat(l.rate) || 0,
        service_amount: (parseFloat(l.hours) || 0) * (parseFloat(l.rate) || 0),
        garde_hours: parseFloat(l.garde_hours) || 0,
        garde_amount: ((parseFloat(l.garde_hours) || 0) / 8) * 86.23,
        rappel_hours: parseFloat(l.rappel_hours) || 0,
        rappel_amount: (parseFloat(l.rappel_hours) || 0) * (parseFloat(l.rate) || 0),
      }));
      // Recalculate expense amounts
      const processedExpenses = editExpenseLines.map(e => ({
        ...e,
        quantity: parseFloat(e.quantity) || 0,
        rate: parseFloat(e.rate) || 0,
        amount: (parseFloat(e.quantity) || 0) * (parseFloat(e.rate) || 0),
      }));
      // Recalculate accommodation amounts
      const processedAccom = editAccomLines.map(a => ({
        ...a,
        days: parseFloat(a.days) || 0,
        cost_per_day: parseFloat(a.cost_per_day) || 0,
        amount: (parseFloat(a.days) || 0) * (parseFloat(a.cost_per_day) || 0),
      }));

      await apiFetch(`/invoices/${inv.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          client_id: editClientId ? Number(editClientId) : null,
          employee_id: editEmployeeId ? Number(editEmployeeId) : null,
          notes: editNotes,
          po_number: editPoNumber,
          due_date: editDueDate || null,
          include_tax: editIncludeTax,
          lines: processedLines,
          expense_lines: processedExpenses,
          accommodation_lines: processedAccom,
        })
      });
      setSuccess('Facture modifiée');
      setShowEdit(false);
      await onRefresh();
      await loadInvoices();
      await loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  // Auto-calculate billable hours: (end - start) - pause
  const calcHours = (start, end, pauseMin = 0) => {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    if (endMins <= startMins) endMins += 24 * 60; // overnight shift
    const totalMins = endMins - startMins - (parseFloat(pauseMin) || 0);
    return Math.round(Math.max(0, totalMins / 60) * 100) / 100;
  };

  const updateEditLine = (idx, field, value) => {
    setEditLines(prev => {
      const next = [...prev];
      const updated = { ...next[idx], [field]: value };
      // Auto-recalculate hours when start, end, or pause_min changes
      if (['start', 'end', 'pause_min'].includes(field)) {
        const s = field === 'start' ? value : updated.start;
        const e = field === 'end' ? value : updated.end;
        const p = field === 'pause_min' ? value : updated.pause_min;
        if (s && e) {
          updated.hours = calcHours(s, e, p);
          updated.service_amount = parseFloat((updated.hours * (parseFloat(updated.rate) || 0)).toFixed(2));
        }
      }
      // Auto-recalculate service_amount when hours or rate changes directly
      if (['hours', 'rate'].includes(field)) {
        const h = field === 'hours' ? parseFloat(value) || 0 : parseFloat(updated.hours) || 0;
        const r = field === 'rate' ? parseFloat(value) || 0 : parseFloat(updated.rate) || 0;
        updated.service_amount = parseFloat((h * r).toFixed(2));
      }
      next[idx] = updated;
      return next;
    });
  };

  const removeEditLine = (idx) => {
    setEditLines(prev => prev.filter((_, i) => i !== idx));
  };

  const addEditLine = () => {
    setEditLines(prev => [...prev, { date: '', employee: inv.employee_name || '', location: inv.client_name || '', start: '', end: '', pause_min: 0, hours: 0, rate: editLines[0]?.rate || 0, service_amount: 0, garde_hours: 0, garde_amount: 0, rappel_hours: 0, rappel_amount: 0 }]);
  };

  const updateEditExpense = (idx, field, value) => {
    setEditExpenseLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const removeEditExpense = (idx) => {
    setEditExpenseLines(prev => prev.filter((_, i) => i !== idx));
  };

  const addEditExpense = (type) => {
    const defaults = {
      km: { type: 'km', description: 'Kilométrage', quantity: 0, rate: 0.525, amount: 0 },
      deplacement: { type: 'deplacement', description: 'Frais de déplacement', quantity: 0, rate: editLines[0]?.rate || 0, amount: 0 },
      autre: { type: 'autre', description: 'Autres frais', quantity: 1, rate: 0, amount: 0 },
    };
    setEditExpenseLines(prev => [...prev, defaults[type] || defaults.autre]);
  };

  const addEditAccom = () => {
    setEditAccomLines(prev => [...prev, { employee: inv.employee_name || '', period: '', days: 1, cost_per_day: 0, amount: 0 }]);
  };

  const updateEditAccom = (idx, field, value) => {
    setEditAccomLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'days' || field === 'cost_per_day') {
        next[idx].amount = Math.round((parseFloat(next[idx].days) || 0) * (parseFloat(next[idx].cost_per_day) || 0) * 100) / 100;
      }
      return next;
    });
  };

  const removeEditAccom = (idx) => {
    setEditAccomLines(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAttUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAttUploading(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', attCategory);
      formData.append('description', attDescription);
      formData.append('uploaded_by', 'admin');
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API}/invoices/${inv.id}/attachments`, { method: 'POST', headers, body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Erreur upload');
      }
      setSuccess('Pièce jointe ajoutée');
      setAttDescription('');
      loadAttachments();
    } catch (e) {
      setError(e.message);
    } finally {
      setAttUploading(false);
      e.target.value = '';
    }
  };

  const deleteAttachment = async (attId) => {
    if (!confirm('Supprimer cette pièce jointe?')) return;
    try {
      await apiFetch(`/invoices/${inv.id}/attachments/${attId}`, { method: 'DELETE' });
      setSuccess('Pièce jointe supprimée');
      loadAttachments();
    } catch (e) {
      setError(e.message);
    }
  };

  const viewAttachment = (attId) => {
    const token = getToken();
    window.open(`${API}/invoices/${inv.id}/attachments/${attId}?token=${token}`, '_blank');
  };

  const downloadPdfWithAttachments = () => {
    const token = getToken();
    window.open(`${API}/invoices/${inv.id}/pdf-with-attachments?include_attachments=true&token=${token}`, '_blank');
  };

  const fmtSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const catLabels = { hebergement: 'Hébergement', deplacement: 'Déplacement', kilometrage: 'Kilométrage', autre: 'Autre' };
  const typeIcons = { pdf: '📄', jpg: '🖼️', png: '🖼️', gif: '🖼️' };

  const addPayment = async () => {
    try {
      await apiFetch(`/invoices/${inv.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: parseFloat(payAmount), date: payDate, reference: payRef, method: payMethod })
      });
      setSuccess('Paiement enregistré');
      setShowPayment(false);
      setPayAmount('');
      setPayRef('');
      onRefresh();
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const deletePayment = async (paymentId) => {
    if (!confirm('Supprimer ce paiement?')) return;
    try {
      await apiFetch(`/invoices/${inv.id}/payments/${paymentId}`, { method: 'DELETE' });
      setSuccess('Paiement supprimé');
      onRefresh();
      loadInvoices();
      loadStats();
    } catch (e) {
      setError(e.message);
    }
  };

  const workflowActions = useMemo(() => {
    const actions = [];
    switch (inv.status) {
      case 'draft':
        actions.push({ label: 'Valider', status: 'validated', variant: 'primary', icon: '✓' });
        actions.push({ label: 'Annuler', status: 'cancelled', variant: 'danger', icon: '✗' });
        break;
      case 'validated':
        actions.push({ label: 'Marquer envoyée', status: 'sent', variant: 'primary', icon: '📤' });
        actions.push({ label: 'Paiement complet', fn: () => onMarkPaid(inv.id), variant: 'success', icon: '💰' });
        actions.push({ label: 'Retour brouillon', status: 'draft', variant: 'ghost', icon: '←' });
        break;
      case 'sent':
        actions.push({ label: 'Paiement complet', fn: () => onMarkPaid(inv.id), variant: 'success', icon: '💰' });
        actions.push({ label: 'Paiement partiel', fn: () => setShowPayment(true), variant: 'warning', icon: '💵' });
        break;
      case 'partially_paid':
        actions.push({ label: 'Paiement complet', fn: () => onMarkPaid(inv.id), variant: 'success', icon: '💰' });
        actions.push({ label: 'Ajout paiement', fn: () => setShowPayment(true), variant: 'warning', icon: '💵' });
        break;
      case 'paid':
        actions.push({ label: 'Réouvrir', status: 'sent', variant: 'outline', icon: '↩' });
        break;
      case 'cancelled':
        actions.push({ label: 'Réactiver', status: 'draft', variant: 'outline', icon: '↩' });
        break;
    }
    return actions;
  }, [inv.status, inv.id]);

  return (
    <div>
      <div style={{ ...S.flexBetween, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button style={S.btn('ghost')} onClick={onBack}>← Retour</button>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#2A7B88' }}>{inv.number}</h2>
          <StatusBadge status={inv.status} />
        </div>
        <div style={S.flexRow}>
          <button style={S.btn('outline')} onClick={() => setShowEdit(true)}>✏️ Modifier</button>
          <button style={S.btn('outline')} onClick={() => onPdf(inv.id)}>📄 PDF</button>
          <button style={S.btn('outline')} onClick={() => onEmail(inv.id)}>✉️ Courriel</button>
          <button style={S.btn('ghost')} onClick={() => onDuplicate(inv.id)}>📋 Dupliquer</button>
          {(inv.status === 'draft' || inv.status === 'validated' || inv.status === 'cancelled') && (
            <button style={S.btn('danger')} onClick={() => onDelete(inv.id)}>🗑 Supprimer</button>
          )}
        </div>
      </div>

      <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6C757D' }}>ACTIONS:</span>
        {workflowActions.map((a, i) => (
          <button key={i} style={S.btn(a.variant)} onClick={() => a.fn ? a.fn() : onStatusChange(inv.id, a.status)}>
            {a.icon} {a.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={S.statCard('#2A7B88')}>
          <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>CLIENT</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{inv.client_name}</div>
          <div style={{ fontSize: 11, color: '#6C757D' }}>{inv.client_email}</div>
        </div>
        <div style={S.statCard('#6C757D')}>
          <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>RESSOURCE</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{inv.employee_name}</div>
          <div style={{ fontSize: 11, color: '#6C757D' }}>{inv.employee_title}</div>
        </div>
        <div style={S.statCard('#2A7B88')}>
          <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>PÉRIODE</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</div>
        </div>
        <div style={S.statCard(inv.balance_due > 0 ? '#DC3545' : '#28A745')}>
          <div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>SOLDE DÛ</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: inv.balance_due > 0 ? '#DC3545' : '#28A745' }}>{fmt(inv.balance_due)}</div>
        </div>
      </div>

      <div style={{ ...S.tabs, marginBottom: 12 }}>
        {['lines', 'payments', 'attachments', 'audit'].map(t => (
          <button key={t} style={S.tab(detailTab === t)} onClick={() => setDetailTab(t)}>
            {t === 'lines' ? '📋 Lignes' : t === 'payments' ? `💰 Paiements (${(inv.payments || []).length})` : t === 'attachments' ? `📎 Pièces jointes (${attachments.length})` : `📜 Historique (${(inv.audit_logs || []).length})`}
          </button>
        ))}
      </div>

      {detailTab === 'lines' && (
        <div style={S.card}>
          <div style={{ marginBottom: 10, fontSize: 12, color: '#6C757D' }}>Le détail complet de facture est conservé ici comme avant.</div>

          {(inv.lines || []).length > 0 && (
            <>
              <h4 style={{ ...S.sectionTitle, fontSize: 13 }}>Services</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      {['Date', 'Début', 'Fin', 'Pause', 'Heures', 'Taux', 'Services', 'Garde', 'Rappel'].map((h, i) => (
                        <th key={h} style={{ ...S.th, fontSize: 10, ...(i >= 4 ? { textAlign: 'right' } : {}) }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                        <td style={S.td}>{l.date?.substring(0, 10)}</td>
                        <td style={S.td}>{l.start}</td>
                        <td style={S.td}>{l.end}</td>
                        <td style={S.td}>{l.pause_min} min</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{l.hours?.toFixed?.(2) || l.hours}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{fmt(l.rate)}</td>
                        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(l.service_amount)}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{l.garde_amount ? fmt(l.garde_amount) : '—'}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{l.rappel_amount ? fmt(l.rappel_amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {(inv.accommodation_lines || []).length > 0 && (
            <>
              <h4 style={{ ...S.sectionTitle, fontSize: 13, marginTop: 20 }}>Hébergement</h4>
              <table style={S.table}>
                <thead>
                  <tr>
                    {['Employé', 'Période', 'Jours', 'Coût/jour', 'Montant'].map((h, i) => (
                      <th key={h} style={{ ...S.th, fontSize: 10, ...(i >= 2 ? { textAlign: 'right' } : {}) }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inv.accommodation_lines.map((a, i) => (
                    <tr key={i}>
                      <td style={S.td}>{a.employee}</td>
                      <td style={S.td}>{a.period}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{a.days}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{fmt(a.cost_per_day)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {(inv.expense_lines || []).length > 0 && (
            <>
              <h4 style={{ ...S.sectionTitle, fontSize: 13, marginTop: 20 }}>Frais</h4>
              <table style={S.table}>
                <thead>
                  <tr>
                    {['Description', 'Quantité', 'Taux', 'Montant'].map((h, i) => (
                      <th key={h} style={{ ...S.th, fontSize: 10, ...(i >= 1 ? { textAlign: 'right' } : {}) }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inv.expense_lines.map((e, i) => (
                    <tr key={i}>
                      <td style={S.td}>{e.description}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{e.quantity?.toFixed?.(2) || e.quantity}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{fmt(e.rate)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div style={{ marginTop: 20, borderTop: '2px solid #e9ecef', paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ minWidth: 300 }}>
                {[
                  ['Services', inv.subtotal_services],
                  inv.subtotal_garde && ['Garde', inv.subtotal_garde],
                  inv.subtotal_rappel && ['Rappel', inv.subtotal_rappel],
                  inv.subtotal_accom && ['Hébergement', inv.subtotal_accom],
                  inv.subtotal_deplacement && ['Déplacement', inv.subtotal_deplacement],
                  inv.subtotal_km && ['Kilométrage', inv.subtotal_km],
                  inv.subtotal_autres_frais && ['Autres frais', inv.subtotal_autres_frais],
                ].filter(Boolean).map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                    <span style={{ color: '#6C757D' }}>{label}</span>
                    <span>{fmt(val)}</span>
                  </div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, fontWeight: 600, borderTop: '1px solid #dee2e6', marginTop: 6 }}>
                  <span>Sous-total</span><span>{fmt(inv.subtotal)}</span>
                </div>

                {inv.include_tax && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13, color: '#6C757D' }}>
                      <span>TPS (5%)</span><span>{fmt(inv.tps)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13, color: '#6C757D' }}>
                      <span>TVQ (9.975%)</span><span>{fmt(inv.tvq)}</span>
                    </div>
                  </>
                )}

                {!inv.include_tax && (
                  <div style={{ padding: '3px 0', fontSize: 12, color: '#28A745', fontStyle: 'italic' }}>Exempté de taxes</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', fontSize: 18, fontWeight: 700, background: '#2A7B88', color: '#fff', borderRadius: 8, marginTop: 8 }}>
                  <span>TOTAL</span><span>{fmt(inv.total)}</span>
                </div>

                {inv.amount_paid > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, marginTop: 8, color: '#28A745' }}>
                      <span>Payé</span><span>{fmt(inv.amount_paid)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 15, fontWeight: 700, color: inv.balance_due > 0 ? '#DC3545' : '#28A745' }}>
                      <span>Solde dû</span><span>{fmt(inv.balance_due)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {detailTab === 'payments' && (
        <div style={S.card}>
          <div style={S.flexBetween}>
            <h4 style={{ ...S.sectionTitle, margin: 0 }}>💰 Paiements</h4>
            {!['draft', 'cancelled', 'paid'].includes(inv.status) && (
              <button style={S.btn('success')} onClick={() => setShowPayment(true)}>+ Nouveau paiement</button>
            )}
          </div>
          {(inv.payments || []).length === 0 ? (
            <div style={S.empty}>Aucun paiement enregistré</div>
          ) : (
            <table style={{ ...S.table, marginTop: 12 }}>
              <thead>
                <tr>
                  {['Date', 'Montant', 'Méthode', 'Référence', 'Notes', ''].map(h => (
                    <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inv.payments.map(p => (
                  <tr key={p.id}>
                    <td style={S.td}>{fmtDate(p.date)}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: '#28A745' }}>{fmt(p.amount)}</td>
                    <td style={S.td}>{p.method}</td>
                    <td style={S.td}>{p.reference || '—'}</td>
                    <td style={S.td}>{p.notes || '—'}</td>
                    <td style={S.td}>
                      <button style={S.btn('danger', 'sm')} onClick={() => deletePayment(p.id)}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {detailTab === 'attachments' && (
        <div style={S.card}>
          <h4 style={{ ...S.sectionTitle, margin: '0 0 12px 0' }}>📎 Pièces jointes</h4>

          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 14, marginBottom: 16, border: '1px dashed #ced4da' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Catégorie</label>
                <select style={{ ...S.select, width: '100%' }} value={attCategory} onChange={e => setAttCategory(e.target.value)}>
                  <option value="hebergement">Hébergement</option>
                  <option value="deplacement">Déplacement</option>
                  <option value="kilometrage">Kilométrage</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div style={{ flex: 2, minWidth: 180 }}>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description (opt.)</label>
                <input style={{ ...S.input, width: '100%' }} value={attDescription} onChange={e => setAttDescription(e.target.value)} placeholder="Reçu hôtel, facture..." />
              </div>
              <div>
                <label style={{ ...S.btn('primary', 'sm'), cursor: 'pointer', display: 'inline-block' }}>
                  {attUploading ? '⏳ Upload...' : '📤 Ajouter fichier'}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif" style={{ display: 'none' }} onChange={handleAttUpload} disabled={attUploading} />
                </label>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#6C757D', marginTop: 6 }}>Formats acceptés : PDF, JPG, PNG, GIF — Max 10 MB</div>
          </div>

          {attLoading ? (
            <div style={S.empty}>Chargement...</div>
          ) : attachments.length === 0 ? (
            <div style={S.empty}>Aucune pièce jointe</div>
          ) : (
            <div>
              {attachments.map(att => (
                <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span style={{ fontSize: 24 }}>{typeIcons[att.file_type] || '📄'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</div>
                    <div style={{ fontSize: 11, color: '#6C757D' }}>
                      <span style={{ background: '#e9ecef', borderRadius: 4, padding: '1px 6px', marginRight: 6 }}>{catLabels[att.category] || att.category}</span>
                      {fmtSize(att.file_size)} — {fmtDate(att.created_at?.split('T')[0])}
                      {att.description && <span style={{ marginLeft: 6 }}>— {att.description}</span>}
                    </div>
                  </div>
                  <button style={{ ...S.btn('outline', 'sm'), padding: '4px 8px' }} onClick={() => viewAttachment(att.id)} title="Voir">👁️</button>
                  <button style={{ ...S.btn('danger', 'sm'), padding: '4px 8px' }} onClick={() => deleteAttachment(att.id)} title="Supprimer">🗑️</button>
                </div>
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e9ecef' }}>
              <button style={S.btn('primary', 'md')} onClick={downloadPdfWithAttachments}>
                📥 Télécharger PDF facture + pièces jointes
              </button>
            </div>
          )}
        </div>
      )}

      {detailTab === 'audit' && (
        <div style={S.card}>
          <h4 style={{ ...S.sectionTitle, margin: '0 0 12px 0' }}>📜 Historique des modifications</h4>
          {(inv.audit_logs || []).length === 0 ? (
            <div style={S.empty}>Aucun événement</div>
          ) : (
            <div>
              {inv.audit_logs.map(log => (
                <div key={log.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                  <div style={{ minWidth: 140, color: '#6C757D', fontSize: 11 }}>{fmtDateTime(log.created_at)}</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{log.action}</span>
                    {log.old_status && log.new_status && (
                      <span style={{ marginLeft: 8 }}>
                        <StatusBadge status={log.old_status} /> → <StatusBadge status={log.new_status} />
                      </span>
                    )}
                    {log.details && <div style={{ color: '#6C757D', marginTop: 2, fontSize: 12 }}>{log.details}</div>}
                    {log.user_email && <div style={{ color: '#adb5bd', fontSize: 11 }}>par {log.user_email}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={showPayment} onClose={() => setShowPayment(false)} title="Enregistrer un paiement">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Montant ($)</label>
            <input type="number" step="0.01" style={{ ...S.input, width: '100%' }} value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder={`Max: ${inv.balance_due?.toFixed(2)}`} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Date</label>
            <input type="date" style={{ ...S.input, width: '100%' }} value={payDate} onChange={e => setPayDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Méthode</label>
            <select style={{ ...S.select, width: '100%' }} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
              <option value="virement">Virement</option>
              <option value="cheque">Chèque</option>
              <option value="eft">EFT</option>
              <option value="carte">Carte</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Référence</label>
            <input style={{ ...S.input, width: '100%' }} value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="# chèque, # virement..." />
          </div>
          <button style={S.btn('success', 'md')} onClick={addPayment} disabled={!payAmount || parseFloat(payAmount) <= 0}>
            💰 Enregistrer le paiement
          </button>
        </div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Modifier la facture">
        <div style={{ display: 'grid', gap: 14, maxHeight: '70vh', overflowY: 'auto' }}>
          {/* General info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label>
              <select style={{ ...S.select, width: '100%' }} value={editClientId} onChange={e => setEditClientId(e.target.value)}>
                <option value="">— Aucun —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Employé</label>
              <select style={{ ...S.select, width: '100%' }} value={editEmployeeId} onChange={e => setEditEmployeeId(e.target.value)}>
                <option value="">— Aucun —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>PO</label>
              <input style={{ ...S.input, width: '100%' }} value={editPoNumber} onChange={e => setEditPoNumber(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Échéance</label>
              <input type="date" style={{ ...S.input, width: '100%' }} value={editDueDate || ''} onChange={e => setEditDueDate(e.target.value)} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '8px 0' }}>
            <input type="checkbox" checked={editIncludeTax} onChange={e => setEditIncludeTax(e.target.checked)} />
            <strong>Inclure TPS (5%) / TVQ (9.975%)</strong>
          </label>

          {/* Service Lines (Shifts/Quarts) */}
          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12 }}>
            <div style={{ ...S.flexBetween, marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#2A7B88' }}>📋 Quarts / Services</h4>
              <button style={S.btn('outline', 'sm')} onClick={addEditLine}>+ Ajouter quart</button>
            </div>
            {editLines.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6C757D', textAlign: 'center', padding: 8 }}>Aucun quart</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ ...S.table, fontSize: 11 }}>
                  <thead>
                    <tr>
                      {['Date', 'Début', 'Fin', 'Pause (min)', 'Heures', 'Taux', 'Garde h', 'Rappel h', ''].map(h => (
                        <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 4px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {editLines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input type="date" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 120 }} value={l.date?.substring(0, 10) || ''} onChange={e => updateEditLine(i, 'date', e.target.value)} /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 60 }} value={l.start || ''} onChange={e => updateEditLine(i, 'start', e.target.value)} placeholder="07:00" /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 60 }} value={l.end || ''} onChange={e => updateEditLine(i, 'end', e.target.value)} placeholder="15:00" /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 55 }} value={l.pause_min || 0} onChange={e => updateEditLine(i, 'pause_min', e.target.value)} /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="0.25" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 55 }} value={l.hours || 0} onChange={e => updateEditLine(i, 'hours', e.target.value)} /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="0.01" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 65 }} value={l.rate || 0} onChange={e => updateEditLine(i, 'rate', e.target.value)} /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="0.5" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 50 }} value={l.garde_hours || 0} onChange={e => updateEditLine(i, 'garde_hours', e.target.value)} /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="0.5" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 50 }} value={l.rappel_hours || 0} onChange={e => updateEditLine(i, 'rappel_hours', e.target.value)} /></td>
                        <td style={{ ...S.td, padding: '4px 2px' }}><button style={{ ...S.btn('danger', 'sm'), padding: '2px 6px', fontSize: 10 }} onClick={() => removeEditLine(i)}>✗</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Expense Lines */}
          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12 }}>
            <div style={{ ...S.flexBetween, marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#2A7B88' }}>💲 Frais</h4>
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={S.btn('outline', 'sm')} onClick={() => addEditExpense('km')}>+ Km</button>
                <button style={S.btn('outline', 'sm')} onClick={() => addEditExpense('deplacement')}>+ Déplacement</button>
                <button style={S.btn('outline', 'sm')} onClick={() => addEditExpense('autre')}>+ Autre</button>
              </div>
            </div>
            {editExpenseLines.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6C757D', textAlign: 'center', padding: 8 }}>Aucun frais</div>
            ) : (
              <table style={{ ...S.table, fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Type', 'Description', 'Quantité', 'Taux', ''].map(h => (
                      <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 4px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {editExpenseLines.map((e, i) => (
                    <tr key={i}>
                      <td style={{ ...S.td, padding: '4px 2px' }}>
                        <select style={{ ...S.select, fontSize: 11, padding: '4px 6px' }} value={e.type || 'autre'} onChange={ev => updateEditExpense(i, 'type', ev.target.value)}>
                          <option value="km">Kilométrage</option>
                          <option value="deplacement">Déplacement</option>
                          <option value="autre">Autre</option>
                        </select>
                      </td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><input style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: '100%' }} value={e.description || ''} onChange={ev => updateEditExpense(i, 'description', ev.target.value)} /></td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="0.01" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 70 }} value={e.quantity || 0} onChange={ev => updateEditExpense(i, 'quantity', ev.target.value)} /></td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="0.01" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 70 }} value={e.rate || 0} onChange={ev => updateEditExpense(i, 'rate', ev.target.value)} /></td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><button style={{ ...S.btn('danger', 'sm'), padding: '2px 6px', fontSize: 10 }} onClick={() => removeEditExpense(i)}>✗</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Accommodation Lines */}
          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12 }}>
            <div style={{ ...S.flexBetween, marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#2A7B88' }}>🏠 Hébergement</h4>
              <button style={S.btn('outline', 'sm')} onClick={addEditAccom}>+ Ajouter hébergement</button>
            </div>
            {editAccomLines.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6C757D', textAlign: 'center', padding: 8 }}>Aucun hébergement</div>
            ) : (
              <table style={{ ...S.table, fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Employé', 'Période', 'Jours', '$/jour', 'Montant', ''].map(h => (
                      <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 4px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {editAccomLines.map((a, i) => (
                    <tr key={i}>
                      <td style={{ ...S.td, padding: '4px 2px' }}><input style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 120 }} value={a.employee || ''} onChange={e => updateEditAccom(i, 'employee', e.target.value)} /></td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><input style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: '100%' }} value={a.period || ''} onChange={e => updateEditAccom(i, 'period', e.target.value)} placeholder="ex: 2026-03-01 → 2026-03-07" /></td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="1" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 55 }} value={a.days || 0} onChange={e => updateEditAccom(i, 'days', e.target.value)} /></td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><input type="number" step="0.01" style={{ ...S.input, fontSize: 11, padding: '4px 6px', width: 70 }} value={a.cost_per_day || 0} onChange={e => updateEditAccom(i, 'cost_per_day', e.target.value)} /></td>
                      <td style={{ ...S.td, padding: '4px 2px', fontWeight: 600, fontSize: 11 }}>{((parseFloat(a.days) || 0) * (parseFloat(a.cost_per_day) || 0)).toFixed(2)} $</td>
                      <td style={{ ...S.td, padding: '4px 2px' }}><button style={{ ...S.btn('danger', 'sm'), padding: '2px 6px', fontSize: 10 }} onClick={() => removeEditAccom(i)}>✗</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea style={{ ...S.input, width: '100%', minHeight: 60 }} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #e9ecef' }}>
            <button style={S.btn('outline')} onClick={() => setShowEdit(false)}>Annuler</button>
            <button style={S.btn('primary')} onClick={saveInvoiceEdits}>💾 Enregistrer les modifications</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ReportsTab({ reportData, reportType, onLoadReport, onOpenInvoice, onMarkPaid, clients, setError, setSuccess, loadClients }) {
  const [clientDetail, setClientDetail] = useState(null);
  const [clientDetailLoading, setClientDetailLoading] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', address: '', email: '', phone: '' });
  const [creatingClient, setCreatingClient] = useState(false);

  const loadClientDetail = async (clientId) => {
    setClientDetailLoading(true);
    try {
      const data = await apiFetch(`/invoices/reports/client/${clientId}`);
      setClientDetail(data);
    } catch (e) {
      setError && setError(e.message);
    }
    setClientDetailLoading(false);
  };

  const createNewClient = async () => {
    if (!newClient.name.trim()) { setError && setError('Le nom du client est requis'); return; }
    setCreatingClient(true);
    try {
      await apiFetch('/clients/', { method: 'POST', body: JSON.stringify(newClient) });
      setSuccess && setSuccess(`Client "${newClient.name}" créé`);
      setShowNewClient(false);
      setNewClient({ name: '', address: '', email: '', phone: '' });
      if (loadClients) loadClients();
    } catch (e) {
      setError && setError(e.message);
    }
    setCreatingClient(false);
  };

  const downloadCSV = () => {
    if (!reportData || !reportData.length) return;
    let csv = '';
    if (reportType === 'by-client') {
      csv = 'Client,Facturé,Payé,En cours,En retard,Nb factures\n';
      reportData.forEach(c => csv += `"${c.client_name}",${c.total_invoiced},${c.total_paid},${c.total_outstanding},${c.total_overdue},${c.invoice_count}\n`);
    } else if (reportType === 'by-employee') {
      csv = 'Employé,Titre,Facturé,Heures,Nb factures\n';
      reportData.forEach(e => csv += `"${e.employee_name}","${e.employee_title}",${e.total_invoiced},${e.total_hours},${e.invoice_count}\n`);
    } else {
      csv = 'Mois,Services,Garde,Rappel,Hébergement,Frais,Sous-total,Taxes,Total\n';
      reportData.forEach(m => csv += `${m.period},${m.services},${m.garde},${m.rappel},${m.accommodation},${m.expenses},${m.subtotal},${m.taxes},${m.total}\n`);
    }
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rapport_${reportType}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const downloadClientCSV = () => {
    if (!clientDetail || !clientDetail.invoices?.length) return;
    let csv = '';
    // Client identification header
    csv += `Rapport Client\n`;
    csv += `Client,${clientDetail.client_name || 'N/A'}\n`;
    csv += `ID Client,${clientDetail.client_id || 'N/A'}\n`;
    if (clientDetail.client_address) csv += `Adresse,"${clientDetail.client_address}"\n`;
    if (clientDetail.client_email) csv += `Courriel,${clientDetail.client_email}\n`;
    if (clientDetail.client_phone) csv += `Téléphone,${clientDetail.client_phone}\n`;
    csv += `Date du rapport,${new Date().toLocaleDateString('fr-CA')}\n`;
    csv += `\n`;
    // Summary
    csv += `Facturé,${clientDetail.total_invoiced || 0}\n`;
    csv += `Payé,${clientDetail.total_paid || 0}\n`;
    csv += `En cours,${clientDetail.total_outstanding || 0}\n`;
    csv += `En retard,${clientDetail.total_overdue || 0}\n`;
    csv += `Nombre de factures,${clientDetail.invoice_count || clientDetail.invoices.length}\n`;
    csv += `\n`;
    // Invoice details
    csv += 'Numéro,Date,Employé,Période,Total,Payé,Solde,Statut\n';
    clientDetail.invoices.forEach(inv => {
      const statusLabel = { draft: 'Brouillon', validated: 'Validée', sent: 'Envoyée', paid: 'Payée', partially_paid: 'Partiel', cancelled: 'Annulée' }[inv.status] || inv.status;
      csv += `"${inv.number}","${inv.date}","${inv.employee_name}","${inv.period_start} → ${inv.period_end}",${inv.total},${inv.amount_paid},${inv.balance_due},"${statusLabel}"\n`;
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rapport_client_${clientDetail.client_name || 'client'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const downloadClientPDF = () => {
    if (!clientDetail) return;
    // Generate a printable HTML and open as PDF
    const invoiceRows = (clientDetail.invoices || []).map(inv => {
      const statusLabel = { draft: 'Brouillon', validated: 'Validée', sent: 'Envoyée', paid: 'Payée', partially_paid: 'Partiel', cancelled: 'Annulée' }[inv.status] || inv.status;
      return `<tr><td>${inv.number}</td><td>${inv.date}</td><td>${inv.employee_name}</td><td>${inv.period_start} → ${inv.period_end}</td><td style="text-align:right">${Number(inv.total||0).toFixed(2)}$</td><td style="text-align:right">${Number(inv.amount_paid||0).toFixed(2)}$</td><td style="text-align:right">${Number(inv.balance_due||0).toFixed(2)}$</td><td>${statusLabel}</td></tr>`;
    }).join('');
    const clientInfoHtml = `<div style="margin-bottom:15px;padding:10px;background:#f8f9fa;border-radius:6px;border-left:4px solid #2A7B88"><div style="font-size:11px;color:#666">ID Client: ${clientDetail.client_id || 'N/A'}</div>${clientDetail.client_address ? `<div style="font-size:11px;color:#444">${clientDetail.client_address}</div>` : ''}${clientDetail.client_email ? `<div style="font-size:11px;color:#444">✉ ${clientDetail.client_email}</div>` : ''}${clientDetail.client_phone ? `<div style="font-size:11px;color:#444">☎ ${clientDetail.client_phone}</div>` : ''}</div>`;
    const html = `<!DOCTYPE html><html><head><title>Rapport - ${clientDetail.client_name || 'Client'}</title><style>body{font-family:Arial,sans-serif;margin:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px;font-size:12px}th{background:#2A7B88;color:#fff}h1{color:#2A7B88;font-size:18px}h2{font-size:14px;margin-top:20px}.summary{display:flex;gap:20px;margin:10px 0}.summary div{background:#f0f0f0;padding:8px 12px;border-radius:6px;font-size:12px}.summary strong{display:block;font-size:16px}</style></head><body><h1>Rapport Client — ${clientDetail.client_name || 'Client'}</h1>${clientInfoHtml}<div class="summary"><div>Facturé<strong>${Number(clientDetail.total_invoiced||0).toFixed(2)}$</strong></div><div>Payé<strong>${Number(clientDetail.total_paid||0).toFixed(2)}$</strong></div><div>En cours<strong>${Number(clientDetail.total_outstanding||0).toFixed(2)}$</strong></div><div>En retard<strong>${Number(clientDetail.total_overdue||0).toFixed(2)}$</strong></div></div><h2>Factures (${clientDetail.invoices?.length || 0})</h2><table><thead><tr><th>Numéro</th><th>Date</th><th>Employé</th><th>Période</th><th>Total</th><th>Payé</th><th>Solde</th><th>Statut</th></tr></thead><tbody>${invoiceRows}</tbody></table><p style="margin-top:20px;font-size:10px;color:#888">Généré le ${new Date().toLocaleDateString('fr-CA')}</p></body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); }, 500);
  };

  // Client detail view
  if (clientDetail) {
    const statusColors = { draft: '#6C757D', validated: '#2A7B88', sent: '#0D6EFD', paid: '#28A745', partially_paid: '#FFC107', cancelled: '#DC3545' };
    const statusLabels = { draft: 'Brouillon', validated: 'Validée', sent: 'Envoyée', paid: 'Payée', partially_paid: 'Partiel', cancelled: 'Annulée' };
    return (
      <div>
        <div style={{ ...S.flexBetween, marginBottom: 16 }}>
          <div style={S.flexRow}>
            <button style={S.btn('outline')} onClick={() => setClientDetail(null)}>← Retour aux rapports</button>
            <div>
              <h3 style={{ ...S.sectionTitle, margin: 0 }}>📋 {clientDetail.client_name || 'Client'}</h3>
              <div style={{ fontSize: 11, color: '#6C757D', marginTop: 2 }}>
                {clientDetail.client_id ? `ID: ${clientDetail.client_id}` : ''}
                {clientDetail.client_email ? ` · ${clientDetail.client_email}` : ''}
                {clientDetail.client_phone ? ` · ${clientDetail.client_phone}` : ''}
                {clientDetail.client_address ? ` · ${clientDetail.client_address}` : ''}
              </div>
            </div>
          </div>
          <div style={S.flexRow}>
            <button style={S.btn('outline')} onClick={downloadClientCSV}>📥 CSV</button>
            <button style={S.btn('outline')} onClick={downloadClientPDF}>📄 PDF</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Facturé', val: clientDetail.total_invoiced, color: '#2A7B88' },
            { label: 'Payé', val: clientDetail.total_paid, color: '#28A745' },
            { label: 'En cours', val: clientDetail.total_outstanding, color: '#FFC107' },
            { label: 'En retard', val: clientDetail.total_overdue, color: '#DC3545' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', borderRadius: 8, padding: 14, border: '1px solid #E2E8F0', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6C757D', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{fmt(s.val)}</div>
            </div>
          ))}
        </div>

        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          Factures ({clientDetail.invoices?.length || 0})
        </h4>
        <table style={S.table}>
          <thead>
            <tr>
              {['Numéro', 'Date', 'Employé', 'Période', 'Total', 'Payé', 'Solde', 'Statut', ''].map((h, i) => (
                <th key={h+i} style={{ ...S.th, ...(i >= 4 && i <= 6 ? { textAlign: 'right' } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(clientDetail.invoices || []).map((inv, i) => (
              <tr key={inv.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{inv.number}</td>
                <td style={S.td}>{fmtDate(inv.date)}</td>
                <td style={S.td}>{inv.employee_name}</td>
                <td style={{ ...S.td, fontSize: 11 }}>{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(inv.total)}</td>
                <td style={{ ...S.td, textAlign: 'right', color: '#28A745' }}>{fmt(inv.amount_paid)}</td>
                <td style={{ ...S.td, textAlign: 'right', color: inv.balance_due > 0 ? '#DC3545' : '#6C757D' }}>{fmt(inv.balance_due)}</td>
                <td style={S.td}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, backgroundColor: statusColors[inv.status] || '#6C757D', color: inv.status === 'partially_paid' ? '#000' : '#fff' }}>
                    {statusLabels[inv.status] || inv.status}
                  </span>
                </td>
                <td style={S.td}>
                  <button style={{ ...S.btn('outline'), fontSize: 10, padding: '2px 8px' }} onClick={() => { setClientDetail(null); onOpenInvoice(inv.id); }}>Voir</button>
                </td>
              </tr>
            ))}
            {(!clientDetail.invoices || clientDetail.invoices.length === 0) && (
              <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: '#6C757D' }}>Aucune facture pour ce client</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...S.flexBetween, marginBottom: 16 }}>
        <div style={S.flexRow}>
          {[
            { id: 'by-client', label: '📊 Par client' },
            { id: 'by-employee', label: '👤 Par employé' },
            { id: 'by-period', label: '📅 Par mois' }
          ].map(r => (
            <button key={r.id} style={S.btn(reportType === r.id ? 'primary' : 'outline')} onClick={() => onLoadReport(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <div style={S.flexRow}>
          {reportData && reportData.length > 0 && (
            <button style={S.btn('outline')} onClick={downloadCSV}>📥 Télécharger CSV</button>
          )}
          <button style={S.btn('primary')} onClick={() => setShowNewClient(true)}>+ Nouveau client</button>
        </div>
      </div>

      {/* Create new client form */}
      {showNewClient && (
        <div style={{ ...S.card, marginBottom: 16, background: '#E8F4F6', border: '1px solid #B5D8DC' }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>➕ Créer un nouveau client</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Nom *</label>
              <input style={S.input} value={newClient.name} onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))} placeholder="Nom du client" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Courriel</label>
              <input style={S.input} value={newClient.email} onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))} placeholder="email@exemple.com" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Adresse</label>
              <input style={S.input} value={newClient.address} onChange={e => setNewClient(p => ({ ...p, address: e.target.value }))} placeholder="Adresse" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 3 }}>Téléphone</label>
              <input style={S.input} value={newClient.phone} onChange={e => setNewClient(p => ({ ...p, phone: e.target.value }))} placeholder="514-000-0000" />
            </div>
          </div>
          <div style={S.flexRow}>
            <button style={S.btn('primary')} onClick={createNewClient} disabled={creatingClient}>
              {creatingClient ? 'Création...' : 'Créer le client'}
            </button>
            <button style={S.btn('outline')} onClick={() => setShowNewClient(false)}>Annuler</button>
          </div>
        </div>
      )}

      {!reportData ? (
        <div style={S.empty}>Sélectionnez un rapport</div>
      ) : reportType === 'by-client' ? (
        <div>
          <table style={S.table}>
            <thead>
              <tr>
                {['Client', 'Facturé', 'Payé', 'En cours', 'En retard', 'Nb factures', ''].map((h, i) => (
                  <th key={h+i} style={{ ...S.th, ...(i >= 1 && i <= 4 ? { textAlign: 'right' } : {}), ...(i === 0 ? { borderRadius: '8px 0 0 0' } : i === 6 ? { borderRadius: '0 8px 0 0' } : {}) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reportData.map((c, i) => (
                <tr key={c.client_id} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa', cursor: 'pointer' }} onClick={() => loadClientDetail(c.client_id)}>
                  <td style={{ ...S.td, fontWeight: 600, color: '#2A7B88' }}>{c.client_name}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(c.total_invoiced)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: '#28A745' }}>{fmt(c.total_paid)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: '#FFC107' }}>{fmt(c.total_outstanding)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: c.total_overdue > 0 ? '#DC3545' : '#6C757D', fontWeight: c.total_overdue > 0 ? 700 : 400 }}>{fmt(c.total_overdue)}</td>
                  <td style={{ ...S.td, textAlign: 'center' }}>{c.invoice_count}</td>
                  <td style={S.td}>
                    <button style={{ ...S.btn('outline'), fontSize: 10, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); loadClientDetail(c.client_id); }}>📋 Détail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: '#6C757D', marginTop: 8 }}>💡 Cliquez sur un client pour voir ses factures en détail</p>
        </div>
      ) : reportType === 'by-employee' ? (
        <table style={S.table}>
          <thead>
            <tr>
              {['Employé', 'Titre', 'Facturé', 'Heures', 'Nb factures'].map((h, i) => (
                <th key={h} style={{ ...S.th, ...(i >= 2 ? { textAlign: 'right' } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reportData.map((e, i) => (
              <tr key={e.employee_id} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{e.employee_name}</td>
                <td style={S.td}>{e.employee_title}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(e.total_invoiced)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{e.total_hours?.toFixed(1)}h</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{e.invoice_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              {['Mois', 'Services', 'Garde', 'Rappel', 'Héberg.', 'Frais', 'Sous-total', 'Taxes', 'Total'].map((h, i) => (
                <th key={h} style={{ ...S.th, ...(i >= 1 ? { textAlign: 'right' } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reportData.map((m, i) => (
              <tr key={m.period} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{m.period}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmt(m.services)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmt(m.garde)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmt(m.rappel)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmt(m.accommodation)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmt(m.expenses)}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(m.subtotal)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmt(m.taxes)}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: '#2A7B88' }}>{fmt(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CreditNotesTab({ creditNotes, onRefresh, setError, setSuccess, clients, invoices }) {
  const [showCreate, setShowCreate] = useState(false);
  const [cnInvoiceId, setCnInvoiceId] = useState('');
  const [cnClientId, setCnClientId] = useState('');
  const [cnReason, setCnReason] = useState('');
  const [cnAmount, setCnAmount] = useState('');
  const [cnIncludeTax, setCnIncludeTax] = useState(true);
  const [cnNotes, setCnNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const createCreditNote = async () => {
    if (!cnReason || !cnAmount || parseFloat(cnAmount) <= 0) {
      setError('Raison et montant requis');
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch('/invoices/credit-notes', {
        method: 'POST',
        body: JSON.stringify({
          invoice_id: cnInvoiceId || null,
          client_id: cnClientId ? Number(cnClientId) : null,
          reason: cnReason,
          amount: parseFloat(cnAmount),
          include_tax: cnIncludeTax,
          notes: cnNotes,
        })
      });
      setSuccess(`Note de crédit ${res.number} créée — Total: ${fmt(res.total)}`);
      setShowCreate(false);
      setCnInvoiceId(''); setCnClientId(''); setCnReason(''); setCnAmount(''); setCnIncludeTax(true); setCnNotes('');
      onRefresh();
    } catch (e) {
      setError(e.message);
    }
    setCreating(false);
  };

  return (
    <div>
      <div style={{ ...S.flexBetween, marginBottom: 16 }}>
        <h3 style={S.sectionTitle}>📝 Notes de crédit</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn('primary')} onClick={() => setShowCreate(true)}>+ Créer une note de crédit</button>
          <button style={S.btn('outline')} onClick={onRefresh}>🔄 Actualiser</button>
        </div>
      </div>

      {showCreate && (
        <div style={{ ...S.card, marginBottom: 16, border: '2px solid #2A7B88' }}>
          <h4 style={{ ...S.sectionTitle, fontSize: 14, marginBottom: 14 }}>Nouvelle note de crédit</h4>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Facture de référence (optionnel)</label>
                <select style={{ ...S.select, width: '100%' }} value={cnInvoiceId} onChange={e => {
                  setCnInvoiceId(e.target.value);
                  if (e.target.value) {
                    const inv = invoices.find(i => i.id === e.target.value);
                    if (inv && inv.client_id) setCnClientId(String(inv.client_id));
                  }
                }}>
                  <option value="">— Aucune —</option>
                  {invoices.map(inv => (
                    <option key={inv.id} value={inv.id}>{inv.number} — {inv.client_name} ({fmt(inv.total)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label>
                <select style={{ ...S.select, width: '100%' }} value={cnClientId} onChange={e => setCnClientId(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Montant ($) *</label>
                <input type="number" step="0.01" style={{ ...S.input, width: '100%' }} value={cnAmount} onChange={e => setCnAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, paddingBottom: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={cnIncludeTax} onChange={e => setCnIncludeTax(e.target.checked)} />
                  <strong>Inclure TPS (5%) / TVQ (9.975%)</strong>
                </label>
              </div>
            </div>

            {cnAmount && parseFloat(cnAmount) > 0 && (
              <div style={{ background: '#f8f9fa', borderRadius: 6, padding: 10, fontSize: 12 }}>
                <div>Montant: <strong>{fmt(parseFloat(cnAmount))}</strong></div>
                {cnIncludeTax ? (
                  <>
                    <div>TPS (5%): <strong>{fmt(parseFloat(cnAmount) * 0.05)}</strong></div>
                    <div>TVQ (9.975%): <strong>{fmt(parseFloat(cnAmount) * 0.09975)}</strong></div>
                    <div style={{ fontWeight: 700, color: '#DC3545', marginTop: 4 }}>Total: {fmt(parseFloat(cnAmount) * 1.14975)}</div>
                  </>
                ) : (
                  <div style={{ color: '#28A745', fontStyle: 'italic' }}>Exempté de taxes — Total: {fmt(parseFloat(cnAmount))}</div>
                )}
              </div>
            )}

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Raison *</label>
              <textarea style={{ ...S.input, width: '100%', minHeight: 60 }} value={cnReason} onChange={e => setCnReason(e.target.value)} placeholder="Raison de la note de crédit..." />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes internes (optionnel)</label>
              <input style={{ ...S.input, width: '100%' }} value={cnNotes} onChange={e => setCnNotes(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={S.btn('outline')} onClick={() => setShowCreate(false)}>Annuler</button>
              <button style={S.btn('primary')} onClick={createCreditNote} disabled={creating || !cnReason || !cnAmount}>
                {creating ? '⏳ Création...' : '📝 Créer la note de crédit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {creditNotes.length === 0 ? (
        <div style={S.empty}>Aucune note de crédit</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              {['Numéro', 'Date', 'Client', 'Facture réf.', 'Raison', 'Montant', 'TPS', 'TVQ', 'Total', 'Statut'].map((h, i) => (
                <th key={h} style={{ ...S.th, ...(i >= 5 && i <= 8 ? { textAlign: 'right' } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {creditNotes.map((cn, i) => (
              <tr key={cn.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                <td style={{ ...S.td, fontWeight: 600, color: '#DC3545' }}>{cn.number}</td>
                <td style={S.td}>{fmtDate(cn.date)}</td>
                <td style={S.td}>{cn.client_name || '—'}</td>
                <td style={S.td}>{cn.invoice_number || '—'}</td>
                <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cn.reason}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmt(cn.amount)}</td>
                <td style={{ ...S.td, textAlign: 'right', fontSize: 11, color: '#6C757D' }}>{cn.tps ? fmt(cn.tps) : '—'}</td>
                <td style={{ ...S.td, textAlign: 'right', fontSize: 11, color: '#6C757D' }}>{cn.tvq ? fmt(cn.tvq) : '—'}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: '#DC3545' }}>{fmt(cn.total)}</td>
                <td style={S.td}>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: cn.status === 'active' ? '#E8F4F6' : '#f8d7da', color: cn.status === 'active' ? '#2A7B88' : '#DC3545' }}>
                    {cn.status === 'active' ? 'Active' : 'Annulée'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AnomaliesTab({ anomalies, onRefresh, onOpenInvoice }) {
  const sevColor = { error: '#DC3545', warning: '#FFC107' };
  const typeLabels = {
    duplicate: '🔄 Doublon',
    excessive_hours: '⏰ Heures excessives',
    rate_mismatch: '💲 Taux incorrect',
    no_client: '❌ Sans client'
  };

  return (
    <div>
      <div style={{ ...S.flexBetween, marginBottom: 16 }}>
        <h3 style={S.sectionTitle}>⚠️ Détection d'anomalies</h3>
        <button style={S.btn('outline')} onClick={onRefresh}>🔄 Actualiser</button>
      </div>

      {anomalies.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#28A745' }}>Aucune anomalie détectée</div>
          <div style={{ fontSize: 13, color: '#6C757D', marginTop: 4 }}>Toutes les factures semblent correctes</div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 12, fontSize: 13, color: '#6C757D' }}>{anomalies.length} anomalie(s) détectée(s)</div>
          {anomalies.map((a, i) => (
            <div key={i} style={{ ...S.card, borderLeft: `4px solid ${sevColor[a.severity] || '#FFC107'}`, display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{typeLabels[a.type] || a.type}</span>
                  <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 600, background: a.severity === 'error' ? '#f8d7da' : '#fff3cd', color: a.severity === 'error' ? '#DC3545' : '#856404' }}>
                    {a.severity === 'error' ? 'Erreur' : 'Avertissement'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#495057' }}>{a.description}</div>
                <div style={{ fontSize: 11, color: '#6C757D', marginTop: 2 }}>Facture: {a.invoice_number}</div>
              </div>
              <button style={S.btn('outline')} onClick={() => onOpenInvoice(a.invoice_id)}>Voir la facture →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
