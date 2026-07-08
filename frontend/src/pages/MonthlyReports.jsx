// =====================================================================
// MonthlyReports — auto-generated monthly attendance + payroll summary.
//
// HR picks a month, hits Generate, sees a table of every employee with
// all key counts and salary impact. Each row has a PDF download button.
// =====================================================================

import { useEffect, useMemo, useState, useCallback } from "react";
import API, { API_BASE_URL } from "../services/api";

const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BORDER   = "#e2e8f0";
const TEXT     = "#0f172a";
const MUTED    = "#64748b";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Smart number formatter — integer when whole, one decimal when fractional.
// Keeps "0.5" half-day display intact, drops "0.0" → "0", "6.0" → "6".
const fmt = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};


export default function MonthlyReports() {

  const today = new Date();
  // Default to last month — that's the typical payroll cycle.
  const defMonth = today.getMonth() === 0 ? 12 : today.getMonth();
  const defYear  = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

  const [year,  setYear]  = useState(defYear);
  const [month, setMonth] = useState(defMonth);
  const [rows,  setRows]  = useState([]);
  const [meta,  setMeta]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const { data } = await API.get("/monthly-reports",
        { params: { year, month, force } });
      // New envelope: { meta, reports }
      setRows(data?.reports || []);
      setMeta(data?.meta || null);
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to load reports");
    } finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // Force-resync: bypasses the 5-min cooldown for the current month
  // and re-runs the lock pass for past months. Used as a manual override.
  const forceResync = async () => {
    setGenerating(true);
    try {
      await load(true);
    } finally { setGenerating(false); }
  };

  const regenerateOne = async (emp_id) => {
    try {
      await API.post(`/monthly-reports/${emp_id}/generate`, { year, month });
      await load();
    } catch (e) { alert(e?.response?.data?.detail || "Failed"); }
  };

  const downloadPdf = (emp_id) => {
    const token = localStorage.getItem("token");
    // Use fetch + blob so we can attach Authorization header
    fetch(`${API_BASE_URL}/monthly-reports/${emp_id}/pdf?year=${year}&month=${month}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(async (r) => {
      if (!r.ok) throw new Error("Download failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `monthly_report_${emp_id}_${year}_${String(month).padStart(2, "0")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }).catch((e) => alert(e.message));
  };

  // Derived
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      (r.employee_name  || "").toLowerCase().includes(q) ||
      (r.employee_code  || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totals = useMemo(() => ({
    employees: rows.length,
    avg_attendance: rows.length
      ? Math.round(rows.reduce((s, r) => s + r.attendance_pct, 0) / rows.length)
      : 0,
    total_deduction: rows.reduce((s, r) =>
      s + (r.absence_deduction || 0) + (r.late_deduction || 0), 0),
    total_ot: rows.reduce((s, r) => s + (r.ot_payable || 0), 0),
    flagged: rows.filter((r) =>
      r.attendance_pct < 75 || r.late_count >= 5 || r.excess_leaves > 0).length,
  }), [rows]);

  return (
    <div style={{ padding: 18, color: TEXT, fontSize: 14 }}>

      <Hero />

      {/* Controls + auto-status banner */}
      <div style={{
        background: "white", border: `1px solid ${BORDER}`, borderRadius: 12,
        padding: 16, marginTop: 14, marginBottom: 14,
        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
      }}>
        <label style={lbl}>Year</label>
        <input type="number" value={year} min="2020" max="2099"
          onChange={(e) => setYear(Number(e.target.value))} style={input} />

        <label style={lbl}>Month</label>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
          style={input}>
          {MONTHS.map((m, i) => (
            <option key={i+1} value={i+1}>{m}</option>
          ))}
        </select>

        <StatusBadge meta={meta} loading={loading} />

        <button onClick={forceResync} disabled={generating || loading}
          style={btnSecondaryStyle(generating || loading)}
          title="Bypass the 5-minute cooldown and recompute now">
          {generating ? "Syncing…" : "↻ Force re-sync"}
        </button>

        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee…"
          style={{ ...input, flex: "1 1 200px", minWidth: 180 }} />
      </div>

      {/* Summary tiles */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10, marginBottom: 14,
      }}>
        <Tile label="Employees"      value={totals.employees}      accent={BVC_RED} />
        <Tile label="Avg attendance" value={`${totals.avg_attendance}%`} accent="#16a34a" />
        <Tile label="Total deductions" value={`₹${totals.total_deduction.toLocaleString()}`}
              accent="#dc2626" />
        <Tile label="Total OT pay"     value={`₹${Math.round(totals.total_ot).toLocaleString()}`}
              accent="#0891b2" />
        <Tile label="Flagged" value={totals.flagged} accent="#d97706" />
      </div>

      {/* Table */}
      <div style={{
        background: "white", border: `1px solid ${BORDER}`, borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse",
                          fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#fafbfc" }}>
                <Th>Employee</Th>
                <Th>Working Days</Th>
                <Th>Present</Th>
                <Th>Absent</Th>
                <Th>Late</Th>
                <Th>OT</Th>
                <Th>CL</Th>
                <Th>Salary</Th>
                <Th>Deduction</Th>
                <Th>Total</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} style={emptyCell}>Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={11} style={emptyCell}>
                  No reports for this month yet. Click "Generate / Refresh All".
                </td></tr>
              )}
              {filtered.map((r) => {
                const flagged = r.attendance_pct < 75 || r.late_count >= 5 || r.excess_leaves > 0;
                return (
                  <tr key={r.employee_id}
                    style={{
                      background: flagged ? "#fff7ed" : "white",
                      borderTop: `1px solid ${BORDER}`,
                    }}
                  >
                    <Td>
                      <div style={{ display: "flex", alignItems: "center",
                                    gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800 }}>{r.employee_name}</div>
                        {r.is_locked && (
                          <span style={rowPill("#dcfce7", "#166534")}>FINAL</span>
                        )}
                        {!r.is_locked && r.is_partial && (
                          <span style={rowPill("#fef3c7", "#92400e")}>LIVE</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: MUTED }}>{r.employee_code}</div>
                    </Td>
                    <Td>{r.working_days}</Td>
                    <Td>{fmt(r.present_days)}</Td>
                    <Td style={{ color: r.absent_days ? "#dc2626" : MUTED }}>
                      {fmt(r.absent_days)}
                    </Td>
                    <Td style={{ color: r.late_count >= 5 ? "#dc2626" :
                                       r.late_count >= 3 ? "#d97706" : MUTED }}>
                      {r.late_count}
                    </Td>
                    <Td>{fmt(r.overtime_hours)}</Td>
                    <Td>{fmt(r.cl_used)}</Td>
                    <Td>₹{r.monthly_salary.toLocaleString()}</Td>
                    <Td style={{ color: "#dc2626" }}>
                      ₹{Math.round(r.absence_deduction + r.late_deduction).toLocaleString()}
                    </Td>
                    <Td>
                      <b style={{ color: BVC_DARK }}>
                        ₹{r.net_payable.toLocaleString()}
                      </b>
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => setSelected(r)} style={pillBtn(BVC_DARK)}>
                          View
                        </button>
                        <button onClick={() => downloadPdf(r.employee_id)}
                          style={pillBtn("#0891b2")}>
                          PDF
                        </button>
                        <button onClick={() => regenerateOne(r.employee_id)}
                          style={pillBtn("#64748b", true)}>
                          ↻
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <DetailModal report={selected} onClose={() => setSelected(null)}
          onPdf={() => downloadPdf(selected.employee_id)} />
      )}
    </div>
  );
}


// =====================================================================
// Sub-components
// =====================================================================

function Hero() {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${BVC_RED} 0%, ${BVC_DARK} 100%)`,
      color: "white", padding: "20px 24px", borderRadius: 14,
      boxShadow: "0 4px 14px rgba(139,11,31,0.18)",
    }}>
      <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
        HR · MONTHLY REPORTS
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
        Automated Monthly Attendance & Payroll Reports
      </div>
      <div style={{ fontSize: 15, marginTop: 6, opacity: 0.9 }}>
        Per-employee summary · Working days · Leave breakdown · Deductions · Net payable · PDF download
      </div>
    </div>
  );
}

function Tile({ label, value, accent }) {
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 12, letterSpacing: 1.2, color: MUTED, fontWeight: 700,
                    textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: TEXT }}>
        {value}
      </div>
    </div>
  );
}

function Bar({ pct }) {
  const safe = Math.max(0, Math.min(100, pct || 0));
  const color = safe >= 95 ? "#16a34a" : safe >= 75 ? "#d97706" : "#dc2626";
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 4 }}>
        {safe.toFixed(1)}%
      </div>
      <div style={{
        height: 6, background: "#f1f5f9", borderRadius: 999, overflow: "hidden",
      }}>
        <div style={{ height: "100%", width: `${safe}%`, background: color,
                      transition: "width 0.2s" }} />
      </div>
    </div>
  );
}


function DetailModal({ report, onClose, onPdf }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
      backdropFilter: "blur(2px)", zIndex: 2000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "white", borderRadius: 16, width: "100%", maxWidth: 720,
        maxHeight: "90dvh", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", padding: "16px 20px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
              {report.employee_code} · {MONTHS[report.month-1]} {report.year}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{report.employee_name}</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.18)", color: "white", border: "none",
            padding: "6px 12px", borderRadius: 6, fontSize: 13, fontWeight: 800,
            cursor: "pointer",
          }}>×  Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, fontSize: 14 }}>
          <Group title="Attendance">
            <Pair k="Working days" v={report.working_days} />
            <Pair k="Present" v={fmt(report.present_days)} />
            <Pair k="Absent" v={fmt(report.absent_days)} highlight={report.absent_days > 0} />
            <Pair k="Half days" v={fmt(report.half_days)} />
            <Pair k="Late arrivals" v={report.late_count} highlight={report.late_count >= 3} />
            <Pair k="Attendance %" v={`${report.attendance_pct.toFixed(1)}%`} />
            <Pair k="Worked hours" v={fmt(report.worked_hours)} />
            <Pair k="Overtime hours" v={fmt(report.overtime_hours)} />
          </Group>

          <Group title="Leave breakdown">
            <Pair k="CL used"        v={fmt(report.cl_used)} />
            <Pair k="Sick used"      v={fmt(report.sick_used)} />
            <Pair k="Earned used"    v={fmt(report.earned_used)} />
            <Pair k="Paid leaves"    v={fmt(report.paid_leaves)} />
            <Pair k="Unpaid leaves"  v={fmt(report.unpaid_leaves)} />
            <Pair k="Excess leaves"  v={fmt(report.excess_leaves)}
                  highlight={report.excess_leaves > 0} />
          </Group>

          <Group title="Salary impact">
            <Pair k="Monthly salary"        v={`₹${report.monthly_salary.toLocaleString()}`} />
            <Pair k="Daily wage"            v={`₹${report.daily_wage.toLocaleString()}`} />
            <Pair k="Absence deduction"     v={`₹${report.absence_deduction.toLocaleString()}`} />
            <Pair k="OT payable"            v={`₹${report.ot_payable.toLocaleString()}`} />
          </Group>

          <div style={{
            background: BVC_RED, color: "white", padding: "12px 16px",
            borderRadius: 10, marginTop: 12, display: "flex",
            justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ fontSize: 12, letterSpacing: 1.5, opacity: 0.9, fontWeight: 700 }}>
              NET PAYABLE
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              ₹{report.net_payable.toLocaleString()}
            </div>
          </div>

          {report.insights?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: BVC_DARK,
                            letterSpacing: 1, textTransform: "uppercase",
                            marginBottom: 6 }}>
                AI insights for HR
              </div>
              {report.insights.map((line, i) => (
                <div key={i} style={{
                  fontSize: 14, color: TEXT, padding: "6px 10px",
                  borderLeft: `3px solid ${BVC_RED}`, background: "#fef2f4",
                  borderRadius: 4, marginBottom: 4,
                }}>{line}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${BORDER}`,
                      display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onPdf} style={btnPrimary(false)}>Download PDF</button>
        </div>
      </div>
    </div>
  );
}


function Group({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1,
                    color: MUTED, textTransform: "uppercase",
                    marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Pair({ k, v, highlight }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "8px 12px", background: highlight ? "#fef2f4" : "#fafbfc",
      borderRadius: 6,
    }}>
      <span style={{ color: MUTED, fontSize: 13 }}>{k}</span>
      <b style={{ color: highlight ? "#991b1b" : TEXT, fontSize: 14 }}>{v}</b>
    </div>
  );
}


// =====================================================================
// Atoms
// =====================================================================

const Th = ({ children }) => (
  <th style={{
    padding: "12px 14px", textAlign: "left", fontSize: 12,
    fontWeight: 800, color: MUTED, letterSpacing: 0.8,
    textTransform: "uppercase", borderBottom: `2px solid ${BORDER}`,
    whiteSpace: "nowrap",
  }}>{children}</th>
);
const Td = ({ children, style }) => (
  <td style={{
    padding: "12px 14px", fontSize: 14, color: TEXT,
    whiteSpace: "nowrap", ...style,
  }}>{children}</td>
);
const emptyCell = {
  padding: 32, textAlign: "center", color: MUTED,
  fontSize: 15, fontStyle: "italic",
};

const lbl = { fontSize: 13, fontWeight: 700, color: MUTED };
const input = {
  padding: "9px 12px", border: `1px solid ${BORDER}`,
  borderRadius: 8, fontSize: 14, background: "white",
};

function btnPrimary(disabled) {
  return {
    padding: "10px 18px", background: disabled ? "#cbd5e1" : BVC_RED,
    color: "white", border: "none", borderRadius: 8,
    fontSize: 13, fontWeight: 800, letterSpacing: 0.6,
    cursor: disabled ? "default" : "pointer", textTransform: "uppercase",
  };
}
function btnSecondaryStyle(disabled) {
  return {
    padding: "10px 16px", background: "white",
    color: disabled ? "#94a3b8" : BVC_RED,
    border: `1px solid ${disabled ? "#cbd5e1" : BVC_RED}`,
    borderRadius: 8, fontSize: 13, fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
  };
}


// Lightweight live-status pill driven by the `meta` envelope.
function StatusBadge({ meta, loading }) {
  if (loading) {
    return <Badge bg="#f1f5f9" fg={MUTED} label="Loading…" />;
  }
  if (!meta) return null;

  if (meta.is_future) {
    return <Badge bg="#f1f5f9" fg={MUTED} label="Future month" />;
  }
  if (meta.is_past) {
    return (
      <Badge bg="#dcfce7" fg="#166534"
             label="FINAL · auto-locked"
             title={`Reported as of ${meta.as_of_date}`} />
    );
  }
  // current month
  return (
    <Badge bg="#fef3c7" fg="#92400e"
           label={`LIVE · as of ${meta.as_of_date}`}
           title="Recomputed automatically on every refresh (5-minute cooldown)." />
  );
}

function Badge({ bg, fg, label, title }) {
  return (
    <span title={title || ""} style={{
      background: bg, color: fg,
      padding: "8px 14px", borderRadius: 999,
      fontSize: 12, fontWeight: 800, letterSpacing: 0.6,
      whiteSpace: "nowrap",
    }}>{label}</span>
  );
}
function pillBtn(color, ghost) {
  return {
    padding: "6px 12px",
    background: ghost ? "white" : color,
    color: ghost ? color : "white",
    border: `1px solid ${color}`,
    borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
  };
}
function rowPill(bg, fg) {
  return {
    background: bg, color: fg, padding: "2px 8px", borderRadius: 999,
    fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
  };
}
