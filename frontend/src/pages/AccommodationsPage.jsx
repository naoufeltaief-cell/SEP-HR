import { useState, useEffect } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Modal, Avatar } from '../components/UI';
import { Plus } from 'lucide-react';

export default function AccommodationsPage({ toast }) {
  const [accommodations, setAccommodations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [modal, setModal] = useState(null);

  const reload = async () => {
    const [acc, emps] = await Promise.all([api.getAccommodations(), api.getEmployees()]);
    setAccommodations(acc); setEmployees(emps);
  };
  useEffect(() => { reload(); }, []);

  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`;

  const openAdd = () => {
    setModal({
      employee_id: employees[0]?.id || 0,
      total_cost: 0, start_date: '', end_date: '',
      days_worked: 0, cost_per_day: 0, notes: '',
    });
  };

  const save = async () => {
    try {
      await api.createAccommodation(modal);
      toast?.('Hébergement ajouté');
      setModal(null); reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  const calcPerDay = (total, days) => days > 0 ? Math.round(total / days * 100) / 100 : 0;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Hébergement</h1>
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Ajouter</button>
      </div>

      {accommodations.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          Aucun hébergement enregistré
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {accommodations.map(a => (
          <div key={a.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Avatar name={empName(a.employee_id)} size={36} bg="var(--purple-l)" color="var(--purple)" />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{empName(a.employee_id)}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.start_date} → {a.end_date}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12 }}>
              <div><span style={{ color: 'var(--text3)', fontSize: 10 }}>Coût total</span><div style={{ fontWeight: 700, color: 'var(--purple)' }}>{fmtMoney(a.total_cost)}</div></div>
              <div><span style={{ color: 'var(--text3)', fontSize: 10 }}>Jours</span><div style={{ fontWeight: 600 }}>{a.days_worked}</div></div>
              <div><span style={{ color: 'var(--text3)', fontSize: 10 }}>$/jour</span><div style={{ fontWeight: 600 }}>{fmtMoney(a.cost_per_day)}</div></div>
            </div>
            {a.notes && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text2)' }}>{a.notes}</div>}
          </div>
        ))}
      </div>

      {modal && (
        <Modal title="Nouvel hébergement" onClose={() => setModal(null)}>
          <div className="field">
            <label>Employé</label>
            <select className="input" value={modal.employee_id} onChange={e => setModal(m => ({ ...m, employee_id: Number(e.target.value) }))}>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Début</label><input className="input" type="date" value={modal.start_date}
              onChange={e => setModal(m => ({ ...m, start_date: e.target.value }))} /></div>
            <div className="field"><label>Fin</label><input className="input" type="date" value={modal.end_date}
              onChange={e => setModal(m => ({ ...m, end_date: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Coût total ($)</label><input className="input" type="number" value={modal.total_cost} step={0.01}
              onChange={e => {
                const tc = parseFloat(e.target.value) || 0;
                setModal(m => ({ ...m, total_cost: tc, cost_per_day: calcPerDay(tc, m.days_worked) }));
              }} /></div>
            <div className="field"><label>Jours travaillés</label><input className="input" type="number" value={modal.days_worked} min={0}
              onChange={e => {
                const dw = parseInt(e.target.value) || 0;
                setModal(m => ({ ...m, days_worked: dw, cost_per_day: calcPerDay(m.total_cost, dw) }));
              }} /></div>
          </div>
          <div className="field">
            <label>Coût par jour</label>
            <div style={{ padding: '9px 12px', background: 'var(--purple-l)', borderRadius: 'var(--r)', fontWeight: 700, color: 'var(--purple)' }}>
              {fmtMoney(modal.cost_per_day)}
            </div>
          </div>
          <div className="field"><label>Notes</label><textarea className="input" rows={2} value={modal.notes}
            onChange={e => setModal(m => ({ ...m, notes: e.target.value }))} style={{ resize: 'vertical' }} /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>Annuler</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={save}>Ajouter</button>
          </div>
        </Modal>
      )}
    </>
  );
}
