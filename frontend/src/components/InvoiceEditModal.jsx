import React, { useEffect, useState } from 'react';

function calcHours(start, end, pauseMin = 0) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, Math.round((((endMin - startMin) - Number(pauseMin || 0)) / 60) * 100) / 100);
}

export default function InvoiceEditModal({ open, onClose, invoice, onSave }) {
  const [form, setForm] = useState({
    include_tax: true,
    notes: '',
    due_date: '',
    po_number: '',
    lines: [],
    expense_lines: [],
    accommodation_lines: [],
    extra_lines: [],
  });

  useEffect(() => {
    if (!invoice) return;
    setForm({
      include_tax: !!invoice.include_tax,
      notes: invoice.notes || '',
      due_date: invoice.due_date || '',
      po_number: invoice.po_number || '',
      lines: Array.isArray(invoice.lines) ? JSON.parse(JSON.stringify(invoice.lines)) : [],
      expense_lines: Array.isArray(invoice.expense_lines) ? JSON.parse(JSON.stringify(invoice.expense_lines)) : [],
      accommodation_lines: Array.isArray(invoice.accommodation_lines) ? JSON.parse(JSON.stringify(invoice.accommodation_lines)) : [],
      extra_lines: Array.isArray(invoice.extra_lines) ? JSON.parse(JSON.stringify(invoice.extra_lines)) : [],
    });
  }, [invoice]);

  if (!open || !invoice) return null;

  const modal = { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const overlay = { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' };
  const content = { position: 'relative', background: '#fff', borderRadius: 12, padding: 24, maxWidth: 1100, width: '97%', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', fontFamily: "'Plus Jakarta Sans','Segoe UI',sans-serif" };
  const input = { padding: '8px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, outline: 'none', fontFamily: 'inherit', width: '100%' };
  const select = { ...input, background: '#fff' };
  const btn = (variant = 'primary') => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, border: variant === 'outline' ? '1.5px solid #2A7B88' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: variant === 'primary' ? '#2A7B88' : variant === 'danger' ? '#DC3545' : 'transparent', color: variant === 'outline' ? '#2A7B88' : '#fff' });

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const addServiceLine = () => setForm(prev => ({
    ...prev,
    lines: [...prev.lines, { date: invoice.period_start || '', employee: invoice.employee_name || '', location: invoice.client_name || '', start: '07:00', end: '15:00', pause_min: 45, hours: 7.25, rate: prev.lines?.[0]?.rate || 0, service_amount: (prev.lines?.[0]?.rate || 0) * 7.25, garde_hours: 0, garde_amount: 0, rappel_hours: 0, rappel_amount: 0 }]
  }));
  const removeServiceLine = (index) => setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));
  const updateServiceLine = (index, field, value) => setForm(prev => {
    const next = [...prev.lines];
    next[index] = { ...next[index], [field]: value };
    if (field === 'start' || field === 'end' || field === 'pause_min' || field === 'rate') {
      const hours = calcHours(next[index].start, next[index].end, Number(next[index].pause_min || 0));
      next[index].hours = hours;
      next[index].service_amount = Math.round(hours * Number(next[index].rate || 0) * 100) / 100;
    }
    if (field === 'hours') {
      next[index].service_amount = Math.round(Number(next[index].hours || 0) * Number(next[index].rate || 0) * 100) / 100;
    }
    if (field === 'garde_hours') {
      next[index].garde_amount = Math.round((Number(next[index].garde_hours || 0) / 8) * Number(next[index].rate || 0) * 100) / 100;
    }
    if (field === 'rappel_hours') {
      next[index].rappel_amount = Math.round(Number(next[index].rappel_hours || 0) * Number(next[index].rate || 0) * 100) / 100;
    }
    return { ...prev, lines: next };
  });

  const addExpenseLine = () => setForm(prev => ({ ...prev, expense_lines: [...prev.expense_lines, { type: 'autre', description: '', quantity: 1, rate: 0, amount: 0 }] }));
  const addExtraLine = () => setForm(prev => ({ ...prev, extra_lines: [...prev.extra_lines, { description: '', quantity: 1, rate: 0, amount: 0 }] }));
  const removeExpenseLine = (index) => setForm(prev => ({ ...prev, expense_lines: prev.expense_lines.filter((_, i) => i !== index) }));
  const removeExtraLine = (index) => setForm(prev => ({ ...prev, extra_lines: prev.extra_lines.filter((_, i) => i !== index) }));
  const updateExpenseLine = (index, field, value) => setForm(prev => {
    const next = [...prev.expense_lines];
    next[index] = { ...next[index], [field]: value };
    if (field === 'quantity' || field === 'rate') next[index].amount = Number(next[index].quantity || 0) * Number(next[index].rate || 0);
    return { ...prev, expense_lines: next };
  });
  const updateExtraLine = (index, field, value) => setForm(prev => {
    const next = [...prev.extra_lines];
    next[index] = { ...next[index], [field]: value };
    if (field === 'quantity' || field === 'rate') next[index].amount = Number(next[index].quantity || 0) * Number(next[index].rate || 0);
    return { ...prev, extra_lines: next };
  });

  const addAccommodationLine = () => setForm(prev => ({ ...prev, accommodation_lines: [...prev.accommodation_lines, { employee: invoice.employee_name || '', period: '', days: 1, cost_per_day: 0, amount: 0 }] }));
  const removeAccommodationLine = (index) => setForm(prev => ({ ...prev, accommodation_lines: prev.accommodation_lines.filter((_, i) => i !== index) }));
  const updateAccommodationLine = (index, field, value) => setForm(prev => {
    const next = [...prev.accommodation_lines];
    next[index] = { ...next[index], [field]: value };
    if (field === 'days' || field === 'cost_per_day') next[index].amount = Math.round(Number(next[index].days || 0) * Number(next[index].cost_per_day || 0) * 100) / 100;
    return { ...prev, accommodation_lines: next };
  });

  const submit = () => {
    onSave({
      include_tax: !!form.include_tax,
      notes: form.notes || '',
      due_date: form.due_date || null,
      po_number: form.po_number || '',
      lines: (form.lines || []).map(l => ({ ...l, pause_min: Number(l.pause_min || 0), hours: Number(l.hours || 0), rate: Number(l.rate || 0), service_amount: Number(l.service_amount || 0), garde_hours: Number(l.garde_hours || 0), garde_amount: Number(l.garde_amount || 0), rappel_hours: Number(l.rappel_hours || 0), rappel_amount: Number(l.rappel_amount || 0) })),
      expense_lines: (form.expense_lines || []).map(l => ({ ...l, quantity: Number(l.quantity || 0), rate: Number(l.rate || 0), amount: Number(l.amount || 0) })),
      accommodation_lines: (form.accommodation_lines || []).map(l => ({ ...l, days: Number(l.days || 0), cost_per_day: Number(l.cost_per_day || 0), amount: Number(l.amount || 0) })),
      extra_lines: (form.extra_lines || []).map(l => ({ ...l, quantity: Number(l.quantity || 0), rate: Number(l.rate || 0), amount: Number(l.amount || 0) })),
    });
  };

  return (
    <div style={modal}>
      <div style={overlay} onClick={onClose} />
      <div style={content}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#2A7B88' }}>Modifier {invoice.number}</h3>
          <button onClick={onClose} style={{ ...btn('outline'), padding: '4px 8px' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Date d'échéance</label>
            <input type="date" style={input} value={form.due_date || ''} onChange={e => updateField('due_date', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>PO / Référence</label>
            <input style={input} value={form.po_number || ''} onChange={e => updateField('po_number', e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.include_tax} onChange={e => updateField('include_tax', e.target.checked)} />
            Inclure TPS/TVQ
          </label>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea style={{ ...input, minHeight: 80 }} value={form.notes || ''} onChange={e => updateField('notes', e.target.value)} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: '#2A7B88' }}>Quarts de service</h4>
            <button style={btn('outline')} onClick={addServiceLine}>+ Ajouter quart</button>
          </div>
          {(form.lines || []).length === 0 ? <div style={{ fontSize: 12, color: '#6C757D' }}>Aucun quart</div> : form.lines.map((line, index) => (
            <div key={index} style={{ display: 'grid', gridTemplateColumns: '130px 90px 90px 95px 85px 90px 110px 95px 95px auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input type="date" style={input} value={line.date || ''} onChange={e => updateServiceLine(index, 'date', e.target.value)} />
              <input type="time" style={input} value={line.start || ''} onChange={e => updateServiceLine(index, 'start', e.target.value)} />
              <input type="time" style={input} value={line.end || ''} onChange={e => updateServiceLine(index, 'end', e.target.value)} />
              <input type="number" step="1" style={input} value={line.pause_min ?? 0} onChange={e => updateServiceLine(index, 'pause_min', e.target.value)} placeholder="Pause min" />
              <input type="number" step="0.01" style={input} value={line.hours ?? 0} onChange={e => updateServiceLine(index, 'hours', e.target.value)} />
              <input type="number" step="0.01" style={input} value={line.rate ?? 0} onChange={e => updateServiceLine(index, 'rate', e.target.value)} />
              <input type="number" step="0.01" style={{ ...input, background: '#f8f9fa' }} value={line.service_amount ?? 0} readOnly />
              <input type="number" step="0.01" style={input} value={line.garde_hours ?? 0} onChange={e => updateServiceLine(index, 'garde_hours', e.target.value)} placeholder="Garde h" />
              <input type="number" step="0.01" style={input} value={line.rappel_hours ?? 0} onChange={e => updateServiceLine(index, 'rappel_hours', e.target.value)} placeholder="Rappel h" />
              <button style={btn('danger')} onClick={() => removeServiceLine(index)}>🗑</button>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '130px 90px 90px 95px 85px 90px 110px 95px 95px auto', gap: 8, fontSize: 11, color: '#6C757D', marginTop: 4 }}>
            <div>Date</div><div>Début</div><div>Fin</div><div>Pause (min)</div><div>Heures</div><div>Taux</div><div>Montant</div><div>Garde h</div><div>Rappel h</div><div></div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: '#2A7B88' }}>Frais additionnels</h4>
            <button style={btn('outline')} onClick={addExpenseLine}>+ Ajouter frais</button>
          </div>
          {(form.expense_lines || []).length === 0 ? <div style={{ fontSize: 12, color: '#6C757D' }}>Aucun frais additionnel</div> : form.expense_lines.map((line, index) => (
            <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select style={select} value={line.type || 'autre'} onChange={e => updateExpenseLine(index, 'type', e.target.value)}>
                <option value="km">km</option>
                <option value="deplacement">déplacement</option>
                <option value="autre">autre</option>
              </select>
              <input style={input} value={line.description || ''} onChange={e => updateExpenseLine(index, 'description', e.target.value)} placeholder="Description" />
              <input type="number" step="0.01" style={input} value={line.quantity ?? 1} onChange={e => updateExpenseLine(index, 'quantity', e.target.value)} />
              <input type="number" step="0.01" style={input} value={line.rate ?? 0} onChange={e => updateExpenseLine(index, 'rate', e.target.value)} />
              <input type="number" step="0.01" style={{ ...input, background: '#f8f9fa' }} value={line.amount ?? 0} readOnly />
              <button style={btn('danger')} onClick={() => removeExpenseLine(index)}>🗑</button>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: '#2A7B88' }}>🏠 Hébergement</h4>
            <button style={btn('outline')} onClick={addAccommodationLine}>+ Ajouter hébergement</button>
          </div>
          {(form.accommodation_lines || []).length === 0 ? <div style={{ fontSize: 12, color: '#6C757D' }}>Aucun hébergement</div> : form.accommodation_lines.map((line, index) => (
            <div key={index} style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input style={input} value={line.employee || ''} onChange={e => updateAccommodationLine(index, 'employee', e.target.value)} placeholder="Employé" />
              <input style={input} value={line.period || ''} onChange={e => updateAccommodationLine(index, 'period', e.target.value)} placeholder="Période (ex: 2026-03-01 → 2026-03-07)" />
              <input type="number" step="1" style={input} value={line.days ?? 0} onChange={e => updateAccommodationLine(index, 'days', e.target.value)} placeholder="Jours" />
              <input type="number" step="0.01" style={input} value={line.cost_per_day ?? 0} onChange={e => updateAccommodationLine(index, 'cost_per_day', e.target.value)} placeholder="$/jour" />
              <input type="number" step="0.01" style={{ ...input, background: '#f8f9fa' }} value={line.amount ?? 0} readOnly />
              <button style={btn('danger')} onClick={() => removeAccommodationLine(index)}>🗑</button>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 1fr 1fr auto', gap: 8, fontSize: 11, color: '#6C757D', marginTop: 4 }}>
            <div>Employé</div><div>Période</div><div>Jours</div><div>$/jour</div><div>Montant</div><div></div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: '#2A7B88' }}>Ajustements manuels</h4>
            <button style={btn('outline')} onClick={addExtraLine}>+ Ajouter ajustement</button>
          </div>
          {(form.extra_lines || []).length === 0 ? <div style={{ fontSize: 12, color: '#6C757D' }}>Aucun ajustement</div> : form.extra_lines.map((line, index) => (
            <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input style={input} value={line.description || ''} onChange={e => updateExtraLine(index, 'description', e.target.value)} placeholder="Description" />
              <input type="number" step="0.01" style={input} value={line.quantity ?? 1} onChange={e => updateExtraLine(index, 'quantity', e.target.value)} />
              <input type="number" step="0.01" style={input} value={line.rate ?? 0} onChange={e => updateExtraLine(index, 'rate', e.target.value)} />
              <input type="number" step="0.01" style={{ ...input, background: '#f8f9fa' }} value={line.amount ?? 0} readOnly />
              <button style={btn('danger')} onClick={() => removeExtraLine(index)}>🗑</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <button style={btn('outline')} onClick={onClose}>Annuler</button>
          <button style={btn('primary')} onClick={submit}>💾 Sauvegarder les modifications</button>
        </div>
      </div>
    </div>
  );
}
