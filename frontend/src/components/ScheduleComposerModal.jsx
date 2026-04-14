import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  Clock3,
  Coffee,
  MapPin,
  Route,
  Search,
  StickyNote,
  Trash2,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { Avatar } from "./UI";

const WEEKDAY_LABELS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];
const TIMELINE_HOURS = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1,
  2, 3, 4,
];
const TEAM_OPTIONS = [{ value: "sep-team", label: "Soins Expert Plus's Team" }];
const DEFAULT_POSITIONS = [
  "Agente administrative",
  "Infirmier.ere",
  "Infirmier(ere) auxiliaire",
  "Infirmier(ere) clinicienne",
  "Prepose(e) aux beneficiaires",
  "Educateur(trice)",
];
const POSITION_RATE_HINTS = [
  { match: /auxiliaire/, rate: 57.18 },
  { match: /prepose|beneficiaire|pab/, rate: 50.35 },
  { match: /clinicienne|clinicien|infirmier|infirmiere/, rate: 86.23 },
];

function durationInMinutes(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  if ([sh, sm, eh, em].some((value) => Number.isNaN(value))) return 0;
  let total = eh * 60 + em - (sh * 60 + sm);
  if (total <= 0) total += 24 * 60;
  return total;
}

function durationLabel(start, end, pauseMinutes = 0) {
  const totalMinutes = Math.max(
    0,
    durationInMinutes(start, end) - Number(pauseMinutes || 0),
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours && !minutes) return "(0h)";
  if (!minutes) return `(${hours}h)`;
  return `(${hours}h ${minutes}m)`;
}

function normalizeTimeForInput(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})(?::\d{2})?$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return "";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeTimeDraft(value) {
  const raw = String(value || "")
    .replace(/[^\d:]/g, "")
    .slice(0, 5);
  if (!raw) return "";
  if (raw.includes(":")) {
    const [hours = "", minutes = ""] = raw.split(":");
    return `${hours.slice(0, 2)}${raw.includes(":") ? ":" : ""}${minutes.slice(0, 2)}`;
  }
  const digits = raw.slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function formatLongFrenchDate(isoDate) {
  if (!isoDate) return "";
  const dt = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  const formatted = dt.toLocaleDateString("fr-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function dayIndexFromIso(isoDate) {
  if (!isoDate) return 0;
  return new Date(`${isoDate}T12:00:00`).getDay();
}

function addDays(isoDate, days) {
  if (!isoDate) return "";
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function estimateRateFromPosition(label, fallbackRate = 0) {
  const raw = String(label || "").toLowerCase();
  const match = POSITION_RATE_HINTS.find((item) => item.match.test(raw));
  return match ? match.rate : Number(fallbackRate || 0);
}

function dedupeOptions(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = String(item?.value || "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function SearchableSelect({
  label,
  value,
  placeholder,
  icon: Icon,
  assignedLabel,
  assignedOptions,
  allLabel,
  allOptions,
  onSelect,
  onCreate,
  disabled = false,
  allowCreate = false,
  createLabel = "Ajouter",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleMouseDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const selected = useMemo(() => {
    const combined = [...(assignedOptions || []), ...(allOptions || [])];
    return (
      combined.find((item) => String(item.value) === String(value)) || null
    );
  }, [assignedOptions, allOptions, value]);

  const filteredAssigned = useMemo(() => {
    if (!query.trim()) return assignedOptions || [];
    const q = query.trim().toLowerCase();
    return (assignedOptions || []).filter((item) =>
      item.label.toLowerCase().includes(q),
    );
  }, [assignedOptions, query]);

  const filteredAll = useMemo(() => {
    const assignedValues = new Set(
      (assignedOptions || []).map((item) => String(item.value)),
    );
    const source = (allOptions || []).filter(
      (item) => !assignedValues.has(String(item.value)),
    );
    if (!query.trim()) return source;
    const q = query.trim().toLowerCase();
    return source.filter((item) => item.label.toLowerCase().includes(q));
  }, [allOptions, assignedOptions, query]);

  const canCreate = useMemo(() => {
    if (!allowCreate || !query.trim()) return false;
    const normalizedQuery = query.trim().toLowerCase();
    const combined = [...(assignedOptions || []), ...(allOptions || [])];
    return !combined.some(
      (item) => String(item.label || "").trim().toLowerCase() === normalizedQuery,
    );
  }, [allowCreate, allOptions, assignedOptions, query]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div
          style={{
            color: "var(--brand-m)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Icon size={22} />
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((prev) => !prev)}
          style={{
            width: "100%",
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "12px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: disabled ? "default" : "pointer",
            color: "var(--text)",
            boxShadow: open ? "0 0 0 2px rgba(42,123,136,.12)" : "none",
          }}
        >
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 2 }}>
              {label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {selected?.label || placeholder}
            </div>
          </div>
          <ChevronDown size={18} style={{ color: "var(--brand-m)" }} />
        </button>
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            left: 38,
            right: 0,
            top: "calc(100% + 8px)",
            background: "#fff",
            borderRadius: 16,
            border: "1px solid var(--border)",
            boxShadow: "0 18px 45px rgba(27, 94, 104, 0.18)",
            padding: 12,
            zIndex: 30,
          }}
        >
          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search
              size={16}
              style={{
                position: "absolute",
                left: 12,
                top: 11,
                color: "var(--text3)",
              }}
            />
            <input
              className="input"
              autoFocus
              placeholder="Rechercher..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ width: "100%", paddingLeft: 34 }}
            />
          </div>

          <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
            {filteredAssigned.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--brand-d)",
                    padding: "6px 8px",
                    background: "var(--brand-xl)",
                    borderRadius: 10,
                  }}
                >
                  {assignedLabel}
                </div>
                {filteredAssigned.map((option) => (
                  <button
                    key={`assigned-${option.value}`}
                    type="button"
                    onClick={() => {
                      onSelect(option);
                      setOpen(false);
                      setQuery("");
                    }}
                    style={optionRowStyle(
                      String(option.value) === String(value),
                    )}
                  >
                    <span>{option.label}</span>
                    {option.meta && (
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>
                        {option.meta}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}

            {filteredAll.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--brand-d)",
                    padding: "10px 8px 6px",
                    background: "transparent",
                  }}
                >
                  {allLabel}
                </div>
                {filteredAll.map((option) => (
                  <button
                    key={`all-${option.value}`}
                    type="button"
                    onClick={() => {
                      onSelect(option);
                      setOpen(false);
                      setQuery("");
                    }}
                    style={optionRowStyle(
                      String(option.value) === String(value),
                    )}
                  >
                    <span>{option.label}</span>
                    {option.meta && (
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>
                        {option.meta}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}

            {canCreate && (
              <button
                type="button"
                disabled={creating}
                onClick={async () => {
                  try {
                    setCreating(true);
                    const fallbackOption = {
                      value: query.trim(),
                      label: query.trim(),
                    };
                    const created =
                      (await onCreate?.(query.trim(), fallbackOption)) ||
                      fallbackOption;
                    onSelect(created);
                    setOpen(false);
                    setQuery("");
                  } finally {
                    setCreating(false);
                  }
                }}
                style={{
                  width: "100%",
                  border: "1px dashed var(--brand-m)",
                  background: "var(--brand-xl)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--brand-d)",
                  textAlign: "left",
                  marginTop: 8,
                  opacity: creating ? 0.7 : 1,
                }}
              >
                {creating ? "Ajout..." : `${createLabel} "${query.trim()}"`}
              </button>
            )}

            {filteredAssigned.length === 0 && filteredAll.length === 0 && (
              <div
                style={{
                  padding: "18px 10px",
                  fontSize: 13,
                  color: "var(--text3)",
                  textAlign: "center",
                }}
              >
                {canCreate ? "Tu peux ajouter cette valeur ci-dessus." : "Aucun resultat"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function optionRowStyle(active) {
  return {
    width: "100%",
    border: "none",
    background: active ? "var(--brand-xl)" : "transparent",
    borderRadius: 10,
    padding: "10px 10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    cursor: "pointer",
    fontSize: 14,
    color: "var(--text)",
    textAlign: "left",
  };
}

export default function ScheduleComposerModal({
  modal,
  employees,
  clients,
  schedules,
  catalogItems = [],
  onClose,
  onChangeField,
  onCreateCatalogItem,
  onSave,
  onDelete,
}) {
  if (!modal) return null;

  const selectedEmployee = employees.find(
    (item) => String(item.id) === String(modal.data.employeeId),
  );
  const weekdayLabel =
    WEEKDAY_LABELS[dayIndexFromIso(modal.data.date)] || "jour";
  const repeatOptions = [
    { value: "once", label: "Une seule fois" },
    { value: "daily", label: "Chaque jour" },
    { value: "weekly", label: `Chaque semaine le ${weekdayLabel}` },
    {
      value: "weekdays",
      label: "Chaque jour de la semaine (lundi au vendredi)",
    },
    { value: "custom", label: "Personnaliser..." },
  ];

  const assignedPositions = dedupeOptions(
    [selectedEmployee?.position, modal.data.positionLabel]
      .filter(Boolean)
      .map((label) => ({ value: label, label })),
  );
  const catalogPositions = (catalogItems || [])
    .filter((item) => item.kind === "position")
    .map((item) => ({
      value: item.label,
      label: item.label,
      hourlyRate: Number(item.hourly_rate || 0),
      meta: Number(item.hourly_rate || 0) > 0
        ? `${Number(item.hourly_rate || 0).toFixed(2)} $/h`
        : "",
    }));
  const allPositions = dedupeOptions(
    [
      ...DEFAULT_POSITIONS,
      ...catalogPositions.map((item) => item.label),
      ...employees.map((employee) => employee.position),
      modal.data.positionLabel,
    ]
      .filter(Boolean)
      .map((label) => {
        const catalogMatch = catalogPositions.find(
          (item) => String(item.label) === String(label),
        );
        return {
          value: label,
          label,
          hourlyRate: Number(catalogMatch?.hourlyRate || 0),
          meta: catalogMatch?.meta || "",
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  const employeeOptions = dedupeOptions(
    employees
      .map((employee) => ({
        value: employee.id,
        label: employee.name,
        meta: employee.position || "",
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  const assignedLocations = dedupeOptions(
    schedules
      .filter(
        (shift) => String(shift.employee_id) === String(modal.data.employeeId),
      )
      .map((shift) => shift.location)
      .concat(
        clients
          .filter((client) => client.id === selectedEmployee?.client_id)
          .map((client) => client.name),
      )
      .filter(Boolean)
      .map((label) => ({ value: label, label })),
  );
  const catalogLocations = (catalogItems || [])
    .filter((item) => item.kind === "location")
    .map((item) => ({ value: item.label, label: item.label }));
  const allLocations = dedupeOptions(
    catalogLocations
      .map((item) => item.label)
      .concat(
        schedules.map((shift) => shift.location)
      )
      .concat(clients.map((client) => client.name))
      .filter(Boolean)
      .map((label) => {
        const linkedClient = clients.find((client) => client.name === label);
        return { value: label, label, clientId: linkedClient?.id || null };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  const selectedClient = clients.find(
    (client) => String(client.id) === String(modal.data.clientId),
  );
  const selectedRepeat =
    repeatOptions.find((option) => option.value === modal.data.repeatMode) ||
    repeatOptions[0];
  const timelineStart = Number(
    (modal.data.start || "00:00").split(":")[0] || 0,
  );
  const timelineEndRaw = Number((modal.data.end || "00:00").split(":")[0] || 0);
  const timelineEnd =
    timelineEndRaw <= timelineStart ? timelineEndRaw + 24 : timelineEndRaw;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        background: "rgba(27, 94, 104, 0.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(940px, 96vw)",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "#f8fcfc",
          borderRadius: 26,
          boxShadow: "0 32px 90px rgba(27, 94, 104, 0.24)",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, var(--brand-d), var(--brand))",
            color: "#fff",
            padding: "18px 22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar
              name={selectedEmployee?.name || "SEP"}
              size={42}
              bg="rgba(255,255,255,0.18)"
              color="#fff"
            />
            <div>
              <div style={{ fontSize: 15, opacity: 0.92 }}>
                {modal.type === "edit"
                  ? "Modification de quart"
                  : "Creation de quart"}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>
                {selectedEmployee?.name || "Nouvelle assignation"} -{" "}
                {formatLongFrenchDate(modal.data.date)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            <X size={26} />
          </button>
        </div>

        <div style={{ padding: "14px 18px 18px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(24, minmax(0, 1fr))",
              gap: 0,
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
              marginBottom: 18,
            }}
          >
            {TIMELINE_HOURS.map((hour, index) => {
              const displayHour = String(hour);
              const active =
                index >= timelineStart - 5 && index < timelineEnd - 5;
              return (
                <div
                  key={displayHour}
                  style={{
                    borderRight:
                      index < TIMELINE_HOURS.length - 1
                        ? "1px solid #e3f0f2"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--brand-m)",
                      textAlign: "center",
                      paddingTop: 6,
                    }}
                  >
                    {displayHour}
                  </div>
                  <div style={{ height: 12, padding: "8px 0 10px" }}>
                    <div
                      style={{
                        height: 10,
                        margin: "0 2px",
                        borderRadius: 999,
                        background: active ? "var(--brand)" : "transparent",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              background: "#fff",
              borderRadius: 22,
              border: "1px solid var(--border)",
              padding: 18,
            }}
          >
            <div style={{ display: "grid", gap: 14 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <FieldShell icon={Clock3}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 14,
                    }}
                  >
                    <LabeledInput
                      label="Heure de debut"
                      type="text"
                      inputMode="numeric"
                      placeholder="07:30"
                      value={modal.data.start}
                      onChange={(event) =>
                        onChangeField("start", normalizeTimeDraft(event.target.value))
                      }
                      onBlur={(event) =>
                        onChangeField(
                          "start",
                          normalizeTimeForInput(event.target.value) ||
                            normalizeTimeDraft(event.target.value),
                        )
                      }
                    />
                    <LabeledInput
                      label="Heure de fin"
                      type="text"
                      inputMode="numeric"
                      placeholder="15:15"
                      value={modal.data.end}
                      onChange={(event) =>
                        onChangeField("end", normalizeTimeDraft(event.target.value))
                      }
                      onBlur={(event) =>
                        onChangeField(
                          "end",
                          normalizeTimeForInput(event.target.value) ||
                            normalizeTimeDraft(event.target.value),
                        )
                      }
                      suffix={durationLabel(
                        modal.data.start,
                        modal.data.end,
                        modal.data.pauseMinutes,
                      )}
                    />
                  </div>
                </FieldShell>
                <FieldShell icon={CalendarDays}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr .8fr",
                      gap: 12,
                    }}
                  >
                    <LabeledInput
                      label="Date"
                      type="date"
                      value={modal.data.date}
                      onChange={(event) =>
                        onChangeField("date", event.target.value)
                      }
                    />
                    <LabeledInput
                      label="Repeter jusqu'au"
                      type="date"
                      value={modal.data.recurrenceEnd || ""}
                      onChange={(event) =>
                        onChangeField("recurrenceEnd", event.target.value)
                      }
                      disabled={modal.data.repeatMode === "once"}
                    />
                  </div>
                </FieldShell>
              </div>

              <FieldShell icon={CalendarDays}>
                <div style={{ display: "grid", gap: 10 }}>
                  <SelectButton
                    label="Repeter"
                    value={selectedRepeat.label}
                    customContent={
                      <select
                        className="input"
                        value={modal.data.repeatMode}
                        onChange={(event) =>
                          onChangeField("repeatMode", event.target.value)
                        }
                        style={{ width: "100%" }}
                      >
                        {repeatOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  {modal.data.repeatMode === "custom" && (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        paddingLeft: 40,
                      }}
                    >
                      {WEEKDAY_LABELS.map((dayLabel, dayIndex) => {
                        const active = (
                          modal.data.recurrenceDays || []
                        ).includes(dayIndex);
                        return (
                          <button
                            key={dayLabel}
                            type="button"
                            onClick={() => {
                              const existing = new Set(
                                modal.data.recurrenceDays || [],
                              );
                              if (existing.has(dayIndex))
                                existing.delete(dayIndex);
                              else existing.add(dayIndex);
                              onChangeField(
                                "recurrenceDays",
                                Array.from(existing).sort((a, b) => a - b),
                              );
                            }}
                            style={{
                              border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                              background: active ? "var(--brand-xl)" : "#fff",
                              color: active ? "var(--brand-d)" : "var(--text2)",
                              borderRadius: 999,
                              padding: "7px 12px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {dayLabel.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </FieldShell>

              <FieldShell icon={UsersRound}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 14,
                  }}
                >
                  <SearchableSelect
                    label="Employe"
                    value={modal.data.employeeId}
                    placeholder="Selectionner une ressource"
                    icon={UsersRound}
                    assignedLabel="Selection courante"
                    assignedOptions={
                      selectedEmployee
                        ? [
                            {
                              value: selectedEmployee.id,
                              label: selectedEmployee.name,
                              meta: selectedEmployee.position || "",
                            },
                          ]
                        : []
                    }
                    allLabel="Toutes les ressources"
                    allOptions={employeeOptions}
                    onSelect={(option) =>
                      onChangeField("employeeId", option.value)
                    }
                  />
                  <SelectButton
                    label="Equipe"
                    value={TEAM_OPTIONS[0].label}
                    disabled
                    icon={UsersRound}
                  />
                </div>
              </FieldShell>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                  <SearchableSelect
                    label="Position"
                    value={modal.data.positionLabel}
                    placeholder="Selectionner une position"
                    icon={BriefcaseBusiness}
                    assignedLabel="Positions assignees"
                    assignedOptions={assignedPositions}
                    allLabel="Toutes les positions"
                    allOptions={allPositions}
                    allowCreate
                    createLabel="Ajouter le poste"
                    onCreate={async (label, fallbackOption) => {
                      if (!onCreateCatalogItem) return fallbackOption;
                      const created = await onCreateCatalogItem(
                        "position",
                        label,
                        Number(modal.data.billableRate || 0),
                      );
                      return {
                        value: created?.label || fallbackOption.value,
                        label: created?.label || fallbackOption.label,
                        hourlyRate: Number(created?.hourly_rate || 0),
                        meta:
                          Number(created?.hourly_rate || 0) > 0
                            ? `${Number(created?.hourly_rate || 0).toFixed(2)} $/h`
                            : "",
                      };
                    }}
                    onSelect={(option) => {
                      onChangeField("positionLabel", option.value);
                      if (!modal.data.isOrientation) {
                        const nextRate =
                          Number(option.hourlyRate || 0) > 0
                            ? Number(option.hourlyRate || 0)
                            : estimateRateFromPosition(
                                option.label,
                                modal.data.billableRate,
                              );
                        onChangeField(
                          "billableRate",
                          nextRate,
                        );
                      }
                      if (
                        option.label &&
                        option.label !== (selectedEmployee?.position || "")
                      ) {
                        onChangeField("applyPositionToEmployee", true);
                      }
                    }}
                  />
                  <SearchableSelect
                    label="Lieu"
                    value={modal.data.location}
                    placeholder="Selectionnez un lieu"
                    icon={MapPin}
                    assignedLabel="Lieux assignes"
                    assignedOptions={assignedLocations}
                    allLabel="Tous les lieux"
                    allOptions={allLocations}
                    allowCreate
                    createLabel="Ajouter le lieu"
                    onCreate={async (label, fallbackOption) => {
                      if (!onCreateCatalogItem) return fallbackOption;
                      const created = await onCreateCatalogItem("location", label);
                      return {
                        value: created?.label || fallbackOption.value,
                        label: created?.label || fallbackOption.label,
                      };
                    }}
                    onSelect={(option) => {
                      onChangeField("location", option.label);
                      if (option.clientId) {
                        onChangeField("clientId", option.clientId);
                      }
                    }}
                  />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 14,
                }}
              >
                <LabeledSelect
                  label="Client"
                  value={modal.data.clientId || ""}
                  onChange={(event) =>
                    onChangeField("clientId", event.target.value)
                  }
                  options={clients.map((client) => ({
                    value: client.id,
                    label: client.name,
                  }))}
                  placeholder="Choisir"
                />
                <LabeledInput
                  label="Taux horaire"
                  type="number"
                  step="0.01"
                  value={modal.data.billableRate}
                  onChange={(event) =>
                    onChangeField("billableRate", event.target.value)
                  }
                  disabled={Boolean(modal.data.isOrientation)}
                />
                <LabeledSelect
                  label="Type de quart"
                  value={modal.data.isOrientation ? "orientation" : "regular"}
                  onChange={(event) =>
                    onChangeField(
                      "isOrientation",
                      event.target.value === "orientation",
                    )
                  }
                  options={[
                    { value: "regular", label: "Regulier" },
                    { value: "orientation", label: "Orientation" },
                  ]}
                  placeholder="Choisir"
                />
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <label
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 12,
                        color: "var(--text2)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!modal.data.applyPositionToEmployee}
                      onChange={(event) =>
                        onChangeField(
                          "applyPositionToEmployee",
                          event.target.checked,
                        )
                      }
                    />
                    Mettre a jour le poste du profil employe
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
            <InfoRow
              icon={Coffee}
              label="Pause non payee"
              helper="Minutes retirees du quart"
              actionLabel="+15"
              onAction={() =>
                onChangeField(
                  "pauseMinutes",
                  Number(modal.data.pauseMinutes || 0) + 15,
                )
              }
            >
              <input
                className="input"
                type="number"
                min="0"
                step="5"
                value={modal.data.pauseMinutes}
                onChange={(event) =>
                  onChangeField("pauseMinutes", event.target.value)
                }
              />
            </InfoRow>

            <InfoRow
              icon={Route}
              label="Kilometrage"
              helper="Aller-retour ou deplacement autorise"
            >
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={modal.data.km}
                onChange={(event) => onChangeField("km", event.target.value)}
              />
            </InfoRow>

            <InfoRow
              icon={Wallet}
              label="Deplacement"
              helper="Heures de deplacement et autres frais"
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <input
                  className="input"
                  type="number"
                  step="0.25"
                  value={modal.data.deplacement}
                  onChange={(event) =>
                    onChangeField("deplacement", event.target.value)
                  }
                  placeholder="Heures"
                />
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={modal.data.autreDep}
                  onChange={(event) =>
                    onChangeField("autreDep", event.target.value)
                  }
                  placeholder="Autres frais"
                />
              </div>
            </InfoRow>

            <InfoRow
              icon={StickyNote}
              label="Notes"
              helper={
                selectedClient
                  ? `Client selectionne: ${selectedClient.name}`
                  : "Ajoute un contexte utile pour le recruteur"
              }
            >
              <textarea
                className="input"
                rows={3}
                value={modal.data.notes}
                onChange={(event) => onChangeField("notes", event.target.value)}
                style={{ resize: "vertical", minHeight: 88 }}
              />
            </InfoRow>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 22,
              gap: 12,
            }}
          >
            <div>
              {modal.type === "edit" && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={onDelete}
                >
                  <Trash2 size={14} /> Supprimer
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={onClose}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onSave}
              >
                {modal.type === "edit" ? "Enregistrer" : "Creer et publier"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldShell({ icon: Icon, children }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr",
        gap: 10,
        alignItems: "start",
      }}
    >
      <div
        style={{
          color: "var(--brand-m)",
          display: "flex",
          justifyContent: "center",
          paddingTop: 10,
        }}
      >
        <Icon size={22} />
      </div>
      <div>{children}</div>
    </div>
  );
}

function LabeledInput({ label, suffix, ...props }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text3)" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          className="input"
          {...props}
          style={{
            width: "100%",
            paddingRight: suffix ? 92 : undefined,
            ...(props.style || {}),
          }}
        />
        {suffix && (
          <span
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 12,
              color: "var(--text3)",
              fontWeight: 700,
            }}
          >
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function LabeledSelect({ label, value, onChange, options, placeholder }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text3)" }}>{label}</span>
      <select className="input" value={value} onChange={onChange}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectButton({
  label,
  value,
  icon: Icon = CalendarDays,
  disabled = false,
  customContent = null,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div
        style={{ color: "var(--brand-m)", display: "flex", justifyContent: "center" }}
      >
        <Icon size={22} />
      </div>
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "12px 14px",
          opacity: disabled ? 0.72 : 1,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 2 }}>
          {label}
        </div>
        {customContent || (
          <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  helper,
  actionLabel,
  onAction,
  children,
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 18,
        border: "1px solid var(--border)",
        padding: "16px 18px",
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div
        style={{ color: "var(--brand-m)", display: "flex", justifyContent: "center" }}
      >
        <Icon size={22} />
      </div>
      <div>
        <div style={{ fontWeight: 700, color: "var(--brand-d)", marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
          {helper}
        </div>
        {children}
      </div>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          style={{
            alignSelf: "start",
            border: "none",
            background: "transparent",
            color: "var(--brand)",
            fontSize: 22,
            fontWeight: 700,
            cursor: "pointer",
            padding: "4px 6px",
          }}
        >
          {actionLabel}
        </button>
      ) : (
        <div />
      )}
    </div>
  );
}
