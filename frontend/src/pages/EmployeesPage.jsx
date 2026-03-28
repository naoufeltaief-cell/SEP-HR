import { useState, useEffect } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Avatar, Modal } from '../components/UI';
import { Plus, Search } from 'lucide-react';

export default function EmployeesPage({ toast }) {
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [noteText, setNoteText] = useState('');

  const reload = async () => {
    const [emps, scheds] = await Promise.all([api.getEmployees(), api.getSchedules()]);
    setEmployees(emps); setSchedules(scheds);
  };
  useEffect(() => { reload(); }, []);

  const filtered = employees.filter(e => e.name.toLowerCase().includes(search.toLowerCase()) || e.position.toLowerCase().includes(search.toLowerCase()));

  const openDetail = async (id) => {
    const emp = await api.getEmployee(id);
    setDetail(emp);
  };

  const addNote = async () => {
    if (!noteText.trim() || !detail) return;
    await api.addEmployeeNote(detail.id, { content: noteText });
    setNoteText('');
    const emp = await api.getEmployee(detail.id);
    setDetail(emp);
    toast?.('Note ajoutée');
  };

  const saveNew = async () => {
    try {
      await api.createEmployee(modal.data);
      toast?.('Employé créé');
      setModal(null); reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Employés</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ data: { name: '', position: '', phone: '', email: '', rate: 0 } })}>
          <Plus size={14} /> Nouvel employé
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', maxWidth: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {filtered.map(e => {
          const hrs = schedules.filter(s => s.employee_id === e.id).reduce((sum, s) => sum + s.hours, 0);
          return (
            <div key={e.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openDetail(e.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={e.name} size={44} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{e.position}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 14 }}>{hrs.toFixed(1)}h</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtMoney(e.rate)}/h</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Poste</span><div style={{ fontWeight: 600 }}>{detail.position}</div></div>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Taux</span><div style={{ fontWeight: 600 }}>{fmtMoney(detail.rate)}/h</div></div>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Téléphone</span><div>{detail.phone || '—'}</div></div>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Courriel</span><div>{detail.email || '—'}</div></div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Notes</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Ajouter une note..." value={noteText} onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()} />
            <button className="btn btn-primary btn-sm" onClick={addNote}>Ajouter</button>
          </div>
          {(detail.notes || []).map(n => (
            <div key={n.id} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 'var(--r)', marginBottom: 6, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>{n.author}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(n.created_at).toLocaleString('fr-CA')}</span>
              </div>
              <div style={{ marginTop: 4 }}>{n.content}</div>
            </div>
          ))}
          {(!detail.notes || detail.notes.length === 0) && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucune note</div>}
        </Modal>
      )}

      {/* New Employee Modal */}
      {modal && (
        <Modal title="Nouvel employé" onClose={() => setModal(null)}>
          {['name', 'position', 'phone', 'email'].map(f => (
            <div className="field" key={f}>
              <label>{f === 'name' ? 'Nom complet' : f === 'position' ? 'Poste' : f === 'phone' ? 'Téléphone' : 'Courriel'}</label>
              <input className="input" value={modal.data[f]} onChange={e => setModal(m => ({ ...m, data: { ...m.data, [f]: e.target.value } }))} />
            </div>
          ))}
          <div className="field">
            <label>Taux horaire ($/h)</label>
            <input className="input" type="number" value={modal.data.rate} step={0.01}
              onChange={e => setModal(m => ({ ...m, data: { ...m.data, rate: parseFloat(e.target.value) || 0 } }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>Annuler</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveNew}>Créer</button>
          </div>
        </Modal>
      )}
    </>
  );
}
