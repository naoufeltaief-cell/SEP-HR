import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  FileText,
  Info,
  MessageSquareText,
  StickyNote,
  UserCircle2,
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
          color: "#8d82a8",
          textTransform: "uppercase",
          letterSpacing: ".03em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: "#2b2450", fontWeight: 600 }}>
        {value || "-"}
      </div>
    </div>
  );
}

function formatShiftLine(shift) {
  return `${shift.date} | ${shift.start}-${shift.end}`;
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
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("info");
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    if (!employeeId) return undefined;
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const [employeeDetail, employeeTimesheets, allAccommodations] =
          await Promise.all([
            api.getEmployee(employeeId),
            api.getTimesheets({ employee_id: employeeId }),
            api.getAccommodations(),
          ]);
        if (!mounted) return;
        setDetail(employeeDetail);
        setTimesheets(employeeTimesheets || []);
        setAccommodations(
          (allAccommodations || []).filter(
            (item) => Number(item.employee_id) === Number(employeeId),
          ),
        );
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
  const upcomingShifts = useMemo(
    () =>
      [...employeeShifts]
        .sort((a, b) =>
          `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`),
        )
        .slice(0, 12),
    [employeeShifts],
  );
  const attachmentTotals = useMemo(
    () => ({
      timesheets: timesheets.reduce(
        (sum, item) => sum + Number(item.attachment_count || 0),
        0,
      ),
      accommodations: accommodations.reduce(
        (sum, item) => sum + Number(item.attachment_count || 0),
        0,
      ),
    }),
    [accommodations, timesheets],
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

  if (!employeeId) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1450,
        background: "rgba(20, 16, 34, 0.42)",
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
          width: "min(1180px, 98vw)",
          maxHeight: "94vh",
          overflow: "hidden",
          background: "#fbfaff",
          borderRadius: 24,
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          boxShadow: "0 28px 80px rgba(18, 14, 30, 0.28)",
        }}
      >
        <aside
          style={{
            background: "#f2effa",
            borderRight: "1px solid #e7def4",
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
                color: "#8b7ca9",
              }}
            >
              <X size={22} />
            </button>
          </div>

          <div style={{ textAlign: "center" }}>
            <Avatar
              name={detail?.name || "EMP"}
              size={62}
              bg="#d9cef3"
              color="#7a5ad1"
            />
            <div
              style={{
                fontWeight: 800,
                fontSize: 18,
                color: "#2b2450",
                marginTop: 10,
              }}
            >
              {detail?.name || "Chargement..."}
            </div>
            <div style={{ fontSize: 13, color: "#8d82a8", marginTop: 4 }}>
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
            <div style={{ padding: 40, textAlign: "center", color: "#8d82a8" }}>
              Chargement du dossier employe...
            </div>
          ) : (
            <>
              {tab === "info" && (
                <div style={{ display: "grid", gap: 18 }}>
                  <div
                    style={{ fontSize: 22, fontWeight: 800, color: "#2b2450" }}
                  >
                    Dossier de l'employe
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 12,
                    }}
                  >
                    <StatCard
                      label="Heures visibles"
                      value={`${visibleHours.toFixed(2)}h`}
                    />
                    <StatCard
                      label="Heures totales"
                      value={`${totalHours.toFixed(2)}h`}
                    />
                    <StatCard label="FDT" value={String(timesheets.length)} />
                    <StatCard
                      label="Hebergement"
                      value={String(accommodations.length)}
                    />
                  </div>

                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #ece4f7",
                      borderRadius: 18,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        color: "#2b2450",
                        marginBottom: 14,
                      }}
                    >
                      Informations generales
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 18,
                      }}
                    >
                      <SectionField label="Nom" value={detail?.name} />
                      <SectionField label="Poste" value={detail?.position} />
                      <SectionField
                        label="Client associe"
                        value={clientName || "Aucun"}
                      />
                      <SectionField
                        label="Courriel"
                        value={detail?.email || "-"}
                      />
                      <SectionField
                        label="Telephone"
                        value={detail?.phone || "-"}
                      />
                      <SectionField
                        label="Taux horaire"
                        value={`${fmtMoney(detail?.rate || 0)}/h`}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #ece4f7",
                      borderRadius: 18,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        color: "#2b2450",
                        marginBottom: 14,
                      }}
                    >
                      Apercu horaire
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {upcomingShifts.length === 0 && (
                        <div style={{ color: "#8d82a8", fontSize: 13 }}>
                          Aucun quart trouve pour cette ressource.
                        </div>
                      )}
                      {upcomingShifts.map((shift) => (
                        <div
                          key={shift.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1.3fr .8fr .6fr",
                            gap: 12,
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: "#faf8ff",
                            border: "1px solid #f0e9fb",
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "#2b2450" }}>
                            {formatShiftLine(shift)}
                          </div>
                          <div style={{ color: "#6d6188", fontSize: 13 }}>
                            {shift.location || "Lieu a confirmer"}
                          </div>
                          <div
                            style={{
                              textAlign: "right",
                              fontWeight: 700,
                              color: "#22849a",
                            }}
                          >
                            {Number(shift.hours || 0).toFixed(2)}h
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === "documents" && (
                <div style={{ display: "grid", gap: 18 }}>
                  <div
                    style={{ fontSize: 22, fontWeight: 800, color: "#2b2450" }}
                  >
                    Notes et documents
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 12,
                    }}
                  >
                    <StatCard
                      label="FDT recues"
                      value={String(timesheets.length)}
                      subtle={`${attachmentTotals.timesheets} piece(s)`}
                    />
                    <StatCard
                      label="Dossiers hebergement"
                      value={String(accommodations.length)}
                      subtle={`${attachmentTotals.accommodations} document(s)`}
                    />
                    <StatCard
                      label="Notes"
                      value={String(detail?.notes?.length || 0)}
                    />
                    <StatCard
                      label="Client principal"
                      value={clientName || "Aucun"}
                    />
                  </div>

                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #ece4f7",
                      borderRadius: 18,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 14,
                      }}
                    >
                      <MessageSquareText
                        size={18}
                        style={{ color: "#8c5af4" }}
                      />
                      <div style={{ fontWeight: 700, color: "#2b2450" }}>
                        Notes recruteur
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        value={noteText}
                        placeholder="Ajouter une note au dossier..."
                        onChange={(event) => setNoteText(event.target.value)}
                        onKeyDown={(event) =>
                          event.key === "Enter" && addNote()
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={addNote}
                      >
                        Ajouter
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {(detail?.notes || []).map((note) => (
                        <div
                          key={note.id}
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            background: "#faf8ff",
                            border: "1px solid #f0e9fb",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              marginBottom: 6,
                            }}
                          >
                            <strong style={{ color: "#2b2450" }}>
                              {note.author || "Admin"}
                            </strong>
                            <span style={{ fontSize: 11, color: "#8d82a8" }}>
                              {new Date(note.created_at).toLocaleString(
                                "fr-CA",
                              )}
                            </span>
                          </div>
                          <div style={{ color: "#4b4463", fontSize: 14 }}>
                            {note.content}
                          </div>
                        </div>
                      ))}
                      {(!detail?.notes || !detail.notes.length) && (
                        <div style={{ fontSize: 13, color: "#8d82a8" }}>
                          Aucune note pour le moment.
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #ece4f7",
                      borderRadius: 18,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 14,
                      }}
                    >
                      <FileText size={18} style={{ color: "#8c5af4" }} />
                      <div style={{ fontWeight: 700, color: "#2b2450" }}>
                        Documents relies
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {timesheets.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1.3fr .8fr .5fr",
                            gap: 12,
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: "#faf8ff",
                            border: "1px solid #f0e9fb",
                          }}
                        >
                          <div style={{ color: "#2b2450", fontWeight: 600 }}>
                            FDT {item.period_start} {"->"} {item.period_end}
                          </div>
                          <div style={{ color: "#6d6188", fontSize: 13 }}>
                            {item.status}
                          </div>
                          <div
                            style={{
                              textAlign: "right",
                              color: "#8d82a8",
                              fontSize: 13,
                            }}
                          >
                            {item.attachment_count || 0} piece(s)
                          </div>
                        </div>
                      ))}
                      {accommodations.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1.3fr .8fr .5fr",
                            gap: 12,
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: "#faf8ff",
                            border: "1px solid #f0e9fb",
                          }}
                        >
                          <div style={{ color: "#2b2450", fontWeight: 600 }}>
                            Hebergement {item.start_date} {"->"} {item.end_date}
                          </div>
                          <div style={{ color: "#6d6188", fontSize: 13 }}>
                            {fmtMoney(item.total_cost || 0)}
                          </div>
                          <div
                            style={{
                              textAlign: "right",
                              color: "#8d82a8",
                              fontSize: 13,
                            }}
                          >
                            {item.attachment_count || 0} piece(s)
                          </div>
                        </div>
                      ))}
                      {timesheets.length === 0 &&
                        accommodations.length === 0 && (
                          <div style={{ fontSize: 13, color: "#8d82a8" }}>
                            Aucun document relie trouve. Les pieces sont gerees
                            dans Feuilles de temps et Hebergement.
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              )}

              {tab === "schedule" && (
                <div style={{ display: "grid", gap: 18 }}>
                  <div
                    style={{ fontSize: 22, fontWeight: 800, color: "#2b2450" }}
                  >
                    Historique horaire
                  </div>
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #ece4f7",
                      borderRadius: 18,
                      padding: 18,
                    }}
                  >
                    <div style={{ display: "grid", gap: 10 }}>
                      {employeeShifts.length === 0 && (
                        <div style={{ fontSize: 13, color: "#8d82a8" }}>
                          Aucun quart disponible.
                        </div>
                      )}
                      {employeeShifts
                        .slice()
                        .sort((a, b) =>
                          `${b.date} ${b.start}`.localeCompare(
                            `${a.date} ${a.start}`,
                          ),
                        )
                        .slice(0, 16)
                        .map((shift) => (
                          <div
                            key={shift.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1.2fr .9fr .6fr .6fr",
                              gap: 12,
                              padding: "10px 12px",
                              borderRadius: 12,
                              background: "#faf8ff",
                              border: "1px solid #f0e9fb",
                            }}
                          >
                            <div style={{ fontWeight: 600, color: "#2b2450" }}>
                              {formatShiftLine(shift)}
                            </div>
                            <div style={{ color: "#6d6188", fontSize: 13 }}>
                              {shift.location || "Lieu a confirmer"}
                            </div>
                            <div style={{ color: "#6d6188", fontSize: 13 }}>
                              {shift.status || "draft"}
                            </div>
                            <div
                              style={{
                                textAlign: "right",
                                fontWeight: 700,
                                color: "#22849a",
                              }}
                            >
                              {Number(shift.hours || 0).toFixed(2)}h
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
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
        background: active ? "#a76dff" : "transparent",
        color: active ? "#fff" : "#564675",
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

function StatCard({ label, value, subtle = "" }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #ece4f7",
        borderRadius: 16,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 11, color: "#8d82a8", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#2b2450" }}>
        {value}
      </div>
      {subtle ? (
        <div style={{ fontSize: 12, color: "#8d82a8", marginTop: 4 }}>
          {subtle}
        </div>
      ) : null}
    </div>
  );
}
