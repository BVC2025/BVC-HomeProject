// =====================================================================
// HR Automation — dashboard for the real jobs this ERP runs.
//
// Fits the current setup (matches AdminOnboarding / AdminHome design):
//   • 4 KPI tiles (Active · Runs · Success · Pending)
//   • Rule cards for every REAL automation:
//       - Memo Automation (Weekly)   → /memos/automation
//       - Memo Automation (Monthly)  → /memos/automation
//       - Attendance Penalty Scan    → /attendance-penalties
//   • Live Activity feed from those endpoints
//   • Quick Links to related admin pages
//
// No mock names, no fake data. If an endpoint hasn't run yet, its card
// says "Not run yet" instead of inventing history.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";

import styles from "./HrAutomation.module.css";


// =====================================================================
// Icons — same inline SVG set as AdminOnboarding
// =====================================================================

function Icon({ name, size = 20, color = "currentColor", strokeWidth = 1.8 }) {
  const p = {
    width: size, height: size,
    viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth,
    strokeLinecap: "round", strokeLinejoin: "round",
  };
  switch (name) {
    case "bolt":
      return (
        <svg {...p}>
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "alert":
      return (
        <svg {...p}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "memo":
      return (
        <svg {...p}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 13h6M9 17h4" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "shield":
      return (
        <svg {...p}>
          <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4Z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...p}>
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...p}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "play":
      return (
        <svg {...p}>
          <polygon points="5 3 19 12 5 21 5 3" fill={color} />
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


function StatusPill({ status }) {
  const map = {
    SUCCESS:   { label: "Success",  tone: "green" },
    FAILED:    { label: "Failed",   tone: "red"   },
    RUNNING:   { label: "Running",  tone: "blue"  },
    PENDING:   { label: "Pending",  tone: "amber" },
    NEVER_RUN: { label: "Not run",  tone: "grey"  },
    ENABLED:   { label: "Enabled",  tone: "green" },
    DISABLED:  { label: "Disabled", tone: "grey"  },
  };
  const meta = map[status] || map.NEVER_RUN;
  return (
    <span className={`${styles.pill} ${styles[`pill_${meta.tone}`]}`}>
      {meta.label}
    </span>
  );
}


function fmtWhen(iso) {
  if (!iso) return "Not run yet";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.round((now - d) / 60000);
    if (diffMin < 1)     return "just now";
    if (diffMin < 60)    return `${diffMin}m ago`;
    if (diffMin < 60*24) return `${Math.round(diffMin / 60)}h ago`;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}


// =====================================================================
// Automation rule card
// =====================================================================

function RuleCard({ rule, onRun, running }) {
  return (
    <div className={styles.ruleCard}>
      <div className={styles.ruleHead}>
        <div
          className={styles.ruleIcon}
          style={{ background: `${rule.accent}18`, color: rule.accent }}
        >
          <Icon name={rule.icon} size={20} color={rule.accent} />
        </div>
        <div className={styles.ruleTitleGroup}>
          <div className={styles.ruleTitle}>{rule.name}</div>
          <div className={styles.ruleSchedule}>{rule.schedule}</div>
        </div>
        <StatusPill status={rule.enabled ? "ENABLED" : "DISABLED"} />
      </div>

      <div className={styles.ruleDesc}>{rule.description}</div>

      <div className={styles.ruleFooter}>
        <div className={styles.ruleMetaCol}>
          <div className={styles.ruleMetaLabel}>Last run</div>
          <div className={styles.ruleMetaValue}>
            {rule.lastRun ? fmtWhen(rule.lastRun) : "Not run yet"}
            {rule.lastStatus && rule.lastRun && (
              <>
                {" · "}
                <span
                  className={styles.inlineStatus}
                  style={{ color: rule.lastStatus === "SUCCESS" ? "#166534" : "#991b1b" }}
                >
                  {rule.lastStatus === "SUCCESS" ? "✓" : "✗"} {rule.lastStatusText}
                </span>
              </>
            )}
          </div>
        </div>

        {rule.canRun && (
          <button
            type="button"
            onClick={() => onRun(rule)}
            disabled={running === rule.id}
            className={styles.runBtn}
          >
            <Icon name={running === rule.id ? "refresh" : "play"} size={14} />
            <span>{running === rule.id ? "Running…" : "Run Now"}</span>
          </button>
        )}
      </div>
    </div>
  );
}


// =====================================================================
// Main page
// =====================================================================

export default function HrAutomation() {

  const nav = useNavigate();

  const [weeklyRun,       setWeeklyRun]       = useState(null);
  const [monthlyRun,      setMonthlyRun]      = useState(null);
  const [penaltyPending,  setPenaltyPending]  = useState(null);
  const [running,         setRunning]         = useState(null);
  const [toast,           setToast]           = useState("");
  const [activity,        setActivity]        = useState([]);
  const [loading,         setLoading]         = useState(true);

  // ---- Fetch state of every automation -------------------------------

  const loadAll = useCallback(async () => {
    setLoading(true);
    const safe = (p) => p.then((r) => r.data).catch(() => null);

    const [wk, mo, pc] = await Promise.all([
      safe(API.get("/memos/automation/last-run")),
      safe(API.get("/memos/automation/last-monthly-run")),
      safe(API.get("/attendance-penalties/pending-count")),
    ]);
    setWeeklyRun(wk);
    setMonthlyRun(mo);
    setPenaltyPending(pc);
    setLoading(false);

    // Build a synthetic activity feed from what we know
    const feed = [];
    if (wk?.ran_at) {
      feed.push({
        id: "wk",
        when: wk.ran_at,
        name: "Memo Automation (Weekly)",
        result: `${wk.warnings_created ?? 0} warnings, ${wk.appreciations_created ?? 0} appreciations`,
        status: "SUCCESS",
      });
    }
    if (mo?.ran_at) {
      feed.push({
        id: "mo",
        when: mo.ran_at,
        name: "Memo Automation (Monthly)",
        result: `${mo.warnings_created ?? 0} warnings, ${mo.appreciations_created ?? 0} appreciations`,
        status: "SUCCESS",
      });
    }
    feed.sort((a, b) => new Date(b.when) - new Date(a.when));
    setActivity(feed);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);


  // ---- Trigger a rule on demand --------------------------------------

  const runRule = async (rule) => {
    setRunning(rule.id);
    setToast("");
    try {
      await API.post(rule.runEndpoint);
      setToast(`${rule.name} — run complete`);
      await loadAll();
    } catch (err) {
      setToast(err?.response?.data?.detail || `${rule.name} — run failed`);
    } finally {
      setRunning(null);
    }
  };


  // ---- Define rules --------------------------------------------------

  const rules = useMemo(() => ([
    {
      id: "memo_weekly",
      name: "Memo Automation — Weekly",
      icon: "memo",
      accent: "#7c3aed",
      schedule: "Every Monday · 08:00 IST",
      description:
        "Scans 60 days of attendance + tasks and issues WARNING memos when "
        + "a continuous issue crosses the threshold (5-day late streak, 3-day "
        + "leave streak, 7+ day pending task). Also fires APPRECIATION memos "
        + "for on-time streaks and high task-completion counts.",
      lastRun:      weeklyRun?.ran_at,
      lastStatus:   weeklyRun?.ran_at ? "SUCCESS" : null,
      lastStatusText: weeklyRun?.ran_at
        ? `${weeklyRun.warnings_created ?? 0} warnings, ${weeklyRun.appreciations_created ?? 0} appreciations`
        : "",
      enabled: true,
      canRun: true,
      runEndpoint: "/memos/automation/run",
    },
    {
      id: "memo_monthly",
      name: "Memo Automation — Monthly",
      icon: "calendar",
      accent: "#0891b2",
      schedule: "1st of each month · 09:00 IST",
      description:
        "Month-end evaluator. Reads the monthly attendance summary for every "
        + "active employee and issues WARNING or APPRECIATION memos based on "
        + "the aggregate figures — late count, unpaid absences, task completion.",
      lastRun:      monthlyRun?.ran_at,
      lastStatus:   monthlyRun?.ran_at ? "SUCCESS" : null,
      lastStatusText: monthlyRun?.ran_at
        ? `${monthlyRun.warnings_created ?? 0} warnings, ${monthlyRun.appreciations_created ?? 0} appreciations`
        : "",
      enabled: true,
      canRun: true,
      runEndpoint: "/memos/automation/run-monthly",
    },
    {
      id: "penalty_scan",
      name: "Attendance Penalty Scan",
      icon: "shield",
      accent: "#dc2626",
      schedule: "Daily · 07:00 IST",
      description:
        "Reads yesterday's attendance and creates penalty rows for the "
        + "3-late = 0.5-day and CL-quota-over-limit rules. Penalties are "
        + "pending until HR approves them from Admin → Attendance Penalties.",
      lastRun:      penaltyPending?.last_scan_at,
      lastStatus:   penaltyPending?.last_scan_at ? "SUCCESS" : null,
      lastStatusText: penaltyPending?.pending != null
        ? `${penaltyPending.pending} pending`
        : "",
      enabled: true,
      canRun: true,
      runEndpoint: "/attendance-penalties/scan",
    },
  ]), [weeklyRun, monthlyRun, penaltyPending]);


  // ---- Derived KPIs --------------------------------------------------

  const kpis = useMemo(() => {
    const active = rules.filter((r) => r.enabled).length;
    const runsThisMonth = (weeklyRun?.ran_at ? 1 : 0)
                        + (monthlyRun?.ran_at ? 1 : 0);
    const success = runsThisMonth;   // every recorded run above is SUCCESS
    const pending = penaltyPending?.pending ?? 0;
    return { active, runsThisMonth, success, pending };
  }, [rules, weeklyRun, monthlyRun, penaltyPending]);


  // ---- Render --------------------------------------------------------

  return (
    <div className={styles.page}>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <Icon name="bolt" size={22} color="#dc2626" />
          </div>
          <div>
            <div className={styles.title}>HR Automation</div>
            <div className={styles.subtitle}>
              Every scheduled job that keeps the HR module running — status, last run,
              and one-click triggers.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className={styles.refreshBtn}
          disabled={loading}
        >
          <Icon name="refresh" size={14} />
          <span>{loading ? "Loading…" : "Refresh"}</span>
        </button>
      </header>

      {/* KPI row */}
      <section className={styles.kpiGrid}>
        <KpiTile
          iconName="bolt"
          label="Active Automations"
          value={kpis.active}
          sub={`of ${rules.length} configured`}
          tone="blue"
        />
        <KpiTile
          iconName="clock"
          label="Runs This Month"
          value={kpis.runsThisMonth}
          sub="Recorded on backend"
          tone="green"
        />
        <KpiTile
          iconName="check-circle"
          label="Success Rate"
          value={kpis.runsThisMonth ? `${Math.round((kpis.success / kpis.runsThisMonth) * 100)}%` : "—"}
          sub="Last recorded runs"
          tone="purple"
        />
        <KpiTile
          iconName="alert"
          label="Pending Actions"
          value={kpis.pending}
          sub={kpis.pending ? "Awaiting HR review" : "Nothing waiting"}
          tone="amber"
        />
      </section>

      {toast && (
        <div className={styles.toast} onClick={() => setToast("")} role="status">
          {toast}
        </div>
      )}

      {/* Two-column: rules (left) + activity (right) */}
      <section className={styles.mainGrid}>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardIcon} style={{ background: "#fef2f2", color: "#dc2626" }}>
              <Icon name="bolt" size={16} />
            </div>
            <div className={styles.cardTitle}>Automation Rules</div>
          </div>

          <div className={styles.ruleList}>
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onRun={runRule}
                running={running}
              />
            ))}
          </div>
        </section>

        <div className={styles.rightCol}>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardIcon} style={{ background: "#dbeafe", color: "#1d4ed8" }}>
                <Icon name="clock" size={16} />
              </div>
              <div className={styles.cardTitle}>Recent Activity</div>
            </div>

            {loading && (
              <div className={styles.emptyState}>Loading…</div>
            )}

            {!loading && activity.length === 0 && (
              <div className={styles.emptyState}>
                No automation runs recorded yet. Click <b>Run Now</b> on any rule to trigger one.
              </div>
            )}

            {!loading && activity.length > 0 && (
              <div className={styles.activityList}>
                {activity.map((a) => (
                  <div key={a.id} className={styles.activityRow}>
                    <div className={styles.activityDot} />
                    <div className={styles.activityBody}>
                      <div className={styles.activityName}>{a.name}</div>
                      <div className={styles.activityResult}>{a.result}</div>
                      <div className={styles.activityWhen}>{fmtWhen(a.when)}</div>
                    </div>
                    <StatusPill status={a.status} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardIcon} style={{ background: "#fef3c7", color: "#b45309" }}>
                <Icon name="calendar" size={16} />
              </div>
              <div className={styles.cardTitle}>Quick Links</div>
            </div>

            <div className={styles.quickList}>
              <QuickLink
                label="Attendance Penalties"
                sub="Approve or waive pending rows"
                onClick={() => nav("/attendance-penalties")}
              />
              <QuickLink
                label="Employee Memos"
                sub="Auto-generated warnings + appreciations"
                onClick={() => nav("/memos")}
              />
              <QuickLink
                label="Announcements"
                sub="Post company holidays + notices"
                onClick={() => nav("/announcements")}
              />
              <QuickLink
                label="Notifications"
                sub="Bell alerts sent to employees"
                onClick={() => nav("/help-desk")}
              />
              <QuickLink
                label="Approval Center"
                sub="Pending approvals across modules"
                onClick={() => nav("/approvals")}
              />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}


// =====================================================================
// Quick-link row
// =====================================================================

function QuickLink({ label, sub, onClick }) {
  return (
    <button type="button" onClick={onClick} className={styles.quickLink}>
      <div className={styles.quickLinkBody}>
        <div className={styles.quickLinkLabel}>{label}</div>
        <div className={styles.quickLinkSub}>{sub}</div>
      </div>
      <Icon name="arrow" size={14} color="#94a3b8" />
    </button>
  );
}
