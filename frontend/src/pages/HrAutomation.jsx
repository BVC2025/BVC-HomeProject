// =====================================================================
// HR Automation — clean, action-driven dashboard.
//
// Five sections, top to bottom:
//   1. Today's Alerts         (what needs attention now)
//   2. Smart Recommendations  (AI suggestions with confidence)
//   3. Active Automation Rules (toggle switches)
//   4. Analytics & Insights   (2 charts only)
//   5. Automation History     (recent runs)
//
// Mock data is baked in so the page works end-to-end without the
// backend. When the backend endpoints respond, real data overrides
// the mocks. New HR users should understand this page in 30 seconds.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import API from "../services/api";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

// ---------------------------------------------------------------------
// BVC24 palette
// ---------------------------------------------------------------------
const BVC_RED    = "#C8102E";
const BVC_DARK   = "#7A1022";
const BVC_TEXT   = "#0f172a";
const BVC_MUTED  = "#64748b";
const BVC_LINE   = "#e2e8f0";
const BVC_BG     = "#f8fafc";
const BVC_GREEN  = "#16a34a";
const BVC_AMBER  = "#d97706";

// ---------------------------------------------------------------------
// Mock data (used when backend is silent — required by spec)
// ---------------------------------------------------------------------
const MOCK_ALERTS = {
  late_today:        { count: 3, employees: ["Ram", "Puvi", "System Administrator"] },
  pending_leave:     { count: 4 },
  low_balance:       { count: 2, employees: ["Aishwarya", "Ram"] },
  attendance_issues: { count: 2 },
};

const MOCK_RECOMMENDATIONS = [
  {
    id: 1,
    title: "Auto-approve Ram's leave on Friday",
    reason: "1-day Casual Leave, balance OK (8 left), no team conflict, no holiday clash.",
    confidence: 0.95,
    employee: "Ram (EMP101)",
    type: "LEAVE",
  },
  {
    id: 2,
    title: "Recommend reject Puvi's 3-day leave",
    reason: "Exceeds monthly CL quota (already used 2/1 this month). Team coverage thin (40% on leave that week).",
    confidence: 0.88,
    employee: "Puvi (EMP105)",
    type: "LEAVE",
  },
  {
    id: 3,
    title: "Mark Aishwarya late on June 23",
    reason: "Checked in 32 minutes after grace period. Office Wi-Fi log confirms her presence.",
    confidence: 0.82,
    employee: "Aishwarya (EMP103)",
    type: "ATTENDANCE",
  },
  {
    id: 4,
    title: "Schedule 1-on-1 with Ram",
    reason: "Late arrivals up 6× in last 30 days. Punctuality conversation recommended.",
    confidence: 0.78,
    employee: "Ram (EMP101)",
    type: "FOLLOW_UP",
  },
];

const MOCK_RULES = [
  {
    id: "auto_leave",
    name: "Auto Leave Approval",
    description: "Auto-approves single-day CL requests when balance is OK and no team conflict.",
    enabled: true,
  },
  {
    id: "attendance_reminder",
    name: "Attendance Reminder",
    description: "Sends in-app reminder to employees who haven't checked in by 9:30 AM.",
    enabled: false,
  },
  {
    id: "payroll_validation",
    name: "Payroll Validation",
    description: "Runs daily checks to flag anomalies in working days, OT and deductions before month-end.",
    enabled: true,
  },
  {
    id: "monthly_reports",
    name: "Monthly HR Reports",
    description: "Auto-generates per-employee monthly attendance + payroll report on the 1st of each month.",
    enabled: true,
  },
  {
    id: "burnout_watch",
    name: "Burnout Watch",
    description: "Flags employees with > 30 OT hours/month and < 15% leave used as 'at-risk'.",
    enabled: true,
  },
];

const MOCK_ATTENDANCE_TREND = [
  { day: "Mon", present: 5, late: 0 },
  { day: "Tue", present: 4, late: 1 },
  { day: "Wed", present: 5, late: 0 },
  { day: "Thu", present: 3, late: 2 },
  { day: "Fri", present: 4, late: 1 },
  { day: "Sat", present: 5, late: 0 },
  { day: "Sun", present: 0, late: 0 },
];

const MOCK_LEAVE_TREND = [
  { week: "W1", approved: 3, rejected: 0 },
  { week: "W2", approved: 4, rejected: 1 },
  { week: "W3", approved: 2, rejected: 0 },
  { week: "W4", approved: 5, rejected: 2 },
];

const MOCK_DEPT_ATTENDANCE = [
  { dept: "Software",   percentage: 96 },
  { dept: "Production", percentage: 88 },
  { dept: "Sales",      percentage: 92 },
  { dept: "Operations", percentage: 84 },
  { dept: "QA",         percentage: 94 },
];

const MOCK_HISTORY = [
  { id: 1, date: "2026-06-24 09:15", name: "Auto Leave Approval",
    result: "Ram's 1-day CL approved automatically",     status: "SUCCESS" },
  { id: 2, date: "2026-06-24 07:00", name: "Attendance Scan",
    result: "2 alerts created (Ram, Puvi)",              status: "SUCCESS" },
  { id: 3, date: "2026-06-23 23:59", name: "Monthly Report Generation",
    result: "Generated 5 reports for May 2026",          status: "SUCCESS" },
  { id: 4, date: "2026-06-23 09:30", name: "Attendance Reminder",
    result: "Skipped — rule is currently disabled",      status: "SKIPPED" },
  { id: 5, date: "2026-06-22 18:00", name: "Burnout Watch",
    result: "1 employee flagged: Puvi (47% score)",      status: "SUCCESS" },
  { id: 6, date: "2026-06-22 09:15", name: "Auto Leave Approval",
    result: "Failed: gemini API quota exceeded",         status: "FAILED" },
];


// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
export default function HrAutomation() {

  const nav = useNavigate();
  const [alerts, setAlerts]                 = useState(MOCK_ALERTS);
  const [recommendations, setRecs]          = useState(MOCK_RECOMMENDATIONS);
  const [rules, setRules]                   = useState(MOCK_RULES);
  const [history, setHistory]               = useState(MOCK_HISTORY);
  const [attTrend]                          = useState(MOCK_ATTENDANCE_TREND);
  const [leaveTrend]                        = useState(MOCK_LEAVE_TREND);
  const [deptAttendance]                    = useState(MOCK_DEPT_ATTENDANCE);

  // ---- Try the real backend; silently fall back to mocks ----
  const load = useCallback(async () => {
    try {
      const [aRes, rRes] = await Promise.allSettled([
        API.get("/attendance-ai/alerts", { params: { status: "OPEN" } }),
        API.get("/leave-ai/recommendations"),
      ]);

      // If attendance-AI returns rows, map to the section-1 shape
      if (aRes.status === "fulfilled" && Array.isArray(aRes.value.data) && aRes.value.data.length > 0) {
        const rows = aRes.value.data;
        const late   = rows.filter((r) => r.alert_key === "LATE_PATTERN").length;
        const absent = rows.filter((r) => r.alert_key === "ABSENT_PATTERN").length;
        setAlerts((prev) => ({
          ...prev,
          late_today:        { ...prev.late_today, count: late || prev.late_today.count },
          attendance_issues: { count: absent || prev.attendance_issues.count },
        }));
      }

      // If leave-AI returns rows, map to section-2 recommendations.
      // De-duplicate by (employee + leave_type + verdict) so the same
      // person doesn't show twice when the backend has multiple
      // auto-recorded leave rows on the same day (e.g. two PERMISSION
      // rows for one late check-in).
      if (rRes.status === "fulfilled" && Array.isArray(rRes.value.data) && rRes.value.data.length > 0) {
        const seen = new Set();
        const unique = [];
        for (const r of rRes.value.data) {
          const key = `${r.employee_id || r.employee_code}|${r.leave_type || ""}|${r.decision?.verdict || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(r);
        }
        const items = unique.slice(0, 5).map((r, i) => ({
          id: r.leave_request_id || `live-${i}`,
          title: `${r.decision?.verdict?.replace("_", " ")} — ${r.employee_name}'s ${r.leave_type || "leave"} (${r.days}d)`,
          reason: r.decision?.reason_summary || "",
          confidence: r.decision?.confidence || 0.7,
          employee: `${r.employee_name} (${r.employee_code || ""})`,
          type: "LEAVE",
          leave_request_id: r.leave_request_id,
        }));
        setRecs(items);
        setAlerts((prev) => ({
          ...prev,
          pending_leave: { count: items.length },
        }));
      }
    } catch {
      // Backend unavailable → use mock data (already set above)
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- Section 3: toggle a rule (mock + audit row in history) ----
  const toggleRule = (id) => {
    setRules((prev) => prev.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r
    ));
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      setHistory((prev) => [
        { id: Date.now(), date: stamp, name: rule.name,
          result: rule.enabled ? "Disabled by user" : "Enabled by user",
          status: "SUCCESS" },
        ...prev,
      ]);
    }
  };

  // ---- Section 2: review / approve actions ----
  const reviewRec = (rec) => {
    if (rec.type === "LEAVE" && rec.leave_request_id) {
      nav(`/leave-management?focus=${rec.leave_request_id}`);
    } else {
      alert(`Review: ${rec.title}\n\n${rec.reason}`);
    }
  };
  const approveRec = async (rec) => {
    if (rec.type === "LEAVE" && rec.leave_request_id) {
      try {
        await API.post(`/leave-ai/evaluate/${rec.leave_request_id}?apply=true`);
        setRecs((prev) => prev.filter((r) => r.id !== rec.id));
        addHistory(`Approved leave for ${rec.employee}`, "SUCCESS");
      } catch (e) {
        addHistory(`Approve failed: ${rec.title}`, "FAILED");
        alert(e?.response?.data?.detail || "Failed to apply");
      }
    } else {
      setRecs((prev) => prev.filter((r) => r.id !== rec.id));
      addHistory(`Applied: ${rec.title}`, "SUCCESS");
    }
  };
  const addHistory = (result, status) => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    setHistory((prev) => [
      { id: Date.now(), date: stamp, name: "AI Recommendation", result, status },
      ...prev,
    ]);
  };

  // ---- Section 1: card click → navigate to deep page ----
  const goLate         = () => nav("/attendance");
  const goPendingLeave = () => nav("/leave-management");
  const goLowBalance   = () => nav("/employees");
  const goAnomalies    = () => nav("/workforce-analytics");

  return (
    <div style={{ padding: 18, color: BVC_TEXT, fontSize: 14 }}>

      <Hero />

      {/* ============ Section 1: Today's Alerts ============ */}
      <SectionHeader
        kicker="Section 1"
        title="Today's Alerts"
        sub="What needs your attention right now."
      />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12, marginBottom: 26,
      }}>
        <AlertCard
          title="Late Employees Today"
          count={alerts.late_today.count}
          priority="HIGH"
          actionLabel="View Late List"
          onAction={goLate}
        />
        <AlertCard
          title="Pending Leave Approvals"
          count={alerts.pending_leave.count}
          priority="MEDIUM"
          actionLabel="Review Requests"
          onAction={goPendingLeave}
        />
        <AlertCard
          title="Low Leave Balance"
          count={alerts.low_balance.count}
          priority="LOW"
          actionLabel="View Employees"
          onAction={goLowBalance}
        />
        <AlertCard
          title="Attendance Anomalies"
          count={alerts.attendance_issues.count}
          priority="HIGH"
          actionLabel="Investigate"
          onAction={goAnomalies}
        />
      </div>

      {/* ============ Section 2: Smart Recommendations ============ */}
      <SectionHeader
        kicker="Section 2"
        title="Smart Recommendations"
        sub="AI-suggested actions with confidence and reasoning."
      />
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 12, marginBottom: 26,
      }}>
        {recommendations.length === 0 && (
          <EmptyCard msg="No pending recommendations." />
        )}
        {recommendations.map((r) => (
          <RecommendationCard
            key={r.id}
            rec={r}
            onReview={() => reviewRec(r)}
            onApprove={() => approveRec(r)}
          />
        ))}
      </div>

      {/* ============ Section 3: Active Automation Rules ============ */}
      <SectionHeader
        kicker="Section 3"
        title="Active Automation Rules"
        sub="Turn rules on or off. Each rule runs automatically in the background."
      />
      <div style={{
        background: "white", border: `1px solid ${BVC_LINE}`,
        borderRadius: 12, marginBottom: 26, overflow: "hidden",
      }}>
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onToggle={() => toggleRule(rule.id)}
            onConfigure={() => alert(`Configure: ${rule.name}\n\n${rule.description}`)}
          />
        ))}
      </div>

      {/* ============ Section 4: Analytics & Insights ============ */}
      <SectionHeader
        kicker="Section 4"
        title="Analytics & Insights"
        sub="Three quick charts for the trend at a glance."
      />
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        gap: 12, marginBottom: 26,
      }}>
        <ChartCard title="Attendance Trend — last 7 days">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={attTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: BVC_MUTED }} stroke={BVC_LINE} />
              <YAxis tick={{ fontSize: 11, fill: BVC_MUTED }} stroke={BVC_LINE} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="present" stroke={BVC_GREEN} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="late"    stroke={BVC_RED}   strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Leave Trend — last 4 weeks">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={leaveTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: BVC_MUTED }} stroke={BVC_LINE} />
              <YAxis tick={{ fontSize: 11, fill: BVC_MUTED }} stroke={BVC_LINE} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="approved" fill={BVC_GREEN} radius={[4, 4, 0, 0]} />
              <Bar dataKey="rejected" fill={BVC_RED}   radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Department Attendance %">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={deptAttendance} layout="vertical"
              margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" domain={[0, 100]}
                tick={{ fontSize: 11, fill: BVC_MUTED }} stroke={BVC_LINE} />
              <YAxis type="category" dataKey="dept" width={78}
                tick={{ fontSize: 11, fill: BVC_TEXT }} stroke={BVC_LINE} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="percentage" fill={BVC_RED} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ============ Section 5: Automation History ============ */}
      <SectionHeader
        kicker="Section 5"
        title="Automation History"
        sub="Audit log of every automation run."
      />
      <div style={{
        background: "white", border: `1px solid ${BVC_LINE}`,
        borderRadius: 12, overflow: "hidden", marginBottom: 28,
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{
            width: "100%", borderCollapse: "collapse", fontSize: 14,
            minWidth: 720,
          }}>
            <thead>
              <tr style={{ background: BVC_BG }}>
                <Th>Date</Th>
                <Th>Automation</Th>
                <Th>Result</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map((h) => (
                <tr key={h.id} style={{ borderTop: `1px solid ${BVC_LINE}` }}>
                  <Td style={{ color: BVC_MUTED, fontSize: 13, whiteSpace: "nowrap" }}>
                    {h.date}
                  </Td>
                  <Td style={{ fontWeight: 700 }}>{h.name}</Td>
                  <Td style={{ color: BVC_MUTED }}>{h.result}</Td>
                  <Td><StatusPill status={h.status} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Section atoms
// =====================================================================

function Hero() {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${BVC_RED} 0%, ${BVC_DARK} 100%)`,
      color: "white", padding: "22px 26px", borderRadius: 14,
      marginBottom: 22, boxShadow: "0 4px 14px rgba(139,11,31,0.18)",
    }}>
      <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
        HR · AUTOMATION
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
        Your AI HR Assistant
      </div>
      <div style={{ fontSize: 14, marginTop: 6, opacity: 0.92 }}>
        See what needs attention · Review AI recommendations · Manage automation rules
      </div>
    </div>
  );
}

function SectionHeader({ kicker, title, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: 1.6, fontWeight: 800,
                    color: BVC_RED, textTransform: "uppercase" }}>
        {kicker}
      </div>
      <div style={{ fontSize: 19, fontWeight: 800, color: BVC_TEXT, marginTop: 2 }}>
        {title}
      </div>
      {sub && (
        <div style={{ fontSize: 13, color: BVC_MUTED, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


// =====================================================================
// Section 1 — Alert card
// =====================================================================

function AlertCard({ title, count, priority, actionLabel, onAction }) {
  const priorityColor =
    priority === "HIGH"   ? BVC_RED :
    priority === "MEDIUM" ? BVC_AMBER : BVC_GREEN;
  return (
    <div style={{
      background: "white", border: `1px solid ${BVC_LINE}`,
      borderLeft: `4px solid ${priorityColor}`,
      borderRadius: 12, padding: 16,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: BVC_MUTED,
                      letterSpacing: 0.4, textTransform: "uppercase" }}>
          {title}
        </div>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 999,
          background: priorityColor + "1a", color: priorityColor, letterSpacing: 0.4,
        }}>
          {priority}
        </span>
      </div>
      <div style={{ fontSize: 36, fontWeight: 800, color: BVC_TEXT, lineHeight: 1 }}>
        {count}
      </div>
      <button onClick={onAction} style={{
        marginTop: 4, padding: "8px 14px", background: BVC_RED, color: "white",
        border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
        letterSpacing: 0.3, cursor: "pointer", textTransform: "uppercase",
      }}>
        {actionLabel}
      </button>
    </div>
  );
}


// =====================================================================
// Section 2 — Recommendation card
// =====================================================================

function RecommendationCard({ rec, onReview, onApprove }) {
  const conf = Math.round((rec.confidence || 0) * 100);
  const confColor = conf >= 85 ? BVC_GREEN : conf >= 70 ? BVC_AMBER : BVC_RED;
  const typeBadge =
    rec.type === "LEAVE"     ? { l: "LEAVE",     c: "#0891b2" } :
    rec.type === "ATTENDANCE"? { l: "ATTENDANCE", c: BVC_AMBER } :
                               { l: "FOLLOW-UP",  c: BVC_RED };
  return (
    <div style={{
      background: "white", border: `1px solid ${BVC_LINE}`, borderRadius: 12,
      padding: 16, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: BVC_TEXT }}>
            {rec.title}
          </div>
          <div style={{ fontSize: 12, color: BVC_MUTED, marginTop: 2 }}>
            {rec.employee}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 999,
          background: typeBadge.c + "1a", color: typeBadge.c, letterSpacing: 0.4,
          whiteSpace: "nowrap",
        }}>
          {typeBadge.l}
        </span>
      </div>

      <div style={{
        fontSize: 13, color: BVC_TEXT, lineHeight: 1.5,
        background: BVC_BG, padding: "10px 12px", borderRadius: 8,
      }}>
        {rec.reason}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12, color: BVC_MUTED }}>
          AI confidence:{" "}
          <b style={{ color: confColor, fontSize: 13 }}>{conf}%</b>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onReview} style={btnSecondary()}>Review</button>
          <button onClick={onApprove} style={btnPrimary()}>Approve</button>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Section 3 — Rule row with toggle switch
// =====================================================================

function RuleRow({ rule, onToggle, onConfigure }) {
  return (
    <div style={{
      padding: "14px 18px", borderTop: `1px solid ${BVC_LINE}`,
      display: "flex", alignItems: "center", gap: 14,
      flexWrap: "wrap",
    }}>
      <Toggle on={rule.enabled} onChange={onToggle} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: BVC_TEXT }}>
          {rule.name}
          <span style={{
            marginLeft: 10, fontSize: 10, fontWeight: 800,
            padding: "2px 8px", borderRadius: 999, letterSpacing: 0.5,
            background: rule.enabled ? BVC_GREEN + "1a" : "#f1f5f9",
            color: rule.enabled ? BVC_GREEN : BVC_MUTED,
          }}>
            {rule.enabled ? "ACTIVE" : "PAUSED"}
          </span>
        </div>
        <div style={{ fontSize: 13, color: BVC_MUTED, marginTop: 2 }}>
          {rule.description}
        </div>
      </div>
      <button onClick={onConfigure} style={btnSecondary()}>Configure</button>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={onChange} aria-pressed={on}
      style={{
        width: 44, height: 24, padding: 0, border: "none",
        borderRadius: 999, cursor: "pointer", position: "relative",
        background: on ? BVC_GREEN : "#cbd5e1",
        transition: "background 0.18s ease",
      }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 22 : 2,
        width: 20, height: 20, borderRadius: "50%",
        background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        transition: "left 0.18s ease",
      }} />
    </button>
  );
}


// =====================================================================
// Section 4 — Chart card
// =====================================================================

function ChartCard({ title, children }) {
  return (
    <div style={{
      background: "white", border: `1px solid ${BVC_LINE}`,
      borderRadius: 12, padding: 14,
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: BVC_MUTED,
                    letterSpacing: 0.6, textTransform: "uppercase",
                    marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}


// =====================================================================
// Atoms
// =====================================================================

function StatusPill({ status }) {
  const map = {
    SUCCESS: { color: BVC_GREEN, label: "Success" },
    FAILED:  { color: BVC_RED,   label: "Failed" },
    SKIPPED: { color: BVC_MUTED, label: "Skipped" },
  };
  const { color, label } = map[status] || map.SUCCESS;
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999,
      background: color + "1a", color, letterSpacing: 0.4,
    }}>{label.toUpperCase()}</span>
  );
}

function EmptyCard({ msg }) {
  return (
    <div style={{
      gridColumn: "1 / -1",
      background: "white", border: `1px dashed ${BVC_LINE}`,
      borderRadius: 12, padding: 24, textAlign: "center",
      color: BVC_MUTED, fontStyle: "italic",
    }}>{msg}</div>
  );
}

const Th = ({ children }) => (
  <th style={{
    padding: "12px 16px", textAlign: "left", fontSize: 11,
    fontWeight: 800, letterSpacing: 0.8, color: BVC_MUTED,
    textTransform: "uppercase",
  }}>{children}</th>
);
const Td = ({ children, style }) => (
  <td style={{ padding: "12px 16px", fontSize: 14, color: BVC_TEXT, ...style }}>
    {children}
  </td>
);

function btnPrimary() {
  return {
    padding: "7px 14px", background: BVC_RED, color: "white",
    border: "none", borderRadius: 8,
    fontSize: 12, fontWeight: 800, letterSpacing: 0.4,
    cursor: "pointer", textTransform: "uppercase",
  };
}
function btnSecondary() {
  return {
    padding: "7px 14px", background: "white", color: BVC_RED,
    border: `1px solid ${BVC_RED}`, borderRadius: 8,
    fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
    cursor: "pointer",
  };
}
