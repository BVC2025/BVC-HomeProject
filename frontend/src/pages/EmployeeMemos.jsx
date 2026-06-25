// =====================================================================
// EmployeeMemos.jsx — Admin/HR Memo module
//
// Layout (top → bottom):
//   1. Hero       — red strip with eyebrow HR + title "Memos" + Issue button
//   2. Stat tiles — 4 thin tiles (Total / Active / Pending Ack / Critical)
//   3. Filter bar — search + memo-type + severity + status + date range
//   4. Table      — one row per memo, click to open the detail drawer
//   5. Create modal      (opened from "Issue Memo" CTA)
//   6. View / edit drawer (opened by clicking a row)
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";
import styles from "./EmployeeMemos.module.css";


// --------------- Domain constants (mirror backend) -----------------

const MEMO_TYPE_OPTIONS = [
  { value: "WARNING", label: "Warning" },
  { value: "APPRECIATION", label: "Appreciation" },
  { value: "DISCIPLINARY", label: "Disciplinary" },
  { value: "INFORMATION", label: "Information" },
  { value: "CUSTOMER_COMPLAINT", label: "Customer Complaint" },
  { value: "PERFORMANCE_RECOGNITION", label: "Performance Recognition" },
  { value: "SHOW_CAUSE_NOTICE", label: "Show Cause Notice" }
];

const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const STATUS_OPTIONS = ["ACTIVE", "CLOSED", "CANCELLED"];


// Brand-aligned colour map for type & severity pills.
const TYPE_COLORS = {
  WARNING: { bg: "#fef3c7", fg: "#92400e" },
  APPRECIATION: { bg: "#dcfce7", fg: "#166534" },
  DISCIPLINARY: { bg: "#fee2e2", fg: "#991b1b" },
  INFORMATION: { bg: "#dbeafe", fg: "#1e40af" },
  CUSTOMER_COMPLAINT: { bg: "#ffedd5", fg: "#9a3412" },
  PERFORMANCE_RECOGNITION: { bg: "#fae8ff", fg: "#86198f" },
  SHOW_CAUSE_NOTICE: { bg: "#fee2e2", fg: "#7f1d1d" }
};

const SEVERITY_COLORS = {
  LOW: { bg: "#e0e7ff", fg: "#3730a3" },
  MEDIUM: { bg: "#fef3c7", fg: "#92400e" },
  HIGH: { bg: "#fed7aa", fg: "#9a3412" },
  CRITICAL: { bg: "#fecaca", fg: "#991b1b" }
};

const STATUS_COLORS = {
  ACTIVE: { bg: "#dbeafe", fg: "#1e40af" },
  CLOSED: { bg: "#e2e8f0", fg: "#334155" },
  CANCELLED: { bg: "#fee2e2", fg: "#991b1b" }
};


function fmtDate(iso) {

  if (!iso) return "—";

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}


function prettyType(t) {

  const opt = MEMO_TYPE_OPTIONS.find((o) => o.value === t);

  return opt ? opt.label : (t || "—");
}


// =====================================================================
// MAIN PAGE
// =====================================================================

function EmployeeMemos({ employeeIdLocked = null } = {}) {

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [search, setSearch] = useState("");
  const [filterEmp, setFilterEmp] = useState(employeeIdLocked || "");
  const [filterType, setFilterType] = useState("");
  const [filterSev, setFilterSev] = useState("");
  const [filterStat, setFilterStat] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // overlays
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState(null);

  // -- Data loading --------------------------------------------------
  const buildParams = () => {

    const p = new URLSearchParams();

    if (search.trim()) p.set("search", search.trim());
    if (filterEmp) p.set("employee_id", filterEmp);
    if (filterType) p.set("memo_type", filterType);
    if (filterSev) p.set("severity", filterSev);
    if (filterStat) p.set("status", filterStat);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);

    p.set("limit", "200");

    return p.toString();
  };

  const loadAll = async () => {

    setLoading(true);

    try {

      const params = buildParams();

      const statsParams = filterEmp ? `?employee_id=${filterEmp}` : "";

      const [memosRes, statsRes] = await Promise.all([
        API.get(`/memos?${params}`).catch(() => ({ data: { rows: [] } })),
        API.get(`/memos/stats${statsParams}`).catch(() => ({ data: {} }))
      ]);

      setRows(memosRes.data?.rows || []);
      setStats(statsRes.data || {});

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    API.get("/employees")
      .then((r) => setEmployees(Array.isArray(r.data) ? r.data : []))
      .catch(() => setEmployees([]));

  }, []);

  useEffect(() => {

    loadAll();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterEmp, filterType, filterSev, filterStat, dateFrom, dateTo]);

  // -- Row actions ---------------------------------------------------
  const closeMemo = (id) => API.post(`/memos/${id}/close`).then(loadAll);

  const cancelMemo = (id) => API.post(`/memos/${id}/cancel`).then(loadAll);

  const deleteMemo = (id) => {

    if (!window.confirm("Delete this memo? It will be soft-deleted (recoverable).")) return;

    API.delete(`/memos/${id}`).then(loadAll);
  };

  const empOptions = useMemo(() => {

    return employees.map((e) => ({
      id: e.ID,
      name: e.NAME || "",
      code: e.EMPLOYEE_CODE || ""
    }));

  }, [employees]);

  return (

    <div>

      {/* HERO ------------------------------------------------------- */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>
            HR
          </div>
          <h1 className={styles.heroTitle}>
            Memos
          </h1>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className={styles.heroBtn}
        >
          + Issue Memo
        </button>
      </div>

      {/* STAT TILES ------------------------------------------------- */}
      <div className={styles.statGrid}>
        <StatTile label="Total" value={stats.total ?? 0} accent="#0f172a" />
        <StatTile label="Active" value={stats.active ?? 0} accent="#1e40af" />
        <StatTile label="Pending Ack." value={stats.pending_acknowledgement ?? 0} accent="#92400e" />
        <StatTile label="Active Warnings" value={stats.active_warnings ?? 0} accent="#991b1b" />
      </div>

      {/* FILTER BAR ------------------------------------------------- */}
      <div className={styles.filterBar}>
        <input
          type="text"
          placeholder="Search by memo number, subject, or employee"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.searchInput}
        />

        {!employeeIdLocked && (
          <select
            value={filterEmp}
            onChange={(e) => setFilterEmp(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All employees</option>
            {empOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code ? `${e.code} — ${e.name}` : e.name}
              </option>
            ))}
          </select>
        )}

        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={styles.filterSelect}>
          <option value="">All types</option>
          {MEMO_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select value={filterSev} onChange={(e) => setFilterSev(e.target.value)} className={styles.filterSelect}>
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={filterStat} onChange={(e) => setFilterStat(e.target.value)} className={styles.filterSelect}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className={styles.filterSelect}
        />

        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className={styles.filterSelect}
        />
      </div>

      {/* TABLE ------------------------------------------------------ */}
      <div className={styles.tableCard}>
        {loading && (
          <div className={styles.loadingText}>Loading…</div>
        )}

        {!loading && rows.length === 0 && (
          <div className={styles.emptyState}>
            No memos match the current filters.
            Click <strong>+ Issue Memo</strong> to create one.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Memo No.</th>
                <th className={styles.th}>Employee</th>
                <th className={styles.th}>Type</th>
                <th className={styles.th}>Subject</th>
                <th className={`${styles.th} ${styles.thCenter}`}>Severity</th>
                <th className={`${styles.th} ${styles.thCenter}`}>Status</th>
                <th className={`${styles.th} ${styles.thCenter}`}>Issue Date</th>
                <th className={`${styles.th} ${styles.thRight}`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <MemoRow
                  key={m.ID}
                  memo={m}
                  onOpen={() => setViewing(m)}
                  onClose={() => closeMemo(m.ID)}
                  onCancel={() => cancelMemo(m.ID)}
                  onDelete={() => deleteMemo(m.ID)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* OVERLAYS --------------------------------------------------- */}
      {showCreate && (
        <CreateMemoModal
          employees={empOptions}
          employeeIdLocked={employeeIdLocked}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); loadAll(); }}
        />
      )}

      {viewing && (
        <ViewMemoDrawer
          memo={viewing}
          onClose={() => setViewing(null)}
          onChanged={() => { setViewing(null); loadAll(); }}
        />
      )}
    </div>
  );
}


// =====================================================================
// MEMO ROW
// =====================================================================

function MemoRow({ memo, onOpen, onClose, onCancel, onDelete }) {

  const isLocked = memo.STATUS !== "ACTIVE";

  return (
    <tr className={styles.memoRow}>
      <td className={styles.td}>
        <div
          onClick={onOpen}
          className={styles.memoNumber}
        >
          {memo.MEMO_NUMBER || "—"}
        </div>
      </td>

      <td className={styles.td}>
        <div className={styles.empName}>
          {memo.EMPLOYEE_NAME || "—"}
        </div>
        <div className={styles.empCode}>
          {memo.EMPLOYEE_CODE || ""}
        </div>
      </td>

      <td className={styles.td}>
        <Pill {...(TYPE_COLORS[memo.MEMO_TYPE] || {})}>
          {prettyType(memo.MEMO_TYPE)}
        </Pill>
      </td>

      <td className={styles.td}>
        <div
          onClick={onOpen}
          className={styles.subjectCell}
          title={memo.SUBJECT}
        >
          {memo.SUBJECT}
        </div>
      </td>

      <td className={`${styles.td} ${styles.tdCenter}`}>
        <Pill {...(SEVERITY_COLORS[memo.SEVERITY] || {})}>
          {memo.SEVERITY}
        </Pill>
      </td>

      <td className={`${styles.td} ${styles.tdCenter}`}>
        <Pill {...(STATUS_COLORS[memo.STATUS] || {})}>
          {memo.STATUS}
        </Pill>
        {memo.ACKNOWLEDGED_BY_EMPLOYEE && (
          <div className={styles.ackBadge}>
            ACK
          </div>
        )}
      </td>

      <td className={`${styles.td} ${styles.tdCenter} ${styles.dateCell}`}>
        {fmtDate(memo.ISSUE_DATE)}
      </td>

      <td className={`${styles.td} ${styles.tdRight}`}>
        <div className={styles.rowActions}>
          <RowBtn onClick={onOpen}>View</RowBtn>
          {!isLocked && <RowBtn onClick={onClose}>Close</RowBtn>}
          {!isLocked && <RowBtn onClick={onCancel}>Cancel</RowBtn>}
          <RowBtn danger onClick={onDelete}>Delete</RowBtn>
        </div>
      </td>
    </tr>
  );
}


// =====================================================================
// CREATE MEMO MODAL
// =====================================================================

function CreateMemoModal({ employees, employeeIdLocked, onClose, onSaved }) {

  const [form, setForm] = useState({
    EMPLOYEE_ID: employeeIdLocked || "",
    MEMO_TYPE: "WARNING",
    SEVERITY: "LOW",
    SUBJECT: "",
    DESCRIPTION: "",
    ISSUED_BY: "",
    ISSUE_DATE: new Date().toISOString().slice(0, 10),
    REMARKS: ""
  });

  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {

    if (!form.EMPLOYEE_ID || !form.MEMO_TYPE || !form.SUBJECT.trim()) {

      setError("Employee, type, and subject are required.");

      return;
    }

    setSaving(true);

    setError("");

    try {

      const fd = new FormData();

      Object.entries(form).forEach(([k, v]) => {

        if (v !== "" && v !== null && v !== undefined) fd.append(k, v);
      });

      if (file) fd.append("attachment", file);

      await API.post("/memos", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      onSaved();

    } catch (err) {

      setError(err?.response?.data?.detail || "Could not create memo.");

    } finally {

      setSaving(false);
    }
  };

  return (
    <Modal title="Issue Memo" onClose={onClose} width={720}>
      <div className={styles.formGrid}>
        <Field label="Employee" required>
          <select
            value={form.EMPLOYEE_ID}
            onChange={(e) => update("EMPLOYEE_ID", e.target.value)}
            disabled={!!employeeIdLocked}
            className={styles.fieldInput}
          >
            <option value="">— Select —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code ? `${e.code} — ${e.name}` : e.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Memo Type" required>
          <select
            value={form.MEMO_TYPE}
            onChange={(e) => update("MEMO_TYPE", e.target.value)}
            className={styles.fieldInput}
          >
            {MEMO_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Severity" required>
          <div className={styles.severityRow}>
            {SEVERITY_OPTIONS.map((s) => {

              const isOn = form.SEVERITY === s;

              const c = SEVERITY_COLORS[s] || {};

              return (
                <button
                  type="button"
                  key={s}
                  onClick={() => update("SEVERITY", s)}
                  className={styles.severityBtn}
                  style={{
                    border: `1px solid ${isOn ? c.fg : "#cbd5e1"}`,
                    background: isOn ? c.bg : "white",
                    color: isOn ? c.fg : "#475569"
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Issue Date" required>
          <input
            type="date"
            value={form.ISSUE_DATE}
            onChange={(e) => update("ISSUE_DATE", e.target.value)}
            className={styles.fieldInput}
          />
        </Field>

        <Field label="Subject" required full>
          <input
            type="text"
            maxLength={200}
            value={form.SUBJECT}
            onChange={(e) => update("SUBJECT", e.target.value)}
            placeholder="e.g. Repeated late attendance in May 2026"
            className={styles.fieldInput}
          />
        </Field>

        <Field label="Description" full>
          <textarea
            rows={4}
            maxLength={4000}
            value={form.DESCRIPTION}
            onChange={(e) => update("DESCRIPTION", e.target.value)}
            placeholder="Background, specific incidents, action expected, deadline…"
            className={styles.fieldInput}
            style={{ resize: "vertical" }}
          />
        </Field>

        <Field label="Issued By">
          <input
            type="text"
            maxLength={100}
            value={form.ISSUED_BY}
            onChange={(e) => update("ISSUED_BY", e.target.value)}
            placeholder="e.g. HR Manager, MD"
            className={styles.fieldInput}
          />
        </Field>

        <Field label="Attachment">
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ fontSize: 12 }}
          />
        </Field>

        <Field label="Internal Remarks (HR only)" full>
          <textarea
            rows={2}
            maxLength={2000}
            value={form.REMARKS}
            onChange={(e) => update("REMARKS", e.target.value)}
            placeholder="Optional notes for HR records — not shown to the employee"
            className={styles.fieldInput}
            style={{ resize: "vertical" }}
          />
        </Field>
      </div>

      {error && (
        <div className={styles.errorBox}>
          {error}
        </div>
      )}

      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btnSecondary}>Cancel</button>
        <button onClick={save} disabled={saving} className={styles.btnPrimary}>
          {saving ? "Issuing…" : "Issue Memo"}
        </button>
      </div>
    </Modal>
  );
}


// =====================================================================
// VIEW / EDIT DRAWER
// =====================================================================

function ViewMemoDrawer({ memo, onClose, onChanged }) {

  const [editMode, setEditMode] = useState(false);

  const [form, setForm] = useState({
    SUBJECT: memo.SUBJECT || "",
    DESCRIPTION: memo.DESCRIPTION || "",
    SEVERITY: memo.SEVERITY || "LOW",
    ISSUED_BY: memo.ISSUED_BY || "",
    REMARKS: memo.REMARKS || ""
  });

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {

    setSaving(true);

    setError("");

    try {

      await API.patch(`/memos/${memo.ID}`, form);

      onChanged();

    } catch (err) {

      setError(err?.response?.data?.detail || "Could not save changes.");

      setSaving(false);
    }
  };

  const isLocked = memo.STATUS !== "ACTIVE";

  return (
    <Modal title={memo.MEMO_NUMBER || "Memo"} onClose={onClose} width={680}>
      {/* Status row */}
      <div className={styles.pillRow}>
        <Pill {...(TYPE_COLORS[memo.MEMO_TYPE] || {})}>
          {prettyType(memo.MEMO_TYPE)}
        </Pill>
        <Pill {...(SEVERITY_COLORS[memo.SEVERITY] || {})}>
          {memo.SEVERITY}
        </Pill>
        <Pill {...(STATUS_COLORS[memo.STATUS] || {})}>
          {memo.STATUS}
        </Pill>
        {memo.ACKNOWLEDGED_BY_EMPLOYEE && (
          <Pill bg="#dcfce7" fg="#166534">
            ACKNOWLEDGED · {fmtDate(memo.ACKNOWLEDGED_DATE)}
          </Pill>
        )}
      </div>

      {/* Read-only header */}
      <div className={styles.viewHeaderGrid}>
        <ReadField label="Employee" value={`${memo.EMPLOYEE_CODE || ""} · ${memo.EMPLOYEE_NAME || ""}`} />
        <ReadField label="Issue Date" value={fmtDate(memo.ISSUE_DATE)} />
      </div>

      {/* Editable body */}
      {editMode && !isLocked ? (
        <div className={styles.editGrid}>
          <Field label="Subject">
            <input
              type="text"
              maxLength={200}
              value={form.SUBJECT}
              onChange={(e) => update("SUBJECT", e.target.value)}
              className={styles.fieldInput}
            />
          </Field>
          <Field label="Severity">
            <select
              value={form.SEVERITY}
              onChange={(e) => update("SEVERITY", e.target.value)}
              className={styles.fieldInput}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea
              rows={5}
              maxLength={4000}
              value={form.DESCRIPTION}
              onChange={(e) => update("DESCRIPTION", e.target.value)}
              className={styles.fieldInput}
              style={{ resize: "vertical" }}
            />
          </Field>
          <Field label="Issued By">
            <input
              type="text"
              maxLength={100}
              value={form.ISSUED_BY}
              onChange={(e) => update("ISSUED_BY", e.target.value)}
              className={styles.fieldInput}
            />
          </Field>
          <Field label="Internal Remarks (HR only)">
            <textarea
              rows={2}
              maxLength={2000}
              value={form.REMARKS}
              onChange={(e) => update("REMARKS", e.target.value)}
              className={styles.fieldInput}
              style={{ resize: "vertical" }}
            />
          </Field>
        </div>
      ) : (
        <>
          <ReadField label="Subject" value={memo.SUBJECT} />
          <ReadField label="Description" value={memo.DESCRIPTION} multiline />
          <ReadField label="Issued By" value={memo.ISSUED_BY} />
          <ReadField label="Internal Remarks (HR only)" value={memo.REMARKS} multiline />
          {memo.ATTACHMENT_URL && (
            <div style={{ marginTop: 12 }}>
              <a
                href={`${API_BASE_URL}${memo.ATTACHMENT_URL}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.attachLink}
              >
                {memo.ATTACHMENT_NAME || "Open attachment"}
              </a>
            </div>
          )}
        </>
      )}

      {error && (
        <div className={styles.errorBox}>
          {error}
        </div>
      )}

      {/* Footer actions */}
      <div className={styles.modalFooterSpread}>
        <div className={styles.footerLeft}>
          {!editMode && !isLocked && (
            <button onClick={() => setEditMode(true)} className={styles.btnSecondary}>
              Edit
            </button>
          )}
          {!isLocked && (
            <button
              onClick={() => API.post(`/memos/${memo.ID}/close`).then(onChanged)}
              className={styles.btnSecondary}
            >
              Close Memo
            </button>
          )}
          {!isLocked && (
            <button
              onClick={() => API.post(`/memos/${memo.ID}/cancel`).then(onChanged)}
              className={styles.btnSecondary}
            >
              Cancel Memo
            </button>
          )}
        </div>

        <div className={styles.footerRight}>
          {editMode && (
            <>
              <button onClick={() => setEditMode(false)} className={styles.btnSecondary}>
                Discard
              </button>
              <button onClick={save} disabled={saving} className={styles.btnPrimary}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </>
          )}
          {!editMode && (
            <button onClick={onClose} className={styles.btnPrimary}>Done</button>
          )}
        </div>
      </div>
    </Modal>
  );
}


// =====================================================================
// SMALL HELPERS / STYLED PRIMITIVES
// =====================================================================

function StatTile({ label, value, accent }) {

  return (
    <div className={styles.statTile}>
      <div className={styles.statAccent} style={{ background: accent }} />
      <div className={styles.statLabel}>
        {label}
      </div>
      <div className={styles.statValue}>
        {value}
      </div>
    </div>
  );
}


function Pill({ children, bg = "#e2e8f0", fg = "#475569" }) {

  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.5,
      background: bg,
      color: fg,
      textTransform: "uppercase"
    }}>
      {children}
    </span>
  );
}


function Field({ label, required, full, children }) {

  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <div className={styles.fieldLabel}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </div>
      {children}
    </div>
  );
}


function ReadField({ label, value, multiline = false }) {

  return (
    <div className={styles.readField}>
      <div className={styles.fieldLabel}>
        {label}
      </div>
      <div className={`${styles.readFieldValue}${multiline ? "" : ""}`} style={{ whiteSpace: multiline ? "pre-wrap" : "normal" }}>
        {value || <span className={styles.readFieldEmpty}>—</span>}
      </div>
    </div>
  );
}


function RowBtn({ children, onClick, danger }) {

  return (
    <button
      onClick={onClick}
      className={`${styles.rowBtn}${danger ? ` ${styles.rowBtnDanger}` : ""}`}
    >
      {children}
    </button>
  );
}


function Modal({ title, onClose, children, width = 600 }) {

  return (
    <div
      onClick={onClose}
      className={styles.modalBackdrop}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.modalBox}
        style={{ maxWidth: width }}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            {title}
          </div>
          <button
            onClick={onClose}
            className={styles.modalClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {children}
        </div>
      </div>
    </div>
  );
}


export default EmployeeMemos;
