// =====================================================================
// HrAutomation — Phase 1 surface for the two AI modules.
//
//   Tab 1: Attendance Alerts (late patterns, absenteeism, OT abuse)
//   Tab 2: Leave Decisions   (auto-approve queue + manager recommendations)
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import API from "../services/api";

const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BORDER   = "#e2e8f0";
const TEXT     = "#0f172a";
const MUTED    = "#64748b";

const SEV_COLOR = {
  CRITICAL: "#dc2626",
  WARNING:  "#d97706",
  INFO:     "#0284c7",
};

const VERDICT_COLOR = {
  AUTO_APPROVE:      "#16a34a",
  RECOMMEND_APPROVE: "#0891b2",
  NEEDS_HUMAN:       "#d97706",
  RECOMMEND_REJECT:  "#dc2626",
};


export default function HrAutomation() {

  const [tab, setTab] = useState("attendance");

  return (
    <div style={{ padding: 18, color: TEXT }}>

      <PageHero />

      <div style={{
        background: "white", border: `1px solid ${BORDER}`, borderRadius: 12,
        padding: 6, marginTop: 14, marginBottom: 14, display: "flex", gap: 4,
        overflowX: "auto",
      }}>
        {[
          { key: "attendance", label: "Attendance Alerts" },
          { key: "leave",      label: "Leave Decisions" },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: "12px 22px", borderRadius: 8, border: "none",
              background: t.key === tab ? BVC_RED : "transparent",
              color: t.key === tab ? "white" : MUTED,
              fontSize: 14, fontWeight: 700, letterSpacing: 0.6,
              textTransform: "uppercase", cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === "attendance" && <AttendancePanel />}
      {tab === "leave"      && <LeavePanel />}
    </div>
  );
}


// =====================================================================
// Attendance Panel
// =====================================================================

function AttendancePanel() {
  const [alerts, setAlerts]     = useState([]);
  const [atRisk, setAtRisk]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [filter, setFilter]     = useState("OPEN");
  const [lastScan, setLastScan] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        API.get("/attendance-ai/alerts", { params: { status: filter } }),
        API.get("/attendance-ai/at-risk", { params: { limit: 10 } }),
      ]);
      setAlerts(a.data || []);
      setAtRisk(r.data || []);
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to load alerts");
    } finally { setLoading(false); }
  }, [filter]);

  const runScan = async () => {
    setBusy(true);
    try {
      const { data } = await API.post("/attendance-ai/scan");
      setLastScan(data);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Scan failed");
    } finally { setBusy(false); }
  };

  const acknowledge = async (id) => {
    try {
      await API.post(`/attendance-ai/alerts/${id}/acknowledge`);
      await load();
    } catch (e) { alert(e?.response?.data?.detail || "Failed"); }
  };

  const dismiss = async (id) => {
    if (!window.confirm("Dismiss this alert?")) return;
    try {
      await API.post(`/attendance-ai/alerts/${id}/dismiss`);
      await load();
    } catch (e) { alert(e?.response?.data?.detail || "Failed"); }
  };

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 10, marginBottom: 14 }}>
        <Tile label="Open alerts"   value={alerts.filter((a) => a.status === "OPEN").length}
              accent={BVC_RED} />
        <Tile label="Critical"      value={alerts.filter((a) => a.severity === "CRITICAL").length}
              accent={SEV_COLOR.CRITICAL} />
        <Tile label="At-risk staff" value={atRisk.length}
              accent={SEV_COLOR.WARNING} />
        <Tile label="Last scan"
              value={lastScan ? `${lastScan.scanned_employees} scanned` : "—"}
              accent={MUTED} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={runScan} disabled={busy}
          style={btnPrimary(busy)}>
          {busy ? "Scanning…" : "▶ Run scan now"}
        </button>
        {["OPEN", "ACKNOWLEDGED", "DISMISSED", "ALL"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{
              padding: "10px 16px", border: `1px solid ${filter === s ? BVC_RED : BORDER}`,
              background: filter === s ? "#fef2f4" : "white",
              color: filter === s ? BVC_DARK : MUTED,
              borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              letterSpacing: 0.5, textTransform: "uppercase",
            }}>{s}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14,
                    alignItems: "flex-start" }}>

        <div style={{ background: "white", border: `1px solid ${BORDER}`,
                      borderRadius: 12, padding: 8 }}>
          <SectionHeader title={`Alerts (${alerts.length})`} />
          {loading && <Empty msg="Loading…" />}
          {!loading && alerts.length === 0 && (
            <Empty msg="No alerts. Click 'Run scan now' to evaluate the last 30 days." />
          )}
          {alerts.map((a) => (
            <AlertCard key={a.id} alert={a}
              onAck={() => acknowledge(a.id)}
              onDismiss={() => dismiss(a.id)} />
          ))}
        </div>

        <div style={{ background: "white", border: `1px solid ${BORDER}`,
                      borderRadius: 12, padding: 12 }}>
          <SectionHeader title="Top at-risk employees" />
          {atRisk.length === 0 && <Empty msg="Everyone looks good." />}
          {atRisk.map((p) => (
            <div key={p.employee_id} style={{
              padding: "12px 0", borderBottom: "1px solid #f1f5f9",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                            alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p.employee_name}</div>
                  <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
                    {p.employee_code} · Late {p.late_count} · Absent {p.absent_count}
                  </div>
                </div>
                <span style={{
                  fontSize: 14, fontWeight: 800, padding: "4px 12px", borderRadius: 999,
                  background: riskBg(p.risk_score), color: riskFg(p.risk_score),
                }}>{Math.round(p.risk_score)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}


function AlertCard({ alert, onAck, onDismiss }) {
  const sev = SEV_COLOR[alert.severity] || MUTED;
  return (
    <div style={{
      padding: "14px 18px", borderLeft: `4px solid ${sev}`,
      borderBottom: "1px solid #f8fafc", marginBottom: 2,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          fontSize: 16, fontWeight: 800, color: TEXT, minWidth: 0,
        }}>{alert.title}</div>
        <span style={{
          fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999,
          background: sev + "1a", color: sev, flexShrink: 0,
        }}>{alert.severity}</span>
      </div>
      {alert.detail && (
        <div style={{ fontSize: 14, color: MUTED, marginBottom: 10, lineHeight: 1.55 }}>
          {alert.detail}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: MUTED, padding: "3px 8px",
                       background: "#f1f5f9", borderRadius: 6 }}>
          {alert.alert_key} · {alert.alert_date}
        </span>
        {alert.status === "OPEN" && (
          <>
            <button onClick={onAck} style={btnPill("#16a34a")}>Acknowledge</button>
            <button onClick={onDismiss} style={btnPill("#64748b", true)}>Dismiss</button>
          </>
        )}
        {alert.status !== "OPEN" && (
          <span style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>
            {alert.status}
          </span>
        )}
      </div>
    </div>
  );
}


// =====================================================================
// Leave Panel
// =====================================================================

function LeavePanel() {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/leave-ai/recommendations");
      setRows(data || []);
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to load leave queue");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const bulkApprove = async () => {
    if (!window.confirm(
      "Sweep all pending requests and auto-approve everything the AI marks as safe?"
    )) return;
    setBulkBusy(true);
    try {
      const { data } = await API.post("/leave-ai/bulk-auto-approve");
      alert(
        `Done. Auto-approved: ${data.auto_approved}, ` +
        `Flagged for human: ${data.flagged_for_human}, ` +
        `Untouched: ${data.untouched}`
      );
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Bulk approve failed");
    } finally { setBulkBusy(false); }
  };

  const applyOne = async (req) => {
    try {
      await API.post(`/leave-ai/evaluate/${req.leave_request_id}?apply=true`);
      await load();
    } catch (e) { alert(e?.response?.data?.detail || "Failed"); }
  };

  const counts = {
    auto:    rows.filter((r) => r.decision.verdict === "AUTO_APPROVE").length,
    suggest: rows.filter((r) => r.decision.verdict === "RECOMMEND_APPROVE").length,
    human:   rows.filter((r) => r.decision.verdict === "NEEDS_HUMAN").length,
    reject:  rows.filter((r) => r.decision.verdict === "RECOMMEND_REJECT").length,
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 10, marginBottom: 14 }}>
        <Tile label="Auto-approve eligible" value={counts.auto}
              accent={VERDICT_COLOR.AUTO_APPROVE} />
        <Tile label="Recommend approve"     value={counts.suggest}
              accent={VERDICT_COLOR.RECOMMEND_APPROVE} />
        <Tile label="Needs human review"    value={counts.human}
              accent={VERDICT_COLOR.NEEDS_HUMAN} />
        <Tile label="Recommend reject"      value={counts.reject}
              accent={VERDICT_COLOR.RECOMMEND_REJECT} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={bulkApprove} disabled={bulkBusy}
          style={btnPrimary(bulkBusy)}>
          {bulkBusy ? "Sweeping…" : "⚡ Sweep & auto-approve safe ones"}
        </button>
        <button onClick={load} style={btnSecondary}>Refresh</button>
      </div>

      <div style={{ background: "white", border: `1px solid ${BORDER}`,
                    borderRadius: 12, padding: 8 }}>
        <SectionHeader title={`Pending leave requests (${rows.length})`} />
        {loading && <Empty msg="Loading…" />}
        {!loading && rows.length === 0 && (
          <Empty msg="No pending requests in the queue." />
        )}
        {rows.map((r) => (
          <LeaveRequestRow key={r.leave_request_id} row={r}
            onApply={() => applyOne(r)} />
        ))}
      </div>
    </>
  );
}


function LeaveRequestRow({ row, onApply }) {
  const v = row.decision.verdict;
  const color = VERDICT_COLOR[v] || MUTED;
  return (
    <div style={{
      padding: "16px 18px", borderBottom: "1px solid #f8fafc",
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {row.employee_name}
            <span style={{ fontSize: 14, color: MUTED, fontWeight: 600 }}>
              {" · "}{row.leave_type || "—"} · {row.days} day(s)
            </span>
          </div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>
            {row.start_date} → {row.end_date}
            {row.reason && <> · "{row.reason}"</>}
          </div>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 800, padding: "5px 12px", borderRadius: 999,
          background: color + "1a", color, flexShrink: 0,
        }}>{v.replace("_", " ")}</span>
      </div>

      <div style={{ fontSize: 14, color: TEXT, marginBottom: 10,
                    background: "#fafbfc", padding: "10px 14px",
                    borderRadius: 8, lineHeight: 1.55 }}>
        {row.decision.reason_summary}
        {row.decision.blockers.length > 0 && (
          <ul style={{ margin: "8px 0 0 22px", color: "#dc2626", lineHeight: 1.55 }}>
            {row.decision.blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
        {row.decision.warnings.length > 0 && (
          <ul style={{ margin: "8px 0 0 22px", color: "#d97706", lineHeight: 1.55 }}>
            {row.decision.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, color: MUTED,
                    flexWrap: "wrap", marginBottom: 10 }}>
        <Sig k="Balance" v={row.decision.signals.balance_available?.toFixed?.(1) ?? "—"} />
        <Sig k="Team OnLeave" v={`${row.decision.signals.team_on_leave_same_day || 0}/${row.decision.signals.team_size || 0}`} />
        <Sig k="CL used" v={(row.decision.signals.cl_used_this_month ?? 0).toFixed(1)} />
        <Sig k="Pending tasks" v={row.decision.signals.pending_tasks ?? 0} />
        <Sig k="Confidence" v={`${Math.round((row.decision.confidence || 0) * 100)}%`} />
      </div>

      {v === "AUTO_APPROVE" && (
        <button onClick={onApply} style={btnPill("#16a34a")}>
          Apply auto-approve
        </button>
      )}
    </div>
  );
}


// =====================================================================
// Atoms
// =====================================================================

function PageHero() {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${BVC_RED} 0%, ${BVC_DARK} 100%)`,
      color: "white", padding: "20px 24px", borderRadius: 14,
      boxShadow: "0 4px 14px rgba(139,11,31,0.18)",
    }}>
      <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
        HR · AUTOMATION
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
        Smart HR — Attendance & Leave
      </div>
      <div style={{ fontSize: 15, marginTop: 6, opacity: 0.9 }}>
        Automated alerts · Pattern detection · Auto-approval · Manager recommendations
      </div>
    </div>
  );
}

function Tile({ label, value, accent }) {
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 10, padding: "16px 18px",
    }}>
      <div style={{ fontSize: 12, letterSpacing: 1.2, color: MUTED, fontWeight: 700,
                    textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: TEXT }}>
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div style={{
      padding: "10px 14px", fontSize: 13, fontWeight: 800, letterSpacing: 1,
      color: MUTED, textTransform: "uppercase",
    }}>{title}</div>
  );
}

function Sig({ k, v }) {
  return (
    <span style={{
      background: "#f1f5f9", padding: "4px 10px", borderRadius: 6,
      fontSize: 13,
    }}>
      <b style={{ color: TEXT }}>{k}:</b> {v}
    </span>
  );
}

function Empty({ msg }) {
  return (
    <div style={{ padding: 22, textAlign: "center", color: MUTED,
                  fontSize: 15, fontStyle: "italic" }}>{msg}</div>
  );
}

function riskBg(score) {
  if (score >= 60) return "#fee2e2";
  if (score >= 30) return "#fef3c7";
  return "#dcfce7";
}
function riskFg(score) {
  if (score >= 60) return "#991b1b";
  if (score >= 30) return "#92400e";
  return "#166534";
}

function btnPrimary(disabled) {
  return {
    padding: "11px 22px", background: disabled ? "#cbd5e1" : BVC_RED,
    color: "white", border: "none", borderRadius: 8,
    fontSize: 14, fontWeight: 800, letterSpacing: 0.6,
    cursor: disabled ? "default" : "pointer", textTransform: "uppercase",
  };
}
const btnSecondary = {
  padding: "11px 18px", background: "white", color: BVC_RED,
  border: `1px solid ${BVC_RED}`, borderRadius: 8,
  fontSize: 14, fontWeight: 700, cursor: "pointer",
};
function btnPill(color, ghost) {
  return {
    padding: "7px 14px",
    background: ghost ? "white" : color,
    color: ghost ? color : "white",
    border: `1px solid ${color}`,
    borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
  };
}
