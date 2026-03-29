import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Avatar, Modal } from '../components/UI';
import { Plus, Search, Edit3, Users, Building } from 'lucide-react';

export default function EmployeesPage({ toast }) {
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [noteText, setNoteText] = useState('');

  const reload = useCallback(async () => {
    const [emps, scheds, cls] = await Promise.all([api.getEmployees(), api.getSchedules(), api.getClients()]);
    setEmployees(emps); setSchedules(scheds); setClients(cls);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const filtered = employees.filter(e =>
    (e.name.toLowerCase() + ' ' + (e.position || '').toLowerCase()).includes(search.toLowerCase())
  );
  const clientName = (id) => clients.find(c => c.id === id)?.name || '';

  const openDetail = async (id) => { setDetail(await api.getEmployee(id)); };
  const addNote = async () => {
    if (!noteText.trim() || !detail) return;
    await api.addEmployeeNote(detail.id, { content: noteText });
    setNoteText('');
    setDetail(await api.getEmployee(detail.id));
    toast?.('Note ajoutée');
  };
  const openEdit = (emp) => { setModal({ type: 'edit', data: { ...emp } }); setDetail(null); };
  const saveEmployee = async () => {
    try {
      if (modal.type === 'add') { await api.createEmployee(modal.data); toast?.('Employé créé'); }
      else {
        await api.updateEmployee(modal.data.id, {
          name: modal.data.name, position: modal.data.position, phone: modal.data.phone,
          email: modal.data.email, rate: modal.data.rate, client_id: modal.data.client_id || null,
        });
        toast?.('Employé mis à jour');
      }
      setModal(null); reload();
    } catch (err) { toast?.('Erreur: ' + err.message); }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title"><Users size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />Employés ({employees.length})</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'add', data: { name: '', position: '', phone: '', email: '', rate: 0, client_id: null } })}><Plus size={14} /> Nouvel employé</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', maxWidth: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Rechercher nom ou poste..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {filtered.map(e => {
          const hrs = schedules.filter(s => s.employee_id === e.id).reduce((sum, s) => sum + s.hours, 0);
          const cl = clientName(e.client_id);
          return (
            <div key={e.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openDetail(e.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={e.name} size={44} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{e.position}</div>
                  {cl && <div style={{ fontSize: 10, color: 'var(--teal)', marginTop: 2 }}>🏥 {cl}</div>}
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

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={() => openEdit(detail)}><Edit3 size={13} /> Modifier</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Poste</span><div style={{ fontWeight: 600 }}>{detail.position}</div></div>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Taux</span><div style={{ fontWeight: 600 }}>{fmtMoney(detail.rate)}/h</div></div>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Téléphone</span><div>{detail.phone || '—'}</div></div>
            <div><span style={{ fontSize: 11, color: 'var(--text3)' }}>Courriel</span><div>{detail.email || '—'}</div></div>
            <div style={{ gridColumn: '1/-1' }}><span style={{ fontSize: 11, color: 'var(--text3)' }}>Client associé</span>
              <div style={{ fontWeight: 600, color: 'var(--teal)' }}>{clientName(detail.client_id) || '— Aucun —'}</div></div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Notes</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Ajouter une note..." value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote()} />
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
          {(!detail.notes || !detail.notes.length) && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucune note</div>}
        </Modal>
      )}

      {modal && (
        <Modal title={modal.type === 'add' ? 'Nouvel employé' : `Modifier — ${modal.data.name}`} onClose={() => setModal(null)}>
          <div className="field"><label>Nom complet</label><input className="input" value={modal.data.name} onChange={e => setModal(m => ({ ...m, data: { ...m.data, name: e.target.value } }))} /></div>
          <div className="field"><label>Poste / Titre d'emploi</label><input className="input" value={modal.data.position} onChange={e => setModal(m => ({ ...m, data: { ...m.data, position: e.target.value } }))} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Téléphone</label><input className="input" value={modal.data.phone || ''} onChange={e => setModal(m => ({ ...m, data: { ...m.data, phone: e.target.value } }))} /></div>
            <div className="field"><label>Courriel</label><input className="input" value={modal.data.email || ''} onChange={e => setModal(m => ({ ...m, data: { ...m.data, email: e.target.value } }))} /></div>
          </div>
          <div className="field"><label>Taux horaire ($/h)</label><input className="input" type="number" value={modal.data.rate} step={0.01} onChange={e => setModal(m => ({ ...m, data: { ...m.data, rate: parseFloat(e.target.value) || 0 } }))} /></div>
          <div className="field">
            <label><Building size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Client associé (CISSS/CIUSSS)</label>
            <select className="input" value={modal.data.client_id || ''} onChange={e => setModal(m => ({ ...m, data: { ...m.data, client_id: Number(e.target.value) || null } }))}>
              <option value="">— Aucun client assigné —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Le client associé sera pré-rempli sur les factures.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>Annuler</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveEmployee}>{modal.type === 'add' ? 'Créer' : 'Sauvegarder'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
