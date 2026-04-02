import React, { useState, useEffect, useCallback, useMemo } from 'react';
import InvoiceEditModal from '../components/InvoiceEditModal';

const API = import.meta.env.VITE_API_URL || '/api';

const fmt = (n) => {
  if (n == null || isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
};

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const fmtDateTime = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-CA');
};

const getToken = () => localStorage.getItem('sep_token');

const apiFetch = async (path, opts = {}) => {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API Error');
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
  cancelled: { label: 'Annulée', bg: '#DC3545', text: '#fff' },
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
  tab: (active) => ({ padding: '10px 18px', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500, color: active ? '#2A7B88' : '#6C757D', borderBottom: active ? '3px solid #2A7B88' : '3px solid transparent', transition: 'all 0.2s', background: 'none', border: 'none', marginBottom: -2 }),
  card: { background: '#fff', borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.07)', padding: 20, marginBottom: 16 },
  statCard: (color) => ({ background: '#fff', borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.07)', padding: '16px 20px', borderLeft: `4px solid ${color}`, flex: '1 1 200px', minWidth: 180 }),
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 },
  th: { padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#fff', background: '#2A7B88', whiteSpace: 'nowrap' },
  td: { padding: '9px 12px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' },
  trHover: { cursor: 'pointer', transition: 'background 0.15s' },
  btn: (variant = 'primary', size = 'sm') => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: size === 'sm' ? '6px 14px' : '10px 20px',
    borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: size === 'sm' ? 12 : 14, fontWeight: 600,
    transition: 'all 0.2s', letterSpacing: 0.2,
    ...(variant === 'primary' ? { background: '#2A7B88', color: '#fff' } : {}),
    ...(variant === 'success' ? { background: '#28A745', color: '#fff' } : {}),
    ...(variant === 'danger' ? { background: '#DC3545', color: '#fff' } : {}),
    ...(variant === 'warning' ? { background: '#FFC107', color: '#000' } : {}),
    ...(variant === 'outline' ? { background: 'transparent', color: '#2A7B88', border: '1.5px solid #2A7B88' } : {}),
    ...(variant === 'ghost' ? { background: 'transparent', color: '#6C757D' } : {}),
  }),
  input: { padding: '8px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, outline: 'none', fontFamily: 'inherit' },
  select: { padding: '8px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#fff' },
  flexRow: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  flexBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#2A7B88', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 },
  empty: { textAlign: 'center', padding: 40, color: '#adb5bd', fontSize: 14 },
  modal: { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' },
  modalContent: { position: 'relative', background: '#fff', borderRadius: 12, padding: 24, maxWidth: 560, width: '95%', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
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
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const sun = getLastSunday();
  const [genStart, setGenStart] = useState(toISO(sun));
  const [genEnd, setGenEnd] = useState(toISO(getSaturday(sun)));
  const [genEmployeeId, setGenEmployeeId] = useState('');
  const [genClientId, setGenClientId] = useState('');
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [reportData, setReportData] = useState(null);
  const [reportType, setReportType] = useState('by-client');
  const [anomalies, setAnomalies] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [selected, setSelected] = useState(new Set());

  const loadInvoices = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterSearch) params.set('search', filterSearch);
      const data = await apiFetch(`/invoices/?${params}`);
      setInvoices(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [filterStatus, filterSearch]);

  const loadStats = useCallback(async () => { try { setStats(await apiFetch('/invoices/stats')); } catch (_) {} }, []);
  const loadClients = useCallback(async () => { try { setClients(await apiFetch('/clients/')); } catch (_) {} }, []);
  const loadEmployees = useCallback(async () => { try { setEmployees(await apiFetch('/employees/')); } catch (_) {} }, []);

  useEffect(() => { loadInvoices(); loadStats(); loadClients(); loadEmployees(); }, []);
  useEffect(() => { loadInvoices(); }, [filterStatus, filterSearch]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); } }, [success]);
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 6000); return () => clearTimeout(t); } }, [error]);

  const openDetail = async (id) => {
    try {
      const inv = await apiFetch(`/invoices/${id}`);
      setSelectedInvoice(inv);
      setActiveTab('detail');
    } catch (e) { setError(e.message); }
  };

  const changeStatus = async (id, newStatus) => {
    try {
      await apiFetch(`/invoices/${id}/status`, { method: 'POST', body: JSON.stringify({ new_status: newStatus }) });
      setSuccess(`Statut changé → ${statusConfig[newStatus]?.label || newStatus}`);
      if (selectedInvoice?.id === id) openDetail(id);
      loadInvoices(); loadStats();
    } catch (e) { setError(e.message); }
  };

  const markPaid = async (id) => {
    try {
      await apiFetch(`/invoices/${id}/mark-paid`, { method: 'POST' });
      setSuccess('Facture marquée payée');
      if (selectedInvoice?.id === id) openDetail(id);
      loadInvoices(); loadStats();
    } catch (e) { setError(e.message); }
  };

  const duplicateInvoice = async (id) => {
    try {
      const inv = await apiFetch(`/invoices/${id}/duplicate`, { method: 'POST' });
      setSuccess(`Facture dupliquée: ${inv.number}`);
      loadInvoices(); loadStats();
    } catch (e) { setError(e.message); }
  };

  const deleteInvoice = async (id) => {
    if (!confirm('Supprimer cette facture brouillon?')) return;
    try {
      await apiFetch(`/invoices/${id}`, { method: 'DELETE' });
      setSuccess('Facture supprimée');
      if (selectedInvoice?.id === id) { setSelectedInvoice(null); setActiveTab('list'); }
      loadInvoices(); loadStats();
    } catch (e) { setError(e.message); }
  };

  const bulkDeleteInvoices = async () => {
    if (!selected.size) return;
    if (!confirm('Supprimer en lot les factures sélectionnées? Les factures non brouillon / non annulées seront ignorées.')) return;
    try {
      const res = await apiFetch('/invoices/bulk-delete', { method: 'POST', body: JSON.stringify([...selected]) });
      setSuccess(`${res.count || 0} facture(s) supprimée(s)`);
      setSelected(new Set());
      loadInvoices();
      loadStats();
    } catch (e) { setError(e.message); }
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
    } catch (e) { setError(e.message); }
  };

  const generateInvoices = async () => {
    setLoading(true);
    try {
      const payload = { period_start: genStart, period_end: genEnd };
      if (genEmployeeId) payload.employee_id = Number(genEmployeeId);
      if (genClientId) payload.client_id = Number(genClientId);
      const data = await apiFetch('/invoices/generate', { method: 'POST', body: JSON.stringify(payload) });
      setSuccess(`${data.length} facture(s) générée(s)`);
      loadInvoices(); loadStats();
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const loadReport = async (type) => {
    setReportType(type);
    try { setReportData(await apiFetch(`/invoices/reports/${type}`)); } catch (e) { setError(e.message); }
  };
  const loadAnomalies = async () => { try { setAnomalies(await apiFetch('/invoices/anomalies/check')); } catch (e) { setError(e.message); } };
  const loadCreditNotes = async () => { try { setCreditNotes(await apiFetch('/invoices/credit-notes/all')); } catch (e) { setError(e.message); } };

  const toggleSelect = (id) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => { if (selected.size === invoices.length) setSelected(new Set()); else setSelected(new Set(invoices.map(i => i.id))); };
  const bulkValidate = async () => { try { const res = await apiFetch('/invoices/bulk/validate', { method: 'POST', body: JSON.stringify([...selected]) }); setSuccess(`${res.validated.length} facture(s) validée(s)`); setSelected(new Set()); loadInvoices(); loadStats(); } catch (e) { setError(e.message); } };
  const bulkSend = async () => { try { const res = await apiFetch('/invoices/bulk/send', { method: 'POST', body: JSON.stringify([...selected]) }); setSuccess(`${res.sent.length} facture(s) envoyée(s)`); setSelected(new Set()); loadInvoices(); loadStats(); } catch (e) { setError(e.message); } };

  return (
    <div style={S.page}>
      {success && <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, background: '#28A745', color: '#fff', padding: '12px 20px', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', fontSize: 13, fontWeight: 600, maxWidth: 400 }}>✓ {success}</div>}
      {error && <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, background: '#DC3545', color: '#fff', padding: '12px 20px', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', fontSize: 13, fontWeight: 600, maxWidth: 400 }}>✗ {error}</div>}

      {stats && <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={S.statCard('#2A7B88')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>Total facturé</div><div style={{ fontSize: 22, fontWeight: 700, color: '#2A7B88' }}>{fmt(stats.total_invoiced)}</div></div>
        <div style={S.statCard('#28A745')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>Payé</div><div style={{ fontSize: 22, fontWeight: 700, color: '#28A745' }}>{fmt(stats.total_paid)}</div></div>
        <div style={S.statCard('#FFC107')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>En cours</div><div style={{ fontSize: 22, fontWeight: 700, color: '#FFC107' }}>{fmt(stats.total_outstanding)}</div></div>
        <div style={S.statCard('#DC3545')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>En retard</div><div style={{ fontSize: 22, fontWeight: 700, color: '#DC3545' }}>{fmt(stats.total_overdue)}</div></div>
        <div style={S.statCard('#6C757D')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600, textTransform: 'uppercase' }}>Factures</div><div style={{ fontSize: 22, fontWeight: 700, color: '#212529' }}>{stats.count}</div></div>
      </div>}

      <nav style={S.tabs}>
        {[{ id: 'list', label: '📋 Factures' }, { id: 'generate', label: '⚡ Générer' }, { id: 'detail', label: '🔍 Détail', hidden: !selectedInvoice }, { id: 'reports', label: '📊 Rapports' }, { id: 'creditNotes', label: '📝 Notes de crédit' }, { id: 'anomalies', label: '⚠️ Anomalies' }].filter(t => !t.hidden).map(t => (
          <button key={t.id} style={S.tab(activeTab === t.id)} onClick={() => { setActiveTab(t.id); if (t.id === 'reports' && !reportData) loadReport('by-client'); if (t.id === 'anomalies') loadAnomalies(); if (t.id === 'creditNotes') loadCreditNotes(); }}>{t.label}</button>
        ))}
      </nav>

      {activeTab === 'list' && <div>
        <div style={{ ...S.flexBetween, marginBottom: 16 }}>
          <div style={S.flexRow}>
            <input style={{ ...S.input, width: 220 }} placeholder="Rechercher (# facture, client, employé)..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
            <select style={S.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Tous les statuts</option>
              {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div style={S.flexRow}>
            {selected.size > 0 && <><span style={{ fontSize: 12, color: '#6C757D' }}>{selected.size} sélectionnée(s)</span><button style={S.btn('primary')} onClick={bulkValidate}>Valider</button><button style={S.btn('outline')} onClick={bulkSend}>Envoyer</button><button style={S.btn('danger')} onClick={bulkDeleteInvoices}>Supprimer</button></>}
            <button style={S.btn('primary')} onClick={() => setActiveTab('generate')}>+ Générer factures</button>
          </div>
        </div>
        {loading ? <div style={S.empty}>Chargement...</div> : invoices.length === 0 ? <div style={S.empty}>Aucune facture trouvée</div> : <div style={{ overflowX: 'auto' }}><table style={S.table}><thead><tr><th style={{ ...S.th, borderRadius: '8px 0 0 0', width: 30 }}><input type="checkbox" checked={selected.size === invoices.length && invoices.length > 0} onChange={toggleAll} /></th><th style={S.th}>Numéro</th><th style={S.th}>Date</th><th style={S.th}>Période</th><th style={S.th}>Client</th><th style={S.th}>Employé</th><th style={{ ...S.th, textAlign: 'right' }}>Total</th><th style={{ ...S.th, textAlign: 'right' }}>Payé</th><th style={{ ...S.th, textAlign: 'right' }}>Solde</th><th style={S.th}>Statut</th><th style={{ ...S.th, borderRadius: '0 8px 0 0' }}>Actions</th></tr></thead><tbody>{invoices.map((inv, i) => <tr key={inv.id} style={{ ...S.trHover, background: i % 2 === 0 ? '#fff' : '#f8f9fa' }} onMouseEnter={e => e.currentTarget.style.background = '#e8f4f6'} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#f8f9fa'}><td style={S.td} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleSelect(inv.id)} /></td><td style={{ ...S.td, fontWeight: 600, color: '#2A7B88', cursor: 'pointer' }} onClick={() => openDetail(inv.id)}>{inv.number}</td><td style={S.td}>{fmtDate(inv.date)}</td><td style={{ ...S.td, fontSize: 11 }}>{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</td><td style={S.td}>{inv.client_name}</td><td style={S.td}><div>{inv.employee_name}</div><div style={{ fontSize: 10, color: '#6C757D' }}>{inv.employee_title}</div></td><td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(inv.total)}</td><td style={{ ...S.td, textAlign: 'right', color: '#28A745' }}>{fmt(inv.amount_paid)}</td><td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: inv.balance_due > 0 ? '#DC3545' : '#28A745' }}>{fmt(inv.balance_due)}</td><td style={S.td}><StatusBadge status={inv.status} /></td><td style={S.td} onClick={e => e.stopPropagation()}><div style={{ display: 'flex', gap: 4 }}><button style={S.btn('ghost')} title="PDF" onClick={() => openPdf(inv.id)}>📄</button><button style={S.btn('ghost')} title="Détail" onClick={() => openDetail(inv.id)}>👁</button>{inv.status === 'draft' && <button style={S.btn('ghost')} title="Supprimer" onClick={() => deleteInvoice(inv.id)}>🗑</button>}</div></td></tr>)}</tbody></table></div>}
      </div>}

      {activeTab === 'generate' && <div style={S.card}><h3 style={S.sectionTitle}>⚡ Générer les factures brouillon</h3><p style={{ fontSize: 13, color: '#6C757D', marginBottom: 16 }}>Génère automatiquement 1 facture par employé par client pour la période sélectionnée, à partir des horaires et FDT soumises.</p><div style={{ ...S.flexRow, marginBottom: 16 }}><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Début période (Dimanche)</label><input type="date" style={S.input} value={genStart} onChange={e => setGenStart(e.target.value)} /></div><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fin période (Samedi)</label><input type="date" style={S.input} value={genEnd} onChange={e => setGenEnd(e.target.value)} /></div></div><div style={{ ...S.flexRow, marginBottom: 16 }}><div style={{ flex: 1 }}><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Employé (optionnel)</label><select style={{ ...S.select, width: '100%' }} value={genEmployeeId} onChange={e => setGenEmployeeId(e.target.value)}><option value="">— Tous les employés —</option>{employees.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.position || '—'})</option>)}</select></div><div style={{ flex: 1 }}><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client (optionnel)</label><select style={{ ...S.select, width: '100%' }} value={genClientId} onChange={e => setGenClientId(e.target.value)}><option value="">— Tous les clients —</option>{clients.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}</select></div></div><div style={S.flexRow}><button style={S.btn('primary', 'md')} onClick={generateInvoices} disabled={loading}>{loading ? 'Génération en cours...' : '⚡ Générer les factures'}</button><button style={S.btn('outline')} onClick={() => setActiveTab('list')}>← Retour à la liste</button></div></div>}

      {activeTab === 'detail' && selectedInvoice && <InvoiceDetail invoice={selectedInvoice} onBack={() => setActiveTab('list')} onRefresh={() => openDetail(selectedInvoice.id)} onStatusChange={changeStatus} onMarkPaid={markPaid} onDuplicate={duplicateInvoice} onDelete={deleteInvoice} onPdf={openPdf} onEmail={emailInvoice} setError={setError} setSuccess={setSuccess} loadInvoices={loadInvoices} loadStats={loadStats} />}
      {activeTab === 'reports' && <ReportsTab reportData={reportData} reportType={reportType} onLoadReport={loadReport} onOpenInvoice={openDetail} onMarkPaid={markPaid} />}
      {activeTab === 'creditNotes' && <CreditNotesTab creditNotes={creditNotes} onRefresh={loadCreditNotes} setError={setError} setSuccess={setSuccess} clients={clients} invoices={invoices} />}
      {activeTab === 'anomalies' && <AnomaliesTab anomalies={anomalies} onRefresh={loadAnomalies} onOpenInvoice={openDetail} setError={setError} setSuccess={setSuccess} />}
    </div>
  );
}

function InvoiceDetail({ invoice: inv, onBack, onRefresh, onStatusChange, onMarkPaid, onDuplicate, onDelete, onPdf, onEmail, setError, setSuccess, loadInvoices, loadStats }) {
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(toISO(new Date()));
  const [payRef, setPayRef] = useState('');
  const [payMethod, setPayMethod] = useState('virement');
  const [detailTab, setDetailTab] = useState('lines');
  const [attachments, setAttachments] = useState([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attUploading, setAttUploading] = useState(false);
  const [attCategory, setAttCategory] = useState('hebergement');
  const [attDescription, setAttDescription] = useState('');
  const [showEdit, setShowEdit] = useState(false);

  const loadAttachments = useCallback(async () => {
    try { setAttLoading(true); setAttachments((await apiFetch(`/invoices/${inv.id}/attachments`)) || []); }
    catch (e) { console.error(e); }
    finally { setAttLoading(false); }
  }, [inv.id]);
  useEffect(() => { loadAttachments(); }, [loadAttachments]);

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
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Erreur upload'); }
      setSuccess('Pièce jointe ajoutée');
      setAttDescription('');
      loadAttachments();
    } catch (e) { setError(e.message); }
    finally { setAttUploading(false); e.target.value = ''; }
  };

  const deleteAttachment = async (attId) => {
    if (!confirm('Supprimer cette pièce jointe?')) return;
    try { await apiFetch(`/invoices/${inv.id}/attachments/${attId}`, { method: 'DELETE' }); setSuccess('Pièce jointe supprimée'); loadAttachments(); }
    catch (e) { setError(e.message); }
  };
  const viewAttachment = (attId) => { const token = getToken(); window.open(`${API}/invoices/${inv.id}/attachments/${attId}?token=${token}`, '_blank'); };
  const downloadPdfWithAttachments = () => { window.open(`${API}/invoices/${inv.id}/pdf-with-attachments?include_attachments=true`, '_blank'); };
  const fmtSize = (bytes) => { if (!bytes) return '0 B'; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; };
  const catLabels = { hebergement: 'Hébergement', deplacement: 'Déplacement', kilometrage: 'Kilométrage', autre: 'Autre' };
  const typeIcons = { pdf: '📄', jpg: '🖼️', png: '🖼️', gif: '🖼️' };

  const addPayment = async () => {
    try {
      await apiFetch(`/invoices/${inv.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: parseFloat(payAmount), date: payDate, reference: payRef, method: payMethod }) });
      setSuccess('Paiement enregistré');
      setShowPayment(false); setPayAmount(''); setPayRef('');
      onRefresh(); loadInvoices(); loadStats();
    } catch (e) { setError(e.message); }
  };
  const deletePayment = async (paymentId) => {
    if (!confirm('Supprimer ce paiement?')) return;
    try { await apiFetch(`/invoices/${inv.id}/payments/${paymentId}`, { method: 'DELETE' }); setSuccess('Paiement supprimé'); onRefresh(); loadInvoices(); loadStats(); } catch (e) { setError(e.message); }
  };
  const saveInvoiceEdits = async (payload) => {
    try {
      await apiFetch(`/invoices/${inv.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setSuccess('Facture modifiée');
      setShowEdit(false);
      onRefresh(); loadInvoices(); loadStats();
    } catch (e) { setError(e.message); }
  };

  const workflowActions = useMemo(() => {
    const actions = [];
    switch (inv.status) {
      case 'draft': actions.push({ label: 'Valider', status: 'validated', variant: 'primary', icon: '✓' }); actions.push({ label: 'Annuler', status: 'cancelled', variant: 'danger', icon: '✗' }); break;
      case 'validated': actions.push({ label: 'Marquer envoyée', status: 'sent', variant: 'primary', icon: '📤' }); actions.push({ label: 'Retour brouillon', status: 'draft', variant: 'ghost', icon: '←' }); break;
      case 'sent': actions.push({ label: 'Paiement complet', fn: () => onMarkPaid(inv.id), variant: 'success', icon: '💰' }); actions.push({ label: 'Paiement partiel', fn: () => setShowPayment(true), variant: 'warning', icon: '💵' }); break;
      case 'partially_paid': actions.push({ label: 'Paiement complet', fn: () => onMarkPaid(inv.id), variant: 'success', icon: '💰' }); actions.push({ label: 'Ajout paiement', fn: () => setShowPayment(true), variant: 'warning', icon: '💵' }); break;
      case 'paid': actions.push({ label: 'Réouvrir', status: 'sent', variant: 'outline', icon: '↩' }); break;
      case 'cancelled': actions.push({ label: 'Réactiver', status: 'draft', variant: 'outline', icon: '↩' }); break;
    }
    return actions;
  }, [inv.status, inv.id]);

  return <div><div style={{ ...S.flexBetween, marginBottom: 16 }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><button style={S.btn('ghost')} onClick={onBack}>← Retour</button><h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#2A7B88' }}>{inv.number}</h2><StatusBadge status={inv.status} /></div><div style={S.flexRow}><button style={S.btn('outline')} onClick={() => setShowEdit(true)}>✏️ Modifier</button><button style={S.btn('outline')} onClick={() => onPdf(inv.id)}>📄 PDF</button><button style={S.btn('outline')} onClick={() => onEmail(inv.id)}>✉️ Courriel</button><button style={S.btn('ghost')} onClick={() => onDuplicate(inv.id)}>📋 Dupliquer</button>{inv.status === 'draft' && <button style={S.btn('danger')} onClick={() => onDelete(inv.id)}>🗑 Supprimer</button>}</div></div><div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontSize: 12, fontWeight: 600, color: '#6C757D' }}>ACTIONS:</span>{workflowActions.map((a, i) => <button key={i} style={S.btn(a.variant)} onClick={() => a.fn ? a.fn() : onStatusChange(inv.id, a.status)}>{a.icon} {a.label}</button>)}</div><div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}><div style={S.statCard('#2A7B88')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>CLIENT</div><div style={{ fontSize: 14, fontWeight: 700 }}>{inv.client_name}</div><div style={{ fontSize: 11, color: '#6C757D' }}>{inv.client_email}</div></div><div style={S.statCard('#6C757D')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>RESSOURCE</div><div style={{ fontSize: 14, fontWeight: 700 }}>{inv.employee_name}</div><div style={{ fontSize: 11, color: '#6C757D' }}>{inv.employee_title}</div></div><div style={S.statCard('#2A7B88')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>PÉRIODE</div><div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</div></div><div style={S.statCard(inv.balance_due > 0 ? '#DC3545' : '#28A745')}><div style={{ fontSize: 11, color: '#6C757D', fontWeight: 600 }}>SOLDE DÛ</div><div style={{ fontSize: 22, fontWeight: 700, color: inv.balance_due > 0 ? '#DC3545' : '#28A745' }}>{fmt(inv.balance_due)}</div></div></div><div style={{ ...S.tabs, marginBottom: 12 }}>{['lines', 'payments', 'attachments', 'audit'].map(t => <button key={t} style={S.tab(detailTab === t)} onClick={() => setDetailTab(t)}>{t === 'lines' ? '📋 Lignes' : t === 'payments' ? `💰 Paiements (${(inv.payments || []).length})` : t === 'attachments' ? `📎 Pièces jointes (${attachments.length})` : `📜 Historique (${(inv.audit_logs || []).length})`}</button>)}</div>{detailTab === 'lines' && <div style={S.card}><div style={S.empty}>Détail facture conservé.</div></div>}{detailTab === 'payments' && <div style={S.card}><div style={S.flexBetween}><h4 style={{ ...S.sectionTitle, margin: 0 }}>💰 Paiements</h4>{!['draft', 'cancelled', 'paid'].includes(inv.status) && <button style={S.btn('success')} onClick={() => setShowPayment(true)}>+ Nouveau paiement</button>}</div>{(inv.payments || []).length === 0 ? <div style={S.empty}>Aucun paiement enregistré</div> : <table style={{ ...S.table, marginTop: 12 }}><thead><tr>{['Date', 'Montant', 'Méthode', 'Référence', 'Notes', ''].map((h) => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}</tr></thead><tbody>{inv.payments.map(p => <tr key={p.id}><td style={S.td}>{fmtDate(p.date)}</td><td style={{ ...S.td, fontWeight: 600, color: '#28A745' }}>{fmt(p.amount)}</td><td style={S.td}>{p.method}</td><td style={S.td}>{p.reference || '—'}</td><td style={S.td}>{p.notes || '—'}</td><td style={S.td}><button style={S.btn('danger', 'sm')} onClick={() => deletePayment(p.id)}>🗑</button></td></tr>)}</tbody></table>}</div>}{detailTab === 'attachments' && <div style={S.card}><h4 style={{ ...S.sectionTitle, margin: '0 0 12px 0' }}>📎 Pièces jointes</h4><div style={{ background: '#f8f9fa', borderRadius: 8, padding: 14, marginBottom: 16, border: '1px dashed #ced4da' }}><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}><div style={{ flex: 1, minWidth: 140 }}><label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Catégorie</label><select style={{ ...S.select, width: '100%' }} value={attCategory} onChange={e => setAttCategory(e.target.value)}><option value="hebergement">Hébergement</option><option value="deplacement">Déplacement</option><option value="kilometrage">Kilométrage</option><option value="autre">Autre</option></select></div><div style={{ flex: 2, minWidth: 180 }}><label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description (opt.)</label><input style={{ ...S.input, width: '100%' }} value={attDescription} onChange={e => setAttDescription(e.target.value)} placeholder="Reçu hôtel, facture..." /></div><div><label style={{ ...S.btn('primary', 'sm'), cursor: 'pointer', display: 'inline-block' }}>{attUploading ? '⏳ Upload...' : '📤 Ajouter fichier'}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif" style={{ display: 'none' }} onChange={handleAttUpload} disabled={attUploading} /></label></div></div></div>{attLoading ? <div style={S.empty}>Chargement...</div> : attachments.length === 0 ? <div style={S.empty}>Aucune pièce jointe</div> : <div>{attachments.map(att => <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}><span style={{ fontSize: 24 }}>{typeIcons[att.file_type] || '📄'}</span><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</div><div style={{ fontSize: 11, color: '#6C757D' }}><span style={{ background: '#e9ecef', borderRadius: 4, padding: '1px 6px', marginRight: 6 }}>{catLabels[att.category] || att.category}</span>{fmtSize(att.file_size)}</div></div><button style={{ ...S.btn('outline', 'sm'), padding: '4px 8px' }} onClick={() => viewAttachment(att.id)} title="Voir">👁️</button><button style={{ ...S.btn('danger', 'sm'), padding: '4px 8px' }} onClick={() => deleteAttachment(att.id)} title="Supprimer">🗑️</button></div>)}</div>}{attachments.length > 0 && <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e9ecef' }}><button style={S.btn('primary', 'md')} onClick={downloadPdfWithAttachments}>📥 Télécharger PDF facture + pièces jointes</button></div>}</div>}{detailTab === 'audit' && <div style={S.card}><div style={S.empty}>Historique conservé.</div></div>}<InvoiceEditModal open={showEdit} onClose={() => setShowEdit(false)} invoice={inv} onSave={saveInvoiceEdits} /><Modal open={showPayment} onClose={() => setShowPayment(false)} title="Enregistrer un paiement"><div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Montant ($)</label><input type="number" step="0.01" style={{ ...S.input, width: '100%' }} value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder={`Max: ${inv.balance_due?.toFixed(2)}`} /></div><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Date</label><input type="date" style={{ ...S.input, width: '100%' }} value={payDate} onChange={e => setPayDate(e.target.value)} /></div><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Méthode</label><select style={{ ...S.select, width: '100%' }} value={payMethod} onChange={e => setPayMethod(e.target.value)}><option value="virement">Virement</option><option value="cheque">Chèque</option><option value="eft">EFT</option><option value="carte">Carte</option><option value="autre">Autre</option></select></div><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Référence</label><input style={{ ...S.input, width: '100%' }} value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="# chèque, # virement..." /></div><button style={S.btn('success', 'md')} onClick={addPayment} disabled={!payAmount || parseFloat(payAmount) <= 0}>💰 Enregistrer le paiement</button></div></Modal></div>;
}

function ReportsTab({ reportData, reportType, onLoadReport, onOpenInvoice, onMarkPaid }) {
  const [expandedClient, setExpandedClient] = useState(null);
  return <div><div style={{ ...S.flexRow, marginBottom: 16 }}>{[{ id: 'by-client', label: '📊 Par client' }, { id: 'by-employee', label: '👤 Par employé' }, { id: 'by-period', label: '📅 Par mois' }].map(r => <button key={r.id} style={S.btn(reportType === r.id ? 'primary' : 'outline')} onClick={() => onLoadReport(r.id)}>{r.label}</button>)}</div><div style={S.empty}>{reportData ? 'Rapport chargé.' : 'Sélectionnez un rapport'}</div></div>;
}

function CreditNotesTab({ creditNotes, onRefresh, setError, setSuccess, clients, invoices }) {
  const [showCreate, setShowCreate] = useState(false);
  const [cnInvoiceId, setCnInvoiceId] = useState('');
  const [cnClientId, setCnClientId] = useState('');
  const [cnReason, setCnReason] = useState('');
  const [cnAmount, setCnAmount] = useState('');
  const [cnIncludeTax, setCnIncludeTax] = useState(true);
  const [selectedCn, setSelectedCn] = useState(new Set());
  const toggleCn = (id) => setSelectedCn(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllCn = () => { if (selectedCn.size === creditNotes.length) setSelectedCn(new Set()); else setSelectedCn(new Set(creditNotes.map(c => c.id))); };
  const bulkDeleteCreditNotes = async () => {
    if (!selectedCn.size) return;
    if (!confirm('Supprimer les notes de crédit sélectionnées?')) return;
    try {
      const res = await apiFetch('/invoices/credit-notes/bulk-delete', { method: 'POST', body: JSON.stringify([...selectedCn]) });
      setSuccess(`${res.count || 0} note(s) de crédit supprimée(s)`);
      setSelectedCn(new Set());
      onRefresh();
    } catch (e) { setError(e.message); }
  };
  const createCreditNote = async () => { try { await apiFetch('/invoices/credit-notes', { method: 'POST', body: JSON.stringify({ invoice_id: cnInvoiceId || null, client_id: cnClientId ? parseInt(cnClientId) : null, reason: cnReason, amount: parseFloat(cnAmount), include_tax: cnIncludeTax }) }); setSuccess('Note de crédit créée'); setShowCreate(false); setCnReason(''); setCnAmount(''); setCnInvoiceId(''); setCnClientId(''); onRefresh(); } catch (e) { setError(e.message); } };
  const openPdf = (id) => { const token = getToken(); window.open(`${API}/invoices/credit-notes/${id}/pdf?token=${token}`, '_blank'); };
  return <div><div style={{ ...S.flexBetween, marginBottom: 16 }}><h3 style={S.sectionTitle}>📝 Notes de crédit</h3><div style={S.flexRow}>{selectedCn.size > 0 && <button style={S.btn('danger')} onClick={bulkDeleteCreditNotes}>Supprimer la sélection</button>}<button style={S.btn('primary')} onClick={() => setShowCreate(true)}>+ Nouvelle note de crédit</button></div></div>{creditNotes.length === 0 ? <div style={S.empty}>Aucune note de crédit</div> : <table style={S.table}><thead><tr><th style={{ ...S.th, width: 30 }}><input type="checkbox" checked={selectedCn.size === creditNotes.length && creditNotes.length > 0} onChange={toggleAllCn} /></th>{['Numéro', 'Date', 'Client', 'Facture réf.', 'Raison', 'Montant', 'Total', 'Statut', ''].map((h, i) => <th key={h} style={{ ...S.th, ...(i >= 5 && i <= 6 ? { textAlign: 'right' } : {}) }}>{h}</th>)}</tr></thead><tbody>{creditNotes.map((cn, i) => <tr key={cn.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}><td style={S.td}><input type="checkbox" checked={selectedCn.has(cn.id)} onChange={() => toggleCn(cn.id)} /></td><td style={{ ...S.td, fontWeight: 600, color: '#DC3545' }}>{cn.number}</td><td style={S.td}>{fmtDate(cn.date)}</td><td style={S.td}>{cn.client_name}</td><td style={S.td}>{cn.invoice_number || '—'}</td><td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cn.reason}</td><td style={{ ...S.td, textAlign: 'right' }}>{fmt(cn.amount)}</td><td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: '#DC3545' }}>{fmt(cn.total)}</td><td style={S.td}><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: cn.status === 'active' ? '#E8F4F6' : '#f8d7da', color: cn.status === 'active' ? '#2A7B88' : '#DC3545' }}>{cn.status === 'active' ? 'Active' : 'Annulée'}</span></td><td style={S.td}><button style={S.btn('ghost')} onClick={() => openPdf(cn.id)}>📄 PDF</button></td></tr>)}</tbody></table>}<Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle note de crédit"><div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Facture liée (optionnel)</label><select style={{ ...S.select, width: '100%' }} value={cnInvoiceId} onChange={e => setCnInvoiceId(e.target.value)}><option value="">— Aucune —</option>{invoices.map(inv => <option key={inv.id} value={inv.id}>{inv.number} — {inv.client_name}</option>)}</select></div><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label><select style={{ ...S.select, width: '100%' }} value={cnClientId} onChange={e => setCnClientId(e.target.value)}><option value="">— Sélectionner —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Raison</label><textarea style={{ ...S.input, width: '100%', minHeight: 60 }} value={cnReason} onChange={e => setCnReason(e.target.value)} placeholder="Raison de la note de crédit..." /></div><div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Montant ($)</label><input type="number" step="0.01" style={{ ...S.input, width: '100%' }} value={cnAmount} onChange={e => setCnAmount(e.target.value)} /></div><div><label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={cnIncludeTax} onChange={e => setCnIncludeTax(e.target.checked)} /> Inclure TPS/TVQ</label></div><button style={S.btn('danger', 'md')} onClick={createCreditNote} disabled={!cnReason || !cnAmount}>Créer la note de crédit</button></div></Modal></div>;
}

function AnomaliesTab({ anomalies, onRefresh, onOpenInvoice, setError, setSuccess }) {
  const [selectedInv, setSelectedInv] = useState(new Set());
  const sevColor = { error: '#DC3545', warning: '#FFC107' };
  const typeLabels = { duplicate: '🔄 Doublon', excessive_hours: '⏰ Heures excessives', rate_mismatch: '💲 Taux incorrect', no_client: '❌ Sans client' };
  const toggleInv = (id) => setSelectedInv(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllInv = () => { const ids = anomalies.map(a => a.invoice_id).filter(Boolean); if (selectedInv.size === ids.length) setSelectedInv(new Set()); else setSelectedInv(new Set(ids)); };
  const bulkDeleteAnomalyInvoices = async () => {
    if (!selectedInv.size) return;
    if (!confirm('Supprimer les factures sélectionnées depuis les anomalies? Les factures non brouillon / non annulées seront ignorées.')) return;
    try {
      const res = await apiFetch('/invoices/bulk-delete', { method: 'POST', body: JSON.stringify([...selectedInv]) });
      setSuccess(`${res.count || 0} facture(s) supprimée(s)`);
      setSelectedInv(new Set());
      onRefresh();
    } catch (e) { setError(e.message); }
  };
  return <div><div style={{ ...S.flexBetween, marginBottom: 16 }}><h3 style={S.sectionTitle}>⚠️ Détection d'anomalies</h3><div style={S.flexRow}>{selectedInv.size > 0 && <button style={S.btn('danger')} onClick={bulkDeleteAnomalyInvoices}>Supprimer les factures sélectionnées</button>}<button style={S.btn('outline')} onClick={onRefresh}>🔄 Actualiser</button></div></div>{anomalies.length === 0 ? <div style={{ ...S.card, textAlign: 'center', padding: 40 }}><div style={{ fontSize: 40, marginBottom: 8 }}>✅</div><div style={{ fontSize: 16, fontWeight: 600, color: '#28A745' }}>Aucune anomalie détectée</div></div> : <div><div style={{ marginBottom: 12, fontSize: 13, color: '#6C757D' }}>{anomalies.length} anomalie(s) détectée(s)</div><table style={S.table}><thead><tr><th style={{ ...S.th, width: 30 }}><input type="checkbox" checked={selectedInv.size === anomalies.map(a => a.invoice_id).filter(Boolean).length && anomalies.length > 0} onChange={toggleAllInv} /></th><th style={S.th}>Type</th><th style={S.th}>Description</th><th style={S.th}>Facture</th><th style={S.th}>Sévérité</th><th style={S.th}></th></tr></thead><tbody>{anomalies.map((a, i) => <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}><td style={S.td}>{a.invoice_id ? <input type="checkbox" checked={selectedInv.has(a.invoice_id)} onChange={() => toggleInv(a.invoice_id)} /> : null}</td><td style={{ ...S.td, fontWeight: 700 }}>{typeLabels[a.type] || a.type}</td><td style={S.td}>{a.description}</td><td style={S.td}>{a.invoice_number}</td><td style={S.td}><span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 600, background: a.severity === 'error' ? '#f8d7da' : '#fff3cd', color: a.severity === 'error' ? '#DC3545' : '#856404' }}>{a.severity === 'error' ? 'Erreur' : 'Avertissement'}</span></td><td style={S.td}><button style={S.btn('outline')} onClick={() => onOpenInvoice(a.invoice_id)}>Voir</button></td></tr>)}</tbody></table></div>}</div>;
}
