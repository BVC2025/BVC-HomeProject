// =====================================================================
// EmployeeHomeDashboard
// ---------------------------------------------------------------------
// New landing content for the Employee Self-Service portal — replaces
// the "attendance panel" default landing with a proper overview:
//   • Welcome band with today's date + attendance status
//   • Summary cards (attendance / leave balance / salary / tasks)
//   • Quick actions (Apply Leave / Payslip / Attendance / Profile)
//   • Activity timeline (from portal-dashboard payload)
// Reads data already fetched by EmployeeDashboard — no new endpoints.
// =====================================================================

import { useMemo } from "react";
import styles from "./EmployeeHomeDashboard.module.css";
import { API_BASE_URL } from "../services/api";


// -----------------------------------------------------------------
// SVG icons (kept inline to avoid an external icon dependency)
// -----------------------------------------------------------------
const svg = (children, size = 20) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
       stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const I = {
  clock:    svg(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>),
  leave:    svg(<><path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></>),
  rupee:    svg(<><path d="M6 3h12"/><path d="M6 8h12"/><path d="M6 13l8.5 8"/><path d="M6 13h3a5 5 0 0 0 0-10"/></>),
  tasks:    svg(<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>),
  arrow:    svg(<><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></>, 16),
  spark:    svg(<><path d="M12 2l2.4 6.9L22 10l-6 4.7L18 22l-6-4-6 4 2-7.3L2 10l7.6-1.1z"/></>),
  bell:     svg(<><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z"/><path d="M10 21h4"/></>),
  calendar: svg(<><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></>),
  play:     svg(<><path d="M9 5l10 7-10 7V5z"/></>, 14),
  megaphone: svg(<><path d="M3 11v2l14 6V5L3 11z"/><path d="M17 8v8"/><path d="M6 13v4a3 3 0 0 0 6 0v-1"/></>),
  users:    svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>),
};


function inr(n) {
  const v = Number(n || 0);
  return "₹ " + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}


// -----------------------------------------------------------------
// Card primitives
// -----------------------------------------------------------------
function KpiCard({ label, value, sub, tone = "primary", icon }) {
  const toneClass = styles[`kpi_${tone}`] || "";
  return (
    <div className={`${styles.kpi} ${toneClass}`}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiIcon}>{icon}</span>
        <span className={styles.kpiLabel}>{label}</span>
      </div>
      <div className={styles.kpiValue}>{value}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </div>
  );
}

function QuickAction({ icon, label, onClick, tone = "primary" }) {
  return (
    <button type="button"
      className={`${styles.quick} ${styles[`quick_${tone}`] || ""}`}
      onClick={onClick}
    >
      <span className={styles.quickIcon}>{icon}</span>
      <span className={styles.quickLabel}>{label}</span>
      <span className={styles.quickArrow}>{I.arrow}</span>
    </button>
  );
}


// -----------------------------------------------------------------
// Component
// -----------------------------------------------------------------
export default function EmployeeHomeDashboard({
  portal,
  attendanceStatus,
  loginTime,
  productivity,
  leaveBalance,
  unreadCount = 0,
  overdueCount = 0,
  onNavigate,
}) {

  // ---- Identity ----
  const identity = useMemo(() => {
    const name = (localStorage.getItem("employee_name") || "there").trim();
    const first = name.split(/\s+/)[0];
    const photo = localStorage.getItem("employee_photo") || "";
    const dept  = localStorage.getItem("employee_department") || "";
    const desig = localStorage.getItem("employee_designation") || "";
    const code  = localStorage.getItem("employee_code") || "";
    return { name, first, photo, dept, desig, code };
  }, []);

  const photoUrl = identity.photo
    ? (identity.photo.startsWith("http")
        ? identity.photo
        : `${API_BASE_URL}${identity.photo}`)
    : null;

  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // ---- Derived data (from portal payload) ----
  const p = portal || {};
  const workingHoursToday = p.working_hours_today ?? p.hours_today ?? null;
  const monthPresent = p.month_present ?? p.attendance?.present ?? null;
  const monthWorking = p.month_working_days ?? p.attendance?.working_days ?? null;
  const attendancePct = (monthPresent != null && monthWorking)
    ? Math.round((monthPresent / monthWorking) * 100)
    : null;

  const clBalance = leaveBalance?.CL ?? leaveBalance?.cl ?? null;
  const totalLeaveAvail = leaveBalance
    ? Object.values(leaveBalance).reduce((s, v) => s + (Number(v) || 0), 0)
    : null;

  const lastSalary = p.last_salary_net ?? p.last_net_pay ?? p.last_salary ?? null;
  const lastSalaryPeriod = p.last_salary_period || p.last_pay_period || "Latest";

  const pendingTasks = p.pending_task_count ?? p.pending_tasks ?? null;

  const activity = Array.isArray(p.recent_activity) ? p.recent_activity : [];
  const events   = Array.isArray(p.upcoming_events) ? p.upcoming_events : [];

  // ---- Attendance status colour ----
  const statusTone = useMemo(() => {
    const s = (attendanceStatus || "").toUpperCase();
    if (s === "PRESENT" || s === "CHECKED_IN")  return "success";
    if (s === "LATE")                            return "warning";
    if (s === "ABSENT")                          return "danger";
    if (s === "ON_LEAVE" || s === "LEAVE")       return "info";
    return "muted";
  }, [attendanceStatus]);

  const statusLabel = useMemo(() => {
    const s = (attendanceStatus || "").toUpperCase();
    if (!s) return "Not checked in";
    return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, [attendanceStatus]);

  // ---- Render ----
  return (
    <div className={styles.home}>

      {/* ============ WELCOME BAND ============ */}
      <section className={styles.hero}>
        <div className={styles.heroAvatar}>
          {photoUrl
            ? <img src={photoUrl} alt="" />
            : <span>{(identity.first || "?").charAt(0)}</span>}
        </div>
        <div className={styles.heroText}>
          <div className={styles.heroEyebrow}>{dateLabel}</div>
          <h1 className={styles.heroTitle}>Welcome back, {identity.first}</h1>
          <div className={styles.heroMeta}>
            {[identity.desig, identity.dept, identity.code].filter(Boolean).join("  ·  ") || "Employee"}
          </div>
        </div>
        <div className={styles.heroStatus}>
          <div className={`${styles.heroStatusPill} ${styles[`status_${statusTone}`]}`}>
            <span className={styles.heroStatusDot} />
            {statusLabel}
          </div>
          {loginTime && (
            <div className={styles.heroStatusMeta}>Check-in {loginTime}</div>
          )}
        </div>
      </section>

      {/* ============ SUMMARY CARDS ============ */}
      <section className={styles.kpis}>
        <KpiCard
          label="Today"
          value={workingHoursToday != null ? `${workingHoursToday.toFixed?.(1) ?? workingHoursToday} h` : "—"}
          sub={loginTime ? `Since ${loginTime}` : "Not checked in"}
          tone="primary"
          icon={I.clock}
        />
        <KpiCard
          label="Attendance"
          value={attendancePct != null ? `${attendancePct}%` : "—"}
          sub={monthPresent != null ? `${monthPresent} / ${monthWorking} days` : "This month"}
          tone="success"
          icon={I.spark}
        />
        <KpiCard
          label="Leave balance"
          value={totalLeaveAvail != null ? `${totalLeaveAvail}` : "—"}
          sub={clBalance != null ? `${clBalance} CL available` : "days available"}
          tone="info"
          icon={I.leave}
        />
        <KpiCard
          label="Last salary"
          value={lastSalary != null ? inr(lastSalary) : "—"}
          sub={lastSalaryPeriod}
          tone="gold"
          icon={I.rupee}
        />
        <KpiCard
          label="Pending tasks"
          value={pendingTasks != null ? pendingTasks : "—"}
          sub={overdueCount > 0 ? `${overdueCount} overdue` : "on track"}
          tone={overdueCount > 0 ? "warning" : "muted"}
          icon={I.tasks}
        />
        <KpiCard
          label="Notifications"
          value={unreadCount}
          sub={unreadCount > 0 ? "unread" : "all caught up"}
          tone={unreadCount > 0 ? "warning" : "muted"}
          icon={I.bell}
        />
      </section>

      {/* ============ QUICK ACTIONS ============ */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>Quick actions</div>
          <div className={styles.sectionSub}>Frequent tasks, one click away</div>
        </div>
        <div className={styles.quickGrid}>
          <QuickAction tone="primary" icon={I.leave}    label="Apply Leave"      onClick={() => onNavigate?.("leave")} />
          <QuickAction tone="success" icon={I.rupee}    label="Download Payslip" onClick={() => onNavigate?.("payslips")} />
          <QuickAction tone="info"    icon={I.clock}    label="View Attendance"  onClick={() => onNavigate?.("attendance")} />
          <QuickAction tone="warning" icon={I.tasks}    label="Open Tasks"       onClick={() => onNavigate?.("tasks")} />
          <QuickAction tone="muted"   icon={I.megaphone} label="Company Memos"    onClick={() => onNavigate?.("memos")} />
          <QuickAction tone="muted"   icon={I.calendar} label="Permission"       onClick={() => onNavigate?.("permission")} />
        </div>
      </section>

      {/* ============ ACTIVITY + EVENTS ============ */}
      <section className={styles.twoCol}>

        {/* -- Recent activity -- */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.panelTitle}>Recent activity</div>
            <div className={styles.panelSub}>Last 5 events</div>
          </div>
          <div className={styles.panelBody}>
            {activity.length === 0 ? (
              <div className={styles.empty}>Nothing here yet — your check-ins, leave, and payslips will appear here.</div>
            ) : (
              <ul className={styles.timeline}>
                {activity.slice(0, 5).map((a, i) => (
                  <li key={i} className={styles.timelineRow}>
                    <span className={styles.timelineDot} />
                    <div className={styles.timelineBody}>
                      <div className={styles.timelineTitle}>{a.title || a.type || "Update"}</div>
                      {a.detail && <div className={styles.timelineDetail}>{a.detail}</div>}
                    </div>
                    <div className={styles.timelineWhen}>{a.when || a.date || ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* -- Upcoming events -- */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.panelTitle}>Upcoming</div>
            <div className={styles.panelSub}>Birthdays · Anniversaries · Holidays</div>
          </div>
          <div className={styles.panelBody}>
            {events.length === 0 ? (
              <div className={styles.empty}>No upcoming events in the next 14 days.</div>
            ) : (
              <ul className={styles.eventList}>
                {events.slice(0, 6).map((e, i) => (
                  <li key={i} className={styles.eventRow}>
                    <div className={styles.eventDate}>
                      <div className={styles.eventDay}>{e.day || "—"}</div>
                      <div className={styles.eventMon}>{e.month || ""}</div>
                    </div>
                    <div className={styles.eventBody}>
                      <div className={styles.eventTitle}>{e.title || "—"}</div>
                      <div className={styles.eventKind}>{e.kind || e.type || ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </section>

    </div>
  );
}
