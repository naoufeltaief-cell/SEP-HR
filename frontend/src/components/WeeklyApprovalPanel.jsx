import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('sep_token') || '';
}

function sundayOf(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `Erreur ${resp.status}` }));
    throw new Error(err.detail || `Erreur ${resp.status}`);
  }
  return resp.json();
}

async function apiJson(path, method, body) {
  return api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export default function WeeklyApprovalPanel({ toast, onNavigate }) {
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [clientId, setClientId] = useState('');
  const [weekStart, setWeekStart] = useState(sundayOf());
  const [plannedHours, setPlannedHours] = useState(0);
  const [shiftCount, setShiftCount] = useState(0);
  const [approvedHours, setApprovedHours] = useState(0);
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentInvoice, setCurrentInvoice] = useState(null);
  const [weekSchedules, setWeekSchedules] = useState([]);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  useEffect(() => {
    Promise.all([
      api('/employees/'),
      api('/clients/'),
    ]).then(([emps, cls]) => {
      setEmployees(emps || []);
      setClients(cls || []);
      if (emps?.[0]?.id) setEmployeeId(String(emps[0].id));
    }).catch((e) => toast?.(`Erreur: ${e.message}`));
  }, [toast]);

  useEffect(() => {
    if (!employeeId || !weekStart) return;
    let mounted = true;
    setLoading(true);
    api(`/schedules/?start=${weekStart}&end=${weekEnd}&employee_id=${employeeId}`)
      .then((scheds) => {
        if (!mounted) return;
        const employeeWeekSchedules = scheds || [];
        setWeekSchedules(employeeWeekSchedules);
        const clientIds = [...new Set(employeeWeekSchedules.map((s) => s.client_id).filter(Boolean).map(String))];
        if (clientIds.length > 0 && (!clientId || !clientIds.includes(String(clientId)))) {
          setClientId(clientIds[0]);
        }
        if (clientIds.length === 0 && clientId) {
          setClientId('');
        }
      })
      .catch((e) => toast?.(`Erreur: ${e.message}`))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [employeeId, weekStart, weekEnd, toast]);

  useEffect(() => {
    if (!employeeId || !weekStart) return;
    let mounted = true;
    setLoading(true);
    const effectiveClientId = clientId || '';
    Promise.all([
      effectiveClientId ? api(`/schedule-reviews/?employee_id=${employeeId}&client_id=${effectiveClientId}&week_start=${weekStart}`) : Promise.resolve([]),
      effectiveClientId ? api(`/invoices/?employee_id=${employeeId}&client_id=${effectiveClientId}&period_start=${weekStart}&period_end=${weekEnd}`) : Promise.resolve([]),
    ]).then(async ([reviews, invoices]) => {
      if (!mounted) return;
      const filtered = effectiveClientId ? weekSchedules.filter((s) => String(s.client_id || '') === String(effectiveClientId)) : weekSchedules;
      const total = filtered.reduce((sum, s) => sum + Number(s.hours || 0), 0);
      setPlannedHours(Number(total.toFixed(2)));
      setShiftCount(filtered.length);
      const current = (reviews || [])[0] || null;
      setReview(current);
      setApprovedHours(current ? Number(current.approved_hours || 0) : Number(total.toFixed(2)));
      setNotes(current?.notes || '');
      setCurrentInvoice((invoices || [])[0] || null);
      if (current?.id) {
        const att = await api(`/schedule-reviews/${current.id}/attachments`);
        if (mounted) setAttachments(att || []);
      } else {
        setAttachments([]);
      }
    }).catch((e) => toast?.(`Erreur: ${e.message}`)).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [employeeId, clientId, weekStart, weekEnd, weekSchedules, toast]);

  const clientOptions = useMemo(() => {
    const ids = [...new Set(weekSchedules.map((s) => s.client_id).filter(Boolean).map(String))];
    if (ids.length === 0) return clients;
    return clients.filter((c) => ids.includes(String(c.id)));
  }, [clients, weekSchedules]);

  const saveReview = async (approve = false) => {
    if (!employeeId || !clientId) {
      toast?.('Sélectionnez un employé et un client ayant des quarts cette semaine');
      return;
    }
    try {
      setLoading(true);
      const path = approve ? '/schedule-reviews/approve-week' : '/schedule-reviews/review-week';
      const data = await apiJson(path, 'POST', {
        employee_id: Number(employeeId),
        client_id: Number(clientId),
        week_start: weekStart,
        approved_hours: Number(approvedHours || 0),
        notes,
      });
      setReview(data);
      setApprovedHours(Number(data.approved_hours || approvedHours || 0));
      setNotes(data.notes || '');
      const att = await api(`/schedule-reviews/${data.id}/attachments`);
      setAttachments(att || []);
      toast?.(approve ? 'Semaine approuvée' : 'Révision enregistrée');
    } catch (e) {
      toast?.(`Erreur: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const revokeReview = async () => {
    if (!employeeId || !clientId) return;
    try {
      setLoading(true);
      await apiJson('/schedule-reviews/revoke-week', 'POST', {
        employee_id: Number(employeeId),
        client_id: Number(clientId),
        week_start: weekStart,
      });
      setReview((r) => r ? { ...r, status: 'rejected' } : r);
      toast?.('Approbation révoquée');
    } catch (e) {
      toast?.(`Erreur: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadAttachment = async (file) => {
    if (!review?.id || !file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', 'justificatif');
    formData.append('description', file.name);
    formData.append('uploaded_by', 'admin');
    try {
      setLoading(true);
      await api(`/schedule-reviews/${review.id}/attachments`, {
        method: 'POST',
        body: formData,
      });
      const att = await api(`/schedule-reviews/${review.id}/attachments`);
      setAttachments(att || []);
      toast?.('Pièce justificative ajoutée');
    } catch (e) {
      toast?.(`Erreur: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const generateApprovedInvoice = async () => {
    if (!employeeId || !clientId) return;
    try {
      setLoading(true);
      const data = await apiJson('/invoices-approved/generate-from-approved-schedules', 'POST', {
        employee_id: Number(employeeId),
        client_id: Number(clientId),
        period_start: weekStart,
        period_end: weekEnd,
      });
      setCurrentInvoice(data);
      toast?.(`Facture approuvée générée: ${data.number}`);
    } catch (e) {
      toast?.(`Erreur: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 4px 14px rgba(0,0,0,.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--brand)' }}>Approbation hebdomadaire des heures</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Les quarts et le client se remplissent automatiquement selon l'employé et la semaine.</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{review?.status ? `Statut: ${review.status}` : 'Aucune révision enregistrée'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choisir employé</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Choisir client</option>
          {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input" type="date" value={weekStart} onChange={(e) => setWeekStart(sundayOf(e.target.value))} />
        <input className="input" type="number" step="0.25" value={approvedHours} onChange={(e) => setApprovedHours(e.target.value)} placeholder="Heures approuvées" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: 'var(--text3)' }}>Semaine</div><div style={{ fontWeight: 700 }}>{weekStart} → {weekEnd}</div></div>
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: 'var(--text3)' }}>Quarts</div><div style={{ fontWeight: 700 }}>{shiftCount}</div></div>
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: 'var(--text3)' }}>Heures planifiées</div><div style={{ fontWeight: 700 }}>{plannedHours.toFixed(2)}h</div></div>
        <div style={{ background: '#eefaf3', borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: 'var(--text3)' }}>Heures approuvées</div><div style={{ fontWeight: 800, color: '#1d7f49' }}>{Number(approvedHours || 0).toFixed(2)}h</div></div>
      </div>

      {currentInvoice && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', background: '#eef7ff', border: '1px solid #c7e1ff', borderRadius: 10, padding: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Facture générée pour cette période</div>
            <div style={{ fontWeight: 800 }}>{currentInvoice.number} {currentInvoice.total ? `— ${Number(currentInvoice.total).toFixed(2)}$` : ''}</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => onNavigate?.('invoices')}>Voir dans Facturation</button>
        </div>
      )}

      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes de vérification / justificatifs" style={{ width: '100%', resize: 'vertical', marginBottom: 12 }} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => saveReview(false)} disabled={loading}>Enregistrer la révision</button>
        <button className="btn btn-primary btn-sm" onClick={() => saveReview(true)} disabled={loading || !shiftCount}>Approuver les heures</button>
        <button className="btn btn-outline btn-sm" onClick={revokeReview} disabled={loading || !review}>Révoquer</button>
        <button className="btn btn-primary btn-sm" onClick={generateApprovedInvoice} disabled={loading || review?.status !== 'approved' || !shiftCount}>Générer la facture approuvée</button>
        <label className="btn btn-outline btn-sm" style={{ cursor: review?.id ? 'pointer' : 'not-allowed', opacity: review?.id ? 1 : 0.55 }}>
          Ajouter justificatif
          <input type="file" style={{ display: 'none' }} disabled={!review?.id} onChange={(e) => uploadAttachment(e.target.files?.[0])} />
        </label>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
        {loading ? 'Traitement en cours…' : `${attachments.length} justificatif(s) joint(s)`}
      </div>
      {attachments.length > 0 && (
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {attachments.map((att) => (
            <div key={att.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ fontSize: 12 }}>{att.filename}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{att.category}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
