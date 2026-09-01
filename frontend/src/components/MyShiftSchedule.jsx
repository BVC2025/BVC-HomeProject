import { useEffect, useMemo, useState } from "react";
import API from "../services/api";

/* Employee Self-Portal — Shift Schedule.

   Three sections:
   1. Today card — big colour block with shift name + times
   2. This week grid — 7-day strip showing each day's shift
   3. Next 4 weeks calendar — month view with each cell coloured
      by shift template

   Everything is read-only. The employee cannot request changes;
   admin owns scheduling (business decision).

   Data comes from:
     GET /shifts/my/current?employee_id=
     GET /shifts/my/range?employee_id=&from_date=&to_date=
     GET /shifts/my/upcoming?employee_id=&days=
*/

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toIso(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function startOfWeek(d) {
  // Monday start.
  const day = d.getDay(); // Sun=0, Mon=1, ...
  const diff = day === 0 ? -6 : 1 - day;
  const out = new Date(d);
  out.setDate(d.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(d.getDate() + n);
  return out;
}


export default function MyShiftSchedule({ employeeId }) {

  const [today, setToday] = useState(null);
  const [weekRows, setWeekRows] = useState([]);
  const [monthRows, setMonthRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const weekEnd = useMemo(() => addDays(weekAnchor, 6), [weekAnchor]);

  const monthAnchor = useMemo(() => {
    // First day of the month containing "today".
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const monthEnd = useMemo(() => {
    // Last day of the month + 27 more days so we cover ~4 weeks after.
    const d = new Date(monthAnchor);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return addDays(d, 21);   // ~3 weeks after month end
  }, [monthAnchor]);

  const load = async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const [tRes, wRes, mRes, uRes] = await Promise.all([
        API.get("/shifts/my/current",  { params: { employee_id: employeeId } }),
        API.get("/shifts/my/range",    { params: { employee_id: employeeId, from_date: toIso(weekAnchor), to_date: toIso(weekEnd) } }),
        API.get("/shifts/my/range",    { params: { employee_id: employeeId, from_date: toIso(monthAnchor), to_date: toIso(monthEnd) } }),
        API.get("/shifts/my/upcoming", { params: { employee_id: employeeId, days: 30 } }),
      ]);
      setToday(tRes.data || null);
      setWeekRows(Array.isArray(wRes.data) ? wRes.data : []);
      setMonthRows(Array.isArray(mRes.data) ? mRes.data : []);
      setSummary(uRes.data?.summary || null);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load your shift schedule.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [employeeId, weekAnchor]);

  // Build a map (iso date → assignment) for quick lookup in the grids.
  const weekByDate  = useMemo(() => new Map(weekRows.map((a) => [a.SHIFT_DATE, a])), [weekRows]);
  const monthByDate = useMemo(() => new Map(monthRows.map((a) => [a.SHIFT_DATE, a])), [monthRows]);

  // Build the week strip: 7 days starting from weekAnchor.
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = addDays(weekAnchor, i);
      return { date: d, iso: toIso(d), a: weekByDate.get(toIso(d)) || null };
    });
  }, [weekAnchor, weekByDate]);

  // Build month cells starting on Monday of the first week.
  const monthCells = useMemo(() => {
    const gridStart = startOfWeek(monthAnchor);
    const gridEnd   = monthEnd;
    const cells = [];
    let d = new Date(gridStart);
    while (d <= gridEnd) {
      const iso = toIso(d);
      cells.push({ date: new Date(d), iso, a: monthByDate.get(iso) || null });
      d = addDays(d, 1);
    }
    return cells;
  }, [monthAnchor, monthEnd, monthByDate]);

  const S = {
    page: { padding: "16px 20px 40px 20px", maxWidth: 1100, margin: "0 auto" },
    title: { margin: 0, fontSize: 20, fontWeight: 700, color: "#1f2937" },
    subtitle: { margin: "4px 0 20px 0", fontSize: 13, color: "#6b7280" },
    banner: {
      padding: "10px 14px",
      background: "#fef2f2",
      color: "#b91c1c",
      border: "1px solid #fecaca",
      borderRadius: 8,
      fontSize: 13,
      marginBottom: 16,
    },
    todayCard: (color) => ({
      background: color || "#dc2626",
      color: "#ffffff",
      borderRadius: 14,
      padding: "22px 24px",
      marginBottom: 20,
      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    }),
    todayLabel: { fontSize: 12, opacity: 0.85, textTransform: "uppercase", letterSpacing: 1 },
    todayShiftName: { fontSize: 26, fontWeight: 700, margin: "6px 0 4px 0" },
    todayShiftTime: { fontSize: 16, opacity: 0.95 },
    todayEmpty: { fontSize: 16, opacity: 0.95, marginTop: 6 },
    sectionHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      margin: "12px 0 10px 0",
    },
    sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: "#1f2937" },
    weekStrip: {
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: 8,
    },
    weekDayCell: (isToday) => ({
      background: "#ffffff",
      border: `1px solid ${isToday ? "#dc2626" : "#e5e7eb"}`,
      borderRadius: 10,
      padding: "10px 8px",
      minHeight: 92,
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }),
    weekDayName: { fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 },
    weekDayNum: { fontSize: 18, fontWeight: 700, color: "#1f2937" },
    shiftPill: (color) => ({
      background: color || "#e5e7eb",
      color: "#ffffff",
      padding: "3px 8px",
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 700,
      alignSelf: "flex-start",
      textShadow: "0 0 2px rgba(0,0,0,0.15)",
    }),
    shiftTimes: { fontSize: 11, color: "#6b7280", marginTop: 2 },
    shiftOff: {
      background: "#f1f5f9",
      color: "#64748b",
      padding: "3px 8px",
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 600,
      alignSelf: "flex-start",
    },
    monthHeader: {
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: 6,
      marginBottom: 6,
    },
    monthHeaderCell: { fontSize: 11, color: "#6b7280", textAlign: "center", padding: 4 },
    monthGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: 6,
    },
    monthCell: (inMonth, isToday, color) => ({
      background: color || "#ffffff",
      color: color ? "#ffffff" : "#1f2937",
      opacity: inMonth ? 1 : 0.35,
      border: `1px solid ${isToday ? "#dc2626" : "#e5e7eb"}`,
      borderRadius: 8,
      padding: "6px 6px",
      minHeight: 58,
      display: "flex",
      flexDirection: "column",
      gap: 2,
      fontSize: 11,
    }),
    monthCellNum: { fontWeight: 700, fontSize: 12 },
    monthCellCode: (hasBg) => ({
      fontSize: 10,
      fontWeight: 700,
      color: hasBg ? "#ffffff" : "#6b7280",
      textShadow: hasBg ? "0 0 2px rgba(0,0,0,0.2)" : "none",
    }),
    summary: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      marginBottom: 20,
    },
    summaryPill: (color) => ({
      background: color || "#e5e7eb",
      color: "#ffffff",
      padding: "6px 12px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      textShadow: "0 0 2px rgba(0,0,0,0.15)",
    }),
    navBtn: {
      padding: "6px 12px",
      borderRadius: 6,
      border: "1px solid #d1d5db",
      background: "#ffffff",
      color: "#1f2937",
      fontSize: 12,
      cursor: "pointer",
    },
    legend: { fontSize: 11, color: "#9ca3af", marginTop: 6 },
  };

  const todayIso = toIso(new Date());
  const todayAssignment = today?.assignment || null;
  const todayShift = todayAssignment
    ? {
        code:  todayAssignment.SHIFT_CODE,
        name:  todayAssignment.SHIFT_NAME,
        start: todayAssignment.START_TIME,
        end:   todayAssignment.END_TIME,
        color: todayAssignment.COLOR,
      }
    : null;

  const codeColorMap = useMemo(() => {
    const m = new Map();
    for (const a of [...weekRows, ...monthRows]) {
      if (a.SHIFT_CODE && a.COLOR) m.set(a.SHIFT_CODE, a.COLOR);
    }
    return m;
  }, [weekRows, monthRows]);

  return (
    <div style={S.page}>
      <h2 style={S.title}>My Shift Schedule</h2>
      <p style={S.subtitle}>
        Your assigned shifts for today, this week, and the coming month. Managed by HR — reach out to your supervisor for changes.
      </p>

      {error && <div style={S.banner}>{error}</div>}

      {/* Today card */}
      {todayShift ? (
        <div style={S.todayCard(todayShift.color)}>
          <div style={S.todayLabel}>Today's Shift</div>
          <div style={S.todayShiftName}>
            {todayShift.code ? `${todayShift.code} · ` : ""}{todayShift.name}
          </div>
          <div style={S.todayShiftTime}>
            {todayShift.start} – {todayShift.end}
          </div>
        </div>
      ) : today && today.assignment === null ? (
        <div style={S.todayCard("#dc2626")}>
          <div style={S.todayLabel}>Today's Shift</div>
          <div style={S.todayEmpty}>No shift assigned — enjoy your day off.</div>
        </div>
      ) : (
        <div style={S.todayCard("#b91c1c")}>
          <div style={S.todayLabel}>Today's Shift</div>
          <div style={S.todayEmpty}>{loading ? "Loading…" : "—"}</div>
        </div>
      )}

      {/* Summary pills */}
      {summary && Object.keys(summary).length > 0 && (
        <>
          <div style={S.sectionHeader}>
            <h3 style={S.sectionTitle}>Next 30 days at a glance</h3>
          </div>
          <div style={S.summary}>
            {Object.entries(summary).map(([code, n]) => (
              <div key={code} style={S.summaryPill(codeColorMap.get(code) || "#6b7280")}>
                {code} — {n} day{n === 1 ? "" : "s"}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Week strip */}
      <div style={S.sectionHeader}>
        <h3 style={S.sectionTitle}>
          Week of {weekAnchor.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={S.navBtn} onClick={() => setWeekAnchor((w) => addDays(w, -7))}>← Prev</button>
          <button style={S.navBtn} onClick={() => setWeekAnchor(startOfWeek(new Date()))}>This week</button>
          <button style={S.navBtn} onClick={() => setWeekAnchor((w) => addDays(w, 7))}>Next →</button>
        </div>
      </div>
      <div style={S.weekStrip}>
        {weekDays.map(({ date, iso, a }, i) => {
          const isToday = iso === todayIso;
          return (
            <div key={iso} style={S.weekDayCell(isToday)}>
              <div style={S.weekDayName}>{DAY_NAMES[i]}</div>
              <div style={S.weekDayNum}>{date.getDate()}</div>
              {a && a.SHIFT_ID && a.SHIFT_CODE ? (
                <>
                  <div style={S.shiftPill(a.COLOR)}>
                    {a.SHIFT_CODE} · {a.SHIFT_NAME || ""}
                  </div>
                  <div style={S.shiftTimes}>
                    {a.START_TIME} – {a.END_TIME}
                  </div>
                </>
              ) : a && !a.SHIFT_ID ? (
                <div style={S.shiftOff}>OFF</div>
              ) : (
                <div style={{ fontSize: 11, color: "#94a3b8" }}>—</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Month grid */}
      <div style={S.sectionHeader}>
        <h3 style={S.sectionTitle}>
          {monthAnchor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} calendar
        </h3>
      </div>
      <div style={S.monthHeader}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={S.monthHeaderCell}>{d}</div>
        ))}
      </div>
      <div style={S.monthGrid}>
        {monthCells.map(({ date, iso, a }) => {
          const inMonth = date.getMonth() === monthAnchor.getMonth();
          const isToday = iso === todayIso;
          const hasShift = a && a.SHIFT_ID && a.COLOR;
          return (
            <div key={iso} style={S.monthCell(inMonth, isToday, hasShift ? a.COLOR : null)}>
              <div style={S.monthCellNum}>{date.getDate()}</div>
              {a && a.SHIFT_ID && a.SHIFT_CODE && (
                <div style={S.monthCellCode(true)}>{a.SHIFT_CODE}</div>
              )}
              {a && !a.SHIFT_ID && (
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>OFF</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={S.legend}>
        Coloured cells are days you have a shift assigned. Grey "OFF" = weekly off. Empty cell = not yet published by HR.
      </div>
    </div>
  );
}
