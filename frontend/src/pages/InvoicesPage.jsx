import { useState, useEffect } from 'react';
import api from '../utils/api';
import { fmtMoney, RATE_KM, GARDE_RATE } from '../utils/helpers';
import { Badge, Modal } from '../components/UI';
import { Plus, Eye, Edit3, Check, Send } from 'lucide-react';

export default function InvoicesPage({ toast }) {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [preview, setPreview] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [createModal, setCreateModal] = useState(null);

  const reload = async () => {
    const [inv, cl, emp] = await Promise.all([api.getInvoices(), api.getClients(), api.getEmployees()]);
    setInvoices(inv); setClients(cl); setEmployees(emp);
  };
  useEffect(() => { reload(); }, []);

  const markPaid = async (id) => {
    await api.markPaid(id);
    toast?.('Facture marquée payée');
    reload();
  };

  // ── Create invoice modal ──
  const openCreate = () => {
    const num = `GTI-2026-${String(invoices.length + 1).padStart(3, '0')}`;
    setCreateModal({
      number: num, date: new Date().toISOString().slice(0, 10),
      period_start: '', period_end: '', client_id: 0,
      include_tax: true, notes: '', status: 'draft',
      lines: [{ id: 1, employee: '', hours: 0, rate: 0, amount: 0, description: '', start: '', end: '', pause: 0, note: '' }],
    });
  };

  const addLine = () => {
    setCreateModal(m => ({
      ...m, lines: [...m.lines, { id: Date.now(), employee: '', hours: 0, rate: 0, amount: 0, description: '', start: '', end: '', pause: 0, note: '' }]
    }));
  };

  const removeLine = (id) => {
    setCreateModal(m => ({ ...m, lines: m.lines.filter(l => l.id !== id) }));
  };

  const updateLine = (id, key, val) => {
    setCreateModal(m => {
      const lines = m.lines.map(l => {
        if (l.id !== id) return l;
        const updated = { ...l, [key]: val };
        if (key === 'hours' || key === 'rate') {
          updated.amount = Math.round((updated.hours || 0) * (updated.rate || 0) * 100) / 100;
        }
        return updated;
      });
      return { ...m, lines };
    });
  };

  const saveInvoice = async (status) => {
    const m = createModal;
    const validLines = m.lines.filter(l => l.amount > 0);
    if (!m.number) return toast?.('Numéro requis');
    if (!validLines.length) return toast?.('Ajoutez au moins une ligne');

    const apiLines = validLines.map(l => ({
      employee: l.employee, hoursWorked: l.hours, rate: l.rate,
      serviceAmt: l.amount, gardeAmt: 0, rappelAmt: 0, lineTotal: l.amount,
      description: l.description, start: l.start, end: l.end, pause: l.pause, note: l.note,
    }));

    try {
      await api.createInvoice({
        number: m.number, date: m.date, period_start: m.period_start || null,
        period_end: m.period_end || null, client_id: m.client_id || null,
        include_tax: m.include_tax, status, notes: m.notes, lines: apiLines,
      });
      toast?.(`Facture ${m.number} ${status === 'draft' ? 'sauvegardée' : 'confirmée'}`);
      setCreateModal(null); reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  // ── Edit invoice ──
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
    });
  };

  const saveEdit = async (status) => {
    const m = createModal;
    const validLines = m.lines.filter(l => l.amount > 0);
    const apiLines = validLines.map(l => ({
      employee: l.employee, hoursWorked: l.hours, rate: l.rate,
      serviceAmt: l.amount, gardeAmt: 0, rappelAmt: 0, lineTotal: l.amount,
      description: l.description, start: l.start, end: l.end, pause: l.pause, note: l.note,
    }));
    try {
      await api.updateInvoice(m._editId, {
        number: m.number, date: m.date, period_start: m.period_start || null,
        period_end: m.period_end || null, client_id: m.client_id || null,
        include_tax: m.include_tax, status, notes: m.notes, lines: apiLines,
      });
      toast?.(`Facture ${m.number} mise à jour`);
      setCreateModal(null); reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  // ── Preview ──
  const renderPreview = (inv) => {
    const lines = inv.lines || [];
    return (
      <Modal title="Aperçu — Facture client" onClose={() => setPreview(null)} wide>
        <div id="invoice-preview" style={{ background: 'white', color: '#111', padding: 40, borderRadius: 12, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 30, paddingBottom: 20, borderBottom: '3px solid #1d4ed8' }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#1d4ed8' }}>FACTURE</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1e3a5f', marginTop: 4 }}>{inv.number}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Date : {inv.date}</div>
              {inv.period_start && <div style={{ fontSize: 12, color: '#6b7280' }}>Période : {inv.period_start} au {inv.period_end}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1d4ed8' }}>Soins Expert Plus</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>9437-7827 Québec Inc.</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>TPS: 714564891RT0001</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>TVQ: 1225765936TQ0001</div>
            </div>
          </div>

          {/* Client */}
          {inv.client_name && (
            <div style={{ background: '#f0f9ff', padding: '16px 20px', borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #1d4ed8' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>FACTURÉ À</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e3a5f' }}>{inv.client_name}</div>
              {inv.client_address && <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{inv.client_address}</div>}
              {inv.client_email && <div style={{ fontSize: 12, color: '#4b5563' }}>{inv.client_email}</div>}
            </div>
          )}

          {/* Lines table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
            <thead>
              <tr style={{ background: '#1d4ed8', color: 'white', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 6px', textAlign: 'left' }}>Employé</th>
                <th style={{ padding: '10px 6px', textAlign: 'right' }}>Heures</th>
                <th style={{ padding: '10px 6px', textAlign: 'right' }}>Taux</th>
                <th style={{ padding: '10px 6px', textAlign: 'right' }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={{ fontSize: 12, borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 6px' }}>{l.employee || l.description || '—'}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right' }}>{l.hoursWorked || l.hours_worked || 0}h</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right' }}>{fmtMoney(l.rate || 0)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.serviceAmt || l.lineTotal || l.amount || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 320, background: '#f9fafb', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}><span>Sous-total</span><span>{fmtMoney(inv.subtotal)}</span></div>
              {inv.include_tax !== false && <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#6b7280' }}><span>TPS (5%)</span><span>{fmtMoney(inv.tps)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#6b7280' }}><span>TVQ (9.975%)</span><span>{fmtMoney(inv.tvq)}</span></div>
              </>}
              {inv.include_tax === false && <div style={{ fontSize: 11, color: '#d97706', fontWeight: 500, marginBottom: 8 }}>Client exempté — TPS/TVQ non appliquées</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '3px solid #1d4ed8', fontSize: 20, fontWeight: 800, color: '#1d4ed8' }}>
                <span>TOTAL</span><span>{fmtMoney(inv.total)}</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 30, paddingTop: 16, borderTop: '1px solid #e5e7eb', textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>
            Soins Expert Plus — 9437-7827 Québec Inc. — Merci de votre confiance
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPreview(null)}>Fermer</button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => {
            const el = document.getElementById('invoice-preview');
            const win = window.open('', '_blank', 'width=900,height=700');
            win.document.write(`<!DOCTYPE html><html><head><title>Facture</title><style>body{margin:0;padding:20px;font-family:'DM Sans',system-ui,sans-serif}@media print{body{padding:0}}</style></head><body>${el.innerHTML}</body></html>`);
            win.document.close();
            setTimeout(() => win.print(), 300);
          }}>🖨️ Imprimer / PDF</button>
        </div>
      </Modal>
    );
  };

  const total = invoices.reduce((s, i) => s + (i.total || 0), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Facturation</h1>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
            {invoices.length} facture(s) — Total: <strong style={{ color: 'var(--brand)' }}>{fmtMoney(total)}</strong>
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate}><Plus size={14} /> Créer une facture</button>
      </div>

      {invoices.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          Aucune facture créée.
        </div>
      )}

      {invoices.map(inv => (
        <div key={inv.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--brand-d)' }}>{inv.number}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {inv.date}{inv.client_name ? ` — ${inv.client_name}` : ''}
              </div>
              {inv.period_start && <div style={{ fontSize: 11, color: 'var(--brand-m)', marginTop: 2 }}>Période: {inv.period_start} au {inv.period_end}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--brand)' }}>{fmtMoney(inv.total)}</div>
              <Badge status={inv.status} />
            </div>
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span>Services ({(inv.lines || []).length} ligne(s))</span>
              <span>{fmtMoney(inv.subtotal_services)}</span>
            </div>
            {inv.include_tax !== false ? <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>TPS 5%</span><span>{fmtMoney(inv.tps)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TVQ 9.975%</span><span>{fmtMoney(inv.tvq)}</span></div>
            </> : <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 500 }}>Client exempté — TPS/TVQ non appliquées</div>}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setPreview(inv)}><Eye size={14} /> Aperçu</button>
            {inv.status !== 'paid' && <button className="btn btn-outline btn-sm" style={{ color: 'var(--amber)' }} onClick={() => openEdit(inv)}><Edit3 size={14} /> Modifier</button>}
            {(inv.status === 'sent' || inv.status === 'draft') && <button className="btn btn-success btn-sm" onClick={() => markPaid(inv.id)}><Check size={14} /> Payée</button>}
          </div>
        </div>
      ))}

      {/* Preview Modal */}
      {preview && renderPreview(preview)}

      {/* Create/Edit Modal */}
      {createModal && (
        <Modal title={createModal._editId ? `Modifier — ${createModal.number}` : `Créer — ${createModal.number}`} onClose={() => setCreateModal(null)} wide>
          {createModal._editId && (
            <div style={{ background: 'var(--amber-l)', padding: '10px 14px', borderRadius: 'var(--r)', marginBottom: 16, fontSize: 12, color: 'var(--amber)' }}>
              <strong>MODIFICATION</strong> — Les changements remplaceront la version précédente.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="field"><label>N° Facture</label><input className="input" value={createModal.number} onChange={e => setCreateModal(m => ({ ...m, number: e.target.value }))} /></div>
            <div className="field"><label>Date</label><input className="input" type="date" value={createModal.date} onChange={e => setCreateModal(m => ({ ...m, date: e.target.value }))} /></div>
          </div>
          <div className="field">
            <label>Client</label>
            <select className="input" value={createModal.client_id} onChange={e => setCreateModal(m => ({ ...m, client_id: Number(e.target.value) }))}>
              <option value={0}>— Sélectionner —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="field"><label>Période début</label><input className="input" type="date" value={createModal.period_start} onChange={e => setCreateModal(m => ({ ...m, period_start: e.target.value }))} /></div>
            <div className="field"><label>Période fin</label><input className="input" type="date" value={createModal.period_end} onChange={e => setCreateModal(m => ({ ...m, period_end: e.target.value }))} /></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>Lignes de facturation</label>
            <button className="btn btn-outline btn-sm" onClick={addLine}><Plus size={14} /> Ajouter</button>
          </div>

          {createModal.lines.map((l, i) => (
            <div key={l.id} style={{ padding: 12, background: i % 2 ? 'var(--surface)' : 'var(--surface2)', borderRadius: 'var(--r)', marginBottom: 6, position: 'relative' }}>
              {createModal.lines.length > 1 && (
                <button onClick={() => removeLine(l.id)} style={{ position: 'absolute', top: 6, right: 8, background: 'none', color: 'var(--red)', fontSize: 16, cursor: 'pointer', border: 'none' }}>×</button>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: 10 }}>Employé / Description</label>
                  <select className="input" style={{ padding: '6px 8px', fontSize: 12 }} value={l.employee} onChange={e => {
                    const emp = employees.find(x => x.name === e.target.value);
                    updateLine(l.id, 'employee', e.target.value);
                    if (emp) updateLine(l.id, 'rate', emp.rate);
                  }}>
                    <option value="">— Aucun —</option>
                    {employees.map(e => <option key={e.id} value={e.name}>{e.name} — {e.position}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: 10 }}>Heures</label>
                  <input className="input" type="number" style={{ padding: '6px 8px', fontSize: 12 }} value={l.hours} min={0} step={0.25}
                    onChange={e => updateLine(l.id, 'hours', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: 10 }}>Taux ($/h)</label>
                  <input className="input" type="number" style={{ padding: '6px 8px', fontSize: 12 }} value={l.rate} min={0} step={0.01}
                    onChange={e => updateLine(l.id, 'rate', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: 10 }}>Total</label>
                  <div style={{ padding: '6px 8px', fontSize: 13, fontWeight: 700, color: 'var(--brand)', background: 'var(--brand-xl)', borderRadius: 'var(--r)' }}>
                    {fmtMoney(l.amount)}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Tax toggle */}
          <div style={{ background: 'var(--amber-l)', padding: '12px 14px', borderRadius: 'var(--r)', marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--amber)' }}>
              <input type="checkbox" checked={createModal.include_tax} onChange={e => setCreateModal(m => ({ ...m, include_tax: e.target.checked }))}
                style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
              Appliquer TPS 5% + TVQ 9.975%
            </label>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Notes</label>
            <textarea className="input" rows={2} value={createModal.notes} onChange={e => setCreateModal(m => ({ ...m, notes: e.target.value }))} style={{ resize: 'vertical' }} />
          </div>

          {/* Totals preview */}
          {(() => {
            const sub = createModal.lines.reduce((s, l) => s + l.amount, 0);
            const tps = createModal.include_tax ? Math.round(sub * 0.05 * 100) / 100 : 0;
            const tvq = createModal.include_tax ? Math.round(sub * 0.09975 * 100) / 100 : 0;
            const tot = Math.round((sub + tps + tvq) * 100) / 100;
            return (
              <div style={{ marginTop: 12, padding: 14, background: 'var(--brand-xl)', borderRadius: 'var(--r)', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>Sous-total</span><span style={{ fontWeight: 600 }}>{fmtMoney(sub)}</span></div>
                {createModal.include_tax && <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>TPS 5%</span><span>{fmtMoney(tps)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>TVQ 9.975%</span><span>{fmtMoney(tvq)}</span></div>
                </>}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '2px solid var(--brand)', fontSize: 16, fontWeight: 800, color: 'var(--brand-d)' }}>
                  <span>TOTAL</span><span>{fmtMoney(tot)}</span>
                </div>
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setCreateModal(null)}>Annuler</button>
            <button className="btn btn-amber" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => createModal._editId ? saveEdit('draft') : saveInvoice('draft')}>Brouillon</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => createModal._editId ? saveEdit('sent') : saveInvoice('sent')}>Confirmer</button>
          </div>
        </Modal>
      )}
    </>
  );
}
