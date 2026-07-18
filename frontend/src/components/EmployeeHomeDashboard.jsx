// =====================================================================
// EmployeeHomeDashboard
// ---------------------------------------------------------------------
// A modern, at-a-glance employee landing page — deliberately different
// from the KPI-grid feel of every corporate ERP. All navigation lives
// in the sidebar, so this page shows only what an employee needs to
// know the instant they log in:
//
//   1. Personal welcome band (photo + name + today's date)
//   2. Three quick-glance cards: Attendance / Leaves / Tasks
//   3. Today's tasks list (60%) + Upcoming events (40%)
//   4. Recent announcements
//   5. Productivity progress (subtle, one line — not a chart wall)
//
// Design language:
//   - Cream/off-white page background so cards read as elevated white.
//   - Cards: rounded 14px, 1px slate-200 border, no drop shadow by
//     default; a subtle shadow appears on hover for actionable cards.
//   - Typography: Inter with a system fallback.
//   - Colour: BVC red is used ONLY for the employee's name, the
//     Late chip, and the small progress fill. Everything else is
//     slate/neutral so the accent lands.
//   - Framer-motion: 350ms fade+rise per section on mount; no idle
//     loops, no character animation.
// =====================================================================

import { useMemo } from "react";
import { motion } from "framer-motion";

import { API_BASE_URL } from "../services/api";
import styles from "./EmployeeHomeDashboard.module.css";


// ------------------------------------------------------------------
// Formatting utilities
// ------------------------------------------------------------------

function formatCheckIn(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch {
    return String(value);
  }
}

// localStorage.setItem coerces `null` to the STRING "null", so a
// naive filter(Boolean) leaves it in. Drop those literal strings.
function clean(v) {
  const s = (v || "").trim();
  if (!s || s === "null" || s === "undefined") return "";
  return s;
}

const ROLE_NAMES = new Set([
  "ADMIN", "SUPER_ADMIN", "HR", "MANAGER", "PRODUCTION_HEAD",
  "EMPLOYEE",
  "MANAGING_DIRECTOR", "HR_MANAGER", "SALES_MANAGER",
  "PURCHASE_MANAGER", "PRODUCTION_MANAGER", "INVENTORY_MANAGER",
  "ACCOUNTS_MANAGER",
]);

function notARole(v) {
  const s = (v || "").trim();
  if (!s) return "";
  return ROLE_NAMES.has(s.toUpperCase()) ? "" : s;
}

function statusInfo(raw) {
  const s = (raw || "").toUpperCase();
  if (s === "PRESENT" || s === "CHECKED_IN") return { tone: "success", label: "Present" };
  if (s === "LATE")                           return { tone: "warning", label: "Late" };
  if (s === "ABSENT")                         return { tone: "danger",  label: "Absent" };
  if (s === "ON_LEAVE" || s === "LEAVE")      return { tone: "info",    label: "On leave" };
  if (!s)                                     return { tone: "muted",   label: "Not checked in" };
  return {
    tone: "muted",
    label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

function formatEventDate(e) {
  // Accept a variety of shapes: {day, month}, {date: ISO}, {when: str}
  if (e.day && e.month) return { day: String(e.day), month: String(e.month) };
  const raw = e.date || e.when || e.event_date || e.starts_at;
  if (!raw) return { day: "—", month: "" };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { day: String(raw).slice(0, 3), month: "" };
  return {
    day: String(d.getDate()),
    month: d.toLocaleString("en-IN", { month: "short" }).toUpperCase(),
  };
}


// ------------------------------------------------------------------
// Icon inventory — small stroke SVGs, inherit currentColor
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  clock:      icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  calendar:   icon(<><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></>),
  check:      icon(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  bell:       icon(<><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z" /><path d="M10 21h4" /></>),
  chart:      icon(<><path d="M3 3v18h18" /><path d="M8 14l4-4 3 3 5-6" /></>),
  chevron:    icon(<path d="M9 6l6 6-6 6" />, 14),
  dot:        icon(<circle cx="12" cy="12" r="3" fill="currentColor" />, 8),
};


// ==================================================================
// Component
// ==================================================================

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
    const name  = clean(localStorage.getItem("employee_name")) || "there";
    const first = name.split(/\s+/)[0];
    const cachedPhoto = clean(localStorage.getItem("employee_photo"));
    const portalPhoto = portal?.employee?.PHOTO_URL || portal?.PHOTO_URL || "";
    const photo = cachedPhoto || portalPhoto;
    const dept  = clean(localStorage.getItem("employee_department"))
               || clean(localStorage.getItem("department"));
    const desig = clean(localStorage.getItem("employee_designation"));
    const code  = clean(localStorage.getItem("employee_code"))
               || clean(localStorage.getItem("employee_id"));
    return { name, first, photo, dept, desig, code };
  }, [portal]);

  const photoUrl = identity.photo
    ? (identity.photo.startsWith("http")
        ? identity.photo
        : `${API_BASE_URL}${identity.photo}`)
    : null;

  // ---- Today / status / check-in ----
  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const status = statusInfo(attendanceStatus);
  const checkInText = formatCheckIn(loginTime);

  // Subtitle — strip role names, always prefix with Employee
  const subtitleParts = ["Employee"];
  const realDesig = notARole(identity.desig);
  const realDept  = notARole(identity.dept);
  if (realDesig)     subtitleParts.push(realDesig);
  if (realDept)      subtitleParts.push(realDept);
  if (identity.code) subtitleParts.push(identity.code);
  const subtitle = subtitleParts.join(" · ");


  // ------------------------------------------------------------------
  // Derived portal data — every field is optional. Empty states are
  // handled below so the page never looks broken on a fresh account.
  // ------------------------------------------------------------------
  const p = portal || {};

  const workingHoursToday = p.working_hours_today ?? p.hours_today ?? null;
  const monthPresent      = p.month_present ?? p.attendance?.present ?? null;
  const monthWorking      = p.month_working_days ?? p.attendance?.working_days ?? null;
  const attendancePct = (monthPresent != null && monthWorking)
    ? Math.round((monthPresent / monthWorking) * 100)
    : null;

  const totalLeave = leaveBalance
    ? Object.values(leaveBalance).reduce((s, v) => s + (Number(v) || 0), 0)
    : null;
  const clBalance = leaveBalance?.CL ?? leaveBalance?.cl ?? null;

  const pendingTasksCount = p.pending_task_count ?? p.pending_tasks ?? 0;

  // Task list — accept multiple back-end shapes
  const todayTasks = Array.isArray(p.today_tasks)
    ? p.today_tasks
    : Array.isArray(p.pending_tasks_list)
      ? p.pending_tasks_list
      : Array.isArray(p.tasks)
        ? p.tasks
        : [];

  // Events — birthdays, holidays, approved leaves
  const events = Array.isArray(p.upcoming_events) ? p.upcoming_events : [];

  // Announcements / memos — fall back to filtering recent_activity
  const activity = Array.isArray(p.recent_activity) ? p.recent_activity : [];
  const announcements = Array.isArray(p.announcements)
    ? p.announcements
    : activity.filter((a) => {
        const k = (a.type || a.kind || "").toLowerCase();
        return k.includes("memo") || k.includes("announce") || k.includes("notice");
      });

  const prodScore =
    typeof productivity === "number"    ? productivity :
    productivity?.score    != null      ? productivity.score :
    productivity?.percent  != null      ? productivity.percent :
    null;

  // Section entrance — one function, staggered delays
  const rise = (delay = 0) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, ease: "easeOut", delay },
  });


  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className={styles.home}>

      {/* ==================== 1. WELCOME ==================== */}
      <motion.section className={styles.welcome} {...rise(0)}>

        <div className={styles.welcomeMain}>
          <div className={styles.avatar}>
            {photoUrl
              ? <img src={photoUrl} alt="" />
              : <span>{(identity.first || "?").charAt(0).toUpperCase()}</span>}
          </div>

          <div className={styles.welcomeText}>
            <div className={styles.welcomeDate}>{dateLabel}</div>
            <h1 className={styles.welcomeTitle}>
              Welcome back, <span>{identity.first}</span>
            </h1>
            <div className={styles.welcomeSubtitle}>{subtitle}</div>
          </div>
        </div>

        <div className={styles.welcomeMeta}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Status</span>
            <span className={`${styles.chip} ${styles[`chip_${status.tone}`]}`}>
              <span className={styles.chipDot} />
              {status.label}
            </span>
          </div>
          {checkInText && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Check-in</span>
              <span className={styles.metaValue}>{checkInText}</span>
            </div>
          )}
        </div>
      </motion.section>


      {/* ==================== 2. STAT CARDS ==================== */}
      <motion.section className={styles.statRow} {...rise(0.06)}>

        {/* Attendance */}
        <button
          type="button"
          className={styles.statCard}
          onClick={() => onNavigate?.("attendance")}
        >
          <div className={styles.statHead}>
            <span className={`${styles.statIcon} ${styles.tint_green}`}>
              {I.clock}
            </span>
            <span className={styles.statLabel}>Attendance</span>
          </div>
          <div className={styles.statValue}>
            {workingHoursToday != null
              ? `${Number(workingHoursToday).toFixed(1)} h`
              : "—"}
          </div>
          <div className={styles.statMeta}>
            {attendancePct != null
              ? `${attendancePct}% this month`
              : "Today's working hours"}
          </div>
        </button>

        {/* Leave */}
        <button
          type="button"
          className={styles.statCard}
          onClick={() => onNavigate?.("leave")}
        >
          <div className={styles.statHead}>
            <span className={`${styles.statIcon} ${styles.tint_blue}`}>
              {I.calendar}
            </span>
            <span className={styles.statLabel}>Leave balance</span>
          </div>
          <div className={styles.statValue}>
            {totalLeave != null ? totalLeave : "—"}
            <span className={styles.statUnit}>days</span>
          </div>
          <div className={styles.statMeta}>
            {clBalance != null ? `${clBalance} CL available` : "Available to book"}
          </div>
        </button>

        {/* Tasks */}
        <button
          type="button"
          className={styles.statCard}
          onClick={() => onNavigate?.("tasks")}
        >
          <div className={styles.statHead}>
            <span className={`${styles.statIcon} ${styles.tint_amber}`}>
              {I.check}
            </span>
            <span className={styles.statLabel}>Tasks</span>
          </div>
          <div className={styles.statValue}>
            {pendingTasksCount}
            <span className={styles.statUnit}>pending</span>
          </div>
          <div className={styles.statMeta}>
            {overdueCount > 0
              ? <span className={styles.statOverdue}>{overdueCount} overdue</span>
              : "All on track"}
          </div>
        </button>
      </motion.section>


      {/* ==================== 3. TASKS + UPCOMING ==================== */}
      <motion.section className={styles.split} {...rise(0.12)}>

        {/* Today's tasks — left, wider */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Today's tasks</h2>
            <button type="button"
                    className={styles.panelLink}
                    onClick={() => onNavigate?.("tasks")}>
              View all {I.chevron}
            </button>
          </div>

          {todayTasks.length === 0 ? (
            <div className={styles.empty}>
              {I.check}
              <div>
                <div className={styles.emptyTitle}>Nothing on your plate</div>
                <div className={styles.emptyBody}>New tasks assigned to you will show up here.</div>
              </div>
            </div>
          ) : (
            <ul className={styles.taskList}>
              {todayTasks.slice(0, 5).map((t, i) => {
                const overdue = t.overdue || t.is_overdue;
                return (
                  <li key={t.id || t.ID || i} className={styles.taskRow}>
                    <span className={`${styles.taskDot} ${overdue ? styles.taskDot_overdue : ""}`} />
                    <div className={styles.taskBody}>
                      <div className={styles.taskTitle}>
                        {t.title || t.name || t.description || "Untitled task"}
                      </div>
                      {(t.project || t.due) && (
                        <div className={styles.taskMeta}>
                          {t.project && <span>{t.project}</span>}
                          {t.project && t.due && <span>·</span>}
                          {t.due && (
                            <span className={overdue ? styles.dueOverdue : ""}>
                              {overdue ? "Overdue" : `Due ${t.due}`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Upcoming — right, narrower */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Upcoming</h2>
            <span className={styles.panelSubtle}>
              Holidays · Birthdays · Approved leave
            </span>
          </div>

          {events.length === 0 ? (
            <div className={styles.empty}>
              {I.calendar}
              <div>
                <div className={styles.emptyTitle}>No upcoming events</div>
                <div className={styles.emptyBody}>Your next 14 days are clear.</div>
              </div>
            </div>
          ) : (
            <ul className={styles.eventList}>
              {events.slice(0, 5).map((e, i) => {
                const d = formatEventDate(e);
                return (
                  <li key={e.id || e.ID || i} className={styles.eventRow}>
                    <div className={styles.eventDate}>
                      <div className={styles.eventDay}>{d.day}</div>
                      <div className={styles.eventMonth}>{d.month}</div>
                    </div>
                    <div className={styles.eventBody}>
                      <div className={styles.eventTitle}>{e.title || e.name || "Event"}</div>
                      <div className={styles.eventKind}>
                        {e.kind || e.type || "Event"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </motion.section>


      {/* ==================== 4. ANNOUNCEMENTS ==================== */}
      <motion.section className={styles.panel} {...rise(0.18)}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Announcements</h2>
          <span className={styles.panelSubtle}>
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up"}
          </span>
        </div>

        {announcements.length === 0 ? (
          <div className={styles.empty}>
            {I.bell}
            <div>
              <div className={styles.emptyTitle}>No new announcements</div>
              <div className={styles.emptyBody}>Company memos and HR notices will appear here.</div>
            </div>
          </div>
        ) : (
          <ul className={styles.announceList}>
            {announcements.slice(0, 4).map((a, i) => (
              <li key={a.id || a.ID || i} className={styles.announceRow}>
                <span className={styles.announceDot} />
                <div className={styles.announceBody}>
                  <div className={styles.announceTitle}>
                    {a.title || a.subject || "Update"}
                  </div>
                  {a.detail && (
                    <div className={styles.announceDetail}>{a.detail}</div>
                  )}
                </div>
                {(a.when || a.date) && (
                  <div className={styles.announceWhen}>{a.when || a.date}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </motion.section>


      {/* ==================== 5. PRODUCTIVITY ==================== */}
      {/* One quiet line — no chart, just a progress bar so the page
          keeps some at-a-glance signal without becoming a KPI wall. */}
      {prodScore != null && (
        <motion.section className={styles.productivity} {...rise(0.24)}>
          <div className={styles.productivityHead}>
            <span className={styles.productivityLabel}>Productivity</span>
            <span className={styles.productivityScore}>
              {Math.round(prodScore)}
              <span className={styles.productivityOutOf}> / 100</span>
            </span>
          </div>
          <div className={styles.productivityTrack}>
            <div
              className={styles.productivityFill}
              style={{ width: `${Math.min(100, Math.max(0, prodScore))}%` }}
            />
          </div>
        </motion.section>
      )}
    </div>
  );
}
