// =====================================================================
// Announcements — HR admin page.
// ---------------------------------------------------------------------
// HR posts company-wide announcements here. Three types:
//
//   MEETING  — has date + optional time + optional venue
//   EVENT    — same shape; town halls, celebrations, training days
//   NOTICE   — plain title + description, no date. Lighter than a
//              formal INFORMATION memo — no ack tracking.
//
// Every post surfaces in the employee ESS Announcements panel and
// pushes a Notification row per active employee so their bell + toast
// fires within the next 15s poll (or on window focus).
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";


const BVC_RED  = "#dc2626";
const BVC_DARK = "#b91c1c";

// Full announcement taxonomy. Ordered by frequency of expected use so
// the top of the dropdown feels familiar. Placeholder examples come
// straight from the industry-standard titles list HR uses.
const TYPES = [
  { value: "GENERAL",       label: "General",           hint: "Office updates, policy reminders" },
  { value: "HR",            label: "HR",                hint: "New hires, promotions, benefits, training" },
  { value: "MEETING",       label: "Meeting",           hint: "Team, department, town hall" },
  { value: "EVENT",         label: "Event",             hint: "Parties, celebrations, engagement" },
  { value: "HOLIDAY",       label: "Holiday",           hint: "Closures, festival greetings" },
  { value: "SAFETY",        label: "Safety & Security", hint: "Drills, emergency procedures" },
  { value: "IT",            label: "IT & Technology",   hint: "Maintenance, updates, downtime" },
  { value: "ACHIEVEMENT",   label: "Achievement",       hint: "Milestones, awards, recognitions" },
  { value: "OPERATIONAL",   label: "Operational",       hint: "Process changes, relocations, equipment" },
  { value: "URGENT",        label: "Urgent",            hint: "Emergency / immediate action" },
  { value: "COMMUNICATION", label: "Communication",     hint: "Surveys, feedback, internal campaigns" },
  { value: "CORPORATE",     label: "Corporate",         hint: "Strategy, leadership, mergers" },
];

// Types that carry a scheduled date/time. All others are dateless —
// the modal hides the Date/Time/Location block when the picker sits
// on one of these.
const DATELESS_TYPES = new Set([
  "GENERAL", "HR", "SAFETY", "IT", "ACHIEVEMENT",
  "OPERATIONAL", "URGENT", "COMMUNICATION", "CORPORATE",
]);


function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}


const EMPTY_FORM = {
  ID: null,
  TYPE: "GENERAL",
  TITLE: "",
  DESCRIPTION: "",
  EVENT_DATE: todayLocalISO(),
  EVENT_TIME: "",
  LOCATION: "",
};


export default function Announcements() {

  const [rows, setRows]         = useState([]);
  const [filterType, setFilterType] = useState("ALL");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterType !== "ALL") params.set("type", filterType);
      const q = params.toString();
      const res = await API.get(`/announcements${q ? `?${q}` : ""}`);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load announcements.");
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => { load(); }, [load]);


  const filteredRows = useMemo(() => rows, [rows]);


  const openCreate = () => {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      ID: row.ID,
      TYPE: row.TYPE,
      TITLE: row.TITLE || "",
      DESCRIPTION: row.DESCRIPTION || "",
      EVENT_DATE: row.EVENT_DATE || "",
      EVENT_TIME: row.EVENT_TIME || "",
      LOCATION: row.LOCATION || "",
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setForm(EMPTY_FORM);
  };

  const submit = async () => {
    if (!form.TITLE.trim()) {
      alert("Title is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        TYPE: form.TYPE,
        TITLE: form.TITLE.trim(),
        DESCRIPTION: form.DESCRIPTION.trim() || null,
        EVENT_DATE: DATELESS_TYPES.has(form.TYPE) ? null : (form.EVENT_DATE || null),
        EVENT_TIME: DATELESS_TYPES.has(form.TYPE) ? null : (form.EVENT_TIME.trim() || null),
        LOCATION:   DATELESS_TYPES.has(form.TYPE) ? null : (form.LOCATION.trim() || null),
      };
      if (form.ID) {
        await API.patch(`/announcements/${form.ID}`, payload);
      } else {
        await API.post("/announcements", payload);
      }
      await load();
      closeModal();
    } catch (e) {
      alert(e?.response?.data?.detail || "Could not save the announcement.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.TITLE}"? It will disappear from the employee portal.`)) return;
    try {
      await API.delete(`/announcements/${row.ID}`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Could not delete.");
    }
  };


  return (
    <div style={styles.wrap}>

      {/* Header */}
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>HR</div>
          <h1 style={styles.h1}>Announcements</h1>
          <div style={styles.sub}>
            Post meetings, events and notices. Every active employee gets a bell notification the moment you save.
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          style={styles.primaryBtn}
        >
          + New announcement
        </button>
      </div>

      {/* Filter chips — All + one per type. Uses the same TYPES list
          the modal uses, so the two stay in sync automatically. */}
      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Filter</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <FilterChip
            label="All"
            active={filterType === "ALL"}
            onClick={() => setFilterType("ALL")}
          />
          {TYPES.map((t) => (
            <FilterChip
              key={t.value}
              label={t.label}
              active={filterType === t.value}
              onClick={() => setFilterType(t.value)}
            />
          ))}
        </div>
        <span style={styles.filterCount}>
          {filteredRows.length} total
        </span>
      </div>

      {/* Table */}
      <div style={styles.card}>
        {loading && <div style={styles.muted}>Loading announcements…</div>}
        {error   && <div style={styles.error}>{error}</div>}
        {!loading && !error && filteredRows.length === 0 && (
          <div style={styles.empty}>
            No announcements yet. Click <b>+ New announcement</b> to post one.
          </div>
        )}
        {!loading && !error && filteredRows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thead}>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Title</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Location</th>
                  <th style={styles.th}>Posted</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.ID} style={styles.tr}>
                    <td style={styles.td}>
                      <TypePill type={r.TYPE} />
                    </td>
                    <td style={{ ...styles.td, fontWeight: 700 }}>
                      {r.TITLE}
                      {r.DESCRIPTION && (
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 400, marginTop: 3 }}>
                          {r.DESCRIPTION.length > 100 ? r.DESCRIPTION.slice(0, 100) + "…" : r.DESCRIPTION}
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>
                      {r.EVENT_DATE
                        ? (r.EVENT_TIME ? `${fmtDate(r.EVENT_DATE)} · ${r.EVENT_TIME}` : fmtDate(r.EVENT_DATE))
                        : "—"}
                    </td>
                    <td style={styles.td}>{r.LOCATION || "—"}</td>
                    <td style={{ ...styles.td, fontSize: 12, color: "#64748b" }}>
                      {fmtDateTime(r.CREATED_AT)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button style={styles.linkBtn} onClick={() => openEdit(r)}>Edit</button>
                      <button style={styles.dangerLink} onClick={() => remove(r)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeModal}
          style={styles.modalBackdrop}
        >
          <div onClick={(e) => e.stopPropagation()} style={styles.modal}>
            <div style={styles.modalHead}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>
                {form.ID ? "Edit announcement" : "New announcement"}
              </div>
              <button
                type="button"
                onClick={closeModal}
                style={styles.closeBtn}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={styles.modalBody}>

              <FormField label="Type" required>
                <select
                  style={styles.input}
                  value={form.TYPE}
                  onChange={(e) => setForm({ ...form, TYPE: e.target.value })}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 4 }}>
                  {TYPES.find((t) => t.value === form.TYPE)?.hint || ""}
                </div>
              </FormField>

              <FormField label="Title" required>
                <input
                  type="text"
                  style={styles.input}
                  value={form.TITLE}
                  onChange={(e) => setForm({ ...form, TITLE: e.target.value })}
                  placeholder={placeholderFor(form.TYPE)}
                  maxLength={200}
                />
              </FormField>

              <FormField label="Description">
                <textarea
                  rows={3}
                  style={{ ...styles.input, resize: "vertical" }}
                  value={form.DESCRIPTION}
                  onChange={(e) => setForm({ ...form, DESCRIPTION: e.target.value })}
                  placeholder="Agenda, details, context…"
                  maxLength={2000}
                />
              </FormField>

              {!DATELESS_TYPES.has(form.TYPE) && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <FormField label="Date">
                      <input
                        type="date"
                        style={styles.input}
                        value={form.EVENT_DATE || ""}
                        onChange={(e) => setForm({ ...form, EVENT_DATE: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Time">
                      <input
                        type="time"
                        style={styles.input}
                        value={form.EVENT_TIME || ""}
                        onChange={(e) => setForm({ ...form, EVENT_TIME: e.target.value })}
                      />
                    </FormField>
                  </div>

                  <FormField label="Location">
                    <input
                      type="text"
                      style={styles.input}
                      value={form.LOCATION}
                      onChange={(e) => setForm({ ...form, LOCATION: e.target.value })}
                      placeholder="Conference room / Office / Zoom link"
                      maxLength={200}
                    />
                  </FormField>
                </>
              )}
            </div>

            <div style={styles.modalFoot}>
              <button
                type="button"
                onClick={closeModal}
                style={styles.secondaryBtn}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                style={styles.primaryBtn}
                disabled={saving}
              >
                {saving ? "Saving…" : (form.ID ? "Save changes" : "Post announcement")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}


function FilterChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        background: active ? "#0f172a" : "#ffffff",
        color: active ? "#ffffff" : "#475569",
        border: `1px solid ${active ? "#0f172a" : "#e2e8f0"}`,
        borderRadius: 999,
        fontFamily: "inherit",
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}


// Industry-standard example titles per category — used as the input
// placeholder so HR gets a concrete starting point when composing.
function placeholderFor(type) {
  switch (type) {
    case "GENERAL":       return "e.g. Important Notice: Updated Office Timings";
    case "HR":            return "e.g. Welcome Our New Team Member";
    case "MEETING":       return "e.g. All-hands review — August";
    case "EVENT":         return "e.g. Annual day 2026";
    case "HOLIDAY":       return "e.g. Office Closed on Public Holiday";
    case "SAFETY":        return "e.g. Emergency Safety Drill Notification";
    case "IT":            return "e.g. Scheduled System Maintenance";
    case "ACHIEVEMENT":   return "e.g. Congratulations on the Team Achievement";
    case "OPERATIONAL":   return "e.g. New equipment installation on Monday";
    case "URGENT":        return "e.g. Immediate action: office access change";
    case "COMMUNICATION": return "e.g. Employee engagement survey — 5 minutes";
    case "CORPORATE":     return "e.g. Leadership announcement — Q3 update";
    default:              return "Announcement title";
  }
}


// Colour palette per type. Kept in sync with the ESS panel so the
// same category reads visually the same on both sides.
const TYPE_PILLS = {
  GENERAL:       { bg: "#f1f5f9", fg: "#334155", label: "General" },
  HR:            { bg: "#eff6ff", fg: "#1d4ed8", label: "HR" },
  MEETING:       { bg: "#eef2ff", fg: "#4338ca", label: "Meeting" },
  EVENT:         { bg: "#f5f3ff", fg: "#6d28d9", label: "Event" },
  HOLIDAY:       { bg: "#fffbeb", fg: "#b45309", label: "Holiday" },
  SAFETY:        { bg: "#fef2f2", fg: "#b91c1c", label: "Safety" },
  IT:            { bg: "#ecfeff", fg: "#0e7490", label: "IT" },
  ACHIEVEMENT:   { bg: "#ecfdf5", fg: "#047857", label: "Achievement" },
  OPERATIONAL:   { bg: "#f0fdfa", fg: "#0f766e", label: "Operational" },
  URGENT:        { bg: "#dc2626", fg: "#ffffff", label: "Urgent" },
  COMMUNICATION: { bg: "#f0f9ff", fg: "#0369a1", label: "Communication" },
  CORPORATE:     { bg: "#faf5ff", fg: "#7e22ce", label: "Corporate" },
  // Legacy alias — a NOTICE row from the earlier three-type version
  // reads as General so nothing shows up as an unknown pill.
  NOTICE:        { bg: "#f1f5f9", fg: "#334155", label: "General" },
};

function TypePill({ type }) {
  const t = TYPE_PILLS[type] || { bg: "#f1f5f9", fg: "#334155", label: type };
  const isUrgent = type === "URGENT";
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      background: t.bg,
      color: t.fg,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      boxShadow: isUrgent ? "0 4px 10px rgba(220,38,38,0.25)" : undefined,
    }}>
      {t.label}
    </span>
  );
}


function FormField({ label, required, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: "#64748b",
      }}>
        {label} {required && <span style={{ color: BVC_RED }}>*</span>}
      </label>
      {children}
    </div>
  );
}


const styles = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    padding: 24,
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#1e293b",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  eyebrow: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4,
    color: BVC_RED, textTransform: "uppercase", marginBottom: 4,
  },
  h1: { fontSize: 24, fontWeight: 800, letterSpacing: -0.4, margin: 0 },
  sub: { fontSize: 13.5, color: "#64748b", marginTop: 6, maxWidth: 620 },
  primaryBtn: {
    padding: "10px 20px",
    background: `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`,
    color: "#ffffff",
    border: "none",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 6px 16px rgba(220,38,38,0.28)",
  },
  secondaryBtn: {
    padding: "10px 20px",
    background: "#ffffff",
    color: "#475569",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  filterRow: {
    display: "flex", alignItems: "center", gap: 12,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "10px 14px",
    flexWrap: "wrap",
  },
  filterLabel: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7,
    color: "#94a3b8", textTransform: "uppercase",
  },
  filterCount: {
    marginLeft: "auto",
    fontSize: 12, color: "#94a3b8", fontWeight: 600,
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 16,
    minHeight: 120,
  },
  muted: { color: "#94a3b8", fontSize: 13, padding: 12 },
  error: {
    padding: "10px 14px",
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
  },
  empty: {
    padding: "22px 16px",
    color: "#64748b",
    fontSize: 13,
    textAlign: "center",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    borderRadius: 8,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  thead: {
    background: "#f8fafc",
    fontSize: 10.5,
    letterSpacing: 0.7,
    color: "#64748b",
    textTransform: "uppercase",
  },
  th: {
    padding: "10px 12px",
    textAlign: "left",
    fontWeight: 700,
    borderBottom: "1px solid #e2e8f0",
  },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px 12px", verticalAlign: "top" },
  linkBtn: {
    background: "transparent",
    border: "none",
    color: BVC_RED,
    fontFamily: "inherit",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    padding: "4px 8px",
  },
  dangerLink: {
    background: "transparent",
    border: "none",
    color: "#64748b",
    fontFamily: "inherit",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    padding: "4px 8px",
    marginLeft: 4,
  },

  modalBackdrop: {
    position: "fixed", inset: 0, zIndex: 10000,
    background: "rgba(15, 23, 42, 0.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 20,
  },
  modal: {
    background: "#ffffff",
    borderRadius: 14,
    maxWidth: 560,
    width: "100%",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 30px 60px rgba(15,23,42,0.35)",
    fontFamily: "inherit",
    color: "#1e293b",
    overflow: "hidden",
  },
  modalHead: {
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeBtn: {
    background: "transparent", border: "none",
    fontSize: 24, cursor: "pointer",
    color: "#64748b", padding: 0, lineHeight: 1,
  },
  modalBody: {
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    overflowY: "auto",
  },
  modalFoot: {
    padding: "14px 20px",
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 13,
    color: "#1e293b",
    background: "#ffffff",
    boxSizing: "border-box",
  },
};
