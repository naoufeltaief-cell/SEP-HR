import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Avatar, Modal } from '../components/UI';
import { Plus, Search, Edit3, Users, Building, Mail } from 'lucide-react';

function portalAccessLabel(portalAccess) {
  if (!portalAccess?.enabled) return 'Aucun acces';
  if (portalAccess?.invitation_pending) return 'Invitation envoyee';
  return 'Acces actif';
}

function portalAccessStyle(portalAccess) {
  if (!portalAccess?.enabled) {
    return { background: 'var(--surface2)', color: 'var(--text3)' };
  }
  if (portalAccess?.invitation_pending) {
    return { background: 'var(--amber-l)', color: 'var(--amber)' };
  }
  return { background: 'var(--green-l)', color: 'var(--green)' };
}

export default function EmployeesPage({ toast }) {
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const reload = useCallback(async () => {
    const [emps, scheds, cls] = await Promise.all([
      api.getEmployees(),
      api.getSchedules(),
      api.getClients(),
    ]);
    setEmployees(emps || []);
    setSchedules(scheds || []);
    setClients(cls || []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = employees.filter((employee) =>
    `${employee.name.toLowerCase()} ${(employee.position || '').toLowerCase()}`.includes(
      search.toLowerCase(),
    ),
  );

  const clientName = (id) => clients.find((client) => client.id === id)?.name || '';

  const openDetail = async (id) => {
    setDetail(await api.getEmployee(id));
  };

  const addNote = async () => {
    if (!noteText.trim() || !detail) return;
    await api.addEmployeeNote(detail.id, { content: noteText });
    setNoteText('');
    setDetail(await api.getEmployee(detail.id));
    toast?.('Note ajoutee');
  };

  const openEdit = (employee) => {
    setModal({ type: 'edit', data: { ...employee } });
    setDetail(null);
  };

  const saveEmployee = async () => {
    try {
      let result;
      if (modal.type === 'add') {
        result = await api.createEmployee(modal.data);
      } else {
        result = await api.updateEmployee(modal.data.id, {
          name: modal.data.name,
          position: modal.data.position,
          phone: modal.data.phone,
          email: modal.data.email,
          rate: modal.data.rate,
          client_id: modal.data.client_id || null,
        });
      }
      const label = modal.type === 'add' ? 'Employe cree' : 'Employe mis a jour';
      toast?.(result?.portal_invited ? `${label} - invitation portail envoyee` : label);
      setModal(null);
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const sendPortalInvite = async () => {
    if (!detail?.id) return;
    try {
      setInviteLoading(true);
      await api.inviteEmployeeAccess(detail.id);
      setDetail(await api.getEmployee(detail.id));
      toast?.('Invitation portail envoyee');
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">
          <Users size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Employes ({employees.length})
        </h1>
        <button
          className="btn btn-primary btn-sm"
          onClick={() =>
            setModal({
              type: 'add',
              data: { name: '', position: '', phone: '', email: '', rate: 0, client_id: null },
            })
          }
        >
          <Plus size={14} /> Nouvel employe
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', maxWidth: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Rechercher nom ou poste..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {filtered.map((employee) => {
          const hours = schedules
            .filter((schedule) => schedule.employee_id === employee.id)
            .reduce((sum, schedule) => sum + schedule.hours, 0);
          const linkedClient = clientName(employee.client_id);
          return (
            <div key={employee.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openDetail(employee.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={employee.name} size={44} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{employee.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{employee.position}</div>
                  {linkedClient ? (
                    <div style={{ fontSize: 10, color: 'var(--teal)', marginTop: 2 }}>{linkedClient}</div>
                  ) : null}
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      marginTop: 6,
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      ...portalAccessStyle(employee.portal_access),
                    }}
                  >
                    {portalAccessLabel(employee.portal_access)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 14 }}>{hours.toFixed(1)}h</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtMoney(employee.rate)}/h</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, gap: 8 }}>
            {detail.email ? (
              <button className="btn btn-outline btn-sm" onClick={sendPortalInvite} disabled={inviteLoading}>
                <Mail size={13} /> {inviteLoading ? 'Envoi...' : 'Envoyer invitation portail'}
              </button>
            ) : null}
            <button className="btn btn-outline btn-sm" onClick={() => openEdit(detail)}>
              <Edit3 size={13} /> Modifier
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Poste</span>
              <div style={{ fontWeight: 600 }}>{detail.position}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Taux</span>
              <div style={{ fontWeight: 600 }}>{fmtMoney(detail.rate)}/h</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Telephone</span>
              <div>{detail.phone || '-'}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Courriel</span>
              <div>{detail.email || '-'}</div>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Client associe</span>
              <div style={{ fontWeight: 600, color: 'var(--teal)' }}>{clientName(detail.client_id) || '- Aucun -'}</div>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Acces portail</span>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{detail.portal_access?.enabled ? `Actif - ${detail.portal_access.email || detail.email}` : 'Aucun compte portail'}</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    ...portalAccessStyle(detail.portal_access),
                  }}
                >
                  {portalAccessLabel(detail.portal_access)}
                </span>
              </div>
            </div>
          </div>

          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Notes</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Ajouter une note..."
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addNote()}
            />
            <button className="btn btn-primary btn-sm" onClick={addNote}>Ajouter</button>
          </div>

          {(detail.notes || []).map((note) => (
            <div key={note.id} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 'var(--r)', marginBottom: 6, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>{note.author}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(note.created_at).toLocaleString('fr-CA')}</span>
              </div>
              <div style={{ marginTop: 4 }}>{note.content}</div>
            </div>
          ))}
          {(!detail.notes || !detail.notes.length) && (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucune note</div>
          )}
        </Modal>
      )}

      {modal && (
        <Modal title={modal.type === 'add' ? 'Nouvel employe' : `Modifier - ${modal.data.name}`} onClose={() => setModal(null)}>
          <div className="field">
            <label>Nom complet</label>
            <input className="input" value={modal.data.name} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, name: event.target.value } }))} />
          </div>
          <div className="field">
            <label>Poste / Titre d'emploi</label>
            <input className="input" value={modal.data.position} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, position: event.target.value } }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Telephone</label>
              <input className="input" value={modal.data.phone || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, phone: event.target.value } }))} />
            </div>
            <div className="field">
              <label>Courriel</label>
              <input className="input" value={modal.data.email || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, email: event.target.value } }))} />
            </div>
          </div>
          <div className="field">
            <label>Taux horaire ($/h)</label>
            <input className="input" type="number" value={modal.data.rate} step={0.01} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, rate: parseFloat(event.target.value) || 0 } }))} />
          </div>
          <div className="field">
            <label><Building size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Client associe (CISSS/CIUSSS)</label>
            <select className="input" value={modal.data.client_id || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, client_id: Number(event.target.value) || null } }))}>
              <option value="">- Aucun client assigne -</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Le client associe sera pre-rempli sur les factures.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>Annuler</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveEmployee}>
              {modal.type === 'add' ? 'Creer' : 'Sauvegarder'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
