import { useEffect, useMemo, useState, useRef } from "react";

import API from "../services/api";

import EntityDrawer from "../components/EntityDrawer";
import styles from "./Projects.module.css";


// ===================================================================
// Projects — Odoo-style kanban board.
//
// Each project is a column. Tasks (TaskAssignment rows) are cards
// inside the column with: priority strip, clock icon, 3-star
// quick-progress, assignee avatar (or "+" picker), and a colored
// status dot with 5-state dropdown.
//
// Backend endpoints:
//   GET    /projects/{id}/tasks           — list tasks in a project
//   POST   /projects/{id}/tasks           — create new task
//   PATCH  /projects/tasks/{task_id}      — update any field
//   DELETE /projects/tasks/{task_id}      — delete task
//   POST   /projects/from-product         — create a new project
//                                            (existing flow, kept intact)
// ===================================================================


// -------------------------------------------------------------------
// SVG icon set (no emojis on this page)
// -------------------------------------------------------------------

const SVG_PATHS = {
  plus:        "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
  search:      "M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19 15.5 14zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z",
  clock:       "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  star:        "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  user:        "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3 0-9 1.5-9 4.5V20h18v-1.5c0-3-6-4.5-9-4.5z",
  more:        "M12 8a2 2 0 1 0-2-2 2 2 0 0 0 2 2zm0 2a2 2 0 1 0 2 2 2 2 0 0 0-2-2zm0 6a2 2 0 1 0 2 2 2 2 0 0 0-2-2z",
  check:       "M9 16.17 4.83 12l-1.41 1.41L9 19 21 7l-1.41-1.41L9 16.17z",
  x:           "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  alert:       "M12 2 1 21h22zm0 4.5L19.5 19h-15zM11 16h2v2h-2zm0-6h2v5h-2z",
  circle:      "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z",
  filledCheck: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z",
  chevDown:    "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  copy:        "M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z",
  archive:     "M3 3h18v4H3zm1 5h16v13H4zm5 4v2h6v-2z",
  trash:       "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  template:    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM7 12h10v2H7zm0 4h7v2H7zm0-8h7v2H7z",
  share:       "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"
};

function Ico({ name, size = 14, style }) {
  const d = SVG_PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={style}
    >
      <path d={d} />
    </svg>
  );
}


// -------------------------------------------------------------------
// Kanban status vocabulary (5 states from the Odoo screenshots)
// -------------------------------------------------------------------

const KANBAN_STATUSES = [
  { key: "IN_PROGRESS",       label: "In Progress",       color: "#9ca3af", icon: "circle"      },
  { key: "CHANGES_REQUESTED", label: "Changes Requested", color: "#f59e0b", icon: "alert"       },
  { key: "APPROVED",          label: "Approved",          color: "#10b981", icon: "check"       },
  { key: "CANCELLED",         label: "Cancelled",         color: "#ef4444", icon: "x"           },
  { key: "DONE",              label: "Done",              color: "#16a34a", icon: "filledCheck" }
];

const STATUS_BY_KEY = Object.fromEntries(KANBAN_STATUSES.map((s) => [s.key, s]));

// Map legacy 4-state values to display values for backward-compat with
// tasks that were created by the existing workflow before the kanban
// was rolled out.
const LEGACY_STATUS_MAP = {
  PENDING:    { color: "#cbd5e1", icon: "circle", label: "Pending"     },
  ON_HOLD:    { color: "#f59e0b", icon: "alert",  label: "On Hold"     },
  COMPLETED:  { color: "#16a34a", icon: "filledCheck", label: "Completed" }
};

function statusMeta(key) {
  const k = (key || "").toUpperCase();
  return STATUS_BY_KEY[k] || LEGACY_STATUS_MAP[k] || {
    color: "#cbd5e1", icon: "circle", label: k || "—"
  };
}


// -------------------------------------------------------------------
// Star widget — 3 stars (Start / In Progress / Complete)
// -------------------------------------------------------------------

const STAR_LABELS = ["Start", "In Progress", "Complete"];

function StarRow({ value, onChange }) {
  const lit = Math.max(0, Math.min(3, Number(value || 0)));
  return (
    <div className={styles.kStarRow}>
      {[1, 2, 3].map((i) => (
        <button
          key={i}
          type="button"
          className={`${styles.kStar}${i <= lit ? " " + styles.kStarFilled : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            // Click the highest-lit star to clear it. Otherwise set to clicked level.
            onChange?.(i === lit ? i - 1 : i);
          }}
          title={STAR_LABELS[i - 1]}
        >
          <Ico name="star" size={12} />
          <span className={styles.kTooltip}>{STAR_LABELS[i - 1]}</span>
        </button>
      ))}
    </div>
  );
}


// -------------------------------------------------------------------
// Status dot + dropdown
// -------------------------------------------------------------------

function StatusDot({ status, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const meta = statusMeta(status);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={styles.kStatusDot}
        style={{
          background: meta.color === "#cbd5e1" ? "transparent" : meta.color,
          borderColor: meta.color
        }}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={meta.label}
      >
        {meta.icon === "check" || meta.icon === "filledCheck" ? (
          <Ico name="check" size={10} style={{ color: "#fff" }} />
        ) : meta.icon === "x" ? (
          <Ico name="x" size={10} style={{ color: "#fff" }} />
        ) : meta.icon === "alert" ? (
          <span style={{ color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: 1 }}>!</span>
        ) : null}
        <span className={styles.kTooltip}>{meta.label}</span>
      </button>

      {open && (
        <div
          className={styles.kPopover}
          style={{ top: 22, right: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {KANBAN_STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`${styles.kPopoverItem}${(status || "").toUpperCase() === s.key ? " " + styles.kPopoverItemActive : ""}`}
              onClick={() => { onChange?.(s.key); setOpen(false); }}
            >
              <span className={styles.kPopoverDot} style={{ background: s.color }} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// -------------------------------------------------------------------
// Assignee badge + employee picker
// -------------------------------------------------------------------

function initials(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function AssigneeBadge({ task, employees, onChange }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      (e.NAME || "").toLowerCase().includes(q) ||
      (e.EMPLOYEE_CODE || "").toLowerCase().includes(q)
    );
  }, [employees, filter]);

  const hasAssignee = !!task.employee_id;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      {hasAssignee ? (
        <button
          type="button"
          className={styles.kAssignAvatar}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          title={task.assignee_name || "Assignee"}
        >
          {initials(task.assignee_name)}
          <span className={styles.kTooltip}>{task.assignee_name}</span>
        </button>
      ) : (
        <button
          type="button"
          className={styles.kAssignBtn}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          <Ico name="user" size={11} />
          <span className={styles.kTooltip}>Assign</span>
        </button>
      )}

      {open && (
        <div
          className={styles.kPopover}
          style={{ top: 26, right: 0, minWidth: 220 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.kPopoverSearch}>
            <input
              autoFocus
              type="text"
              placeholder="Search employee…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className={styles.kPopoverScroll}>
            {hasAssignee && (
              <button
                type="button"
                className={styles.kPopoverItem}
                onClick={() => { onChange?.(null); setOpen(false); }}
              >
                <span className={styles.kPopoverDot} style={{ background: "#ef4444" }} />
                <span style={{ color: "var(--danger-dark)" }}>Unassign</span>
              </button>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: 10, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                No matches
              </div>
            ) : filtered.map((e) => (
              <button
                key={e.ID}
                type="button"
                className={`${styles.kPopoverItem}${task.employee_id === e.ID ? " " + styles.kPopoverItemActive : ""}`}
                onClick={() => { onChange?.(e.ID); setOpen(false); }}
              >
                <span
                  className={styles.kPopoverDot}
                  style={{
                    background: "var(--clr-primary-light)",
                    color: "var(--clr-primary)",
                    width: 18, height: 18, fontSize: 9, fontWeight: 700,
                    display: "inline-flex", alignItems: "center", justifyContent: "center"
                  }}
                >
                  {initials(e.NAME)}
                </span>
                <span>{e.NAME}</span>
                {e.EMPLOYEE_CODE && (
                  <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: "auto" }}>
                    {e.EMPLOYEE_CODE}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// -------------------------------------------------------------------
// Inline task creator (the "+" → input row)
// -------------------------------------------------------------------

function NewTaskRow({ onCreate, onCancel, busy }) {
  const [name, setName] = useState("");

  const submit = () => {
    const v = name.trim();
    if (!v) return;
    onCreate(v);
  };

  return (
    <div className={styles.kNewTaskRow} onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        className={styles.kNewTaskInput}
        type="text"
        placeholder="Task title…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className={styles.kNewTaskActions}>
        <button
          type="button"
          className={styles.kNewTaskBtn}
          disabled={busy || !name.trim()}
          onClick={submit}
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          className={styles.kNewTaskCancel}
          onClick={onCancel}
        >
          Cancel
        </button>
        <span className={styles.kNewTaskHint}>Enter to add · Esc to cancel</span>
      </div>
    </div>
  );
}


// -------------------------------------------------------------------
// Task card (one row inside a project column)
// -------------------------------------------------------------------

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function isOverdue(iso, status) {
  if (!iso) return false;
  const done = ["COMPLETED", "DONE", "APPROVED", "CANCELLED"].includes((status || "").toUpperCase());
  if (done) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function TaskCard({ task, employees, onUpdate, onDelete }) {
  const priority = (task.priority || "MEDIUM").toUpperCase();
  const overdue = isOverdue(task.due_date, task.status);

  const priorityCls = priority === "HIGH"
    ? styles.kTaskCardHigh
    : priority === "LOW"
      ? styles.kTaskCardLow
      : styles.kTaskCardMedium;

  return (
    <div className={`${styles.kTaskCard} ${priorityCls}`}>
      <button
        type="button"
        className={styles.kTaskMenu}
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`Delete task "${task.task_name}"?`)) {
            onDelete(task.id);
          }
        }}
        title="Delete task"
      >
        <Ico name="more" size={12} />
      </button>

      <div className={styles.kTaskTitle}>
        {task.task_name}
      </div>

      <div className={styles.kTaskFooter}>
        <div className={styles.kTaskFooterLeft}>
          <span
            className={`${styles.kClockIcon}${overdue ? " " + styles.kClockIconOverdue : ""}`}
            title={task.due_date ? `Due ${fmtDate(task.due_date)}` : "No due date"}
          >
            <Ico name="clock" size={13} />
          </span>
          <StarRow
            value={task.star_level}
            onChange={(level) => onUpdate(task.id, { STAR_LEVEL: level })}
          />
        </div>

        <div className={styles.kTaskFooterRight}>
          <AssigneeBadge
            task={task}
            employees={employees}
            onChange={(empId) => onUpdate(task.id, { EMPLOYEE_ID: empId || "" })}
          />
          <StatusDot
            status={task.status}
            onChange={(s) => onUpdate(task.id, { TASK_STATUS: s })}
          />
        </div>
      </div>
    </div>
  );
}


// -------------------------------------------------------------------
// Project column menu (Odoo-style 3-dot dropdown)
// -------------------------------------------------------------------

function ColumnMenu({ onDelete, onStub, onClose }) {

  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  return (
    <div
      ref={wrapRef}
      className={styles.kPopover}
      style={{ top: 24, right: 0, minWidth: 180, padding: 4 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={styles.kPopoverItem}
        onClick={() => { onStub("Duplicate"); onClose(); }}
      >
        <Ico name="copy" size={13} />
        <span>Duplicate</span>
      </button>
      <button
        type="button"
        className={styles.kPopoverItem}
        onClick={() => { onStub("Archive"); onClose(); }}
      >
        <Ico name="archive" size={13} />
        <span>Archive</span>
      </button>
      <button
        type="button"
        className={`${styles.kPopoverItem} ${styles.kMenuItemDanger}`}
        onClick={() => { onClose(); onDelete(); }}
      >
        <Ico name="trash" size={13} />
        <span>Delete</span>
      </button>
      <div className={styles.kMenuDivider} />
      <button
        type="button"
        className={styles.kPopoverItem}
        onClick={() => { onStub("Convert to Template"); onClose(); }}
      >
        <Ico name="template" size={13} />
        <span>Convert to Template</span>
      </button>
      <button
        type="button"
        className={styles.kPopoverItem}
        onClick={() => { onStub("Share Project"); onClose(); }}
      >
        <Ico name="share" size={13} />
        <span>Share Project</span>
      </button>
    </div>
  );
}


// -------------------------------------------------------------------
// Delete-confirmation modal — Odoo "Bye-bye, record!" style
// -------------------------------------------------------------------

function DeleteConfirmModal({ project, busy, onConfirm, onCancel }) {

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <div className={styles.kConfirmBackdrop} onClick={busy ? undefined : onCancel}>
      <div
        className={styles.kConfirmModal}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.kConfirmClose}
          onClick={busy ? undefined : onCancel}
          disabled={busy}
          aria-label="Close"
        >
          <Ico name="x" size={14} />
        </button>

        <div className={styles.kConfirmTitle}>Bye-bye, record!</div>

        <div className={styles.kConfirmBody}>
          Ready to make <b>{project?.PROJECT_NAME || "this project"}</b>{" "}
          disappear into thin air? It will be gone forever!
          <br /><br />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Tasks, work orders and daily allocations will be unlinked
            (not deleted) so history is preserved.
          </span>
        </div>

        <div className={styles.kConfirmActions}>
          <button
            type="button"
            className={styles.kBtnDanger}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            className={styles.kBtnCancel}
            onClick={onCancel}
            disabled={busy}
          >
            No, keep it
          </button>
        </div>
      </div>
    </div>
  );
}


// -------------------------------------------------------------------
// Right-side chart — aggregate task status across every project
// -------------------------------------------------------------------

const CHART_BUCKETS = [
  { key: "not_assigned",      label: "Not Assigned", color: "#9ca3af" },
  { key: "pending",           label: "Pending",      color: "#cbd5e1" },
  { key: "in_progress",       label: "In Progress",  color: "#3b82f6" },
  { key: "on_hold",           label: "On Hold",      color: "#f59e0b" },
  { key: "completed",         label: "Completed",    color: "#10b981" },
  { key: "cancelled",         label: "Cancelled",    color: "#ef4444" }
];

function classifyTask(t) {
  if (!t.employee_id) return "not_assigned";
  const s = (t.status || "PENDING").toUpperCase();
  if (s === "IN_PROGRESS") return "in_progress";
  if (s === "ON_HOLD" || s === "CHANGES_REQUESTED") return "on_hold";
  if (s === "COMPLETED" || s === "DONE" || s === "APPROVED") return "completed";
  if (s === "CANCELLED") return "cancelled";
  return "pending";
}

function TaskOverviewChart({ tasksByProject }) {

  const counts = useMemo(() => {
    const c = Object.fromEntries(CHART_BUCKETS.map((b) => [b.key, 0]));
    for (const pid of Object.keys(tasksByProject || {})) {
      for (const t of tasksByProject[pid] || []) {
        c[classifyTask(t)] += 1;
      }
    }
    return c;
  }, [tasksByProject]);

  const total = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts]
  );

  // SVG donut geometry
  const radius = 60;
  const stroke = 22;
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  let cursor = 0;
  const segments = CHART_BUCKETS.map((b) => {
    const value = counts[b.key];
    if (value === 0 || total === 0) return null;
    const portion = value / total;
    const len = circumference * portion;
    const seg = (
      <circle
        key={b.key}
        r={radius}
        cx={cx}
        cy={cy}
        fill="transparent"
        stroke={b.color}
        strokeWidth={stroke}
        strokeDasharray={`${len} ${circumference - len}`}
        strokeDashoffset={-cursor}
      />
    );
    cursor += len;
    return seg;
  }).filter(Boolean);

  return (
    <div className={styles.kChartCard}>
      <div className={styles.kChartTitle}>Task Overview</div>
      <div className={styles.kChartSubtitle}>Across all projects</div>

      <div className={styles.kDonutWrap}>
        {total === 0 ? (
          <div className={styles.kEmptyDonut}>No tasks</div>
        ) : (
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <g transform={`rotate(-90 ${cx} ${cy})`}>
              {segments}
            </g>
            <text
              x={cx}
              y={cy + 2}
              textAnchor="middle"
              className={styles.kDonutTotal}
            >
              {total}
            </text>
            <text
              x={cx}
              y={cy + 20}
              textAnchor="middle"
              className={styles.kDonutSub}
            >
              {total === 1 ? "TASK" : "TASKS"}
            </text>
          </svg>
        )}
      </div>

      <div className={styles.kChartLegend}>
        {CHART_BUCKETS.map((b) => {
          const v = counts[b.key];
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          return (
            <div key={b.key} className={styles.kChartLegendRow}>
              <span
                className={styles.kChartLegendDot}
                style={{ background: b.color }}
              />
              <span className={styles.kChartLegendLabel}>{b.label}</span>
              <span className={styles.kChartLegendCount}>{v}</span>
              <span className={styles.kChartLegendPct}>
                {total > 0 ? `${pct}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// -------------------------------------------------------------------
// Project column (kanban list of tasks for one project)
// -------------------------------------------------------------------

function ProjectColumn({
  project, tasks, employees,
  onOpenProject, onCreateTask, onUpdateTask, onDeleteTask,
  onAskDeleteProject, onStubAction,
  busy
}) {
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => {
      const s = (t.status || "").toUpperCase();
      return s === "DONE" || s === "COMPLETED" || s === "APPROVED";
    }).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [tasks]);

  const handleCreate = async (name) => {
    await onCreateTask(project.ID, name);
    setAdding(false);
  };

  return (
    <div className={styles.kColumn}>
      <div className={styles.kColumnHead}>
        <div className={styles.kColumnTitleRow}>
          <div
            className={styles.kColumnTitle}
            onClick={() => onOpenProject(project.ID)}
            title={project.PROJECT_NAME}
          >
            {project.PROJECT_NAME}
          </div>
          <div className={styles.kColumnActions}>
            <button
              type="button"
              className={styles.kAddBtn}
              onClick={(e) => { e.stopPropagation(); setAdding(true); }}
              title="Add task"
            >
              +
            </button>
            <div style={{ position: "relative", display: "inline-flex" }}>
              <button
                type="button"
                className={styles.kColumnMenuBtn}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                title="Project actions"
                aria-label="Project actions"
              >
                <Ico name="more" size={14} />
              </button>
              {menuOpen && (
                <ColumnMenu
                  onClose={() => setMenuOpen(false)}
                  onDelete={() => onAskDeleteProject(project)}
                  onStub={onStubAction}
                />
              )}
            </div>
          </div>
        </div>

        <div className={styles.kProgress}>
          <div
            className={styles.kProgressFill}
            style={{ width: `${stats.pct}%` }}
          />
        </div>
        <div className={styles.kColumnCount}>
          {stats.done}/{stats.total} done
        </div>
      </div>

      <div className={styles.kColumnBody}>
        {tasks.length === 0 && !adding && (
          <div className={styles.kColumnEmpty}>
            No tasks yet. Click + to add one.
          </div>
        )}

        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            employees={employees}
            onUpdate={onUpdateTask}
            onDelete={onDeleteTask}
          />
        ))}

        {adding ? (
          <NewTaskRow
            busy={busy}
            onCreate={handleCreate}
            onCancel={() => setAdding(false)}
          />
        ) : tasks.length > 0 ? (
          <button
            type="button"
            className={styles.kAddTaskTrigger}
            onClick={() => setAdding(true)}
          >
            + Add task
          </button>
        ) : null}
      </div>
    </div>
  );
}


// -------------------------------------------------------------------
// New-project modal (preserved from the legacy page — unchanged)
// -------------------------------------------------------------------

function StatTile({ label, value, sub, color }) {
  return (
    <div className={styles.statTile} style={{ borderTop: `3px solid ${color}` }}>
      <div className={styles.statTileLabel}>{label}</div>
      <div className={styles.statTileValue}>{value}</div>
      {sub && <div className={styles.statTileSub}>{sub}</div>}
    </div>
  );
}

function Pill({ children, bg, fg }) {
  return (
    <span className={styles.pill} style={{ background: bg, color: fg }}>
      {children}
    </span>
  );
}

function CreateFromProductModal({ onClose, onCreated }) {

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priority, setPriority] = useState("MEDIUM");
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      API.get("/customers").catch(() => ({ data: [] })),
      API.get("/production/models?vendor_id=1").catch(() => ({ data: [] }))
    ]).then(([c, p]) => {
      setCustomers(c.data || []);
      setProducts(p.data || []);
      setLoading(false);
    });
  }, []);

  const selectedProduct = products.find((p) => String(p.ID) === String(productId));
  const selectedCustomer = customers.find((c) => String(c.ID) === String(customerId));

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!customerId) { setError("Pick a customer"); return; }
    if (!productId) { setError("Pick a product"); return; }
    setError("");
    setSubmitting(true);
    setResult(null);
    try {
      const res = await API.post("/projects/from-product", {
        CUSTOMER_ID: parseInt(customerId),
        PRODUCT_MODEL_ID: parseInt(productId),
        QUANTITY: parseInt(quantity) || 1,
        PRIORITY: priority,
        TARGET_DATE: targetDate || null,
        NOTES: notes || null,
        VENDOR_ID: 1
      });
      setResult(res.data);
      onCreated?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalEyebrow}>New Project</div>
            <div className={styles.modalTitle}>Create a project from a product</div>
            <div className={styles.modalSubtitle}>
              The product's BOM and manufacturing stages flow into the project as
              tasks, each auto-assigned to the best-skill employee.
            </div>
          </div>
          <button onClick={onClose} className={styles.modalCloseBtn}>×</button>
        </div>

        {!result && (
          <form onSubmit={submit}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Customer *</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  disabled={loading}
                  className={styles.formInput}
                >
                  <option value="">— pick customer —</option>
                  {customers.map((c) => (
                    <option key={c.ID} value={c.ID}>
                      {c.CUSTOMER_CODE ? `${c.CUSTOMER_CODE} · ` : ""}{c.CUSTOMER_NAME}
                    </option>
                  ))}
                </select>
                {selectedCustomer && (
                  <div className={styles.formFieldHint}>
                    {selectedCustomer.PHONE || "—"} · {selectedCustomer.CITY || "—"}
                  </div>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Product *</label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  disabled={loading}
                  className={styles.formInput}
                >
                  <option value="">— pick product —</option>
                  {products.map((p) => (
                    <option key={p.ID} value={p.ID}>
                      {p.MODEL_CODE} — {p.MODEL_NAME}
                    </option>
                  ))}
                </select>
                {selectedProduct && (
                  <div className={styles.formFieldHint}>
                    {selectedProduct.CATEGORY} · {selectedProduct.ESTIMATED_BUILD_DAYS}d build
                  </div>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Quantity *</label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className={styles.formInput}
                >
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Target Date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className={styles.formInput}
                />
              </div>
            </div>

            <div className={styles.formGroupFull}>
              <label className={styles.formLabel}>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className={styles.formTextarea}
                placeholder="Any special instructions for this order…"
              />
            </div>

            {error && <div className={styles.errorBanner}>{error}</div>}

            <div className={styles.formActions}>
              <button type="button" onClick={onClose} className={styles.btnCancel}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className={styles.btnSubmit}>
                {submitting ? "Creating…" : "Create Project"}
              </button>
            </div>
          </form>
        )}

        {result && <CreateResult result={result} onClose={onClose} />}
      </div>
    </div>
  );
}

function CreateResult({ result, onClose }) {
  return (
    <div>
      <div className={styles.resultSuccess}>
        <div className={styles.resultSuccessTitle}>Project created</div>
        <div className={styles.resultSuccessMsg}>{result.message}</div>
      </div>

      <div className={styles.resultStatsGrid}>
        <StatTile label="Tasks" value={result.tasks_generated} color="#6366f1" />
        <StatTile label="Employees" value={result.employees_assigned} color="#10b981" sub="auto-assigned" />
        <StatTile
          label="Emails Sent"
          value={result.emails_sent?.sent ?? 0}
          color="#f59e0b"
          sub={result.emails_sent?.failed ? `${result.emails_sent.failed} failed` : ""}
        />
      </div>

      <div className={styles.resultSectionLabel}>
        Task assignments
      </div>

      <div className={styles.resultTaskList}>
        {result.tasks?.map((t) => (
          <div key={t.task_id} className={styles.resultTaskRow}>
            <div className={styles.resultTaskLeft}>
              <div className={styles.resultTaskName}>{t.stage_name}</div>
              <div className={styles.resultTaskMeta}>
                {t.stage_type} · → {t.assigned_employee_name || "Unassigned"}
                {t.assigned_employee_code && (
                  <span className={styles.resultTaskCode}>({t.assigned_employee_code})</span>
                )}
              </div>
            </div>
            <div className={styles.resultTaskRight}>
              <Pill bg="#fef3c7" fg="#854d0e">{t.approval_status}</Pill>
              {t.skill_match_score > 0 && (
                <div className={styles.resultMatchScore}>
                  {Math.round(t.skill_match_score * 100)}% match
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.resultActions}>
        <button onClick={onClose} className={styles.btnDone}>Done</button>
      </div>
    </div>
  );
}


// -------------------------------------------------------------------
// Main Projects page — kanban board
// -------------------------------------------------------------------

function Projects() {

  const [projects, setProjects] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [drawerId, setDrawerId] = useState(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [stubToast, setStubToast] = useState("");

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await API.get("/projects?vendor_id=1").catch(async () => {
        return await API.get("/projects");
      });

      const [custRes, prodRes] = await Promise.all([
        API.get("/customers").catch(() => ({ data: [] })),
        API.get("/production/models?vendor_id=1").catch(() => ({ data: [] }))
      ]);

      const custMap = Object.fromEntries(
        (custRes.data || []).map((c) => [c.ID, c.CUSTOMER_NAME])
      );
      const prodMap = Object.fromEntries(
        (prodRes.data || []).map((p) => [p.ID, p.MODEL_NAME])
      );

      const enriched = (res.data || []).map((p) => ({
        ...p,
        CUSTOMER_NAME: p.CUSTOMER_NAME || custMap[p.CUSTOMER_ID] || null,
        PRODUCT_MODEL_NAME: prodMap[p.PRODUCT_MODEL_ID] || null
      }));

      setProjects(enriched);

      // Fetch tasks per project in parallel
      const taskResults = await Promise.all(
        enriched.map((p) =>
          API.get(`/projects/${p.ID}/tasks`)
            .then((r) => [p.ID, r.data || []])
            .catch(() => [p.ID, []])
        )
      );
      setTasksByProject(Object.fromEntries(taskResults));

    } catch {
      setProjects([]);
      setTasksByProject({});
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const r = await API.get("/employees");
      const list = Array.isArray(r.data) ? r.data : [];
      // Show only active employees in the picker
      setEmployees(
        list.filter((e) => {
          const s = (e.STATUS || "ACTIVE").toUpperCase();
          return s !== "RESIGNED" && s !== "TERMINATED";
        })
      );
    } catch {
      setEmployees([]);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchEmployees();
  }, []);

  // ---- Task mutations ----

  const handleCreateTask = async (projectId, name) => {
    setTaskBusy(true);
    try {
      const res = await API.post(`/projects/${projectId}/tasks`, {
        TASK_NAME: name,
        PRIORITY: "MEDIUM"
      });
      setTasksByProject((m) => ({
        ...m,
        [projectId]: [...(m[projectId] || []), res.data]
      }));
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to create task");
    } finally {
      setTaskBusy(false);
    }
  };

  const handleUpdateTask = async (taskId, patch) => {
    // Optimistic update — find which project the task belongs to
    let projectIdForTask = null;
    setTasksByProject((m) => {
      const next = { ...m };
      for (const pid of Object.keys(next)) {
        next[pid] = next[pid].map((t) => {
          if (t.id === taskId) {
            projectIdForTask = pid;
            const merged = { ...t };
            if (patch.TASK_STATUS != null) merged.status = patch.TASK_STATUS;
            if (patch.STAR_LEVEL != null) merged.star_level = patch.STAR_LEVEL;
            if (patch.EMPLOYEE_ID != null) {
              merged.employee_id = patch.EMPLOYEE_ID || null;
              if (!patch.EMPLOYEE_ID) {
                merged.assignee_name = null;
                merged.assignee_code = null;
              }
            }
            return merged;
          }
          return t;
        });
      }
      return next;
    });

    try {
      const res = await API.patch(`/projects/tasks/${taskId}`, patch);
      // Replace the row with the server's authoritative version
      // (so assignee_name is populated when EMPLOYEE_ID changes)
      setTasksByProject((m) => {
        const next = { ...m };
        for (const pid of Object.keys(next)) {
          next[pid] = next[pid].map((t) => (t.id === taskId ? res.data : t));
        }
        return next;
      });
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to update task");
      // Reload to roll back the optimistic change
      fetchProjects();
    }
  };

  const handleDeleteTask = async (taskId) => {
    setTasksByProject((m) => {
      const next = { ...m };
      for (const pid of Object.keys(next)) {
        next[pid] = next[pid].filter((t) => t.id !== taskId);
      }
      return next;
    });
    try {
      await API.delete(`/projects/tasks/${taskId}`);
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to delete");
      fetchProjects();
    }
  };

  // ---- Project-level actions (3-dot menu) ----

  const handleConfirmDeleteProject = async () => {
    if (!pendingDelete) return;
    setDeletingBusy(true);
    try {
      await API.delete(`/delete-project/${pendingDelete.ID}`);
      setProjects((list) => list.filter((p) => p.ID !== pendingDelete.ID));
      setTasksByProject((m) => {
        const next = { ...m };
        delete next[pendingDelete.ID];
        return next;
      });
      setPendingDelete(null);
    } catch (err) {
      alert(err?.response?.data?.detail || "Delete failed");
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleStubAction = (label) => {
    setStubToast(`${label} — coming soon`);
    setTimeout(() => setStubToast(""), 2200);
  };

  // ---- Search filter ----

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const hay = [
        p.PROJECT_NAME, p.CUSTOMER_NAME, p.PRODUCT_MODEL_NAME, p.SKILLS_REQUIRED
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [projects, search]);

  return (
    <div className={styles.kPage}>

      <div className={styles.kToolbar}>
        <div className={styles.kToolbarTitle}>Projects</div>
        <button
          type="button"
          className={styles.kNewBtn}
          onClick={() => setShowCreate(true)}
        >
          <Ico name="plus" size={13} />
          New
        </button>
        <div className={styles.kSearch}>
          <Ico name="search" size={13} />
          <input
            type="search"
            placeholder="Search project, customer, product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
          {filtered.length} of {projects.length}
        </div>
      </div>

      <div className={styles.kBoardWrap}>

        <div className={styles.kBoardScroll}>
          {loading && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13, width: "100%" }}>
              Loading projects…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13, width: "100%" }}>
              {projects.length === 0
                ? "No projects yet. Click + New to create one."
                : "No projects match your search."}
            </div>
          )}

          {!loading && filtered.length > 0 && filtered.map((p) => (
            <ProjectColumn
              key={p.ID}
              project={p}
              tasks={tasksByProject[p.ID] || []}
              employees={employees}
              busy={taskBusy}
              onOpenProject={setDrawerId}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
              onAskDeleteProject={setPendingDelete}
              onStubAction={handleStubAction}
            />
          ))}
        </div>

        {!loading && (
          <aside className={styles.kRightPanel}>
            <TaskOverviewChart tasksByProject={tasksByProject} />
          </aside>
        )}

      </div>

      {showCreate && (
        <CreateFromProductModal
          onClose={() => setShowCreate(false)}
          onCreated={() => fetchProjects()}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          project={pendingDelete}
          busy={deletingBusy}
          onConfirm={handleConfirmDeleteProject}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {stubToast && (
        <div className={styles.kStubToast}>{stubToast}</div>
      )}

      <EntityDrawer
        open={drawerId != null}
        type="project"
        id={drawerId}
        onClose={() => setDrawerId(null)}
      />
    </div>
  );
}


export default Projects;
