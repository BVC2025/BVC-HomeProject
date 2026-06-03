import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const STATUS_THEMES = {
  DRAFT: { grad: "linear-gradient(135deg, #F4B324, #C8102E)", bg: "#fef3c7", fg: "#92400e" },
  FINALIZED: { grad: "linear-gradient(135deg, #C8102E, #8B0B1F)", bg: "#e0e7ff", fg: "#3730a3" },
  PAID: { grad: "linear-gradient(135deg, #10b981, #047857)", bg: "#d1fae5", fg: "#065f46" }
};


function inr(n) {

  const v = Number(n || 0);

  return v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}


function StatusPill({ status }) {

  const t = STATUS_THEMES[status] || STATUS_THEMES.DRAFT;

  return (

    <span style={{
      display: "inline-block",
      padding: "3px 12px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.6,
      background: t.bg,
      color: t.fg,
      textTransform: "uppercase"
    }}>
      {status}
    </span>
  );
}


// ============================================================
// Slip detail drawer
// ============================================================
function SlipDrawer({ run, slip, onClose }) {

  if (!slip) return null;

  const period = `${MONTH_NAMES[run.PAY_MONTH - 1]} ${run.PAY_YEAR}`;

  return (

    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "92%",
          background: "white",
          padding: 28,
          overflow: "auto",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.3)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
              Salary Slip · {period}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
              {slip.EMPLOYEE_NAME}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
              {slip.EMPLOYEE_CODE}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ border: "none", background: "#f1f5f9", padding: "4px 12px", borderRadius: 8, cursor: "pointer", fontSize: 18 }}
          >
            ×
          </button>
        </div>

        {/* Net pay headline */}
        <div style={{
          background: "linear-gradient(135deg, #10b981, #047857)",
          color: "white",
          padding: "18px 22px",
          borderRadius: 12,
          marginBottom: 18
        }}>
          <div style={{ fontSize: 11, letterSpacing: 1.4, opacity: 0.85, fontWeight: 700 }}>
            NET PAY
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>
            ₹ {inr(slip.NET_PAY)}
          </div>
        </div>

        {/* Attendance breakdown */}
        <Section title="Attendance">
          <Row label="Present" value={slip.DAYS_PRESENT} />
          <Row label="Late (subset)" value={slip.DAYS_LATE} muted />
          <Row label="Half days" value={slip.DAYS_HALF} />
          <Row label="Paid leave" value={slip.PAID_LEAVE_DAYS} />
          <Row label="Unpaid leave" value={slip.UNPAID_LEAVE_DAYS} muted />
          <Row label="Absent" value={slip.ABSENT_DAYS} muted />
          <Row label="Working days in month" value={slip.WORKING_DAYS} highlight />
        </Section>

        {/* Earnings */}
        <Section title="Earnings">
          <Row label="Base salary" value={`₹ ${inr(slip.BASE_SALARY)}`} />
          <Row label="Per-day rate" value={`₹ ${inr(slip.PER_DAY_RATE)}`} muted />
          <Row label="Earned basic" value={`₹ ${inr(slip.EARNED_BASIC)}`} />
          <Row
            label={`Task bonus (${slip.TASKS_COMPLETED} × ₹${slip.TASK_BONUS_PER_TASK})`}
            value={`₹ ${inr(slip.TASK_BONUS)}`}
          />
          <Row label="OT pay" value={`₹ ${inr(slip.OT_PAY)}`} muted />
          <Row label="Gross pay" value={`₹ ${inr(slip.GROSS_PAY)}`} highlight />
        </Section>

        {/* Deductions */}
        <Section title="Deductions">
          <Row label="Late penalty" value={`₹ ${inr(slip.LATE_PENALTY)}`} />
          <Row label="Other deductions" value={`₹ ${inr(slip.OTHER_DEDUCTIONS)}`} muted />
          <Row label="Total deductions" value={`₹ ${inr(slip.TOTAL_DEDUCTIONS)}`} highlight />
        </Section>

        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 16, lineHeight: 1.5 }}>
          Generated from your live Attendance, Leave and Task data.
          Re-run the payroll to refresh numbers (only DRAFT runs).
        </div>
      </div>
    </div>
  );
}


function Section({ title, children }) {

  return (

    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 1.2,
        color: "#64748b",
        textTransform: "uppercase",
        marginBottom: 8,
        paddingBottom: 4,
        borderBottom: "1px solid #e2e8f0"
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}


function Row({ label, value, muted, highlight }) {

  return (

    <div style={{
      display: "flex",
      justifyContent: "space-between",
      padding: "6px 0",
      fontSize: highlight ? 14 : 13,
      color: muted ? "#94a3b8" : "#0f172a",
      fontWeight: highlight ? 800 : 500,
      borderTop: highlight ? "1px solid #e2e8f0" : "none",
      marginTop: highlight ? 6 : 0,
      paddingTop: highlight ? 8 : 6
    }}>
      <span>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}


// ============================================================
// Run detail (table of slips)
// ============================================================
function RunDetail({ runId, onClose, onRefresh }) {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [slipFor, setSlipFor] = useState(null);

  const [acting, setActing] = useState(false);

  const fetchData = () => {

    setLoading(true);

    API.get(`/payroll/runs/${runId}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    fetchData();

  }, [runId]);

  const finalize = async () => {

    if (!window.confirm("Finalize this run? After that you can no longer edit slips.")) return;

    setActing(true);

    try {

      await API.patch(`/payroll/runs/${runId}/finalize`);

      fetchData();

      onRefresh?.();

    } finally {

      setActing(false);
    }
  };

  const markPaid = async () => {

    if (!window.confirm("Mark this run as PAID?")) return;

    setActing(true);

    try {

      await API.patch(`/payroll/runs/${runId}/mark-paid`);

      fetchData();

      onRefresh?.();

    } finally {

      setActing(false);
    }
  };

  const deleteRun = async () => {

    if (!window.confirm("Delete this DRAFT run? This removes all slips for it.")) return;

    setActing(true);

    try {

      await API.delete(`/payroll/runs/${runId}`);

      onClose();

      onRefresh?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Delete failed");

    } finally {

      setActing(false);
    }
  };

  const run = data?.run;

  const slips = data?.slips || [];

  if (!run && !loading) return null;

  return (

    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 950,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: 40
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96%)",
          background: "white",
          borderRadius: 18,
          padding: 28,
          maxHeight: "88vh",
          overflow: "auto",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)"
        }}
      >

        {loading && <div>Loading run…</div>}

        {!loading && run && (

          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
                  Payroll Run #{run.ID}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", marginTop: 4 }}>
                  {MONTH_NAMES[run.PAY_MONTH - 1]} {run.PAY_YEAR}
                </div>
                <div style={{ marginTop: 6 }}>
                  <StatusPill status={run.STATUS} />
                  <span style={{ marginLeft: 10, fontSize: 12, color: "#64748b" }}>
                    {run.EMPLOYEE_COUNT} employee(s) · {run.WORKING_DAYS} working days
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {run.STATUS === "DRAFT" && (
                  <>
                    <button onClick={finalize} disabled={acting} style={btnStyle("#6366f1")}>
                      🔒 Finalize
                    </button>
                    <button onClick={deleteRun} disabled={acting} style={btnStyle("#ef4444")}>
                      🗑 Delete
                    </button>
                  </>
                )}
                {run.STATUS === "FINALIZED" && (
                  <button onClick={markPaid} disabled={acting} style={btnStyle("#10b981")}>
                    💸 Mark as PAID
                  </button>
                )}
                <button onClick={onClose} style={btnStyle("#94a3b8")}>
                  Close
                </button>
              </div>
            </div>

            {/* Totals */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginBottom: 18
            }}>
              <TotalTile label="Total Gross" value={run.TOTAL_GROSS} color="#3b82f6" />
              <TotalTile label="Total Deductions" value={run.TOTAL_DEDUCTIONS} color="#ef4444" />
              <TotalTile label="Total Net" value={run.TOTAL_NET} color="#10b981" />
            </div>

            {/* Slip table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                border: "1px solid #e2e8f0"
              }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", color: "#475569", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    <th style={th()}>Employee</th>
                    <th style={th("right")}>Base Salary</th>
                    <th style={th("center")}>Present</th>
                    <th style={th("center")}>Paid Leave</th>
                    <th style={th("center")}>Absent</th>
                    <th style={th("center")}>Tasks</th>
                    <th style={th("right")}>Gross</th>
                    <th style={th("right")}>Deductions</th>
                    <th style={th("right")}>Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {slips.map((s) => (
                    <tr
                      key={s.ID}
                      onClick={() => setSlipFor(s)}
                      style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                    >
                      <td style={td()}>
                        <div style={{ fontWeight: 700 }}>{s.EMPLOYEE_NAME}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                          {s.EMPLOYEE_CODE}
                        </div>
                      </td>
                      <td style={td("right")}>₹ {inr(s.BASE_SALARY)}</td>
                      <td style={td("center")}>{s.DAYS_PRESENT}</td>
                      <td style={td("center")}>{s.PAID_LEAVE_DAYS}</td>
                      <td style={{ ...td("center"), color: s.ABSENT_DAYS > 0 ? "#b91c1c" : "#94a3b8" }}>
                        {s.ABSENT_DAYS}
                      </td>
                      <td style={td("center")}>{s.TASKS_COMPLETED}</td>
                      <td style={td("right")}>₹ {inr(s.GROSS_PAY)}</td>
                      <td style={{ ...td("right"), color: s.TOTAL_DEDUCTIONS > 0 ? "#b91c1c" : "#94a3b8" }}>
                        ₹ {inr(s.TOTAL_DEDUCTIONS)}
                      </td>
                      <td style={{ ...td("right"), fontWeight: 800, color: "#065f46" }}>
                        ₹ {inr(s.NET_PAY)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
                Click any row to see the full salary slip breakdown.
              </div>
            </div>
          </>
        )}

        {slipFor && (
          <SlipDrawer
            run={run}
            slip={slipFor}
            onClose={() => setSlipFor(null)}
          />
        )}
      </div>
    </div>
  );
}


function btnStyle(color) {

  return {
    background: color,
    color: "white",
    border: "none",
    padding: "8px 16px",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer"
  };
}


function th(align = "left") {

  return {
    padding: "10px 8px",
    textAlign: align,
    borderBottom: "1px solid #e2e8f0"
  };
}


function td(align = "left") {

  return {
    padding: "10px 8px",
    textAlign: align,
    fontFamily: align === "right" ? "ui-monospace, monospace" : "inherit"
  };
}


function TotalTile({ label, value, color }) {

  return (

    <div style={{
      background: "white",
      padding: 16,
      borderRadius: 12,
      border: `1px solid ${color}33`,
      borderTop: `3px solid ${color}`,
      boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: "#64748b", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "ui-monospace, monospace", color: "#0f172a", marginTop: 4 }}>
        ₹ {inr(value)}
      </div>
    </div>
  );
}


// ============================================================
// Main page
// ============================================================
function Payroll() {

  const today = new Date();

  const [runs, setRuns] = useState([]);

  const [loading, setLoading] = useState(true);

  const [year, setYear] = useState(today.getFullYear());

  const [month, setMonth] = useState(today.getMonth() + 1);

  const [generating, setGenerating] = useState(false);

  const [openRunId, setOpenRunId] = useState(null);

  const fetchAll = () => {

    setLoading(true);

    API.get("/payroll/runs?vendor_id=1")
      .then((r) => setRuns(r.data || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    fetchAll();

  }, []);

  const generate = async () => {

    setGenerating(true);

    try {

      const res = await API.post("/payroll/generate", {
        VENDOR_ID: 1,
        YEAR: year,
        MONTH: month,
        GENERATED_BY: localStorage.getItem("username") || "—",
        OVERWRITE: true
      });

      fetchAll();

      const runId = res.data?.run?.ID;

      if (runId) setOpenRunId(runId);

    } catch (err) {

      alert(err?.response?.data?.detail || "Generate failed");

    } finally {

      setGenerating(false);
    }
  };

  const yearOptions = useMemo(() => {

    const yr = today.getFullYear();

    return [yr - 2, yr - 1, yr, yr + 1];

  }, []);

  return (

    <div>

      {/* Hero */}
      <div style={{
        background: "linear-gradient(120deg, #1A0508 0%, #4A0E18 35%, #8B0B1F 65%, #C8102E 100%)",
        backgroundSize: "300% 300%",
        animation: "bvcGradientShift 18s ease-in-out infinite",
        color: "white",
        padding: "26px 30px",
        borderRadius: 18,
        marginBottom: 22,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap"
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.85, fontWeight: 700 }}>
            BVC24 · Payroll
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: "6px 0 6px", color: "white" }}>
            Monthly salary — attendance × leave × tasks, automatic.
          </h1>
          <div style={{ fontSize: 13, opacity: 0.9, maxWidth: 640, lineHeight: 1.5 }}>
            Pick a month, click Generate. We read every employee's
            attendance, approved leaves, and completed tasks from the
            live database, then compute net pay with the breakdown
            saved in a slip you can review later.
          </div>
        </div>
      </div>

      {/* Generator */}
      <div style={{
        background: "white",
        padding: 16,
        borderRadius: 14,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 18,
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        alignItems: "flex-end"
      }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Month
          </div>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", minWidth: 150, fontSize: 13 }}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Year
          </div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", minWidth: 100, fontSize: 13 }}
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          style={{
            background: generating ? "#cbd5e1" : "linear-gradient(135deg, #C8102E, #8B0B1F)",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: 10,
            fontWeight: 800,
            fontSize: 13,
            cursor: generating ? "default" : "pointer"
          }}
        >
          {generating ? "Generating…" : "⚡ Generate Payroll"}
        </button>
        <div style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 200 }}>
          Re-running the same month replaces the DRAFT slips with fresh numbers.
          A FINALIZED or PAID run is locked.
        </div>
      </div>

      {/* Runs list */}
      <div style={{ background: "white", padding: 18, borderRadius: 14, boxShadow: "0 4px 14px rgba(15,23,42,0.06)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 12, letterSpacing: 0.3 }}>
          Past payroll runs ({runs.length})
        </div>

        {loading && <div style={{ color: "#94a3b8" }}>Loading…</div>}

        {!loading && runs.length === 0 && (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>💸</div>
            No payroll runs yet. Pick a month above and click Generate.
          </div>
        )}

        {!loading && runs.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <th style={th()}>Period</th>
                <th style={th("center")}>Status</th>
                <th style={th("center")}>Employees</th>
                <th style={th("right")}>Gross</th>
                <th style={th("right")}>Deductions</th>
                <th style={th("right")}>Net</th>
                <th style={th("center")}>Generated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.ID}
                  style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                  onClick={() => setOpenRunId(r.ID)}
                >
                  <td style={td()}>
                    <strong>{MONTH_NAMES[r.PAY_MONTH - 1]} {r.PAY_YEAR}</strong>
                  </td>
                  <td style={td("center")}>
                    <StatusPill status={r.STATUS} />
                  </td>
                  <td style={td("center")}>{r.EMPLOYEE_COUNT}</td>
                  <td style={td("right")}>₹ {inr(r.TOTAL_GROSS)}</td>
                  <td style={td("right")}>₹ {inr(r.TOTAL_DEDUCTIONS)}</td>
                  <td style={{ ...td("right"), fontWeight: 800, color: "#065f46" }}>
                    ₹ {inr(r.TOTAL_NET)}
                  </td>
                  <td style={{ ...td("center"), fontSize: 11, color: "#94a3b8" }}>
                    {r.GENERATED_BY || "—"}
                  </td>
                  <td style={td("right")}>
                    <span style={{ color: "#6366f1", fontWeight: 700, fontSize: 11 }}>
                      View →
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Inline keyframe for the hero gradient animation */}
      <style>{`
        @keyframes bvcGradientShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {openRunId && (
        <RunDetail
          runId={openRunId}
          onClose={() => setOpenRunId(null)}
          onRefresh={fetchAll}
        />
      )}
    </div>
  );
}

export default Payroll;
