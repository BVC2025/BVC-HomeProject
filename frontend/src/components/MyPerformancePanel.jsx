// =====================================================================
// MyPerformancePanel — monthly performance dashboard for employees.
// ---------------------------------------------------------------------
// Reads the same star-performance history the admin star board uses:
//   GET /performance/stars/employee/{employee_id}/history
//
// Layout, top → bottom:
//   1. Header — latest month period + AI-computed overall score badge
//   2. Three big stat cards: Attendance · Task completion · Manager rating
//   3. Trend chart — last 6 months, inline SVG bar-chart, no libraries
//   4. Metrics list — Late arrivals · Target completion · Project completion
//                     · Training score · Customer feedback
//   5. AI Overall Score card — weighted-average of the above metrics
//      with a plain-English breakdown so employees see how it's built.
//
// Where the backend doesn't yet track a metric (training, customer
// feedback), the row is shown with a subtle "not tracked yet" label
// so employees know it exists and will populate later.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./MyPerformancePanel.module.css";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  spark:    icon(<path d="M12 2l2.4 6.9L22 10l-6 4.7L18 22l-6-4-6 4 2-7.3L2 10l7.6-1.1z" />),
  clock:    icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  target:   icon(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>),
  chart:    icon(<><path d="M3 3v18h18" /><path d="M8 14l4-4 3 3 5-6" /></>),
  book:     icon(<><path d="M4 4h11a3 3 0 0 1 3 3v14H7a3 3 0 0 1-3-3z" /><path d="M4 4a3 3 0 0 0 3 3h11" /></>),
  heart:    icon(<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />),
  briefcase:icon(<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M2 13h20" /></>),
  empty:    icon(<><path d="M3 3v18h18" /><path d="M8 14l4-4 3 3 5-6" /></>, 30),
};


// ------------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------------

function pct(numer, denom) {
  if (!denom || isNaN(denom)) return 0;
  return Math.max(0, Math.min(100, Math.round((numer / denom) * 100)));
}

function starsPct(stars, cap = 5) {
  const s = Number(stars || 0);
  return Math.max(0, Math.min(100, Math.round((s / cap) * 100)));
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtPeriodShort(row) {
  const m = row?.PAY_MONTH;
  const y = row?.PAY_YEAR;
  if (!m || !y) return "—";
  return `${MONTH_SHORT[m - 1]} '${String(y).slice(-2)}`;
}

function fmtPeriodLong(row) {
  const m = row?.PAY_MONTH;
  const y = row?.PAY_YEAR;
  if (!m || !y) return "—";
  return `${MONTH_SHORT[m - 1]} ${y}`;
}


// ------------------------------------------------------------------
// AI-style overall-score composition
//   attendance 30% · tasks 30% · manager rating 30% · leave/perm 10%
// Each input is normalised to 0-100 first so the final number is 0-100.
// ------------------------------------------------------------------

function computeOverall(row) {
  if (!row) return { score: 0, breakdown: [] };

  const attPct    = starsPct(row.ATTENDANCE_STARS);
  const taskPct   = row.TASKS_ASSIGNED
    ? pct(row.TASKS_COMPLETED, row.TASKS_ASSIGNED)
    : starsPct(row.TASK_STARS);
  const mgrPct    = starsPct(row.OVERALL_STARS);
  const leavePct  = starsPct(row.LEAVE_STARS);

  const score = Math.round(
    attPct * 0.30 + taskPct * 0.30 + mgrPct * 0.30 + leavePct * 0.10
  );

  return {
    score,
    breakdown: [
      { label: "Attendance",        weight: 30, value: attPct   },
      { label: "Task completion",   weight: 30, value: taskPct  },
      { label: "Manager rating",    weight: 30, value: mgrPct   },
      { label: "Leave discipline",  weight: 10, value: leavePct },
    ],
  };
}

function scoreBand(score) {
  if (score >= 85) return { tone: "green",  label: "Excellent" };
  if (score >= 70) return { tone: "green",  label: "On track" };
  if (score >= 50) return { tone: "amber",  label: "Needs focus" };
  return              { tone: "red",    label: "Below target" };
}


// ==================================================================
// Component
// ==================================================================
export default function MyPerformancePanel({ employeeId }) {

  const [data, setData]       = useState(null);   // { employee_id, history: [] }
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  // Which month to show as "current"; defaults to the latest
  const [selectedIdx, setSelectedIdx] = useState(-1);


  // ---- Fetch ----
  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      // Endpoint uses UUID; localStorage.employee_uuid is the UUID.
      // Fall back to the passed-in employeeId (may be CODE) — the
      // route resolves both via the shared helper.
      const uuid =
           (typeof window !== "undefined"
             ? localStorage.getItem("employee_uuid")
             : "")
        || employeeId;
      const res = await API.get(
        `/performance/stars/employee/${encodeURIComponent(uuid)}/history`
      );
      setData(res.data || null);
    } catch (e) {
      if (e?.response?.status === 404) {
        setData({ history: [] });
      } else {
        setError(e?.response?.data?.detail || "Failed to load performance data.");
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);


  // ---- Derived ----
  const history = useMemo(
    () => Array.isArray(data?.history) ? data.history : [],
    [data]
  );

  const latest = useMemo(() => {
    if (history.length === 0) return null;
    return selectedIdx >= 0 ? history[selectedIdx] : history[history.length - 1];
  }, [history, selectedIdx]);

  const overall = useMemo(() => computeOverall(latest), [latest]);
  const band    = useMemo(() => scoreBand(overall.score), [overall.score]);

  // Last 6 months, oldest → newest for the chart
  const last6 = useMemo(() => history.slice(-6), [history]);


  // ==================================================================
  // Render
  // ==================================================================

  if (loading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.loading}>Loading your performance…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className={styles.wrap}>
        <header className={styles.head}>
          <div className={styles.headTitle}>My Performance</div>
        </header>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>{I.empty}</span>
          <div>
            <div className={styles.emptyTitle}>No performance data yet</div>
            <div className={styles.emptyBody}>
              Your monthly performance score appears here after the payroll
              run for the month. Attendance, tasks and manager ratings feed
              into it automatically.
            </div>
          </div>
        </div>
      </div>
    );
  }


  // ---- Metric numbers for the latest month ----
  const attScore   = starsPct(latest.ATTENDANCE_STARS);
  const taskPct    = latest.TASKS_ASSIGNED
    ? pct(latest.TASKS_COMPLETED, latest.TASKS_ASSIGNED)
    : 0;
  const mgrRating  = Number(latest.OVERALL_STARS || 0);
  const lateCount  = Math.max(0, (latest.WORKING_DAYS || 0) - (latest.DAYS_PRESENT || 0) - Math.round(latest.HALF_DAYS || 0));
  const projectPct = pct(latest.TASKS_ON_TIME, latest.TASKS_COMPLETED || latest.TASKS_ASSIGNED);


  return (
    <div className={styles.wrap}>

      {/* ---------- 1. HEADER ---------- */}
      <header className={styles.head}>
        <div>
          <div className={styles.headEyebrow}>My Performance</div>
          <div className={styles.headTitle}>{fmtPeriodLong(latest)}</div>
        </div>

        <div className={`${styles.scoreBadge} ${styles[`band_${band.tone}`]}`}>
          <span className={styles.scoreBadgeLabel}>AI Overall Score</span>
          <span className={styles.scoreBadgeValue}>
            {overall.score}
            <small>/100</small>
          </span>
          <span className={styles.scoreBadgeBand}>{band.label}</span>
        </div>
      </header>


      {/* ---------- 2. STAT CARDS ---------- */}
      <section className={styles.statRow}>

        <StatCard
          icon={I.clock}
          tone="green"
          label="Attendance Score"
          value={`${attScore}%`}
          sub={`${latest.DAYS_PRESENT || 0} / ${latest.WORKING_DAYS || 0} days present`}
          progress={attScore}
        />

        <StatCard
          icon={I.target}
          tone="blue"
          label="Target Completion"
          value={`${taskPct}%`}
          sub={`${latest.TASKS_COMPLETED || 0} of ${latest.TASKS_ASSIGNED || 0} tasks`}
          progress={taskPct}
        />

        <StatCard
          icon={I.spark}
          tone="amber"
          label="Manager Rating"
          value={mgrRating.toFixed(1)}
          sub={<Stars value={mgrRating} />}
          progress={starsPct(mgrRating)}
        />
      </section>


      {/* ---------- 3. TREND CHART ---------- */}
      {last6.length >= 2 && (
        <section className={styles.chartCard}>
          <div className={styles.chartHead}>
            <div className={styles.chartTitle}>Last 6 months</div>
            <div className={styles.chartLegend}>
              <span className={styles.legendDot} /> Overall stars (out of 5)
            </div>
          </div>
          <TrendBars
            data={last6}
            selectedIdx={selectedIdx >= 0
              ? selectedIdx - (history.length - last6.length)
              : last6.length - 1}
            onSelect={(idxIn6) => {
              const absoluteIdx = history.length - last6.length + idxIn6;
              setSelectedIdx(absoluteIdx);
            }}
          />
        </section>
      )}


      {/* ---------- 4. METRICS LIST ---------- */}
      <section className={styles.metricsCard}>
        <div className={styles.metricsHead}>
          <div className={styles.metricsTitle}>Detailed metrics</div>
          <div className={styles.metricsSub}>{fmtPeriodLong(latest)}</div>
        </div>

        <ul className={styles.metricsList}>
          <MetricRow
            icon={I.clock}
            label="Late arrivals"
            value={`${lateCount}`}
            sub={lateCount === 0 ? "Never late this month" : "Days you arrived after 09:00"}
            tone={lateCount === 0 ? "green" : lateCount <= 2 ? "amber" : "red"}
          />
          <MetricRow
            icon={I.target}
            label="Target completion"
            value={`${taskPct}%`}
            sub={`${latest.TASKS_COMPLETED || 0} of ${latest.TASKS_ASSIGNED || 0} tasks closed`}
            tone={taskPct >= 80 ? "green" : taskPct >= 50 ? "amber" : "red"}
          />
          <MetricRow
            icon={I.briefcase}
            label="Project completion (on time)"
            value={`${projectPct}%`}
            sub={
              (latest.TASKS_ON_TIME || 0) > 0
                ? `${latest.TASKS_ON_TIME} of ${latest.TASKS_COMPLETED || 0} completed on schedule`
                : "No on-time closures logged this month"
            }
            tone={projectPct >= 80 ? "green" : projectPct >= 50 ? "amber" : "red"}
          />
          <MetricRow
            icon={I.book}
            label="Training score"
            value="—"
            sub="Populates when LMS integration is live"
            tone="muted"
            softLabel
          />
          <MetricRow
            icon={I.heart}
            label="Customer feedback"
            value="—"
            sub="Populates when CSAT survey feed is connected"
            tone="muted"
            softLabel
          />
        </ul>
      </section>


      {/* ---------- 5. AI OVERALL BREAKDOWN ---------- */}
      <section className={`${styles.overallCard} ${styles[`overallBand_${band.tone}`]}`}>
        <div className={styles.overallHead}>
          <div className={styles.overallLabel}>AI-Generated Overall Score</div>
          <div className={styles.overallValue}>
            {overall.score}
            <small>/ 100</small>
          </div>
          <div className={styles.overallBand}>{band.label}</div>
        </div>

        <div className={styles.overallBreakdown}>
          {overall.breakdown.map((row) => (
            <div key={row.label} className={styles.breakRow}>
              <div className={styles.breakLabel}>
                {row.label}
                <span className={styles.breakWeight}>weight {row.weight}%</span>
              </div>
              <div className={styles.breakBarTrack}>
                <div
                  className={styles.breakBarFill}
                  style={{ width: `${row.value}%` }}
                />
              </div>
              <div className={styles.breakValue}>{row.value}%</div>
            </div>
          ))}
        </div>

        <div className={styles.overallFoot}>
          Score is computed automatically from the metrics above. Managers
          can override the manager-rating input at any time; the score
          re-computes when the monthly payroll run finalises.
        </div>
      </section>

    </div>
  );
}


// ==================================================================
// Sub-components
// ==================================================================

function StatCard({ icon, label, value, sub, progress = 0, tone = "green" }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statHead}>
        <span className={`${styles.statIcon} ${styles[`tint_${tone}`]}`}>
          {icon}
        </span>
        <span className={styles.statLabel}>{label}</span>
      </div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statSub}>{sub}</div>
      <div className={styles.statTrack}>
        <div
          className={`${styles.statFill} ${styles[`fill_${tone}`]}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}


function Stars({ value }) {
  // Five-point rating, halves rendered as half-filled
  const full = Math.floor(value);
  const half = value - full >= 0.25 && value - full < 0.75;
  const capped = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= full || (i === full + 1 && half);
    stars.push(
      <svg key={i} width="12" height="12" viewBox="0 0 24 24"
           fill={filled ? "#f59e0b" : "none"}
           stroke="#f59e0b" strokeWidth="1.6"
           aria-hidden="true">
        <path d="M12 2l2.4 6.9L22 10l-6 4.7L18 22l-6-4-6 4 2-7.3L2 10l7.6-1.1z" />
      </svg>
    );
  }
  return (
    <span className={styles.starsRow}>
      {stars}
      <span className={styles.starsText}>{capped.toFixed(1)} of 5</span>
    </span>
  );
}


function TrendBars({ data, selectedIdx, onSelect }) {
  // Inline SVG bar chart. Height 140, dynamic bar width based on N.
  const W = 460;
  const H = 140;
  const padL = 30, padR = 12, padT = 14, padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const max = 5;           // stars scale
  const step = data.length > 1 ? chartW / data.length : chartW;
  const barW = Math.max(18, step * 0.55);

  // gridlines at 1, 2, 3, 4, 5
  const gridY = (v) => padT + chartH - (v / max) * chartH;

  return (
    <div className={styles.chartFrame}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={styles.chartSvg}
        role="img"
        aria-label="Monthly overall stars over the last six months"
      >
        {/* Horizontal grid lines */}
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line
              x1={padL}      y1={gridY(v)}
              x2={W - padR}  y2={gridY(v)}
              stroke="#eef2f7" strokeWidth="1"
            />
            <text
              x={padL - 6} y={gridY(v) + 3}
              textAnchor="end" fontSize="9" fill="#94a3b8"
              fontFamily="Inter, sans-serif"
            >{v}</text>
          </g>
        ))}

        {/* Bars */}
        {data.map((row, i) => {
          const stars = Number(row.OVERALL_STARS || 0);
          const h = Math.max(2, (stars / max) * chartH);
          const x = padL + i * step + (step - barW) / 2;
          const y = padT + chartH - h;
          const active = i === selectedIdx;
          return (
            <g key={i} className={styles.chartGroup}
               onClick={() => onSelect(i)} style={{ cursor: "pointer" }}>
              <rect
                x={x} y={y} width={barW} height={h}
                rx="4"
                className={`${styles.chartBar} ${active ? styles.chartBar_active : ""}`}
              />
              {/* Star label above the bar */}
              {stars > 0 && (
                <text
                  x={x + barW / 2} y={y - 5}
                  textAnchor="middle" fontSize="10"
                  fill="#0f172a" fontWeight="700"
                  fontFamily="Inter, sans-serif"
                >
                  {stars.toFixed(1)}
                </text>
              )}
              {/* Month label */}
              <text
                x={x + barW / 2} y={H - 6}
                textAnchor="middle" fontSize="10"
                fill={active ? "#dc2626" : "#94a3b8"}
                fontWeight={active ? 700 : 500}
                fontFamily="Inter, sans-serif"
              >
                {fmtPeriodShort(row)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}


function MetricRow({ icon, label, value, sub, tone = "muted", softLabel = false }) {
  return (
    <li className={styles.metricRow}>
      <span className={`${styles.metricIcon} ${styles[`tint_${tone}`]}`}>
        {icon}
      </span>
      <div className={styles.metricBody}>
        <div className={styles.metricLabel}>{label}</div>
        <div className={styles.metricSub}>{sub}</div>
      </div>
      <div className={`${styles.metricValue} ${softLabel ? styles.metricValue_soft : ""}`}>
        {value}
      </div>
    </li>
  );
}
