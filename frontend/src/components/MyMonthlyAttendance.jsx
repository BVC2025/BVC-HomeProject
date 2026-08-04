/*
 * MyMonthlyAttendance — employee self-service view of any month's
 * attendance. Rendered below MyAttendancePanel on the ESS Attendance
 * tab. Employees can pick any past or current month and see:
 *
 *   • KPI tiles: days present, late arrivals, worked hours, OT hours
 *   • Absence + missed-checkout counts
 *   • Leave balance (annual — casual, sick, earned)
 *   • Memos received this month
 *   • Star performance score (attendance portion)
 *   • Day-by-day calendar grid with colour coding
 *
 * All data is fetched from GET /attendance/summary/my — a self-only
 * endpoint that enforces "employees see only their own numbers" on
 * the backend, so this component is safe to render as-is with no
 * additional gating.
 */

import { useEffect, useState } from "react";

import API from "../services/api";
import { formatISTTime } from "../utils/time";


export default function MyMonthlyAttendance({ employeeId }) {

  const now = new Date();
  const defaultMonth =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const res = await API.get("/attendance/summary/my", {
        params: { month },
      });
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't load your monthly summary.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, employeeId]);

  // Small helpers used by the calendar grid
  const dayColor = (d) => {
    if (!d.is_working_day) return "#f1f5f9";               // grey (off/holiday)
    if (d.status === "LEAVE") return "#e0e7ff";            // indigo (leave)
    if (d.status === "ABSENT") return "#fee2e2";           // red (unpaid absence)
    if (d.is_late) return "#fef3c7";                       // amber (late)
    if (d.check_in) return "#d1fae5";                      // green (present)
    return "#f8fafc";
  };

  const dayLabel = (d) => {
    if (!d.is_working_day) return d.is_public_holiday ? "H" : "—";
    if (d.status === "LEAVE") return "L";
    if (d.status === "ABSENT") return "A";
    if (d.is_late) return "T";        // T for tardy
    if (d.check_in) return "P";
    return "";
  };

  return (
    <div style={mm.wrap}>

      <div style={mm.head}>
        <div>
          <div style={mm.eyebrow}>My Attendance</div>
          <h2 style={mm.title}>
            {data?.month_label || (month + " summary")}
          </h2>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={mm.monthInput}
        />
      </div>

      {loading && (
        <div style={mm.info}>Loading your monthly summary…</div>
      )}

      {error && (
        <div style={mm.error}><b>Error:</b> {error}</div>
      )}

      {data && !loading && (
        <>
          {/* KPI tiles */}
          <div style={mm.tileRow}>
            <Kpi label="Days Present" value={data.days_present} sub={`of ${data.working_days} working days`} tone="ok" />
            <Kpi label="Late Arrivals" value={data.late_arrivals} sub={`${data.total_late_minutes} min total`} tone={data.late_arrivals >= 5 ? "danger" : data.late_arrivals >= 3 ? "warn" : "muted"} />
            <Kpi label="Absent" value={data.unpaid_absences} sub="Unpaid (no leave)" tone={data.unpaid_absences > 0 ? "danger" : "muted"} />
            <Kpi label="Worked Hours" value={`${data.total_worked_hours}h`} tone="info" />
            <Kpi label="OT Hours" value={`${data.total_ot_hours}h`} tone="info" />
            <Kpi label="Missed Check-outs" value={data.missed_checkouts} tone={data.missed_checkouts > 0 ? "warn" : "muted"} />
          </div>

          {/* Leave balance */}
          <div style={mm.section}>
            <div style={mm.sectionTitle}>Leave Balance (this year)</div>
            <div style={mm.tileRow}>
              <Kpi label="Casual" value={data.leave_balance?.casual?.available ?? "—"} sub={`of ${data.leave_balance?.casual?.total ?? 12}`} tone="info" />
              <Kpi label="Sick" value={data.leave_balance?.sick?.available ?? "—"} sub={`of ${data.leave_balance?.sick?.total ?? 12}`} tone="info" />
              <Kpi label="Earned" value={data.leave_balance?.earned?.available ?? "—"} sub={`of ${data.leave_balance?.earned?.total ?? 15}`} tone="info" />
            </div>
          </div>

          {/* Star performance */}
          <div style={mm.section}>
            <div style={mm.sectionTitle}>Star Performance — Attendance component</div>
            <div style={mm.scoreCard}>
              <div style={mm.scoreBig}>
                {data.star_score_attendance}<span style={mm.scoreOf}>/80</span>
              </div>
              <div style={mm.scoreBreakdown}>
                <div>Attendance: <b>{data.star_score_breakdown?.attendance}</b> / 40</div>
                <div>Punctuality: <b>{data.star_score_breakdown?.punctuality}</b> / 20</div>
                <div>Overtime: <b>{data.star_score_breakdown?.overtime}</b> / 20</div>
              </div>
            </div>
          </div>

          {/* Memos this month */}
          {data.memos_this_month?.length > 0 && (
            <div style={mm.section}>
              <div style={mm.sectionTitle}>Memos Received This Month</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.memos_this_month.map((m) => (
                  <div key={m.id} style={{
                    padding: 12,
                    background: m.type === "WARNING" ? "#fef2f2" : m.type === "APPRECIATION" ? "#ecfdf5" : "#f8fafc",
                    border: `1px solid ${m.type === "WARNING" ? "#fecaca" : m.type === "APPRECIATION" ? "#a7f3d0" : "#e2e8f0"}`,
                    borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: m.type === "WARNING" ? "#991b1b" : m.type === "APPRECIATION" ? "#065f46" : "#475569" }}>
                      {m.type}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>{m.subject}</div>
                    {m.message && <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{m.message}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Memo prediction — only surface if a warning is imminent */}
          {data.memo_flags?.will_get_warning && data.memos_this_month?.filter((m) => m.type === "WARNING").length === 0 && (
            <div style={mm.warnBox}>
              <b>⚠ Warning memo eligible</b>
              <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 13 }}>
                {data.memo_flags.warning_reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <div style={{ marginTop: 6, fontSize: 12, color: "#78350f" }}>
                A written memo may be generated at month-end unless corrected.
              </div>
            </div>
          )}

          {/* Calendar grid */}
          <div style={mm.section}>
            <div style={mm.sectionTitle}>Day-by-day</div>
            <div style={mm.calGrid}>
              {(data.days || []).map((d) => (
                <div
                  key={d.date}
                  title={
                    `${d.date} · ${d.status}`
                    + (d.check_in ? ` · in ${formatISTTime(d.check_in)}` : "")
                    + (d.check_out ? ` · out ${formatISTTime(d.check_out)}` : "")
                    + (d.late_minutes ? ` · ${d.late_minutes} min late` : "")
                  }
                  style={{
                    background: dayColor(d),
                    borderRadius: 6,
                    padding: "6px 4px",
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#0f172a",
                    lineHeight: 1.2,
                    border: "1px solid rgba(0,0,0,0.05)",
                  }}
                >
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    {new Date(d.date).getDate()}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {dayLabel(d)}
                  </div>
                </div>
              ))}
            </div>
            <div style={mm.legend}>
              <span style={{ ...mm.legendChip, background: "#d1fae5" }}>P</span> Present &nbsp;
              <span style={{ ...mm.legendChip, background: "#fef3c7" }}>T</span> Late &nbsp;
              <span style={{ ...mm.legendChip, background: "#e0e7ff" }}>L</span> Leave &nbsp;
              <span style={{ ...mm.legendChip, background: "#fee2e2" }}>A</span> Absent (unpaid) &nbsp;
              <span style={{ ...mm.legendChip, background: "#f1f5f9" }}>—</span> Off / Holiday
            </div>
          </div>
        </>
      )}

    </div>
  );
}


function Kpi({ label, value, sub, tone = "muted" }) {
  const colors = {
    ok:     { bg: "#ecfdf5", fg: "#065f46", border: "#a7f3d0" },
    warn:   { bg: "#fffbeb", fg: "#92400e", border: "#fde68a" },
    danger: { bg: "#fef2f2", fg: "#991b1b", border: "#fecaca" },
    info:   { bg: "#eff6ff", fg: "#1e40af", border: "#bfdbfe" },
    muted:  { bg: "#f8fafc", fg: "#334155", border: "#e2e8f0" },
  };
  const c = colors[tone] || colors.muted;
  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 10,
      padding: "12px 14px",
      minWidth: 140,
      flex: "1 1 140px",
    }}>
      <div style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: c.fg,
        opacity: 0.85,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: c.fg, marginTop: 2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: c.fg, opacity: 0.7, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


const mm = {
  wrap: {
    marginTop: 22,
    padding: 22,
    background: "#fff",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    boxShadow: "0 4px 16px rgba(15,23,42,0.04)",
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 },
  eyebrow: { fontSize: 11, fontWeight: 800, color: "#dc2626", letterSpacing: 1.6, textTransform: "uppercase" },
  title: { fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "4px 0 0 0" },
  monthInput: { padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, fontFamily: "inherit" },
  info: { padding: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, color: "#475569" },
  error: { padding: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8 },
  tileRow: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 4 },
  section: { marginTop: 20 },
  sectionTitle: { fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: "#dc2626", marginBottom: 10 },
  scoreCard: { display: "flex", alignItems: "center", gap: 20, padding: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 },
  scoreBig: { fontSize: 36, fontWeight: 900, color: "#0f172a" },
  scoreOf: { fontSize: 18, fontWeight: 600, color: "#64748b" },
  scoreBreakdown: { fontSize: 13, color: "#475569", lineHeight: 1.7 },
  warnBox: { marginTop: 16, padding: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, color: "#92400e", fontSize: 13 },
  calGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(46px, 1fr))", gap: 6 },
  legend: { marginTop: 10, fontSize: 12, color: "#475569" },
  legendChip: { display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginRight: 4 },
};
