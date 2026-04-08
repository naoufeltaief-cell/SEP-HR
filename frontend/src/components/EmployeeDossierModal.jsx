import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Download,
  FilePlus2,
  FileText,
  Info,
  MessageSquareText,
  Paperclip,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import api from "../utils/api";
import { Avatar } from "./UI";
import { fmtMoney } from "../utils/helpers";

function SectionField({ label, value }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--text3)",
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>
        {value || "-"}
      </div>
    </div>
  );
}

function StatCard({ label, value, subtle = "" }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--brand-d)" }}>
        {value}
      </div>
      {subtle ? (
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
          {subtle}
        </div>
      ) : null}
    </div>
  );
}

function NavButton({ icon: Icon, active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        borderRadius: 12,
        background: active ? "var(--brand)" : "transparent",
        color: active ? "#fff" : "var(--brand-d)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        fontWeight: 700,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}

function DocumentRow({
  title,
  subtitle,
  badge = "",
  onDownload,
  onDelete,
  allowDelete = false,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 12,
        background: "#fff",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 4,
          }}
        >
          <div style={{ color: "var(--text)", fontWeight: 700 }}>{title}</div>
          {badge ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--brand-d)",
                background: "var(--brand-xl)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              {badge}
            </span>
          ) : null}
        </div>
        <div style={{ color: "var(--text3)", fontSize: 12 }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onDownload}>
          <Download size={13} /> Telecharger
        </button>
        {allowDelete ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={onDelete}>
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, subtitle }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: 14,
        background: "#fff",
        padding: 22,
        color: "var(--text3)",
        textAlign: "center",
      }}
    >
      <Icon size={24} style={{ color: "var(--brand-m)", marginBottom: 10 }} />
      <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 13 }}>{subtitle}</div>
    </div>
  );
}

function formatShiftLine(shift, clientName) {
  const location = shift.location ? ` | ${shift.location}` : "";
  const client = clientName ? ` | ${clientName}` : "";
  return `${shift.date} | ${shift.start}-${shift.end}${location}${client}`;
}

export default function EmployeeDossierModal({
  employeeId,
  clients,
  schedules,
  visibleDates,
  onClose,
  onNavigate,
  toast,
}) {
  const [detail, setDetail] = useState(null);
  const [timesheets, setTimesheets] = useState([]);
  const [accommodations, setAccommodations] = useState([]);
  const [employeeDocuments, setEmployeeDocuments] = useState([]);
  const [linkedDocuments, setLinkedDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("info");
  const [noteText, setNoteText] = useState("");
  const [documentFile, setDocumentFile] = useState(null);
  const [documentDescription, setDocumentDescription] = useState("");
  const [uploadKey, setUploadKey] = useState(0);
  const [uploadingDocument, setUploadingDocument] = useState(false);

  useEffect(() => {
    if (!employeeId) return undefined;
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const [employeeDetail, employeeTimesheets, allAccommodations, extraDocuments] =
          await Promise.all([
            api.getEmployee(employeeId),
            api.getTimesheets({ employee_id: employeeId }),
            api.getAccommodations(),
            api.getEmployeeDocuments(employeeId).catch(() => []),
          ]);

        const employeeAccommodations = (allAccommodations || []).filter(
          (item) => Number(item.employee_id) === Number(employeeId),
        );

        const [timesheetAttachmentGroups, accommodationAttachmentGroups] =
          await Promise.all([
            Promise.all(
              (employeeTimesheets || []).slice(0, 8).map(async (item) => ({
                sourceType: "timesheet",
                sourceId: item.id,
                sourceLabel: `FDT ${item.period_start} -> ${item.period_end}`,
                attachments: await api.getTimesheetAttachments(item.id).catch(() => []),
              })),
            ),
            Promise.all(
              employeeAccommodations.slice(0, 8).map(async (item) => ({
                sourceType: "accommodation",
                sourceId: item.id,
                sourceLabel: `Hebergement ${item.start_date} -> ${item.end_date}`,
                attachments: await api
                  .getAccommodationAttachments(item.id)
                  .catch(() => []),
              })),
            ),
          ]);

        const linked = [
          ...timesheetAttachmentGroups.flatMap((group) =>
            (group.attachments || []).map((attachment) => ({
              key: `timesheet-${group.sourceId}-${attachment.id}`,
              kind: "timesheet",
              sourceId: group.sourceId,
              attachmentId: attachment.id,
              title: attachment.original_filename || attachment.filename || "FDT",
              subtitle: `${group.sourceLabel} | ${
                attachment.created_at?.slice(0, 10) || "-"
              }`,
              badge: "FDT",
              fallbackFilename:
                attachment.original_filename || attachment.filename || "fdt",
            })),
          ),
          ...accommodationAttachmentGroups.flatMap((group) =>
            (group.attachments || []).map((attachment) => ({
              key: `accommodation-${group.sourceId}-${attachment.id}`,
              kind: "accommodation",
              sourceId: group.sourceId,
              attachmentId: attachment.id,
              title:
                attachment.original_filename || attachment.filename || "Hebergement",
              subtitle: `${group.sourceLabel} | ${
                attachment.created_at?.slice(0, 10) || "-"
              }`,
              badge: "Hebergement",
              fallbackFilename:
                attachment.original_filename || attachment.filename || "hebergement",
            })),
          ),
        ];

        if (!mounted) return;
        setDetail(employeeDetail);
        setTimesheets(employeeTimesheets || []);
        setAccommodations(employeeAccommodations);
        setEmployeeDocuments(extraDocuments || []);
        setLinkedDocuments(linked);
      } catch (err) {
        toast?.("Erreur dossier employe: " + err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [employeeId, toast]);

  const clientName = useMemo(
    () => clients.find((item) => item.id === detail?.client_id)?.name || "",
    [clients, detail],
  );

  const employeeShifts = useMemo(
    () =>
      schedules.filter(
        (shift) => Number(shift.employee_id) === Number(employeeId),
      ),
    [employeeId, schedules],
  );

  const visibleHours = useMemo(
    () =>
      employeeShifts
        .filter((shift) => (visibleDates || []).includes(shift.date))
        .reduce((sum, shift) => sum + Number(shift.hours || 0), 0),
    [employeeShifts, visibleDates],
  );

  const totalHours = useMemo(
    () =>
      employeeShifts.reduce((sum, shift) => sum + Number(shift.hours || 0), 0),
    [employeeShifts],
  );

  const totalAccommodation = useMemo(
    () =>
      accommodations.reduce((sum, item) => sum + Number(item.total_cost || 0), 0),
    [accommodations],
  );

  const upcomingShifts = useMemo(
    () =>
      [...employeeShifts]
        .sort((a, b) =>
          `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`),
        )
        .slice(0, 14),
    [employeeShifts],
  );

  const addNote = async () => {
    if (!noteText.trim() || !detail) return;
    try {
      await api.addEmployeeNote(detail.id, { content: noteText });
      const refreshed = await api.getEmployee(detail.id);
      setDetail(refreshed);
      setNoteText("");
      toast?.("Note employee ajoutee");
    } catch (err) {
      toast?.("Erreur note employe: " + err.message);
    }
  };

  const uploadAdditionalDocument = async () => {
    if (!detail?.id || !documentFile) {
      toast?.("Selectionne un document a televerser");
      return;
    }
    try {
      setUploadingDocument(true);
      await api.uploadEmployeeDocument(
        detail.id,
        documentFile,
        "document",
        documentDescription,
      );
      const refreshedDocuments = await api.getEmployeeDocuments(detail.id);
      setEmployeeDocuments(refreshedDocuments || []);
      setDocumentFile(null);
      setDocumentDescription("");
      setUploadKey((value) => value + 1);
      toast?.("Document employe ajoute");
      const refreshed = await api.getEmployee(detail.id);
      setDetail(refreshed);
    } catch (err) {
      toast?.("Erreur document employe: " + err.message);
    } finally {
      setUploadingDocument(false);
    }
  };

  const deleteAdditionalDocument = async (documentId) => {
    if (!detail?.id || !documentId) return;
    try {
      await api.deleteEmployeeDocument(detail.id, documentId);
      setEmployeeDocuments((prev) =>
        prev.filter((item) => Number(item.id) !== Number(documentId)),
      );
      toast?.("Document supprime");
    } catch (err) {
      toast?.("Erreur suppression document: " + err.message);
    }
  };

  const downloadLinkedDocument = async (item) => {
    try {
      if (item.kind === "timesheet") {
        await api.downloadProtectedFile(
          `/timesheets/${item.sourceId}/attachments/${item.attachmentId}`,
          item.fallbackFilename,
        );
        return;
      }
      if (item.kind === "accommodation") {
        await api.downloadProtectedFile(
          `/accommodations/${item.sourceId}/attachments/${item.attachmentId}`,
          item.fallbackFilename,
        );
      }
    } catch (err) {
      toast?.("Erreur telechargement: " + err.message);
    }
  };

  if (!employeeId) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1450,
        background: "rgba(27, 94, 104, 0.22)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(1220px, 98vw)",
          maxHeight: "94vh",
          overflow: "hidden",
          background: "#f8fcfc",
          borderRadius: 24,
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          boxShadow: "0 28px 80px rgba(27, 94, 104, 0.22)",
        }}
      >
        <aside
          style={{
            background: "var(--brand-xl)",
            borderRight: "1px solid var(--border)",
            padding: 18,
            display: "grid",
            gridTemplateRows: "auto auto 1fr auto",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--brand-d)",
              }}
            >
              <X size={22} />
            </button>
          </div>

          <div style={{ textAlign: "center" }}>
            <Avatar
              name={detail?.name || "EMP"}
              size={62}
              bg="var(--brand-l)"
              color="var(--brand)"
            />
            <div
              style={{
                fontWeight: 800,
                fontSize: 18,
                color: "var(--brand-d)",
                marginTop: 10,
              }}
            >
              {detail?.name || "Chargement..."}
            </div>
            <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
              {detail?.position || "Poste a confirmer"}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <NavButton
              icon={Info}
              active={tab === "info"}
              onClick={() => setTab("info")}
              label="Informations"
            />
            <NavButton
              icon={StickyNote}
              active={tab === "documents"}
              onClick={() => setTab("documents")}
              label="Notes et documents"
            />
            <NavButton
              icon={CalendarDays}
              active={tab === "schedule"}
              onClick={() => setTab("schedule")}
              label="Horaire"
            />
          </div>

          <div style={{ alignSelf: "end", display: "grid", gap: 8 }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                onClose?.();
                onNavigate?.("employees");
              }}
            >
              Ouvrir Employes
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                onClose?.();
                onNavigate?.("timesheets");
              }}
            >
              Voir FDT
            </button>
          </div>
        </aside>

        <main style={{ overflowY: "auto", padding: 22 }}>
          {loading && !detail ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
              Chargement du dossier employe...
            </div>
          ) : null}

          {!loading && detail && tab === "info" ? (
            <div style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 14,
                }}
              >
                <StatCard label="Heures visibles" value={`${visibleHours.toFixed(2)} h`} />
                <StatCard label="Heures totales" value={`${totalHours.toFixed(2)} h`} />
                <StatCard label="FDT" value={String(timesheets.length)} />
                <StatCard
                  label="Hebergement"
                  value={fmtMoney(totalAccommodation)}
                  subtle={`${accommodations.length} dossier(s)`}
                />
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 18,
                  padding: 18,
                  display: "grid",
                  gap: 16,
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--brand-d)" }}>
                  Informations generales
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 14,
                  }}
                >
                  <SectionField label="Courriel" value={detail.email} />
                  <SectionField label="Telephone" value={detail.phone} />
                  <SectionField label="Client par defaut" value={clientName} />
                  <SectionField label="Poste" value={detail.position} />
                  <SectionField label="Taux" value={fmtMoney(Number(detail.rate || 0))} />
                  <SectionField
                    label="Notes"
                    value={`${detail.notes?.length || 0} note(s)`}
                  />
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 18,
                  padding: 18,
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--brand-d)" }}>
                  Prochains quarts
                </div>
                {upcomingShifts.length ? (
                  upcomingShifts.map((shift) => (
                    <div
                      key={shift.id}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: "var(--brand-xl)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        fontSize: 14,
                      }}
                    >
                      {formatShiftLine(
                        shift,
                        clients.find((client) => client.id === shift.client_id)?.name || "",
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyPanel
                    icon={CalendarDays}
                    title="Aucun quart"
                    subtitle="Aucun quart n'est rattache a cette ressource pour le moment."
                  />
                )}
              </div>
            </div>
          ) : null}

          {!loading && detail && tab === "documents" ? (
            <div style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr .9fr",
                  gap: 18,
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid var(--border)",
                    borderRadius: 18,
                    padding: 18,
                    display: "grid",
                    gap: 14,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <MessageSquareText size={18} style={{ color: "var(--brand-d)" }} />
                    <div style={{ fontWeight: 800, color: "var(--brand-d)" }}>
                      Notes internes
                    </div>
                  </div>
                  <textarea
                    className="input"
                    rows={4}
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    placeholder="Ajouter une note interne sur cette ressource..."
                    style={{ width: "100%", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="btn btn-primary" onClick={addNote}>
                      <StickyNote size={14} /> Ajouter la note
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {(detail.notes || []).length ? (
                      detail.notes.map((note) => (
                        <div
                          key={note.id}
                          style={{
                            background: "var(--brand-xl)",
                            border: "1px solid var(--border)",
                            borderRadius: 12,
                            padding: "12px 14px",
                          }}
                        >
                          <div style={{ color: "var(--text)", marginBottom: 6 }}>
                            {note.content}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text3)" }}>
                            {note.author || "Admin"} | {note.created_at?.slice(0, 10) || "-"}
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyPanel
                        icon={StickyNote}
                        title="Aucune note"
                        subtitle="Les notes internes de cette ressource apparaitront ici."
                      />
                    )}
                  </div>
                </div>

                <div
                  style={{
                    background: "#fff",
                    border: "1px solid var(--border)",
                    borderRadius: 18,
                    padding: 18,
                    display: "grid",
                    gap: 14,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <FilePlus2 size={18} style={{ color: "var(--brand-d)" }} />
                    <div style={{ fontWeight: 800, color: "var(--brand-d)" }}>
                      Ajouter un document
                    </div>
                  </div>
                  <input
                    key={uploadKey}
                    type="file"
                    className="input"
                    onChange={(event) => setDocumentFile(event.target.files?.[0] || null)}
                  />
                  <input
                    className="input"
                    placeholder="Description optionnelle"
                    value={documentDescription}
                    onChange={(event) => setDocumentDescription(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={uploadingDocument}
                    onClick={uploadAdditionalDocument}
                  >
                    <Upload size={14} />
                    {uploadingDocument ? "Ajout..." : "Ajouter le document"}
                  </button>
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 18,
                  padding: 18,
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Paperclip size={18} style={{ color: "var(--brand-d)" }} />
                  <div style={{ fontWeight: 800, color: "var(--brand-d)" }}>
                    Documents du dossier
                  </div>
                </div>
                {employeeDocuments.length ? (
                  employeeDocuments.map((document) => (
                    <DocumentRow
                      key={document.id}
                      title={document.original_filename || document.filename}
                      subtitle={`${document.description || "Document ajoute manuellement"} | ${
                        document.created_at?.slice(0, 10) || "-"
                      }`}
                      badge={document.category || "document"}
                      onDownload={async () => {
                        try {
                          await api.downloadEmployeeDocument(
                            detail.id,
                            document.id,
                            document.original_filename || document.filename || "document",
                          );
                        } catch (err) {
                          toast?.("Erreur telechargement: " + err.message);
                        }
                      }}
                      onDelete={() => deleteAdditionalDocument(document.id)}
                      allowDelete
                    />
                  ))
                ) : (
                  <EmptyPanel
                    icon={FileText}
                    title="Aucun document additionnel"
                    subtitle="Ajoute des documents de dossier ici pour y acceder en 1 clic."
                  />
                )}
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 18,
                  padding: 18,
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Paperclip size={18} style={{ color: "var(--brand-d)" }} />
                  <div style={{ fontWeight: 800, color: "var(--brand-d)" }}>
                    Documents relies a la ressource
                  </div>
                </div>
                {linkedDocuments.length ? (
                  linkedDocuments.map((item) => (
                    <DocumentRow
                      key={item.key}
                      title={item.title}
                      subtitle={item.subtitle}
                      badge={item.badge}
                      onDownload={() => downloadLinkedDocument(item)}
                    />
                  ))
                ) : (
                  <EmptyPanel
                    icon={Paperclip}
                    title="Aucune piece jointe"
                    subtitle="Les FDT et factures d'hebergement liees apparaitront ici."
                  />
                )}
              </div>
            </div>
          ) : null}

          {!loading && detail && tab === "schedule" ? (
            <div style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 14,
                }}
              >
                <StatCard label="Quarts visibles" value={String(
                  employeeShifts.filter((shift) => (visibleDates || []).includes(shift.date))
                    .length,
                )} />
                <StatCard label="Feuilles de temps" value={String(timesheets.length)} />
                <StatCard label="Hebergement" value={String(accommodations.length)} />
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 18,
                  padding: 18,
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--brand-d)" }}>
                  Horaire de la ressource
                </div>
                {upcomingShifts.length ? (
                  upcomingShifts.map((shift) => (
                    <div
                      key={shift.id}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: "var(--brand-xl)",
                        border: "1px solid var(--border)",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "var(--text)" }}>
                        {`${shift.date} | ${shift.start} -> ${shift.end}`}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text3)" }}>
                        {clients.find((client) => client.id === shift.client_id)?.name ||
                          shift.location ||
                          "Lieu a confirmer"}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyPanel
                    icon={CalendarDays}
                    title="Aucun quart a afficher"
                    subtitle="L'horaire de cette ressource apparaitra ici."
                  />
                )}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
