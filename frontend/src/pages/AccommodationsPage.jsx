import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { fmtMoney, fmtISO } from '../utils/helpers';
import { Modal, Avatar } from '../components/UI';
import { Plus, BedDouble, Upload, FileText } from 'lucide-react';

export default function AccommodationsPage({ toast }) {
  const [accommodations, setAccommodations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [acc, emps, scheds] = await Promise.all([
        api.getAccommodations(), api.getEmployees(), api.getSchedules(),
      ]);
      setAccommodations(acc); setEmployees(emps); setSchedules(scheds);
    } catch (err) { toast?.('Erreur: ' + err.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`;
  const totalAccom = accommodations.reduce((s, a) => s + (a.total_cost || 0), 0);

  // ── Auto-calculate shifts in period ──
  const autoCalc = useMemo(() => {
    if (!modal) return null;
    const { employee_id, start_date, end_date, total_cost } = modal;
    if (!employee_id || !start_date || !end_date) return { shifts: 0, days: 0, message: 'Sélectionnez un employé et les dates.' };

    const matchingShifts = schedules.filter(s =>
      s.employee_id === Number(employee_id) && s.date >= start_date && s.date <= end_date
    );
    const uniqueDates = [...new Set(matchingShifts.map(s => s.date))];
    const emp = employees.find(e => e.id === Number(employee_id));
    const shiftCount = matchingShifts.length;

    if (shiftCount === 0) return { shifts: 0, days: 0, message: 'Aucun quart trouvé pour cet employé dans cette période.' };

    const cpd = total_cost > 0 ? Math.round(total_cost / shiftCount * 100) / 100 : 0;
    return {
      shifts: shiftCount,
      days: uniqueDates.length,
      cpd,
      message: `${emp?.name || '?'} a ${shiftCount} quart(s) sur ${uniqueDates.length} jour(s) entre ${start_date} et ${end_date}`,
      calcText: total_cost > 0 ? `${fmtMoney(total_cost)} ÷ ${shiftCount} quarts = ${fmtMoney(cpd)} / jour travaillé` : 'Entrez le coût total pour voir le calcul.',
    };
  }, [modal, schedules, employees]);

  const openAdd = () => {
    setModal({
      employee_id: '', total_cost: 0,
      start_date: '', end_date: '',
      days_worked: 0, cost_per_day: 0, notes: '',
    });
  };

  const deleteAccom = async (id) => {
    if (!confirm('Supprimer cet hébergement ?')) return;
    try { await api.deleteAccommodation(id); toast?.('Hébergement supprimé'); reload(); }
    catch (err) { toast?.('Erreur: ' + err.message); }
  };

  const save = async () => {
    if (!modal.employee_id || !modal.start_date || !modal.end_date || !modal.total_cost) {
      toast?.('Remplir tous les champs'); return;
    }
    const days = autoCalc?.shifts || modal.days_worked;
    if (days === 0) { toast?.('Aucun quart trouvé dans cette période'); return; }
    const cpd = Math.round(modal.total_cost / days * 100) / 100;
    try {
      await api.createAccommodation({
        ...modal,
        employee_id: Number(modal.employee_id),
        days_worked: days,
        cost_per_day: cpd,
      });
      toast?.(`Hébergement ajouté — ${fmtMoney(cpd)}/jour × ${days} quarts`);
      setModal(null); reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Chargement...</div>;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">
          <BedDouble size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Hébergement
        </h1>
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Ajouter</button>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        {accommodations.length} hébergement(s) — Total: <strong style={{ color: 'var(--purple)' }}>{fmtMoney(totalAccom)}</strong>
      </div>

      {accommodations.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          <p style={{ marginBottom: 4 }}>Aucun hébergement enregistré</p>
          <p style={{ fontSize: 12 }}>Ajoutez un hébergement pour un employé en région éloignée.</p>
        </div>
      )}

      {accommodations.map(a => (
        <div key={a.id} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={empName(a.employee_id)} size={36} bg="var(--purple-l)" color="var(--purple)" />
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{empName(a.employee_id)}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.start_date} au {a.end_date} — {a.days_worked} jours travaillés</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--purple)' }}>{fmtMoney(a.total_cost)}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtMoney(a.cost_per_day)}/jour</div>
            </div>
          </div>
          {a.pdf_name && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--brand)' }}>
              <FileText size={12} /> {a.pdf_name}
            </div>
          )}
          {a.notes && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>{a.notes}</div>}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)', fontSize: 11 }}
              onClick={(ev) => { ev.stopPropagation(); deleteAccom(a.id); }}>Supprimer</button>
          </div>
        </div>
      ))}

      {/* Add Modal */}
      {modal && (
        <Modal title="Ajouter un hébergement" onClose={() => setModal(null)}>
          <div className="field">
            <label>Employé</label>
            <select className="input" value={modal.employee_id}
              onChange={e => setModal(m => ({ ...m, employee_id: e.target.value }))}>
              <option value="">Choisir...</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Date début</label>
              <input type="date" className="input" value={modal.start_date}
                onChange={e => setModal(m => ({ ...m, start_date: e.target.value }))} />
            </div>
            <div className="field"><label>Date fin</label>
              <input type="date" className="input" value={modal.end_date}
                onChange={e => setModal(m => ({ ...m, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label>Coût total hébergement ($)</label>
            <input type="number" className="input" min={0} step={0.01} placeholder="Ex: 1200.00"
              value={modal.total_cost || ''}
              onChange={e => setModal(m => ({ ...m, total_cost: parseFloat(e.target.value) || 0 }))} />
          </div>

          {/* Auto-calc info */}
          <div style={{
            background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 14,
            marginBottom: 16, fontSize: 12, color: 'var(--brand)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>Calcul automatique basé sur les quarts</strong>
              <span className="badge" style={{ background: 'var(--brand-l)', color: 'var(--brand)' }}>
                {autoCalc?.shifts > 0 ? `${autoCalc.shifts} quart(s)` : '—'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: autoCalc?.shifts === 0 ? 'var(--red)' : 'var(--text2)' }}>
              {autoCalc?.message}
            </div>
            {autoCalc?.calcText && (
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, color: 'var(--brand-d)' }}>
                {autoCalc.calcText}
              </div>
            )}
          </div>

          {/* Upload zone */}
          <div style={{
            background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 20,
            border: '2px dashed var(--brand-m)', textAlign: 'center', cursor: 'pointer', marginBottom: 16,
          }}>
            <Upload size={20} style={{ color: 'var(--brand-m)' }} />
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>Joindre la facture d'hébergement (PDF)</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Cette facture sera jointe au courriel envoyé au client</div>
          </div>

          <div className="field">
            <label>Notes</label>
            <textarea className="input" rows={2} style={{ resize: 'vertical' }}
              value={modal.notes} onChange={e => setModal(m => ({ ...m, notes: e.target.value }))}
              placeholder="Optionnel..." />
          </div>

          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={save}>
            Ajouter l'hébergement
          </button>
        </Modal>
      )}
    </>
  );
}
