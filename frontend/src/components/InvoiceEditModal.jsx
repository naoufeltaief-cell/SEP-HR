import React, { useEffect, useState } from 'react';

export default function InvoiceEditModal({ open, onClose, invoice, onSave }) {
  const [form, setForm] = useState({
    include_tax: true,
    notes: '',
    due_date: '',
    po_number: '',
    expense_lines: [],
    extra_lines: [],
  });

  useEffect(() => {
    if (!invoice) return;
    setForm({
      include_tax: !!invoice.include_tax,
      notes: invoice.notes || '',
      due_date: invoice.due_date || '',
      po_number: invoice.po_number || '',
      expense_lines: Array.isArray(invoice.expense_lines) ? JSON.parse(JSON.stringify(invoice.expense_lines)) : [],
      extra_lines: Array.isArray(invoice.extra_lines) ? JSON.parse(JSON.stringify(invoice.extra_lines)) : [],
    });
  }, [invoice]);

  if (!open || !invoice) return null;

  const modal = {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
  };
  const overlay = { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' };
  const content = {
    position: 'relative', background: '#fff', borderRadius: 12, padding: 24, maxWidth: 780, width: '95%', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', fontFamily: "'Plus Jakarta Sans','Segoe UI',sans-serif"
  };
  const input = { padding: '8px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, outline: 'none', fontFamily: 'inherit', width: '100%' };
  const select = { ...input, background: '#fff' };
  const btn = (variant = 'primary') => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, border: variant === 'outline' ? '1.5px solid #2A7B88' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: variant === 'primary' ? '#2A7B88' : variant === 'danger' ? '#DC3545' : 'transparent', color: variant === 'outline' ? '#2A7B88' : '#fff'
  });

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
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

  const submit = () => {
    onSave({
      include_tax: !!form.include_tax,
      notes: form.notes || '',
      due_date: form.due_date || null,
      po_number: form.po_number || '',
      expense_lines: (form.expense_lines || []).map(l => ({ ...l, quantity: Number(l.quantity || 0), rate: Number(l.rate || 0), amount: Number(l.amount || 0) })),
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
