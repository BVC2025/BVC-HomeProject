import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import API, { API_BASE_URL } from "../services/api";
import TablePagination from "../components/TablePagination";
import { PMSelect, SearchBar, PMConfirmModal, PageHeader, StatsRow, EmptyState, Loader } from "../components/pm";
import { validateForm, clearFieldError, EMPLOYEE_RULES } from "../utils/formValidation";
import EmployeesIcon from "../assets/Icons/employee.webp";
import EditIconImg from "../assets/Icons/editIcon.webp";
import DeleteIconImg from "../assets/Icons/deleteIcon.webp";
import DetailsIconImg from "../assets/Icons/detailsIcon.webp";
import styles from "./Employees.module.css";

const VENDOR_ID = 1;

const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];

const EMPLOYMENT_TYPES = ["FRESHER", "EXPERIENCED"];

const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"];


// =====================================================================
// Utility — avatar from name initials when no photo uploaded
// =====================================================================

function initials(name) {
  return (
    (name || "")
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}


function avatarGradient(name) {
  const palette = [
    "#ef4444",
    "#10b981",
    "var(--text-secondary)",
    "#06b6d4",
    "#ef4444",
    "#0ea5e9",
  ];

  let hash = 0;
  const txt = (name || "").toString();
  for (let i = 0; i < txt.length; i++) hash = (hash * 31 + txt.charCodeAt(i)) >>> 0;

  return palette[hash % palette.length];
}


function Avatar({ employee, size = 56, dataUrl }) {
  const photoUrl =
    dataUrl || (employee?.PHOTO_URL ? `${API_BASE_URL}${employee.PHOTO_URL}` : null);

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={employee?.NAME || ""}
        className={styles.avatarImg}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={styles.avatarInitials}
      style={{
        width: size,
        height: size,
        background: avatarGradient(employee?.NAME),
        fontSize: size * 0.38,
      }}
    >
      {initials(employee?.NAME)}
    </div>
  );
}


function Pill({ children, bg = "#e0e7ff", fg = "#4338ca" }) {
  return (
    <span className={styles.pill} style={{ background: bg, color: fg }}>
      {children}
    </span>
  );
}


function fmtJoinDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

// Lifecycle status → display label + semantic tone. Aligned with
// backend ALLOWED_STATUSES (see employee_status.py). Tone maps to one
// of a small, fixed set of CSS classes (Employees.module.css) reusing
// the app's existing --success/--warning/--danger/--info/muted tokens,
// instead of a per-status hardcoded hex palette.
const STATUS_LABELS = {
  ACTIVE: "Active",
  ON_NOTICE: "On Notice",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
  RETIRED: "Retired",
  ON_LEAVE_LONG: "On Long Leave",
  INACTIVE: "Inactive",
  ON_LEAVE: "On Leave",
};

const STATUS_TONES = {
  ACTIVE: "success",
  ON_NOTICE: "warning",
  ON_LEAVE: "warning",
  ON_LEAVE_LONG: "info",
  RETIRED: "info",
  RESIGNED: "muted",
  INACTIVE: "muted",
  TERMINATED: "danger",
};

function statusBadge(emp) {
  // Transient "on leave today" hint takes precedence — it's what HR
  // wants to see at a glance, even if the underlying STATUS is ACTIVE.
  const onLeave = (emp.LEAVE_STATUS || "").toUpperCase() === "ON_LEAVE"
    || (emp.TODAY_STATUS || "").toUpperCase() === "ON_LEAVE";
  const code = onLeave ? "ON_LEAVE" : (emp.STATUS || "ACTIVE").toUpperCase();

  return {
    label: STATUS_LABELS[code] || code.replace(/_/g, " "),
    tone: STATUS_TONES[code] || "muted",
  };
}


// Employee list rendering (table) is defined further down, in the
// main Employees() component — see the "Employee table" section.


// =====================================================================
// Resume-style "View Data" modal
// =====================================================================

// HR Module — Phase B: Documents block rendered inside ResumeModal.
// Self-contained: fetches its own list, handles upload + delete.

// Grouped by category for the optgroup UI — every key must also exist
// in the backend whitelist (backend/app/routes/employee_documents.py).
const DOC_TYPES = [
  // ---- Identity ----
  { key: "AADHAAR", label: "Aadhaar", icon: "🪪", group: "Identity" },
  { key: "PAN", label: "PAN", icon: "🆔", group: "Identity" },
  { key: "VOTER_ID", label: "Voter ID", icon: "🗳️", group: "Identity" },
  { key: "PASSPORT", label: "Passport", icon: "🛂", group: "Identity" },
  { key: "DRIVING_LICENSE", label: "Driving License", icon: "🚗", group: "Identity" },

  // ---- Education ----
  { key: "TENTH_MARKSHEET", label: "10th Marksheet / SSLC", icon: "📘", group: "Education" },
  { key: "TWELFTH_MARKSHEET", label: "12th Marksheet / HSC", icon: "📗", group: "Education" },
  { key: "DIPLOMA", label: "Diploma / ITI", icon: "📙", group: "Education" },
  { key: "DEGREE", label: "Degree (UG)", icon: "🎓", group: "Education" },
  { key: "POSTGRADUATE", label: "Post-Graduate (PG)", icon: "🎓", group: "Education" },
  { key: "EDUCATIONAL", label: "Other Educational", icon: "📚", group: "Education" },
  { key: "CERTIFICATE", label: "Professional Certificate", icon: "📜", group: "Education" },

  // ---- Employment ----
  { key: "RESUME", label: "Resume / CV", icon: "📄", group: "Employment" },
  { key: "OFFER_LETTER", label: "Offer Letter", icon: "📃", group: "Employment" },
  { key: "JOINING_LETTER", label: "Joining Letter", icon: "✍️", group: "Employment" },
  { key: "EXPERIENCE_LETTER", label: "Experience Letter", icon: "🏅", group: "Employment" },
  { key: "RELIEVING_LETTER", label: "Relieving Letter", icon: "🗒️", group: "Employment" },
  { key: "SALARY_SLIP", label: "Previous Salary Slip", icon: "💰", group: "Employment" },

  // ---- Personal / Banking ----
  { key: "PHOTO", label: "Photograph", icon: "🖼️", group: "Personal" },
  { key: "BIRTH_CERTIFICATE", label: "Birth Certificate", icon: "👶", group: "Personal" },
  { key: "MARRIAGE_CERTIFICATE", label: "Marriage Certificate", icon: "💍", group: "Personal" },
  { key: "ADDRESS_PROOF", label: "Address Proof", icon: "🏠", group: "Personal" },
  { key: "BANK_PASSBOOK", label: "Bank Passbook / Cheque", icon: "🏦", group: "Personal" },

  // ---- Catch-all ----
  { key: "OTHER", label: "Other", icon: "📁", group: "Other" },
];

const DOC_TYPE_LABEL = Object.fromEntries(
  DOC_TYPES.map((d) => [d.key, `${d.icon} ${d.label}`])
);

// Same six-slot policy the self-onboarding form uses (see
// EmployeeProfileForm.jsx). Admin picks up the exact same required
// list here so the Documents tab on both surfaces stays in sync.
const REQUIRED_DOC_SLOTS = [
  {
    key:   "SCHOOL_MARKSHEETS",
    label: "10th & 12th Marksheets",
    hint:  "Upload both 10th and 12th mark sheets (soft copy).",
    types: ["TENTH_MARKSHEET", "TWELFTH_MARKSHEET"],
    saveAs: "TENTH_MARKSHEET",
    required: true,
  },
  {
    key:   "DEGREE_CERTIFICATE",
    label: "Degree Certificate (UG / PG)",
    hint:  "UG and/or PG degree certificate. Upload all pages.",
    types: ["DEGREE", "POSTGRADUATE"],
    saveAs: "DEGREE",
    required: true,
  },
  {
    key:   "PAN_CARD",
    label: "PAN Card",
    hint:  "PAN card (front side).",
    types: ["PAN"],
    saveAs: "PAN",
    required: true,
  },
  {
    key:   "AADHAAR_CARD",
    label: "Aadhaar Card",
    hint:  "Aadhaar card front and back.",
    types: ["AADHAAR"],
    saveAs: "AADHAAR",
    required: true,
  },
  {
    key:   "EXPERIENCE_CERTIFICATE",
    label: "Previous Experience Certificate",
    hint:  "Only if the employee has previous work experience.",
    types: ["EXPERIENCE_LETTER", "RELIEVING_LETTER", "SALARY_SLIP"],
    saveAs: "EXPERIENCE_LETTER",
    required: false,
  },
  {
    key:   "BANK_DETAILS",
    label: "Bank Details",
    hint:  "Cancelled cheque or bank passbook first page.",
    types: ["BANK_PASSBOOK"],
    saveAs: "BANK_PASSBOOK",
    required: true,
  },
];

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
    file: null,
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

  useEffect(() => {
    fetchDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

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
        headers: { "Content-Type": "multipart/form-data" },
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
    if (!window.confirm(`Delete "${doc.TITLE || doc.FILE_NAME || "this document"}"?`)) return;

    try {
      await API.delete(`/employees/${empId}/documents/${doc.ID}`);
      fetchDocs();
    } catch (e) {
      alert(e?.response?.data?.detail || "Delete failed.");
    }
  };

  // Multi-file uploader for a specific required-doc slot. Same API as
  // the employee's self-form so the two flows produce identical rows
  // on the backend.
  const handleSlotPick = async (slot, e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setPending(true);
    setError("");

    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("doc_type", slot.saveAs);
        fd.append("title", f.name);
        await API.post(`/employees/${empId}/documents`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      await fetchDocs();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || "Upload failed.");
    } finally {
      setPending(false);
      if (e.target) e.target.value = "";
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

      {/* ---- Six required-document slots (matches the employee's
              self-onboarding form so admin + employee see the same
              checklist). Each slot supports multiple files. ---- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        {REQUIRED_DOC_SLOTS.map((slot) => {
          const filesInSlot = docs.filter((d) => slot.types.includes(d.DOC_TYPE));
          const uploaded    = filesInSlot.length > 0;
          const inputId     = `admin-doc-slot-${empId}-${slot.key}`;

          return (
            <div
              key={slot.key}
              style={{
                border: uploaded
                  ? "1px solid #bbf7d0"
                  : (slot.required ? "1px solid #fecaca" : "1px solid #e5e7eb"),
                background: uploaded
                  ? "#f0fdf4"
                  : (slot.required ? "#fef2f2" : "#f8fafc"),
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>
                    {slot.label}
                    {slot.required && (
                      <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {slot.hint}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: uploaded ? "#dcfce7" : "#fee2e2",
                    color:      uploaded ? "#166534" : "#991b1b",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    whiteSpace: "nowrap",
                  }}>
                    {uploaded
                      ? `${filesInSlot.length} file${filesInSlot.length === 1 ? "" : "s"}`
                      : (slot.required ? "Required" : "Optional")}
                  </span>

                  <label
                    htmlFor={inputId}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 14px",
                      borderRadius: 8,
                      background: "#0f172a",
                      color: "#ffffff",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: pending ? "not-allowed" : "pointer",
                      opacity: pending ? 0.6 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Upload Files
                  </label>
                  <input
                    id={inputId}
                    type="file"
                    multiple
                    accept=".pdf,image/*,.doc,.docx"
                    disabled={pending}
                    onChange={(e) => handleSlotPick(slot, e)}
                    style={{ display: "none" }}
                  />
                </div>
              </div>

              {uploaded && (
                <ul style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "10px 0 0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}>
                  {filesInSlot.map((d) => (
                    <li key={d.ID} style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: 12.5,
                      background: "#ffffff",
                      border: "1px solid #d1fadf",
                      borderRadius: 6,
                      padding: "6px 10px",
                    }}>
                      <span style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {d.TITLE || d.FILE_NAME || "Untitled"}
                      </span>
                      <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                        <a
                          href={`${API.defaults.baseURL || ""}${d.FILE_URL}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 12, color: "#0f172a", fontWeight: 600, textDecoration: "none" }}
                        >
                          View
                        </a>
                        <button
                          type="button"
                          onClick={() => removeDoc(d)}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#b91c1c",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {error && <div className={styles.docErrorBanner}>⚠ {error}</div>}

      {/* ---- Legacy any-other-document picker, kept collapsed so the
              admin can still attach offer letters, address proof,
              photograph, etc. that aren't in the six required slots. ---- */}
      <details style={{ marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155" }}>
          Add another document (optional)
        </summary>

      {/* Upload row */}
      <form onSubmit={upload} className={styles.docUploadForm}>
        <label className={styles.docUploadLabel}>
          DOCUMENT TYPE
          <select
            value={draft.doc_type}
            onChange={(e) => setDraft((d) => ({ ...d, doc_type: e.target.value }))}
            className={styles.docUploadSelect}
          >
            {/* Render as grouped <optgroup> so the types scan easily */}
            {(() => {
              const groupedTypes = DOC_TYPES.reduce((acc, t) => {
                (acc[t.group || "Other"] ||= []).push(t);
                return acc;
              }, {});

              const order = ["Identity", "Education", "Employment", "Personal", "Other"];

              return order
                .filter((g) => groupedTypes[g])
                .map((g) => (
                  <optgroup key={g} label={g}>
                    {groupedTypes[g].map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.icon} {t.label}
                      </option>
                    ))}
                  </optgroup>
                ));
            })()}
          </select>
        </label>
        <label className={styles.docUploadLabel}>
          TITLE (optional)
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="e.g. Aadhaar — Front"
            className={styles.docUploadInput}
          />
        </label>
        <label className={styles.docUploadLabel}>
          FILE (PDF / Image / DOC / XLS · max 10 MB)
          <input
            id={`emp-doc-file-${empId}`}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setDraft((d) => ({ ...d, file: e.target.files?.[0] || null }))}
            className={styles.docUploadFileInput}
          />
        </label>
        <button type="submit" disabled={pending || !draft.file} className={styles.docUploadBtn}>
          {pending ? "Uploading…" : "⬆ Upload"}
        </button>
      </form>
      </details>

      {loading && <div className={styles.docLoadingText}>Loading documents…</div>}

      {/* "Other documents" list — anything the employee uploaded that
          isn't one of the six required-slot types (offer letter,
          photograph, address proof, resume, etc.). The required-slot
          types are already surfaced inside their own cards above, so
          filtering them out here avoids showing the same doc twice. */}
      {(() => {
        const slotTypes = new Set(REQUIRED_DOC_SLOTS.flatMap((s) => s.types));
        const otherEntries = Object.entries(grouped).filter(([type]) => !slotTypes.has(type));
        if (otherEntries.length === 0) return null;
        return (
          <>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              color: "#dc2626",
              textTransform: "uppercase",
              margin: "18px 0 8px",
            }}>
              Other Documents
            </div>
            {otherEntries.map(([type, items]) => (
        <div key={type} style={{ marginBottom: 12 }}>
          <div className={styles.docGroupLabel}>
            {DOC_TYPE_LABEL[type] || type} · {items.length}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {items.map((d) => (
              <div key={d.ID} className={styles.docItem}>
                <div>
                  <div className={styles.docItemName}>
                    {d.TITLE || d.FILE_NAME || `Document #${d.ID}`}
                  </div>
                  <div className={styles.docItemMeta}>
                    {d.FILE_NAME && d.FILE_NAME !== d.TITLE ? `${d.FILE_NAME} · ` : ""}
                    {formatBytes(d.SIZE_BYTES)}
                    {d.UPLOADED_AT ? ` · ${d.UPLOADED_AT.slice(0, 10)}` : ""}
                    {d.NOTES ? ` · ${d.NOTES}` : ""}
                  </div>
                </div>
                <a
                  href={`${API.defaults.baseURL || ""}${d.FILE_URL}`}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.docViewLink}
                >
                  👁 View
                </a>
                <a
                  href={`${API.defaults.baseURL || ""}${d.FILE_URL}`}
                  download={d.FILE_NAME || "document"}
                  className={styles.docDownloadLink}
                >
                  ⬇ Download
                </a>
                <button type="button" onClick={() => removeDoc(d)} className={styles.docDeleteBtn}>
                  🗑 Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
          </>
        );
      })()}
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
    <div onClick={onClose} className={styles.modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} className={styles.resumeModalPanel}>

        {/* Fixed header — stays visible while body scrolls */}
        <div className={styles.resumeModalHeader}>
          <button onClick={onClose} className={styles.resumeCloseBtn}>×</button>

          <div className={styles.resumeHeaderRow}>
            <Avatar employee={employee} size={120} dataUrl={photoDataUrl} />
            <div className={styles.resumeHeaderFlex}>
              <div className={styles.resumeEyebrow}>Employee Profile</div>
              <h1 className={styles.resumeName}>{employee.NAME}</h1>
              <div className={styles.resumeSubTitle}>
                {employee.DESIGNATION?.TITLE || "—"}
                {employee.DEPARTMENT?.NAME && <> · {employee.DEPARTMENT.NAME}</>}
              </div>
              <div className={styles.resumeCodeBadge}>{employee.EMPLOYEE_CODE}</div>
            </div>
          </div>
        </div>

        {/* Body: balanced 2-column identity grid at top, then full-width
            content sections below. Scrollable area — only this part scrolls,
            keeping the profile header pinned in view. */}
        <div className={styles.resumeBody}>

          {/* Top — identity grid: Contact | Personal */}
          <div className={styles.resumeGrid2}>

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
                  <div className={styles.emergencyContactWrap}>
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
          <div className={styles.resumeGrid2}>

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
                {!employee.QUALIFICATION &&
                  !employee.YEAR_OF_PASSING &&
                  !employee.COLLEGE &&
                  !employee.UNIVERSITY &&
                  employee.PERCENTAGE == null && (
                    <div className={styles.noEduInfo}>No education info on file</div>
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
                {employee.STATUS && <ResumeRow icon="⚡" label="Status" value={employee.STATUS} />}
                {employee.JOINING_DATE && (
                  <ResumeRow icon="📆" label="Joined" value={employee.JOINING_DATE} />
                )}
                {employee.WORK_LOCATION && (
                  <ResumeRow icon="📍" label="Location" value={employee.WORK_LOCATION} />
                )}
                {(Number(employee.EXPERIENCE_YEARS) || 0) > 0 && (
                  <ResumeRow icon="⏳" label="Experience" value={`${employee.EXPERIENCE_YEARS} year(s)`} />
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
              <div className={styles.skillsPillWrap}>
                {skills.map((s, i) => (
                  <span key={i} className={styles.skillsPill}>
                    {s}
                  </span>
                ))}
              </div>
            </ResumeBlock>
          )}

          {/* Two-column flex for Work Experience + Past Projects */}
          {(employee.EXPERIENCE_DETAILS || employee.PAST_PROJECTS) && (
            <div
              className={
                employee.EXPERIENCE_DETAILS && employee.PAST_PROJECTS
                  ? styles.resumeGrid2ExpProj
                  : styles.resumeGrid1
              }
            >
              {employee.EXPERIENCE_DETAILS && (
                <ResumeBlock title="💼 Work Experience">
                  <div className={`${styles.preBlock} ${styles.preBlockExperience}`}>
                    {employee.EXPERIENCE_DETAILS}
                  </div>
                </ResumeBlock>
              )}

              {employee.PAST_PROJECTS && (
                <ResumeBlock title="🏗 Past Projects">
                  <div className={`${styles.preBlock} ${styles.preBlockProjects}`}>
                    {employee.PAST_PROJECTS}
                  </div>
                </ResumeBlock>
              )}
            </div>
          )}

          {employee.NOTES && (
            <ResumeBlock title="📝 Notes">
              <div className={`${styles.preBlock} ${styles.preBlockNotes}`}>{employee.NOTES}</div>
            </ResumeBlock>
          )}

          {(employee.BANK_ACCOUNT_NUMBER ||
            employee.BANK_NAME ||
            employee.IFSC_CODE ||
            employee.PAN_NUMBER ||
            employee.AADHAAR_NUMBER) && (
              <ResumeBlock title="🏦 Bank & Identity">
                <div className={styles.bankGrid}>
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
              <div className={styles.compensationAmount}>
                ₹ {Number(employee.SALARY).toLocaleString("en-IN")}
                <span className={styles.compensationUnit}>/ month</span>
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
    <div className={styles.resumeBlock}>
      <div className={styles.resumeBlockTitle}>{title}</div>
      {children}
    </div>
  );
}


function ResumeRow({ icon, label, value }) {
  return (
    <div className={styles.resumeRow}>
      <span className={styles.resumeRowIcon}>{icon}</span>
      <div className={styles.resumeRowBody}>
        <div className={styles.resumeRowLabel}>{label}</div>
        <div className={styles.resumeRowValue}>{value}</div>
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
    JOINING_DATE: editingEmployee?.JOINING_DATE || "",
    WORK_LOCATION: editingEmployee?.WORK_LOCATION || "",
    COLLEGE: editingEmployee?.COLLEGE || "",
    UNIVERSITY: editingEmployee?.UNIVERSITY || "",
    PERCENTAGE: editingEmployee?.PERCENTAGE ?? "",
    PREVIOUS_COMPANY: editingEmployee?.PREVIOUS_COMPANY || "",
    PREVIOUS_SALARY: editingEmployee?.PREVIOUS_SALARY ?? "",
    // Current monthly salary — drives payroll BASE_SALARY snapshot.
    SALARY: editingEmployee?.SALARY ?? "",
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
    SAL_ESI_APPLICABLE: true,
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
          SAL_ESI_APPLICABLE: s.ESI_APPLICABLE !== false,
        }));
      })
      .catch(() => {
        /* 404 = no structure yet, leave fields blank */
      });
  }, [editingEmployee?.ID]);

  const [photoFile, setPhotoFile] = useState(null);
  // Seed the preview from the employee's existing photo in edit mode
  // (this modal remounts fresh per edit session) so the strip shows
  // their current photo instead of falling back to initials until a
  // new file is chosen.
  const [photoPreview, setPhotoPreview] = useState(() =>
    editingEmployee?.PHOTO_URL ? `${API_BASE_URL}${editingEmployee.PHOTO_URL}` : null
  );
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  const [errors, setErrors] = useState({});
  const [phoneErrors, setPhoneErrors] = useState({ PHONE: "", EMERGENCY_CONTACT_PHONE: "" });
  const [showPreview, setShowPreview] = useState(false);

  // "Send Login Credentials" modal — Edit page only. Admin types the
  // password they want emailed; backend does NOT change the stored
  // password (this replaces the WhatsApp-broadcast workflow, it does
  // not reset anyone's login).
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [credPassword, setCredPassword] = useState("");
  const [credSending, setCredSending] = useState(false);
  const [credError, setCredError] = useState("");

  const sendCredentials = async () => {
    if (!editingEmployee?.ID) return;
    const pw = credPassword.trim();
    if (!pw) {
      setCredError("Please type the password you want the employee to receive.");
      return;
    }
    setCredSending(true);
    setCredError("");
    try {
      const res = await API.post(
        `/employees/${editingEmployee.ID}/send-credentials`,
        { password: pw }
      );
      setCredModalOpen(false);
      setCredPassword("");
      setSuccessBanner(
        `Login credentials emailed to ${res.data?.email || form.EMAIL}.`
      );
      // Auto-clear the success banner after 6 seconds so it doesn't
      // linger through subsequent edits.
      setTimeout(() => setSuccessBanner(""), 6000);
    } catch (e) {
      setCredError(
        e?.response?.data?.detail || "Could not send credentials email."
      );
    } finally {
      setCredSending(false);
    }
  };

  // Department -> Role cascade: always show global/system roles (no
  // DEPARTMENT_ID) plus any role scoped to the selected department. If
  // the already-selected role falls outside that filtered set (e.g. the
  // department was just changed), keep it in the list anyway instead of
  // silently clearing a valid existing assignment — the admin has to
  // actively pick a different role for it to change.
  const rolesForSelectedDept = useMemo(() => {
    const filtered = roles.filter(
      (r) => !r.DEPARTMENT_ID || String(r.DEPARTMENT_ID) === String(form.DEPARTMENT_ID)
    );
    if (form.ROLE_ID && !filtered.some((r) => String(r.ID) === String(form.ROLE_ID))) {
      const current = roles.find((r) => String(r.ID) === String(form.ROLE_ID));
      if (current) return [...filtered, current];
    }
    return filtered;
  }, [roles, form.DEPARTMENT_ID, form.ROLE_ID]);

  useEffect(() => {
    Promise.all([
      API.get("/departments").catch(() => ({ data: [] })),
      API.get("/designations").catch(() => ({ data: [] })),
      API.get("/roles").catch(() => ({ data: [] })),
    ]).then(([d, dg, r]) => {
      setDepartments(d.data || []);
      setDesignations(dg.data || []);
      setRoles(r.data || []);
    });
  }, []);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    clearFieldError(setErrors, k);
  };

  // PMSelect passes the raw value directly (not an event) — used for
  // ROLE_ID/DEPARTMENT_ID below instead of the event-based `set`.
  const setValue = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }));
    clearFieldError(setErrors, k);
  };

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

    // Create-mode validation requires PASSWORD + ROLE; edit-mode doesn't
    // touch the password here (admin uses /reset-password if needed) —
    // EMPLOYEE_RULES itself skips those fields when _IS_EDIT is true.
    const { isValid, errors: fieldErrors } = validateForm(EMPLOYEE_RULES, { ...form, _IS_EDIT: isEdit });
    if (!isValid) {
      setErrors(fieldErrors);
      setError("Please fix the highlighted fields below.");
      return;
    }
    setErrors({});

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
        PERCENTAGE:
          form.PERCENTAGE === "" || form.PERCENTAGE == null ? null : Number(form.PERCENTAGE),
        PREVIOUS_SALARY:
          form.PREVIOUS_SALARY === "" || form.PREVIOUS_SALARY == null
            ? null
            : Number(form.PREVIOUS_SALARY),
        SALARY: form.SALARY === "" || form.SALARY == null ? 0 : Number(form.SALARY),
        JOINING_DATE: form.JOINING_DATE || null,
      };

      let empId;

      if (isEdit) {
        // EmployeeUpdate schema doesn't take EMPLOYEE_CODE / PASSWORD
        // — strip them. Admin can use /reset-password for that.
        const { EMPLOYEE_CODE, PASSWORD, ...editPayload } = basePayload;

        await API.put(`/update-employee/${editingEmployee.ID}`, editPayload);
        empId = editingEmployee.ID;
      } else {
        const payload = {
          ...basePayload,
          EMPLOYEE_CODE: form.EMPLOYEE_CODE.trim().toUpperCase(),
          VENDOR_ID,
        };

        const res = await API.post("/create-employee", payload);
        empId = res.data?.employee_id;
      }

      // Photo upload — non-fatal (employee already saved).
      if (photoFile && empId) {
        try {
          const fd = new FormData();
          fd.append("file", photoFile);
          await API.post(`/employees/${empId}/upload-photo`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        } catch {
          // non-fatal — employee saved, photo couldn't upload
        }
      }

      // Salary structure — non-fatal, runs regardless of photo.
      if (empId) {
        const salFields = [
          form.SAL_BASIC,
          form.SAL_HRA,
          form.SAL_DA,
          form.SAL_CONVEYANCE,
          form.SAL_MEDICAL,
          form.SAL_SPECIAL,
          form.SAL_OTHER,
          form.SAL_INCENTIVES,
          form.SAL_ANNUAL_BONUS,
        ];

        const hasAnySalary = salFields.some((v) => v !== "" && v != null && Number(v) > 0);

        if (hasAnySalary) {
          try {
            await API.put(`/payroll/salary-structures/${empId}`, {
              BASIC: Number(form.SAL_BASIC) || 0,
              HRA: Number(form.SAL_HRA) || 0,
              DA: Number(form.SAL_DA) || 0,
              CONVEYANCE_ALLOWANCE: Number(form.SAL_CONVEYANCE) || 0,
              MEDICAL_ALLOWANCE: Number(form.SAL_MEDICAL) || 0,
              SPECIAL_ALLOWANCE: Number(form.SAL_SPECIAL) || 0,
              OTHER_ALLOWANCES: Number(form.SAL_OTHER) || 0,
              INCENTIVES: Number(form.SAL_INCENTIVES) || 0,
              ANNUAL_BONUS: Number(form.SAL_ANNUAL_BONUS) || 0,
              PT_STATE: form.SAL_PT_STATE || "TAMIL_NADU",
              PF_APPLICABLE: form.SAL_PF_APPLICABLE ? 1 : 0,
              ESI_APPLICABLE: form.SAL_ESI_APPLICABLE ? 1 : 0,
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
        message = resp.data.detail
          .map((d) => {
            const field = (d.loc || []).slice(1).join(".") || "field";
            return `${field}: ${d.msg}`;
          })
          .join(" · ");
      } else if (typeof resp.data?.detail === "string") {
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
  const previewEmployee = useMemo(
    () => ({
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
      STATUS: "ACTIVE",
    }),
    [form, departments, designations, roles]
  );

  return (
    <div onClick={onClose} className={styles.drawerBackdrop}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className={styles.drawerPanel}
      >
        <div className={styles.drawerHeader}>
          <div>
            <div className={styles.drawerHeaderEyebrow}>
              {isEdit ? "EMPLOYEE PROFILE" : "EMPLOYEE REGISTRATION"}
            </div>
            <div className={styles.drawerHeaderTitle}>
              {isEdit
                ? `Edit ${editingEmployee.NAME || editingEmployee.EMPLOYEE_CODE}`
                : "Add New Employee"}
            </div>
          </div>
          <div className={styles.drawerHeaderButtons}>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className={styles.drawerGhostBtn}
            >
              View Data
            </button>
            <button type="button" onClick={onClose} className={styles.drawerCloseBtn}>
              ×
            </button>
          </div>
        </div>

        <div className={styles.drawerBody}>

          {error && <div className={styles.formErrorBanner}>{error}</div>}
          {successBanner && (
            <div
              className={styles.formErrorBanner}
              style={{
                background: "#dcfce7",
                color: "#15803d",
                border: "1px solid #86efac",
              }}
            >
              {successBanner}
            </div>
          )}

          <div className={styles.photoStrip}>
            <div
              className={styles.photoStripAvatar}
              style={{
                width: 100,
                height: 100,
                fontSize: 38,
                background: photoPreview
                  ? `url(${photoPreview}) center/cover`
                  : avatarGradient(form.NAME),
              }}
            >
              {!photoPreview && initials(form.NAME)}
            </div>

            <div className={styles.photoStripInfo}>
              <div className={styles.photoStripTitle}>Passport-size photo</div>
              <div className={styles.photoStripHint}>
                PNG / JPG / WEBP. Saved to the employee's profile. Will appear on cards,
                attendance views, and the resume.
              </div>
              <label htmlFor="emp-photo-input" className={styles.photoUploadLabel}>
                {photoPreview ? "Change photo" : "Upload photo"}
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
          <FormSection title="① Personal Information">
            <FormGrid cols={2}>
              <FormField
                label={isEdit ? "Employee ID (auto-generated)" : "Employee ID"}
                error={errors.EMPLOYEE_CODE}
                hint={
                  isEdit
                    ? "Regenerates automatically if Department or Role changes."
                    : "Generated automatically from the selected Department and Role after saving."
                }
              >
                <input
                  type="text"
                  value={form.EMPLOYEE_CODE}
                  placeholder="Auto-generated on save"
                  readOnly
                  disabled
                  className={`${styles.formInput} ${styles.formInputLocked}`}
                />
              </FormField>
              <FormField label="Employee Name *" error={errors.NAME}>
                <input
                  type="text"
                  value={form.NAME}
                  onChange={set("NAME")}
                  placeholder="Ramesh Kumar"
                  className={`${styles.formInput}${errors.NAME ? ` ${styles.formInputError}` : ""}`}
                />
              </FormField>
              <FormField label="Father's Name">
                <input
                  type="text"
                  value={form.FATHER_NAME}
                  onChange={set("FATHER_NAME")}
                  placeholder="Murugan"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Mother's Name">
                <input
                  type="text"
                  value={form.MOTHER_NAME}
                  onChange={set("MOTHER_NAME")}
                  placeholder="Lakshmi"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Date of Birth">
                <input type="date" value={form.DOB} onChange={set("DOB")} className={styles.formInput} />
              </FormField>
              <FormField label="Gender">
                <select value={form.GENDER} onChange={set("GENDER")} className={styles.formInput}>
                  <option value="">— pick —</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Marital Status">
                <select
                  value={form.MARITAL_STATUS}
                  onChange={set("MARITAL_STATUS")}
                  className={styles.formInput}
                >
                  <option value="">— pick —</option>
                  {MARITAL_STATUSES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Occupation">
                <input
                  type="text"
                  value={form.OCCUPATION}
                  onChange={set("OCCUPATION")}
                  placeholder="Mechanical Technician"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Blood Group">
                <select
                  value={form.BLOOD_GROUP}
                  onChange={set("BLOOD_GROUP")}
                  className={styles.formInput}
                >
                  <option value="">— pick —</option>
                  {["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Nationality">
                <input
                  type="text"
                  value={form.NATIONALITY}
                  onChange={set("NATIONALITY")}
                  placeholder="Indian"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Emergency Contact Name">
                <input
                  type="text"
                  value={form.EMERGENCY_CONTACT_NAME}
                  onChange={set("EMERGENCY_CONTACT_NAME")}
                  placeholder="Spouse / Parent / Sibling"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Emergency Contact Phone">
                <input
                  type="text"
                  value={form.EMERGENCY_CONTACT_PHONE}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setForm((f) => ({ ...f, EMERGENCY_CONTACT_PHONE: digits }));
                    setPhoneErrors((err) => ({
                      ...err,
                      EMERGENCY_CONTACT_PHONE:
                        digits.length > 0 && digits.length < 10
                          ? "Mobile number must be 10 digits"
                          : "",
                    }));
                  }}
                  placeholder="9876543210"
                  inputMode="numeric"
                  className={`${styles.formInput}${phoneErrors.EMERGENCY_CONTACT_PHONE ? ` ${styles.formInputError}` : ""
                    }`}
                />
                {phoneErrors.EMERGENCY_CONTACT_PHONE && (
                  <div className={styles.fieldValidationMsg}>
                    {phoneErrors.EMERGENCY_CONTACT_PHONE}
                  </div>
                )}
              </FormField>
              <FormField label="Relationship" span={2}>
                <input
                  type="text"
                  value={form.EMERGENCY_CONTACT_RELATION}
                  onChange={set("EMERGENCY_CONTACT_RELATION")}
                  placeholder="Father / Mother / Spouse / Sibling"
                  className={styles.formInput}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 2. CONTACT & LOGIN DETAILS ============== */}
          <FormSection title="② Contact & Login Details">
            <FormGrid cols={2}>
              <FormField label={isEdit ? "Contact Number" : "Contact Number *"}>
                <input
                  type="text"
                  value={form.PHONE}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setForm((f) => ({ ...f, PHONE: digits }));
                    setPhoneErrors((err) => ({
                      ...err,
                      PHONE:
                        digits.length > 0 && digits.length < 10
                          ? "Mobile number must be 10 digits"
                          : "",
                    }));
                  }}
                  placeholder="9876543210"
                  inputMode="numeric"
                  className={`${styles.formInput}${phoneErrors.PHONE ? ` ${styles.formInputError}` : ""
                    }`}
                />
                {phoneErrors.PHONE && (
                  <div className={styles.fieldValidationMsg}>{phoneErrors.PHONE}</div>
                )}
              </FormField>
              <FormField label={isEdit ? "Email" : "Email *"} error={errors.EMAIL}>
                <input
                  type="email"
                  value={form.EMAIL}
                  onChange={set("EMAIL")}
                  placeholder="ramesh@bvc24.in"
                  className={`${styles.formInput}${errors.EMAIL ? ` ${styles.formInputError}` : ""}`}
                />
              </FormField>
              <FormField label="Address (Street / House No)" span={2}>
                <textarea
                  rows={2}
                  value={form.ADDRESS}
                  onChange={set("ADDRESS")}
                  placeholder="Plot 12, ABC Street, Near XYZ Park"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="City">
                <input
                  type="text"
                  value={form.CITY}
                  onChange={set("CITY")}
                  placeholder="Coimbatore"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="State">
                <input
                  type="text"
                  value={form.STATE}
                  onChange={set("STATE")}
                  placeholder="Tamil Nadu"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Pincode" span={2} error={errors.PINCODE}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.PINCODE}
                  onChange={set("PINCODE")}
                  placeholder="641001"
                  maxLength={10}
                  className={`${styles.formInput}${errors.PINCODE ? ` ${styles.formInputError}` : ""}`}
                />
              </FormField>
              {!isEdit && (
                <div className={styles.fieldHint} style={{ gridColumn: "span 2" }}>
                  Login credentials will be generated automatically and emailed to the
                  employee once created.
                </div>
              )}
            </FormGrid>
          </FormSection>

          {/* ============== 3. EDUCATIONAL INFORMATION ============== */}
          <FormSection title="③ Educational Information">
            <FormGrid cols={2}>
              <FormField label="Qualification">
                <input
                  type="text"
                  value={form.QUALIFICATION}
                  onChange={set("QUALIFICATION")}
                  placeholder="BE Mechanical Engineering"
                  className={styles.formInput}
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
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="College">
                <input
                  type="text"
                  value={form.COLLEGE}
                  onChange={set("COLLEGE")}
                  placeholder="PSG College of Technology"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="University">
                <input
                  type="text"
                  value={form.UNIVERSITY}
                  onChange={set("UNIVERSITY")}
                  placeholder="Anna University"
                  className={styles.formInput}
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
                  className={styles.formInput}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 4. PROFESSIONAL INFORMATION ============== */}
          <FormSection title="④ Professional Information">
            <FormGrid cols={2}>
              <FormField label="Fresher / Experienced">
                <select
                  value={form.EMPLOYMENT_TYPE}
                  onChange={set("EMPLOYMENT_TYPE")}
                  className={styles.formInput}
                >
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
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
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Previous Company">
                <input
                  type="text"
                  value={form.PREVIOUS_COMPANY}
                  onChange={set("PREVIOUS_COMPANY")}
                  placeholder="ABC Manufacturing Pvt Ltd"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Current Monthly Salary (₹) *">
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={form.SALARY}
                  onChange={set("SALARY")}
                  placeholder="18001"
                  className={styles.formInput}
                />
                <div className={styles.fieldHint}>
                  Used as the BASE_SALARY snapshot when payroll is generated.
                </div>
              </FormField>
              <FormField label="Previous Salary (₹/month)">
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={form.PREVIOUS_SALARY}
                  onChange={set("PREVIOUS_SALARY")}
                  placeholder="45000"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Skills (comma-separated)" span={2}>
                <input
                  type="text"
                  value={form.SKILLS}
                  onChange={set("SKILLS")}
                  placeholder="solidworks, wiring, assembly, quality check"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Experience Details" span={2}>
                <textarea
                  rows={3}
                  value={form.EXPERIENCE_DETAILS}
                  onChange={set("EXPERIENCE_DETAILS")}
                  placeholder={"ABC Manufacturing — 2 yrs (CNC operator)\nXYZ Industries — 1 yr (Welder)"}
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Past Working Projects" span={2}>
                <textarea
                  rows={3}
                  value={form.PAST_PROJECTS}
                  onChange={set("PAST_PROJECTS")}
                  placeholder={"• Snack Vending Machine v2\n• Industrial Conveyor Belt System\n• Custom CNC retrofit"}
                  className={styles.formInput}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 5. ADDITIONAL INFORMATION ============== */}
          <FormSection title="⑤ Additional Information">
            <FormField label="Extra Information / Notes">
              <textarea
                rows={3}
                value={form.NOTES}
                onChange={set("NOTES")}
                placeholder="Any additional notes about this employee"
                className={styles.formInput}
              />
            </FormField>
          </FormSection>

          {/* ============== 6. Organization Assignment (system) ============== */}
          {/* Required for backend role mapping. Kept at bottom so the
              user-facing form follows the requested professional order. */}
          <FormSection title="⑥ Organization Assignment (system)">
            <FormGrid cols={3}>
              <FormField label="Department">
                <PMSelect
                  options={departments}
                  value={form.DEPARTMENT_ID}
                  onChange={setValue("DEPARTMENT_ID")}
                  valueKey="ID"
                  labelKey="NAME"
                  placeholder="Pick department"
                  allowClear
                  clearLabel="— None —"
                />
              </FormField>
              <FormField label="Role *" error={errors.ROLE_ID}>
                <PMSelect
                  options={rolesForSelectedDept}
                  value={form.ROLE_ID}
                  onChange={setValue("ROLE_ID")}
                  valueKey="ID"
                  labelKey="ROLE_NAME"
                  placeholder="Pick role"
                  allowClear
                  clearLabel="— None —"
                />
                <div className={styles.fieldHint}>
                  {form.DEPARTMENT_ID
                    ? "Showing global roles + roles scoped to this department."
                    : "Pick a department to narrow this list to its roles."}
                </div>
              </FormField>
              {/* Designation dropdown hidden per request — Department + Role
                  are enough. Restore this block if the field is needed again.
              <FormField label="Designation">
                <select
                  value={form.DESIGNATION_ID}
                  onChange={set("DESIGNATION_ID")}
                  className={styles.formInput}
                >
                  <option value="">— pick designation —</option>
                  {designations.map((d) => (
                    <option key={d.ID} value={d.ID}>
                      {d.TITLE}
                    </option>
                  ))}
                </select>
              </FormField>
              */}
              <FormField label="Joining Date">
                <input
                  type="date"
                  value={form.JOINING_DATE}
                  onChange={set("JOINING_DATE")}
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Work Location" span={2}>
                <input
                  type="text"
                  value={form.WORK_LOCATION}
                  onChange={set("WORK_LOCATION")}
                  placeholder="Coimbatore HQ / Chennai Site / Remote"
                  className={styles.formInput}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 7. BANK + KYC ============== */}
          <FormSection title="⑦ Bank & Identity (Payroll)">
            <FormGrid cols={2}>
              <FormField label="Bank Account Number">
                <input
                  type="text"
                  value={form.BANK_ACCOUNT_NUMBER}
                  onChange={set("BANK_ACCOUNT_NUMBER")}
                  placeholder="50100123456789"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="Bank Name">
                <input
                  type="text"
                  value={form.BANK_NAME}
                  onChange={set("BANK_NAME")}
                  placeholder="HDFC Bank"
                  className={styles.formInput}
                />
              </FormField>
              <FormField label="IFSC Code">
                <input
                  type="text"
                  value={form.IFSC_CODE}
                  onChange={set("IFSC_CODE")}
                  placeholder="HDFC0001234"
                  maxLength={20}
                  className={`${styles.formInput} ${styles.formInputUppercase}`}
                />
              </FormField>
              <FormField label="PAN Number">
                <input
                  type="text"
                  value={form.PAN_NUMBER}
                  onChange={set("PAN_NUMBER")}
                  placeholder="ABCDE1234F"
                  maxLength={20}
                  className={`${styles.formInput} ${styles.formInputUppercase}`}
                />
              </FormField>
              <FormField label="Aadhaar Number" span={2}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.AADHAAR_NUMBER}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
                    setForm((f) => ({ ...f, AADHAAR_NUMBER: digits }));
                  }}
                  placeholder="123456789012"
                  className={`${styles.formInput}${form.AADHAAR_NUMBER.length > 0 && form.AADHAAR_NUMBER.length < 12
                    ? ` ${styles.formInputError}`
                    : ""
                    }`}
                />
                {form.AADHAAR_NUMBER.length > 0 && form.AADHAAR_NUMBER.length < 12 && (
                  <div className={styles.fieldValidationMsg}>
                    {form.AADHAAR_NUMBER.length}/12 digits — Aadhaar must be 12 digits
                  </div>
                )}
              </FormField>
            </FormGrid>
          </FormSection>

          {/* ============== 8. SALARY STRUCTURE (drives Payroll) ============== */}
          <FormSection title="⑧ Salary Structure (Payroll)">

            <div className={styles.salaryNote}>
              These monthly amounts drive payroll generation. Leave blank if not yet
              decided — payroll will fall back to <b> Employee.Salary</b> or treat as zero.
              Statutory deductions (PF / ESI / PT) are calculated automatically from the
              basic and gross.
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
                  className={styles.formInput}
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
                  className={styles.formInput}
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
                  className={styles.formInput}
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
                  className={styles.formInput}
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
                  className={styles.formInput}
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
                  className={styles.formInput}
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
                  className={styles.formInput}
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
                  className={styles.formInput}
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
                  className={styles.formInput}
                />
              </FormField>
            </FormGrid>

            <div className={styles.salaryGridSpacer} />

            <FormGrid cols={3}>
              <FormField label="PT State (for Professional Tax slab)">
                <select
                  value={form.SAL_PT_STATE}
                  onChange={set("SAL_PT_STATE")}
                  className={styles.formInput}
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
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={!!form.SAL_PF_APPLICABLE}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, SAL_PF_APPLICABLE: e.target.checked }))
                    }
                  />
                  <span>{form.SAL_PF_APPLICABLE ? "Yes — deduct PF" : "No — skip PF"}</span>
                </label>
              </FormField>
              <FormField label="Deduct ESI (0.75% if gross ≤ ₹21k)">
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={!!form.SAL_ESI_APPLICABLE}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, SAL_ESI_APPLICABLE: e.target.checked }))
                    }
                  />
                  <span>{form.SAL_ESI_APPLICABLE ? "Yes — deduct ESI" : "No — skip ESI"}</span>
                </label>
              </FormField>
            </FormGrid>

            {/* Live-calculated gross — re-renders whenever any earnings field changes */}
            {(() => {
              const sum =
                (Number(form.SAL_BASIC) || 0) +
                (Number(form.SAL_HRA) || 0) +
                (Number(form.SAL_DA) || 0) +
                (Number(form.SAL_CONVEYANCE) || 0) +
                (Number(form.SAL_MEDICAL) || 0) +
                (Number(form.SAL_SPECIAL) || 0) +
                (Number(form.SAL_OTHER) || 0) +
                (Number(form.SAL_INCENTIVES) || 0) +
                (Number(form.SAL_ANNUAL_BONUS) || 0);

              if (sum <= 0) return null;

              const inr = (n) =>
                `₹${Number(n).toLocaleString("en-IN", {
                  maximumFractionDigits: 2,
                  minimumFractionDigits: 2,
                })}`;

              return (
                <div className={styles.grossBar}>
                  <span>Gross / month (auto-calculated)</span>
                  <span className={styles.grossAmount}>{inr(sum)}</span>
                </div>
              );
            })()}
          </FormSection>

          {/* ============== 9. DOCUMENTS ============== */}
          {/* Uploads need an existing employee ID (the endpoint is
              /employees/{id}/documents), so this section only appears
              in edit mode. Same six-slot required-doc UI the employee
              sees on their self-onboarding form. */}
          {isEdit && editingEmployee?.ID && (
            <FormSection title="⑨ Documents (upload on behalf of employee)">
              <EmployeeDocumentsSection employee={editingEmployee} />
            </FormSection>
          )}

          <div className={styles.formFooter}>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className={styles.formPreviewBtn}
            >
              View Data (preview)
            </button>
            {isEdit && (
              <button
                type="button"
                onClick={() => {
                  setCredError("");
                  setCredPassword("");
                  setCredModalOpen(true);
                }}
                disabled={!(form.EMAIL || "").trim()}
                className={styles.formPreviewBtn}
                title={
                  (form.EMAIL || "").trim()
                    ? "Email login ID + password to this employee"
                    : "Set an email address first"
                }
                style={{
                  borderColor: "#dc2626",
                  color: "#dc2626",
                }}
              >
                Send Login Credentials
              </button>
            )}
            <button type="submit" disabled={saving} className={styles.formSaveBtn}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Employee"}
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

      {credModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !credSending) {
              setCredModalOpen(false);
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 16,
          }}
        >
          <div
            style={{
              background: "var(--card-bg, #ffffff)",
              color: "var(--text, #0f172a)",
              width: "100%",
              maxWidth: 440,
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.25)",
            }}
          >
            <h3
              style={{
                margin: 0,
                marginBottom: 8,
                fontSize: 18,
                fontWeight: 700,
                color: "#dc2626",
              }}
            >
              Send Login Credentials
            </h3>
            <p style={{ margin: 0, marginBottom: 16, fontSize: 13, opacity: 0.75 }}>
              Emailing <strong>{editingEmployee?.EMPLOYEE_CODE}</strong> ({form.NAME}) at{" "}
              <strong>{form.EMAIL}</strong>.<br />
              Type the password the employee should receive. The stored login
              password is <em>not</em> changed by this action.
            </p>

            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Password to email
            </label>
            <input
              type="text"
              value={credPassword}
              onChange={(e) => {
                setCredPassword(e.target.value);
                if (credError) setCredError("");
              }}
              placeholder="e.g. !welcome123"
              autoFocus
              disabled={credSending}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border, #d1d5db)",
                background: "var(--input-bg, #ffffff)",
                color: "inherit",
                fontSize: 14,
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />

            {credError && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  background: "#fef2f2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {credError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setCredModalOpen(false)}
                disabled={credSending}
                className={styles.formPreviewBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendCredentials}
                disabled={credSending || !credPassword.trim()}
                className={styles.formSaveBtn}
              >
                {credSending ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function FormSection({ title, children }) {
  return (
    <div className={styles.formSection}>
      <div className={styles.formSectionTitle}>
        {title}
      </div>
      {children}
    </div>
  );
}


function FormGrid({ cols, children }) {
  return (
    <div className={styles.formGrid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {children}
    </div>
  );
}


function FormField({ label, span, error, hint, children }) {
  return (
    <div
      className={styles.formField}
      style={{ gridColumn: span ? `span ${span}` : undefined }}
    >
      <label className={styles.formFieldLabel}>{label}</label>
      {children}
      {error && <div className={styles.fieldValidationMsg}>{error}</div>}
      {!error && hint && <div className={styles.fieldHint}>{hint}</div>}
    </div>
  );
}


// =====================================================================
// Main page
// =====================================================================

function Employees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [showAdd, setShowAdd] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // null = closed; employee object = open in edit mode
  const [editingEmployee, setEditingEmployee] = useState(null);
  // Delete-employee confirmation: { title, description, onConfirm } | null
  const [confirmModal, setConfirmModal] = useState(null);

  // Today's attendance summary — used for the "Total Present / Absent"
  // KPI tiles. Populated in fetchAll() from /attendance/live-board.
  const [attToday, setAttToday] = useState({ in_office: 0, checked_out: 0 });

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      API.get("/employees").catch(() => ({ data: [] })),
      API.get("/attendance/live-board").catch(() => ({ data: null })),
    ])
      .then(([empRes, boardRes]) => {
        setEmployees(empRes.data || []);
        const s = boardRes.data?.summary || {};
        setAttToday({
          in_office:   Number(s.in_office   || 0),
          checked_out: Number(s.checked_out || 0),
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const departments = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => {
      if (e.DEPARTMENT?.NAME) set.add(e.DEPARTMENT.NAME);
    });
    return [...set].sort();
  }, [employees]);

  const rolesList = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => {
      if (e.ROLE?.NAME) set.add(e.ROLE.NAME);
    });
    return [...set].sort();
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = filterFrom ? new Date(filterFrom) : null;
    const to = filterTo ? new Date(filterTo) : null;

    return employees.filter((e) => {
      if (deptFilter && e.DEPARTMENT?.NAME !== deptFilter) return false;
      if (roleFilter && e.ROLE?.NAME !== roleFilter) return false;

      if (from || to) {
        if (!e.JOINING_DATE) return false;
        const d = new Date(e.JOINING_DATE);
        if (from && d < from) return false;
        if (to && d > to) return false;
      }

      if (!q) return true;

      const hay = [
        e.NAME,
        e.EMPLOYEE_CODE,
        e.EMAIL,
        e.PHONE,
        e.SKILLS,
        e.QUALIFICATION,
        e.DEPARTMENT?.NAME,
        e.ROLE?.NAME,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [employees, search, deptFilter, roleFilter, filterFrom, filterTo]);

  // Reset to page 1 whenever a filter changes (so we don't land on
  // an empty page beyond the new result set's last page).
  useEffect(() => { setPage(1); }, [search, deptFilter, roleFilter, filterFrom, filterTo]);

  // Slice the filtered list for the current page.
  const pagedEmployees = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const stats = useMemo(() => {
    const total = employees.length;
    // "Present today" = anyone who punched in today, whether they're
    // still on-site (in_office) or already checked out (checked_out).
    // Live-board summary comes from /attendance/live-board.
    const present = attToday.in_office + attToday.checked_out;
    // "Absent today" = active employees who never punched in. Guarded
    // against negative results (if the board reports more punches than
    // the current active headcount for any reason).
    const activeCount = employees.filter((e) => e.STATUS === "ACTIVE").length;
    const absent = Math.max(0, activeCount - present);

    return { total, present, absent };
  }, [employees, attToday]);

  const handleDelete = (emp) => {
    setConfirmModal({
      title: "Delete Employee",
      description: `Delete employee "${emp.NAME}" (${emp.EMPLOYEE_CODE})? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await API.delete(`/delete-employee/${emp.ID}`);
          fetchAll();
        } catch (err) {
          alert(err?.response?.data?.detail || "Delete failed");
        }
      },
    });
  };

  // Fetch the employee's resume-style PDF and trigger a browser download.
  const downloadEmployeeResume = async (emp) => {
    try {
      const res = await API.get(`/employees/${emp.ID}/resume.pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const safeCode = (emp.EMPLOYEE_CODE || "employee").replace(/\s+/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeCode}_profile.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to download profile PDF");
    }
  };

  return (
    <div className={styles.pageWrapper}>

      <PageHeader
        icon={EmployeesIcon}
        iconAlt="Employees"
        title="Employees"
        subtitle="Manage your team, onboarding invites and roles."
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              className={styles.bannerInviteBtn}
            >
              {/* <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg> */}
              Invite via Onboarding
            </button>
            <button type="button" onClick={() => setShowAdd(true)} className={styles.bannerAddBtn}>
              {/* <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg> */}
              Add Employee
            </button>
          </>
        }
      />

      <StatsRow
        stats={[
          { value: stats.total,   label: "Total Employees" },
          { value: stats.present, label: "Total Present", sub: "today" },
          { value: stats.absent,  label: "Total Absent",  sub: "today" },
        ]}
      />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <div className={styles.filterSearchWrap}>
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search by name, code, email, skill, qualification…"
            />
          </div>
          <div className={styles.filterSelectWrap}>
            <PMSelect
              options={departments}
              value={deptFilter}
              onChange={setDeptFilter}
              placeholder="All departments"
              allowClear
              clearLabel="All departments"
            />
          </div>
          <div className={styles.filterSelectWrap}>
            <PMSelect
              options={rolesList}
              value={roleFilter}
              onChange={setRoleFilter}
              placeholder="All roles"
              allowClear
              clearLabel="All roles"
            />
          </div>
          <div className={styles.dateFilters}>
            <label className={styles.dateLabel}>From</label>
            <input
              type="date"
              className={styles.dateInput}
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
            <label className={styles.dateLabel}>To</label>
            <input
              type="date"
              className={styles.dateInput}
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
            {(filterFrom || filterTo) && (
              <button
                type="button"
                className={styles.clearFilter}
                onClick={() => { setFilterFrom(""); setFilterTo(""); }}
              >
                ✕
              </button>
            )}
          </div>
          <span className={styles.count}>
            {filtered.length} employee{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Employee Code</th>
                <th>Name</th>
                <th>Department</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Joining Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9}>
                    <Loader />
                  </td>
                </tr>
              ) : pagedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={EmployeesIcon}
                      iconAlt="Employees"
                      title={search || deptFilter || roleFilter || filterFrom || filterTo
                        ? "No employees match your filters"
                        : "No employees yet"}
                      description={
                        !search && !deptFilter && !roleFilter && !filterFrom && !filterTo
                          ? "Click '+ Add Employee' to get started."
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                pagedEmployees.map((emp, i) => {
                  const status = statusBadge(emp);
                  const isDefaultSuperAdmin = !!emp.IS_DEFAULT_SUPER_ADMIN;
                  return (
                    <tr key={emp.ID}>
                      <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                      <td><span className={styles.codeBadge}>{emp.EMPLOYEE_CODE}</span></td>
                      <td className={styles.nameCell}>{emp.NAME || "—"}</td>
                      <td className={styles.descCell}>
                        {emp.DEPARTMENT?.NAME || <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.descCell}>
                        {emp.ROLE?.NAME || <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.descCell}>
                        {emp.PHONE || <span className={styles.muted}>—</span>}
                      </td>
                      <td>
                        <span className={styles.statusPill} data-tone={status.tone}>
                          {status.label}
                        </span>
                      </td>
                      <td className={styles.dateCell}>
                        {fmtJoinDate(emp.JOINING_DATE) || <span className={styles.muted}>—</span>}
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => navigate(`/employees/${emp.ID}/profile`)}
                            title="View profile"
                          >
                            <img src={DetailsIconImg} alt="View" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => downloadEmployeeResume(emp)}
                            title="Download profile PDF"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24"
                                 fill="none" stroke="currentColor" strokeWidth="2"
                                 strokeLinecap="round" strokeLinejoin="round"
                                 aria-hidden="true">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => setEditingEmployee(emp)}
                            title="Edit"
                          >
                            <img src={EditIconImg} alt="Edit" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtnDanger}
                            onClick={() => handleDelete(emp)}
                            disabled={isDefaultSuperAdmin}
                            title={isDefaultSuperAdmin ? "The default Super Admin account cannot be deleted" : "Delete"}
                          >
                            <img src={DeleteIconImg} alt="Delete" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>

      {showAdd && (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            fetchAll();
          }}
        />
      )}

      {editingEmployee && (
        <AddEmployeeModal
          editingEmployee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onCreated={() => {
            setEditingEmployee(null);
            fetchAll();
          }}
        />
      )}

      {showInvite && <InviteEmployeeModal onClose={() => setShowInvite(false)} />}

      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => { })}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
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
    EMAIL: "",
    PASSWORD: "",
    EXPIRES_IN_DAYS: 2,
    DEPARTMENT_ID: "",
    DESIGNATION_ID: "",
  });

  // Departments + Designations are loaded from the org catalog
  // (/departments and /designations). Both are auto-seeded with the
  // canonical manufacturing list on backend boot.
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);

  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Toggle for the password field's eye icon — admin can verify the
  // 6+ char password they're sending the candidate before submitting.
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  // Fetch dropdown options once when the modal opens
  useEffect(() => {
    API.get("/departments")
      .then((r) => setDepartments(Array.isArray(r.data) ? r.data : []))
      .catch(() => setDepartments([]));

    API.get("/designations")
      .then((r) => setDesignations(Array.isArray(r.data) ? r.data : []))
      .catch(() => setDesignations([]));
  }, []);

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
        EMAIL: emailTrim,
        PASSWORD: form.PASSWORD,
        EXPIRES_IN_DAYS: Number(form.EXPIRES_IN_DAYS) || 2,
        DEPARTMENT_ID: form.DEPARTMENT_ID ? Number(form.DEPARTMENT_ID) : null,
        DESIGNATION_ID: form.DESIGNATION_ID ? Number(form.DESIGNATION_ID) : null,
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
    <div onClick={onClose} className={styles.inviteBackdrop}>
      <div onClick={(e) => e.stopPropagation()} className={styles.invitePanel}>

        {/* Sticky header */}
        <div className={styles.inviteHeader}>
          <div>
            <div className={styles.inviteHeaderEyebrow}>EMPLOYEE AI ONBOARDING</div>
            <h2 className={styles.inviteHeaderTitle}>Invite candidate to self-onboard</h2>
          </div>
          <button onClick={onClose} className={styles.inviteCloseBtn}>
            ×
          </button>
        </div>

        {/* Body — only this scrolls so the header stays pinned */}
        <div className={styles.inviteBody}>

          <p className={styles.inviteIntro}>
            Generate a one-time link the candidate opens in their browser. Our AI assistant
            walks them through every field — once they hit <b>Submit</b>, the session appears
            under <b> Onboarding Review</b> for HR approval.
          </p>

          {!result && (
            <form onSubmit={submit}>
              <div className={styles.inviteFormGrid}>
                <InviteField label="Candidate name *">
                  <input
                    type="text"
                    value={form.INVITED_NAME}
                    onChange={set("INVITED_NAME")}
                    placeholder="e.g. Ramesh Kumar"
                    className={styles.inviteInput}
                  />
                </InviteField>
                <InviteField label="Employee ID *">
                  <input
                    type="text"
                    value={form.EMPLOYEE_CODE}
                    onChange={set("EMPLOYEE_CODE")}
                    placeholder="EMP015"
                    className={styles.inviteInput}
                  />
                </InviteField>
                <InviteField label="Candidate email *" span={2}>
                  <input
                    type="email"
                    value={form.EMAIL}
                    onChange={set("EMAIL")}
                    placeholder="ramesh.kumar@example.com"
                    className={styles.inviteInput}
                  />
                </InviteField>
                <InviteField label="Department">
                  <select
                    value={form.DEPARTMENT_ID}
                    onChange={set("DEPARTMENT_ID")}
                    className={styles.inviteInput}
                  >
                    <option value="">— Select —</option>
                    {departments.map((d) => (
                      <option key={d.ID} value={d.ID}>
                        {d.NAME}
                      </option>
                    ))}
                  </select>
                </InviteField>
                <InviteField label="Designation">
                  <select
                    value={form.DESIGNATION_ID}
                    onChange={set("DESIGNATION_ID")}
                    className={styles.inviteInput}
                  >
                    <option value="">— Select —</option>
                    {designations.map((d) => (
                      <option key={d.ID} value={d.ID}>
                        {d.TITLE}
                      </option>
                    ))}
                  </select>
                </InviteField>
                <InviteField label="Login Password *" span={2}>
                  <div className={styles.pwdWrapper}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.PASSWORD}
                      onChange={set("PASSWORD")}
                      placeholder="Min 6 characters"
                      className={`${styles.inviteInput} ${styles.inviteInputPwd}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      title={showPassword ? "Hide password" : "Show password"}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className={`${styles.pwdToggleBtn}${showPassword ? ` ${styles.visible}` : ""}`}
                    >
                      {showPassword ? (
                        // eye-off (currently visible -> click to hide)
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                          <path d="M9.9 4.2A9.5 9.5 0 0 1 12 4c5 0 9.3 3 11 8a14 14 0 0 1-3.4 4.8" />
                          <path d="M6.3 6.3A14 14 0 0 0 1 12c1.7 5 6 8 11 8 1.7 0 3.3-.3 4.7-.9" />
                        </svg>
                      ) : (
                        // eye (currently hidden -> click to show)
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </InviteField>
                <InviteField label="Expires in (days)" span={2}>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={form.EXPIRES_IN_DAYS}
                    onChange={set("EXPIRES_IN_DAYS")}
                    className={styles.inviteInput}
                  />
                </InviteField>
              </div>

              <div className={styles.inviteInfoBox}>
                🔑 The candidate will sign in with this Employee ID + Password to open their
                registration form.
              </div>

              {error && <div className={styles.inviteErrorBox}>⚠ {error}</div>}

              <div className={styles.inviteFormActions}>
                <button type="button" onClick={onClose} className={styles.inviteCancelBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className={styles.inviteSubmitBtn}>
                  {submitting ? "Generating…" : "🔗 Generate Invite Link"}
                </button>
              </div>
            </form>
          )}

          {result && (
            <div className={styles.inviteResultBox}>
              <div className={styles.inviteResultHeader}>
                {result.email_sent ? "✅ INVITE SENT" : "✅ INVITE CREATED"}
                {result.expires_at && (
                  <span className={styles.inviteResultExpiry}>
                    · expires {new Date(result.expires_at).toLocaleDateString("en-IN")}
                  </span>
                )}
              </div>

              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: result.email_sent ? "#ecfdf5" : "#fef2f2",
                  border: `1px solid ${result.email_sent ? "#a7f3d0" : "#fecaca"}`,
                  color: result.email_sent ? "#065f46" : "#7A1022",
                }}
              >
                {result.email_sent ? (
                  <>
                    The invite link was emailed to{" "}
                    <b>{result.invited_email}</b>. The candidate can sign in
                    using the Employee ID and password you set.
                  </>
                ) : (
                  <>
                    Invite created, but the email could not be delivered to{" "}
                    <b>{result.invited_email}</b>
                    {result.email_message ? ` (${result.email_message})` : ""}.
                    Copy the link below and share it manually as a fallback.
                  </>
                )}
              </div>

              <div className={styles.inviteLinkBox}>
                {result.invite_link}
              </div>
              <div className={styles.inviteResultActions}>
                <button
                  onClick={copyLink}
                  className={`${styles.inviteCopyBtn}${copied ? ` ${styles.copied}` : ""}`}
                >
                  {copied ? "✓ Copied!" : "📋 Copy Link"}
                </button>
                <a
                  href={result.invite_link}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.inviteOpenLink}
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
                      EMAIL: "",
                      PASSWORD: "",
                      EXPIRES_IN_DAYS: 2,
                      DEPARTMENT_ID: "",
                      DESIGNATION_ID: ""
                    });
                  }}
                  className={styles.inviteNewBtn}
                >
                  + New invite
                </button>
              </div>

              {emailMsg && <div className={styles.inviteEmailMsg}>{emailMsg}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function InviteField({ label, span, children }) {
  return (
    <div className={styles.inviteField} style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label className={styles.inviteFieldLabel}>{label}</label>
      {children}
    </div>
  );
}


export default Employees;
