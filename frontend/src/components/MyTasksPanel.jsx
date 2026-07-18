// =====================================================================
// MyTasksPanel — modern card-based tasks view for the ESS portal.
// ---------------------------------------------------------------------
// Replaces the old table layout with a stacked card list:
//   • Priority shown as a coloured left rail on each card
//   • Title + project on the same line as the due-date chip
//   • Status pill + action buttons on their own row
//   • Filter chips at the top (Today / Pending / In Progress / …)
//     with live counts pulled from the parent's `buckets` object
//   • Search across title + project
//
// Contract (unchanged from ZTasksPage):
//   props.buckets   — { today, pending, in_progress, on_hold, upcoming, completed }
//                     each is an array of task objects (see ZTaskRow shape)
//   props.busyMap   — { [assignment_id]: boolean }
//   props.onUpdate  — (assignment_id, targetStatus, currentStatus) => void
// =====================================================================

import { useMemo, useState } from "react";

import styles from "./MyTasksPanel.module.css";


// ------------------------------------------------------------------
// Icons — small stroke SVGs, currentColor
// ------------------------------------------------------------------
const icon = (children, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  search: icon(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>, 13),
  play:   icon(<path d="M6 4l14 8-14 8V4z" />),
  pause:  icon(<><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>),
  check:  icon(<path d="M4 12l6 6L20 6" />),
  empty:  icon(<>
    <path d="M9 11l3 3L20 6" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </>, 32),
};


// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function fmtDate(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return String(value);
  }
}

// Priority → colour + label
const PRIORITY = {
  HIGH:   { label: "High",   tone: "high"   },
  MEDIUM: { label: "Medium", tone: "medium" },
  LOW:    { label: "Low",    tone: "low"    },
  URGENT: { label: "Urgent", tone: "high"   },
};

// Status → label + pill class + next-action set
const STATUS_META = {
  PENDING:     { label: "Pending",     tone: "pending" },
  IN_PROGRESS: { label: "In progress", tone: "progress" },
  ON_HOLD:     { label: "On hold",     tone: "hold" },
  COMPLETED:   { label: "Completed",   tone: "done" },
};

function nextActionsFor(status) {
  switch (status) {
    case "PENDING":
      return [
        { target: "IN_PROGRESS", label: "Start", icon: I.play,  variant: "primary" },
        { target: "ON_HOLD",     label: "Hold",  icon: I.pause, variant: "warn"    },
        { target: "COMPLETED",   label: "Done",  icon: I.check, variant: "success" },
      ];
    case "IN_PROGRESS":
      return [
        { target: "ON_HOLD",   label: "Hold", icon: I.pause, variant: "warn"    },
        { target: "COMPLETED", label: "Done", icon: I.check, variant: "success" },
      ];
    case "ON_HOLD":
      return [
        { target: "IN_PROGRESS", label: "Resume", icon: I.play,  variant: "primary" },
        { target: "COMPLETED",   label: "Done",   icon: I.check, variant: "success" },
      ];
    default:
      return [];
  }
}


// ==================================================================
// Task card
// ==================================================================
function TaskCard({ task, busy, onUpdate }) {

  const status   = (task.status   || "PENDING").toUpperCase();
  const priority = (task.priority || "MEDIUM").toUpperCase();

  const prio     = PRIORITY[priority] || PRIORITY.MEDIUM;
  const statusM  = STATUS_META[status] || STATUS_META.PENDING;
  const actions  = nextActionsFor(status);

  const remaining = task.remaining_days != null
    ? Number(task.remaining_days)
    : null;

  // Due-chip look — overdue red, today amber, otherwise neutral
  let dueTone = "neutral";
  let dueText = task.due_date ? fmtDate(task.due_date) : "";
  if (remaining != null) {
    if (remaining < 0) {
      dueTone = "overdue";
      dueText = `${Math.abs(remaining)}d overdue`;
    } else if (remaining === 0) {
      dueTone = "today";
      dueText = "Due today";
    } else if (task.due_date) {
      dueText = `${fmtDate(task.due_date)} · ${remaining}d left`;
    }
  }

  return (
    <li className={`${styles.card} ${styles[`prio_${prio.tone}`]}`}>

      <div className={styles.cardMain}>
        <div className={styles.cardTitle}>
          {task.title || "Untitled task"}
        </div>

        <div className={styles.cardMeta}>
          {task.project_name && (
            <span className={styles.cardProject}>{task.project_name}</span>
          )}
          <span className={`${styles.chip} ${styles[`chip_${statusM.tone}`]}`}>
            {statusM.label}
          </span>
          <span className={`${styles.chip} ${styles[`chip_prio_${prio.tone}`]}`}>
            {prio.label}
          </span>
        </div>
      </div>

      <div className={styles.cardRight}>
        {dueText && (
          <span className={`${styles.due} ${styles[`due_${dueTone}`]}`}>
            {dueText}
          </span>
        )}

        {actions.length > 0 && (
          <div className={styles.actions}>
            {actions.map((a) => (
              <button
                key={a.target}
                type="button"
                disabled={busy}
                onClick={() => onUpdate(task.assignment_id, a.target, status)}
                className={`${styles.actionBtn} ${styles[`action_${a.variant}`]}`}
              >
                {a.icon}
                <span>{busy ? "…" : a.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}


// ==================================================================
// Panel
// ==================================================================
export default function MyTasksPanel({ buckets = {}, busyMap = {}, onUpdate }) {

  const [filter, setFilter] = useState("pending");
  const [query, setQuery]   = useState("");

  const filters = useMemo(() => ([
    { key: "today",       label: "Today",       count: buckets.today?.length       || 0 },
    { key: "pending",     label: "Pending",     count: buckets.pending?.length     || 0 },
    { key: "in_progress", label: "In progress", count: buckets.in_progress?.length || 0 },
    { key: "on_hold",     label: "On hold",     count: buckets.on_hold?.length     || 0 },
    { key: "upcoming",    label: "Upcoming",    count: buckets.upcoming?.length    || 0 },
    { key: "completed",   label: "Completed",   count: buckets.completed?.length   || 0 },
  ]), [buckets]);

  const total = useMemo(
    () => filters.reduce((s, f) => s + f.count, 0),
    [filters]
  );

  const activeList = buckets[filter] || [];
  const qNorm = query.trim().toLowerCase();
  const rows = qNorm
    ? activeList.filter((t) =>
        (t.title || "").toLowerCase().includes(qNorm) ||
        (t.project_name || "").toLowerCase().includes(qNorm))
    : activeList;

  const emptyMessage = (() => {
    if (query) return `No tasks matching "${query}".`;
    switch (filter) {
      case "today":       return "Nothing on today's plate.";
      case "pending":     return "Nothing pending — you're all caught up.";
      case "in_progress": return "No tasks in progress right now.";
      case "on_hold":     return "Nothing on hold.";
      case "upcoming":    return "No upcoming tasks in the next few days.";
      case "completed":   return "No completed tasks yet.";
      default:            return "Nothing here.";
    }
  })();

  return (
    <div className={styles.wrap}>

      {/* ---- Header ---- */}
      <header className={styles.head}>
        <div className={styles.headTitle}>
          My Tasks
          <span className={styles.headCount}>{total}</span>
        </div>

        <label className={styles.searchBox}>
          <span className={styles.searchIcon}>{I.search}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or project"
            aria-label="Search tasks"
          />
        </label>
      </header>

      {/* ---- Filter chips ---- */}
      <div className={styles.filters} role="tablist">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`${styles.filterChip} ${filter === f.key ? styles.filterChip_active : ""}`}
          >
            <span>{f.label}</span>
            <span className={styles.filterCount}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* ---- List ---- */}
      {rows.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>{I.empty}</span>
          <div>
            <div className={styles.emptyTitle}>{emptyMessage}</div>
            <div className={styles.emptyBody}>
              New assignments will show up here as your manager creates them.
            </div>
          </div>
        </div>
      ) : (
        <ul className={styles.list}>
          {rows.map((t) => (
            <TaskCard
              key={t.assignment_id || t.id}
              task={t}
              busy={!!busyMap[t.assignment_id]}
              onUpdate={onUpdate}
            />
          ))}
        </ul>
      )}

    </div>
  );
}
