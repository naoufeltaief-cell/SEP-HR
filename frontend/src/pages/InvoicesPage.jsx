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

    // Group approved FDTs by employee → one invoice per employee
    const byEmployee = {};
    approved.forEach(ts => {
      const emp = employees.find(e => e.id === ts.employee_id);
      if (!emp) return;
      if (!byEmployee[emp.id]) byEmployee[emp.id] = { emp, timesheets: [], shifts: [] };
      byEmployee[emp.id].timesheets.push(ts);
      (ts.shifts || []).forEach(sh => {
        const sched = schedules.find(s => s.id === sh.schedule_id);
        if (!sched) return;
        const serviceAmt = Math.round(sh.hours_worked * (sched.billable_rate || 0) * 100) / 100;
        const gardeFacturable = Math.round((sh.garde_hours || 0) / 8 * 100) / 100;
        const gardeAmt = Math.round(gardeFacturable * GARDE_RATE * 100) / 100;
        const rappelAmt = Math.round((sh.rappel_hours || 0) * (sched.billable_rate || 0) * 100) / 100;
        byEmployee[emp.id].shifts.push({
          employee: emp.name, date: sh.date, location: sched.location || '',
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

    const empGroups = Object.values(byEmployee);
    if (empGroups.length === 1) {
      // Single employee → generate directly
      generateDraftForEmployee(empGroups[0], approved);
    } else {
      // Multiple employees → let user choose: individual or combined
      setDraftChoice({ groups: empGroups, approved });
    }
  };

  const [draftChoice, setDraftChoice] = useState(null);

  const generateDraftForEmployee = (group, approvedList) => {
    const { emp, shifts } = group;
    const dates = shifts.map(s => s.date).sort();
    const periodStart = dates[0];
    const periodEnd = dates[dates.length - 1];
    const num = 'GTI-2026-' + String(invoices.length + 1).padStart(3, '0');

    // Accommodation for this employee
    const accomLines = [];
    accommodations.forEach(a => {
      if (a.employee_id !== emp.id) return;
      const matchingShifts = shifts.filter(sh => sh.date >= (a.start_date || '') && sh.date <= (a.end_date || ''));
      if (matchingShifts.length > 0) {
        const billedDays = matchingShifts.length;
        const cpd = a.cost_per_day || (a.days_worked > 0 ? Math.round(a.total_cost / a.days_worked * 100) / 100 : 0);
        accomLines.push({
          id: Date.now() + Math.random(), employee: emp.name,
          description: 'Hébergement — ' + emp.name,
          hoursWorked: 0, rate: cpd, serviceAmt: Math.round(cpd * billedDays * 100) / 100,
          gardeAmt: 0, rappelAmt: 0, lineTotal: Math.round(cpd * billedDays * 100) / 100,
          date: a.start_date, location: '', start: '', end: '', pause: 0,
          note: 'Héberg. ' + a.start_date + ' au ' + a.end_date + ' — ' + billedDays + 'j × ' + cpd + '$/j',
          _isAccom: true,
        });
      }
    });

    setDraftChoice(null);
    setCreateModal({
      _isDraft: true,
      number: num, date: new Date().toISOString().slice(0, 10),
      period_start: periodStart, period_end: periodEnd,
      client_id: emp.client_id || 0, include_tax: true, notes: 'Ressource: ' + emp.name, status: 'draft',
      lines: [...shifts.map((l, i) => ({ id: i + 1, ...l })), ...accomLines],
      frais: [],
      _approvedIds: (approvedList || []).map(t => t.id),
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
          { id: 'rapports', label: 'Rapports' },
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
              onMarkUnpaid={async () => { try { await api.markUnpaid(inv.id); toast?.('Facture marquée impayée'); reload(); } catch(e) { toast?.('Erreur'); } }}
              onDuplicate={async () => { try { const r = await api.duplicateInvoice(inv.id); toast?.('Facture dupliquée: ' + r.number); reload(); } catch(e) { toast?.('Erreur'); } }}
              onCancel={async () => { if (!confirm('Annuler cette facture?')) return; try { await api.cancelInvoice(inv.id); toast?.('Facture annulée'); reload(); } catch(e) { toast?.('Erreur'); } }}
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

      {subTab === 'rapports' && (
        <ReportsTab invoices={invoices} clients={clients} employees={employees} />
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


      {/* Draft Choice - Individual vs Combined */}
      {draftChoice && (
        <Modal title="Générer les factures" onClose={() => setDraftChoice(null)} wide>
          <div style={{ background: 'var(--brand-xl)', padding: 14, borderRadius: 'var(--r)', marginBottom: 16, fontSize: 13, color: 'var(--brand)' }}>
            <strong>{draftChoice.groups.length} employé(s)</strong> ont des FDT approuvées. La facturation doit être <strong>unique par ressource</strong>.
          </div>
          {draftChoice.groups.map(g => {
            const totalHrs = g.shifts.reduce((s, sh) => s + sh.hoursWorked, 0);
            const totalAmt = g.shifts.reduce((s, sh) => s + sh.lineTotal, 0);
            const clientName = clients.find(c => c.id === g.emp.client_id)?.name || 'Non assigné';
            return (
              <div key={g.emp.id} className="card" style={{ marginBottom: 8, cursor: 'pointer' }}
                onClick={() => generateDraftForEmployee(g, draftChoice.approved)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{g.emp.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{g.emp.position} — {clientName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{g.shifts.length} quarts · {totalHrs.toFixed(1)}h</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--brand)' }}>{fmtMoney(totalAmt)}</div>
                    <div style={{ fontSize: 11, color: 'var(--brand)' }}>Cliquer pour générer →</div>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, textAlign: 'center' }}>
            Cliquez sur un employé pour générer sa facture individuelle
          </div>
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
                    <label style={{ fontSize: 10 }}>{l._isAccom ? 'Jours' : 'Heures'}</label>
                    {l._isAccom ? (
                      <div style={{ padding: '5px 8px', fontSize: 12, fontWeight: 600, color: 'var(--purple)' }}>
                        {l.lineTotal && l.rate ? Math.round(l.lineTotal / l.rate) : 0} jour(s)
                      </div>
                    ) : (
                      <input className="input" type="number" style={{ padding: '5px 8px', fontSize: 12 }}
                        value={l.hoursWorked || l.hours || 0} min={0} step={0.25}
                        onChange={e => updateLine(l.id, 'hours', parseFloat(e.target.value) || 0)} />
                    )}
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ fontSize: 10 }}>{l._isAccom ? 'Coût/jour' : 'Taux ($/h)'}</label>
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
                {/* Show date, start-end, location, note for draft lines */}
                {(l.date || l.start || l.location || l.note) && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {l.date && <span>{l.date}</span>}
                    {l.start && l.end && <span>{l.start}–{l.end}</span>}
                    {l.location && <span>{l.location.slice(0, 25)}</span>}
                    {l.note && <span style={{ color: 'var(--amber)', fontStyle: 'italic' }}>{l.note}</span>}
                    {l._isAccom && <span style={{ color: 'var(--purple)', fontWeight: 600 }}>🏨 Hébergement</span>}
                  </div>
                )}
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
function InvoiceCard({ inv, clients, onPreview, onEdit, onMarkPaid, onMarkUnpaid, onDuplicate, onCancel, onSendReminder }) {
  const overdue = isOverdue(inv);
  const cancelled = inv.status === 'cancelled';
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
          <Badge status={cancelled ? 'cancelled' : overdue ? 'overdue' : inv.status} />
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
        {inv.status !== 'paid' && inv.status !== 'cancelled' && <button className="btn btn-outline btn-sm" style={{ color: 'var(--amber)' }} onClick={onEdit}><Edit3 size={14} /> Modifier</button>}
        {overdue && <button className="btn btn-danger btn-sm" onClick={onSendReminder}><Send size={14} /> Rappel</button>}
        {(inv.status === 'sent' || inv.status === 'draft' || overdue) && inv.status !== 'paid' && inv.status !== 'cancelled' && (
          <button className="btn btn-success btn-sm" onClick={onMarkPaid}><Check size={14} /> Payée</button>
        )}
        {inv.status === 'paid' && (
          <button className="btn btn-outline btn-sm" onClick={onMarkUnpaid}>Marquer impayée</button>
        )}
        <button className="btn btn-outline btn-sm" onClick={onDuplicate}><Plus size={12} /> Dupliquer</button>
        {inv.status !== 'cancelled' && (
          <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={onCancel}>Annuler</button>
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
  const frais = inv.frais_additionnels || [];
  const LOGO = "data:image/jpeg;base64,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";
  
  // Separate service lines from accommodation lines
  const serviceLines = lines.filter(l => !l._isAccom);
  const accomLines = lines.filter(l => l._isAccom);
  
  const subtotalServices = serviceLines.reduce((s, l) => s + (l.serviceAmt || l.lineTotal || l.amount || 0), 0);
  const subtotalGarde = serviceLines.reduce((s, l) => s + (l.gardeAmt || 0), 0);
  const subtotalRappel = serviceLines.reduce((s, l) => s + (l.rappelAmt || 0), 0);
  const subtotalAccom = accomLines.reduce((s, l) => s + (l.lineTotal || l.serviceAmt || 0), 0);
  const subtotalFrais = frais.reduce((s, f) => {
    if (f.type === 'kilometrage') return s + (f.km || 0) * 0.525;
    if (f.type === 'deplacement') return s + (f.heures || 0) * (f.taux || 0);
    return s + (f.montant || 0);
  }, 0);

  return (
    <div id="invoice-preview" style={{ background: 'white', color: '#111', padding: '40px 36px', borderRadius: 12, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 900, margin: '0 auto' }}>
      {/* ── HEADER WITH LOGO ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, paddingBottom: 20, borderBottom: '3px solid #2A7B88' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={LOGO} alt="SEP" style={{ width: 80, height: 80, borderRadius: 12, objectFit: 'cover' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2A7B88', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Soins Expert Plus</div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>9437-7827 Québec Inc.</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>Gestion Taief Inc.</div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>TPS: 714564891RT0001</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>TVQ: 1225765936TQ0001</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#2A7B88', letterSpacing: -1 }}>FACTURE</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1B5E68', marginTop: 4 }}>{inv.number}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Date : {inv.date}</div>
          {inv.period_start && <div style={{ fontSize: 12, color: '#6b7280' }}>Période : {inv.period_start} au {inv.period_end}</div>}
        </div>
      </div>

      {/* ── CLIENT ── */}
      {inv.client_name && (
        <div style={{ background: '#F0F9FA', padding: '16px 20px', borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #2A7B88' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#2A7B88', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>FACTURÉ À</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1B5E68' }}>{inv.client_name}</div>
          {inv.client_address && <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{inv.client_address}</div>}
          {inv.client_email && <div style={{ fontSize: 12, color: '#4b5563' }}>{inv.client_email}</div>}
          {inv.client_phone && <div style={{ fontSize: 12, color: '#4b5563' }}>{inv.client_phone}</div>}
        </div>
      )}

      {/* ── SERVICE LINES TABLE ── */}
      {serviceLines.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1B5E68', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Services rendus</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#2A7B88', color: 'white', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                <th style={{ padding: '8px 6px', textAlign: 'left' }}>Date</th>
                <th style={{ padding: '8px 6px', textAlign: 'left' }}>Employé</th>
                <th style={{ padding: '8px 6px', textAlign: 'left' }}>Lieu</th>
                <th style={{ padding: '8px 6px', textAlign: 'center' }}>Début</th>
                <th style={{ padding: '8px 6px', textAlign: 'center' }}>Fin</th>
                <th style={{ padding: '8px 6px', textAlign: 'center' }}>Pause</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Heures</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Taux</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Services</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Garde</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Rappel</th>
              </tr>
            </thead>
            <tbody>
              {serviceLines.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e5e7eb', background: i % 2 ? '#f9fafb' : 'white' }}>
                  <td style={{ padding: '6px', fontSize: 10 }}>{l.date || ''}</td>
                  <td style={{ padding: '6px', fontSize: 10 }}>{l.employee || l.description || ''}</td>
                  <td style={{ padding: '6px', fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(l.location || '').slice(0, 25)}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'center' }}>{l.start || ''}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'center' }}>{l.end || ''}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'center', color: '#9ca3af' }}>{l.pause ? l.pause + 'h' : '—'}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right' }}>{l.hoursWorked || l.hours_worked || 0}h</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right' }}>{fmtMoney(l.rate || 0)}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.serviceAmt || l.lineTotal || l.amount || 0)}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right', color: l.gardeAmt ? '#d97706' : '#d1d5db' }}>{l.gardeAmt ? fmtMoney(l.gardeAmt) : '—'}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right', color: l.rappelAmt ? '#dc2626' : '#d1d5db' }}>{l.rappelAmt ? fmtMoney(l.rappelAmt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── ACCOMMODATION LINES ── */}
      {accomLines.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Hébergement</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#7c3aed', color: 'white', fontSize: 9, fontWeight: 600, textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 6px', textAlign: 'left' }}>Employé</th>
                <th style={{ padding: '8px 6px', textAlign: 'left' }}>Période</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Jours facturés</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Coût/jour</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {accomLines.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #ede9fe', background: '#faf5ff' }}>
                  <td style={{ padding: '6px', fontSize: 10, color: '#7c3aed' }}>{l.employee}</td>
                  <td style={{ padding: '6px', fontSize: 10, color: '#6b7280' }}>{l.note || ''}</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right', fontWeight: 600 }}>{l.rate > 0 && l.lineTotal > 0 ? Math.round(l.lineTotal / l.rate) : '—'} j</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right' }}>{fmtMoney(l.rate || 0)}/j</td>
                  <td style={{ padding: '6px', fontSize: 10, textAlign: 'right', fontWeight: 600, color: '#7c3aed' }}>{fmtMoney(l.lineTotal || l.serviceAmt || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── FRAIS ADDITIONNELS ── */}
      {frais.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Frais additionnels</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 11 }}>
            <tbody>
              {frais.map((f, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #d1fae5', background: '#f0fdf4' }}>
                  <td style={{ padding: '8px 6px', fontSize: 10 }}>
                    {f.type === 'deplacement' && '🚗 Frais de déplacement — ' + (f.heures || 0) + 'h × ' + fmtMoney(f.taux || 0) + '/h'}
                    {f.type === 'kilometrage' && '📍 Kilométrage — ' + (f.km || 0) + ' km × 0,525 $/km'}
                    {f.type === 'autre' && '📋 ' + (f.description || 'Frais additionnel')}
                  </td>
                  <td style={{ padding: '8px 6px', fontSize: 10, textAlign: 'right', fontWeight: 600, color: '#059669' }}>
                    {f.type === 'kilometrage' ? fmtMoney((f.km || 0) * 0.525) : f.type === 'deplacement' ? fmtMoney((f.heures || 0) * (f.taux || 0)) : fmtMoney(f.montant || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── TOTALS ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 340, background: '#f9fafb', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}><span>Services</span><span>{fmtMoney(subtotalServices)}</span></div>
          {subtotalGarde > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#d97706' }}><span>Garde (8h = 1h fact.)</span><span>{fmtMoney(subtotalGarde)}</span></div>}
          {subtotalRappel > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#dc2626' }}><span>Rappel</span><span>{fmtMoney(subtotalRappel)}</span></div>}
          {subtotalAccom > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#7c3aed' }}><span>Hébergement</span><span>{fmtMoney(subtotalAccom)}</span></div>}
          {subtotalFrais > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#059669' }}><span>Frais additionnels</span><span>{fmtMoney(subtotalFrais)}</span></div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0', paddingTop: 8, borderTop: '1px solid #d1d5db', fontSize: 13, fontWeight: 600 }}><span>Sous-total</span><span>{fmtMoney(inv.subtotal || (subtotalServices + subtotalGarde + subtotalRappel + subtotalAccom + subtotalFrais))}</span></div>
          {inv.include_tax !== false ? <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#6b7280' }}><span>TPS (5%)</span><span>{fmtMoney(inv.tps)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#6b7280' }}><span>TVQ (9.975%)</span><span>{fmtMoney(inv.tvq)}</span></div>
          </> : <div style={{ fontSize: 11, color: '#d97706', fontWeight: 500, marginBottom: 8 }}>Client exempté — TPS/TVQ non appliquées</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '3px solid #2A7B88', fontSize: 22, fontWeight: 800, color: '#2A7B88' }}>
            <span>TOTAL</span><span>{fmtMoney(inv.total)}</span>
          </div>
        </div>
      </div>

      {inv.notes && (
        <div style={{ marginTop: 20, padding: '12px 16px', background: '#fffbeb', borderRadius: 8, fontSize: 12, color: '#92400e', borderLeft: '4px solid #f59e0b' }}>
          <strong>Notes :</strong> {inv.notes}
        </div>
      )}

      <div style={{ marginTop: 30, paddingTop: 16, borderTop: '1px solid #e5e7eb', textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#9ca3af' }}>Soins Expert Plus — 9437-7827 Québec Inc. — Gestion Taief Inc.</div>
        <div style={{ fontSize: 10, color: '#9ca3af' }}>rh@soins-expert-plus.com — Merci de votre confiance</div>
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

// ══════════════════════════════════════════
// REPORTS TAB (mini QuickBooks)
// ══════════════════════════════════════════
function ReportsTab({ invoices, clients, employees }) {
  const [reportType, setReportType] = useState('summary');

  // Calculations
  const totalRevenue = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
  const totalUnpaid = totalRevenue - totalPaid;
  const totalOverdue = invoices.filter(i => isOverdue(i)).reduce((s, i) => s + (i.total || 0), 0);
  const overdueCount = invoices.filter(i => isOverdue(i)).length;

  // Monthly revenue
  const monthlyData = {};
  invoices.forEach(inv => {
    const month = (inv.date || '').slice(0, 7);
    if (!month) return;
    if (!monthlyData[month]) monthlyData[month] = { revenue: 0, paid: 0, count: 0 };
    monthlyData[month].revenue += inv.total || 0;
    if (inv.status === 'paid') monthlyData[month].paid += inv.total || 0;
    monthlyData[month].count++;
  });
  const months = Object.keys(monthlyData).sort();

  // Client breakdown
  const clientData = {};
  invoices.forEach(inv => {
    const cName = inv.client_name || clients.find(c => c.id === inv.client_id)?.name || 'Non assigné';
    if (!clientData[cName]) clientData[cName] = { total: 0, paid: 0, overdue: 0, count: 0 };
    clientData[cName].total += inv.total || 0;
    if (inv.status === 'paid') clientData[cName].paid += inv.total || 0;
    if (isOverdue(inv)) clientData[cName].overdue += inv.total || 0;
    clientData[cName].count++;
  });

  // Aging report (0-30, 31-60, 61-90, 90+)
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  invoices.filter(i => i.status !== 'paid').forEach(inv => {
    const days = Math.floor((new Date() - new Date(inv.date)) / (1000 * 60 * 60 * 24));
    const amt = inv.total || 0;
    if (days <= 30) aging.current += amt;
    else if (days <= 60) aging.d30 += amt;
    else if (days <= 90) aging.d60 += amt;
    else aging.d90plus += amt;
  });

  return (
    <>
      {/* Report Type Selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'summary', label: '📊 Résumé financier' },
          { id: 'aging', label: '⏰ Comptes en souffrance' },
          { id: 'clients', label: '🏥 Par client' },
          { id: 'monthly', label: '📅 Mensuel' },
          { id: 'invoicelist', label: '📋 Liste des factures' },
        ].map(r => (
          <button key={r.id} className={`btn ${reportType === r.id ? 'btn-primary' : 'btn-outline'} btn-sm`}
            onClick={() => setReportType(r.id)}>{r.label}</button>
        ))}
      </div>

      {/* ── SUMMARY ── */}
      {reportType === 'summary' && (
        <div>
          <div className="stats-row" style={{ marginBottom: 20 }}>
            <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '16px 20px' }}>
              <div className="label" style={{ color: 'var(--brand)' }}>Revenus totaux</div>
              <div className="value" style={{ color: 'var(--brand)', fontSize: 22 }}>{fmtMoney(totalRevenue)}</div>
            </div>
            <div className="stat-card" style={{ background: 'var(--green-l)', padding: '16px 20px' }}>
              <div className="label" style={{ color: 'var(--green)' }}>Encaissé</div>
              <div className="value" style={{ color: 'var(--green)', fontSize: 22 }}>{fmtMoney(totalPaid)}</div>
            </div>
            <div className="stat-card" style={{ background: 'var(--amber-l)', padding: '16px 20px' }}>
              <div className="label" style={{ color: 'var(--amber)' }}>À recevoir</div>
              <div className="value" style={{ color: 'var(--amber)', fontSize: 22 }}>{fmtMoney(totalUnpaid)}</div>
            </div>
            <div className="stat-card" style={{ background: 'var(--red-l)', padding: '16px 20px' }}>
              <div className="label" style={{ color: 'var(--red)' }}>En souffrance (30j+)</div>
              <div className="value" style={{ color: 'var(--red)', fontSize: 22 }}>{fmtMoney(totalOverdue)}</div>
              <div style={{ fontSize: 10, color: 'var(--red)' }}>{overdueCount} facture(s)</div>
            </div>
          </div>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--brand-d)' }}>Taux de recouvrement</div>
            <div style={{ height: 24, background: 'var(--surface2)', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: totalRevenue > 0 ? (totalPaid / totalRevenue * 100) + '%' : '0%', background: 'var(--green)', borderRadius: 12, transition: 'width 0.5s' }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              {totalRevenue > 0 ? Math.round(totalPaid / totalRevenue * 100) : 0}% des revenus encaissés — {invoices.filter(i => i.status === 'paid').length}/{invoices.length} factures payées
            </div>
          </div>
        </div>
      )}

      {/* ── AGING REPORT ── */}
      {reportType === 'aging' && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--brand-d)' }}>Rapport de vieillissement des comptes</div>
            {[
              { label: 'Courant (0-30 jours)', amount: aging.current, color: 'var(--green)', bg: 'var(--green-l)' },
              { label: '31-60 jours', amount: aging.d30, color: 'var(--amber)', bg: 'var(--amber-l)' },
              { label: '61-90 jours', amount: aging.d60, color: '#ea580c', bg: '#fff7ed' },
              { label: '90+ jours', amount: aging.d90plus, color: 'var(--red)', bg: 'var(--red-l)' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: row.color }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{row.label}</span>
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: row.color }}>{fmtMoney(row.amount)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', fontSize: 15, fontWeight: 700, color: 'var(--brand-d)' }}>
              <span>Total impayé</span><span>{fmtMoney(totalUnpaid)}</span>
            </div>
          </div>

          {/* Overdue invoice list */}
          {overdueCount > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--red)' }}>Factures en souffrance ({overdueCount})</div>
              {invoices.filter(isOverdue).map(inv => (
                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{inv.number}</span>
                    <span style={{ color: 'var(--text3)', marginLeft: 8 }}>{inv.client_name || '—'}</span>
                    <span style={{ color: 'var(--text3)', marginLeft: 8 }}>{inv.date}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: 'var(--red)', fontSize: 11 }}>{daysOverdue(inv)}j retard</span>
                    <span style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtMoney(inv.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CLIENT BREAKDOWN ── */}
      {reportType === 'clients' && (
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--brand-d)' }}>Revenus par client</div>
          {Object.entries(clientData).sort((a, b) => b[1].total - a[1].total).map(([name, data]) => (
            <div key={name} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{data.count} facture(s)</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brand)' }}>{fmtMoney(data.total)}</div>
                  {data.overdue > 0 && <div style={{ fontSize: 11, color: 'var(--red)' }}>{fmtMoney(data.overdue)} en retard</div>}
                </div>
              </div>
              <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3 }}>
                <div style={{ height: '100%', borderRadius: 3, display: 'flex' }}>
                  <div style={{ height: '100%', width: totalRevenue > 0 ? (data.paid / totalRevenue * 100) + '%' : '0', background: 'var(--green)', borderRadius: '3px 0 0 3px' }} />
                  <div style={{ height: '100%', width: totalRevenue > 0 ? ((data.total - data.paid) / totalRevenue * 100) + '%' : '0', background: 'var(--amber)', borderRadius: '0 3px 3px 0' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── MONTHLY ── */}
      {reportType === 'monthly' && (
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--brand-d)' }}>Revenus mensuels</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--brand-xl)', fontWeight: 600, color: 'var(--brand)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Mois</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Factures</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Revenus</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Encaissé</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const d = monthlyData[m];
                return (
                  <tr key={m} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{m}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{d.count}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(d.revenue)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--green)' }}>{fmtMoney(d.paid)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: d.revenue - d.paid > 0 ? 'var(--amber)' : 'var(--green)', fontWeight: 600 }}>{fmtMoney(d.revenue - d.paid)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── INVOICE LIST ── */}
      {reportType === 'invoicelist' && (
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--brand-d)' }}>Liste complète des factures</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--brand-xl)', fontWeight: 600, color: 'var(--brand)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>N°</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Date</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Client</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Sous-total</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Taxes</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{inv.number}</td>
                  <td style={{ padding: '8px 10px' }}>{inv.date}</td>
                  <td style={{ padding: '8px 10px' }}>{inv.client_name || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtMoney(inv.subtotal)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text3)' }}>{fmtMoney((inv.tps || 0) + (inv.tvq || 0))}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--brand)' }}>{fmtMoney(inv.total)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: inv.status === 'paid' ? 'var(--green-l)' : isOverdue(inv) ? 'var(--red-l)' : inv.status === 'sent' ? 'var(--teal-l)' : 'var(--surface2)', color: inv.status === 'paid' ? 'var(--green)' : isOverdue(inv) ? 'var(--red)' : inv.status === 'sent' ? 'var(--teal)' : 'var(--text2)' }}>
                      {inv.status === 'paid' ? 'Payée' : isOverdue(inv) ? 'En retard' : inv.status === 'sent' ? 'Envoyée' : 'Brouillon'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
