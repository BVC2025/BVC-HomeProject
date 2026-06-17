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


// --------------- Domain constants (mirror backend) -----------------

const MEMO_TYPE_OPTIONS = [
  { value: "WARNING",                  label: "Warning" },
  { value: "APPRECIATION",             label: "Appreciation" },
  { value: "DISCIPLINARY",             label: "Disciplinary" },
  { value: "INFORMATION",              label: "Information" },
  { value: "CUSTOMER_COMPLAINT",       label: "Customer Complaint" },
  { value: "PERFORMANCE_RECOGNITION",  label: "Performance Recognition" },
  { value: "SHOW_CAUSE_NOTICE",        label: "Show Cause Notice" }
];

const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const STATUS_OPTIONS = ["ACTIVE", "CLOSED", "CANCELLED"];


// Brand-aligned colour map for type & severity pills.
const TYPE_COLORS = {
  WARNING:                  { bg: "#fef3c7", fg: "#92400e" },
  APPRECIATION:             { bg: "#dcfce7", fg: "#166534" },
  DISCIPLINARY:             { bg: "#fee2e2", fg: "#991b1b" },
  INFORMATION:              { bg: "#dbeafe", fg: "#1e40af" },
  CUSTOMER_COMPLAINT:       { bg: "#ffedd5", fg: "#9a3412" },
  PERFORMANCE_RECOGNITION:  { bg: "#fae8ff", fg: "#86198f" },
  SHOW_CAUSE_NOTICE:        { bg: "#fee2e2", fg: "#7f1d1d" }
};

const SEVERITY_COLORS = {
  LOW:      { bg: "#e0e7ff", fg: "#3730a3" },
  MEDIUM:   { bg: "#fef3c7", fg: "#92400e" },
  HIGH:     { bg: "#fed7aa", fg: "#9a3412" },
  CRITICAL: { bg: "#fecaca", fg: "#991b1b" }
};

const STATUS_COLORS = {
  ACTIVE:    { bg: "#dbeafe", fg: "#1e40af" },
  CLOSED:    { bg: "#e2e8f0", fg: "#334155" },
  CANCELLED: { bg: "#fee2e2", fg: "#991b1b" }
};


function fmtDate(iso) {

  if (!iso) return "—";

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("en-IN", {
    day:   "2-digit",
    month: "short",
    year:  "numeric"
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

  const [rows, setRows]         = useState([]);
  const [stats, setStats]       = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]   = useState(true);

  // filters
  const [search,     setSearch]     = useState("");
  const [filterEmp,  setFilterEmp]  = useState(employeeIdLocked || "");
  const [filterType, setFilterType] = useState("");
  const [filterSev,  setFilterSev]  = useState("");
  const [filterStat, setFilterStat] = useState("");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");

  // overlays
  const [showCreate, setShowCreate] = useState(false);
  const [viewing,    setViewing]    = useState(null);

  // -- Data loading --------------------------------------------------
  const buildParams = () => {

    const p = new URLSearchParams();

    if (search.trim())   p.set("search", search.trim());
    if (filterEmp)       p.set("employee_id", filterEmp);
    if (filterType)      p.set("memo_type",   filterType);
    if (filterSev)       p.set("severity",    filterSev);
    if (filterStat)      p.set("status",      filterStat);
    if (dateFrom)        p.set("date_from",   dateFrom);
    if (dateTo)          p.set("date_to",     dateTo);

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
  const closeMemo  = (id) => API.post(`/memos/${id}/close`).then(loadAll);

  const cancelMemo = (id) => API.post(`/memos/${id}/cancel`).then(loadAll);

  const deleteMemo = (id) => {

    if (!window.confirm("Delete this memo? It will be soft-deleted (recoverable).")) return;

    API.delete(`/memos/${id}`).then(loadAll);
  };

  const empOptions = useMemo(() => {

    return employees.map((e) => ({
      id:   e.ID,
      name: e.NAME || "",
      code: e.EMPLOYEE_CODE || ""
    }));

  }, [employees]);

  return (

    <div>

      {/* HERO ------------------------------------------------------- */}
      <div style={{
        background: "linear-gradient(135deg, #C8102E 0%, #A60F26 50%, #8B0B1F 100%)",
        color: "white",
        padding: "20px 28px",
        borderRadius: 14,
        marginBottom: 22,
        boxShadow: "0 6px 18px rgba(139,11,31,0.18)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: 2,
            color: "#fde047",
            fontWeight: 700,
            textTransform: "uppercase"
          }}>
            HR
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: "4px 0 0",
            lineHeight: 1.2,
            color: "white",
            letterSpacing: -0.3
          }}>
            Memos
          </h1>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          style={{
            background: "white",
            color: "#8B0B1F",
            border: "none",
            padding: "10px 20px",
            borderRadius: 8,
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
          }}
        >
          + Issue Memo
        </button>
      </div>

      {/* STAT TILES ------------------------------------------------- */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
        marginBottom: 18
      }}>
        <StatTile label="Total"            value={stats.total ?? 0}                  accent="#0f172a" />
        <StatTile label="Active"           value={stats.active ?? 0}                 accent="#1e40af" />
        <StatTile label="Pending Ack."     value={stats.pending_acknowledgement ?? 0} accent="#92400e" />
        <StatTile label="Active Warnings"  value={stats.active_warnings ?? 0}        accent="#991b1b" />
      </div>

      {/* FILTER BAR ------------------------------------------------- */}
      <div style={{
        background: "white",
        padding: 14,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 14,
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center"
      }}>
        <input
          type="text"
          placeholder="Search by memo number, subject, or employee"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: "2 1 240px",
            minWidth: 200,
            padding: "9px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 13
          }}
        />

        {!employeeIdLocked && (
          <select
            value={filterEmp}
            onChange={(e) => setFilterEmp(e.target.value)}
            style={selectStyle()}
          >
            <option value="">All employees</option>
            {empOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code ? `${e.code} — ${e.name}` : e.name}
              </option>
            ))}
          </select>
        )}

        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={selectStyle()}>
          <option value="">All types</option>
          {MEMO_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select value={filterSev} onChange={(e) => setFilterSev(e.target.value)} style={selectStyle()}>
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={filterStat} onChange={(e) => setFilterStat(e.target.value)} style={selectStyle()}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={selectStyle()}
        />

        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={selectStyle()}
        />
      </div>

      {/* TABLE ------------------------------------------------------ */}
      <div style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
      }}>
        {loading && (
          <div style={{ color: "#94a3b8", padding: 20 }}>Loading…</div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{
            padding: 36,
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13
          }}>
            No memos match the current filters.
            Click <strong>+ Issue Memo</strong> to create one.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13
          }}>
            <thead>
              <tr style={{
                background: "#f8fafc",
                color: "#475569",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.5
              }}>
                <th style={th()}>Memo No.</th>
                <th style={th()}>Employee</th>
                <th style={th()}>Type</th>
                <th style={th()}>Subject</th>
                <th style={th("center")}>Severity</th>
                <th style={th("center")}>Status</th>
                <th style={th("center")}>Issue Date</th>
                <th style={th("right")}>Actions</th>
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
    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
      <td style={td()}>
        <div
          onClick={onOpen}
          style={{
            fontWeight: 700,
            color: "#8B0B1F",
            cursor: "pointer",
            fontSize: 12
          }}
        >
          {memo.MEMO_NUMBER || "—"}
        </div>
      </td>

      <td style={td()}>
        <div style={{ fontWeight: 700, color: "#0f172a" }}>
          {memo.EMPLOYEE_NAME || "—"}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          {memo.EMPLOYEE_CODE || ""}
        </div>
      </td>

      <td style={td()}>
        <Pill {...(TYPE_COLORS[memo.MEMO_TYPE] || {})}>
          {prettyType(memo.MEMO_TYPE)}
        </Pill>
      </td>

      <td style={{ ...td(), maxWidth: 280 }}>
        <div
          onClick={onOpen}
          title={memo.SUBJECT}
          style={{
            cursor: "pointer",
            color: "#0f172a",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 280
          }}
        >
          {memo.SUBJECT}
        </div>
      </td>

      <td style={td("center")}>
        <Pill {...(SEVERITY_COLORS[memo.SEVERITY] || {})}>
          {memo.SEVERITY}
        </Pill>
      </td>

      <td style={td("center")}>
        <Pill {...(STATUS_COLORS[memo.STATUS] || {})}>
          {memo.STATUS}
        </Pill>
        {memo.ACKNOWLEDGED_BY_EMPLOYEE && (
          <div style={{
            marginTop: 4,
            fontSize: 10,
            color: "#166534",
            fontWeight: 700,
            letterSpacing: 0.4
          }}>
            ACK
          </div>
        )}
      </td>

      <td style={{ ...td("center"), color: "#64748b" }}>
        {fmtDate(memo.ISSUE_DATE)}
      </td>

      <td style={td("right")}>
        <div style={{ display: "inline-flex", gap: 6 }}>
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
    MEMO_TYPE:   "WARNING",
    SEVERITY:    "LOW",
    SUBJECT:     "",
    DESCRIPTION: "",
    ISSUED_BY:   "",
    ISSUE_DATE:  new Date().toISOString().slice(0, 10),
    REMARKS:     ""
  });

  const [file,   setFile]   = useState(null);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Employee" required>
          <select
            value={form.EMPLOYEE_ID}
            onChange={(e) => update("EMPLOYEE_ID", e.target.value)}
            disabled={!!employeeIdLocked}
            style={inputStyle()}
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
            style={inputStyle()}
          >
            {MEMO_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Severity" required>
          <div style={{ display: "flex", gap: 6 }}>
            {SEVERITY_OPTIONS.map((s) => {

              const isOn = form.SEVERITY === s;

              const c = SEVERITY_COLORS[s] || {};

              return (
                <button
                  type="button"
                  key={s}
                  onClick={() => update("SEVERITY", s)}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    border: `1px solid ${isOn ? c.fg : "#cbd5e1"}`,
                    background: isOn ? c.bg : "white",
                    color: isOn ? c.fg : "#475569",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: 0.6,
                    cursor: "pointer"
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
            style={inputStyle()}
          />
        </Field>

        <Field label="Subject" required full>
          <input
            type="text"
            maxLength={200}
            value={form.SUBJECT}
            onChange={(e) => update("SUBJECT", e.target.value)}
            placeholder="e.g. Repeated late attendance in May 2026"
            style={inputStyle()}
          />
        </Field>

        <Field label="Description" full>
          <textarea
            rows={4}
            maxLength={4000}
            value={form.DESCRIPTION}
            onChange={(e) => update("DESCRIPTION", e.target.value)}
            placeholder="Background, specific incidents, action expected, deadline…"
            style={{ ...inputStyle(), resize: "vertical" }}
          />
        </Field>

        <Field label="Issued By">
          <input
            type="text"
            maxLength={100}
            value={form.ISSUED_BY}
            onChange={(e) => update("ISSUED_BY", e.target.value)}
            placeholder="e.g. HR Manager, MD"
            style={inputStyle()}
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
            style={{ ...inputStyle(), resize: "vertical" }}
          />
        </Field>
      </div>

      {error && (
        <div style={{
          marginTop: 12,
          padding: 10,
          background: "#fee2e2",
          color: "#991b1b",
          borderRadius: 8,
          fontSize: 12
        }}>
          {error}
        </div>
      )}

      <div style={{
        marginTop: 18,
        display: "flex",
        justifyContent: "flex-end",
        gap: 10
      }}>
        <button onClick={onClose} style={btnSecondary()}>Cancel</button>
        <button onClick={save} disabled={saving} style={btnPrimary(saving)}>
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
    SUBJECT:     memo.SUBJECT     || "",
    DESCRIPTION: memo.DESCRIPTION || "",
    SEVERITY:    memo.SEVERITY    || "LOW",
    ISSUED_BY:   memo.ISSUED_BY   || "",
    REMARKS:     memo.REMARKS     || ""
  });

  const [saving, setSaving] = useState(false);

  const [error,  setError]  = useState("");

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
      <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        marginBottom: 14
      }}>
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
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 14
      }}>
        <ReadField label="Employee"   value={`${memo.EMPLOYEE_CODE || ""} · ${memo.EMPLOYEE_NAME || ""}`} />
        <ReadField label="Issue Date" value={fmtDate(memo.ISSUE_DATE)} />
      </div>

      {/* Editable body */}
      {editMode && !isLocked ? (
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Subject">
            <input
              type="text"
              maxLength={200}
              value={form.SUBJECT}
              onChange={(e) => update("SUBJECT", e.target.value)}
              style={inputStyle()}
            />
          </Field>
          <Field label="Severity">
            <select
              value={form.SEVERITY}
              onChange={(e) => update("SEVERITY", e.target.value)}
              style={inputStyle()}
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
              style={{ ...inputStyle(), resize: "vertical" }}
            />
          </Field>
          <Field label="Issued By">
            <input
              type="text"
              maxLength={100}
              value={form.ISSUED_BY}
              onChange={(e) => update("ISSUED_BY", e.target.value)}
              style={inputStyle()}
            />
          </Field>
          <Field label="Internal Remarks (HR only)">
            <textarea
              rows={2}
              maxLength={2000}
              value={form.REMARKS}
              onChange={(e) => update("REMARKS", e.target.value)}
              style={{ ...inputStyle(), resize: "vertical" }}
            />
          </Field>
        </div>
      ) : (
        <>
          <ReadField label="Subject" value={memo.SUBJECT} />
          <ReadField label="Description" value={memo.DESCRIPTION} multiline />
          <ReadField label="Issued By"  value={memo.ISSUED_BY} />
          <ReadField label="Internal Remarks (HR only)" value={memo.REMARKS} multiline />
          {memo.ATTACHMENT_URL && (
            <div style={{ marginTop: 12 }}>
              <a
                href={`${API_BASE_URL}${memo.ATTACHMENT_URL}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12,
                  color: "#8B0B1F",
                  fontWeight: 700,
                  textDecoration: "underline"
                }}
              >
                {memo.ATTACHMENT_NAME || "Open attachment"}
              </a>
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{
          marginTop: 12,
          padding: 10,
          background: "#fee2e2",
          color: "#991b1b",
          borderRadius: 8,
          fontSize: 12
        }}>
          {error}
        </div>
      )}

      {/* Footer actions */}
      <div style={{
        marginTop: 18,
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap"
      }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!editMode && !isLocked && (
            <button onClick={() => setEditMode(true)} style={btnSecondary()}>
              Edit
            </button>
          )}
          {!isLocked && (
            <button
              onClick={() => API.post(`/memos/${memo.ID}/close`).then(onChanged)}
              style={btnSecondary()}
            >
              Close Memo
            </button>
          )}
          {!isLocked && (
            <button
              onClick={() => API.post(`/memos/${memo.ID}/cancel`).then(onChanged)}
              style={btnSecondary()}
            >
              Cancel Memo
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {editMode && (
            <>
              <button onClick={() => setEditMode(false)} style={btnSecondary()}>
                Discard
              </button>
              <button onClick={save} disabled={saving} style={btnPrimary(saving)}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </>
          )}
          {!editMode && (
            <button onClick={onClose} style={btnPrimary(false)}>Done</button>
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
    <div style={{
      background: "white",
      padding: "14px 18px",
      borderRadius: 12,
      boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
      position: "relative",
      overflow: "hidden"
    }}>
      <div style={{
        position: "absolute",
        top: 14, bottom: 14, left: 0, width: 3,
        background: accent,
        borderRadius: "0 3px 3px 0"
      }} />
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#64748b",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        marginBottom: 6
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24,
        fontWeight: 800,
        color: "#0f172a",
        lineHeight: 1
      }}>
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
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#64748b",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        marginBottom: 4
      }}>
        {label}
        {required && <span style={{ color: "#C8102E", marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  );
}


function ReadField({ label, value, multiline = false }) {

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#64748b",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        marginBottom: 4
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13,
        color: "#0f172a",
        whiteSpace: multiline ? "pre-wrap" : "normal",
        lineHeight: 1.5
      }}>
        {value || <span style={{ color: "#94a3b8" }}>—</span>}
      </div>
    </div>
  );
}


function RowBtn({ children, onClick, danger }) {

  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: `1px solid ${danger ? "#fecaca" : "#cbd5e1"}`,
        color: danger ? "#b91c1c" : "#475569",
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        cursor: "pointer"
      }}
    >
      {children}
    </button>
  );
}


function Modal({ title, onClose, children, width = 600 }) {

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 14,
          width: "100%",
          maxWidth: width,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 24px 60px rgba(15,23,42,0.20)"
        }}
      >
        <div style={{
          padding: "16px 22px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "sticky",
          top: 0,
          background: "white",
          zIndex: 1
        }}>
          <div style={{
            fontSize: 14,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: 0.3
          }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              color: "#94a3b8",
              cursor: "pointer",
              lineHeight: 1
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {children}
        </div>
      </div>
    </div>
  );
}


function selectStyle() {

  return {
    padding: "9px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 12,
    background: "white",
    color: "#0f172a",
    minWidth: 130
  };
}


function inputStyle() {

  return {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    background: "white",
    color: "#0f172a",
    boxSizing: "border-box",
    fontFamily: "inherit"
  };
}


function btnPrimary(disabled) {

  return {
    background: disabled ? "#cbd5e1" : "#8B0B1F",
    color: "white",
    border: "none",
    padding: "10px 20px",
    borderRadius: 8,
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    cursor: disabled ? "default" : "pointer"
  };
}


function btnSecondary() {

  return {
    background: "white",
    color: "#475569",
    border: "1px solid #cbd5e1",
    padding: "10px 18px",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    cursor: "pointer"
  };
}


function th(align = "left") {

  return {
    padding: "10px 8px",
    textAlign: align,
    fontWeight: 700,
    borderBottom: "1px solid #e2e8f0"
  };
}


function td(align = "left") {

  return {
    padding: "12px 8px",
    textAlign: align,
    verticalAlign: "top"
  };
}


export default EmployeeMemos;
