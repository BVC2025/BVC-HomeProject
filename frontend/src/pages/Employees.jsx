import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";


const VENDOR_ID = 1;

const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];

const EMPLOYMENT_TYPES = ["FRESHER", "EXPERIENCED"];

const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"];


// =====================================================================
// Utility — avatar from name initials when no photo uploaded
// =====================================================================

function initials(name) {

  return (name || "")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}


function avatarGradient(name) {

  const palette = [
    "linear-gradient(135deg, #C8102E, #8B0B1F)",
    "linear-gradient(135deg, #C8102E, #8B0B1F)",
    "linear-gradient(135deg, #10b981, #047857)",
    "linear-gradient(135deg, #F4B324, #8B0B1F)",
    "linear-gradient(135deg, #06b6d4, #0e7490)",
    "linear-gradient(135deg, #C8102E, #8B0B1F)",
    "linear-gradient(135deg, #ef4444, #b91c1c)",
    "linear-gradient(135deg, #0ea5e9, #1e40af)"
  ];

  let hash = 0;

  const txt = (name || "").toString();

  for (let i = 0; i < txt.length; i++) hash = (hash * 31 + txt.charCodeAt(i)) >>> 0;

  return palette[hash % palette.length];
}


function Avatar({ employee, size = 56, dataUrl }) {

  const photoUrl = dataUrl || (
    employee?.PHOTO_URL ? `${API_BASE_URL}${employee.PHOTO_URL}` : null
  );

  if (photoUrl) {

    return (

      <img
        src={photoUrl}
        alt={employee?.NAME || ""}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          border: "2px solid white",
          boxShadow: "0 4px 12px rgba(15,23,42,0.18)"
        }}
      />
    );
  }

  return (

    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: avatarGradient(employee?.NAME),
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: size * 0.38,
        letterSpacing: 0.5,
        border: "2px solid white",
        boxShadow: "0 4px 12px rgba(15,23,42,0.18)",
        flexShrink: 0
      }}
    >
      {initials(employee?.NAME)}
    </div>
  );
}


function Pill({ children, bg = "#e0e7ff", fg = "#4338ca" }) {

  return (

    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      background: bg,
      color: fg,
      letterSpacing: 0.4,
      textTransform: "uppercase"
    }}>
      {children}
    </span>
  );
}


function StatTile({ label, value, sub, color }) {

  return (

    <div style={{
      background: "white",
      padding: "16px 20px",
      borderRadius: 14,
      boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
      borderTop: `3px solid ${color}`
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 1.5,
        color: "#64748b",
        textTransform: "uppercase"
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 26,
        fontWeight: 900,
        color: "#0f172a",
        marginTop: 4
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


// 8-colour theme palette cycled deterministically from EMPLOYEE_CODE.
// Same code always gets the same colour, so the directory looks the
// same across refreshes.
const CARD_THEMES = [
  { tag: "#dbeafe", tagFg: "#1d4ed8", title: "#2563eb", btn: "linear-gradient(135deg,#3b82f6,#2563eb)", chip: "#eff6ff", chipFg: "#1d4ed8", deptBg: "#eff6ff", deptFg: "#1d4ed8" }, // blue
  { tag: "#d1fae5", tagFg: "#047857", title: "#059669", btn: "linear-gradient(135deg,#10b981,#059669)", chip: "#ecfdf5", chipFg: "#047857", deptBg: "#ecfdf5", deptFg: "#047857" }, // green
  { tag: "#ede9fe", tagFg: "#6d28d9", title: "#7c3aed", btn: "linear-gradient(135deg,#8b5cf6,#7c3aed)", chip: "#f5f3ff", chipFg: "#6d28d9", deptBg: "#f5f3ff", deptFg: "#6d28d9" }, // purple
  { tag: "#fed7aa", tagFg: "#c2410c", title: "#ea580c", btn: "linear-gradient(135deg,#f97316,#ea580c)", chip: "#fff7ed", chipFg: "#c2410c", deptBg: "#fff7ed", deptFg: "#c2410c" }, // orange
  { tag: "#fce7f3", tagFg: "#be185d", title: "#db2777", btn: "linear-gradient(135deg,#ec4899,#db2777)", chip: "#fdf2f8", chipFg: "#be185d", deptBg: "#fdf2f8", deptFg: "#be185d" }, // pink
  { tag: "#cffafe", tagFg: "#0e7490", title: "#0891b2", btn: "linear-gradient(135deg,#06b6d4,#0891b2)", chip: "#ecfeff", chipFg: "#0e7490", deptBg: "#ecfeff", deptFg: "#0e7490" }, // teal
  { tag: "#fef3c7", tagFg: "#a16207", title: "#d97706", btn: "linear-gradient(135deg,#f59e0b,#d97706)", chip: "#fffbeb", chipFg: "#a16207", deptBg: "#fffbeb", deptFg: "#a16207" }, // amber
  { tag: "#e0e7ff", tagFg: "#4338ca", title: "#4f46e5", btn: "linear-gradient(135deg,#6366f1,#4f46e5)", chip: "#eef2ff", chipFg: "#4338ca", deptBg: "#eef2ff", deptFg: "#4338ca" }, // indigo
];

function pickTheme(code) {
  const s = String(code || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CARD_THEMES[h % CARD_THEMES.length];
}

function fmtJoinDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return null; }
}

function statusBadge(emp) {
  // Heuristic — most employee profiles only have STATUS = ACTIVE.
  // Show "On Leave" if a dashboard column hints at it.
  const onLeave = (emp.LEAVE_STATUS || "").toUpperCase() === "ON_LEAVE"
               || (emp.TODAY_STATUS || "").toUpperCase() === "ON_LEAVE";
  if (onLeave) return { label: "On Leave", dot: "#f59e0b", fg: "#92400e" };
  if (emp.STATUS && emp.STATUS.toUpperCase() !== "ACTIVE") {
    return { label: emp.STATUS, dot: "#94a3b8", fg: "#475569" };
  }
  return { label: "Active", dot: "#10b981", fg: "#166534" };
}


function EmployeeCard({ employee, onView, onEdit, onDelete }) {

  const skills = (employee.SKILLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const theme  = pickTheme(employee.EMPLOYEE_CODE);
  const status = statusBadge(employee);
  const joined = fmtJoinDate(employee.JOINING_DATE);
  const city   = [employee.CITY, employee.STATE].filter(Boolean).join(", ");

  return (
    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
        transition: "transform 0.18s, box-shadow 0.18s",
        position: "relative",
        overflow: "hidden",
        animation: "empFadeIn 0.4s ease-out both",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 14px 32px rgba(15,23,42,0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 6px 18px rgba(15,23,42,0.06)";
      }}
    >

      {/* ===== TOP ROW: EMP code tag + Status pill ===== */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 14,
      }}>
        <span style={{
          background: theme.tag,
          color: theme.tagFg,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.4,
          padding: "4px 10px",
          borderRadius: 6,
        }}>
          {employee.EMPLOYEE_CODE || "—"}
        </span>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          color: status.fg,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: status.dot, display: "inline-block",
          }} />
          {status.label}
        </div>
      </div>

      {/* ===== PHOTO + NAME + TITLE ===== */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 12 }}>
        <Avatar employee={employee} size={64} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 17,
            fontWeight: 800,
            color: "#0f172a",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {employee.NAME || "—"}
          </div>
          {employee.DESIGNATION?.TITLE && (
            <div style={{
              fontSize: 13,
              color: theme.title,
              fontWeight: 700,
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {employee.DESIGNATION.TITLE}
            </div>
          )}
        </div>
      </div>

      {/* ===== Department chip ===== */}
      {employee.DEPARTMENT?.NAME && (
        <div style={{ marginBottom: 12 }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: theme.deptBg,
            color: theme.deptFg,
            border: `1px solid ${theme.deptBg}`,
            fontSize: 11,
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 999,
          }}>
            <span style={{ fontSize: 11 }}>🏢</span>
            {employee.DEPARTMENT.NAME}
          </span>
        </div>
      )}

      {/* ===== Contact info rows ===== */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, marginBottom: 12 }}>
        {employee.EMAIL && (
          <div style={contactRow(theme.title)}>
            <span style={iconBox(theme.deptBg)}>✉</span>
            <span style={contactTextStyle}>{employee.EMAIL}</span>
          </div>
        )}
        {employee.PHONE && (
          <div style={contactRow(theme.title)}>
            <span style={iconBox(theme.deptBg)}>📞</span>
            <span style={contactTextStyle}>{employee.PHONE}</span>
          </div>
        )}
        {city && (
          <div style={contactRow(theme.title)}>
            <span style={iconBox(theme.deptBg)}>📍</span>
            <span style={contactTextStyle}>{city}</span>
          </div>
        )}
        {joined && (
          <div style={contactRow(theme.title)}>
            <span style={iconBox(theme.deptBg)}>📅</span>
            <span style={contactTextStyle}>Joined on {joined}</span>
          </div>
        )}
      </div>

      {/* ===== Skills chips ===== */}
      {skills.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#475569",
            marginBottom: 6,
          }}>
            Skills
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {skills.slice(0, 6).map((s, i) => (
              <span key={i} style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 10px",
                background: theme.chip,
                color: theme.chipFg,
                borderRadius: 6,
              }}>
                {s}
              </span>
            ))}
            {skills.length > 6 && (
              <span style={{
                fontSize: 11, color: "#94a3b8", padding: "4px 8px",
              }}>
                +{skills.length - 6}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ===== Bottom action row ===== */}
      <div style={{
        display: "flex",
        gap: 8,
        marginTop: "auto",
        alignItems: "stretch",
      }}>
        <button
          onClick={() => onView(employee)}
          style={{
            flex: 1,
            background: theme.btn,
            color: "white",
            border: "none",
            padding: "11px 12px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            letterSpacing: 0.2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
          }}
        >
          <span>👤</span> View Profile
        </button>

        <button
          onClick={() => onEdit?.(employee)}
          title="Edit"
          style={iconBtn("#eff6ff", "#1d4ed8")}
        >
          ✏️
        </button>

        <button
          onClick={() => onDelete(employee)}
          title="Delete"
          style={iconBtn("#fef2f2", "#b91c1c")}
        >
          🗑
        </button>
      </div>
    </div>
  );
}


// ---- small style helpers used by EmployeeCard ----
const contactTextStyle = {
  fontSize: 12,
  color: "#475569",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
};

function contactRow() {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  };
}

function iconBox(bg) {
  return {
    width: 22,
    height: 22,
    borderRadius: 6,
    background: bg,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    flexShrink: 0,
  };
}

function iconBtn(bg, fg) {
  return {
    background: bg,
    color: fg,
    border: "none",
    padding: "9px 11px",
    borderRadius: 10,
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}


// =====================================================================
// Resume-style "View Data" modal
// =====================================================================

// HR Module — Phase B: Documents block rendered inside ResumeModal.
// Self-contained: fetches its own list, handles upload + delete.

// Grouped by category for the optgroup UI — every key must also exist
// in the backend whitelist (backend/app/routes/employee_documents.py).
const DOC_TYPES = [
  // ---- Identity ----
  { key: "AADHAAR",              label: "Aadhaar",                  icon: "🪪", group: "Identity" },
  { key: "PAN",                  label: "PAN",                      icon: "🆔", group: "Identity" },
  { key: "VOTER_ID",             label: "Voter ID",                 icon: "🗳️", group: "Identity" },
  { key: "PASSPORT",             label: "Passport",                 icon: "🛂", group: "Identity" },
  { key: "DRIVING_LICENSE",      label: "Driving License",          icon: "🚗", group: "Identity" },

  // ---- Education ----
  { key: "TENTH_MARKSHEET",      label: "10th Marksheet / SSLC",    icon: "📘", group: "Education" },
  { key: "TWELFTH_MARKSHEET",    label: "12th Marksheet / HSC",     icon: "📗", group: "Education" },
  { key: "DIPLOMA",              label: "Diploma / ITI",            icon: "📙", group: "Education" },
  { key: "DEGREE",               label: "Degree (UG)",              icon: "🎓", group: "Education" },
  { key: "POSTGRADUATE",         label: "Post-Graduate (PG)",       icon: "🎓", group: "Education" },
  { key: "EDUCATIONAL",          label: "Other Educational",        icon: "📚", group: "Education" },
  { key: "CERTIFICATE",          label: "Professional Certificate", icon: "📜", group: "Education" },

  // ---- Employment ----
  { key: "RESUME",               label: "Resume / CV",              icon: "📄", group: "Employment" },
  { key: "OFFER_LETTER",         label: "Offer Letter",             icon: "📃", group: "Employment" },
  { key: "JOINING_LETTER",       label: "Joining Letter",           icon: "✍️", group: "Employment" },
  { key: "EXPERIENCE_LETTER",    label: "Experience Letter",        icon: "🏅", group: "Employment" },
  { key: "RELIEVING_LETTER",     label: "Relieving Letter",         icon: "🗒️", group: "Employment" },
  { key: "SALARY_SLIP",          label: "Previous Salary Slip",     icon: "💰", group: "Employment" },

  // ---- Personal / Banking ----
  { key: "PHOTO",                label: "Photograph",               icon: "🖼️", group: "Personal" },
  { key: "BIRTH_CERTIFICATE",    label: "Birth Certificate",        icon: "👶", group: "Personal" },
  { key: "MARRIAGE_CERTIFICATE", label: "Marriage Certificate",     icon: "💍", group: "Personal" },
  { key: "ADDRESS_PROOF",        label: "Address Proof",            icon: "🏠", group: "Personal" },
  { key: "BANK_PASSBOOK",        label: "Bank Passbook / Cheque",   icon: "🏦", group: "Personal" },

  // ---- Catch-all ----
  { key: "OTHER",                label: "Other",                    icon: "📁", group: "Other" },
];

const DOC_TYPE_LABEL = Object.fromEntries(
  DOC_TYPES.map((d) => [d.key, `${d.icon} ${d.label}`])
);

function EmployeeDocumentsSection({ employee }) {

  const empId = employee?.ID;

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState({
    doc_type: "RESUME",
    title: "",
    notes: "",
    file: null
  });

  const fetchDocs = async () => {

    if (!empId) return;

    setLoading(true);

    setError("");

    try {

      const res = await API.get(`/employees/${empId}/documents`);

      setDocs(res.data || []);

    } catch (e) {

      setError(e?.response?.data?.detail || "Could not load documents.");

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => { fetchDocs(); /* eslint-disable-next-line */ }, [empId]);

  const upload = async (e) => {

    e?.preventDefault?.();

    if (!draft.file) {

      setError("Pick a file first.");

      return;
    }

    setPending(true);

    setError("");

    const fd = new FormData();

    fd.append("file", draft.file);

    fd.append("doc_type", draft.doc_type);

    if (draft.title.trim()) fd.append("title", draft.title.trim());

    if (draft.notes.trim()) fd.append("notes", draft.notes.trim());

    try {

      await API.post(`/employees/${empId}/documents`, fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      setDraft({ doc_type: draft.doc_type, title: "", notes: "", file: null });

      // reset the file input visually
      const input = document.getElementById(`emp-doc-file-${empId}`);

      if (input) input.value = "";

      fetchDocs();

    } catch (e) {

      setError(e?.response?.data?.detail || "Upload failed.");

    } finally {

      setPending(false);
    }
  };

  const removeDoc = async (doc) => {

    if (!window.confirm(
      `Delete "${doc.TITLE || doc.FILE_NAME || "this document"}"?`
    )) return;

    try {

      await API.delete(`/employees/${empId}/documents/${doc.ID}`);

      fetchDocs();

    } catch (e) {

      alert(e?.response?.data?.detail || "Delete failed.");
    }
  };

  const formatBytes = (n) => {
    if (!n) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Group docs by type for display
  const grouped = docs.reduce((acc, d) => {
    (acc[d.DOC_TYPE] ||= []).push(d);
    return acc;
  }, {});

  return (
    <ResumeBlock title="📂 Documents">

      {/* Upload row */}
      <form onSubmit={upload} style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr 1fr auto",
        gap: 8,
        alignItems: "end",
        padding: 14,
        background: "linear-gradient(135deg,#fef2f2,#fff5f5)",
        border: "1px dashed #fecaca",
        borderRadius: 10,
        marginBottom: 14
      }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#7f1d1d" }}>
          DOCUMENT TYPE
          <select
            value={draft.doc_type}
            onChange={(e) => setDraft((d) => ({ ...d, doc_type: e.target.value }))}
            style={{
              width: "100%",
              marginTop: 4,
              padding: "8px 10px",
              border: "1px solid #fecaca",
              borderRadius: 6,
              fontSize: 13,
              background: "white"
            }}
          >
            {/* Render as grouped <optgroup> so the 24 types scan easily */}
            {(() => {

              const grouped = DOC_TYPES.reduce((acc, t) => {

                (acc[t.group || "Other"] ||= []).push(t);

                return acc;
              }, {});

              const order = ["Identity", "Education", "Employment", "Personal", "Other"];

              return order
                .filter((g) => grouped[g])
                .map((g) => (

                  <optgroup key={g} label={g}>
                    {grouped[g].map((t) => (
                      <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
                    ))}
                  </optgroup>
                ));
            })()}
          </select>
        </label>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#7f1d1d" }}>
          TITLE (optional)
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="e.g. Aadhaar — Front"
            style={{
              width: "100%",
              marginTop: 4,
              padding: "8px 10px",
              border: "1px solid #fecaca",
              borderRadius: 6,
              fontSize: 13
            }}
          />
        </label>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#7f1d1d" }}>
          FILE (PDF / Image / DOC / XLS · max 10 MB)
          <input
            id={`emp-doc-file-${empId}`}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setDraft((d) => ({ ...d, file: e.target.files?.[0] || null }))}
            style={{ width: "100%", marginTop: 4, fontSize: 12 }}
          />
        </label>
        <button
          type="submit"
          disabled={pending || !draft.file}
          style={{
            padding: "10px 18px",
            background: pending || !draft.file
              ? "#cbd5e1"
              : "linear-gradient(135deg,#C8102E,#8B0B1F)",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontWeight: 800,
            fontSize: 12,
            cursor: pending || !draft.file ? "not-allowed" : "pointer",
            whiteSpace: "nowrap"
          }}
        >
          {pending ? "Uploading…" : "⬆ Upload"}
        </button>
      </form>

      {error && (
        <div style={{
          padding: "8px 12px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 6,
          fontSize: 12,
          marginBottom: 12
        }}>
          ⚠ {error}
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
          Loading documents…
        </div>
      )}

      {!loading && docs.length === 0 && !error && (
        <div style={{
          padding: "16px 12px",
          background: "#f8fafc",
          border: "1px dashed #cbd5e1",
          borderRadius: 8,
          fontSize: 12,
          color: "#64748b",
          textAlign: "center",
          fontStyle: "italic"
        }}>
          No documents uploaded yet. Use the form above to add Aadhaar, PAN,
          Resume, Offer Letter, etc.
        </div>
      )}

      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1,
            color: "#7f1d1d",
            marginBottom: 6,
            textTransform: "uppercase"
          }}>
            {DOC_TYPE_LABEL[type] || type} · {items.length}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {items.map((d) => (
              <div key={d.ID} style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 12px",
                background: "white",
                border: "1px solid #e2e8f0",
                borderRadius: 8
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {d.TITLE || d.FILE_NAME || `Document #${d.ID}`}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {d.FILE_NAME && d.FILE_NAME !== d.TITLE
                      ? `${d.FILE_NAME} · `
                      : ""}
                    {formatBytes(d.SIZE_BYTES)}
                    {d.UPLOADED_AT
                      ? ` · ${d.UPLOADED_AT.slice(0, 10)}`
                      : ""}
                    {d.NOTES ? ` · ${d.NOTES}` : ""}
                  </div>
                </div>
                <a
                  href={`${API.defaults.baseURL || ""}${d.FILE_URL}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "6px 10px",
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    textDecoration: "none"
                  }}
                >
                  👁 View
                </a>
                <a
                  href={`${API.defaults.baseURL || ""}${d.FILE_URL}`}
                  download={d.FILE_NAME || "document"}
                  style={{
                    padding: "6px 10px",
                    background: "#f0fdf4",
                    color: "#15803d",
                    border: "1px solid #bbf7d0",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    textDecoration: "none"
                  }}
                >
                  ⬇ Download
                </a>
                <button
                  type="button"
                  onClick={() => removeDoc(d)}
                  style={{
                    padding: "6px 10px",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  🗑 Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

    </ResumeBlock>
  );
}


function ResumeModal({ employee, photoDataUrl, onClose }) {

  if (!employee) return null;

  const skills = (employee.SKILLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (

    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        zIndex: 1100,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 40
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 100%)",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
          animation: "empFadeIn 0.25s ease-out both",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {/* Fixed header — stays visible while body scrolls */}
        <div style={{
          background: "linear-gradient(120deg, #1A0508 0%, #4A0E18 35%, #8B0B1F 65%, #C8102E 100%)",
          padding: "36px 40px",
          color: "white",
          position: "relative",
          flexShrink: 0
        }}>
          <button
            onClick={onClose}
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              background: "rgba(255,255,255,0.2)",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "4px 12px",
              cursor: "pointer",
              fontSize: 18
            }}
          >
            ×
          </button>

          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <Avatar employee={employee} size={120} dataUrl={photoDataUrl} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11,
                letterSpacing: 2,
                opacity: 0.85,
                fontWeight: 700,
                textTransform: "uppercase"
              }}>
                Employee Profile
              </div>
              <h1 style={{
                fontSize: 32,
                fontWeight: 900,
                margin: "4px 0 6px",
                letterSpacing: -0.5,
                lineHeight: 1.15,
                color: "white"
              }}>
                {employee.NAME}
              </h1>
              <div style={{ fontSize: 14, opacity: 0.9 }}>
                {employee.DESIGNATION?.TITLE || "—"}
                {employee.DEPARTMENT?.NAME && (
                  <> · {employee.DEPARTMENT.NAME}</>
                )}
              </div>
              <div style={{
                marginTop: 8,
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                background: "rgba(255,255,255,0.18)",
                padding: "4px 12px",
                borderRadius: 6,
                display: "inline-block",
                fontWeight: 700,
                letterSpacing: 1
              }}>
                {employee.EMPLOYEE_CODE}
              </div>
            </div>
          </div>
        </div>

        {/* Body: balanced 2-column identity grid at top, then
            full-width content sections below. Scrollable area —
            only this part scrolls, keeping the red profile header
            pinned in view. */}
        <div style={{
          padding: 32,
          overflowY: "auto",
          flex: 1,
          minHeight: 0
        }}>

          {/* Top — identity grid: Contact | Personal */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 32,
            marginBottom: 8
          }}>

            <div>
              <ResumeBlock title="Contact">
                {employee.EMAIL && <ResumeRow icon="✉️" label="Email" value={employee.EMAIL} />}
                {employee.PHONE && <ResumeRow icon="📞" label="Phone" value={employee.PHONE} />}
                {employee.ADDRESS && <ResumeRow icon="🏠" label="Address" value={employee.ADDRESS} />}
                {employee.CITY && <ResumeRow icon="🏙️" label="City" value={employee.CITY} />}
                {employee.STATE && <ResumeRow icon="🗺️" label="State" value={employee.STATE} />}
                {employee.PINCODE && <ResumeRow icon="📮" label="Pincode" value={employee.PINCODE} />}
              </ResumeBlock>
            </div>

            <div>
              <ResumeBlock title="Personal">
                {employee.FATHER_NAME && (
                  <ResumeRow icon="👨" label="Father" value={employee.FATHER_NAME} />
                )}
                {employee.MOTHER_NAME && (
                  <ResumeRow icon="👩" label="Mother" value={employee.MOTHER_NAME} />
                )}
                {employee.DOB && <ResumeRow icon="🎂" label="DOB" value={employee.DOB} />}
                {employee.GENDER && (
                  <ResumeRow icon="👤" label="Gender" value={employee.GENDER.replace("_", " ")} />
                )}
                {employee.MARITAL_STATUS && (
                  <ResumeRow icon="💍" label="Marital" value={employee.MARITAL_STATUS} />
                )}
                {employee.OCCUPATION && (
                  <ResumeRow icon="🧰" label="Occupation" value={employee.OCCUPATION} />
                )}
                {employee.BLOOD_GROUP && (
                  <ResumeRow icon="🩸" label="Blood" value={employee.BLOOD_GROUP} />
                )}
                {employee.NATIONALITY && (
                  <ResumeRow icon="🌍" label="Nationality" value={employee.NATIONALITY} />
                )}
              </ResumeBlock>

              {(employee.EMERGENCY_CONTACT_NAME ||
                employee.EMERGENCY_CONTACT_PHONE ||
                employee.EMERGENCY_CONTACT_RELATION) && (
                <div style={{ marginTop: 14 }}>
                  <ResumeBlock title="Emergency Contact">
                    {employee.EMERGENCY_CONTACT_NAME && (
                      <ResumeRow icon="🆘" label="Name" value={employee.EMERGENCY_CONTACT_NAME} />
                    )}
                    {employee.EMERGENCY_CONTACT_PHONE && (
                      <ResumeRow icon="📞" label="Phone" value={employee.EMERGENCY_CONTACT_PHONE} />
                    )}
                    {employee.EMERGENCY_CONTACT_RELATION && (
                      <ResumeRow icon="❤️" label="Relation" value={employee.EMERGENCY_CONTACT_RELATION} />
                    )}
                  </ResumeBlock>
                </div>
              )}
            </div>

          </div>

          {/* Middle — Education | Employment side by side */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 32,
            marginBottom: 8
          }}>

            <div>
              <ResumeBlock title="Education">
                {employee.QUALIFICATION && (
                  <ResumeRow icon="🎓" label="Degree" value={employee.QUALIFICATION} />
                )}
                {employee.COLLEGE && (
                  <ResumeRow icon="🏫" label="College" value={employee.COLLEGE} />
                )}
                {employee.UNIVERSITY && (
                  <ResumeRow icon="🏛️" label="University" value={employee.UNIVERSITY} />
                )}
                {employee.YEAR_OF_PASSING && (
                  <ResumeRow icon="📅" label="Year" value={employee.YEAR_OF_PASSING} />
                )}
                {employee.PERCENTAGE != null && employee.PERCENTAGE !== "" && (
                  <ResumeRow icon="📊" label="Score" value={`${employee.PERCENTAGE}%`} />
                )}
                {!employee.QUALIFICATION && !employee.YEAR_OF_PASSING &&
                 !employee.COLLEGE && !employee.UNIVERSITY && employee.PERCENTAGE == null && (
                  <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
                    No education info on file
                  </div>
                )}
              </ResumeBlock>
            </div>

            <div>
              <ResumeBlock title="Employment">
                {employee.ROLE?.NAME && (
                  <ResumeRow icon="🎯" label="Role" value={employee.ROLE.NAME} />
                )}
                {employee.EMPLOYMENT_TYPE && (
                  <ResumeRow icon="📋" label="Type" value={employee.EMPLOYMENT_TYPE} />
                )}
                {employee.STATUS && (
                  <ResumeRow icon="⚡" label="Status" value={employee.STATUS} />
                )}
                {employee.JOINING_DATE && (
                  <ResumeRow icon="📆" label="Joined" value={employee.JOINING_DATE} />
                )}
                {employee.CONFIRMATION_DATE && (
                  <ResumeRow icon="✅" label="Confirmed" value={employee.CONFIRMATION_DATE} />
                )}
                {employee.WORK_LOCATION && (
                  <ResumeRow icon="📍" label="Location" value={employee.WORK_LOCATION} />
                )}
                {(Number(employee.EXPERIENCE_YEARS) || 0) > 0 && (
                  <ResumeRow
                    icon="⏳"
                    label="Experience"
                    value={`${employee.EXPERIENCE_YEARS} year(s)`}
                  />
                )}
                {employee.PREVIOUS_COMPANY && (
                  <ResumeRow icon="🏢" label="Prev. Company" value={employee.PREVIOUS_COMPANY} />
                )}
                {employee.PREVIOUS_SALARY != null && employee.PREVIOUS_SALARY !== "" && (
                  <ResumeRow
                    icon="💰"
                    label="Prev. Salary"
                    value={`₹${Number(employee.PREVIOUS_SALARY).toLocaleString("en-IN")}`}
                  />
                )}
              </ResumeBlock>
            </div>

          </div>

          {/* Bottom — full-width content-heavy sections */}
          {skills.length > 0 && (
            <ResumeBlock title="🧠 Skills">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {skills.map((s, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 12,
                      padding: "5px 12px",
                      background: "linear-gradient(135deg, #eef2ff, #ede9fe)",
                      color: "#4338ca",
                      border: "1px solid #c7d2fe",
                      borderRadius: 999,
                      fontWeight: 700
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </ResumeBlock>
          )}

          {/* Two-column flex for Work Experience + Past Projects */}
          {(employee.EXPERIENCE_DETAILS || employee.PAST_PROJECTS) && (
            <div style={{
              display: "grid",
              gridTemplateColumns: (
                employee.EXPERIENCE_DETAILS && employee.PAST_PROJECTS
                  ? "1fr 1fr"
                  : "1fr"
              ),
              gap: 24
            }}>
              {employee.EXPERIENCE_DETAILS && (
                <ResumeBlock title="💼 Work Experience">
                  <div style={{
                    fontSize: 13,
                    color: "#334155",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    background: "#f8fafc",
                    padding: 14,
                    borderRadius: 10,
                    borderLeft: "3px solid #6366f1"
                  }}>
                    {employee.EXPERIENCE_DETAILS}
                  </div>
                </ResumeBlock>
              )}

              {employee.PAST_PROJECTS && (
                <ResumeBlock title="🏗 Past Projects">
                  <div style={{
                    fontSize: 13,
                    color: "#334155",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    background: "#f8fafc",
                    padding: 14,
                    borderRadius: 10,
                    borderLeft: "3px solid #ec4899"
                  }}>
                    {employee.PAST_PROJECTS}
                  </div>
                </ResumeBlock>
              )}
            </div>
          )}

          {employee.NOTES && (
            <ResumeBlock title="📝 Notes">
              <div style={{
                fontSize: 13,
                color: "#334155",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                background: "#fffbeb",
                padding: 14,
                borderRadius: 10,
                borderLeft: "3px solid #f59e0b",
                fontStyle: "italic"
              }}>
                {employee.NOTES}
              </div>
            </ResumeBlock>
          )}

          {(employee.BANK_ACCOUNT_NUMBER || employee.BANK_NAME ||
            employee.IFSC_CODE || employee.PAN_NUMBER ||
            employee.AADHAAR_NUMBER) && (
            <ResumeBlock title="🏦 Bank & Identity">
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8
              }}>
                {employee.BANK_NAME && (
                  <ResumeRow icon="🏦" label="Bank" value={employee.BANK_NAME} />
                )}
                {employee.BANK_ACCOUNT_NUMBER && (
                  <ResumeRow icon="💳" label="Account" value={employee.BANK_ACCOUNT_NUMBER} />
                )}
                {employee.IFSC_CODE && (
                  <ResumeRow icon="🔢" label="IFSC" value={employee.IFSC_CODE} />
                )}
                {employee.PAN_NUMBER && (
                  <ResumeRow icon="🆔" label="PAN" value={employee.PAN_NUMBER} />
                )}
                {employee.AADHAAR_NUMBER && (
                  <ResumeRow icon="🪪" label="Aadhaar" value={employee.AADHAAR_NUMBER} />
                )}
              </div>
            </ResumeBlock>
          )}

          {/* HR Module — Phase B: Documents */}
          <EmployeeDocumentsSection employee={employee} />

          {(Number(employee.SALARY) || 0) > 0 && (
            <ResumeBlock title="💰 Compensation">
              <div style={{
                fontSize: 22,
                fontWeight: 900,
                color: "#065f46",
                fontFamily: "ui-monospace, monospace"
              }}>
                ₹ {Number(employee.SALARY).toLocaleString("en-IN")}
                <span style={{ fontSize: 13, color: "#64748b", marginLeft: 8 }}>
                  / month
                </span>
              </div>
            </ResumeBlock>
          )}

        </div>
      </div>
    </div>
  );
}


function ResumeBlock({ title, children }) {

  return (

    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 1.4,
        color: "#1e293b",
        textTransform: "uppercase",
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: "2px solid #e2e8f0"
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}


function ResumeRow({ icon, label, value }) {

  return (

    <div style={{
      display: "flex",
      gap: 10,
      padding: "6px 0",
      fontSize: 12,
      color: "#475569"
    }}>
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10,
          color: "#94a3b8",
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: "uppercase"
        }}>
          {label}
        </div>
        <div style={{ color: "#0f172a", fontWeight: 600, wordBreak: "break-word" }}>
          {value}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Add Employee modal — large form with View Data preview
// =====================================================================

function AddEmployeeModal({ onClose, onCreated, editingEmployee }) {

  // Dual-mode: create-new vs edit-existing. When editingEmployee is
  // passed, the form pre-fills with its values, EMPLOYEE_CODE +
  // PASSWORD become read-only/hidden, and submit hits PUT
  // /update-employee/{id} instead of POST /create-employee.
  const isEdit = !!editingEmployee?.ID;

  const [form, setForm] = useState({
    EMPLOYEE_CODE: editingEmployee?.EMPLOYEE_CODE || "",
    NAME: editingEmployee?.NAME || "",
    FATHER_NAME: editingEmployee?.FATHER_NAME || "",
    MOTHER_NAME: editingEmployee?.MOTHER_NAME || "",
    DOB: editingEmployee?.DOB || "",
    GENDER: editingEmployee?.GENDER || "",
    MARITAL_STATUS: editingEmployee?.MARITAL_STATUS || "",
    OCCUPATION: editingEmployee?.OCCUPATION || "",
    PHONE: editingEmployee?.PHONE || "",
    EMAIL: editingEmployee?.EMAIL || "",
    ADDRESS: editingEmployee?.ADDRESS || "",
    CITY: editingEmployee?.CITY || "",
    STATE: editingEmployee?.STATE || "",
    PINCODE: editingEmployee?.PINCODE || "",
    PASSWORD: "",
    QUALIFICATION: editingEmployee?.QUALIFICATION || "",
    YEAR_OF_PASSING: editingEmployee?.YEAR_OF_PASSING || "",
    EMPLOYMENT_TYPE: editingEmployee?.EMPLOYMENT_TYPE || "FRESHER",
    EXPERIENCE_YEARS: editingEmployee?.EXPERIENCE_YEARS || 0,
    SKILLS: editingEmployee?.SKILLS || "",
    EXPERIENCE_DETAILS: editingEmployee?.EXPERIENCE_DETAILS || "",
    PAST_PROJECTS: editingEmployee?.PAST_PROJECTS || "",
    NOTES: editingEmployee?.NOTES || "",
    DEPARTMENT_ID: editingEmployee?.DEPARTMENT_ID || "",
    DESIGNATION_ID: editingEmployee?.DESIGNATION_ID || "",
    ROLE_ID: editingEmployee?.ROLE_ID || "",
    // ---- Phase A — HR Module expansion ----
    BLOOD_GROUP: editingEmployee?.BLOOD_GROUP || "",
    NATIONALITY: editingEmployee?.NATIONALITY || "Indian",
    EMERGENCY_CONTACT_NAME: editingEmployee?.EMERGENCY_CONTACT_NAME || "",
    EMERGENCY_CONTACT_PHONE: editingEmployee?.EMERGENCY_CONTACT_PHONE || "",
    EMERGENCY_CONTACT_RELATION: editingEmployee?.EMERGENCY_CONTACT_RELATION || "",
    CONFIRMATION_DATE: editingEmployee?.CONFIRMATION_DATE || "",
    WORK_LOCATION: editingEmployee?.WORK_LOCATION || "",
    COLLEGE: editingEmployee?.COLLEGE || "",
    UNIVERSITY: editingEmployee?.UNIVERSITY || "",
    PERCENTAGE: editingEmployee?.PERCENTAGE ?? "",
    PREVIOUS_COMPANY: editingEmployee?.PREVIOUS_COMPANY || "",
    PREVIOUS_SALARY: editingEmployee?.PREVIOUS_SALARY ?? "",
    BANK_ACCOUNT_NUMBER: editingEmployee?.BANK_ACCOUNT_NUMBER || "",
    BANK_NAME: editingEmployee?.BANK_NAME || "",
    IFSC_CODE: editingEmployee?.IFSC_CODE || "",
    PAN_NUMBER: editingEmployee?.PAN_NUMBER || "",
    AADHAAR_NUMBER: editingEmployee?.AADHAAR_NUMBER || "",
    // ---- Salary structure (drives Payroll calculations) ----
    SAL_BASIC: "",
    SAL_HRA: "",
    SAL_DA: "",
    SAL_CONVEYANCE: "",
    SAL_MEDICAL: "",
    SAL_SPECIAL: "",
    SAL_OTHER: "",
    SAL_INCENTIVES: "",
    SAL_ANNUAL_BONUS: "",
    SAL_PT_STATE: "TAMIL_NADU",
    SAL_PF_APPLICABLE: true,
    SAL_ESI_APPLICABLE: true
  });

  // When opening for edit, fetch the existing salary structure (if any)
  // and prefill the SAL_* fields. Errors are non-fatal (no structure yet).
  useEffect(() => {

    if (!editingEmployee?.ID) return;

    API.get(`/payroll/salary-structures/${editingEmployee.ID}`)
      .then((res) => {

        const s = res.data || {};

        setForm((f) => ({
          ...f,
          SAL_BASIC: s.BASIC ?? "",
          SAL_HRA: s.HRA ?? "",
          SAL_DA: s.DA ?? "",
          SAL_CONVEYANCE: s.CONVEYANCE_ALLOWANCE ?? "",
          SAL_MEDICAL: s.MEDICAL_ALLOWANCE ?? "",
          SAL_SPECIAL: s.SPECIAL_ALLOWANCE ?? "",
          SAL_OTHER: s.OTHER_ALLOWANCES ?? "",
          SAL_INCENTIVES: s.INCENTIVES ?? "",
          SAL_ANNUAL_BONUS: s.ANNUAL_BONUS ?? "",
          SAL_PT_STATE: s.PT_STATE || "TAMIL_NADU",
          SAL_PF_APPLICABLE: s.PF_APPLICABLE !== false,
          SAL_ESI_APPLICABLE: s.ESI_APPLICABLE !== false
        }));
      })
      .catch(() => { /* 404 = no structure yet, leave fields blank */ });

  }, [editingEmployee?.ID]);

  const [photoFile, setPhotoFile] = useState(null);

  const [photoPreview, setPhotoPreview] = useState(null);

  const [departments, setDepartments] = useState([]);

  const [designations, setDesignations] = useState([]);

  const [roles, setRoles] = useState([]);

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {

    Promise.all([
      API.get("/departments").catch(() => ({ data: [] })),
      API.get("/designations").catch(() => ({ data: [] })),
      API.get("/roles").catch(() => ({ data: [] }))
    ]).then(([d, dg, r]) => {

      setDepartments(d.data || []);

      setDesignations(dg.data || []);

      setRoles(r.data || []);
    });

  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handlePhoto = (e) => {

    const file = e.target.files?.[0];

    if (!file) return;

    setPhotoFile(file);

    const reader = new FileReader();

    reader.onload = (ev) => setPhotoPreview(ev.target.result);

    reader.readAsDataURL(file);
  };

  const submit = async (e) => {

    e?.preventDefault?.();

    setError("");

    // Create-mode validation requires PASSWORD; edit-mode doesn't
    // touch the password here (admin uses /reset-password if needed).
    if (isEdit) {

      if (!form.NAME.trim()) {

        setError("Name is required.");

        return;
      }

    } else {

      if (!form.EMPLOYEE_CODE.trim() || !form.NAME.trim() || !form.PASSWORD.trim()) {

        setError("Employee ID, Name and Password are required.");

        return;
      }

      if (!form.ROLE_ID) {

        setError("Role is required.");

        return;
      }
    }

    setSaving(true);

    try {

      // Common numeric / date coercions
      const basePayload = {
        ...form,
        DEPARTMENT_ID: form.DEPARTMENT_ID ? Number(form.DEPARTMENT_ID) : null,
        DESIGNATION_ID: form.DESIGNATION_ID ? Number(form.DESIGNATION_ID) : null,
        YEAR_OF_PASSING: form.YEAR_OF_PASSING ? Number(form.YEAR_OF_PASSING) : null,
        EXPERIENCE_YEARS: Number(form.EXPERIENCE_YEARS) || 0,
        DOB: form.DOB || null,
        ROLE_ID: form.ROLE_ID ? Number(form.ROLE_ID) : null,
        // Phase A — HR Module expansion: coerce numbers + nullable date
        PERCENTAGE: form.PERCENTAGE === "" || form.PERCENTAGE == null
          ? null : Number(form.PERCENTAGE),
        PREVIOUS_SALARY: form.PREVIOUS_SALARY === "" || form.PREVIOUS_SALARY == null
          ? null : Number(form.PREVIOUS_SALARY),
        CONFIRMATION_DATE: form.CONFIRMATION_DATE || null
      };

      let empId;

      if (isEdit) {

        // EmployeeUpdate schema doesn't take EMPLOYEE_CODE / PASSWORD
        // — strip them. Admin can use /reset-password for that.
        const { EMPLOYEE_CODE, PASSWORD, ...editPayload } = basePayload;

        await API.put(
          `/update-employee/${editingEmployee.ID}`,
          editPayload
        );

        empId = editingEmployee.ID;

      } else {

        const payload = {
          ...basePayload,
          EMPLOYEE_CODE: form.EMPLOYEE_CODE.trim().toUpperCase(),
          VENDOR_ID
        };

        const res = await API.post("/create-employee", payload);

        empId = res.data?.employee_id;
      }

      if (photoFile && empId) {

        try {

          const fd = new FormData();

          fd.append("file", photoFile);

          await API.post(
            `/employees/${empId}/upload-photo`,
            fd,
            { headers: { "Content-Type": "multipart/form-data" } }
          );

        } catch {
          // non-fatal — employee saved, photo couldn't upload
        }
      }

      // Save salary structure (if any earnings field was filled).
      // Non-fatal: employee is already saved, so a salary failure
      // just means HR can come back and configure it later.
      if (empId) {

        const salFields = [
          form.SAL_BASIC, form.SAL_HRA, form.SAL_DA,
          form.SAL_CONVEYANCE, form.SAL_MEDICAL, form.SAL_SPECIAL,
          form.SAL_OTHER, form.SAL_INCENTIVES, form.SAL_ANNUAL_BONUS
        ];

        const hasAnySalary = salFields.some(
          (v) => v !== "" && v != null && Number(v) > 0
        );

        if (hasAnySalary) {

          try {

            await API.put(`/payroll/salary-structures/${empId}`, {
              BASIC:                Number(form.SAL_BASIC)        || 0,
              HRA:                  Number(form.SAL_HRA)          || 0,
              DA:                   Number(form.SAL_DA)           || 0,
              CONVEYANCE_ALLOWANCE: Number(form.SAL_CONVEYANCE)   || 0,
              MEDICAL_ALLOWANCE:    Number(form.SAL_MEDICAL)      || 0,
              SPECIAL_ALLOWANCE:    Number(form.SAL_SPECIAL)      || 0,
              OTHER_ALLOWANCES:     Number(form.SAL_OTHER)        || 0,
              INCENTIVES:           Number(form.SAL_INCENTIVES)   || 0,
              ANNUAL_BONUS:         Number(form.SAL_ANNUAL_BONUS) || 0,
              PT_STATE:             form.SAL_PT_STATE || "TAMIL_NADU",
              PF_APPLICABLE:        form.SAL_PF_APPLICABLE ? 1 : 0,
              ESI_APPLICABLE:       form.SAL_ESI_APPLICABLE ? 1 : 0
            });

          } catch (salErr) {

            console.error("Salary structure save failed:", salErr);
            // non-fatal — surface but don't block
          }
        }
      }

      onCreated?.();

    } catch (err) {

      console.error("Save employee failed:", err);

      const resp = err?.response;

      let message;

      if (!resp) {

        // No HTTP response at all — backend unreachable, CORS, etc.
        message = `Cannot reach server: ${err?.message || "network error"}`;

      } else if (Array.isArray(resp.data?.detail)) {

        // FastAPI / Pydantic 422 — detail is an array of field errors.
        // Convert to a human-readable list so the user sees exactly
        // which field is wrong instead of a generic "Failed" message.
        message = resp.data.detail
          .map((d) => {

            const field = (d.loc || [])
              .slice(1)
              .join(".") || "field";

            return `${field}: ${d.msg}`;
          })
          .join(" · ");

      } else if (typeof resp.data?.detail === "string") {

        // Standard FastAPI HTTPException — show the backend's message.
        message = resp.data.detail;

      } else if (resp.data?.message) {

        message = resp.data.message;

      } else {

        message = `Server error ${resp.status} — see browser console for details`;
      }

      setError(message);

    } finally {

      setSaving(false);
    }
  };

  // Synthesize a preview "employee" for the View Data modal
  const previewEmployee = useMemo(() => ({
    NAME: form.NAME || "(Name)",
    EMPLOYEE_CODE: form.EMPLOYEE_CODE || "EMP???",
    FATHER_NAME: form.FATHER_NAME,
    MOTHER_NAME: form.MOTHER_NAME,
    EMAIL: form.EMAIL,
    PHONE: form.PHONE,
    ADDRESS: form.ADDRESS,
    CITY: form.CITY,
    STATE: form.STATE,
    PINCODE: form.PINCODE,
    DOB: form.DOB,
    GENDER: form.GENDER,
    MARITAL_STATUS: form.MARITAL_STATUS,
    OCCUPATION: form.OCCUPATION,
    QUALIFICATION: form.QUALIFICATION,
    YEAR_OF_PASSING: form.YEAR_OF_PASSING,
    EXPERIENCE_YEARS: form.EXPERIENCE_YEARS,
    EXPERIENCE_DETAILS: form.EXPERIENCE_DETAILS,
    PAST_PROJECTS: form.PAST_PROJECTS,
    EMPLOYMENT_TYPE: form.EMPLOYMENT_TYPE,
    SKILLS: form.SKILLS,
    NOTES: form.NOTES,
    DEPARTMENT: departments.find((d) => d.ID === Number(form.DEPARTMENT_ID)) || null,
    DESIGNATION: designations.find((d) => d.ID === Number(form.DESIGNATION_ID)) || null,
    ROLE: (() => {
      const r = roles.find((x) => x.ID === Number(form.ROLE_ID));
      return r ? { NAME: r.ROLE_NAME } : null;
    })(),
    STATUS: "ACTIVE"
  }), [form, departments, designations, roles]);

  return (

    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end"
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: 800,
          maxWidth: "94%",
          background: "white",
          overflowY: "auto",
          padding: 0,
          boxShadow: "-30px 0 80px rgba(0,0,0,0.4)"
        }}
      >
        <div style={{
          background: "linear-gradient(135deg, #1A0508, #4A0E18, #8B0B1F)",
          color: "white",
          padding: "26px 32px",
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
              {isEdit ? "EMPLOYEE PROFILE" : "EMPLOYEE REGISTRATION"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>
              {isEdit
                ? `Edit ${editingEmployee.NAME || editingEmployee.EMPLOYEE_CODE}`
                : "Add New Employee"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              style={{
                background: "rgba(255,255,255,0.18)",
                color: "white",
                border: "1px solid rgba(255,255,255,0.3)",
                padding: "8px 16px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer"
              }}
            >
              👁 View Data
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.18)",
                color: "white",
                border: "none",
                padding: "8px 14px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 18
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ padding: 28 }}>

          {error && (
            <div style={{
              background: "#fef2f2",
              color: "#b91c1c",
              border: "1px solid #fecaca",
              padding: 12,
              borderRadius: 8,
              marginBottom: 18,
              fontSize: 13,
              fontWeight: 600
            }}>
              {error}
            </div>
          )}

          <div style={{
            background: "linear-gradient(135deg, #f5f3ff, #ede9fe)",
            border: "1px dashed #c4b5fd",
            borderRadius: 14,
            padding: 18,
            marginBottom: 22,
            display: "flex",
            gap: 18,
            alignItems: "center"
          }}>
            <div style={{
              width: 100,
              height: 100,
              borderRadius: "50%",
              background: photoPreview
                ? `url(${photoPreview}) center/cover`
                : avatarGradient(form.NAME),
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 38,
              border: "3px solid white",
              boxShadow: "0 6px 20px rgba(99,102,241,0.3)",
              flexShrink: 0
            }}>
              {!photoPreview && initials(form.NAME)}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                Passport-size photo
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                PNG / JPG / WEBP. Saved to the employee's profile.
                Will appear on cards, attendance views, and the resume.
              </div>
              <label
                htmlFor="emp-photo-input"
                style={{
                  display: "inline-block",
                  marginTop: 10,
                  background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
                  color: "white",
                  padding: "7px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700
                }}
              >
                {photoPreview ? "🔄 Change photo" : "📷 Upload photo"}
              </label>
              <input
                id="emp-photo-input"
                type="file"
                accept="image/*"
                onChange={handlePhoto}
                style={{ display: "none" }}
              />
            </div>
          </div>

          {/* ============== 1. PERSONAL INFORMATION ============== */}
          <FormSection title="① Personal Information" color="#6366f1">
            <FormGrid cols={2}>
              <FormField label={isEdit ? "Employee ID (locked)" : "Employee ID *"}>
                <input
                  type="text"
                  value={form.EMPLOYEE_CODE}
                  onChange={set("EMPLOYEE_CODE")}
                  placeholder="EMP015"
                  readOnly={isEdit}
                  style={{
                    ...inputStyle(),
                    ...(isEdit
                      ? { background: "#f1f5f9", color: "#64748b", cursor: "not-allowed" }
                      : {})
                  }}
                />
              </FormField>
              <FormField label="Employee Name *">
                <input
                  type="text"
                  value={form.NAME}
                  onChange={set("NAME")}
                  placeholder="Ramesh Kumar"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Father's Name">
                <input
                  type="text"
                  value={form.FATHER_NAME}
                  onChange={set("FATHER_NAME")}
                  placeholder="Murugan"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Mother's Name">
                <input
                  type="text"
                  value={form.MOTHER_NAME}
                  onChange={set("MOTHER_NAME")}
                  placeholder="Lakshmi"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Date of Birth">
                <input
                  type="date"
                  value={form.DOB}
                  onChange={set("DOB")}
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Gender">
                <select
                  value={form.GENDER}
                  onChange={set("GENDER")}
                  style={inputStyle()}
                >
                  <option value="">— pick —</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>{g.replace("_", " ")}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Marital Status">
                <select
                  value={form.MARITAL_STATUS}
                  onChange={set("MARITAL_STATUS")}
                  style={inputStyle()}
                >
                  <option value="">— pick —</option>
                  {MARITAL_STATUSES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Occupation">
                <input
                  type="text"
                  value={form.OCCUPATION}
                  onChange={set("OCCUPATION")}
                  placeholder="Mechanical Technician"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Blood Group">
                <select
                  value={form.BLOOD_GROUP}
                  onChange={set("BLOOD_GROUP")}
                  style={inputStyle()}
                >
                  <option value="">— pick —</option>
                  {["A+","A-","B+","B-","O+","O-","AB+","AB-"].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Nationality">
                <input
                  type="text"
                  value={form.NATIONALITY}
                  onChange={set("NATIONALITY")}
                  placeholder="Indian"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Emergency Contact Name">
                <input
                  type="text"
                  value={form.EMERGENCY_CONTACT_NAME}
                  onChange={set("EMERGENCY_CONTACT_NAME")}
                  placeholder="Spouse / Parent / Sibling"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Emergency Contact Phone">
                <input
                  type="tel"
                  value={form.EMERGENCY_CONTACT_PHONE}
                  onChange={set("EMERGENCY_CONTACT_PHONE")}
                  placeholder="+91 98765 43210"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Relationship" span={2}>
                <input
                  type="text"
                  value={form.EMERGENCY_CONTACT_RELATION}
                  onChange={set("EMERGENCY_CONTACT_RELATION")}
                  placeholder="Father / Mother / Spouse / Sibling"
                  style={inputStyle()}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 2. CONTACT & LOGIN DETAILS ============== */}
          <FormSection title="② Contact & Login Details" color="#06b6d4">
            <FormGrid cols={2}>
              <FormField label="Contact Number">
                <input
                  type="tel"
                  value={form.PHONE}
                  onChange={set("PHONE")}
                  placeholder="+91 98765 43210"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Email">
                <input
                  type="email"
                  value={form.EMAIL}
                  onChange={set("EMAIL")}
                  placeholder="ramesh@bvc24.in"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Address (Street / House No)" span={2}>
                <textarea
                  rows={2}
                  value={form.ADDRESS}
                  onChange={set("ADDRESS")}
                  placeholder="Plot 12, ABC Street, Near XYZ Park"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="City">
                <input
                  type="text"
                  value={form.CITY}
                  onChange={set("CITY")}
                  placeholder="Coimbatore"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="State">
                <input
                  type="text"
                  value={form.STATE}
                  onChange={set("STATE")}
                  placeholder="Tamil Nadu"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Pincode" span={2}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.PINCODE}
                  onChange={set("PINCODE")}
                  placeholder="641001"
                  maxLength={10}
                  style={inputStyle()}
                />
              </FormField>
              {!isEdit && (
                <FormField label="Password *" span={2}>
                  <input
                    type="password"
                    value={form.PASSWORD}
                    onChange={set("PASSWORD")}
                    placeholder="Set a login password"
                    style={inputStyle()}
                  />
                </FormField>
              )}
            </FormGrid>
          </FormSection>

          {/* ============== 3. EDUCATIONAL INFORMATION ============== */}
          <FormSection title="③ Educational Information" color="#10b981">
            <FormGrid cols={2}>
              <FormField label="Qualification">
                <input
                  type="text"
                  value={form.QUALIFICATION}
                  onChange={set("QUALIFICATION")}
                  placeholder="BE Mechanical Engineering"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Year of Passing">
                <input
                  type="number"
                  min="1950"
                  max="2099"
                  value={form.YEAR_OF_PASSING}
                  onChange={set("YEAR_OF_PASSING")}
                  placeholder="2020"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="College">
                <input
                  type="text"
                  value={form.COLLEGE}
                  onChange={set("COLLEGE")}
                  placeholder="PSG College of Technology"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="University">
                <input
                  type="text"
                  value={form.UNIVERSITY}
                  onChange={set("UNIVERSITY")}
                  placeholder="Anna University"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Percentage / CGPA" span={2}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.PERCENTAGE}
                  onChange={set("PERCENTAGE")}
                  placeholder="85.5"
                  style={inputStyle()}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 4. PROFESSIONAL INFORMATION ============== */}
          <FormSection title="④ Professional Information" color="#f59e0b">
            <FormGrid cols={2}>
              <FormField label="Fresher / Experienced">
                <select
                  value={form.EMPLOYMENT_TYPE}
                  onChange={set("EMPLOYMENT_TYPE")}
                  style={inputStyle()}
                >
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Years of Experience">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.EXPERIENCE_YEARS}
                  onChange={set("EXPERIENCE_YEARS")}
                  placeholder="0"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Previous Company">
                <input
                  type="text"
                  value={form.PREVIOUS_COMPANY}
                  onChange={set("PREVIOUS_COMPANY")}
                  placeholder="ABC Manufacturing Pvt Ltd"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Previous Salary (₹/month)">
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={form.PREVIOUS_SALARY}
                  onChange={set("PREVIOUS_SALARY")}
                  placeholder="45000"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Skills (comma-separated)" span={2}>
                <input
                  type="text"
                  value={form.SKILLS}
                  onChange={set("SKILLS")}
                  placeholder="solidworks, wiring, assembly, quality check"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Experience Details" span={2}>
                <textarea
                  rows={3}
                  value={form.EXPERIENCE_DETAILS}
                  onChange={set("EXPERIENCE_DETAILS")}
                  placeholder={"ABC Manufacturing — 2 yrs (CNC operator)\nXYZ Industries — 1 yr (Welder)"}
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Past Working Projects" span={2}>
                <textarea
                  rows={3}
                  value={form.PAST_PROJECTS}
                  onChange={set("PAST_PROJECTS")}
                  placeholder={"• Snack Vending Machine v2\n• Industrial Conveyor Belt System\n• Custom CNC retrofit"}
                  style={inputStyle()}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 5. ADDITIONAL INFORMATION ============== */}
          <FormSection title="⑤ Additional Information" color="#8b5cf6">
            <FormField label="Extra Information / Notes">
              <textarea
                rows={3}
                value={form.NOTES}
                onChange={set("NOTES")}
                placeholder="Any additional notes about this employee"
                style={inputStyle()}
              />
            </FormField>
          </FormSection>

          {/* ============== System: Organization Assignment ============== */}
          {/* Required for backend role mapping. Kept at bottom so the
              user-facing form follows the requested professional order. */}
          <FormSection title="⑥ Organization Assignment (system)" color="#ec4899">
            <FormGrid cols={3}>
              <FormField label="Role *">
                <select
                  value={form.ROLE_ID}
                  onChange={set("ROLE_ID")}
                  style={inputStyle()}
                >
                  <option value="">— pick role —</option>
                  {roles.map((r) => (
                    <option key={r.ID} value={r.ID}>{r.ROLE_NAME}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Department">
                <select
                  value={form.DEPARTMENT_ID}
                  onChange={set("DEPARTMENT_ID")}
                  style={inputStyle()}
                >
                  <option value="">— pick department —</option>
                  {departments.map((d) => (
                    <option key={d.ID} value={d.ID}>{d.NAME}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Designation">
                <select
                  value={form.DESIGNATION_ID}
                  onChange={set("DESIGNATION_ID")}
                  style={inputStyle()}
                >
                  <option value="">— pick designation —</option>
                  {designations.map((d) => (
                    <option key={d.ID} value={d.ID}>{d.TITLE}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Confirmation Date (probation end)">
                <input
                  type="date"
                  value={form.CONFIRMATION_DATE}
                  onChange={set("CONFIRMATION_DATE")}
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Work Location" span={2}>
                <input
                  type="text"
                  value={form.WORK_LOCATION}
                  onChange={set("WORK_LOCATION")}
                  placeholder="Coimbatore HQ / Chennai Site / Remote"
                  style={inputStyle()}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 7. BANK + KYC ============== */}
          <FormSection title="⑦ Bank & Identity (Payroll)" color="#0284c7">
            <FormGrid cols={2}>
              <FormField label="Bank Account Number">
                <input
                  type="text"
                  value={form.BANK_ACCOUNT_NUMBER}
                  onChange={set("BANK_ACCOUNT_NUMBER")}
                  placeholder="50100123456789"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Bank Name">
                <input
                  type="text"
                  value={form.BANK_NAME}
                  onChange={set("BANK_NAME")}
                  placeholder="HDFC Bank"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="IFSC Code">
                <input
                  type="text"
                  value={form.IFSC_CODE}
                  onChange={set("IFSC_CODE")}
                  placeholder="HDFC0001234"
                  maxLength={20}
                  style={{...inputStyle(), textTransform: "uppercase"}}
                />
              </FormField>
              <FormField label="PAN Number">
                <input
                  type="text"
                  value={form.PAN_NUMBER}
                  onChange={set("PAN_NUMBER")}
                  placeholder="ABCDE1234F"
                  maxLength={20}
                  style={{...inputStyle(), textTransform: "uppercase"}}
                />
              </FormField>
              <FormField label="Aadhaar Number" span={2}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.AADHAAR_NUMBER}
                  onChange={set("AADHAAR_NUMBER")}
                  placeholder="1234 5678 9012"
                  maxLength={20}
                  style={inputStyle()}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 8. SALARY STRUCTURE (drives Payroll) ============== */}
          <FormSection title="⑧ Salary Structure (Payroll)" color="#10b981">

            <div style={{
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 12,
              color: "#065f46",
              marginBottom: 14
            }}>
              These monthly amounts drive payroll generation.
              Leave blank if not yet decided — payroll will fall back to
              <b> Employee.Salary</b> or treat as zero. Statutory deductions
              (PF / ESI / PT) are calculated automatically from the basic and gross.
            </div>

            <FormGrid cols={3}>
              <FormField label="Basic (₹/month)">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_BASIC}
                  onChange={set("SAL_BASIC")}
                  placeholder="25000"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="HRA (₹/month)">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_HRA}
                  onChange={set("SAL_HRA")}
                  placeholder="10000"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="DA (Dearness Allowance)">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_DA}
                  onChange={set("SAL_DA")}
                  placeholder="2000"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Conveyance Allowance">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_CONVEYANCE}
                  onChange={set("SAL_CONVEYANCE")}
                  placeholder="1600"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Medical Allowance">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_MEDICAL}
                  onChange={set("SAL_MEDICAL")}
                  placeholder="1250"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Special Allowance">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_SPECIAL}
                  onChange={set("SAL_SPECIAL")}
                  placeholder="5000"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Other Allowances">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_OTHER}
                  onChange={set("SAL_OTHER")}
                  placeholder="0"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Incentives (recurring)">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_INCENTIVES}
                  onChange={set("SAL_INCENTIVES")}
                  placeholder="0"
                  style={inputStyle()}
                />
              </FormField>
              <FormField label="Annual Bonus (÷12 per month)">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.SAL_ANNUAL_BONUS}
                  onChange={set("SAL_ANNUAL_BONUS")}
                  placeholder="0"
                  style={inputStyle()}
                />
              </FormField>
            </FormGrid>

            <div style={{ height: 14 }} />

            <FormGrid cols={3}>
              <FormField label="PT State (for Professional Tax slab)">
                <select
                  value={form.SAL_PT_STATE}
                  onChange={set("SAL_PT_STATE")}
                  style={inputStyle()}
                >
                  <option value="TAMIL_NADU">Tamil Nadu</option>
                  <option value="KARNATAKA">Karnataka</option>
                  <option value="MAHARASHTRA">Maharashtra</option>
                  <option value="WEST_BENGAL">West Bengal</option>
                  <option value="GUJARAT">Gujarat</option>
                  <option value="ANDHRA_PRADESH">Andhra Pradesh</option>
                  <option value="TELANGANA">Telangana</option>
                  <option value="KERALA">Kerala</option>
                  <option value="NONE">Other / Exempt</option>
                </select>
              </FormField>
              <FormField label="Deduct PF (12% of basic)">
                <label style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  paddingTop: 8,
                  fontSize: 13,
                  cursor: "pointer"
                }}>
                  <input
                    type="checkbox"
                    checked={!!form.SAL_PF_APPLICABLE}
                    onChange={(e) => setForm((f) => ({
                      ...f, SAL_PF_APPLICABLE: e.target.checked
                    }))}
                  />
                  <span>{form.SAL_PF_APPLICABLE ? "Yes — deduct PF" : "No — skip PF"}</span>
                </label>
              </FormField>
              <FormField label="Deduct ESI (0.75% if gross ≤ ₹21k)">
                <label style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  paddingTop: 8,
                  fontSize: 13,
                  cursor: "pointer"
                }}>
                  <input
                    type="checkbox"
                    checked={!!form.SAL_ESI_APPLICABLE}
                    onChange={(e) => setForm((f) => ({
                      ...f, SAL_ESI_APPLICABLE: e.target.checked
                    }))}
                  />
                  <span>{form.SAL_ESI_APPLICABLE ? "Yes — deduct ESI" : "No — skip ESI"}</span>
                </label>
              </FormField>
            </FormGrid>

            {/* Live-calculated gross — re-renders whenever any earnings field changes */}
            {(() => {

              const sum =
                (Number(form.SAL_BASIC)        || 0) +
                (Number(form.SAL_HRA)          || 0) +
                (Number(form.SAL_DA)           || 0) +
                (Number(form.SAL_CONVEYANCE)   || 0) +
                (Number(form.SAL_MEDICAL)      || 0) +
                (Number(form.SAL_SPECIAL)      || 0) +
                (Number(form.SAL_OTHER)        || 0) +
                (Number(form.SAL_INCENTIVES)   || 0) +
                (Number(form.SAL_ANNUAL_BONUS) || 0);

              if (sum <= 0) return null;

              const inr = (n) => `₹${Number(n).toLocaleString("en-IN", {
                maximumFractionDigits: 2, minimumFractionDigits: 2
              })}`;

              return (

                <div style={{
                  marginTop: 14,
                  padding: "12px 16px",
                  background: "linear-gradient(135deg, #10b981, #047857)",
                  borderRadius: 10,
                  color: "white",
                  fontSize: 14,
                  fontWeight: 700,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <span>Gross / month (auto-calculated)</span>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>{inr(sum)}</span>
                </div>
              );
            })()}

          </FormSection>

          <div style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 24,
            paddingTop: 18,
            borderTop: "1px solid #e2e8f0"
          }}>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              style={{
                background: "white",
                color: "#4338ca",
                border: "2px solid #6366f1",
                padding: "10px 22px",
                borderRadius: 10,
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer"
              }}
            >
              👁 View Data (preview)
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                background: saving
                  ? "#cbd5e1"
                  : "linear-gradient(135deg, #10b981, #047857)",
                color: "white",
                border: "none",
                padding: "10px 28px",
                borderRadius: 10,
                fontWeight: 800,
                fontSize: 13,
                cursor: saving ? "default" : "pointer",
                boxShadow: "0 6px 16px rgba(16,185,129,0.3)"
              }}
            >
              {saving
                ? "Saving…"
                : (isEdit ? "💾 Save Changes" : "✓ Save Employee")}
            </button>
          </div>
        </div>
      </form>

      {showPreview && (
        <ResumeModal
          employee={previewEmployee}
          photoDataUrl={photoPreview}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}


function FormSection({ title, color, children }) {

  return (

    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 1.4,
        color,
        textTransform: "uppercase",
        marginBottom: 12,
        paddingBottom: 6,
        borderBottom: `2px solid ${color}33`
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}


function FormGrid({ cols, children }) {

  return (

    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 12
    }}>
      {children}
    </div>
  );
}


function FormField({ label, span, children }) {

  return (

    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label style={{
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#475569",
        marginBottom: 4,
        letterSpacing: 0.3
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}


function inputStyle() {

  return {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box"
  };
}


// =====================================================================
// Main page
// =====================================================================

function Employees() {

  const [employees, setEmployees] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [deptFilter, setDeptFilter] = useState("");

  const [showAdd, setShowAdd] = useState(false);

  const [showInvite, setShowInvite] = useState(false);

  // null = closed; employee object = open in edit mode
  const [editingEmployee, setEditingEmployee] = useState(null);

  const [viewing, setViewing] = useState(null);

  const fetchAll = () => {

    setLoading(true);

    API.get("/employees")
      .then((r) => setEmployees(r.data || []))
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  const departments = useMemo(() => {

    const set = new Set();

    employees.forEach((e) => {

      if (e.DEPARTMENT?.NAME) set.add(e.DEPARTMENT.NAME);
    });

    return [...set].sort();

  }, [employees]);

  const filtered = useMemo(() => {

    const q = search.trim().toLowerCase();

    return employees.filter((e) => {

      if (deptFilter && e.DEPARTMENT?.NAME !== deptFilter) return false;

      if (!q) return true;

      const hay = [
        e.NAME, e.EMPLOYEE_CODE, e.EMAIL, e.PHONE,
        e.SKILLS, e.QUALIFICATION,
        e.DEPARTMENT?.NAME, e.ROLE?.NAME
      ].filter(Boolean).join(" ").toLowerCase();

      return hay.includes(q);
    });

  }, [employees, search, deptFilter]);

  const stats = useMemo(() => {

    const total = employees.length;

    const active = employees.filter((e) => e.STATUS === "ACTIVE").length;

    const freshers = employees.filter((e) => e.EMPLOYMENT_TYPE === "FRESHER").length;

    const avgExp = employees.length
      ? (employees.reduce((s, e) => s + (Number(e.EXPERIENCE_YEARS) || 0), 0) / employees.length).toFixed(1)
      : 0;

    return { total, active, freshers, avgExp };

  }, [employees]);

  const handleDelete = async (emp) => {

    if (!window.confirm(`Delete employee ${emp.NAME} (${emp.EMPLOYEE_CODE})?`)) return;

    try {

      await API.delete(`/delete-employee/${emp.ID}`);

      fetchAll();

    } catch (err) {

      alert(err?.response?.data?.detail || "Delete failed");
    }
  };

  return (

    <div style={{ padding: 26, minHeight: "100%", background: "#f1f5f9" }}>

      <style>{`
        @keyframes empFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes empHeroShift {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
      `}</style>

      <div style={{
        background: "linear-gradient(120deg, #1A0508 0%, #4A0E18 30%, #8B0B1F 60%, #C8102E 100%)",
        backgroundSize: "300% 300%",
        animation: "empHeroShift 18s ease-in-out infinite",
        color: "white",
        padding: "28px 32px",
        borderRadius: 20,
        marginBottom: 22,
        boxShadow: "0 24px 60px rgba(99,102,241,0.4)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2.5, opacity: 0.85, fontWeight: 800, textTransform: "uppercase" }}>
            BVC24 · Workforce
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: "6px 0 6px", lineHeight: 1.15, color: "white" }}>
            Employee Directory — every face, every skill, one click away.
          </h1>
          <div style={{ fontSize: 13, opacity: 0.92, maxWidth: 600 }}>
            Add new hires with their full profile + photo. View any
            employee's resume on demand. Skills, experience, projects,
            qualification — all in one place.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setShowInvite(true)}
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.4)",
              padding: "14px 22px",
              borderRadius: 12,
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
              boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
              letterSpacing: 0.3,
              backdropFilter: "blur(6px)"
            }}
          >
            🤖 Invite (AI Onboarding)
          </button>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              background: "white",
              color: "#8B0B1F",
              border: "none",
              padding: "14px 26px",
              borderRadius: 12,
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
              boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
              letterSpacing: 0.3
            }}
          >
            ✨ Add Employee
          </button>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: 14,
        marginBottom: 20
      }}>
        <StatTile label="Total Employees" value={stats.total} color="#6366f1" />
        <StatTile label="Active" value={stats.active} sub="working" color="#10b981" />
        <StatTile label="Freshers" value={stats.freshers} sub="new joinees" color="#06b6d4" />
        <StatTile label="Avg Experience" value={`${stats.avgExp} yr`} sub="across team" color="#f59e0b" />
      </div>

      <div style={{
        background: "white",
        padding: 14,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: 18
      }}>
        <input
          type="text"
          placeholder="🔍 Search by name, code, email, skill, qualification..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 280,
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13
          }}
        />
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          style={{
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13,
            background: "white"
          }}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {filtered.length} of {employees.length}
        </div>
      </div>

      {
        loading && (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            Loading employees…
          </div>
        )
      }

      {
        !loading && filtered.length === 0 && (
          <div style={{
            padding: 50,
            textAlign: "center",
            color: "#94a3b8",
            background: "white",
            borderRadius: 14,
            border: "1px dashed #cbd5e1"
          }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>👥</div>
            {employees.length === 0
              ? <>No employees yet. Click <strong>✨ Add Employee</strong> to start the directory.</>
              : "No employees match these filters."}
          </div>
        )
      }

      {
        !loading && filtered.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
            gap: 18
          }}>
            {filtered.map((emp) => (
              <EmployeeCard
                key={emp.ID}
                employee={emp}
                onView={setViewing}
                onEdit={setEditingEmployee}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )
      }

      {
        showAdd && (
          <AddEmployeeModal
            onClose={() => setShowAdd(false)}
            onCreated={() => {
              setShowAdd(false);
              fetchAll();
            }}
          />
        )
      }

      {
        editingEmployee && (
          <AddEmployeeModal
            editingEmployee={editingEmployee}
            onClose={() => setEditingEmployee(null)}
            onCreated={() => {
              setEditingEmployee(null);
              fetchAll();
            }}
          />
        )
      }

      {
        viewing && (
          <ResumeModal
            employee={viewing}
            onClose={() => setViewing(null)}
          />
        )
      }

      {
        showInvite && (
          <InviteEmployeeModal
            onClose={() => setShowInvite(false)}
          />
        )
      }
    </div >
  );
}


// =====================================================================
// InviteEmployeeModal — generates a candidate onboarding link via
// POST /employee-onboarding/invite, then shows the link with a
// copy-to-clipboard + share-by-email action.
// =====================================================================

function InviteEmployeeModal({ onClose }) {

  const [form, setForm] = useState({
    INVITED_NAME: "",
    EMPLOYEE_CODE: "",
    PASSWORD: "",
    EXPIRES_IN_DAYS: 2
  });

  const [result, setResult] = useState(null);

  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState("");

  const [copied, setCopied] = useState(false);

  const [emailMsg, setEmailMsg] = useState("");

  // ESC closes the modal
  useEffect(() => {

    const onKey = (e) => {

      if (e.key === "Escape") onClose?.();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, [onClose]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {

    e?.preventDefault?.();

    setError("");

    setEmailMsg("");

    if (!form.INVITED_NAME.trim()) {

      setError("Candidate name is required.");

      return;
    }

    if (!form.EMPLOYEE_CODE.trim()) {

      setError("Employee ID is required.");

      return;
    }

    if (form.PASSWORD.trim().length < 6) {

      setError("Password must be at least 6 characters.");

      return;
    }

    setSubmitting(true);

    try {

      const res = await API.post("/employee-onboarding/invite", {
        INVITED_NAME: form.INVITED_NAME.trim(),
        EMPLOYEE_CODE: form.EMPLOYEE_CODE.trim() || null,
        PASSWORD: form.PASSWORD,
        EXPIRES_IN_DAYS: Number(form.EXPIRES_IN_DAYS) || 2
      });

      setResult(res.data);

    } catch (err) {

      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Could not generate the invite link."
      );

    } finally {

      setSubmitting(false);
    }
  };

  const copyLink = async () => {

    if (!result?.invite_link) return;

    try {

      await navigator.clipboard.writeText(result.invite_link);

      setCopied(true);

      setTimeout(() => setCopied(false), 2200);

    } catch {

      setCopied(false);
    }
  };

  return (

    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)"
        }}
      >

        {/* Sticky header */}
        <div style={{
          background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
          color: "white",
          padding: "20px 24px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div>
            <div style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 2,
              opacity: 0.85
            }}>
              EMPLOYEE AI ONBOARDING
            </div>
            <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>
              Invite candidate to self-onboard
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.18)",
              color: "white",
              border: "none",
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Body — only this scrolls so the header stays pinned */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 22
        }}>

          <p style={{
            margin: "0 0 16px",
            color: "#475569",
            fontSize: 13,
            lineHeight: 1.5
          }}>
            Generate a one-time link the candidate opens in their
            browser. Our AI assistant walks them through every field —
            once they hit <b>Submit</b>, the session appears under
            <b> Onboarding Review</b> for HR approval.
          </p>

          {!result && (
            <form onSubmit={submit}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 12
              }}>
                <InviteField label="Candidate name *">
                  <input
                    type="text"
                    value={form.INVITED_NAME}
                    onChange={set("INVITED_NAME")}
                    placeholder="e.g. Ramesh Kumar"
                    style={inviteInputStyle()}
                  />
                </InviteField>
                <InviteField label="Employee ID *">
                  <input
                    type="text"
                    value={form.EMPLOYEE_CODE}
                    onChange={set("EMPLOYEE_CODE")}
                    placeholder="EMP015"
                    style={inviteInputStyle()}
                  />
                </InviteField>
                <InviteField label="Login Password *" span={2}>
                  <input
                    type="password"
                    value={form.PASSWORD}
                    onChange={set("PASSWORD")}
                    placeholder="Min 6 characters"
                    style={inviteInputStyle()}
                  />
                </InviteField>
                <InviteField label="Expires in (days)" span={2}>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={form.EXPIRES_IN_DAYS}
                    onChange={set("EXPIRES_IN_DAYS")}
                    style={inviteInputStyle()}
                  />
                </InviteField>
              </div>

              <div style={{
                padding: "8px 12px",
                background: "#f0f9ff",
                color: "#075985",
                border: "1px solid #bae6fd",
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.5,
                marginBottom: 12
              }}>
                🔑 The candidate will sign in with this Employee ID + Password to open their registration form.
              </div>

              {error && (
                <div style={{
                  padding: "8px 12px",
                  background: "#fef2f2",
                  color: "#991b1b",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 12
                }}>
                  ⚠ {error}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "11px 18px",
                    background: "white",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "11px 22px",
                    background: submitting
                      ? "#cbd5e1"
                      : "linear-gradient(135deg, #C8102E, #8B0B1F)",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: submitting ? "wait" : "pointer",
                    boxShadow: "0 6px 18px rgba(200,16,46,0.35)"
                  }}
                >
                  {submitting ? "Generating…" : "🔗 Generate Invite Link"}
                </button>
              </div>
            </form>
          )}

          {result && (
            <div style={{
              background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
              border: "2px solid #F4B324",
              borderRadius: 12,
              padding: "16px 18px"
            }}>
              <div style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 1.5,
                color: "#8B4500",
                marginBottom: 8
              }}>
                ✅ INVITE CREATED
                {result.expires_at && (
                  <span style={{
                    marginLeft: 10,
                    fontWeight: 600,
                    color: "#92400e"
                  }}>
                    · expires {new Date(result.expires_at).toLocaleDateString("en-IN")}
                  </span>
                )}
              </div>
              <div style={{
                background: "white",
                padding: 10,
                borderRadius: 8,
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                wordBreak: "break-all",
                color: "#0f172a",
                border: "1px solid #fcd34d"
              }}>
                {result.invite_link}
              </div>
              <div style={{
                display: "flex",
                gap: 8,
                marginTop: 12,
                flexWrap: "wrap"
              }}>
                <button
                  onClick={copyLink}
                  style={{
                    padding: "9px 16px",
                    background: copied ? "#16a34a" : "#0f172a",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer"
                  }}
                >
                  {copied ? "✓ Copied!" : "📋 Copy Link"}
                </button>
                <a
                  href={result.invite_link}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "9px 16px",
                    background: "white",
                    color: "#8B0B1F",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    textDecoration: "none",
                    display: "inline-block"
                  }}
                >
                  Open ↗
                </a>
                <button
                  onClick={() => {
                    setResult(null);
                    setEmailMsg("");
                    setForm({
                      INVITED_NAME: "",
                      EMPLOYEE_CODE: "",
                      PASSWORD: "",
                      EXPIRES_IN_DAYS: 2
                    });
                  }}
                  style={{
                    padding: "9px 16px",
                    background: "white",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer"
                  }}
                >
                  + New invite
                </button>
              </div>

              {emailMsg && (
                <div style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: "#854d0e",
                  fontWeight: 600
                }}>
                  {emailMsg}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}


function InviteField({ label, span, children }) {

  return (

    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label style={{
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#475569",
        marginBottom: 4,
        letterSpacing: 0.3
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}


function inviteInputStyle() {

  return {
    width: "100%",
    padding: "9px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "white",
    boxSizing: "border-box",
    outline: "none"
  };
}


export default Employees;
