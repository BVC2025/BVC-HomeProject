// =====================================================================
// Employee Memo Management — standalone page at /memos
//
// Full memo audit trail: list, filter, search, create, view, edit,
// acknowledge, close, cancel, soft-delete, CSV export.
//
// Embeddable: when used inside the Employee profile's Memos tab,
// pass `employeeIdLocked` so the page hides the employee filter and
// scopes everything to that one employee.
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";


// =====================================================================
// Constants
// =====================================================================

const MEMO_TYPES = [
  { key: "WARNING",                label: "Warning",                emoji: "⚠️", color: "#dc2626", bg: "#fef2f2" },
  { key: "APPRECIATION",           label: "Appreciation",           emoji: "👏", color: "#16a34a", bg: "#dcfce7" },
  { key: "DISCIPLINARY",           label: "Disciplinary",           emoji: "🚫", color: "#991b1b", bg: "#fee2e2" },
  { key: "INFORMATION",            label: "Information",            emoji: "ℹ️", color: "#2563eb", bg: "#dbeafe" },
  { key: "CUSTOMER_COMPLAINT",     label: "Customer Complaint",     emoji: "📨", color: "#ea580c", bg: "#fff7ed" },
  { key: "PERFORMANCE_RECOGNITION",label: "Performance Recognition",emoji: "🏆", color: "#0d9488", bg: "#ccfbf1" },
  { key: "SHOW_CAUSE_NOTICE",      label: "Show Cause Notice",      emoji: "📜", color: "#7c2d12", bg: "#fef3c7" }
];


const SEVERITIES = [
  { key: "LOW",      color: "#10b981", bg: "#dcfce7" },
  { key: "MEDIUM",   color: "#f59e0b", bg: "#fef3c7" },
  { key: "HIGH",     color: "#ef4444", bg: "#fee2e2" },
  { key: "CRITICAL", color: "#7c2d12", bg: "#fef2f2" }
];


const STATUSES = [
  { key: "ACTIVE",    color: "#3b82f6", bg: "#dbeafe" },
  { key: "CLOSED",    color: "#10b981", bg: "#dcfce7" },
  { key: "CANCELLED", color: "#94a3b8", bg: "#f1f5f9" }
];


const themeForType = (t) => MEMO_TYPES.find((x) => x.key === t) || MEMO_TYPES[3];
const themeForSev  = (s) => SEVERITIES.find((x) => x.key === s) || SEVERITIES[0];
const themeForStat = (s) => STATUSES.find((x) => x.key === s)   || STATUSES[0];


// =====================================================================
// MAIN PAGE
// =====================================================================

export default function EmployeeMemos({ employeeIdLocked: lockedProp = null, compact = false }) {

  // URL ?employee_id=… also locks the filter (used from Employee cards)
  const urlEmpId = (() => {

    try {

      const u = new URL(window.location.href);

      return u.searchParams.get("employee_id") || null;

    } catch { return null; }
  })();

  const employeeIdLocked = lockedProp || urlEmpId;

  const [rows,         setRows]         = useState([]);

  const [total,        setTotal]        = useState(0);

  const [loading,      setLoading]      = useState(true);

  const [stats,        setStats]        = useState({});

  const [employees,    setEmployees]    = useState([]);

  const [editing,      setEditing]      = useState(null);   // memo being viewed/edited

  const [showCreate,   setShowCreate]   = useState(false);

  // Filters
  const [filterEmp,    setFilterEmp]    = useState(employeeIdLocked || "");

  const [filterType,   setFilterType]   = useState("");

  const [filterSev,    setFilterSev]    = useState("");

  const [filterStat,   setFilterStat]   = useState("");

  const [dateFrom,     setDateFrom]     = useState("");

  const [dateTo,       setDateTo]       = useState("");

  const [search,       setSearch]       = useState("");

  const loadAll = () => {

    setLoading(true);

    const params = new URLSearchParams();

    if (filterEmp)  params.set("employee_id", filterEmp);
    if (filterType) params.set("memo_type", filterType);
    if (filterSev)  params.set("severity", filterSev);
    if (filterStat) params.set("status", filterStat);
    if (dateFrom)   params.set("date_from", dateFrom);
    if (dateTo)     params.set("date_to", dateTo);
    if (search.trim()) params.set("search", search.trim());

    params.set("limit", "200");

    const statsParams = filterEmp ? `?employee_id=${filterEmp}` : "";

    Promise.all([
      API.get(`/memos?${params.toString()}`).catch(() => ({ data: { total: 0, rows: [] } })),
      API.get(`/memos/stats${statsParams}`).catch(() => ({ data: {} }))
    ]).then(([listRes, statsRes]) => {

      setRows(listRes.data?.rows || []);

      setTotal(listRes.data?.total || 0);

      setStats(statsRes.data || {});

      setLoading(false);
    });
  };

  // Initial load + employee dropdown
  useEffect(() => {

    if (!employeeIdLocked) {

      API.get("/employees")
        .then((r) => setEmployees(r.data || []))
        .catch(() => {});
    }

  }, [employeeIdLocked]);

  // Reload whenever filters change
  useEffect(() => {

    loadAll();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEmp, filterType, filterSev, filterStat, dateFrom, dateTo]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadAll();
  };

  const exportCsv = () => {

    const params = new URLSearchParams();
    if (filterEmp)  params.set("employee_id", filterEmp);
    if (filterType) params.set("memo_type", filterType);
    if (filterSev)  params.set("severity", filterSev);
    if (filterStat) params.set("status", filterStat);
    if (dateFrom)   params.set("date_from", dateFrom);
    if (dateTo)     params.set("date_to", dateTo);

    window.open(`${API_BASE_URL || ""}/memos/export/csv?${params.toString()}`, "_blank");
  };

  // =====================================================================
  // RENDER
  // =====================================================================

  return (

    <div style={{ padding: compact ? 0 : 24, fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ============ Header ============ */}
      {!compact && (
        <div style={{ marginBottom: 18 }}>
          <div style={eyebrow}>HR · Audit Trail</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: "4px 0 4px" }}>
            📋 Employee Memo Management
          </h1>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            Complete history of warnings, appreciations, disciplinary actions, complaints and recognitions.
          </div>
        </div>
      )}

      {/* ============ Stats row ============ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10,
        marginBottom: 18
      }}>
        <StatTile label="Total Memos"      value={stats.total ?? 0}                  accent="#3b82f6" />
        <StatTile label="Active Warnings"  value={stats.active_warnings ?? 0}        accent="#dc2626" />
        <StatTile label="Disciplinary Open"value={stats.disciplinary_open ?? 0}      accent="#7c2d12" />
        <StatTile label="Appreciations (M)" value={stats.appreciations_this_month ?? 0} accent="#16a34a" />
        <StatTile label="Pending Ack."     value={stats.pending_acknowledgement ?? 0}accent="#f59e0b" />
      </div>

      {/* ============ Filter / search bar ============ */}
      <div style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
        display: "grid",
        gridTemplateColumns: employeeIdLocked
          ? "1fr 1fr 1fr 1fr 1fr auto"
          : "1.6fr 1fr 1fr 1fr 1fr 1fr auto",
        gap: 10,
        alignItems: "end"
      }}>

        {!employeeIdLocked && (
          <Field label="Employee">
            <select value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)} style={inputStyle}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.ID} value={e.ID}>{e.NAME} ({e.EMPLOYEE_CODE})</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Type">
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={inputStyle}>
            <option value="">All types</option>
            {MEMO_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>

        <Field label="Severity">
          <select value={filterSev} onChange={(e) => setFilterSev(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
          </select>
        </Field>

        <Field label="Status">
          <select value={filterStat} onChange={(e) => setFilterStat(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
          </select>
        </Field>

        <Field label="From">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="To">
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
        </Field>

        <button onClick={() => setShowCreate(true)} style={btnPrimary}>
          + New Memo
        </button>
      </div>

      {/* Search + export row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <form onSubmit={handleSearchSubmit} style={{ flex: 1 }}>
          <input
            placeholder="🔍 Search by memo ID, subject, employee name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: "100%", padding: "10px 14px" }}
          />
        </form>
        <button onClick={exportCsv} style={btnGhost}>📥 Export CSV</button>
        <button onClick={loadAll} style={btnGhost}>🔄 Refresh</button>
        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>
          {total} record{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ============ Table ============ */}
      <div style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden"
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <tr>
              {["Memo ID", "Date", "Type", "Subject", "Severity", "Issued By", "Status", "Ack", "Actions"].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
              {!employeeIdLocked && <th style={th}>Employee</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={employeeIdLocked ? 9 : 10} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={employeeIdLocked ? 9 : 10} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
                No memos found.
              </td></tr>
            )}
            {rows.map((r) => (

              <MemoRow
                key={r.ID}
                row={r}
                hideEmployee={!!employeeIdLocked}
                onOpen={() => setEditing(r)}
                onClose={() => API.post(`/memos/${r.ID}/close`).then(loadAll)}
                onCancel={() => API.post(`/memos/${r.ID}/cancel`).then(loadAll)}
                onDelete={() => {
                  if (!window.confirm(`Soft-delete ${r.MEMO_NUMBER}? Data stays in the audit log but is hidden from default lists.`)) return;
                  API.delete(`/memos/${r.ID}`).then(loadAll);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ============ Create modal ============ */}
      {showCreate && (
        <CreateMemoModal
          employees={employees}
          employeeIdLocked={employeeIdLocked}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); loadAll(); }}
        />
      )}

      {/* ============ View / edit drawer ============ */}
      {editing && (
        <ViewMemoDrawer
          memo={editing}
          onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); loadAll(); }}
        />
      )}
    </div>
  );
}


// =====================================================================
// Sub-components
// =====================================================================

function MemoRow({ row, hideEmployee, onOpen, onClose, onCancel, onDelete }) {

  const typeTheme = themeForType(row.MEMO_TYPE);
  const sevTheme  = themeForSev(row.SEVERITY);
  const statTheme = themeForStat(row.STATUS);

  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
        onClick={onOpen}>
      <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#1e40af" }}>
        {row.MEMO_NUMBER}
      </td>
      <td style={td}>{row.ISSUE_DATE || "—"}</td>
      <td style={td}>
        <Pill bg={typeTheme.bg} color={typeTheme.color}>
          {typeTheme.emoji} {typeTheme.label}
        </Pill>
      </td>
      <td style={{ ...td, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.SUBJECT}
      </td>
      <td style={td}>
        <Pill bg={sevTheme.bg} color={sevTheme.color}>{row.SEVERITY}</Pill>
      </td>
      <td style={td}>{row.ISSUED_BY || "—"}</td>
      <td style={td}>
        <Pill bg={statTheme.bg} color={statTheme.color}>{row.STATUS}</Pill>
      </td>
      <td style={td}>
        {row.ACKNOWLEDGED_BY_EMPLOYEE
          ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ Yes</span>
          : <span style={{ color: "#f59e0b", fontWeight: 700 }}>○ Pending</span>}
      </td>
      <td style={td} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 4 }}>
          <IconBtn title="View"   onClick={onOpen}>👁</IconBtn>
          {row.STATUS === "ACTIVE" && <IconBtn title="Close"  onClick={onClose}>✓</IconBtn>}
          {row.STATUS === "ACTIVE" && <IconBtn title="Cancel" onClick={onCancel}>✗</IconBtn>}
          {row.ATTACHMENT_URL && (
            <a href={row.ATTACHMENT_URL} target="_blank" rel="noreferrer" title="Download attachment"
               onClick={(e) => e.stopPropagation()}
               style={{ ...iconBtnStyle, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              📎
            </a>
          )}
          <IconBtn title="Delete" onClick={onDelete} danger>🗑</IconBtn>
        </div>
      </td>
      {!hideEmployee && (
        <td style={td}>
          <div style={{ fontWeight: 700, color: "#0f172a" }}>{row.EMPLOYEE_NAME || "—"}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>{row.EMPLOYEE_CODE || ""}</div>
        </td>
      )}
    </tr>
  );
}


function CreateMemoModal({ employees: employeesProp, employeeIdLocked, onClose, onSaved }) {

  // The parent loads the employee list only when the page isn't locked to a
  // single employee, and swallows any failure silently — which can leave this
  // dropdown empty with no hint why. Make the modal self-sufficient: seed from
  // the prop, and fetch the list ourselves when it's missing (surfacing errors).
  const [employees,  setEmployees]  = useState(employeesProp || []);

  const [empLoading, setEmpLoading] = useState(false);

  const [empError,   setEmpError]   = useState("");

  useEffect(() => {

    if ((employeesProp || []).length) {

      setEmployees(employeesProp);

      return;
    }

    setEmpLoading(true);

    API.get("/employees")
      .then((r) => setEmployees(r.data || []))
      .catch((e) =>
        setEmpError(
          e?.response?.data?.detail || "Could not load the employee list."
        )
      )
      .finally(() => setEmpLoading(false));

  }, [employeesProp]);

  const [form, setForm] = useState({
    EMPLOYEE_ID: employeeIdLocked || "",
    MEMO_TYPE:   "WARNING",
    SUBJECT:     "",
    DESCRIPTION: "",
    SEVERITY:    "LOW",
    STATUS:      "ACTIVE",
    ISSUED_BY:   "",
    ISSUE_DATE:  new Date().toISOString().slice(0, 10),
    REMARKS:     ""
  });

  const [file,     setFile]     = useState(null);

  const [saving,   setSaving]   = useState(false);

  const [error,    setError]    = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (notify = false) => {

    setError("");

    if (!form.EMPLOYEE_ID) { setError("Pick an employee."); return; }

    if (!form.SUBJECT.trim()) { setError("Subject is required."); return; }

    setSaving(true);

    try {

      const fd = new FormData();

      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ""));

      fd.append("VENDOR_ID", "1");

      if (file) fd.append("attachment", file);

      await API.post("/memos", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      onSaved?.();

    } catch (e) {

      setError(e?.response?.data?.detail || "Save failed");

    } finally {

      setSaving(false);
    }
  };

  return (

    <div style={overlay} onClick={onClose}>

      <div onClick={(e) => e.stopPropagation()} style={{
        ...modal,
        maxWidth: 720
      }}>

        <ModalHeader title="📋 New Memo" onClose={onClose} />

        <div style={modalBody}>

          <div style={grid2}>
            <Field label="Employee *">
              <select
                value={form.EMPLOYEE_ID}
                onChange={set("EMPLOYEE_ID")}
                disabled={!!employeeIdLocked || empLoading}
                style={inputStyle}
              >
                <option value="">
                  {empLoading ? "Loading employees…" : "— pick —"}
                </option>
                {employees.map((e) => (
                  <option key={e.ID} value={e.ID}>{e.NAME} ({e.EMPLOYEE_CODE})</option>
                ))}
              </select>
              {empError && (
                <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>
                  {empError}
                </div>
              )}
              {!empLoading && !empError && !employeeIdLocked && employees.length === 0 && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  No employees found.
                </div>
              )}
            </Field>

            <Field label="Memo Type *">
              <select value={form.MEMO_TYPE} onChange={set("MEMO_TYPE")} style={inputStyle}>
                {MEMO_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Subject *">
            <input value={form.SUBJECT} onChange={set("SUBJECT")} style={inputStyle}
                   placeholder="e.g. Repeated late attendance in May 2026" />
          </Field>

          <Field label="Description">
            <textarea value={form.DESCRIPTION} onChange={set("DESCRIPTION")} rows={4} style={inputStyle}
                      placeholder="Background, specific incidents, action expected…" />
          </Field>

          <div style={grid3}>
            <Field label="Severity *">
              <select value={form.SEVERITY} onChange={set("SEVERITY")} style={inputStyle}>
                {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.STATUS} onChange={set("STATUS")} style={inputStyle}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
              </select>
            </Field>
            <Field label="Issue Date *">
              <input type="date" value={form.ISSUE_DATE} onChange={set("ISSUE_DATE")} style={inputStyle} />
            </Field>
          </div>

          <div style={grid2}>
            <Field label="Issued By *">
              <input value={form.ISSUED_BY} onChange={set("ISSUED_BY")} style={inputStyle}
                     placeholder="e.g. HR Manager, MD, Plant Head" />
            </Field>
            <Field label="Attachment">
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)}
                     style={{ ...inputStyle, padding: 8 }} />
            </Field>
          </div>

          <Field label="Internal Remarks">
            <textarea value={form.REMARKS} onChange={set("REMARKS")} rows={2} style={inputStyle}
                      placeholder="Optional notes for HR records (not shown to employee)" />
          </Field>

          {error && (
            <div style={errBox}>{error}</div>
          )}
        </div>

        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={() => save(false)} disabled={saving} style={btnPrimary}>
            {saving ? "Saving…" : "Save Memo"}
          </button>
        </div>
      </div>
    </div>
  );
}


function ViewMemoDrawer({ memo, onClose, onChanged }) {

  const [editMode,   setEditMode]   = useState(false);

  const [form,       setForm]       = useState({
    SUBJECT:     memo.SUBJECT || "",
    DESCRIPTION: memo.DESCRIPTION || "",
    SEVERITY:    memo.SEVERITY || "LOW",
    STATUS:      memo.STATUS || "ACTIVE",
    ISSUED_BY:   memo.ISSUED_BY || "",
    ISSUE_DATE:  memo.ISSUE_DATE || "",
    REMARKS:     memo.REMARKS || ""
  });

  const [saving,     setSaving]     = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {

    setSaving(true);

    try {

      await API.patch(`/memos/${memo.ID}`, form);

      onChanged?.();

    } finally {

      setSaving(false);
    }
  };

  const acknowledge = async () => {

    if (!window.confirm("Confirm receipt — record that the employee has acknowledged this memo?")) return;

    await API.post(`/memos/${memo.ID}/acknowledge`, {});

    onChanged?.();
  };

  const typeTheme = themeForType(memo.MEMO_TYPE);
  const sevTheme  = themeForSev(memo.SEVERITY);
  const statTheme = themeForStat(memo.STATUS);

  return (

    <div style={overlay} onClick={onClose}>

      <div onClick={(e) => e.stopPropagation()} style={{
        position: "absolute", right: 0, top: 0, bottom: 0,
        width: "min(640px, 92vw)",
        background: "white",
        boxShadow: "-20px 0 60px rgba(0,0,0,0.2)",
        overflow: "hidden", display: "flex", flexDirection: "column"
      }}>

        {/* Header */}
        <div style={{
          padding: "20px 24px",
          background: `linear-gradient(135deg, ${typeTheme.color}, ${typeTheme.color}cc)`,
          color: "white"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.6, fontWeight: 800, opacity: 0.85, textTransform: "uppercase" }}>
                {memo.MEMO_NUMBER}
              </div>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, letterSpacing: -0.2 }}>
                {typeTheme.emoji} {typeTheme.label}
              </div>
              <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>
                {memo.EMPLOYEE_NAME} ({memo.EMPLOYEE_CODE}) · {memo.ISSUE_DATE}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.2)", color: "white", border: "none",
              padding: "4px 12px", borderRadius: 6, fontSize: 18, cursor: "pointer"
            }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

          {/* Badges */}
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <Pill bg={sevTheme.bg}  color={sevTheme.color}>{memo.SEVERITY}</Pill>
            <Pill bg={statTheme.bg} color={statTheme.color}>{memo.STATUS}</Pill>
            {memo.ACKNOWLEDGED_BY_EMPLOYEE && (
              <Pill bg="#dcfce7" color="#15803d">✓ Acknowledged</Pill>
            )}
          </div>

          {!editMode && (
            <>
              <ReadField label="Subject" value={memo.SUBJECT} />
              <ReadField label="Description" value={memo.DESCRIPTION} multiline />
              <div style={grid2}>
                <ReadField label="Issued By" value={memo.ISSUED_BY} />
                <ReadField label="Issue Date" value={memo.ISSUE_DATE} />
              </div>
              {memo.ATTACHMENT_URL && (
                <ReadField label="Attachment" value={
                  <a href={memo.ATTACHMENT_URL} target="_blank" rel="noreferrer"
                     style={{ color: "#2563eb", fontWeight: 700, textDecoration: "none" }}>
                    📎 {memo.ATTACHMENT_NAME || "Download"}
                  </a>
                } />
              )}
              <ReadField label="Internal Remarks" value={memo.REMARKS} multiline />
              {memo.ACKNOWLEDGED_BY_EMPLOYEE && (
                <ReadField label="Acknowledged Date" value={
                  memo.ACKNOWLEDGED_DATE ? new Date(memo.ACKNOWLEDGED_DATE).toLocaleString() : "—"
                } />
              )}
              <ReadField label="Created" value={memo.CREATED_AT ? new Date(memo.CREATED_AT).toLocaleString() : "—"} />
            </>
          )}

          {editMode && (
            <>
              <Field label="Subject"><input style={inputStyle} value={form.SUBJECT} onChange={set("SUBJECT")} /></Field>
              <Field label="Description"><textarea rows={4} style={inputStyle} value={form.DESCRIPTION} onChange={set("DESCRIPTION")} /></Field>
              <div style={grid3}>
                <Field label="Severity">
                  <select value={form.SEVERITY} onChange={set("SEVERITY")} style={inputStyle}>
                    {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={form.STATUS} onChange={set("STATUS")} style={inputStyle}>
                    {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
                  </select>
                </Field>
                <Field label="Issue Date">
                  <input type="date" value={form.ISSUE_DATE} onChange={set("ISSUE_DATE")} style={inputStyle} />
                </Field>
              </div>
              <Field label="Issued By"><input style={inputStyle} value={form.ISSUED_BY} onChange={set("ISSUED_BY")} /></Field>
              <Field label="Remarks"><textarea rows={2} style={inputStyle} value={form.REMARKS} onChange={set("REMARKS")} /></Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={modalFooter}>
          {!editMode && !memo.ACKNOWLEDGED_BY_EMPLOYEE && (
            <button onClick={acknowledge} style={btnAck}>
              ✓ Record Acknowledgement
            </button>
          )}
          {!editMode && <button onClick={() => setEditMode(true)} style={btnGhost}>Edit</button>}
          {editMode  && <button onClick={() => setEditMode(false)} style={btnGhost}>Cancel</button>}
          {editMode  && <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save"}</button>}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Tiny atoms
// =====================================================================

function StatTile({ label, value, accent }) {

  return (
    <div style={{
      background: "white",
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      padding: 14,
      borderTop: `3px solid ${accent}`
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: "#64748b",
        textTransform: "uppercase"
      }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 4, letterSpacing: -0.4
      }}>{value}</div>
    </div>
  );
}


function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700, color: "#475569",
        marginBottom: 4, letterSpacing: 0.3
      }}>{label}</label>
      {children}
    </div>
  );
}


function ReadField({ label, value, multiline = false }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: "#64748b", letterSpacing: 1,
        textTransform: "uppercase", marginBottom: 3
      }}>{label}</div>
      <div style={{
        fontSize: 13, color: value ? "#0f172a" : "#94a3b8", fontWeight: 500,
        whiteSpace: multiline ? "pre-wrap" : "normal", lineHeight: 1.55
      }}>{value || "—"}</div>
    </div>
  );
}


function Pill({ children, bg, color }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase",
      background: bg, color
    }}>{children}</span>
  );
}


function IconBtn({ children, onClick, title, danger = false }) {
  return (
    <button onClick={onClick} title={title} style={{
      ...iconBtnStyle,
      color: danger ? "#dc2626" : "#475569",
      borderColor: danger ? "#fecaca" : "#cbd5e1"
    }}>{children}</button>
  );
}


function ModalHeader({ title, onClose }) {
  return (
    <div style={{
      padding: "18px 24px", borderBottom: "1px solid #e2e8f0",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      background: "linear-gradient(135deg, #C8102E, #8B0B1F)", color: "white"
    }}>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.2 }}>{title}</div>
      <button onClick={onClose} style={{
        background: "rgba(255,255,255,0.2)", color: "white", border: "none",
        padding: "4px 12px", borderRadius: 6, fontSize: 18, cursor: "pointer"
      }}>×</button>
    </div>
  );
}


// =====================================================================
// Styles
// =====================================================================

const eyebrow = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: "#64748b",
  textTransform: "uppercase"
};

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  background: "white"
};

const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 };

const grid3 = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 };

const btnPrimary = {
  background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
  color: "white",
  border: "none",
  padding: "9px 18px",
  borderRadius: 8,
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
  letterSpacing: 0.3
};

const btnGhost = {
  background: "white",
  color: "#475569",
  border: "1px solid #cbd5e1",
  padding: "8px 14px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer"
};

const btnAck = {
  background: "linear-gradient(135deg, #10b981, #059669)",
  color: "white",
  border: "none",
  padding: "9px 16px",
  borderRadius: 8,
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
  marginRight: "auto"
};

const iconBtnStyle = {
  background: "white",
  border: "1px solid #cbd5e1",
  width: 30, height: 30,
  borderRadius: 6,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center"
};

const th = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.6,
  color: "#475569",
  textTransform: "uppercase"
};

const td = {
  padding: "10px 12px",
  fontSize: 12,
  color: "#0f172a",
  verticalAlign: "middle"
};

const overlay = {
  position: "fixed", inset: 0,
  background: "rgba(15,23,42,0.45)",
  zIndex: 950,
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  padding: "5vh 0"
};

const modal = {
  background: "white",
  borderRadius: 14,
  overflow: "hidden",
  width: "min(720px, 92vw)",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 30px 80px rgba(15,23,42,0.3)"
};

const modalBody = { flex: 1, overflowY: "auto", padding: 24 };

const modalFooter = {
  padding: "14px 24px",
  borderTop: "1px solid #e2e8f0",
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  background: "#f8fafc"
};

const errBox = {
  marginTop: 6,
  padding: "8px 12px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 8,
  color: "#991b1b",
  fontSize: 12
};
