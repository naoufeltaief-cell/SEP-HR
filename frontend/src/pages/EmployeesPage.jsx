import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import { fmtMoney } from '../utils/helpers';
import { Avatar, Modal } from '../components/UI';
import {
  BadgeDollarSign,
  Building,
  FileText,
  Mail,
  PencilLine,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Upload,
  Users,
} from 'lucide-react';

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

function employmentStatusLabel(status) {
  if (status === 'inactive') return 'Inactif';
  if (status === 'reactivated') return 'Reactive';
  return 'Actif';
}

function employmentStatusStyle(status) {
  if (status === 'inactive') {
    return { background: '#fff1f3', color: '#b42318' };
  }
  if (status === 'reactivated') {
    return { background: '#ecfdf3', color: '#027a48' };
  }
  return { background: 'var(--brand-xl)', color: 'var(--brand-d)' };
}

function emptyEmployeeForm() {
  return {
    name: '',
    matricule: '',
    position: '',
    phone: '',
    email: '',
    rate: 0,
    salary: 0,
    perdiem: 0,
    payroll_company: '',
    payroll_statement_number: '',
    payroll_transaction_type: '',
    payroll_division: '',
    payroll_service: '',
    payroll_department: '',
    payroll_subdepartment: '',
    client_id: null,
    is_active: true,
  };
}

function DetailField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value || '-'}</div>
    </div>
  );
}

function DocumentChip({ active, label }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: active ? '#ecfdf3' : 'var(--surface2)',
        color: active ? '#027a48' : 'var(--text3)',
      }}
    >
      {label}
    </span>
  );
}

export default function EmployeesPage({ toast }) {
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [documentFile, setDocumentFile] = useState(null);
  const [documentVisibility, setDocumentVisibility] = useState(false);
  const [documentDescription, setDocumentDescription] = useState('');
  const [documentCategory, setDocumentCategory] = useState('document');
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);
  const [sharedDocuments, setSharedDocuments] = useState([]);
  const [sharedDocumentFile, setSharedDocumentFile] = useState(null);
  const [sharedDocumentDescription, setSharedDocumentDescription] = useState('');
  const [sharedDocumentCategory, setSharedDocumentCategory] = useState('document');
  const [uploadingSharedDocument, setUploadingSharedDocument] = useState(false);
  const [sharedUploadKey, setSharedUploadKey] = useState(0);
  const [payrollImportFile, setPayrollImportFile] = useState(null);
  const [payrollImporting, setPayrollImporting] = useState(false);
  const [payrollImportKey, setPayrollImportKey] = useState(0);
  const [payrollImportReport, setPayrollImportReport] = useState(null);

  const reload = useCallback(async () => {
    const [emps, scheds, cls, sharedDocs] = await Promise.all([
      api.getEmployees({ include_inactive: true }),
      api.getSchedules(),
      api.getClients(),
      api.getSharedEmployeeDocuments().catch(() => []),
    ]);
    setEmployees(emps || []);
    setSchedules(scheds || []);
    setClients(cls || []);
    setSharedDocuments(sharedDocs || []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(
    () =>
      employees.filter((employee) => {
        const haystack = `${employee.name.toLowerCase()} ${(employee.position || '').toLowerCase()} ${(employee.matricule || '').toLowerCase()}`;
        const textMatch = haystack.includes(search.toLowerCase());
        const status = employee.employment_status?.status || 'active';
        const statusMatch = statusFilter === 'all' ? true : status === statusFilter;
        return textMatch && statusMatch;
      }),
    [employees, search, statusFilter],
  );

  const clientName = useCallback(
    (id) => clients.find((client) => client.id === id)?.name || '',
    [clients],
  );

  const hoursByEmployee = useMemo(() => {
    const map = new Map();
    for (const schedule of schedules || []) {
      map.set(
        schedule.employee_id,
        Number(map.get(schedule.employee_id) || 0) + Number(schedule.hours || 0),
      );
    }
    return map;
  }, [schedules]);

  const openDetail = async (id) => {
    try {
      setDetailLoading(true);
      const employee = await api.getEmployee(id);
      const documents = await api.getEmployeeDocuments(id).catch(() => []);
      setDetail({ ...employee, documents });
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = useCallback(async (employeeId) => {
    if (!employeeId) return;
    const employee = await api.getEmployee(employeeId);
    const documents = await api.getEmployeeDocuments(employeeId).catch(() => []);
    setDetail({ ...employee, documents });
  }, []);

  const resetDocumentForm = () => {
    setDocumentFile(null);
    setDocumentVisibility(false);
    setDocumentDescription('');
    setDocumentCategory('document');
    setUploadKey((current) => current + 1);
  };

  const resetSharedDocumentForm = () => {
    setSharedDocumentFile(null);
    setSharedDocumentDescription('');
    setSharedDocumentCategory('document');
    setSharedUploadKey((current) => current + 1);
  };

  const resetPayrollImportForm = () => {
    setPayrollImportFile(null);
    setPayrollImportKey((current) => current + 1);
  };

  const addNote = async () => {
    if (!noteText.trim() || !detail) return;
    await api.addEmployeeNote(detail.id, { content: noteText });
    setNoteText('');
    await refreshDetail(detail.id);
    toast?.('Note ajoutee');
  };

  const openEdit = (employee) => {
    setModal({
      type: 'edit',
      data: {
        id: employee.id,
        name: employee.name || '',
        matricule: employee.matricule || '',
        position: employee.position || '',
        phone: employee.phone || '',
        email: employee.email || '',
        rate: Number(employee.rate || 0),
        salary: Number(employee.salary || 0),
        perdiem: Number(employee.perdiem || 0),
        payroll_company: employee.payroll_company || '',
        payroll_statement_number: employee.payroll_statement_number || '',
        payroll_transaction_type: employee.payroll_transaction_type || '',
        payroll_division: employee.payroll_division || '',
        payroll_service: employee.payroll_service || '',
        payroll_department: employee.payroll_department || '',
        payroll_subdepartment: employee.payroll_subdepartment || '',
        client_id: employee.client_id || null,
        is_active: employee.is_active !== false,
      },
    });
  };

  const saveEmployee = async () => {
    try {
      const payload = {
        name: modal.data.name,
        matricule: modal.data.matricule,
        position: modal.data.position,
        phone: modal.data.phone,
        email: modal.data.email,
        rate: Number(modal.data.rate || 0),
        salary: Number(modal.data.salary || 0),
        perdiem: Number(modal.data.perdiem || 0),
        payroll_company: modal.data.payroll_company || '',
        payroll_statement_number: modal.data.payroll_statement_number || '',
        payroll_transaction_type: modal.data.payroll_transaction_type || '',
        payroll_division: modal.data.payroll_division || '',
        payroll_service: modal.data.payroll_service || '',
        payroll_department: modal.data.payroll_department || '',
        payroll_subdepartment: modal.data.payroll_subdepartment || '',
        client_id: modal.data.client_id || null,
        is_active: Boolean(modal.data.is_active),
      };
      let result;
      if (modal.type === 'add') {
        result = await api.createEmployee(payload);
      } else {
        result = await api.updateEmployee(modal.data.id, payload);
      }
      const label = modal.type === 'add' ? 'Employe cree' : 'Employe mis a jour';
      if (result?.portal_invite_error) {
        toast?.(`${label} - invitation portail non envoyee: ${result.portal_invite_error}`);
      } else {
        toast?.(result?.portal_invited ? `${label} - invitation portail envoyee` : label);
      }
      setModal(null);
      await reload();
      if (detail?.id && Number(detail.id) === Number(result?.id || modal.data.id)) {
        await refreshDetail(Number(result?.id || modal.data.id));
      }
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const sendPortalInvite = async () => {
    if (!detail?.id) return;
    try {
      setInviteLoading(true);
      await api.inviteEmployeeAccess(detail.id);
      await refreshDetail(detail.id);
      toast?.('Invitation portail envoyee');
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const toggleEmployeeStatus = async (employee) => {
    if (!employee?.id) return;
    const isActive = employee.employment_status?.status !== 'inactive';
    const confirmed = window.confirm(
      isActive
        ? `Desactiver ${employee.name} ? Son acces portail sera aussi suspendu.`
        : `Reactiver ${employee.name} ?`,
    );
    if (!confirmed) return;
    try {
      if (isActive) await api.deactivateEmployee(employee.id);
      else await api.reactivateEmployee(employee.id);
      toast?.(isActive ? 'Employe desactive' : 'Employe reactive');
      await reload();
      if (detail?.id === employee.id) await refreshDetail(employee.id);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const uploadEmployeeDocument = async () => {
    if (!detail?.id || !documentFile) {
      toast?.('Selectionne un document');
      return;
    }
    try {
      setUploadingDocument(true);
      await api.uploadEmployeeDocument(
        detail.id,
        documentFile,
        documentCategory,
        documentDescription,
        documentVisibility,
      );
      toast?.('Document ajoute');
      resetDocumentForm();
      await refreshDetail(detail.id);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setUploadingDocument(false);
    }
  };

  const replaceEmployeeDocument = async (document, file) => {
    if (!detail?.id || !document?.id || !file) return;
    try {
      await api.replaceEmployeeDocument(
        detail.id,
        document.id,
        file,
        document.category || 'document',
        document.description || '',
        Boolean(document.visible_to_employee),
      );
      toast?.('Document remplace');
      await refreshDetail(detail.id);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const deleteEmployeeDocument = async (document) => {
    if (!detail?.id || !document?.id) return;
    if (!window.confirm(`Supprimer ${document.original_filename || document.filename} ?`)) return;
    try {
      await api.deleteEmployeeDocument(detail.id, document.id);
      toast?.('Document supprime');
      await refreshDetail(detail.id);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const uploadSharedDocument = async () => {
    if (!sharedDocumentFile) {
      toast?.('Selectionne un document a partager');
      return;
    }
    try {
      setUploadingSharedDocument(true);
      await api.uploadSharedEmployeeDocument(
        sharedDocumentFile,
        sharedDocumentCategory,
        sharedDocumentDescription,
      );
      toast?.('Document partage a tous les employes actifs');
      resetSharedDocumentForm();
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setUploadingSharedDocument(false);
    }
  };

  const replaceSharedDocument = async (document, file) => {
    if (!document?.id || !file) return;
    try {
      await api.replaceSharedEmployeeDocument(
        document.id,
        file,
        document.category || 'document',
        document.description || '',
      );
      toast?.('Document partage remplace');
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const deleteSharedDocument = async (document) => {
    if (!document?.id) return;
    if (!window.confirm(`Supprimer ${document.original_filename || document.filename} pour tous les employes actifs ?`)) return;
    try {
      await api.deleteSharedEmployeeDocument(document.id);
      toast?.('Document partage supprime');
      await reload();
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    }
  };

  const importDesjardinsMatricules = async () => {
    if (!payrollImportFile) {
      toast?.('Selectionne la liste Desjardins a importer');
      return;
    }
    try {
      setPayrollImporting(true);
      const report = await api.importDesjardinsMatricules(payrollImportFile);
      setPayrollImportReport(report);
      resetPayrollImportForm();
      await reload();
      const warnings = [];
      if (report.unmatched_rows?.length) warnings.push(`${report.unmatched_rows.length} non correspondance(s)`);
      if (report.ambiguous_rows?.length) warnings.push(`${report.ambiguous_rows.length} correspondance(s) ambigue(s)`);
      toast?.(
        `Import Desjardins termine - ${report.updated_employees || 0} profil(s) mis a jour`
        + (warnings.length ? ` (${warnings.join(', ')})` : '')
      );
      if (detail?.id) await refreshDetail(detail.id);
    } catch (err) {
      toast?.('Erreur: ' + err.message);
    } finally {
      setPayrollImporting(false);
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
          onClick={() => setModal({ type: 'add', data: emptyEmployeeForm() })}
        >
          <Plus size={14} /> Nouvel employe
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', maxWidth: 320, flex: '1 1 260px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Rechercher nom, poste ou matricule..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ maxWidth: 220 }}>
          <option value="all">Tous les statuts</option>
          <option value="active">Actifs</option>
          <option value="reactivated">Reactives</option>
          <option value="inactive">Inactifs</option>
        </select>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--brand-d)', marginBottom: 6 }}>
              Documents partages a tous les employes actifs
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>
              Un seul ajout ici rend le document visible dans le portail employe de toute personne active.
            </div>
            <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
              <input key={sharedUploadKey} className="input" type="file" onChange={(event) => setSharedDocumentFile(event.target.files?.[0] || null)} />
              <select className="input" value={sharedDocumentCategory} onChange={(event) => setSharedDocumentCategory(event.target.value)}>
                <option value="document">Document</option>
                <option value="guide-employe">Guide employe</option>
                <option value="paie">Calendrier de paie</option>
                <option value="fdt">Feuille de temps</option>
                <option value="autre">Autre</option>
              </select>
              <input className="input" placeholder="Description" value={sharedDocumentDescription} onChange={(event) => setSharedDocumentDescription(event.target.value)} />
              <div>
                <button className="btn btn-primary btn-sm" onClick={uploadSharedDocument} disabled={uploadingSharedDocument}>
                  <Upload size={13} /> {uploadingSharedDocument ? 'Partage...' : 'Partager a tous les employes actifs'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Documents actuellement partages</div>
            {sharedDocuments.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {sharedDocuments.map((document) => (
                  <div key={document.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '10px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700 }}>{document.original_filename || document.filename}</div>
                        <DocumentChip active label="Tous les employes actifs" />
                        <DocumentChip active label={document.category || 'document'} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                        {document.description || 'Sans description'} • {document.created_at?.slice(0, 10) || '-'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => api.downloadSharedEmployeeDocument(document.id, document.original_filename || document.filename || 'document')}>
                        <FileText size={13} /> Ouvrir
                      </button>
                      <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                        Remplacer
                        <input
                          type="file"
                          style={{ display: 'none' }}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) replaceSharedDocument(document, file);
                            event.target.value = '';
                          }}
                        />
                      </label>
                      <button className="btn btn-outline btn-sm" onClick={() => deleteSharedDocument(document)}>
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucun document partage pour le moment.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--brand-d)', marginBottom: 6 }}>
              Import des matricules Desjardins
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>
              Importe la liste officielle de la banque Desjardins pour mettre a jour les matricules et la division paie des employes correspondants.
            </div>
            <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
              <input
                key={payrollImportKey}
                className="input"
                type="file"
                accept=".xlsx,.csv"
                onChange={(event) => setPayrollImportFile(event.target.files?.[0] || null)}
              />
              <div>
                <button className="btn btn-primary btn-sm" onClick={importDesjardinsMatricules} disabled={payrollImporting}>
                  <Upload size={13} /> {payrollImporting ? 'Import...' : 'Importer la liste Desjardins'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Dernier rapport d'import</div>
            {payrollImportReport ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                  Fichier: <strong>{payrollImportReport.filename}</strong>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <DocumentChip active label={`${payrollImportReport.total_rows || 0} ligne(s)`} />
                  <DocumentChip active label={`${payrollImportReport.matched_rows || 0} correspondance(s)`} />
                  <DocumentChip active label={`${payrollImportReport.updated_employees || 0} profil(s) mis a jour`} />
                  <DocumentChip active label={`Compagnie ${payrollImportReport.default_company || '254981'}`} />
                </div>
                {!!payrollImportReport.unmatched_rows?.length && (
                  <div style={{ fontSize: 12, color: '#9a3412' }}>
                    Non trouves: {payrollImportReport.unmatched_rows.slice(0, 5).map((item) => item.name).join(', ')}
                    {payrollImportReport.unmatched_rows.length > 5 ? '...' : ''}
                  </div>
                )}
                {!!payrollImportReport.ambiguous_rows?.length && (
                  <div style={{ fontSize: 12, color: '#9a3412' }}>
                    Ambigus: {payrollImportReport.ambiguous_rows.slice(0, 3).map((item) => item.name).join(', ')}
                    {payrollImportReport.ambiguous_rows.length > 3 ? '...' : ''}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>
                Aucun import Desjardins lance depuis cette session.
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {filtered.map((employee) => {
          const hours = Number(hoursByEmployee.get(employee.id) || 0);
          const linkedClient = clientName(employee.client_id);
          const employmentStatus = employee.employment_status?.status || 'active';
          return (
            <div key={employee.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openDetail(employee.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={employee.name} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{employee.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{employee.position || 'Poste a confirmer'}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        ...employmentStatusStyle(employmentStatus),
                      }}
                    >
                      {employmentStatusLabel(employmentStatus)}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        ...portalAccessStyle(employee.portal_access),
                      }}
                    >
                      {portalAccessLabel(employee.portal_access)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
                    <span>Matricule: {employee.matricule || '-'}</span>
                    {linkedClient ? <span>{linkedClient}</span> : null}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 14 }}>{hours.toFixed(1)} h</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtMoney(employee.rate)}/h</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    Salaire {fmtMoney(employee.salary)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          {detailLoading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Chargement...</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      ...employmentStatusStyle(detail.employment_status?.status || 'active'),
                    }}
                  >
                    {employmentStatusLabel(detail.employment_status?.status || 'active')}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      ...portalAccessStyle(detail.portal_access),
                    }}
                  >
                    {portalAccessLabel(detail.portal_access)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detail.email ? (
                    <button className="btn btn-outline btn-sm" onClick={sendPortalInvite} disabled={inviteLoading}>
                      <Mail size={13} /> {inviteLoading ? 'Envoi...' : 'Envoyer invitation portail'}
                    </button>
                  ) : null}
                  <button className="btn btn-outline btn-sm" onClick={() => openEdit(detail)}>
                    <PencilLine size={13} /> Modifier
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => toggleEmployeeStatus(detail)}
                  >
                    {detail.employment_status?.status === 'inactive' ? (
                      <>
                        <ShieldCheck size={13} /> Reactiver
                      </>
                    ) : (
                      <>
                        <ShieldOff size={13} /> Desactiver
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, marginBottom: 22 }}>
                <DetailField label="Matricule employe" value={detail.matricule} />
                <DetailField label="Poste" value={detail.position} />
                <DetailField label="Client par defaut" value={clientName(detail.client_id) || '- Aucun -'} />
                <DetailField label="Courriel" value={detail.email} />
                <DetailField label="Telephone" value={detail.phone} />
                <DetailField label="Acces portail" value={detail.portal_access?.enabled ? detail.portal_access.email || detail.email : 'Aucun compte portail'} />
                <DetailField label="Taux horaire" value={`${fmtMoney(detail.rate)}/h`} />
                <DetailField label="Salaire" value={fmtMoney(detail.salary)} />
                <DetailField label="Per diem" value={fmtMoney(detail.perdiem)} />
              </div>

              <div style={{ marginBottom: 22 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Profil paie / Export</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
                  <DetailField label="Compagnie" value={detail.payroll_company} />
                  <DetailField label="No releve" value={detail.payroll_statement_number} />
                  <DetailField label="Type transaction" value={detail.payroll_transaction_type} />
                  <DetailField label="Division" value={detail.payroll_division} />
                  <DetailField label="Service" value={detail.payroll_service} />
                  <DetailField label="Departement" value={detail.payroll_department} />
                  <DetailField label="Sous-departement" value={detail.payroll_subdepartment} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 18 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Notes internes</div>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontWeight: 600 }}>{note.author}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(note.created_at).toLocaleString('fr-CA')}</span>
                      </div>
                      <div style={{ marginTop: 4 }}>{note.content}</div>
                    </div>
                  ))}
                  {(!detail.notes || !detail.notes.length) && (
                    <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucune note</div>
                  )}
                </div>

                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Ajouter un document individuel au dossier</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <input key={uploadKey} className="input" type="file" onChange={(event) => setDocumentFile(event.target.files?.[0] || null)} />
                    <select className="input" value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value)}>
                      <option value="document">Document</option>
                      <option value="guide-employe">Guide employe</option>
                      <option value="paie">Calendrier de paie</option>
                      <option value="fdt">Feuille de temps</option>
                      <option value="autre">Autre</option>
                    </select>
                    <input className="input" placeholder="Description" value={documentDescription} onChange={(event) => setDocumentDescription(event.target.value)} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
                      <input type="checkbox" checked={documentVisibility} onChange={(event) => setDocumentVisibility(event.target.checked)} />
                      Visible uniquement pour cet employe dans son portail
                    </label>
                    <button className="btn btn-primary btn-sm" onClick={uploadEmployeeDocument} disabled={uploadingDocument}>
                      <Upload size={13} /> {uploadingDocument ? 'Ajout...' : 'Ajouter le document'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 22 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Documents individuels du dossier</div>
                {detail.documents?.length ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {detail.documents.map((document) => (
                      <div key={document.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '10px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                            <div style={{ fontWeight: 700 }}>{document.original_filename || document.filename}</div>
                            <DocumentChip active={Boolean(document.visible_to_employee)} label={document.visible_to_employee ? 'Visible employe' : 'Interne admin'} />
                            <DocumentChip active label={document.category || 'document'} />
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                            {document.description || 'Sans description'} • {document.created_at?.slice(0, 10) || '-'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => api.downloadEmployeeDocument(detail.id, document.id, document.original_filename || document.filename || 'document')}>
                            <FileText size={13} /> Ouvrir
                          </button>
                          <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                            Remplacer
                            <input
                              type="file"
                              style={{ display: 'none' }}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) replaceEmployeeDocument(document, file);
                                event.target.value = '';
                              }}
                            />
                          </label>
                          <button className="btn btn-outline btn-sm" onClick={() => deleteEmployeeDocument(document)}>
                            Supprimer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text3)', fontSize: 13 }}>Aucun document dans le dossier.</div>
                )}
              </div>
            </>
          )}
        </Modal>
      )}

      {modal && (
        <Modal title={modal.type === 'add' ? 'Nouvel employe' : `Modifier - ${modal.data.name}`} onClose={() => setModal(null)} wide>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12 }}>
              <div className="field">
                <label>Nom complet</label>
                <input className="input" value={modal.data.name} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, name: event.target.value } }))} />
              </div>
              <div className="field">
                <label>Matricule employe</label>
                <input className="input" value={modal.data.matricule || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, matricule: event.target.value } }))} />
              </div>
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <div className="field">
                <label>Taux horaire ($/h)</label>
                <input className="input" type="number" step="0.01" value={modal.data.rate} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, rate: parseFloat(event.target.value) || 0 } }))} />
              </div>
              <div className="field">
                <label>Salaire</label>
                <input className="input" type="number" step="0.01" value={modal.data.salary} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, salary: parseFloat(event.target.value) || 0 } }))} />
              </div>
              <div className="field">
                <label>Per diem</label>
                <input className="input" type="number" step="0.01" value={modal.data.perdiem} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, perdiem: parseFloat(event.target.value) || 0 } }))} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Profil paie / Export Desjardins</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Compagnie</label>
                  <input className="input" value={modal.data.payroll_company || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, payroll_company: event.target.value } }))} />
                </div>
                <div className="field">
                  <label>No releve</label>
                  <input className="input" value={modal.data.payroll_statement_number || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, payroll_statement_number: event.target.value } }))} />
                </div>
                <div className="field">
                  <label>Type transaction</label>
                  <input className="input" value={modal.data.payroll_transaction_type || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, payroll_transaction_type: event.target.value } }))} />
                </div>
                <div className="field">
                  <label>Division</label>
                  <input className="input" value={modal.data.payroll_division || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, payroll_division: event.target.value } }))} />
                </div>
                <div className="field">
                  <label>Service</label>
                  <input className="input" value={modal.data.payroll_service || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, payroll_service: event.target.value } }))} />
                </div>
                <div className="field">
                  <label>Departement</label>
                  <input className="input" value={modal.data.payroll_department || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, payroll_department: event.target.value } }))} />
                </div>
                <div className="field">
                  <label>Sous-departement</label>
                  <input className="input" value={modal.data.payroll_subdepartment || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, payroll_subdepartment: event.target.value } }))} />
                </div>
              </div>
            </div>

            <div className="field">
              <label><Building size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Client associe (CISSS/CIUSSS)</label>
              <select className="input" value={modal.data.client_id || ''} onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, client_id: Number(event.target.value) || null } }))}>
                <option value="">- Aucun client assigne -</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                Le client associe sera pre-rempli sur les flux employe / horaire / facturation quand pertinent.
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={Boolean(modal.data.is_active)}
                onChange={(event) => setModal((current) => ({ ...current, data: { ...current.data, is_active: event.target.checked } }))}
              />
              Employe actif
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveEmployee}>
                {modal.type === 'add' ? 'Creer' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
