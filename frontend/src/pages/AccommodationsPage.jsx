import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { fmtMoney, fmtISO } from '../utils/helpers';
import { Modal, Avatar } from '../components/UI';
import {
  BedDouble,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Paperclip,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';

function weekKey(dateStr) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - date.getDay());
  return fmtISO(date);
}

function groupAccommodations(items, mode = 'month') {
  const grouped = {};
  (items || []).forEach((item) => {
    const key = mode === 'month' ? String(item.start_date || '').slice(0, 7) : weekKey(item.start_date);
    if (!key) return;
    if (!grouped[key]) {
      grouped[key] = {
        key,
        accommodationCount: 0,
        documentCount: 0,
        totalCost: 0,
        employeeCount: 0,
        employeeIds: new Set(),
      };
    }
    grouped[key].accommodationCount += 1;
    grouped[key].documentCount += Number(item.attachment_count || 0);
    grouped[key].totalCost += Number(item.total_cost || 0);
    grouped[key].employeeIds.add(item.employee_id);
  });
  return Object.values(grouped)
    .map((item) => ({
      ...item,
      employeeCount: item.employeeIds.size,
      totalCost: Math.round(item.totalCost * 100) / 100,
    }))
    .sort((a, b) => String(b.key).localeCompare(String(a.key)));
}

function reminderBadge(reminderStatus) {
  switch (String(reminderStatus || 'scheduled')) {
    case 'sent':
      return { label: 'Rappel envoye', background: '#ecfdf3', color: '#027a48' };
    case 'cancelled':
      return { label: 'Rappel annule', background: '#fef3f2', color: '#b42318' };
    case 'error':
      return { label: 'Erreur rappel', background: '#fff7ed', color: '#c2410c' };
    default:
      return { label: 'Rappel planifie', background: 'var(--brand-xl)', color: 'var(--brand)' };
  }
}

export default function AccommodationsPage({ toast }) {
  const [accommodations, setAccommodations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState({});
  const [attachmentsByAccommodation, setAttachmentsByAccommodation] = useState({});
  const [loadingAttachmentIds, setLoadingAttachmentIds] = useState({});
  const [modalAttachments, setModalAttachments] = useState([]);
  const [uploadingAccommodationId, setUploadingAccommodationId] = useState(null);

  const loadSupportData = useCallback(async () => {
    const [employeesResult, schedulesResult] = await Promise.allSettled([
      api.getEmployees(),
      api.getSchedules(),
    ]);
    setEmployees(employeesResult.status === 'fulfilled' ? employeesResult.value || [] : []);
    setSchedules(schedulesResult.status === 'fulfilled' ? schedulesResult.value || [] : []);
    if (employeesResult.status !== 'fulfilled' || schedulesResult.status !== 'fulfilled') {
      toast?.("Hebergement charge avec donnees partielles. Les calculs automatiques peuvent etre limites.");
    }
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const accommodationsData = await api.getAccommodations();
      setAccommodations(accommodationsData || []);
      await loadSupportData();
    } catch (err) {
      toast?.(`Erreur: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [loadSupportData, toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  const empName = (id) => employees.find((employee) => employee.id === id)?.name || `#${id}`;

  const totalAccommodationCost = accommodations.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
  const totalDocuments = accommodations.reduce((sum, item) => sum + Number(item.attachment_count || 0), 0);
  const monthSummary = useMemo(() => groupAccommodations(accommodations, 'month').slice(0, 6), [accommodations]);
  const weekSummary = useMemo(() => groupAccommodations(accommodations, 'week').slice(0, 6), [accommodations]);

  const autoCalc = useMemo(() => {
    if (!modal) return null;
    const { employee_id, start_date, end_date, total_cost } = modal;
    if (!employee_id || !start_date || !end_date) {
      return { shifts: 0, days: 0, message: 'Selectionnez un employe et les dates.' };
    }

    const matchingShifts = schedules.filter(
      (schedule) =>
        schedule.employee_id === Number(employee_id) &&
        schedule.date >= start_date &&
        schedule.date <= end_date
    );
    const uniqueDates = [...new Set(matchingShifts.map((schedule) => schedule.date))];
    const employee = employees.find((item) => item.id === Number(employee_id));
    const shiftCount = matchingShifts.length;
    const dayCount = uniqueDates.length;

    if (!shiftCount) {
      return {
        shifts: 0,
        days: 0,
        message: 'Aucun quart trouve pour cet employe dans cette periode.',
      };
    }

    const costPerDay = total_cost > 0 && dayCount > 0 ? Math.round((total_cost / dayCount) * 100) / 100 : 0;
    return {
      shifts: shiftCount,
      days: dayCount,
      costPerDay,
      message: `${employee?.name || '?'} a ${shiftCount} quart(s) sur ${dayCount} jour(s) entre ${start_date} et ${end_date}.`,
      calcText:
        total_cost > 0
          ? `${fmtMoney(total_cost)} / ${dayCount} jour(s) = ${fmtMoney(costPerDay)} / jour`
          : 'Entrez le cout total pour voir le calcul automatique.',
    };
  }, [modal, schedules, employees]);

  const loadAttachments = useCallback(
    async (accommodationId, { syncModal = false } = {}) => {
      try {
        setLoadingAttachmentIds((prev) => ({ ...prev, [accommodationId]: true }));
        const data = await api.getAccommodationAttachments(accommodationId);
        const attachments = data || [];
        setAttachmentsByAccommodation((prev) => ({ ...prev, [accommodationId]: attachments }));
        if (syncModal) {
          setModalAttachments(attachments);
        }
        return attachments;
      } catch (err) {
        if (syncModal) {
          setModalAttachments([]);
        }
        toast?.(`Erreur: ${err.message}`);
        return [];
      } finally {
        setLoadingAttachmentIds((prev) => ({ ...prev, [accommodationId]: false }));
      }
    },
    [toast]
  );

  const openAdd = () => {
    if (!employees.length || !schedules.length) {
      loadSupportData();
    }
    setModalAttachments([]);
    setModal({
      employee_id: '',
      total_cost: 0,
      start_date: '',
      end_date: '',
      days_worked: 0,
      cost_per_day: 0,
      notes: '',
      reminder_enabled: true,
      id: null,
    });
  };

  const openEdit = async (accommodation) => {
    if (!employees.length || !schedules.length) {
      await loadSupportData();
    }
    setModalAttachments([]);
    setModal({
      id: accommodation.id,
      employee_id: String(accommodation.employee_id || ''),
      total_cost: Number(accommodation.total_cost || 0),
      start_date: accommodation.start_date || '',
      end_date: accommodation.end_date || '',
      days_worked: Number(accommodation.days_worked || 0),
      cost_per_day: Number(accommodation.cost_per_day || 0),
      notes: accommodation.notes || '',
      reminder_enabled: accommodation.reminder_enabled !== false,
    });
    await loadAttachments(accommodation.id, { syncModal: true });
  };

  const toggleExpand = async (accommodationId) => {
    const nextExpanded = !expandedRows[accommodationId];
    setExpandedRows((prev) => ({ ...prev, [accommodationId]: nextExpanded }));
    if (nextExpanded && !attachmentsByAccommodation[accommodationId]) {
      await loadAttachments(accommodationId);
    }
  };

  const deleteAccommodation = async (id) => {
    if (!confirm('Supprimer cet hebergement ?')) return;
    try {
      await api.deleteAccommodation(id);
      toast?.('Hebergement supprime');
      setAttachmentsByAccommodation((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      reload();
    } catch (err) {
      toast?.(`Erreur: ${err.message}`);
    }
  };

  const saveAccommodation = async () => {
    if (!modal.employee_id || !modal.start_date || !modal.end_date || !modal.total_cost) {
      toast?.('Remplir tous les champs obligatoires');
      return;
    }

    const autoDaysWorked = Number(autoCalc?.days || 0);
    const manualDaysWorked = Number(modal.days_worked || 0);
    const daysWorked = autoDaysWorked || manualDaysWorked;
    if (daysWorked === 0) {
      toast?.('Indique au moins un jour travaille ou choisis une periode avec des quarts');
      return;
    }

    const manualCostPerDay = Number(modal.cost_per_day || 0);
    const costPerDay =
      autoDaysWorked > 0
        ? Math.round((Number(modal.total_cost) / daysWorked) * 100) / 100
        : manualCostPerDay > 0
          ? Math.round(manualCostPerDay * 100) / 100
          : Math.round((Number(modal.total_cost) / daysWorked) * 100) / 100;
    try {
      const payload = {
        ...modal,
        employee_id: Number(modal.employee_id),
        days_worked: daysWorked,
        cost_per_day: costPerDay,
        reminder_enabled: modal.reminder_enabled !== false,
      };
      const saved = modal.id
        ? await api.updateAccommodation(modal.id, payload)
        : await api.createAccommodation(payload);
      toast?.(
        modal.id
          ? `Hebergement mis a jour - ${fmtMoney(costPerDay)}/jour x ${daysWorked} jour(s)`
          : `Hebergement ajoute - ${fmtMoney(costPerDay)}/jour x ${daysWorked} jour(s)`
      );
      setModal((prev) => ({
        ...prev,
        id: saved.id,
        days_worked: daysWorked,
        cost_per_day: costPerDay,
      }));
      await reload();
      await loadAttachments(saved.id, { syncModal: true });
    } catch (err) {
      toast?.(`Erreur: ${err.message}`);
    }
  };

  const toggleReminder = async (accommodation) => {
    try {
      if (accommodation.reminder_status === 'cancelled' || accommodation.reminder_enabled === false) {
        await api.reactivateAccommodationReminder(accommodation.id);
        toast?.('Rappel reactive');
      } else {
        await api.cancelAccommodationReminder(accommodation.id);
        toast?.('Rappel annule');
      }
      await reload();
      if (modal?.id === accommodation.id) {
        await openEdit({ ...accommodation, id: accommodation.id });
      }
    } catch (err) {
      toast?.(`Erreur: ${err.message}`);
    }
  };

  const uploadAttachment = async (accommodationId, file, { syncModal = false } = {}) => {
    if (!file || !accommodationId) return;
    try {
      setUploadingAccommodationId(accommodationId);
      await api.uploadAccommodationAttachment(accommodationId, file, 'hebergement', file.name);
      toast?.("Piece jointe d'hebergement ajoutee");
      await loadAttachments(accommodationId, { syncModal });
      await reload();
    } catch (err) {
      toast?.(`Erreur: ${err.message}`);
    } finally {
      setUploadingAccommodationId(null);
    }
  };

  const deleteAttachment = async (accommodationId, attachmentId, { syncModal = false } = {}) => {
    try {
      await api.deleteAccommodationAttachment(accommodationId, attachmentId);
      toast?.('Piece jointe supprimee');
      await loadAttachments(accommodationId, { syncModal });
      await reload();
    } catch (err) {
      toast?.(`Erreur: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
        Chargement...
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">
          <BedDouble size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Hebergement
        </h1>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={14} /> Ajouter
        </button>
      </div>

      <div className="stats-row" style={{ marginBottom: 16 }}>
        <div className="stat-card" style={{ background: 'var(--purple-l)', padding: '10px 14px', minWidth: 140 }}>
          <div className="label" style={{ color: 'var(--purple)', fontSize: 10 }}>Hebergements</div>
          <div className="value" style={{ color: 'var(--purple)', fontSize: 18 }}>{accommodations.length}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '10px 14px', minWidth: 140 }}>
          <div className="label" style={{ color: 'var(--brand)', fontSize: 10 }}>Documents</div>
          <div className="value" style={{ color: 'var(--brand)', fontSize: 18 }}>{totalDocuments}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--green-l)', padding: '10px 14px', minWidth: 180 }}>
          <div className="label" style={{ color: 'var(--green)', fontSize: 10 }}>Total hebergement</div>
          <div className="value" style={{ color: 'var(--green)', fontSize: 18 }}>{fmtMoney(totalAccommodationCost)}</div>
        </div>
      </div>

      {(monthSummary.length > 0 || weekSummary.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Resume hebergement par mois</div>
            {monthSummary.map((item) => (
              <div
                key={item.key}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}
              >
                <span>{item.key}</span>
                <strong>
                  {item.accommodationCount} dossier(s) - {item.documentCount} doc - {fmtMoney(item.totalCost)}
                </strong>
              </div>
            ))}
          </div>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Resume hebergement par semaine</div>
            {weekSummary.map((item) => (
              <div
                key={item.key}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}
              >
                <span>{item.key}</span>
                <strong>
                  {item.accommodationCount} dossier(s) - {item.documentCount} doc - {fmtMoney(item.totalCost)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {accommodations.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
          <p style={{ marginBottom: 4 }}>Aucun hebergement enregistre</p>
          <p style={{ fontSize: 12 }}>Ajoute un hebergement pour un employe en region eloignee.</p>
        </div>
      )}

      {accommodations.map((accommodation) => {
        const isExpanded = !!expandedRows[accommodation.id];
        const attachments = attachmentsByAccommodation[accommodation.id] || [];
        const attachmentCount = Number(accommodation.attachment_count || attachments.length || 0);
        const reminderMeta = reminderBadge(accommodation.reminder_status);

        return (
          <div key={accommodation.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={empName(accommodation.employee_id)} size={38} bg="var(--purple-l)" color="var(--purple)" />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{empName(accommodation.employee_id)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {accommodation.start_date} au {accommodation.end_date} - {accommodation.days_worked} jour(s) travaille(s)
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {attachmentCount > 0 && (
                  <span className="badge" style={{ background: 'var(--brand-xl)', color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Paperclip size={11} /> {attachmentCount}
                  </span>
                )}
                <span className="badge" style={{ background: reminderMeta.background, color: reminderMeta.color }}>
                  {reminderMeta.label}
                </span>
                <div style={{ textAlign: 'right', minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--purple)' }}>{fmtMoney(accommodation.total_cost)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {fmtMoney(accommodation.cost_per_day)}/jour
                    {accommodation.reminder_scheduled_for ? ` • rappel ${accommodation.reminder_scheduled_for}` : ''}
                  </div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => toggleExpand(accommodation.id)}>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  Details
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => openEdit(accommodation)}>
                  Lier employe
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => toggleReminder(accommodation)}>
                  {accommodation.reminder_status === 'cancelled' || accommodation.reminder_enabled === false ? 'Reactiver rappel' : 'Annuler rappel'}
                </button>
                <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteAccommodation(accommodation.id)}>
                  <Trash2 size={14} /> Supprimer
                </button>
              </div>
            </div>

            {(accommodation.pdf_name || accommodation.notes) && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>
                {accommodation.pdf_name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: accommodation.notes ? 4 : 0 }}>
                    <FileText size={13} style={{ color: 'var(--brand)' }} />
                    <span>{accommodation.pdf_name}</span>
                  </div>
                )}
                {accommodation.notes && <div>{accommodation.notes}</div>}
              </div>
            )}

            {isExpanded && (
              <div style={{ marginTop: 12, background: 'var(--surface2)', borderRadius: 'var(--r)', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>Documents hebergement ({attachmentCount})</div>
                  <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                    {uploadingAccommodationId === accommodation.id ? 'Televersement...' : 'Ajouter document'}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.gif"
                      style={{ display: 'none' }}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        await uploadAttachment(accommodation.id, file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {loadingAttachmentIds[accommodation.id] && (
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Chargement des documents...</div>
                )}

                {!loadingAttachmentIds[accommodation.id] && attachments.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    Aucun document d&apos;hebergement rattache a ce dossier.
                  </div>
                )}

                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <FileText size={14} style={{ color: 'var(--brand)' }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{attachment.filename}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                          {(attachment.description || attachment.category || 'Document').trim()} - {attachment.created_at?.slice(0, 10) || '-'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ padding: '2px 8px' }}
                        onClick={async () => {
                          try {
                            await api.openAccommodationAttachment(
                              accommodation.id,
                              attachment.id,
                              attachment.original_filename || attachment.filename || 'hebergement'
                            );
                          } catch (err) {
                            toast?.(`Erreur: ${err.message}`);
                          }
                        }}
                      >
                        <Eye size={12} />
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ padding: '2px 8px' }}
                        onClick={() => deleteAttachment(accommodation.id, attachment.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {modal && (
        <Modal title={modal.id ? "Modifier / lier un hebergement" : "Ajouter un hebergement"} onClose={() => setModal(null)}>
          <div className="field">
            <label>Employe</label>
            <select
              className="input"
              value={modal.employee_id}
              onChange={(event) => setModal((prev) => ({ ...prev, employee_id: event.target.value }))}
            >
              <option value="">Choisir...</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Date debut</label>
              <input
                type="date"
                className="input"
                value={modal.start_date}
                onChange={(event) => setModal((prev) => ({ ...prev, start_date: event.target.value }))}
              />
            </div>
            <div className="field">
              <label>Date fin</label>
              <input
                type="date"
                className="input"
                value={modal.end_date}
                onChange={(event) => setModal((prev) => ({ ...prev, end_date: event.target.value }))}
              />
            </div>
          </div>

          <div className="field">
            <label>Cout total hebergement ($)</label>
            <input
              type="number"
              className="input"
              min={0}
              step={0.01}
              placeholder="Ex: 1200.00"
              value={modal.total_cost || ''}
              onChange={(event) => setModal((prev) => ({ ...prev, total_cost: parseFloat(event.target.value) || 0 }))}
            />
          </div>

          <div style={{ background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 14, marginBottom: 16, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <strong style={{ color: 'var(--brand)' }}>Calcul automatique base sur les jours travailles</strong>
              <span className="badge" style={{ background: 'var(--brand-l)', color: 'var(--brand)' }}>
                {autoCalc?.days > 0 ? `${autoCalc.days} jour(s)` : '-'}
              </span>
            </div>
            <div style={{ color: autoCalc?.days === 0 ? 'var(--red)' : 'var(--text2)' }}>{autoCalc?.message}</div>
            {autoCalc?.calcText && (
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, color: 'var(--brand-d)' }}>
                {autoCalc.calcText}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Jours travailles</label>
              <input
                type="number"
                className="input"
                min={0}
                step={1}
                value={modal.days_worked || ''}
                onChange={(event) =>
                  setModal((prev) => ({ ...prev, days_worked: parseInt(event.target.value || '0', 10) || 0 }))
                }
              />
            </div>
            <div className="field">
              <label>Cout par jour ($)</label>
              <input
                type="number"
                className="input"
                min={0}
                step={0.01}
                value={modal.cost_per_day || ''}
                onChange={(event) =>
                  setModal((prev) => ({ ...prev, cost_per_day: parseFloat(event.target.value || '0') || 0 }))
                }
              />
            </div>
          </div>

          <div className="field">
            <label>Notes</label>
            <textarea
              className="input"
              rows={2}
              style={{ resize: 'vertical' }}
              value={modal.notes}
              onChange={(event) => setModal((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Optionnel..."
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={modal.reminder_enabled !== false}
              onChange={(event) => setModal((prev) => ({ ...prev, reminder_enabled: event.target.checked }))}
            />
            Activer le rappel de paiement de cet hebergement vers la fin de la periode
          </label>

          {modal.id ? (
            <div style={{ background: 'var(--surface2)', borderRadius: 'var(--r)', padding: 12, marginBottom: 16, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Etat du rappel</div>
              <div>Statut: {reminderBadge(accommodations.find((item) => item.id === modal.id)?.reminder_status).label}</div>
              <div>Planifie pour: {accommodations.find((item) => item.id === modal.id)?.reminder_scheduled_for || '-'}</div>
              <div>Envoye le: {accommodations.find((item) => item.id === modal.id)?.reminder_sent_at || '-'}</div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={saveAccommodation}
            >
              {modal.id ? "Enregistrer les changements" : "Ajouter l'hebergement"}
            </button>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setModal(null)}>
              Fermer
            </button>
          </div>

          <div style={{ background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 20, border: '2px dashed var(--brand-m)', textAlign: 'center', marginBottom: 16 }}>
            <Upload size={20} style={{ color: 'var(--brand-m)' }} />
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
              Joindre la facture d&apos;hebergement (PDF/image)
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
              {modal.id
                ? 'Le document sera accessible ici et joint aux factures approuvees.'
                : "Enregistre d'abord l'hebergement pour ajouter les pieces jointes."}
            </div>
            <label className="btn btn-outline btn-sm" style={{ marginTop: 10, cursor: modal.id ? 'pointer' : 'not-allowed', opacity: modal.id ? 1 : 0.6 }}>
              {uploadingAccommodationId === modal.id ? 'Televersement...' : 'Ajouter la piece jointe'}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif"
                style={{ display: 'none' }}
                disabled={!modal.id}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  await uploadAttachment(modal.id, file, { syncModal: true });
                  event.target.value = '';
                }}
              />
            </label>
          </div>

          {modalAttachments.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                Pieces jointes ({modalAttachments.length})
              </div>
              {modalAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{attachment.filename}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                      {(attachment.description || attachment.category || 'Document').trim()} - {attachment.created_at?.slice(0, 10) || '-'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ padding: '2px 8px' }}
                      onClick={async () => {
                        try {
                          await api.openAccommodationAttachment(
                            modal.id,
                            attachment.id,
                            attachment.original_filename || attachment.filename || 'hebergement'
                          );
                        } catch (err) {
                          toast?.(`Erreur: ${err.message}`);
                        }
                      }}
                    >
                      <Eye size={12} />
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ padding: '2px 8px' }}
                      onClick={() => deleteAttachment(modal.id, attachment.id, { syncModal: true })}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
