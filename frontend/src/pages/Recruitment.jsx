// =====================================================================
// Recruitment — Phase 2 AI Recruitment Assistant.
//
// One page with three views:
//   • Jobs       — open positions + ranked candidate leaderboard
//   • Candidates — uploaded resumes + parsed profile
//   • Pipeline   — applications (candidate <-> job) with screening
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";


const BVC_RED = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";

const BACKEND_URL = API.defaults.baseURL || "http://192.168.1.10:8001";


const STATUS_THEME = {
  OPEN: { bg: "#dcfce7", fg: "#166534" },
  ON_HOLD: { bg: "#fef3c7", fg: "#854d0e" },
  FILLED: { bg: "#dbeafe", fg: "#1e40af" },
  CANCELLED: { bg: "#fee2e2", fg: "#991b1b" },

  NEW: { bg: "#dbeafe", fg: "#1e40af" },
  SCREENED: { bg: "#e0e7ff", fg: "#3730a3" },
  SHORTLISTED: { bg: "#fef3c7", fg: "#854d0e" },
  INTERVIEWING: { bg: "#fef3c7", fg: "#854d0e" },
  OFFERED: { bg: "#fce7f3", fg: "#9d174d" },
  HIRED: { bg: "#dcfce7", fg: "#166534" },
  REJECTED: { bg: "#fee2e2", fg: "#991b1b" },
  ON_HOLD2: { bg: "#f1f5f9", fg: "#475569" },

  HIGHLY_SUITABLE: { bg: "#dcfce7", fg: "#166534" },
  SUITABLE: { bg: "#dbeafe", fg: "#1e40af" },
  PARTIALLY_SUITABLE: { bg: "#fef3c7", fg: "#854d0e" },
  NOT_SUITABLE: { bg: "#fee2e2", fg: "#991b1b" },
  PENDING: { bg: "#f1f5f9", fg: "#475569" },
};


function Pill({ status }) {
  const t = STATUS_THEME[status] || { bg: "#f1f5f9", fg: "#475569" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, background: t.bg, color: t.fg,
      letterSpacing: 0.4,
    }}>
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}


export default function Recruitment() {

  const [tab, setTab] = useState("requisitions");

  return (
    <div style={{ padding: 20, background: "#f1f5f9", minHeight: "calc(100vh - 80px)" }}>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
        borderRadius: 16, padding: "20px 26px", color: "white",
        marginBottom: 18,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 2,
          color: BVC_GOLD, textTransform: "uppercase",
        }}>
          BVC24 · AI Recruitment
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
          Recruitment Assistant
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
          Resume parsing · Candidate screening · Interview scheduling · Ranking · Offer letters
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        background: "white", borderRadius: 12, padding: 6,
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        marginBottom: 18, display: "flex", gap: 4,
      }}>
        {[
          { key: "requisitions", label: "Requisitions" },
          { key: "jobs", label: "Jobs" },
          { key: "candidates", label: "Candidates" },
          { key: "pipeline", label: "Pipeline" },
          { key: "interviews", label: "Interviews" },
          { key: "offers", label: "Offers" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "9px 18px",
              background: tab === t.key ? BVC_DARK : "transparent",
              color: tab === t.key ? "white" : "#475569",
              border: "none", borderRadius: 8,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              letterSpacing: -0.005 + "em",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "requisitions" && <RequisitionsTab onConverted={() => setTab("jobs")} />}
      {tab === "jobs" && <JobsTab />}
      {tab === "candidates" && <CandidatesTab />}
      {tab === "pipeline" && <PipelineTab />}
      {tab === "interviews" && <InterviewsTab />}
      {tab === "offers" && <OffersTab />}
    </div>
  );
}


// =====================================================================
// REQUISITIONS TAB — manpower requests, approval workflow, convert-to-job
// =====================================================================

const REQ_URGENCIES = [
  { key: "LOW", label: "Low", color: "#64748b" },
  { key: "NORMAL", label: "Normal", color: "#2563eb" },
  { key: "HIGH", label: "High", color: "#d97706" },
  { key: "CRITICAL", label: "Critical", color: "#dc2626" },
];

const REQ_STATUS_THEME = {
  PENDING: { bg: "#fef3c7", fg: "#854d0e" },
  APPROVED: { bg: "#dcfce7", fg: "#166534" },
  REJECTED: { bg: "#fee2e2", fg: "#991b1b" },
  ON_HOLD: { bg: "#e0e7ff", fg: "#3730a3" },
  CANCELLED: { bg: "#f1f5f9", fg: "#475569" },
  CONVERTED: { bg: "#dbeafe", fg: "#1e40af" },
};

function ReqPill({ status }) {
  const t = REQ_STATUS_THEME[status] || { bg: "#f1f5f9", fg: "#475569" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, background: t.bg, color: t.fg,
      letterSpacing: 0.4,
    }}>
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}

function UrgencyDot({ urgency }) {
  const u = REQ_URGENCIES.find((x) => x.key === urgency) || REQ_URGENCIES[1];
  return (
    <span title={u.label} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 700, color: u.color,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: u.color,
      }} />
      {u.label}
    </span>
  );
}

function RequisitionsTab({ onConverted }) {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(null);          // { id, action }
  const [detailReq, setDetailReq] = useState(null);
  const [toast, setToast] = useState("");

  const load = () => {
    setLoading(true);
    API.get("/recruitment/requisitions")
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const stats = useMemo(() => {
    const s = { total: rows.length, pending: 0, approved: 0, converted: 0, rejected: 0 };
    for (const r of rows) {
      if (r.STATUS === "PENDING") s.pending++;
      else if (r.STATUS === "APPROVED") s.approved++;
      else if (r.STATUS === "CONVERTED") s.converted++;
      else if (r.STATUS === "REJECTED") s.rejected++;
    }
    return s;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!statusFilter) return rows;
    return rows.filter((r) => r.STATUS === statusFilter);
  }, [rows, statusFilter]);

  const approve = async (r) => {
    setBusy({ id: r.ID, action: "approve" });
    try {
      await API.post(`/recruitment/requisitions/${r.ID}/approve`, {});
      setToast(`Approved ${r.REQ_CODE}`);
      load();
    } catch (err) {
      setToast(err?.response?.data?.detail || "Approve failed");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (r) => {
    const reason = window.prompt(`Reject ${r.REQ_CODE}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    setBusy({ id: r.ID, action: "reject" });
    try {
      await API.post(`/recruitment/requisitions/${r.ID}/reject`, {
        REJECTION_REASON: reason.trim(),
      });
      setToast(`Rejected ${r.REQ_CODE}`);
      load();
    } catch (err) {
      setToast(err?.response?.data?.detail || "Reject failed");
    } finally {
      setBusy(null);
    }
  };

  const convert = async (r) => {
    if (!window.confirm(
      `Convert ${r.REQ_CODE} into an open job posting for ${r.POSITION_TITLE}?`
    )) return;
    setBusy({ id: r.ID, action: "convert" });
    try {
      const res = await API.post(`/recruitment/requisitions/${r.ID}/convert`, {});
      setToast(`Job ${res.data?.job_code || res.data?.job_id} created`);
      load();
      onConverted?.();
    } catch (err) {
      setToast(err?.response?.data?.detail || "Convert failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete requisition ${r.REQ_CODE}? This cannot be undone.`)) return;
    setBusy({ id: r.ID, action: "delete" });
    try {
      await API.delete(`/recruitment/requisitions/${r.ID}`);
      setToast(`Deleted ${r.REQ_CODE}`);
      load();
    } catch (err) {
      setToast(err?.response?.data?.detail || "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>

      {/* --- Stats + create button --- */}
      <div style={{
        display: "flex", gap: 12, alignItems: "center",
        justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <ReqStatChip label="Total" value={stats.total} />
          <ReqStatChip label="Pending" value={stats.pending} tone="#d97706" />
          <ReqStatChip label="Approved" value={stats.approved} tone="#16a34a" />
          <ReqStatChip label="Converted" value={stats.converted} tone="#2563eb" />
          <ReqStatChip label="Rejected" value={stats.rejected} tone="#dc2626" />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: "8px 12px", border: "1px solid #e2e8f0",
              borderRadius: 8, fontSize: 12, background: "white",
              color: "#0f172a", outline: "none",
            }}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="CONVERTED">Converted</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: BVC_RED, color: "white", border: "none",
              padding: "9px 16px", borderRadius: 8, fontSize: 12,
              fontWeight: 700, cursor: "pointer",
            }}
          >
            + New Requisition
          </button>
        </div>
      </div>

      {/* --- List --- */}
      {loading && <Spinner />}

      {!loading && filtered.length === 0 && (
        <EmptyState text={
          rows.length === 0
            ? "No requisitions yet. Click + New Requisition to raise the first one."
            : "No requisitions match this filter."
        } />
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => (
            <RequisitionRow
              key={r.ID}
              req={r}
              busy={busy?.id === r.ID ? busy.action : null}
              onOpen={() => setDetailReq(r)}
              onApprove={() => approve(r)}
              onReject={() => reject(r)}
              onConvert={() => convert(r)}
              onDelete={() => remove(r)}
            />
          ))}
        </div>
      )}

      {/* --- Overlays --- */}
      {showCreate && (
        <CreateRequisitionModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}

      {detailReq && (
        <RequisitionDetailDrawer
          req={detailReq}
          busy={busy?.id === detailReq.ID ? busy.action : null}
          onClose={() => setDetailReq(null)}
          onApprove={async () => { await approve(detailReq); setDetailReq(null); }}
          onReject={async () => { await reject(detailReq); setDetailReq(null); }}
          onConvert={async () => { await convert(detailReq); setDetailReq(null); }}
        />
      )}

      {/* --- Toast --- */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%",
          transform: "translateX(-50%)",
          background: "#1f2937", color: "white",
          padding: "9px 16px", borderRadius: 8, fontSize: 12,
          fontWeight: 600, boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
          zIndex: 300,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function ReqStatChip({ label, value, tone }) {
  return (
    <div style={{
      background: "white",
      border: "1px solid #e2e8f0",
      padding: "6px 12px",
      borderRadius: 8,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      borderLeft: tone ? `3px solid ${tone}` : "1px solid #e2e8f0",
    }}>
      <span style={{ fontSize: 18, fontWeight: 800, color: tone || "#0f172a" }}>
        {value}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, color: "#64748b",
        letterSpacing: 0.8, textTransform: "uppercase",
      }}>
        {label}
      </span>
    </div>
  );
}

function RequisitionRow({ req, busy, onOpen, onApprove, onReject, onConvert, onDelete }) {

  const isPending = req.STATUS === "PENDING";
  const isApproved = req.STATUS === "APPROVED";
  const isConverted = req.STATUS === "CONVERTED";
  const isTerminal = ["REJECTED", "CANCELLED"].includes(req.STATUS);

  return (
    <div
      onClick={onOpen}
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          flexWrap: "wrap", marginBottom: 4,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 800, color: "#64748b",
            letterSpacing: 0.6, fontFamily: "ui-monospace, monospace",
          }}>
            {req.REQ_CODE}
          </span>
          <ReqPill status={req.STATUS} />
          <UrgencyDot urgency={req.URGENCY} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
          {req.POSITION_TITLE}
          <span style={{
            fontSize: 12, color: "#64748b", fontWeight: 500, marginLeft: 8,
          }}>
            × {req.HEADCOUNT}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
          {req.DEPARTMENT || "—"}
          {req.LOCATION ? ` · ${req.LOCATION}` : ""}
          {req.EMPLOYMENT_TYPE ? ` · ${req.EMPLOYMENT_TYPE.replace(/_/g, " ")}` : ""}
          {req.REQUESTED_BY_NAME ? ` · by ${req.REQUESTED_BY_NAME}` : ""}
          {req.NEEDED_BY_DATE ? ` · needed ${req.NEEDED_BY_DATE}` : ""}
        </div>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", gap: 6 }}
      >
        {isPending && (
          <>
            <MiniBtn
              label={busy === "approve" ? "…" : "Approve"}
              onClick={onApprove}
              disabled={!!busy}
              tone="green"
            />
            <MiniBtn
              label={busy === "reject" ? "…" : "Reject"}
              onClick={onReject}
              disabled={!!busy}
              tone="red"
            />
          </>
        )}

        {isApproved && (
          <MiniBtn
            label={busy === "convert" ? "Converting…" : "Convert → Job"}
            onClick={onConvert}
            disabled={!!busy}
            tone="blue"
          />
        )}

        {isConverted && req.CONVERTED_JOB_ID && (
          <span style={{
            fontSize: 11, color: "#2563eb", fontWeight: 700,
            padding: "5px 10px", background: "#eff6ff",
            border: "1px solid #bfdbfe", borderRadius: 6,
          }}>
            → Job #{req.CONVERTED_JOB_ID}
          </span>
        )}

        <MiniBtn
          label="Delete"
          onClick={onDelete}
          disabled={!!busy}
          tone="slate"
        />
      </div>
    </div>
  );
}

function MiniBtn({ label, onClick, disabled, tone = "slate" }) {
  const themes = {
    green: { bg: "#16a34a", fg: "white" },
    red: { bg: "#dc2626", fg: "white" },
    blue: { bg: "#2563eb", fg: "white" },
    slate: { bg: "white", fg: "#475569", border: "#e2e8f0" },
  };
  const t = themes[tone] || themes.slate;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: t.bg, color: t.fg,
        border: t.border ? `1px solid ${t.border}` : "none",
        padding: "6px 12px", borderRadius: 6, fontSize: 11,
        fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function CreateRequisitionModal({ onClose, onSaved }) {

  const [form, setForm] = useState({
    POSITION_TITLE: "",
    DEPARTMENT: "",
    LOCATION: "",
    EMPLOYMENT_TYPE: "FULL_TIME",
    HEADCOUNT: 1,
    EXPERIENCE_MIN_YEARS: 0,
    EXPERIENCE_MAX_YEARS: "",
    BUDGET_CTC_MIN: "",
    BUDGET_CTC_MAX: "",
    REQUIRED_SKILLS: "",
    PREFERRED_SKILLS: "",
    REQUIRED_EDUCATION: "",
    JUSTIFICATION: "",
    URGENCY: "NORMAL",
    NEEDED_BY_DATE: "",
    REQUESTED_BY_ID: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    API.get("/employees").then(
      (r) => setEmployees(Array.isArray(r.data) ? r.data : [])
    ).catch(() => setEmployees([]));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (!form.POSITION_TITLE.trim()) {
      setError("Position title is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        POSITION_TITLE: form.POSITION_TITLE.trim(),
        DEPARTMENT: form.DEPARTMENT.trim() || null,
        LOCATION: form.LOCATION.trim() || null,
        EMPLOYMENT_TYPE: form.EMPLOYMENT_TYPE || "FULL_TIME",
        HEADCOUNT: Number(form.HEADCOUNT) || 1,
        EXPERIENCE_MIN_YEARS: Number(form.EXPERIENCE_MIN_YEARS) || 0,
        EXPERIENCE_MAX_YEARS: form.EXPERIENCE_MAX_YEARS === "" ? null : Number(form.EXPERIENCE_MAX_YEARS),
        BUDGET_CTC_MIN: form.BUDGET_CTC_MIN === "" ? null : Number(form.BUDGET_CTC_MIN),
        BUDGET_CTC_MAX: form.BUDGET_CTC_MAX === "" ? null : Number(form.BUDGET_CTC_MAX),
        REQUIRED_SKILLS: form.REQUIRED_SKILLS.trim() || null,
        PREFERRED_SKILLS: form.PREFERRED_SKILLS.trim() || null,
        REQUIRED_EDUCATION: form.REQUIRED_EDUCATION.trim() || null,
        JUSTIFICATION: form.JUSTIFICATION.trim() || null,
        URGENCY: form.URGENCY || "NORMAL",
        NEEDED_BY_DATE: form.NEEDED_BY_DATE || null,
        REQUESTED_BY_ID: form.REQUESTED_BY_ID || null,
      };
      await API.post("/recruitment/requisitions", payload);
      onSaved?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create requisition.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: "white", borderRadius: 12,
          width: "100%", maxWidth: 720,
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
          color: "white", padding: "18px 22px",
          borderRadius: "12px 12px 0 0",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 2,
            color: BVC_GOLD, textTransform: "uppercase",
          }}>
            Recruitment · New Requisition
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, marginTop: 3 }}>
            Raise a manpower request
          </div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 3 }}>
            Once approved, HR can convert this into an open job posting with one click.
          </div>
        </div>

        <div style={{ padding: 22 }}>
          <ReqField label="Position title *">
            <input
              type="text" required
              value={form.POSITION_TITLE}
              onChange={set("POSITION_TITLE")}
              placeholder="e.g. Senior Backend Developer"
              style={reqInputStyle}
            />
          </ReqField>

          <ReqRow>
            <ReqField label="Department">
              <input
                type="text"
                value={form.DEPARTMENT}
                onChange={set("DEPARTMENT")}
                placeholder="e.g. Engineering"
                style={reqInputStyle}
              />
            </ReqField>
            <ReqField label="Location">
              <input
                type="text"
                value={form.LOCATION}
                onChange={set("LOCATION")}
                placeholder="e.g. Chennai / Remote"
                style={reqInputStyle}
              />
            </ReqField>
          </ReqRow>

          <ReqRow>
            <ReqField label="Employment type">
              <select
                value={form.EMPLOYMENT_TYPE}
                onChange={set("EMPLOYMENT_TYPE")}
                style={reqInputStyle}
              >
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option>
                <option value="INTERN">Intern</option>
              </select>
            </ReqField>
            <ReqField label="Headcount">
              <input
                type="number" min="1"
                value={form.HEADCOUNT}
                onChange={set("HEADCOUNT")}
                style={reqInputStyle}
              />
            </ReqField>
            <ReqField label="Urgency">
              <select
                value={form.URGENCY}
                onChange={set("URGENCY")}
                style={reqInputStyle}
              >
                {REQ_URGENCIES.map((u) => (
                  <option key={u.key} value={u.key}>{u.label}</option>
                ))}
              </select>
            </ReqField>
          </ReqRow>

          <ReqRow>
            <ReqField label="Min experience (years)">
              <input
                type="number" min="0" step="0.5"
                value={form.EXPERIENCE_MIN_YEARS}
                onChange={set("EXPERIENCE_MIN_YEARS")}
                style={reqInputStyle}
              />
            </ReqField>
            <ReqField label="Max experience (years)">
              <input
                type="number" min="0" step="0.5"
                value={form.EXPERIENCE_MAX_YEARS}
                onChange={set("EXPERIENCE_MAX_YEARS")}
                placeholder="optional"
                style={reqInputStyle}
              />
            </ReqField>
          </ReqRow>

          <ReqRow>
            <ReqField label="Budget CTC min">
              <input
                type="number" min="0" step="1000"
                value={form.BUDGET_CTC_MIN}
                onChange={set("BUDGET_CTC_MIN")}
                placeholder="e.g. 500000"
                style={reqInputStyle}
              />
            </ReqField>
            <ReqField label="Budget CTC max">
              <input
                type="number" min="0" step="1000"
                value={form.BUDGET_CTC_MAX}
                onChange={set("BUDGET_CTC_MAX")}
                placeholder="e.g. 900000"
                style={reqInputStyle}
              />
            </ReqField>
          </ReqRow>

          <ReqField label="Required skills">
            <input
              type="text"
              value={form.REQUIRED_SKILLS}
              onChange={set("REQUIRED_SKILLS")}
              placeholder="Python, FastAPI, MySQL, React"
              style={reqInputStyle}
            />
          </ReqField>

          <ReqField label="Preferred skills">
            <input
              type="text"
              value={form.PREFERRED_SKILLS}
              onChange={set("PREFERRED_SKILLS")}
              placeholder="Docker, Redis, AWS"
              style={reqInputStyle}
            />
          </ReqField>

          <ReqField label="Required education">
            <input
              type="text"
              value={form.REQUIRED_EDUCATION}
              onChange={set("REQUIRED_EDUCATION")}
              placeholder="B.E. Computer Science or equivalent"
              style={reqInputStyle}
            />
          </ReqField>

          <ReqRow>
            <ReqField label="Requested by">
              <select
                value={form.REQUESTED_BY_ID}
                onChange={set("REQUESTED_BY_ID")}
                style={reqInputStyle}
              >
                <option value="">— pick employee (optional) —</option>
                {employees.map((e) => (
                  <option key={e.ID} value={e.ID}>
                    {e.NAME || e.EMPLOYEE_CODE || e.ID}
                    {e.EMPLOYEE_CODE ? ` (${e.EMPLOYEE_CODE})` : ""}
                  </option>
                ))}
              </select>
            </ReqField>
            <ReqField label="Needed by">
              <input
                type="date"
                value={form.NEEDED_BY_DATE}
                onChange={set("NEEDED_BY_DATE")}
                style={reqInputStyle}
              />
            </ReqField>
          </ReqRow>

          <ReqField label="Justification">
            <textarea
              rows={3}
              value={form.JUSTIFICATION}
              onChange={set("JUSTIFICATION")}
              placeholder="Why this hire is needed…"
              style={{ ...reqInputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </ReqField>

          {error && (
            <div style={{
              background: "#fef2f2", color: "#991b1b",
              padding: "9px 12px", borderRadius: 8,
              fontSize: 12, fontWeight: 600, marginTop: 12,
              border: "1px solid #fecaca",
            }}>
              {error}
            </div>
          )}

          <div style={{
            display: "flex", gap: 8, justifyContent: "flex-end",
            marginTop: 18,
          }}>
            <button
              type="button" onClick={onClose}
              style={{
                background: "white", color: "#475569",
                border: "1px solid #e2e8f0",
                padding: "10px 18px", borderRadius: 8,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              style={{
                background: BVC_RED, color: "white", border: "none",
                padding: "10px 22px", borderRadius: 8,
                fontSize: 12, fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Submit requisition"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const reqInputStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  color: "#0f172a",
  background: "#fafbfc",
  boxSizing: "border-box",
};

function ReqField({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        fontSize: 10, fontWeight: 800, color: "#475569",
        letterSpacing: 0.8, textTransform: "uppercase",
        display: "block", marginBottom: 5,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ReqRow({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Array.isArray(children) ? children.length : 1}, 1fr)`, gap: 12 }}>
      {children}
    </div>
  );
}

function RequisitionDetailDrawer({ req, busy, onClose, onApprove, onReject, onConvert }) {
  const isPending   = req.STATUS === "PENDING";
  const isApproved  = req.STATUS === "APPROVED";
  const isConverted = req.STATUS === "CONVERTED";

  return (
    <Drawer title={`Requisition ${req.REQ_CODE}`} onClose={onClose} width={520}>
      <div style={{ padding: 20 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <ReqPill status={req.STATUS} />
          <UrgencyDot urgency={req.URGENCY} />
          <span style={{ fontSize: 11, color: "#64748b" }}>
            × {req.HEADCOUNT} opening{req.HEADCOUNT === 1 ? "" : "s"}
          </span>
        </div>

        {(isPending || isApproved) && (
          <div style={{
            display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap",
            padding: 12, background: "#f8fafc", borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}>
            {isPending && (
              <>
                <button
                  onClick={onApprove}
                  disabled={busy === "approve"}
                  style={{
                    flex: "1 1 140px", padding: "10px 14px", border: "none",
                    borderRadius: 6, background: "#10b981", color: "white",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                    opacity: busy === "approve" ? 0.6 : 1,
                  }}
                >
                  {busy === "approve" ? "Approving…" : "✓ Approve"}
                </button>
                <button
                  onClick={onReject}
                  disabled={busy === "reject"}
                  style={{
                    flex: "1 1 140px", padding: "10px 14px",
                    border: "1px solid #ef4444", borderRadius: 6,
                    background: "white", color: "#ef4444",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                    opacity: busy === "reject" ? 0.6 : 1,
                  }}
                >
                  {busy === "reject" ? "Rejecting…" : "✗ Reject"}
                </button>
              </>
            )}
            {isApproved && (
              <button
                onClick={onConvert}
                disabled={busy === "convert"}
                style={{
                  flex: "1 1 auto", padding: "10px 14px", border: "none",
                  borderRadius: 6, background: "#2563eb", color: "white",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                  opacity: busy === "convert" ? 0.6 : 1,
                }}
              >
                {busy === "convert" ? "Converting…" : "→ Convert to Job"}
              </button>
            )}
          </div>
        )}

        {isConverted && req.CONVERTED_JOB_ID && (
          <div style={{
            marginBottom: 18, padding: 12, background: "#eff6ff",
            border: "1px solid #bfdbfe", borderRadius: 8,
            fontSize: 12, color: "#1e40af", fontWeight: 700,
          }}>
            → Live as Job #{req.CONVERTED_JOB_ID}
          </div>
        )}

        <SectionTitle>{req.POSITION_TITLE}</SectionTitle>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          {req.DEPARTMENT || "—"}
          {req.LOCATION ? ` · ${req.LOCATION}` : ""}
          {req.EMPLOYMENT_TYPE ? ` · ${req.EMPLOYMENT_TYPE.replace(/_/g, " ")}` : ""}
        </div>

        <FieldRow label="Experience" value={
          req.EXPERIENCE_MIN_YEARS != null
            ? `${req.EXPERIENCE_MIN_YEARS}${req.EXPERIENCE_MAX_YEARS ? "–" + req.EXPERIENCE_MAX_YEARS : "+"} yrs`
            : "—"
        } />
        <FieldRow label="Budget CTC" value={
          req.BUDGET_CTC_MIN || req.BUDGET_CTC_MAX
            ? `₹${req.BUDGET_CTC_MIN || "?"} – ₹${req.BUDGET_CTC_MAX || "?"}`
            : "—"
        } />
        <FieldRow label="Required skills" value={req.REQUIRED_SKILLS || "—"} />
        <FieldRow label="Preferred skills" value={req.PREFERRED_SKILLS || "—"} />
        <FieldRow label="Education" value={req.REQUIRED_EDUCATION || "—"} />
        <FieldRow label="Needed by" value={req.NEEDED_BY_DATE || "—"} />
        <FieldRow label="Requested by" value={req.REQUESTED_BY_NAME || "—"} />
        <FieldRow label="Approved by" value={req.APPROVED_BY_NAME || "—"} />
        <FieldRow label="Approved at" value={req.APPROVED_AT || "—"} />

        {req.JUSTIFICATION && (
          <div style={{ marginTop: 14 }}>
            <SectionTitle>Justification</SectionTitle>
            <div style={{
              background: "#f8fafc", padding: 12, borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12, color: "#334155", whiteSpace: "pre-wrap",
            }}>
              {req.JUSTIFICATION}
            </div>
          </div>
        )}

        {req.REJECTION_REASON && (
          <div style={{ marginTop: 14 }}>
            <SectionTitle>Rejection reason</SectionTitle>
            <div style={{
              background: "#fef2f2", padding: 12, borderRadius: 8,
              border: "1px solid #fecaca",
              fontSize: 12, color: "#991b1b", whiteSpace: "pre-wrap",
            }}>
              {req.REJECTION_REASON}
            </div>
          </div>
        )}

      </div>
    </Drawer>
  );
}


// =====================================================================
// JOBS TAB
// =====================================================================

function JobsTab() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openingForm, setOpeningForm] = useState(false);
  const [focusJob, setFocusJob] = useState(null);

  const load = () => {
    setLoading(true);
    API.get("/recruitment/jobs")
      .then((r) => setJobs(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const deleteJob = async (j) => {
    if (!window.confirm(
      `Delete job ${j.JOB_CODE} — ${j.TITLE}?\n\n` +
      `This also removes every application, interview and offer linked to it. ` +
      `Candidates themselves stay in the Candidates tab.`
    )) return;
    try {
      await API.delete(`/recruitment/jobs/${j.ID}`);
      load();
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button onClick={() => setOpeningForm(true)} style={btnPrimary}>
          + New Job
        </button>
      </div>

      {loading && <Spinner />}

      {!loading && jobs.length === 0 && (
        <EmptyState text="No jobs yet. Click + New Job to post your first opening." />
      )}

      {!loading && jobs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {jobs.map((j) => (
            <JobCard
              key={j.ID}
              job={j}
              onOpen={() => setFocusJob(j)}
              onDelete={() => deleteJob(j)}
            />
          ))}
        </div>
      )}

      {openingForm && (
        <JobForm
          onClose={() => setOpeningForm(false)}
          onSaved={() => { setOpeningForm(false); load(); }}
        />
      )}
      {focusJob && (
        <JobDetailDrawer
          job={focusJob}
          onClose={() => setFocusJob(null)}
          onChange={load}
        />
      )}
    </div>
  );
}


function JobCard({ job, onOpen, onDelete }) {
  return (
    <div
      onClick={onOpen}
      style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 14,
        padding: 16, cursor: "pointer",
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            {job.JOB_CODE}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
            {job.TITLE}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            {[job.DEPARTMENT, job.LOCATION, job.EMPLOYMENT_TYPE].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}
             onClick={(e) => e.stopPropagation()}>
          <Pill status={job.STATUS} />
          {onDelete && (
            <button
              onClick={onDelete}
              title="Delete job"
              style={rowDeleteBtn}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "#475569", lineHeight: 1.6 }}>
        {(job.EXPERIENCE_MIN_YEARS || job.EXPERIENCE_MAX_YEARS) && (
          <div>Experience: <b>
            {job.EXPERIENCE_MIN_YEARS || 0}
            {job.EXPERIENCE_MAX_YEARS ? `–${job.EXPERIENCE_MAX_YEARS}` : "+"} years
          </b></div>
        )}
        {job.REQUIRED_SKILLS && (
          <div style={{ marginTop: 4 }}>
            <b>Skills:</b> {job.REQUIRED_SKILLS.split(",").slice(0, 4).join(", ")}
            {job.REQUIRED_SKILLS.split(",").length > 4 ? "…" : ""}
          </div>
        )}
        <div style={{ marginTop: 4 }}>Openings: <b>{job.OPENINGS}</b></div>
      </div>
    </div>
  );
}


function JobDetailDrawer({ job, onClose, onChange }) {
  const [ranked, setRanked] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    API.get(`/recruitment/jobs/${job.ID}/ranked-candidates`)
      .then((r) => setRanked(r.data || []))
      .finally(() => setLoading(false));
  }, [job.ID]);

  return (
    <Drawer onClose={onClose} width={700}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
          {job.JOB_CODE}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{job.TITLE}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
          {[job.DEPARTMENT, job.LOCATION, job.EMPLOYMENT_TYPE].filter(Boolean).join(" · ")}
        </div>
      </div>

      <SectionTitle>Requirements</SectionTitle>
      <FieldRow label="Experience" value={`${job.EXPERIENCE_MIN_YEARS || 0}${job.EXPERIENCE_MAX_YEARS ? `–${job.EXPERIENCE_MAX_YEARS}` : "+"} year(s)`} />
      <FieldRow label="Education" value={job.REQUIRED_EDUCATION} />
      <FieldRow label="Skills" value={job.REQUIRED_SKILLS} />
      <FieldRow label="Nice-to-have" value={job.PREFERRED_SKILLS} />
      <FieldRow label="Salary range" value={
        job.SALARY_MIN || job.SALARY_MAX
          ? `₹${(job.SALARY_MIN || 0).toLocaleString("en-IN")} – ₹${(job.SALARY_MAX || 0).toLocaleString("en-IN")}`
          : "—"
      } />
      {job.DESCRIPTION && (
        <div style={{ marginTop: 12, padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap" }}>
          {job.DESCRIPTION}
        </div>
      )}

      <SectionTitle>Ranked candidates ({ranked.length})</SectionTitle>
      {loading && <Spinner />}
      {!loading && ranked.length === 0 && (
        <EmptyState text="No candidates applied yet. Add candidates from the Pipeline tab." small />
      )}
      {!loading && ranked.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={th}>
                <th style={cell}>#</th>
                <th style={cell}>Candidate</th>
                <th style={{ ...cell, textAlign: "right" }}>Weighted</th>
                <th style={{ ...cell, textAlign: "right" }}>Skill</th>
                <th style={{ ...cell, textAlign: "right" }}>Exp</th>
                <th style={{ ...cell, textAlign: "right" }}>Edu</th>
                <th style={cell}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={cell}><b>{r.RANK}</b></td>
                  <td style={cell}>
                    <div style={{ fontWeight: 700 }}>{r.CANDIDATE_NAME}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                      {r.CANDIDATE_CODE}
                    </div>
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontWeight: 800 }}>{r.WEIGHTED_SCORE}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{r.SKILL_MATCH_PCT}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{r.EXPERIENCE_MATCH_PCT}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{r.EDUCATION_MATCH_PCT}</td>
                  <td style={cell}><Pill status={r.SCREENING_STATUS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}


function JobForm({ onClose, onSaved }) {
  const [form, setForm] = useState({
    TITLE: "", DEPARTMENT: "", LOCATION: "", EMPLOYMENT_TYPE: "FULL_TIME",
    EXPERIENCE_MIN_YEARS: 0, EXPERIENCE_MAX_YEARS: "",
    SALARY_MIN: "", SALARY_MAX: "",
    REQUIRED_SKILLS: "", PREFERRED_SKILLS: "", REQUIRED_EDUCATION: "",
    DESCRIPTION: "", OPENINGS: 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!form.TITLE.trim()) { setError("Title is required"); return; }
    setSaving(true); setError("");
    try {
      const payload = { ...form };
      ["EXPERIENCE_MAX_YEARS", "SALARY_MIN", "SALARY_MAX"].forEach((k) => {
        payload[k] = payload[k] === "" ? null : Number(payload[k]);
      });
      payload.EXPERIENCE_MIN_YEARS = Number(payload.EXPERIENCE_MIN_YEARS) || 0;
      payload.OPENINGS = Number(payload.OPENINGS) || 1;
      await API.post("/recruitment/jobs", payload);
      onSaved?.();
    } catch (e) {
      setError(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Drawer onClose={onClose} width={620} title="New Job Opening">
      <Field label="Title *">
        <input value={form.TITLE} onChange={(e) => setForm({ ...form, TITLE: e.target.value })} style={input} placeholder="e.g. Senior Mechanical Engineer" />
      </Field>
      <Row>
        <Field label="Department">
          <input value={form.DEPARTMENT} onChange={(e) => setForm({ ...form, DEPARTMENT: e.target.value })} style={input} />
        </Field>
        <Field label="Location">
          <input value={form.LOCATION} onChange={(e) => setForm({ ...form, LOCATION: e.target.value })} style={input} placeholder="Coimbatore" />
        </Field>
      </Row>
      <Row>
        <Field label="Employment type">
          <select value={form.EMPLOYMENT_TYPE} onChange={(e) => setForm({ ...form, EMPLOYMENT_TYPE: e.target.value })} style={input}>
            <option value="FULL_TIME">Full-time</option>
            <option value="PART_TIME">Part-time</option>
            <option value="CONTRACT">Contract</option>
            <option value="INTERN">Intern</option>
          </select>
        </Field>
        <Field label="Openings">
          <input type="number" min="1" value={form.OPENINGS} onChange={(e) => setForm({ ...form, OPENINGS: e.target.value })} style={input} />
        </Field>
      </Row>
      <Row>
        <Field label="Experience min (yrs)">
          <input type="number" min="0" step="0.5" value={form.EXPERIENCE_MIN_YEARS} onChange={(e) => setForm({ ...form, EXPERIENCE_MIN_YEARS: e.target.value })} style={input} />
        </Field>
        <Field label="Experience max (yrs)">
          <input type="number" min="0" step="0.5" value={form.EXPERIENCE_MAX_YEARS} onChange={(e) => setForm({ ...form, EXPERIENCE_MAX_YEARS: e.target.value })} style={input} />
        </Field>
      </Row>
      <Row>
        <Field label="Salary min (₹/year)">
          <input type="number" min="0" value={form.SALARY_MIN} onChange={(e) => setForm({ ...form, SALARY_MIN: e.target.value })} style={input} />
        </Field>
        <Field label="Salary max (₹/year)">
          <input type="number" min="0" value={form.SALARY_MAX} onChange={(e) => setForm({ ...form, SALARY_MAX: e.target.value })} style={input} />
        </Field>
      </Row>
      <Field label="Required skills (comma-separated)">
        <input value={form.REQUIRED_SKILLS} onChange={(e) => setForm({ ...form, REQUIRED_SKILLS: e.target.value })} style={input} placeholder="Python, FastAPI, MySQL, Docker" />
      </Field>
      <Field label="Preferred skills (comma-separated)">
        <input value={form.PREFERRED_SKILLS} onChange={(e) => setForm({ ...form, PREFERRED_SKILLS: e.target.value })} style={input} placeholder="React, AWS" />
      </Field>
      <Field label="Required education">
        <input value={form.REQUIRED_EDUCATION} onChange={(e) => setForm({ ...form, REQUIRED_EDUCATION: e.target.value })} style={input} placeholder="B.E. / B.Tech" />
      </Field>
      <Field label="Description">
        <textarea rows={4} value={form.DESCRIPTION} onChange={(e) => setForm({ ...form, DESCRIPTION: e.target.value })} style={{ ...input, resize: "vertical" }} />
      </Field>

      {error && <div style={errBox}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={saving} style={btnPrimary}>
          {saving ? "Saving..." : "Create Job"}
        </button>
      </div>
    </Drawer>
  );
}


// =====================================================================
// CANDIDATES TAB
// =====================================================================

function CandidatesTab() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState(null);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  // Phase 5 — parsed-resume review modal state.
  // The parser now runs on a local Qwen 2.5 model whose accuracy is
  // lower than Gemini's, so HR reviews / edits the extracted fields
  // before the candidate row is persisted.
  const [reviewQueue, setReviewQueue] = useState([]);   // pending parses
  const [reviewIdx, setReviewIdx] = useState(0);

  const load = () => {
    setLoading(true);
    API.get("/recruitment/candidates")
      .then((r) => setCandidates(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const onFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const parsed = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        // NEW: parse-only first (does NOT create the Candidate row).
        // Backend saves the file to disk and returns the extracted
        // fields for HR to review.
        const res = await API.post("/recruitment/candidates/parse", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        parsed.push({
          filename: f.name,
          resume_url: res.data?.resume_url,
          parsed: res.data?.parsed || {},
          existing_id: res.data?.existing_id,
          existing_name: res.data?.existing_name,
        });
      } catch (e) {
        console.error("Parse failed:", f.name, e?.response?.data?.detail);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (parsed.length > 0) {
      setReviewQueue(parsed);
      setReviewIdx(0);
    } else {
      // Nothing parsed — silent; a toast could go here later.
      load();
    }
  };

  const finishReview = () => {
    setReviewQueue([]);
    setReviewIdx(0);
    load();
  };

  const nextReview = () => {
    if (reviewIdx + 1 < reviewQueue.length) {
      setReviewIdx(reviewIdx + 1);
    } else {
      finishReview();
    }
  };

  const saveReviewed = async (edited) => {
    const item = reviewQueue[reviewIdx];
    if (!item) return;
    await API.post("/recruitment/candidates", {
      resume_url: item.resume_url,
      resume_text: edited.raw_text || item.parsed?.raw_text || "",
      full_name: edited.full_name || "",
      email: edited.email || null,
      phone: edited.phone || null,
      location: edited.location || null,
      linkedin: edited.linkedin || null,
      skills: edited.skills || [],
      languages: edited.languages || [],
      certifications: edited.certifications || [],
      education: edited.education || [],
      work_experience: edited.work_experience || [],
      projects: edited.projects || [],
      total_experience_years: edited.total_experience_years ?? null,
      highest_qualification: edited.highest_qualification || null,
      source: "WEBSITE",
    });
    nextReview();
  };

  const skipReview = () => nextReview();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      (c.FULL_NAME || "").toLowerCase().includes(q) ||
      (c.EMAIL || "").toLowerCase().includes(q) ||
      (c.SKILLS || "").toLowerCase().includes(q) ||
      (c.LOCATION || "").toLowerCase().includes(q)
    );
  }, [candidates, search]);

  return (
    <div>
      <div style={{
        background: "white", padding: 14, borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        marginBottom: 14, display: "flex", gap: 10, alignItems: "center",
        flexWrap: "wrap",
      }}>
        <input
          type="text" value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, skill, location..."
          style={{
            flex: "1 1 300px", minWidth: 240,
            padding: "9px 12px", border: "1px solid #cbd5e1",
            borderRadius: 8, fontSize: 13, fontFamily: "inherit",
          }}
        />
        <input
          ref={fileRef} type="file" multiple
          accept=".pdf,.docx,.doc,.txt"
          onChange={(e) => onFiles(e.target.files)}
          style={{ display: "none" }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading} style={btnPrimary}
        >
          {uploading ? "Uploading & parsing..." : "Upload Resume(s)"}
        </button>
        <div style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>
          {filtered.length} of {candidates.length}
        </div>
      </div>

      {loading && <Spinner />}

      {!loading && filtered.length === 0 && (
        <EmptyState text="No candidates yet. Click Upload Resume(s) to start. PDF / DOCX / TXT supported." />
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {filtered.map((c) => (
            <CandidateCard
              key={c.ID}
              c={c}
              onOpen={() => setFocus(c)}
              onDelete={async () => {
                if (!window.confirm(
                  `Delete candidate ${c.NAME || c.EMAIL}?\n\n` +
                  `This also removes every application, interview and offer ` +
                  `linked to them.`
                )) return;
                try {
                  await API.delete(`/recruitment/candidates/${c.ID}`);
                  load();
                } catch (err) {
                  window.alert(err?.response?.data?.detail || "Delete failed");
                }
              }}
            />
          ))}
        </div>
      )}

      {focus && (
        <CandidateDrawer
          candidate={focus} onClose={() => setFocus(null)} onChange={load}
        />
      )}

      {reviewQueue.length > 0 && (
        <ResumeReviewModal
          key={`review-${reviewIdx}`}
          item={reviewQueue[reviewIdx]}
          position={reviewIdx + 1}
          total={reviewQueue.length}
          onSave={saveReviewed}
          onSkip={skipReview}
          onCancelAll={finishReview}
        />
      )}
    </div>
  );
}


function ResumeReviewModal({ item, position, total, onSave, onSkip, onCancelAll }) {

  const p = item?.parsed || {};

  const [form, setForm] = useState({
    full_name: p.full_name || "",
    email: p.email || "",
    phone: p.phone || "",
    location: p.location || "",
    linkedin: p.linkedin || "",
    total_experience_years: p.total_experience_years ?? "",
    highest_qualification: p.highest_qualification || "",
    skills: (p.skills || []).join(", "),
    languages: (p.languages || []).join(", "),
    certifications: (p.certifications || []).join(", "),
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const toList = (s) =>
    (s || "").split(",").map((x) => x.trim()).filter(Boolean);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.full_name.trim()) {
      setError("Full name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        raw_text: p.raw_text || "",
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        location: form.location.trim() || null,
        linkedin: form.linkedin.trim() || null,
        total_experience_years: form.total_experience_years === ""
          ? null
          : Number(form.total_experience_years),
        highest_qualification: form.highest_qualification.trim() || null,
        skills: toList(form.skills),
        languages: toList(form.languages),
        certifications: toList(form.certifications),
        education: p.education || [],
        work_experience: p.work_experience || [],
        projects: p.projects || [],
      });
    } catch (err) {
      setError(err?.response?.data?.detail || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, zIndex: 300,
    }} onClick={onCancelAll}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{
        background: "white", borderRadius: 12, width: "100%", maxWidth: 640,
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
      }}>
        <div style={{
          background: "linear-gradient(135deg,#7A1022,#C8102E)",
          color: "white", padding: "16px 22px",
          borderRadius: "12px 12px 0 0",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 2,
            color: "#F4B324", textTransform: "uppercase"
          }}>
            Review Parsed Resume · {position} of {total}
          </div>
          <div style={{ fontSize: 17, fontWeight: 900, marginTop: 3 }}>
            {item.filename}
          </div>
          {item.existing_id && (
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
              An existing candidate ({item.existing_name}) shares this email —
              saving will update that record.
            </div>
          )}
        </div>

        <div style={{ padding: 20 }}>
          <div style={{
            background: "#fef3c7", color: "#854d0e",
            padding: "8px 12px", borderRadius: 8, fontSize: 11,
            marginBottom: 14, border: "1px solid #fde68a",
          }}>
            The parser guesses these fields from the resume. Please review
            and correct anything wrong before saving.
          </div>

          <RvRow>
            <RvField label="Full name *"><input type="text" value={form.full_name}
              onChange={set("full_name")} style={fInput} /></RvField>
            <RvField label="Email"><input type="email" value={form.email}
              onChange={set("email")} style={fInput} /></RvField>
          </RvRow>
          <RvRow>
            <RvField label="Phone"><input type="text" value={form.phone}
              onChange={set("phone")} style={fInput} /></RvField>
            <RvField label="Location"><input type="text" value={form.location}
              onChange={set("location")} style={fInput} /></RvField>
          </RvRow>
          <RvRow>
            <RvField label="LinkedIn"><input type="text" value={form.linkedin}
              onChange={set("linkedin")} style={fInput}
              placeholder="linkedin.com/in/…" /></RvField>
            <RvField label="Experience (years)"><input type="number" step="0.1"
              value={form.total_experience_years}
              onChange={set("total_experience_years")} style={fInput} /></RvField>
          </RvRow>
          <RvField label="Highest qualification"><input type="text"
            value={form.highest_qualification}
            onChange={set("highest_qualification")} style={fInput} /></RvField>
          <RvField label="Skills (comma separated)"><textarea rows={2}
            value={form.skills} onChange={set("skills")}
            style={{ ...fInput, resize: "vertical", fontFamily: "inherit" }} /></RvField>
          <RvField label="Languages (comma separated)"><input type="text"
            value={form.languages} onChange={set("languages")}
            style={fInput} /></RvField>
          <RvField label="Certifications (comma separated)"><input type="text"
            value={form.certifications} onChange={set("certifications")}
            style={fInput} /></RvField>

          {(p.education?.length > 0 || p.work_experience?.length > 0) && (
            <div style={{
              background: "#f8fafc", padding: 10, borderRadius: 8,
              fontSize: 11, color: "#64748b", marginTop: 8,
              border: "1px solid #e2e8f0",
            }}>
              Also captured (auto-saved): {p.education?.length || 0} education
              entries, {p.work_experience?.length || 0} work experience entries,
              {" "}{p.projects?.length || 0} projects. You can edit these later
              from the candidate detail page.
            </div>
          )}

          {error && (
            <div style={{
              background: "#fef2f2", color: "#991b1b", padding: "9px 12px",
              borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 10,
              border: "1px solid #fecaca",
            }}>
              {error}
            </div>
          )}

          <div style={{
            display: "flex", gap: 8, justifyContent: "space-between",
            marginTop: 16, flexWrap: "wrap"
          }}>
            <button type="button" onClick={onCancelAll} style={{
              background: "white", color: "#64748b",
              border: "1px solid #e2e8f0", padding: "8px 15px",
              borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>Cancel all</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onSkip} style={{
                background: "white", color: "#64748b",
                border: "1px solid #e2e8f0", padding: "8px 15px",
                borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>Skip this resume</button>
              <button type="submit" disabled={saving} style={{
                background: "#C8102E", color: "white", border: "none",
                padding: "8px 18px", borderRadius: 6, fontSize: 12,
                fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}>
                {saving ? "Saving…" : position < total ? "Save & next" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}


function RvRow({ children }) {
  const count = Array.isArray(children) ? children.length : 1;
  return (
    <div style={{
      display: "grid", gap: 10, marginBottom: 10,
      gridTemplateColumns: `repeat(${count}, 1fr)`
    }}>
      {children}
    </div>
  );
}

function RvField({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        fontSize: 10, fontWeight: 800, color: "#64748b",
        letterSpacing: 0.6, textTransform: "uppercase",
        display: "block", marginBottom: 4,
      }}>{label}</label>
      {children}
    </div>
  );
}

const fInput = {
  width: "100%", padding: "8px 11px",
  border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 13,
  outline: "none", color: "#0f172a", background: "#f8fafc",
  boxSizing: "border-box",
};


function CandidateCard({ c, onOpen, onDelete }) {
  const initial = (c.FULL_NAME || "?").charAt(0).toUpperCase();
  return (
    <div onClick={onOpen} style={{
      background: "white", border: "1px solid #e2e8f0", borderRadius: 14,
      padding: 14, cursor: "pointer",
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 18, fontWeight: 800,
          flexShrink: 0,
        }}>
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            {c.CANDIDATE_CODE}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {c.FULL_NAME}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {c.HIGHEST_QUALIFICATION || "—"} · {c.TOTAL_EXPERIENCE_YEARS || 0} yr exp
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}
             onClick={(e) => e.stopPropagation()}>
          <Pill status={c.STATUS} />
          {onDelete && (
            <button onClick={onDelete} style={rowDeleteBtn}>Delete</button>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
        {c.EMAIL && <div>✉ {c.EMAIL}</div>}
        {c.PHONE && <div>☎ {c.PHONE}</div>}
        {c.LOCATION && <div>📍 {c.LOCATION}</div>}
      </div>
      {c.SKILLS && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#475569" }}>
          <b>Skills:</b> {c.SKILLS.split(",").slice(0, 5).map(s => s.trim()).filter(Boolean).join(", ")}
          {c.SKILLS.split(",").length > 5 ? "…" : ""}
        </div>
      )}
    </div>
  );
}


function CandidateDrawer({ candidate, onClose, onChange }) {
  const [c, setC] = useState(candidate);
  const [jobs, setJobs] = useState([]);
  const [applying, setApplying] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");

  useEffect(() => {
    API.get(`/recruitment/candidates/${candidate.ID}`).then((r) => setC(r.data));
    API.get("/recruitment/jobs?status=OPEN").then((r) => setJobs(r.data || []));
  }, [candidate.ID]);

  const parsed = c.parsed || {};

  const apply = async () => {
    if (!selectedJobId) return;
    setApplying(true);
    try {
      await API.post("/recruitment/applications", {
        CANDIDATE_ID: c.ID,
        JOB_ID: Number(selectedJobId),
      });
      onChange?.();
      onClose();
    } finally { setApplying(false); }
  };

  return (
    <Drawer onClose={onClose} width={720}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            {c.CANDIDATE_CODE}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{c.FULL_NAME}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {[c.HIGHEST_QUALIFICATION, `${c.TOTAL_EXPERIENCE_YEARS || 0} yr exp`, c.LOCATION].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Pill status={c.STATUS} />
      </div>

      {c.RESUME_URL && (
        <div style={{ marginTop: 10 }}>
          <a href={`${BACKEND_URL}${c.RESUME_URL}`} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: BVC_DARK, fontWeight: 700 }}>
            ↗ Open original resume
          </a>
        </div>
      )}

      <SectionTitle>Apply to a job</SectionTitle>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value)}
          style={{ ...input, flex: 1 }}
        >
          <option value="">Pick a job…</option>
          {jobs.map((j) => (
            <option key={j.ID} value={j.ID}>
              {j.JOB_CODE} — {j.TITLE}
            </option>
          ))}
        </select>
        <button onClick={apply} disabled={!selectedJobId || applying} style={btnPrimary}>
          {applying ? "Applying & screening..." : "Apply + Auto-screen"}
        </button>
      </div>

      <SectionTitle>Contact</SectionTitle>
      <FieldRow label="Email" value={c.EMAIL} />
      <FieldRow label="Phone" value={c.PHONE} />
      <FieldRow label="Location" value={c.LOCATION} />
      <FieldRow label="LinkedIn" value={parsed.linkedin} />

      <SectionTitle>Skills ({(parsed.skills || []).length})</SectionTitle>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(parsed.skills || []).map((s) => (
          <span key={s} style={{
            fontSize: 11, padding: "3px 10px", background: "#f1f5f9",
            color: "#0f172a", borderRadius: 999, fontWeight: 600,
          }}>{s}</span>
        ))}
      </div>

      {parsed.education && parsed.education.length > 0 && (
        <>
          <SectionTitle>Education</SectionTitle>
          {parsed.education.map((e, i) => (
            <FieldRow key={i} label={String(e.year || "—")} value={e.degree || e.institution || JSON.stringify(e)} />
          ))}
        </>
      )}

      {parsed.work_experience && parsed.work_experience.length > 0 && (
        <>
          <SectionTitle>Experience</SectionTitle>
          {parsed.work_experience.map((w, i) => (
            <FieldRow key={i} label={`${w.from || "?"} → ${w.to || "?"}`} value={w.role_company || `${w.role || ""} @ ${w.company || ""}`} />
          ))}
        </>
      )}

      {parsed.certifications && parsed.certifications.length > 0 && (
        <>
          <SectionTitle>Certifications</SectionTitle>
          <ul style={{ fontSize: 12, color: "#475569", paddingLeft: 18, margin: "4px 0" }}>
            {parsed.certifications.map((cert, i) => <li key={i}>{cert}</li>)}
          </ul>
        </>
      )}

      {parsed.languages && parsed.languages.length > 0 && (
        <>
          <SectionTitle>Languages</SectionTitle>
          <div>{parsed.languages.join(", ")}</div>
        </>
      )}
    </Drawer>
  );
}


// =====================================================================
// PIPELINE TAB
// =====================================================================

function PipelineTab() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schedFor, setSchedFor] = useState(null);   // application row for "Schedule"
  const [offerFor, setOfferFor] = useState(null);   // application row for "Generate offer"
  const [summary, setSummary] = useState(null);   // application row for "View summary"

  const load = () => {
    setLoading(true);
    API.get("/recruitment/applications")
      .then((r) => setApps(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const rescreen = async (id) => {
    await API.post(`/recruitment/applications/${id}/re-screen`);
    load();
  };

  const remove = async (a) => {
    if (!window.confirm(
      `Delete this application?\n\n` +
      `${a.CANDIDATE_NAME} for ${a.JOB_TITLE}\n\n` +
      `Any scheduled interviews and generated offers for this pairing ` +
      `will also be removed. The candidate and job stay in place.`
    )) return;
    try {
      await API.delete(`/recruitment/applications/${a.ID}`);
      load();
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Delete failed");
    }
  };

  if (loading) return <Spinner />;
  if (apps.length === 0)
    return <EmptyState text="No applications yet. Pick a candidate in the Candidates tab and apply them to a job." />;

  return (
    <div style={{
      background: "white", borderRadius: 12, overflow: "hidden",
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)"
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={th}>
            <th style={cell}>Candidate</th>
            <th style={cell}>Job</th>
            <th style={cell}>Screening</th>
            <th style={{ ...cell, textAlign: "right" }}>Overall</th>
            <th style={{ ...cell, textAlign: "right" }}>Skill</th>
            <th style={{ ...cell, textAlign: "right" }}>Exp</th>
            <th style={{ ...cell, textAlign: "right" }}>Edu</th>
            <th style={cell}>Status</th>
            <th style={cell}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}>
                <div style={{ fontWeight: 700 }}>{a.CANDIDATE_NAME}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                  {a.CANDIDATE_CODE}
                </div>
              </td>
              <td style={cell}>
                <div style={{ fontWeight: 600 }}>{a.JOB_TITLE}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                  {a.JOB_CODE}
                </div>
              </td>
              <td style={cell}><Pill status={a.SCREENING_STATUS} /></td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 800 }}>{a.OVERALL_SCORE}</td>
              <td style={{ ...cell, textAlign: "right" }}>{a.SKILL_MATCH_PCT}</td>
              <td style={{ ...cell, textAlign: "right" }}>{a.EXPERIENCE_MATCH_PCT}</td>
              <td style={{ ...cell, textAlign: "right" }}>{a.EDUCATION_MATCH_PCT}</td>
              <td style={cell}><Pill status={a.STATUS} /></td>
              <td style={cell}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <button onClick={() => setSummary(a)} style={btnSecondary}>View</button>
                  <button onClick={() => setSchedFor(a)} style={btnSecondary}>Schedule</button>
                  <button onClick={() => setOfferFor(a)} style={btnSecondary}>Offer</button>
                  <button onClick={() => rescreen(a.ID)} style={btnSecondary}>Re-screen</button>
                  <button onClick={() => remove(a)} style={rowDeleteBtn}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {schedFor && (
        <ScheduleInterviewModal
          application={schedFor}
          onClose={() => setSchedFor(null)}
          onSaved={() => { setSchedFor(null); load(); }}
        />
      )}
      {offerFor && (
        <GenerateOfferModal
          application={offerFor}
          onClose={() => setOfferFor(null)}
          onSaved={() => { setOfferFor(null); load(); }}
        />
      )}
      {summary && (
        <ApplicationSummaryDrawer
          application={summary}
          onClose={() => setSummary(null)}
        />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// Schedule Interview modal
// ---------------------------------------------------------------------
function ScheduleInterviewModal({ application, onClose, onSaved }) {
  // Default to "tomorrow 10:00 AM"
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(10, 0, 0, 0);
  const defaultDt = tomorrow.toISOString().slice(0, 16);

  const [form, setForm] = useState({
    ROUND: 1,
    ROUND_TYPE: "SCREENING",
    SCHEDULED_AT: defaultDt,
    DURATION_MINUTES: 45,
    MODE: "ONLINE",
    MEETING_LINK: "",
    LOCATION: "",
    INTERVIEWER_NAME: "",
    INTERVIEWER_EMAIL: "",
    // Pre-fill from the candidate's stored email (Pipeline sends it
    // through on `application`); HR can override in this field.
    CANDIDATE_EMAIL: application?.CANDIDATE_EMAIL || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState([]);
  const [scheduled, setScheduled] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null); // {ok, recipient}

  const submit = async () => {
    setSaving(true); setError("");
    try {
      const payload = {
        APPLICATION_ID: application.ID,
        ROUND: Number(form.ROUND) || 1,
        ROUND_TYPE: form.ROUND_TYPE,
        SCHEDULED_AT: new Date(form.SCHEDULED_AT).toISOString(),
        DURATION_MINUTES: Number(form.DURATION_MINUTES) || 45,
        MODE: form.MODE,
        MEETING_LINK: form.MEETING_LINK || null,
        LOCATION: form.LOCATION || null,
        INTERVIEWER_NAME: form.INTERVIEWER_NAME || null,
        INTERVIEWER_EMAIL: form.INTERVIEWER_EMAIL || null,
        CANDIDATE_EMAIL: form.CANDIDATE_EMAIL || null,
      };
      const res = await API.post("/recruitment/interviews", payload);

      setEmailStatus({
        ok: !!res.data?.email_sent,
        recipient: res.data?.email_recipient || form.CANDIDATE_EMAIL || null,
      });

      // Fetch AI-suggested questions for this round based on candidate
      // skills × job requirements × round type.
      try {
        const qs = await API.post(`/recruitment/interviews/${res.data.ID}/suggest-questions`);
        setQuestions(qs.data?.questions || []);
      } catch { /* non-fatal */ }

      setScheduled(true);
      // Refresh the Pipeline list in the background; keep this drawer
      // open so HR can read the suggested questions before dismissing.
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not schedule interview");
    } finally { setSaving(false); }
  };

  const closeAndRefresh = () => {
    onSaved?.();
  };

  return (
    <Drawer onClose={onClose} width={560} title={`Schedule Interview · ${application.CANDIDATE_NAME}`}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
        For role: <b style={{ color: "#0f172a" }}>{application.JOB_TITLE}</b>
      </div>

      <Row>
        <Field label="Round #">
          <input type="number" min="1" max="10" value={form.ROUND}
            onChange={(e) => setForm({ ...form, ROUND: e.target.value })}
            style={input} />
        </Field>
        <Field label="Round type">
          <select value={form.ROUND_TYPE} onChange={(e) => setForm({ ...form, ROUND_TYPE: e.target.value })} style={input}>
            <option value="SCREENING">Screening</option>
            <option value="TECHNICAL">Technical</option>
            <option value="HR">HR</option>
            <option value="MANAGERIAL">Managerial</option>
            <option value="FINAL">Final</option>
          </select>
        </Field>
      </Row>

      <Row>
        <Field label="Date & time">
          <input type="datetime-local" value={form.SCHEDULED_AT}
            onChange={(e) => setForm({ ...form, SCHEDULED_AT: e.target.value })}
            style={input} />
        </Field>
        <Field label="Duration (min)">
          <input type="number" min="15" step="15" value={form.DURATION_MINUTES}
            onChange={(e) => setForm({ ...form, DURATION_MINUTES: e.target.value })}
            style={input} />
        </Field>
      </Row>

      <Field label="Mode">
        <select value={form.MODE} onChange={(e) => setForm({ ...form, MODE: e.target.value })} style={input}>
          <option value="ONLINE">Online (video call)</option>
          <option value="IN_PERSON">In-person</option>
          <option value="PHONE">Phone</option>
        </select>
      </Field>

      {form.MODE === "ONLINE" && (
        <Field label="Meeting link">
          <input value={form.MEETING_LINK}
            onChange={(e) => setForm({ ...form, MEETING_LINK: e.target.value })}
            placeholder="https://meet.google.com/abc-defg-hij"
            style={input} />
        </Field>
      )}

      {form.MODE === "IN_PERSON" && (
        <Field label="Location">
          <input value={form.LOCATION}
            onChange={(e) => setForm({ ...form, LOCATION: e.target.value })}
            placeholder="BVC24 office, Coimbatore — Conference Room 1"
            style={input} />
        </Field>
      )}

      <Row>
        <Field label="Interviewer name">
          <input value={form.INTERVIEWER_NAME}
            onChange={(e) => setForm({ ...form, INTERVIEWER_NAME: e.target.value })}
            style={input} />
        </Field>
        <Field label="Interviewer email">
          <input type="email" value={form.INTERVIEWER_EMAIL}
            onChange={(e) => setForm({ ...form, INTERVIEWER_EMAIL: e.target.value })}
            style={input} />
        </Field>
      </Row>

      <Field
        label="Candidate email"
        hint="A confirmation with the schedule + meeting link is sent here as soon as you click Schedule."
      >
        <input
          type="email"
          value={form.CANDIDATE_EMAIL}
          onChange={(e) => setForm({ ...form, CANDIDATE_EMAIL: e.target.value })}
          placeholder="candidate@example.com"
          style={input}
          disabled={scheduled}
        />
      </Field>

      {error && <div style={errBox}>{error}</div>}

      {scheduled && emailStatus && (
        <div style={{
          marginTop: 14, padding: "10px 14px", borderRadius: 8,
          border: `1px solid ${emailStatus.ok ? "#86efac" : "#fecaca"}`,
          background: emailStatus.ok ? "#f0fdf4" : "#fef2f2",
          color: emailStatus.ok ? "#166534" : "#b91c1c",
          fontSize: 12, fontWeight: 600,
        }}>
          {emailStatus.ok
            ? `✓ Confirmation email sent to ${emailStatus.recipient}.`
            : emailStatus.recipient
              ? `⚠ Could not send email to ${emailStatus.recipient}. Interview is scheduled — please notify the candidate manually.`
              : "⚠ No candidate email provided. Interview is scheduled but no confirmation was sent."}
        </div>
      )}

      {questions.length > 0 && (
        <div style={{ marginTop: 14, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#7A1022", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
            AI-Suggested questions
          </div>
          <ol style={{ fontSize: 12, color: "#475569", paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        {!scheduled && (
          <>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={submit} disabled={saving} style={btnPrimary}>
              {saving ? "Scheduling..." : "Schedule + Suggest questions"}
            </button>
          </>
        )}
        {scheduled && (
          <button onClick={closeAndRefresh} style={btnPrimary}>
            Done
          </button>
        )}
      </div>
    </Drawer>
  );
}


// ---------------------------------------------------------------------
// Generate Offer modal
// ---------------------------------------------------------------------
function GenerateOfferModal({ application, onClose, onSaved }) {
  // BVC24 offer letters are single-component — Basic only. The old
  // Basic / HRA / Allowances / Bonus form was replaced with one
  // Annual Salary input on 2026-09-02; it fills BOTH ctc and the
  // Basic breakdown line on the PDF.
  const [form, setForm] = useState({
    JOB_TITLE: application.JOB_TITLE || "",
    DEPARTMENT: "",
    COMPENSATION_CTC: "",
    BENEFITS: "Health insurance, paid time off, annual bonus, training budget.",
    JOINING_DATE: "",
    PROBATION_MONTHS: 6,
    NOTICE_PERIOD_DAYS: 30,
    EMPLOYMENT_TERMS: "",
    SPECIAL_CLAUSES: "",
  });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");

  const submit = async () => {
    const salary = Number(form.COMPENSATION_CTC);
    if (!salary || salary <= 0) {
      setError("Annual salary is required and must be greater than zero.");
      return;
    }
    if (salary < 1000) {
      setError("Enter the full annual salary in rupees (e.g. 350000), not in lakhs.");
      return;
    }
    setSaving(true); setError("");
    try {
      const payload = {
        APPLICATION_ID: application.ID,
        JOB_TITLE: form.JOB_TITLE,
        DEPARTMENT: form.DEPARTMENT || null,
        COMPENSATION_CTC: salary,
        // Single-line breakdown — only Basic. Keeps the PDF's
        // "Annual Compensation" table clean.
        COMPENSATION_BREAKDOWN: { basic: salary },
        BENEFITS: form.BENEFITS || null,
        JOINING_DATE: form.JOINING_DATE || null,
        PROBATION_MONTHS: Number(form.PROBATION_MONTHS) || 6,
        NOTICE_PERIOD_DAYS: Number(form.NOTICE_PERIOD_DAYS) || 30,
        EMPLOYMENT_TERMS: form.EMPLOYMENT_TERMS || null,
        SPECIAL_CLAUSES: form.SPECIAL_CLAUSES || null,
      };
      const res = await API.post("/recruitment/offers", payload);
      setCreated(res.data);
      onSaved?.();
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not create offer");
    } finally { setSaving(false); }
  };

  return (
    <Drawer onClose={onClose} width={620}
      title={`Generate Offer · ${application.CANDIDATE_NAME}`}>

      {!created ? (
        <>
          <Field label="Job title *">
            <input value={form.JOB_TITLE}
              onChange={(e) => setForm({ ...form, JOB_TITLE: e.target.value })}
              style={input} />
          </Field>
          <Field label="Department">
            <input value={form.DEPARTMENT}
              onChange={(e) => setForm({ ...form, DEPARTMENT: e.target.value })}
              style={input} placeholder="e.g. Engineering" />
          </Field>

          <Field
            label="Annual salary (₹) *"
            hint="Enter the full yearly amount in rupees, e.g. 350000. This appears on the offer letter as the Basic component and total CTC."
          >
            <input
              type="number"
              min="0"
              step="1"
              value={form.COMPENSATION_CTC}
              onChange={(e) => setForm({ ...form, COMPENSATION_CTC: e.target.value })}
              style={input}
              placeholder="e.g. 350000"
            />
          </Field>

          <Row>
            <Field label="Joining date">
              <input type="date" value={form.JOINING_DATE}
                onChange={(e) => setForm({ ...form, JOINING_DATE: e.target.value })}
                style={input} />
            </Field>
            <Field label="Probation (months)">
              <input type="number" min="0" max="24" value={form.PROBATION_MONTHS}
                onChange={(e) => setForm({ ...form, PROBATION_MONTHS: e.target.value })}
                style={input} />
            </Field>
          </Row>

          <Field label="Notice period (days)">
            <input type="number" min="0" max="180" value={form.NOTICE_PERIOD_DAYS}
              onChange={(e) => setForm({ ...form, NOTICE_PERIOD_DAYS: e.target.value })}
              style={input} />
          </Field>

          <Field label="Benefits">
            <textarea rows={2} value={form.BENEFITS}
              onChange={(e) => setForm({ ...form, BENEFITS: e.target.value })}
              style={{ ...input, resize: "vertical" }} />
          </Field>

          <Field label="Employment terms (optional)">
            <textarea rows={2} value={form.EMPLOYMENT_TERMS}
              onChange={(e) => setForm({ ...form, EMPLOYMENT_TERMS: e.target.value })}
              style={{ ...input, resize: "vertical" }} />
          </Field>

          <Field label="Special clauses (optional)">
            <textarea rows={2} value={form.SPECIAL_CLAUSES}
              onChange={(e) => setForm({ ...form, SPECIAL_CLAUSES: e.target.value })}
              style={{ ...input, resize: "vertical" }}
              placeholder="e.g. 90-day relocation allowance, sign-on bonus..." />
          </Field>

          {error && <div style={errBox}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={submit} disabled={saving} style={btnPrimary}>
              {saving ? "Drafting + generating PDF..." : "Generate Offer Letter"}
            </button>
          </div>
        </>
      ) : (
        <div style={{
          padding: 18, border: "1px solid #bbf7d0", background: "#f0fdf4",
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#14532d", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            Offer letter generated
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: -0.3 }}>
            {created.OFFER_NUMBER}
          </div>
          <div style={{ fontSize: 13, color: "#166534", marginTop: 4 }}>
            CTC ₹{Number(created.COMPENSATION_CTC || 0).toLocaleString("en-IN")} · status: {created.STATUS}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={async () => {
                try {
                  const res = await API.get(
                    `/recruitment/offers/${created.ID}/pdf`,
                    { responseType: "blob" }
                  );
                  const blob = new Blob([res.data], { type: "application/pdf" });
                  const url = URL.createObjectURL(blob);
                  const win = window.open(url, "_blank", "noopener,noreferrer");
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  if (!win) window.location.href = url;
                } catch (e) {
                  alert(e?.response?.data?.detail || "Failed to load PDF");
                }
              }}
              style={{
                padding: "9px 16px",
                background: BVC_RED, color: "white",
                border: "none", borderRadius: 8,
                fontWeight: 800, fontSize: 12,
                cursor: "pointer",
              }}>
              View PDF
            </button>
            <button onClick={onClose} style={btnSecondary}>Close</button>
          </div>
        </div>
      )}
    </Drawer>
  );
}


// ---------------------------------------------------------------------
// Application Summary drawer (read-only deep dive)
// ---------------------------------------------------------------------
function ApplicationSummaryDrawer({ application, onClose }) {
  return (
    <Drawer onClose={onClose} width={620}
      title={`${application.CANDIDATE_NAME} → ${application.JOB_TITLE}`}>
      <SectionTitle>Screening</SectionTitle>
      <FieldRow label="Verdict" value={application.SCREENING_STATUS?.replace(/_/g, " ")} />
      <FieldRow label="Overall score" value={application.OVERALL_SCORE} />
      <FieldRow label="Skill match %" value={application.SKILL_MATCH_PCT} />
      <FieldRow label="Experience %" value={application.EXPERIENCE_MATCH_PCT} />
      <FieldRow label="Education %" value={application.EDUCATION_MATCH_PCT} />
      <FieldRow label="Matching skills" value={application.MATCHING_SKILLS} />
      <FieldRow label="Missing skills" value={application.MISSING_SKILLS} />

      {application.SCREENING_SUMMARY && (
        <>
          <SectionTitle>AI summary</SectionTitle>
          <div style={{
            padding: 12, background: "#fef4f5",
            border: "1px solid #fecaca", borderRadius: 10,
            fontSize: 13, color: "#7A1022", lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}>
            {application.SCREENING_SUMMARY}
          </div>
        </>
      )}

      <SectionTitle>Pipeline</SectionTitle>
      <FieldRow label="Current status" value={application.STATUS?.replace(/_/g, " ")} />
      <FieldRow label="Application ID" value={`#${application.ID}`} />
      <FieldRow label="Applied" value={application.CREATED_AT?.slice(0, 10)} />
      <FieldRow label="Last screened" value={application.SCREENED_AT?.slice(0, 16)?.replace("T", " ")} />
    </Drawer>
  );
}


// =====================================================================
// INTERVIEWS TAB
// =====================================================================

function InterviewsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    API.get("/recruitment/interviews")
      .then((r) => setItems(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const fmt = (iso) => {
    try { return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };

  const remove = async (iv) => {
    if (!window.confirm(
      `Delete this interview?\n\n` +
      `${iv.CANDIDATE_NAME} — ${iv.JOB_TITLE} (Round ${iv.ROUND})`
    )) return;
    try {
      await API.delete(`/recruitment/interviews/${iv.ID}`);
      load();
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Delete failed");
    }
  };

  // Outcome dropdown — HR marks each interview after it happens.
  // Waitlisted keeps the candidate warm for a later round; Selected
  // signals the Pipeline can move to Offer; Rejected closes the loop.
  // The backend already accepts arbitrary STATUS strings on
  // PATCH /interviews/{id}; no schema change needed.
  const OUTCOME_OPTIONS = ["SCHEDULED", "WAITLISTED", "SELECTED", "REJECTED"];
  const updateStatus = async (iv, next) => {
    if ((iv.STATUS || "").toUpperCase() === next) return;
    try {
      await API.patch(`/recruitment/interviews/${iv.ID}`, { STATUS: next });
      load();
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Status update failed");
    }
  };

  if (loading) return <Spinner />;
  if (items.length === 0)
    return <EmptyState text="No interviews scheduled yet. Go to Pipeline → pick an application → schedule an interview." />;

  return (
    <div style={{
      background: "white", borderRadius: 12, overflow: "hidden",
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)"
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={th}>
            <th style={cell}>When</th>
            <th style={cell}>Candidate</th>
            <th style={cell}>Job</th>
            <th style={cell}>Round</th>
            <th style={cell}>Mode</th>
            <th style={cell}>Status</th>
            <th style={cell}>Score</th>
            <th style={cell}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}>{fmt(i.SCHEDULED_AT)}</td>
              <td style={cell}>{i.CANDIDATE_NAME}</td>
              <td style={cell}>{i.JOB_TITLE}</td>
              <td style={cell}>R{i.ROUND} · {i.ROUND_TYPE || "—"}</td>
              <td style={cell}>{i.MODE}</td>
              <td style={cell}>
                <select
                  value={(i.STATUS || "SCHEDULED").toUpperCase()}
                  onChange={(e) => updateStatus(i, e.target.value)}
                  title="Set the interview outcome"
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "white",
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      (i.STATUS || "").toUpperCase() === "SELECTED"    ? "#047857" :
                      (i.STATUS || "").toUpperCase() === "REJECTED"    ? "#b91c1c" :
                      (i.STATUS || "").toUpperCase() === "WAITLISTED"  ? "#b45309" :
                      "#334155",
                    cursor: "pointer",
                    outline: "none",
                  }}
                >
                  {OUTCOME_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </td>
              <td style={cell}>{i.SCORE != null ? i.SCORE : "—"}</td>
              <td style={cell}>
                <button onClick={() => remove(i)} style={rowDeleteBtn}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// =====================================================================
// OFFERS TAB
// =====================================================================

function OffersTab() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingFor, setSendingFor] = useState(null);   // offer being sent
  const [busyId, setBusyId] = useState(null);           // id with in-flight action
  const [toast, setToast] = useState("");

  const load = () => {
    setLoading(true);
    API.get("/recruitment/offers")
      .then((r) => setOffers(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const showToast = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 4500);
  };

  const markStatus = async (o, status) => {
    if (!window.confirm(`Mark offer ${o.OFFER_NUMBER} as ${status}?`)) return;
    setBusyId(o.ID);
    try {
      await API.patch(`/recruitment/offers/${o.ID}/status`, { STATUS: status });
      showToast(`Marked ${o.OFFER_NUMBER} as ${status}`);
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to update status");
    } finally { setBusyId(null); }
  };

  const regeneratePdf = async (o) => {
    setBusyId(o.ID);
    try {
      await API.post(`/recruitment/offers/${o.ID}/regenerate-pdf`);
      showToast(`${o.OFFER_NUMBER} regenerated with current branding`);
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to regenerate");
    } finally { setBusyId(null); }
  };

  const remove = async (o) => {
    if (!window.confirm(
      `Delete offer ${o.OFFER_NUMBER}?\n\n` +
      `${o.CANDIDATE_NAME || "—"} for ${o.JOB_TITLE || "—"}`
    )) return;
    setBusyId(o.ID);
    try {
      await API.delete(`/recruitment/offers/${o.ID}`);
      showToast(`Deleted ${o.OFFER_NUMBER}`);
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to delete");
    } finally { setBusyId(null); }
  };

  // Fetch the offer PDF via the API service (which sends the auth
  // token), then open the resulting blob in a new tab. Opening the
  // /pdf URL directly via <a href> doesn't work because the browser
  // strips the Authorization header on a new-tab navigation → the
  // backend returns 401 Not authenticated.
  const viewOfferPdf = async (offerId) => {
    try {
      const res = await API.get(
        `/recruitment/offers/${offerId}/pdf`,
        { responseType: "blob" }
      );
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener,noreferrer");
      // Revoke after the tab has had time to load — keeps memory clean.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!win) {
        // popup blocked — fall back to same-tab navigation
        window.location.href = url;
      }
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to load PDF");
    }
  };

  if (loading) return <Spinner />;
  if (offers.length === 0)
    return <EmptyState text="No offers drafted yet. Go to Pipeline → 'Offer' button on any application to generate an offer letter." />;

  return (
    <>
      <div style={{
        background: "white", borderRadius: 12, overflow: "hidden",
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)"
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={th}>
              <th style={cell}>Offer</th>
              <th style={cell}>Candidate</th>
              <th style={cell}>Job</th>
              <th style={{ ...cell, textAlign: "right" }}>CTC</th>
              <th style={cell}>Status</th>
              <th style={cell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => {
              const inr = `₹${Number(o.COMPENSATION_CTC || 0).toLocaleString("en-IN")}`;
              const busy = busyId === o.ID;
              return (
                <tr key={o.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={cell}>
                    <div style={{ fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                      {o.OFFER_NUMBER}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {o.CREATED_AT?.slice(0, 10)}
                    </div>
                  </td>
                  <td style={cell}>
                    <div style={{ fontWeight: 700 }}>{o.CANDIDATE_NAME || "—"}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {o.CANDIDATE_EMAIL || "no email on file"}
                    </div>
                  </td>
                  <td style={cell}>{o.JOB_TITLE}</td>
                  <td style={{ ...cell, textAlign: "right", fontWeight: 800 }}>{inr}</td>
                  <td style={cell}><Pill status={o.STATUS} /></td>
                  <td style={cell}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button
                        onClick={() => viewOfferPdf(o.ID)}
                        style={btnSecondary}
                      >
                        View PDF
                      </button>
                      <button
                        onClick={() => regeneratePdf(o)}
                        disabled={busy}
                        title="Re-render the letter with the latest company logo / address"
                        style={btnSecondary}
                      >
                        Regenerate
                      </button>
                      {o.STATUS !== "ACCEPTED" && o.STATUS !== "REJECTED" && (
                        <button
                          onClick={() => setSendingFor(o)}
                          disabled={busy || !o.CANDIDATE_EMAIL}
                          title={o.CANDIDATE_EMAIL
                            ? (o.STATUS === "SENT"
                                ? "Re-send the offer letter to the candidate"
                                : "Email this offer letter to the candidate")
                            : "Candidate has no email on file"}
                          style={{
                            ...btnPrimary,
                            opacity: !o.CANDIDATE_EMAIL ? 0.4 : 1,
                            cursor: !o.CANDIDATE_EMAIL ? "not-allowed" : "pointer",
                          }}
                        >
                          {o.STATUS === "SENT" ? "Re-send" : "Send"}
                        </button>
                      )}
                      {o.STATUS === "SENT" && (
                        <>
                          <button
                            onClick={() => markStatus(o, "ACCEPTED")}
                            disabled={busy}
                            style={{ ...btnSecondary, color: "#166534" }}
                            title="Manually mark this offer as accepted"
                          >
                            Accepted
                          </button>
                          <button
                            onClick={() => markStatus(o, "REJECTED")}
                            disabled={busy}
                            style={{ ...btnSecondary, color: "#b91c1c" }}
                            title="Manually mark this offer as rejected"
                          >
                            Rejected
                          </button>
                        </>
                      )}

                      {/* Response badge — the candidate clicked
                          Accept / Reject in their email, no admin
                          action needed. Shows inline in the Actions
                          column so HR sees the outcome without
                          scanning the Status column separately. */}
                      {o.STATUS === "ACCEPTED" && (
                        <span
                          title={o.RESPONDED_AT
                            ? `Accepted on ${new Date(o.RESPONDED_AT).toLocaleString()}`
                            : "Candidate accepted this offer"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 12px",
                            background: "#dcfce7",
                            color: "#166534",
                            border: "1px solid #86efac",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: 0.2,
                          }}
                        >
                          ✓ Accepted
                        </span>
                      )}
                      {o.STATUS === "REJECTED" && (
                        <span
                          title={o.RESPONDED_AT
                            ? `Rejected on ${new Date(o.RESPONDED_AT).toLocaleString()}`
                            : "Candidate declined this offer"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 12px",
                            background: "#fef2f2",
                            color: "#b91c1c",
                            border: "1px solid #fecaca",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: 0.2,
                          }}
                        >
                          ✗ Rejected
                        </span>
                      )}
                      <button
                        onClick={() => remove(o)}
                        disabled={busy}
                        style={rowDeleteBtn}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sendingFor && (
        <SendOfferModal
          offer={sendingFor}
          onClose={() => setSendingFor(null)}
          onSent={(msg) => {
            setSendingFor(null);
            showToast(msg || "Offer sent");
            load();
          }}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", right: 24, bottom: 24,
          background: "#0f172a", color: "white",
          padding: "12px 18px", borderRadius: 10,
          fontSize: 13, fontWeight: 700, zIndex: 1100,
          boxShadow: "0 12px 36px rgba(0,0,0,0.30)",
        }}>
          {toast}
        </div>
      )}
    </>
  );
}


// ---------------------------------------------------------------------
// Send Offer modal — confirms before sending, allows overriding the
// recipient & adding CC's.
// ---------------------------------------------------------------------
function SendOfferModal({ offer, onClose, onSent }) {
  const [to, setTo] = useState(offer.CANDIDATE_EMAIL || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    `Offer of Employment — ${offer.JOB_TITLE}`
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!to.trim()) {
      setError("Recipient email is required.");
      return;
    }
    setBusy(true); setError("");
    try {
      const payload = {
        TO_EMAIL: to.trim(),
        SUBJECT: subject.trim() || null,
      };
      if (cc.trim()) {
        payload.CC_EMAILS = cc.split(",").map(s => s.trim()).filter(Boolean);
      }
      const res = await API.post(
        `/recruitment/offers/${offer.ID}/send`, payload
      );
      onSent?.(res.data?.message || "Offer emailed to candidate");
    } catch (e) {
      setError(e?.response?.data?.detail || "Send failed");
    } finally { setBusy(false); }
  };

  return (
    <Drawer onClose={onClose} width={560}
      title={`Send offer · ${offer.OFFER_NUMBER}`}>
      <div style={{
        padding: 12, background: "#f8fafc",
        border: "1px solid #e2e8f0", borderRadius: 10,
        fontSize: 12, color: "#475569", marginBottom: 14,
      }}>
        The offer letter PDF will be attached and emailed via the BVC24
        Resend account. The offer status will flip to <b>SENT</b> on success.
      </div>

      <Field label="To (candidate email) *">
        <input value={to} onChange={(e) => setTo(e.target.value)}
          type="email" style={input}
          placeholder="candidate@example.com" />
      </Field>

      <Field label="CC (comma-separated, optional)">
        <input value={cc} onChange={(e) => setCc(e.target.value)}
          style={input}
          placeholder="(leave empty while in Resend sandbox mode)" />
      </Field>

      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)}
          style={input} />
      </Field>

      <div style={{
        marginTop: 10, padding: 10,
        background: "#fff7ed", border: "1px solid #fed7aa",
        borderRadius: 8, fontSize: 11, color: "#7c2d12", lineHeight: 1.5,
      }}>
        <b>Note:</b> while your Resend domain is unverified, the email
        will be auto-redirected to your sandbox inbox
        (<code>EMAIL_TESTING_OVERRIDE_TO</code> in <code>.env</code>) with a
        banner showing who it was meant for. Once you verify
        <code> bvc24.com</code> at resend.com/domains it'll deliver to the
        candidate directly.
      </div>

      {error && <div style={errBox}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={send} disabled={busy} style={btnPrimary}>
          {busy ? "Sending…" : "Send offer letter"}
        </button>
      </div>
    </Drawer>
  );
}


// =====================================================================
// SHARED UI HELPERS
// =====================================================================

const btnPrimary = {
  padding: "10px 18px", background: BVC_RED, color: "white",
  border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13,
  cursor: "pointer", letterSpacing: 0.2,
};
const btnSecondary = {
  padding: "8px 14px", background: "white", color: "#475569",
  border: "1px solid #cbd5e1", borderRadius: 8, fontWeight: 700,
  fontSize: 12, cursor: "pointer",
};

// Compact "Delete" button used in every recruitment tab (Jobs cards,
// Candidates cards, Pipeline rows, Interviews rows, Offers rows).
const rowDeleteBtn = {
  padding: "4px 10px", background: "white", color: "#b91c1c",
  border: "1px solid #fecaca", borderRadius: 6, fontWeight: 600,
  fontSize: 11, cursor: "pointer", letterSpacing: 0.2,
};

const input = {
  width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1",
  borderRadius: 8, fontSize: 13, fontFamily: "inherit",
  background: "white", boxSizing: "border-box",
};

const cell = {
  padding: "10px 12px", textAlign: "left", verticalAlign: "top",
};

const th = {
  background: "#f8fafc", fontSize: 10, letterSpacing: 0.8,
  color: "#64748b", textTransform: "uppercase",
};

const errBox = {
  padding: "8px 12px", background: "#fef2f2", color: "#991b1b",
  border: "1px solid #fecaca", borderRadius: 8, fontSize: 12,
  marginTop: 10,
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        fontSize: 10, fontWeight: 800, color: "#64748b",
        letterSpacing: 1, textTransform: "uppercase", marginBottom: 4,
        display: "block",
      }}>{label}</label>
      {children}
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {children}
    </div>
  );
}

function FieldRow({ label, value }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "150px 1fr",
      padding: "8px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13,
    }}>
      <div style={{ color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ color: "#0f172a", wordBreak: "break-word" }}>
        {value || <span style={{ color: "#cbd5e1" }}>—</span>}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color: "#0f172a",
      letterSpacing: 1.4, textTransform: "uppercase",
      marginTop: 18, marginBottom: 8, paddingBottom: 6,
      borderBottom: `2px solid ${BVC_RED}`, width: "fit-content",
    }}>{children}</div>
  );
}

function Spinner() {
  return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>Loading…</div>;
}

function EmptyState({ text, small }) {
  return (
    <div style={{
      padding: small ? 20 : 50, textAlign: "center",
      color: "#64748b", background: "#f8fafc",
      border: "1px dashed #cbd5e1", borderRadius: 14,
      fontSize: 13,
    }}>
      {text}
    </div>
  );
}

function Drawer({ children, onClose, width = 600, title }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(15,23,42,0.55)", zIndex: 1000,
      display: "flex", justifyContent: "flex-end",
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width, maxWidth: "94%", background: "white",
        overflow: "auto", padding: 22,
        boxShadow: "-20px 0 50px rgba(0,0,0,0.3)",
      }}>
        {title && (
          <div style={{
            fontSize: 18, fontWeight: 800, color: "#0f172a",
            marginBottom: 14, paddingBottom: 10,
            borderBottom: "1px solid #e2e8f0",
          }}>
            {title}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
