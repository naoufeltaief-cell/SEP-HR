import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { fmtMoney, RATE_KM } from '../utils/helpers';
import { Avatar, Badge, Modal } from '../components/UI';
import { Plus, Eye, Edit3, Check, Send, DollarSign, AlertTriangle, ChevronDown, ChevronUp, X, Truck, MapPin, FileText, Printer } from 'lucide-react';

const GARDE_RATE = 86.23;
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

// ── Overdue helper ──
function isOverdue(inv) {
  if (inv.status === 'paid') return false;
  const d = new Date(inv.date);
  const diff = Math.floor((new Date() - d) / (1000 * 60 * 60 * 24));
  return diff > 30;
}
function daysOverdue(inv) {
  const d = new Date(inv.date);
  return Math.floor((new Date() - d) / (1000 * 60 * 60 * 24)) - 30;
}

// ══════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════
export default function InvoicesPage({ toast }) {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [accommodations, setAccommodations] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [subTab, setSubTab] = useState('factures'); // factures, clients, creditnotes
  const [preview, setPreview] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [reminderModal, setReminderModal] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [inv, cl, emp, ts, sch, acc] = await Promise.all([
        api.getInvoices(), api.getClients(), api.getEmployees(),
        api.getTimesheets(), api.getSchedules(), api.getAccommodations(),
      ]);
      setInvoices(inv); setClients(cl); setEmployees(emp);
      setTimesheets(ts); setSchedules(sch); setAccommodations(acc);
    } catch (err) { toast?.('Erreur: ' + err.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  // ── Derived data ──
  const approvedTSCount = timesheets.filter(t => t.status === 'approved').length;
  const overdueInvoices = useMemo(() => invoices.filter(isOverdue), [invoices]);
  const totalInvoiced = invoices.reduce((s, i) => s + (i.total || 0), 0);

  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`;
  const clientObj = (id) => clients.find(c => c.id === id);

  // ── Actions ──
  const markPaid = async (id) => {
    try { await api.markPaid(id); toast?.('Facture marquée payée'); reload(); }
    catch (err) { toast?.('Erreur: ' + err.message); }
  };

  // ── Create/Edit Modal ──
  const openCreate = () => {
    const num = `GTI-2026-${String(invoices.length + 1).padStart(3, '0')}`;
    setCreateModal({
      number: num, date: new Date().toISOString().slice(0, 10),
      period_start: '', period_end: '', client_id: 0,
      include_tax: true, notes: '', status: 'draft',
      lines: [{ id: 1, employee: '', hours: 0, rate: 0, amount: 0, description: '', start: '', end: '', pause: 0, note: '' }],
      frais: [],
    });
  };

  const openEdit = (inv) => {
    setCreateModal({
      _editId: inv.id,
      number: inv.number, date: inv.date, period_start: inv.period_start || '',
      period_end: inv.period_end || '', client_id: inv.client_id || 0,
      include_tax: inv.include_tax !== false, notes: inv.notes || '', status: inv.status,
      lines: (inv.lines || []).map((l, i) => ({
        id: i + 1, employee: l.employee || l.description || '',
        hours: l.hoursWorked || l.hours_worked || 0, rate: l.rate || 0,
        amount: l.serviceAmt || l.lineTotal || l.amount || 0,
        description: l.description || '', start: l.start || '', end: l.end || '',
        pause: l.pause || 0, note: l.note || '',
      })),
      frais: inv.frais_additionnels || [],
    });
  };

  // ── Draft from approved timesheets ──
  const openDraftFromFDT = () => {
    const approved = timesheets.filter(t => t.status === 'approved');
    if (!approved.length) { toast?.('Aucune FDT approuvée'); return; }

    const allShifts = []; const dates = [];
    approved.forEach(ts => {
      (ts.shifts || []).forEach(sh => {
        const sched = schedules.find(s => s.id === sh.schedule_id);
        const emp = employees.find(e => e.id === ts.employee_id);
        if (!sched) return;
        dates.push(sh.date);
        const serviceAmt = Math.round(sh.hours_worked * (sched.billable_rate || 0) * 100) / 100;
        const gardeFacturable = Math.round((sh.garde_hours || 0) / 8 * 100) / 100;
        const gardeAmt = Math.round(gardeFacturable * GARDE_RATE * 100) / 100;
        const rappelAmt = Math.round((sh.rappel_hours || 0) * (sched.billable_rate || 0) * 100) / 100;
        allShifts.push({
          employee: emp?.name || '', date: sh.date, location: sched.location || '',
          start: sched.start, end: sched.end,
          hoursWorked: sh.hours_worked, pause: sh.pause,
          gardeHours: sh.garde_hours || 0, gardeFacturable,
          rappelHours: sh.rappel_hours || 0,
          rate: sched.billable_rate || 0,
          serviceAmt, gardeAmt, rappelAmt,
          lineTotal: serviceAmt + gardeAmt + rappelAmt,
          note: '',
        });
      });
    });

    dates.sort();
    const periodStart = dates[0];
    const periodEnd = dates[dates.length - 1];
    const num = `GTI-2026-${String(invoices.length + 1).padStart(3, '0')}`;

    // Auto-detect client from employees
    const clientCounts = {};
    approved.forEach(ts => {
      const emp = employees.find(e => e.id === ts.employee_id);
      if (emp?.client_id) clientCounts[emp.client_id] = (clientCounts[emp.client_id] || 0) + 1;
    });
    let defaultClientId = 0;
    Object.entries(clientCounts).forEach(([cid, cnt]) => {
      if (cnt > (clientCounts[defaultClientId] || 0)) defaultClientId = Number(cid);
    });

    setCreateModal({
      _isDraft: true,
      number: num, date: new Date().toISOString().slice(0, 10),
      period_start: periodStart, period_end: periodEnd,
      client_id: defaultClientId, include_tax: true, notes: '', status: 'draft',
      lines: allShifts.map((l, i) => ({ id: i + 1, ...l })),
      frais: [],
      _approvedIds: approved.map(t => t.id),
    });
  };

  // ── Line management ──
  const addLine = () => {
    setCreateModal(m => ({
      ...m, lines: [...m.lines, { id: Date.now(), employee: '', hours: 0, rate: 0, amount: 0, description: '', start: '', end: '', pause: 0, note: '' }]
    }));
  };
  const removeLine = (id) => setCreateModal(m => ({ ...m, lines: m.lines.filter(l => l.id !== id) }));
  const updateLine = (id, key, val) => {
    setCreateModal(m => {
      const lines = m.lines.map(l => {
        if (l.id !== id) return l;
        const updated = { ...l, [key]: val };
        if (['hours', 'rate'].includes(key)) updated.amount = Math.round((updated.hours || 0) * (updated.rate || 0) * 100) / 100;
        return updated;
      });
      return { ...m, lines };
    });
  };

  // ── Frais management ──
  const addFrais = (type) => {
    setCreateModal(m => ({
      ...m, frais: [...m.frais, { id: Date.now(), type, montant: 0, km: 0, description: '', heures: 0, taux: 0 }]
    }));
  };
  const removeFrais = (id) => setCreateModal(m => ({ ...m, frais: m.frais.filter(f => f.id !== id) }));
  const updateFrais = (id, field, val) => {
    setCreateModal(m => ({
      ...m, frais: m.frais.map(f => {
        if (f.id !== id) return f;
        const updated = { ...f, [field]: field === 'description' ? val : (parseFloat(val) || 0) };
        if (field === 'km') updated.montant = Math.round(updated.km * RATE_KM * 100) / 100;
        if (field === 'heures' || field === 'taux') updated.montant = Math.round((updated.heures || 0) * (updated.taux || 0) * 100) / 100;
        return updated;
      })
    }));
  };

  // ── Save ──
  const saveInvoice = async (status) => {
    const m = createModal;
    if (!m.number) { toast?.('Numéro requis'); return; }
    const validLines = m.lines.filter(l => (l.amount || 0) > 0 || (l.lineTotal || 0) > 0);

    const apiLines = validLines.map(l => ({
      employee: l.employee, hoursWorked: l.hoursWorked || l.hours, rate: l.rate,
      serviceAmt: l.serviceAmt || l.amount, gardeAmt: l.gardeAmt || 0, rappelAmt: l.rappelAmt || 0,
      lineTotal: l.lineTotal || l.amount, description: l.description,
      start: l.start, end: l.end, pause: l.pause, note: l.note,
      date: l.date, location: l.location,
    }));

    try {
      const payload = {
        number: m.number, date: m.date,
        period_start: m.period_start || null, period_end: m.period_end || null,
        client_id: m.client_id || null, include_tax: m.include_tax,
        status, notes: m.notes, lines: apiLines,
        frais_additionnels: m.frais,
      };

      if (m._editId) {
        await api.updateInvoice(m._editId, payload);
        toast?.(`Facture ${m.number} mise à jour`);
      } else {
        await api.createInvoice(payload);
        toast?.(`Facture ${m.number} ${status === 'draft' ? 'sauvegardée' : 'confirmée'}`);
      }
      setCreateModal(null);
      reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  // ── Computed totals ──
  const modalTotals = useMemo(() => {
    if (!createModal) return {};
    const stS = createModal.lines.reduce((s, l) => s + (l.serviceAmt || l.amount || 0), 0);
    const stG = createModal.lines.reduce((s, l) => s + (l.gardeAmt || 0), 0);
    const stR = createModal.lines.reduce((s, l) => s + (l.rappelAmt || 0), 0);
    const totalFrais = (createModal.frais || []).reduce((s, f) => {
      if (f.type === 'kilometrage') return s + Math.round((f.km || 0) * RATE_KM * 100) / 100;
      if (f.type === 'deplacement') return s + Math.round((f.heures || 0) * (f.taux || 0) * 100) / 100;
      return s + (f.montant || 0);
    }, 0);
    const sub = stS + stG + stR + totalFrais;
    const tps = createModal.include_tax ? Math.round(sub * TPS_RATE * 100) / 100 : 0;
    const tvq = createModal.include_tax ? Math.round(sub * TVQ_RATE * 100) / 100 : 0;
    const tot = Math.round((sub + tps + tvq) * 100) / 100;
    return { stS, stG, stR, totalFrais, sub, tps, tvq, tot };
  }, [createModal]);

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Chargement...</div>
  );

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════
  return (
    <>
      {/* Overdue banner */}
      {overdueInvoices.length > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: 'var(--r)', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500,
          background: 'var(--red-l)', color: 'var(--red)', border: '1px solid #fca5a5',
        }}>
          <AlertTriangle size={16} />
          <span style={{ background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{overdueInvoices.length}</span>
          <span><strong>{overdueInvoices.length} facture(s) en retard</strong> — Paiement dépassé de plus de 30 jours.</span>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          <DollarSign size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Facturation
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {approvedTSCount > 0 && (
            <button className="btn btn-outline btn-sm" onClick={openDraftFromFDT}>
              <FileText size={13} /> Brouillon FDT ({approvedTSCount})
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} /> Créer une facture
          </button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
        {invoices.length} facture(s) — Total: <strong style={{ color: 'var(--brand)' }}>{fmtMoney(totalInvoiced)}</strong>
      </div>

      {/* Sub-tabs */}
      <div className="tab-bar" style={{ marginBottom: 16 }}>
        {[
          { id: 'factures', label: 'Factures' },
          { id: 'clients', label: 'Clients' },
          { id: 'creditnotes', label: 'Notes de crédit' },
        ].map(t => (
          <button key={t.id} className={`tab-btn ${subTab === t.id ? 'active' : ''}`}
            onClick={() => setSubTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      {subTab === 'factures' && (
        <>
          {invoices.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
              <p>Aucune facture créée.</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Créez une facture manuellement ou approuvez des FDT pour générer un brouillon.</p>
            </div>
          )}
          {invoices.map(inv => (
            <InvoiceCard key={inv.id} inv={inv} clients={clients}
              onPreview={() => setPreview(inv)}
              onEdit={() => openEdit(inv)}
              onMarkPaid={() => markPaid(inv.id)}
              onSendReminder={() => setReminderModal(inv)}
            />
          ))}
        </>
      )}

      {subTab === 'clients' && (
        <ClientsList clients={clients} invoices={invoices} toast={toast} reload={reload} />
      )}

      {subTab === 'creditnotes' && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          <p>Notes de crédit — À venir</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Les notes de crédit seront générées depuis les factures existantes.</p>
        </div>
      )}

      {/* ── PREVIEW MODAL ── */}
      {preview && (
        <Modal title="Aperçu — Facture client" onClose={() => setPreview(null)} wide>
          <InvoicePreview inv={preview} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setPreview(null)}>Fermer</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                const el = document.getElementById('invoice-preview');
                if (!el) return;
                const win = window.open('', '_blank', 'width=900,height=700');
                win.document.write(`<!DOCTYPE html><html><head><title>Facture — Soins Expert Plus</title><style>body{margin:0;padding:20px;font-family:system-ui,sans-serif}@media print{body{padding:0}}</style></head><body>${el.innerHTML}</body></html>`);
                win.document.close();
                setTimeout(() => win.print(), 300);
              }}>
              <Printer size={14} /> Imprimer / PDF
            </button>
          </div>
        </Modal>
      )}

      {/* ── REMINDER MODAL ── */}
      {reminderModal && (
        <Modal title="Envoyer un rappel de paiement" onClose={() => setReminderModal(null)}>
          <div style={{ background: 'var(--red-l)', padding: 10, borderRadius: 'var(--r)', marginBottom: 16, fontSize: 12, color: 'var(--red)' }}>
            <strong>Facture {reminderModal.number}</strong> — {fmtMoney(reminderModal.total)} — En retard de {daysOverdue(reminderModal)} jour(s)
          </div>
          <div className="field">
            <label>Destinataire</label>
            <input className="input" defaultValue={clientObj(reminderModal.client_id)?.email || reminderModal.client_email || ''} />
          </div>
          <div className="field">
            <label>Message</label>
            <textarea className="input" rows={8} style={{ resize: 'vertical' }}
              defaultValue={`Bonjour,\n\nNous vous rappelons que la facture ${reminderModal.number} d'un montant de ${fmtMoney(reminderModal.total)}, datée du ${reminderModal.date}, demeure impayée.\n\nLe délai de paiement de 30 jours étant dépassé, nous vous prions de bien vouloir procéder au règlement dans les plus brefs délais.\n\nCordialement,\nSoins Expert Plus\nrh@soins-expert-plus.com`} />
          </div>
          <button className="btn btn-danger" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => { toast?.(`Rappel envoyé pour facture ${reminderModal.number}`); setReminderModal(null); }}>
            <Send size={14} /> Envoyer le rappel
          </button>
        </Modal>
      )}

      {/* ── CREATE/EDIT MODAL ── */}
      {createModal && (
        <Modal
          title={createModal._editId ? `Modifier — ${createModal.number}` : createModal._isDraft ? `Brouillon FDT — ${createModal.number}` : `Créer — ${createModal.number}`}
          onClose={() => setCreateModal(null)} wide
        >
          {createModal._editId && (
            <div style={{ background: 'var(--amber-l)', padding: '10px 14px', borderRadius: 'var(--r)', marginBottom: 16, fontSize: 12, color: 'var(--amber)' }}>
              <strong>MODIFICATION</strong> — Les changements remplaceront la version précédente.
            </div>
          )}
          {createModal._isDraft && (
            <div style={{ background: 'var(--amber-l)', padding: '10px 14px', borderRadius: 'var(--r)', marginBottom: 16, fontSize: 12, color: 'var(--amber)' }}>
              <strong>BROUILLON</strong> — Généré depuis {createModal._approvedIds?.length || 0} FDT approuvée(s). Vérifiez avant de confirmer.
            </div>
          )}

          {/* Number + Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="field"><label>N° Facture</label>
              <input className="input" value={createModal.number} onChange={e => setCreateModal(m => ({ ...m, number: e.target.value }))} />
            </div>
            <div className="field"><label>Date</label>
              <input className="input" type="date" value={createModal.date} onChange={e => setCreateModal(m => ({ ...m, date: e.target.value }))} />
            </div>
          </div>

          {/* Client */}
          <div className="field">
            <label>Client (CISSS/CIUSSS)</label>
            <select className="input" value={createModal.client_id || 0}
              onChange={e => setCreateModal(m => ({ ...m, client_id: Number(e.target.value) }))}>
              <option value={0}>— Sélectionner —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Client info */}
          {createModal.client_id > 0 && (() => {
            const cl = clientObj(createModal.client_id);
            return cl ? (
              <div style={{ background: 'var(--teal-l)', padding: '8px 12px', borderRadius: 'var(--r)', marginBottom: 12, fontSize: 11, color: 'var(--teal)' }}>
                <div style={{ fontWeight: 600 }}>🏥 {cl.name}</div>
                {cl.address && <div>📍 {cl.address}</div>}
                {cl.email && <div>📧 {cl.email}</div>}
                {cl.tax_exempt && <div style={{ fontWeight: 700, color: '#059669', marginTop: 4 }}>✅ Client exempté de taxes</div>}
              </div>
            ) : null;
          })()}

          {/* Period */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="field"><label>Période début</label>
              <input className="input" type="date" value={createModal.period_start} onChange={e => setCreateModal(m => ({ ...m, period_start: e.target.value }))} />
            </div>
            <div className="field"><label>Période fin</label>
              <input className="input" type="date" value={createModal.period_end} onChange={e => setCreateModal(m => ({ ...m, period_end: e.target.value }))} />
            </div>
          </div>

          {/* Lines */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>
              Lignes de facturation ({createModal.lines.length})
            </label>
            <button className="btn btn-outline btn-sm" onClick={addLine}><Plus size={14} /> Ajouter</button>
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
            {createModal.lines.map((l, i) => (
              <div key={l.id} style={{
                padding: 10, background: i % 2 ? 'var(--surface)' : 'var(--surface2)',
                borderRadius: 'var(--r)', marginBottom: 4, position: 'relative',
              }}>
                {createModal.lines.length > 1 && (
                  <button onClick={() => removeLine(l.id)} style={{
                    position: 'absolute', top: 4, right: 6, background: 'none',
                    color: 'var(--red)', fontSize: 16, cursor: 'pointer', border: 'none'
                  }}>×</button>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ fontSize: 10 }}>Employé / Description</label>
                    <select className="input" style={{ padding: '5px 8px', fontSize: 12 }}
                      value={l.employee}
                      onChange={e => {
                        const emp = employees.find(x => x.name === e.target.value);
                        updateLine(l.id, 'employee', e.target.value);
                        if (emp) updateLine(l.id, 'rate', emp.rate);
                      }}>
                      <option value="">— Aucun —</option>
                      {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ fontSize: 10 }}>Heures</label>
                    <input className="input" type="number" style={{ padding: '5px 8px', fontSize: 12 }}
                      value={l.hoursWorked || l.hours || 0} min={0} step={0.25}
                      onChange={e => updateLine(l.id, 'hours', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ fontSize: 10 }}>Taux ($/h)</label>
                    <input className="input" type="number" style={{ padding: '5px 8px', fontSize: 12 }}
                      value={l.rate || 0} min={0} step={0.01}
                      onChange={e => updateLine(l.id, 'rate', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ fontSize: 10 }}>Total</label>
                    <div style={{ padding: '5px 8px', fontSize: 13, fontWeight: 700, color: 'var(--brand)', background: 'var(--brand-xl)', borderRadius: 'var(--r)' }}>
                      {fmtMoney(l.serviceAmt || l.amount || l.lineTotal || 0)}
                    </div>
                  </div>
                </div>
                {/* Show garde/rappel for draft lines */}
                {(l.gardeAmt > 0 || l.rappelAmt > 0) && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 10 }}>
                    {l.gardeAmt > 0 && <span style={{ color: 'var(--amber)' }}>Garde: {l.gardeHours}h → {l.gardeFacturable}h fact. = {fmtMoney(l.gardeAmt)}</span>}
                    {l.rappelAmt > 0 && <span style={{ color: 'var(--red)' }}>Rappel: {l.rappelHours}h = {fmtMoney(l.rappelAmt)}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Frais additionnels */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>Frais additionnels</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm" onClick={() => addFrais('deplacement')}>🚗 Déplacement</button>
                <button className="btn btn-outline btn-sm" onClick={() => addFrais('kilometrage')}>📍 Km</button>
                <button className="btn btn-outline btn-sm" onClick={() => addFrais('autre')}>📋 Autre</button>
              </div>
            </div>
            {(createModal.frais || []).map((f, i) => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                background: i % 2 ? 'var(--surface)' : 'var(--surface2)',
                borderRadius: 'var(--r)', marginBottom: 4,
              }}>
                {f.type === 'deplacement' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)', whiteSpace: 'nowrap' }}>🚗 Déplacement</span>
                    <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12, width: 80 }}
                      placeholder="Heures" value={f.heures || ''} min={0} max={8} step={0.5}
                      onChange={e => updateFrais(f.id, 'heures', e.target.value)} />
                    <span style={{ fontSize: 10, color: 'var(--text3)' }}>h (max 8h)</span>
                    <span style={{ fontSize: 10, color: 'var(--text3)' }}>×</span>
                    <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12, width: 80 }}
                      placeholder="Taux" value={f.taux || ''} min={0} step={0.01}
                      onChange={e => updateFrais(f.id, 'taux', e.target.value)} />
                    <span style={{ fontSize: 10, color: 'var(--text3)' }}>$/h</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)' }}>{fmtMoney((f.heures || 0) * (f.taux || 0))}</span>
                  </div>
                )}
                {f.type === 'kilometrage' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--teal)', whiteSpace: 'nowrap' }}>📍 Km</span>
                    <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12, width: 100 }}
                      placeholder="Km" value={f.km || ''} min={0} step={0.1}
                      onChange={e => updateFrais(f.id, 'km', e.target.value)} />
                    <span style={{ fontSize: 10, color: 'var(--text3)' }}>× {RATE_KM}$/km</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)' }}>{fmtMoney((f.km || 0) * RATE_KM)}</span>
                  </div>
                )}
                {f.type === 'autre' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--purple)', whiteSpace: 'nowrap' }}>📋</span>
                    <input className="input" style={{ padding: '5px 8px', fontSize: 12, flex: 1 }}
                      placeholder="Description" value={f.description || ''}
                      onChange={e => updateFrais(f.id, 'description', e.target.value)} />
                    <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12, width: 120 }}
                      placeholder="$" value={f.montant || ''} min={0} step={0.01}
                      onChange={e => updateFrais(f.id, 'montant', e.target.value)} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)' }}>{fmtMoney(f.montant || 0)}</span>
                  </div>
                )}
                <button onClick={() => removeFrais(f.id)} style={{ background: 'none', color: 'var(--red)', fontSize: 16, cursor: 'pointer', border: 'none' }}>×</button>
              </div>
            ))}
            {(!createModal.frais || createModal.frais.length === 0) && (
              <div style={{ padding: 10, textAlign: 'center', color: 'var(--text3)', fontSize: 12, fontStyle: 'italic' }}>Aucun frais additionnel</div>
            )}
          </div>

          {/* Tax toggle */}
          <div style={{ background: 'var(--amber-l)', padding: '12px 14px', borderRadius: 'var(--r)', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--amber)' }}>
              <input type="checkbox" checked={createModal.include_tax}
                onChange={e => setCreateModal(m => ({ ...m, include_tax: e.target.checked }))}
                style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
              Appliquer TPS 5% + TVQ 9.975%
            </label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Décochez pour les clients exemptés (Conseil Cri, Inuulitsivik)</div>
          </div>

          {/* Notes */}
          <div className="field">
            <label>Notes</label>
            <textarea className="input" rows={2} value={createModal.notes}
              onChange={e => setCreateModal(m => ({ ...m, notes: e.target.value }))} style={{ resize: 'vertical' }} />
          </div>

          {/* Totals */}
          <div style={{ marginTop: 12, padding: 14, background: 'var(--brand-xl)', borderRadius: 'var(--r)', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>Services</span><span style={{ fontWeight: 600 }}>{fmtMoney(modalTotals.stS)}</span></div>
            {modalTotals.stG > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: 'var(--amber)' }}><span>Garde (8h=1h × {fmtMoney(GARDE_RATE)})</span><span>{fmtMoney(modalTotals.stG)}</span></div>}
            {modalTotals.stR > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: 'var(--red)' }}><span>Rappel</span><span>{fmtMoney(modalTotals.stR)}</span></div>}
            {modalTotals.totalFrais > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: 'var(--green)' }}><span>Frais additionnels</span><span>{fmtMoney(modalTotals.totalFrais)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 500 }}>Sous-total</span><span style={{ fontWeight: 500 }}>{fmtMoney(modalTotals.sub)}</span>
            </div>
            {createModal.include_tax && <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>TPS 5%</span><span>{fmtMoney(modalTotals.tps)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>TVQ 9.975%</span><span>{fmtMoney(modalTotals.tvq)}</span></div>
            </>}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '2px solid var(--brand)', fontSize: 16, fontWeight: 800, color: 'var(--brand-d)' }}>
              <span>TOTAL</span><span>{fmtMoney(modalTotals.tot)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setCreateModal(null)}>Annuler</button>
            <button className="btn btn-amber" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => saveInvoice('draft')}>Brouillon</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => saveInvoice('sent')}>Confirmer</button>
          </div>
        </Modal>
      )}
    </>
  );
}


// ══════════════════════════════════════════
// INVOICE CARD
// ══════════════════════════════════════════
function InvoiceCard({ inv, clients, onPreview, onEdit, onMarkPaid, onSendReminder }) {
  const overdue = isOverdue(inv);
  const cl = clients.find(c => c.id === inv.client_id);

  return (
    <div className="card" style={{ marginBottom: 10, border: overdue ? '2px solid #fca5a5' : undefined }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--brand-d)' }}>{inv.number}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Soins Expert Plus — {inv.date}</div>
          {inv.period_start && <div style={{ fontSize: 11, color: 'var(--brand)', marginTop: 2 }}>Période: {inv.period_start} au {inv.period_end}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--brand)' }}>{fmtMoney(inv.total)}</div>
          <Badge status={overdue ? 'overdue' : inv.status} />
        </div>
      </div>

      {/* Overdue info */}
      {overdue && (
        <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginTop: 4 }}>
          <AlertTriangle size={12} style={{ verticalAlign: 'text-bottom' }} /> En retard de {daysOverdue(inv)} jour(s)
        </div>
      )}

      {/* Client block */}
      {(inv.client_name || cl) && (
        <div style={{ marginTop: 8, padding: 10, background: 'var(--teal-l)', borderRadius: 'var(--r)', fontSize: 11 }}>
          <div style={{ fontWeight: 600, color: 'var(--teal)' }}>FACTURÉ À: {inv.client_name || cl?.name}</div>
          {(inv.client_address || cl?.address) && <div style={{ color: 'var(--text2)' }}>📍 {inv.client_address || cl?.address}</div>}
          {(inv.client_email || cl?.email) && <div style={{ color: 'var(--text2)' }}>📧 {inv.client_email || cl?.email}</div>}
        </div>
      )}

      {/* Totals breakdown */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span>Services ({(inv.lines || []).length} ligne(s))</span><span>{fmtMoney(inv.subtotal_services)}</span>
        </div>
        {inv.subtotal_garde > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: 'var(--amber)' }}><span>Garde (8h=1h × $86.23)</span><span>{fmtMoney(inv.subtotal_garde)}</span></div>}
        {inv.subtotal_rappel > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: 'var(--red)' }}><span>Rappel</span><span>{fmtMoney(inv.subtotal_rappel)}</span></div>}
        {inv.subtotal_frais > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: 'var(--green)' }}><span>Frais additionnels</span><span>{fmtMoney(inv.subtotal_frais)}</span></div>}
        {inv.include_tax !== false ? <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>TPS 5%</span><span>{fmtMoney(inv.tps)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TVQ 9.975%</span><span>{fmtMoney(inv.tvq)}</span></div>
        </> : <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 500 }}>Client exempté — TPS/TVQ non appliquées</div>}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={onPreview}><Eye size={14} /> Aperçu</button>
        {inv.status !== 'paid' && <button className="btn btn-outline btn-sm" style={{ color: 'var(--amber)' }} onClick={onEdit}><Edit3 size={14} /> Modifier</button>}
        {overdue && <button className="btn btn-danger btn-sm" onClick={onSendReminder}><Send size={14} /> Rappel</button>}
        {(inv.status === 'sent' || inv.status === 'draft' || overdue) && inv.status !== 'paid' && (
          <button className="btn btn-success btn-sm" onClick={onMarkPaid}><Check size={14} /> Payée</button>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════
// INVOICE PREVIEW
// ══════════════════════════════════════════
function InvoicePreview({ inv }) {
  const lines = inv.lines || [];
  return (
    <div id="invoice-preview" style={{ background: 'white', color: '#111', padding: 40, borderRadius: 12, fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 30, paddingBottom: 20, borderBottom: '3px solid #2A7B88' }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#2A7B88' }}>FACTURE</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1B5E68', marginTop: 4 }}>{inv.number}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Date : {inv.date}</div>
          {inv.period_start && <div style={{ fontSize: 12, color: '#6b7280' }}>Période : {inv.period_start} au {inv.period_end}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#2A7B88' }}>Soins Expert Plus</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>9437-7827 Québec Inc.</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>TPS: 714564891RT0001</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>TVQ: 1225765936TQ0001</div>
        </div>
      </div>

      {/* Client */}
      {inv.client_name && (
        <div style={{ background: '#F0F9FA', padding: '16px 20px', borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #2A7B88' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#2A7B88', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>FACTURÉ À</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1B5E68' }}>{inv.client_name}</div>
          {inv.client_address && <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{inv.client_address}</div>}
          {inv.client_email && <div style={{ fontSize: 12, color: '#4b5563' }}>{inv.client_email}</div>}
        </div>
      )}

      {/* Lines table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 11 }}>
        <thead>
          <tr style={{ background: '#2A7B88', color: 'white', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>
            <th style={{ padding: '10px 6px', textAlign: 'left' }}>Date</th>
            <th style={{ padding: '10px 6px', textAlign: 'left' }}>Employé</th>
            <th style={{ padding: '10px 6px', textAlign: 'right' }}>Heures</th>
            <th style={{ padding: '10px 6px', textAlign: 'right' }}>Taux</th>
            <th style={{ padding: '10px 6px', textAlign: 'right' }}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '8px 6px' }}>{l.date || ''}</td>
              <td style={{ padding: '8px 6px' }}>{l.employee || l.description || ''}</td>
              <td style={{ padding: '8px 6px', textAlign: 'right' }}>{l.hoursWorked || l.hours_worked || 0}h</td>
              <td style={{ padding: '8px 6px', textAlign: 'right' }}>{fmtMoney(l.rate || 0)}</td>
              <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.serviceAmt || l.lineTotal || l.amount || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 300, background: '#f9fafb', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}><span>Sous-total</span><span>{fmtMoney(inv.subtotal)}</span></div>
          {inv.include_tax !== false ? <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#6b7280' }}><span>TPS (5%)</span><span>{fmtMoney(inv.tps)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#6b7280' }}><span>TVQ (9.975%)</span><span>{fmtMoney(inv.tvq)}</span></div>
          </> : <div style={{ fontSize: 11, color: '#d97706', fontWeight: 500, marginBottom: 8 }}>Client exempté — TPS/TVQ non appliquées</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '3px solid #2A7B88', fontSize: 20, fontWeight: 800, color: '#2A7B88' }}>
            <span>TOTAL</span><span>{fmtMoney(inv.total)}</span>
          </div>
        </div>
      </div>

      {inv.notes && (
        <div style={{ marginTop: 20, padding: '12px 16px', background: '#fffbeb', borderRadius: 8, fontSize: 12, color: '#92400e', borderLeft: '4px solid #f59e0b' }}>
          <strong>Notes :</strong> {inv.notes}
        </div>
      )}

      <div style={{ marginTop: 30, paddingTop: 16, borderTop: '1px solid #e5e7eb', textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>
        Soins Expert Plus — 9437-7827 Québec Inc. — Merci de votre confiance
      </div>
    </div>
  );
}


// ══════════════════════════════════════════
// CLIENTS LIST (sub-tab)
// ══════════════════════════════════════════
function ClientsList({ clients, invoices, toast, reload }) {
  const [editModal, setEditModal] = useState(null);
  const [addModal, setAddModal] = useState(null);
  const [detailClient, setDetailClient] = useState(null);
  const [detailClient, setDetailClient] = useState(null);

  const clientStats = useMemo(() => clients.map(cl => {
    const clientInv = invoices.filter(inv => inv.client_id === cl.id);
    const totalFacture = clientInv.reduce((s, i) => s + (i.total || 0), 0);
    const totalPaye = clientInv.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
    const solde = totalFacture - totalPaye;
    const nbRetard = clientInv.filter(isOverdue).length;
    return { ...cl, totalFacture, totalPaye, solde, nbRetard, nbInvoices: clientInv.length };
  }), [clients, invoices]);

  const saveClient = async (data) => {
    try {
      if (data.id) await api.updateClient(data.id, data);
      else await api.createClient(data);
      toast?.('Client sauvegardé');
      setEditModal(null); setAddModal(null);
      reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setAddModal({ name: '', address: '', email: '', phone: '', tax_exempt: false })}>
          <Plus size={14} /> Ajouter un client
        </button>
      </div>

      <div className="schedule-grid">
        <table className="client-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--brand-xl)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--brand)', textTransform: 'uppercase' }}>Client</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Email</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Facturé</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Payé</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Solde</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Taxes</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {clientStats.map(cl => (
              <tr key={cl.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ fontWeight: 600 }}>{cl.name}</div>
                  {cl.address && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{cl.address.slice(0, 50)}</div>}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text2)' }}>{cl.email || '—'}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 500 }}>{fmtMoney(cl.totalFacture)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--green)' }}>{fmtMoney(cl.totalPaye)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: cl.solde > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {fmtMoney(cl.solde)}
                  {cl.nbRetard > 0 && <div style={{ fontSize: 9, color: 'var(--red)' }}>{cl.nbRetard} en retard</div>}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  {cl.tax_exempt
                    ? <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600 }}>EXEMPT</span>
                    : <span style={{ fontSize: 10, color: 'var(--text3)' }}>TPS+TVQ</span>}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <button className="btn btn-outline btn-sm" style={{ marginRight: 4 }} onClick={(e) => { e.stopPropagation(); setEditModal(cl); }}>
                    <Edit3 size={12} />
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setDetailClient(cl); }}>
                    <Eye size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Client Detail - Invoices */}
      {detailClient && (
        <Modal title={`Factures — ${detailClient.name}`} onClose={() => setDetailClient(null)} wide>
          {(() => {
            const clientInv = invoices.filter(inv => inv.client_id === detailClient.id);
            if (!clientInv.length) return <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)' }}>Aucune facture pour ce client</div>;
            return clientInv.map(inv => (
              <div key={inv.id} style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{inv.number}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{inv.date} {inv.period_start ? `— Période: ${inv.period_start} au ${inv.period_end}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, color: 'var(--brand)' }}>{fmtMoney(inv.total)}</span>
                  <span className="badge" style={{ background: inv.status === 'paid' ? 'var(--green-l)' : inv.status === 'sent' ? '#CCFBF1' : 'var(--surface2)', color: inv.status === 'paid' ? 'var(--green)' : inv.status === 'sent' ? 'var(--teal)' : 'var(--text2)', fontSize: 10 }}>{inv.status === 'paid' ? 'Payée' : inv.status === 'sent' ? 'Envoyée' : 'Brouillon'}</span>
                  {inv.status !== 'paid' && (
                    <button className="btn btn-success btn-sm" onClick={async () => { try { await api.markPaid(inv.id); toast?.('Facture marquée payée'); reload(); setDetailClient(null); } catch(err) { toast?.('Erreur'); } }}>
                      Payée ✓
                    </button>
                  )}
                </div>
              </div>
            ));
          })()}
        </Modal>
      )}

      {/* Add/Edit Client Modal */}
      {(editModal || addModal) && (
        <Modal title={editModal ? `Modifier — ${editModal.name}` : 'Nouveau client'} onClose={() => { setEditModal(null); setAddModal(null); }}>
          <ClientForm data={editModal || addModal} onSave={saveClient} onCancel={() => { setEditModal(null); setAddModal(null); }} />
        </Modal>
      )}
    </>
  );
}

function ClientForm({ data, onSave, onCancel }) {
  const [form, setForm] = useState(data);
  return (
    <>
      <div className="field"><label>Nom</label>
        <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </div>
      <div className="field"><label>Adresse</label>
        <input className="input" value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label>Email</label>
          <input className="input" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div className="field"><label>Téléphone</label>
          <input className="input" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
        </div>
      </div>
      <div style={{ background: 'var(--amber-l)', padding: '12px 14px', borderRadius: 'var(--r)', marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--amber)' }}>
          <input type="checkbox" checked={form.tax_exempt || false}
            onChange={e => setForm(f => ({ ...f, tax_exempt: e.target.checked }))}
            style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
          Client exempté de TPS/TVQ
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={onCancel}>Annuler</button>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onSave(form)}>Sauvegarder</button>
      </div>
    </>
  );
}
