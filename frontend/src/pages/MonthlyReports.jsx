// =====================================================================
// MonthlyReports — dashboard for per-employee monthly attendance +
// payroll reports.
//
// Fits the current ERP setup (matches AdminOnboarding / HrAutomation):
//   • Header with Generate CTA
//   • 5 KPI tiles (Employees · Avg Attendance · Deductions · OT Pay · Flagged)
//   • Filter row (Year · Month · Status pill · Force re-sync · Search)
//   • Full-width table — every employee, one row, with drill-in + PDF
//   • Row-detail modal with full breakdown and insights
//
// Backend: /monthly-reports/*  (unchanged — the UI just wires to it).
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";

import styles from "./MonthlyReports.module.css";


const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const fmt1 = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

const inr = (n) => {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

const inr2 = (n) => {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};


// =====================================================================
// Icons
// =====================================================================

function Icon({ name, size = 18, color = "currentColor", strokeWidth = 1.8 }) {
  const p = {
    width: size, height: size,
    viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth,
    strokeLinecap: "round", strokeLinejoin: "round",
  };
  switch (name) {
    case "report":
      return (
        <svg {...p}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8M16 17H8M10 9H8" />
        </svg>
      );
    case "users":
      return (
        <svg {...p}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "trending-down":
      return (
        <svg {...p}>
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
          <polyline points="17 18 23 18 23 12" />
        </svg>
      );
    case "trending-up":
      return (
        <svg {...p}>
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case "flag":
      return (
        <svg {...p}>
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      );
    case "download":
      return (
        <svg {...p}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case "eye":
      return (
        <svg {...p}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...p}>
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case "close":
      return (
        <svg {...p}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "play":
      return (
        <svg {...p}>
          <polygon points="5 3 19 12 5 21 5 3" fill={color} />
        </svg>
      );
    case "search":
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "trash":
      return (
        <svg {...p}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      );
    default:
      return null;
  }
}


// =====================================================================
// Small atoms
// =====================================================================

function KpiTile({ iconName, label, value, sub, tone }) {
  return (
    <div className={`${styles.kpi} ${styles[`kpi_${tone}`]}`}>
      <div className={styles.kpiIcon}>
        <Icon name={iconName} size={22} />
      </div>
      <div className={styles.kpiBody}>
        <div className={styles.kpiLabel}>{label}</div>
        <div className={styles.kpiValue}>{value}</div>
        {sub && <div className={styles.kpiSub}>{sub}</div>}
      </div>
    </div>
  );
}


function StatusPill({ meta }) {
  if (!meta) return null;
  let label = "Draft";
  let tone  = "grey";
  if (meta.auto_locked)   { label = "Final · auto-locked"; tone = "green"; }
  else if (meta.is_future){ label = "Future month";        tone = "grey";  }
  else if (meta.is_current){ label = "Live · partial";      tone = "amber"; }
  else if (meta.is_past)  { label = "Past — awaiting lock"; tone = "blue"; }
  return (
    <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>
      {label}
    </span>
  );
}


function AttendanceBar({ pct }) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  const tone = clamped >= 90 ? "#16a34a"
             : clamped >= 75 ? "#d97706"
             : "#dc2626";
  return (
    <div className={styles.attTrack}>
      <div
        className={styles.attFill}
        style={{ width: `${clamped}%`, background: tone }}
      />
      <span className={styles.attText}>{clamped}%</span>
    </div>
  );
}


// =====================================================================
// Row detail modal
// =====================================================================

function DetailModal({ row, onClose, onDownload }) {
  if (!row) return null;
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modalPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalEyebrow}>
              {MONTHS[row.month - 1]} {row.year} · {row.employee_code}
            </div>
            <div className={styles.modalTitle}>{row.employee_name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.modalCloseBtn}
            title="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className={styles.modalBody}>

          {/* Days breakdown */}
          <section className={styles.detailSection}>
            <div className={styles.detailTitle}>Attendance</div>
            <div className={styles.detailGrid}>
              <StatBox label="Working Days"     value={row.working_days} />
              <StatBox label="Present"          value={fmt1(row.present_days)} tone="green" />
              <StatBox label="Absent"           value={fmt1(row.absent_days)}  tone="red" />
              <StatBox label="Half Days"        value={fmt1(row.half_days)} />
              <StatBox label="Late Arrivals"    value={row.late_count}
                       tone={row.late_count >= 5 ? "red" : ""} />
              <StatBox label="Early Exits"      value={row.early_exit_count} />
              <StatBox label="Holidays"         value={row.holidays} />
              <StatBox label="Sundays"          value={row.sundays} />
            </div>
          </section>

          {/* Leaves */}
          <section className={styles.detailSection}>
            <div className={styles.detailTitle}>Leaves</div>
            <div className={styles.detailGrid}>
              <StatBox label="CL Used"          value={fmt1(row.cl_used)} />
              <StatBox label="SL Used"          value={fmt1(row.sick_used)} />
              <StatBox label="EL Used"          value={fmt1(row.earned_used)} />
              <StatBox label="Paid Leaves"      value={fmt1(row.paid_leaves)} />
              <StatBox label="Unpaid Leaves"    value={fmt1(row.unpaid_leaves)} tone="red" />
              <StatBox label="Excess Leaves"    value={fmt1(row.excess_leaves)}
                       tone={row.excess_leaves > 0 ? "red" : ""} />
            </div>
          </section>

          {/* Hours */}
          <section className={styles.detailSection}>
            <div className={styles.detailTitle}>Hours</div>
            <div className={styles.detailGrid}>
              <StatBox label="Worked Hours"     value={fmt1(row.worked_hours)} />
              <StatBox label="Expected Hours"   value={fmt1(row.expected_hours)} />
              <StatBox label="OT Hours"         value={fmt1(row.overtime_hours)}
                       tone={row.overtime_hours > 0 ? "green" : ""} />
              <StatBox label="Hour Compliance"  value={`${fmt1(row.hour_compliance_pct)}%`} />
            </div>
          </section>

          {/* Money */}
          <section className={styles.detailSection}>
            <div className={styles.detailTitle}>Payroll Impact</div>
            <table className={styles.moneyTable}>
              <tbody>
                <tr>
                  <td>Monthly Salary</td>
                  <td>{inr2(row.monthly_salary)}</td>
                </tr>
                <tr>
                  <td>Daily Wage</td>
                  <td>{inr2(row.daily_wage)}</td>
                </tr>
                <tr className={styles.moneyRowNeg}>
                  <td>Absence Deduction</td>
                  <td>− {inr2(row.absence_deduction)}</td>
                </tr>
                <tr className={styles.moneyRowNeg}>
                  <td>Late Deduction</td>
                  <td>− {inr2(row.late_deduction)}</td>
                </tr>
                <tr className={styles.moneyRowPos}>
                  <td>OT Payable</td>
                  <td>+ {inr2(row.ot_payable)}</td>
                </tr>
                <tr className={styles.moneyRowTotal}>
                  <td><strong>Net Payable</strong></td>
                  <td><strong>{inr2(row.net_payable)}</strong></td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* Insights */}
          {row.insights && row.insights.length > 0 && (
            <section className={styles.detailSection}>
              <div className={styles.detailTitle}>Insights</div>
              <ul className={styles.insightList}>
                {row.insights.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          <div className={styles.modalFooter}>
            <button
              type="button"
              onClick={() => onDownload(row.employee_id)}
              className={styles.btnPrimary}
            >
              <Icon name="download" size={14} />
              <span>Download PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function StatBox({ label, value, tone }) {
  return (
    <div className={`${styles.statBox} ${tone ? styles[`stat_${tone}`] : ""}`}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}


// =====================================================================
// Main page
// =====================================================================

export default function MonthlyReports() {

  const today = new Date();
  // Default to the CURRENT month — HR usually opens this page right
  // after running payroll for the ongoing month via Biometric Import.
  const defMonth = today.getMonth() + 1;     // JS getMonth is 0-based
  const defYear  = today.getFullYear();

  const [year,       setYear]       = useState(defYear);
  const [month,      setMonth]      = useState(defMonth);
  const [rows,       setRows]       = useState([]);
  const [meta,       setMeta]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [generating, setGenerating] = useState(false);
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState(null);
  const [toast,      setToast]      = useState("");

  // ---- Load ---------------------------------------------------------

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const { data } = await API.get("/monthly-reports",
        { params: { year, month, force } });
      setRows(data?.reports || []);
      setMeta(data?.meta || null);
    } catch (err) {
      setToast(err?.response?.data?.detail || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);


  // ---- Actions ------------------------------------------------------

  const generateAll = async () => {
    setGenerating(true);
    setToast("");
    try {
      const { data } = await API.post("/monthly-reports/generate", { year, month });
      setToast(`Generated / refreshed reports for ${data?.employees_processed ?? 0} employees.`);
      await load(true);
    } catch (err) {
      setToast(err?.response?.data?.detail || "Failed to generate reports");
    } finally {
      setGenerating(false);
    }
  };

  const forceResync = async () => {
    setGenerating(true);
    try { await load(true); }
    finally { setGenerating(false); }
  };

  const regenerateOne = async (emp_id) => {
    try {
      await API.post(`/monthly-reports/${emp_id}/generate`, { year, month });
      await load();
      setToast("Report refreshed.");
    } catch (err) {
      setToast(err?.response?.data?.detail || "Regenerate failed");
    }
  };

  const deleteOne = async (row) => {
    const label = `${row.employee_name} — ${MONTHS[row.month - 1]} ${row.year}`;
    if (!window.confirm(`Delete this report?\n\n${label}\n\nThis removes the row only; attendance and leave data stays. You can re-generate anytime.`)) {
      return;
    }
    try {
      await API.delete(`/monthly-reports/${row.employee_id}`, {
        params: { year, month },
      });
      await load();
      setToast(`Deleted report for ${row.employee_name}.`);
    } catch (err) {
      setToast(err?.response?.data?.detail || "Delete failed");
    }
  };

  const downloadPdf = (emp_id) => {
    const token = localStorage.getItem("token");
    fetch(`${API_BASE_URL}/monthly-reports/${emp_id}/pdf?year=${year}&month=${month}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (r) => {
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
      })
      .catch((e) => setToast(e.message));
  };


  // ---- Derived ------------------------------------------------------

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      (r.employee_name || "").toLowerCase().includes(q)
      || (r.employee_code || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const kpis = useMemo(() => ({
    employees: rows.length,
    avg_attendance: rows.length
      ? Math.round(rows.reduce((s, r) => s + (r.attendance_pct || 0), 0) / rows.length)
      : 0,
    total_deduction: rows.reduce((s, r) =>
      s + (r.absence_deduction || 0) + (r.late_deduction || 0), 0),
    total_ot: rows.reduce((s, r) => s + (r.ot_payable || 0), 0),
    flagged: rows.filter((r) =>
      (r.attendance_pct || 0) < 75
      || (r.late_count || 0) >= 5
      || (r.excess_leaves || 0) > 0
    ).length,
  }), [rows]);


  // ---- Render -------------------------------------------------------

  return (
    <div className={styles.page}>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <Icon name="report" size={22} color="#dc2626" />
          </div>
          <div>
            <div className={styles.eyebrow}>HR · Monthly Reports</div>
            <div className={styles.title}>Automated Monthly Attendance &amp; Payroll Reports</div>
            <div className={styles.subtitle}>
              Per-employee summary · Working days · Leave breakdown · Deductions · Net payable · PDF download
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={generateAll}
          disabled={generating || loading}
          className={styles.btnPrimary}
        >
          <Icon name="play" size={14} />
          <span>{generating ? "Generating…" : "Generate / Refresh All"}</span>
        </button>
      </header>

      {toast && (
        <div className={styles.toast} onClick={() => setToast("")} role="status">
          {toast}
        </div>
      )}

      {/* Filter row */}
      <section className={styles.controls}>
        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={styles.controlInput}
            min="2000"
            max="2100"
            style={{ width: 90 }}
          />
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={styles.controlSelect}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>

        <StatusPill meta={meta} />

        <button
          type="button"
          onClick={forceResync}
          disabled={generating || loading}
          className={styles.btnSecondary}
          title="Bypass the cooldown and rebuild every report for this month"
        >
          <Icon name="refresh" size={14} />
          <span>Force re-sync</span>
        </button>

        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>
            <Icon name="search" size={16} color="#94a3b8" />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee name or code…"
            className={styles.searchInput}
          />
        </div>
      </section>

      {/* KPI row */}
      <section className={styles.kpiGrid}>
        <KpiTile
          iconName="users"
          label="Employees"
          value={kpis.employees}
          sub="Reports generated"
          tone="blue"
        />
        <KpiTile
          iconName="check-circle"
          label="Avg Attendance"
          value={`${kpis.avg_attendance}%`}
          sub={kpis.avg_attendance >= 90 ? "Healthy" : "Watch"}
          tone="green"
        />
        <KpiTile
          iconName="trending-down"
          label="Total Deductions"
          value={inr(kpis.total_deduction)}
          sub="Absence + late"
          tone="red"
        />
        <KpiTile
          iconName="trending-up"
          label="Total OT Pay"
          value={inr(kpis.total_ot)}
          sub="Overtime payable"
          tone="purple"
        />
        <KpiTile
          iconName="flag"
          label="Flagged"
          value={kpis.flagged}
          sub="Need review"
          tone="amber"
        />
      </section>

      {/* Table */}
      <section className={styles.tableCard}>
        {loading && (
          <div className={styles.emptyState}>Loading reports…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className={styles.emptyState}>
            {rows.length === 0
              ? `No reports for ${MONTHS[month - 1]} ${year} yet. Click Generate / Refresh All to build them.`
              : `No employee matches "${search}".`}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Employee</th>
                <th className={styles.thCenter}>Working Days</th>
                <th className={styles.thCenter}>Present</th>
                <th className={styles.thCenter}>Absent</th>
                <th className={styles.thCenter}>Late</th>
                <th className={styles.thCenter}>OT h</th>
                <th className={styles.thCenter}>CL</th>
                <th className={styles.thRight}>Salary</th>
                <th className={styles.thRight}>Deduction</th>
                <th className={styles.thRight}>Net Payable</th>
                <th className={styles.thAtt}>Attendance</th>
                <th className={styles.thAction}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const flagged =
                  (r.attendance_pct || 0) < 75
                  || (r.late_count || 0) >= 5
                  || (r.excess_leaves || 0) > 0;
                return (
                  <tr key={r.id} className={flagged ? styles.rowFlag : ""}>
                    <td>
                      <div className={styles.empName}>{r.employee_name}</div>
                      <div className={styles.empCode}>{r.employee_code || "—"}</div>
                    </td>
                    <td className={styles.tdCenter}>{r.working_days}</td>
                    <td className={styles.tdCenter}>{fmt1(r.present_days)}</td>
                    <td className={styles.tdCenter}>
                      <span className={(r.absent_days || 0) > 2 ? styles.warnNum : ""}>
                        {fmt1(r.absent_days)}
                      </span>
                    </td>
                    <td className={styles.tdCenter}>
                      <span className={(r.late_count || 0) >= 3 ? styles.warnNum : ""}>
                        {r.late_count}
                      </span>
                    </td>
                    <td className={styles.tdCenter}>{fmt1(r.overtime_hours)}</td>
                    <td className={styles.tdCenter}>{fmt1(r.cl_used)}</td>
                    <td className={styles.tdRight}>{inr(r.monthly_salary)}</td>
                    <td className={styles.tdRight}>
                      <span className={styles.negativeNum}>
                        {inr(r.absence_deduction + r.late_deduction)}
                      </span>
                    </td>
                    <td className={styles.tdRight}>
                      <strong>{inr(r.net_payable)}</strong>
                    </td>
                    <td className={styles.tdAtt}>
                      <AttendanceBar pct={r.attendance_pct} />
                    </td>
                    <td className={styles.tdAction}>
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        className={styles.iconBtn}
                        title="View full breakdown"
                      >
                        <Icon name="eye" size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadPdf(r.employee_id)}
                        className={styles.iconBtn}
                        title="Download PDF"
                      >
                        <Icon name="download" size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => regenerateOne(r.employee_id)}
                        className={styles.iconBtn}
                        title="Regenerate this employee's report"
                      >
                        <Icon name="refresh" size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteOne(r)}
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        title="Delete this row"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {selected && (
        <DetailModal
          row={selected}
          onClose={() => setSelected(null)}
          onDownload={downloadPdf}
        />
      )}
    </div>
  );
}
