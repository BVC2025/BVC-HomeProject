import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PageHeader, PMSelect, PMButton, PMModal, EmptyState, Loader,
  DateTimeRangeFilter, EMPTY_RANGE, toIsoRange, isRangeSet,
} from "../components/pm";
import { customerMasterService } from "../services/customerMasterService";
import { customerPaymentService } from "../services/customerPaymentService";
import { productionScheduleService } from "../services/productionScheduleService";
import { departmentService } from "../services/departmentService";
import { roleService } from "../services/roleService";
import { employeeService } from "../services/employeeService";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import TaskIcon from "../assets/Icons/taskIcon.webp";
import styles from "./CustomerTaskTimeline.module.css";

const TASK_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "EXTENDED", label: "Extended" },
];

// Rich per-status theme (fill/text/border/icon) — drives the legend, the
// row status pill, the Gantt bar's status-colored ring, and the Task
// Details modal's header pill, so "what state is this task in" always
// reads the same way everywhere on this page.
const STATUS_THEME = {
  PENDING: { bg: "#eef2f7", fg: "#475569", border: "#94a3b8", icon: "⏳", label: "Pending" },
  IN_PROGRESS: { bg: "#fef3c7", fg: "#92400e", border: "#f59e0b", icon: "▶", label: "In Progress" },
  COMPLETED: { bg: "#dcfce7", fg: "#166534", border: "#22c55e", icon: "✓", label: "Completed" },
  OVERDUE: { bg: "#fee2e2", fg: "#991b1b", border: "#ef4444", icon: "⚠", label: "Overdue" },
  EXTENDED: { bg: "#e0f2fe", fg: "#075985", border: "#0ea5e9", icon: "↔", label: "Extended" },
};

function statusTheme(status) {
  return STATUS_THEME[status] || STATUS_THEME.PENDING;
}

// Task-identity color palette for the Gantt bars — vivid, mutually
// distinct, professional-grade colors. A task's fill color is a
// deterministic hash of its TASK_TEMPLATE_ID (stable across every unit
// of a QUANTITY>1 project, and across every filter/sort state), so
// "Task A" is always the same color everywhere on the chart while
// "Task B"/"Task C" are each their own distinct color — status is shown
// separately via the colored ring + icon, never by bar fill.
const TASK_COLOR_PALETTE = [
  "#6366f1", "#ec4899", "#14b8a6", "#f97316", "#8b5cf6",
  "#06b6d4", "#f43f5e", "#3b82f6", "#a855f7", "#84cc16",
  "#0ea5e9", "#d946ef",
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function taskColorFor(taskTemplateId) {
  if (!taskTemplateId) return TASK_COLOR_PALETTE[0];
  return TASK_COLOR_PALETTE[hashString(taskTemplateId) % TASK_COLOR_PALETTE.length];
}

function dayOnly(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function taskRowLabel(task) {
  if (task.task_scope === "UNIT" && task.project_unit_number != null) {
    return `${task.task_name} — Unit ${task.project_unit_number}`;
  }
  return task.task_name;
}

function taskDurationLabel(task) {
  if (task.estimated_days != null) {
    return `${task.estimated_days} day${Number(task.estimated_days) === 1 ? "" : "s"}`;
  }
  if (task.estimated_hours != null) return `${task.estimated_hours}h`;
  return "—";
}

function taskTooltip(task) {
  return [
    taskRowLabel(task),
    `Employee: ${task.employee_name || "Unassigned"}`,
    `Planned Start: ${formatDateTime(task.planned_start_date)}`,
    `Due: ${formatDateTime(task.due_date)}`,
    `Duration: ${taskDurationLabel(task)}`,
    `Status: ${(task.status || "").replaceAll("_", " ")}`,
  ].join("\n");
}

// Buckets the tasks' combined planned_start_date/due_date span into
// calendar months so the Gantt can paginate one month at a time — same
// idea as WOGanttDrawer's monthBuckets in Production.jsx, computed here
// from raw task dates instead of a backend-supplied `timeline` array.
function buildMonthBuckets(tasks) {
  const dates = [];
  tasks.forEach((t) => {
    const s = dayOnly(t.planned_start_date);
    const e = dayOnly(t.due_date);
    if (s) dates.push(s);
    if (e) dates.push(e);
  });
  if (dates.length === 0) return [];

  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));

  const buckets = [];
  let cur = new Date(min.getFullYear(), min.getMonth(), 1);
  const end = new Date(max.getFullYear(), max.getMonth(), 1);
  while (cur.getTime() <= end.getTime()) {
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    buckets.push({
      key: `${year}-${month}`,
      label: cur.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      year,
      month,
      daysInMonth,
      monthStart: new Date(year, month, 1),
      monthEnd: new Date(year, month, daysInMonth),
    });
    cur = new Date(year, month + 1, 1);
  }
  return buckets;
}

// Clips a task's [planned_start_date, due_date] window into the active
// month bucket's day-grid coordinates (percent left/width), or null if the
// task doesn't intersect this month at all.
function computeBarGeometry(task, bucket) {
  const start = dayOnly(task.planned_start_date);
  const due = dayOnly(task.due_date);
  if (!start || !due) return null;
  if (due < bucket.monthStart || start > bucket.monthEnd) return null;

  const clampedStart = start < bucket.monthStart ? bucket.monthStart : start;
  const clampedEnd = due > bucket.monthEnd ? bucket.monthEnd : due;
  const cellWidth = 100 / bucket.daysInMonth;
  const leftIdx = clampedStart.getDate() - 1;
  const spanDays = Math.round((clampedEnd - clampedStart) / 86400000) + 1;

  return {
    left: leftIdx * cellWidth,
    width: Math.max(spanDays, 1) * cellWidth,
  };
}

/** Rich, searchable Lead/Project picker — a local port of CustomerPayments.
 * jsx's own AssignmentFilterSelect (same trigger/dropdown/search-input/
 * Lead|Project|Qty|Assigned table structure and close-on-outside-click/
 * Escape behavior), copied rather than shared: it's a small, page-scoped
 * component whose CSS classes live in this page's own module, so a future
 * change to either page's picker can never risk breaking the other. */
function AssignmentSearchSelect({ assignments, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) =>
      (a.lead_contact_name || "").toLowerCase().includes(q) ||
      (a.lead_company_name || "").toLowerCase().includes(q) ||
      (a.project_name || "").toLowerCase().includes(q)
    );
  }, [assignments, search]);

  const selected = assignments.find((a) => a.assignment_id === value);
  const selectedLabel = selected
    ? `${selected.lead_contact_name || "—"} · ${selected.project_name || "—"}`
    : "";

  return (
    <div className={styles.apWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.apTrigger}
        onClick={() => { setOpen((o) => !o); setSearch(""); }}
      >
        <span className={value ? styles.apTriggerValue : styles.apTriggerPlaceholder}>
          {value ? selectedLabel : "— Select Lead/Project —"}
        </span>
        <svg className={styles.apChevron} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={styles.apDropdown}>
          <div className={styles.apSearchWrap}>
            <input
              ref={searchRef}
              type="text"
              className={styles.apSearchInput}
              placeholder="Search by lead name, company, or project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={styles.apAllOption} onMouseDown={() => { onChange(""); setOpen(false); }}>
            — Select Lead/Project —
          </div>
          <div className={styles.apTableHead}>
            <span>Lead</span>
            <span>Project</span>
            <span>Qty</span>
            <span>Assigned</span>
          </div>
          <ul className={styles.apList}>
            {filtered.length === 0 ? (
              <li className={styles.apNoMatch}>No matches</li>
            ) : (
              filtered.map((a) => (
                <li
                  key={a.assignment_id}
                  className={`${styles.apOption} ${a.assignment_id === value ? styles.apOptionSelected : ""}`}
                  onMouseDown={() => { onChange(a.assignment_id); setOpen(false); }}
                >
                  <div className={styles.apOptionLead}>
                    <span className={styles.apOptionLeadName}>{a.lead_contact_name || "—"}</span>
                    {a.lead_company_name && <span className={styles.apOptionLeadCompany}>{a.lead_company_name}</span>}
                  </div>
                  <span className={styles.apOptionProject}>{a.project_name || "—"}</span>
                  <span className={styles.apOptionDate}>{a.quantity ?? 1}</span>
                  <span className={styles.apOptionDate}>{formatDateTime(a.assignment_created_at)}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, size }) {
  const theme = statusTheme(status);
  return (
    <span
      className={`${styles.statusPill} ${size === "lg" ? styles.statusPillLg : ""}`}
      style={{ background: theme.bg, color: theme.fg, borderColor: theme.border }}
    >
      <span className={styles.statusPillIcon}>{theme.icon}</span>
      {theme.label}
    </span>
  );
}

function UnscheduledList({ tasks, onSelectTask }) {
  return (
    <div className={styles.unscheduledBox}>
      <div className={styles.unscheduledTitle}>Not Yet Scheduled ({tasks.length})</div>
      <div className={styles.unscheduledList}>
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.unscheduledItem}
            onClick={() => onSelectTask(t)}
            title={taskTooltip(t)}
          >
            <span className={styles.unscheduledItemName}>{taskRowLabel(t)}</span>
            <StatusPill status={t.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

function GanttChart({ tasks, monthIdx, setMonthIdx, onSelectTask }) {
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const ad = a.planned_start_date ? new Date(a.planned_start_date).getTime() : Infinity;
      const bd = b.planned_start_date ? new Date(b.planned_start_date).getTime() : Infinity;
      return ad - bd;
    });
  }, [tasks]);

  const scheduledTasks = useMemo(
    () => sortedTasks.filter((t) => t.planned_start_date && t.due_date),
    [sortedTasks]
  );
  const unscheduledTasks = useMemo(
    () => sortedTasks.filter((t) => !t.planned_start_date || !t.due_date),
    [sortedTasks]
  );

  const monthBuckets = useMemo(() => buildMonthBuckets(scheduledTasks), [scheduledTasks]);
  const safeMonthIdx = Math.min(monthIdx, Math.max(0, monthBuckets.length - 1));
  const activeBucket = monthBuckets[safeMonthIdx];

  const rows = useMemo(() => {
    if (!activeBucket) return [];
    return scheduledTasks
      .map((task) => ({ task, geo: computeBarGeometry(task, activeBucket) }))
      .filter((r) => r.geo);
  }, [scheduledTasks, activeBucket]);

  const dayCells = useMemo(() => {
    if (!activeBucket) return [];
    return Array.from({ length: activeBucket.daysInMonth }, (_, i) => {
      const d = new Date(activeBucket.year, activeBucket.month, i + 1);
      return { dayNumber: i + 1, isSunday: d.getDay() === 0 };
    });
  }, [activeBucket]);

  const cellWidth = activeBucket ? 100 / activeBucket.daysInMonth : 0;

  return (
    <div className={styles.ganttWrap}>
      <div className={styles.legend}>
        {TASK_STATUS_OPTIONS.map((opt) => {
          const theme = statusTheme(opt.value);
          return (
            <span
              key={opt.value}
              className={styles.legendItem}
              style={{ background: theme.bg, color: theme.fg, borderColor: theme.border }}
            >
              <span className={styles.legendIcon}>{theme.icon}</span>
              {opt.label}
            </span>
          );
        })}
      </div>

      {!activeBucket ? (
        <div className={styles.ganttBox}>
          <div className={styles.ganttEmptyMonth}>
            None of the tasks below have both a planned start and due date yet — check the
            "Not Yet Scheduled" list underneath.
          </div>
        </div>
      ) : (
        <div className={styles.ganttBox}>
          <div className={styles.monthPaginator}>
            <button
              type="button"
              className={styles.monthNavBtn}
              onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
              disabled={safeMonthIdx === 0}
            >
              ‹ Prev
            </button>
            <div className={styles.monthPaginatorCenter}>
              <span className={styles.monthLabel}>{activeBucket.label}</span>
              <span className={styles.monthRangePill}>
                {rows.length} task{rows.length !== 1 ? "s" : ""}
              </span>
            </div>
            <button
              type="button"
              className={styles.monthNavBtn}
              onClick={() => setMonthIdx((i) => Math.min(monthBuckets.length - 1, i + 1))}
              disabled={safeMonthIdx >= monthBuckets.length - 1}
            >
              Next ›
            </button>
          </div>

          <div className={styles.ganttColHeader}>
            <div>Task</div>
            <div className={styles.timelineHeader}>
              {dayCells.map((d) => (
                <div
                  key={d.dayNumber}
                  className={styles.timelineCell}
                  style={{
                    left: `${(d.dayNumber - 1) * cellWidth}%`,
                    width: `${cellWidth}%`,
                    background: d.isSunday ? "var(--danger-bg)" : "transparent",
                  }}
                >
                  {d.dayNumber}
                </div>
              ))}
            </div>
            <div style={{ textAlign: "right" }}>Status</div>
          </div>

          {rows.length === 0 ? (
            <div className={styles.ganttEmptyMonth}>No tasks scheduled for {activeBucket.label}.</div>
          ) : (
            rows.map(({ task, geo }) => (
              <div key={task.id} className={styles.ganttRow}>
                <div className={styles.ganttRowLabel}>
                  {task.task_group_name && <span className={styles.groupLabel}>{task.task_group_name}</span>}
                  <span className={styles.taskNameRow}>
                    <span
                      className={styles.taskColorDot}
                      style={{ background: taskColorFor(task.task_template_id) }}
                    />
                    <span className={styles.taskName}>{taskRowLabel(task)}</span>
                  </span>
                  <span className={styles.employeeChip}>
                    {task.employee_name
                      ? `${task.employee_name}${task.employee_code ? ` (${task.employee_code})` : ""}`
                      : "Unassigned"}
                  </span>
                </div>

                <div className={styles.ganttTrack}>
                  {dayCells.map((d) => (
                    <div
                      key={d.dayNumber}
                      className={styles.trackCell}
                      style={{
                        left: `${(d.dayNumber - 1) * cellWidth}%`,
                        width: `${cellWidth}%`,
                        background: d.isSunday ? "var(--danger-bg)" : "transparent",
                      }}
                    />
                  ))}
                  <div
                    className={styles.barHoverWrap}
                    style={{ position: "absolute", left: `${geo.left}%`, width: `${geo.width}%`, top: 5, bottom: 5 }}
                  >
                    <button
                      type="button"
                      className={styles.ganttBar}
                      style={{
                        left: 0, right: 0, top: 0, bottom: 0,
                        background: taskColorFor(task.task_template_id),
                        borderColor: statusTheme(task.status).border,
                      }}
                      title={taskRowLabel(task)}
                      onClick={() => onSelectTask(task)}
                    >
                      <span className={styles.ganttBarStatusIcon}>{statusTheme(task.status).icon}</span>
                      <span className={styles.ganttBarLabel}>{taskRowLabel(task)}</span>
                    </button>
                    <div className={styles.hoverCard}>
                      <div className={styles.hoverCardTitle}>{taskRowLabel(task)}</div>
                      {task.project_unit_number != null && (
                        <div className={styles.hoverCardRow}><span>Unit</span><strong>{task.project_unit_number}</strong></div>
                      )}
                      <div className={styles.hoverCardRow}><span>Employee</span><strong>{task.employee_name || "Unassigned"}</strong></div>
                      <div className={styles.hoverCardRow}><span>Department</span><strong>{task.department_name || "—"}</strong></div>
                      <div className={styles.hoverCardRow}><span>Role</span><strong>{task.role_name || "—"}</strong></div>
                      <div className={styles.hoverCardRow}><span>Experience</span><strong>{task.employee_experience_level || "—"}</strong></div>
                      <div className={styles.hoverCardRow}><span>Start</span><strong>{formatDateTime(task.planned_start_date)}</strong></div>
                      <div className={styles.hoverCardRow}><span>Due</span><strong>{formatDateTime(task.due_date)}</strong></div>
                      <div className={styles.hoverCardRow}><span>Duration</span><strong>{taskDurationLabel(task)}</strong></div>
                      <div className={styles.hoverCardRow}><span>Status</span><strong>{statusTheme(task.status).icon} {statusTheme(task.status).label}</strong></div>
                    </div>
                  </div>
                </div>

                <div className={styles.ganttRowStatus}>
                  <StatusPill status={task.status} />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {unscheduledTasks.length > 0 && (
        <UnscheduledList tasks={unscheduledTasks} onSelectTask={onSelectTask} />
      )}
    </div>
  );
}

function TaskDetailField({ label, value }) {
  return (
    <div className={styles.taskDetailField}>
      <span className={styles.taskDetailFieldLabel}>{label}</span>
      <span className={styles.taskDetailFieldValue}>{value ?? "—"}</span>
    </div>
  );
}

/** Task Details modal — deliberately mirrors LeadDetailModal.jsx's exact
 * structure (gradient header banner with an icon avatar + name + status
 * pill, sectioned cards with an uppercase title and a 2-column field
 * grid) for visual consistency across the app's detail modals, per an
 * explicit request to match /lead-management/leads' Lead Details modal
 * look exactly. A bespoke component (not the generic schema-driven
 * PMEntityDetailsModal) since that structure can't produce this banner/
 * card layout. */
function TaskDetailModal({ task, onClose, projectQuantity }) {
  const theme = statusTheme(task?.status);
  return (
    <PMModal
      open={!!task}
      onClose={onClose}
      title="Task Details"
      size="md"
      footer={<PMButton variant="outline" onClick={onClose}>Close</PMButton>}
    >
      {task && (
        <div className={styles.taskDetailBody}>
          {/* Status header */}
          <div className={styles.taskDetailHeader} style={{ borderColor: theme.border }}>
            <div className={styles.taskDetailCompany}>
              <span
                className={styles.taskDetailCompanyIcon}
                style={{ background: taskColorFor(task.task_template_id) }}
              >
                <img src={TaskIcon} alt="Task" />
              </span>
              <div>
                <div className={styles.taskDetailCompanyName}>{taskRowLabel(task)}</div>
                <StatusPill status={task.status} size="lg" />
              </div>
            </div>
          </div>

          {/* Task Information */}
          <div className={styles.taskDetailSection}>
            <div className={styles.taskDetailSectionTitle}>Task Information</div>
            <div className={styles.taskDetailGrid}>
              <TaskDetailField label="Task Group" value={task.task_group_name} />
              <TaskDetailField label="Scope" value={task.task_scope} />
              <TaskDetailField label="Project Unit" value={task.project_unit_number != null ? `Unit ${task.project_unit_number}` : "—"} />
              <TaskDetailField label="Extended Count" value={task.extend_count ?? 0} />
            </div>
          </div>

          {/* Employee Information */}
          <div className={styles.taskDetailSection}>
            <div className={styles.taskDetailSectionTitle}>Employee Information</div>
            <div className={styles.taskDetailGrid}>
              <TaskDetailField label="Employee" value={task.employee_name || "Unassigned"} />
              <TaskDetailField label="Employee Code" value={task.employee_code} />
              <TaskDetailField label="Department" value={task.department_name} />
              <TaskDetailField label="Role" value={task.role_name} />
              <TaskDetailField
                label="Experience Level"
                value={task.employee_experience_level
                  ? task.employee_experience_level.charAt(0) + task.employee_experience_level.slice(1).toLowerCase()
                  : "—"}
              />
            </div>
          </div>

          {/* Scheduling Information */}
          <div className={styles.taskDetailSection}>
            <div className={styles.taskDetailSectionTitle}>Scheduling Information</div>
            <div className={styles.taskDetailGrid}>
              <TaskDetailField label="Planned Start Date" value={formatDateTime(task.planned_start_date)} />
              <TaskDetailField label="Due Date" value={formatDateTime(task.due_date)} />
              <TaskDetailField label="Actual Start Date" value={formatDateTime(task.actual_start_date)} />
              <TaskDetailField label="Completed Date" value={formatDateTime(task.completed_date)} />
              <TaskDetailField label="Estimated Hours" value={task.estimated_hours != null ? `${task.estimated_hours}h` : "—"} />
              <TaskDetailField label="Estimated Days" value={task.estimated_days} />
            </div>
          </div>

          {/* Project Information */}
          <div className={styles.taskDetailSection}>
            <div className={styles.taskDetailSectionTitle}>Project Information</div>
            <div className={styles.taskDetailGrid}>
              <TaskDetailField label="Customer" value={task.customer_name} />
              <TaskDetailField label="Project" value={task.project_name} />
              <TaskDetailField label="Project Quantity" value={projectQuantity ?? 1} />
            </div>
          </div>
        </div>
      )}
    </PMModal>
  );
}

/** Customer Task Timeline — pick a customer + Lead/Project assignment (same
 * top-of-page shape as CustomerPayments.jsx), then browse that assignment's
 * production tasks (from Automatic Production Scheduling) as a hand-rolled
 * Gantt chart mirroring Production.jsx's WOGanttDrawer (CSS-grid day-track
 * header, absolutely-positioned bars, month pagination, status legend). */
export default function CustomerTaskTimeline() {
  const toast = useToast();

  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerData, setCustomerData] = useState(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState("");

  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const refDataRef = useRef(false);

  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUnit, setFilterUnit] = useState("");
  const [dateRange, setDateRange] = useState(EMPTY_RANGE);

  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [monthIdx, setMonthIdx] = useState(0);
  const [selectedTask, setSelectedTask] = useState(null);

  // One-time reference data load (customers for the picker; department/
  // role/employee for the filter bar) — guarded by a ref flag the same way
  // EmailSendRule.jsx guards its own once-only load.
  useEffect(() => {
    if (refDataRef.current) return;
    refDataRef.current = true;
    customerMasterService.getAll().then((res) => {
      setCustomers(res.data?.rows || res.data || []);
    }).catch(() => { /* silent — mirrors CustomerPayments.jsx */ });
    Promise.all([departmentService.getAll(), roleService.getAll(), employeeService.getAll({ status: "ACTIVE" })])
      .then(([deptRes, roleRes, empRes]) => {
        setDepartments(deptRes.data || []);
        setRoles(roleRes.data || []);
        setEmployees(empRes.data || []);
      })
      .catch(() => toast.showError("Failed to load Department/Role/Employee reference data"));
  }, [toast]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      ID: c.ID,
      DISPLAY_LABEL: c.COMPANY_NAME ? `${c.NAME} — ${c.COMPANY_NAME}` : c.NAME,
    })),
    [customers]
  );

  const assignments = useMemo(() => customerData?.assignments || [], [customerData]);

  const selectedAssignmentObj = useMemo(
    () => assignments.find((a) => a.assignment_id === selectedAssignment) || null,
    [assignments, selectedAssignment]
  );

  const unitOptions = useMemo(() => {
    const qty = selectedAssignmentObj?.quantity || 1;
    if (qty <= 1) return [];
    return Array.from({ length: qty }, (_, i) => ({ value: String(i + 1), label: `Unit ${i + 1}` }));
  }, [selectedAssignmentObj]);

  const loadCustomerData = useCallback(async (custId) => {
    if (!custId) { setCustomerData(null); return; }
    setLoadingAssignments(true);
    try {
      const res = await customerPaymentService.getByCustomer(custId);
      setCustomerData(res.data);
    } catch {
      toast.showError("Failed to load customer assignments");
      setCustomerData(null);
    } finally {
      setLoadingAssignments(false);
    }
  }, [toast]);

  // `loadCustomerData` intentionally excluded — see CustomerPayments.jsx's
  // identical comment: it's a useCallback depending on `toast`, which
  // useToast() recreates every render, so depending on it here would
  // re-trigger this effect (and the loader) on every render.
  useEffect(() => {
    setSelectedAssignment("");
    setTasks([]);
    loadCustomerData(selectedCustomer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer]);

  const rolesForDept = useCallback(
    (id) => (id ? roles.filter((r) => String(r.DEPARTMENT_ID) === String(id)) : roles),
    [roles]
  );
  const employeesForFilters = useCallback(
    (dId, rId) => employees.filter((e) =>
      (!dId || String(e.DEPARTMENT_ID) === String(dId)) &&
      (!rId || String(e.ROLE_ID) === String(rId))
    ),
    [employees]
  );
  const employeeOptions = useMemo(
    () => employeesForFilters(filterDept, filterRole),
    [employeesForFilters, filterDept, filterRole]
  );

  const handleDeptChange = useCallback((v) => {
    setFilterDept(v || ""); setFilterRole(""); setFilterEmployee("");
  }, []);
  const handleRoleChange = useCallback((v) => {
    setFilterRole(v || ""); setFilterEmployee("");
  }, []);

  const loadTasks = useCallback(async () => {
    if (!selectedAssignment) { setTasks([]); return; }
    setLoadingTasks(true);
    try {
      const { from, to } = toIsoRange(dateRange, { withTime: false });
      const params = { assignment_id: selectedAssignment };
      if (filterEmployee) params.employee_id = filterEmployee;
      if (filterDept) params.department_id = filterDept;
      if (filterRole) params.role_id = filterRole;
      if (filterStatus) params.status = filterStatus;
      if (filterUnit) params.project_unit_number = filterUnit;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      const res = await productionScheduleService.listCustomerProjectTasks(params);
      setTasks(res.data || []);
      setMonthIdx(0);
    } catch {
      toast.showError("Failed to load task timeline");
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  }, [selectedAssignment, filterEmployee, filterDept, filterRole, filterStatus, filterUnit, dateRange, toast]);

  // `loadTasks` excluded from deps for the same reason as `loadCustomerData`
  // above — it closes over `toast`, which is recreated every render.
  useEffect(() => {
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignment, filterEmployee, filterDept, filterRole, filterStatus, filterUnit, dateRange]);

  const hasFilters = !!(filterEmployee || filterDept || filterRole || filterStatus || filterUnit || isRangeSet(dateRange));
  const handleResetFilters = useCallback(() => {
    setFilterEmployee(""); setFilterDept(""); setFilterRole(""); setFilterStatus(""); setFilterUnit("");
    setDateRange(EMPTY_RANGE);
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={TaskIcon}
        iconAlt="Customer Task Timeline"
        title="Customer Task Timeline"
        subtitle="Browse a customer's production task schedule — generated automatically once a Payment Milestone is reached and approved"
      />

      <div className={styles.body}>
        <div className={styles.selectorCard}>
          <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px" }}>
              <label className={styles.selectorLabel}>Select Customer</label>
              <PMSelect
                options={customerOptions}
                value={selectedCustomer}
                onChange={setSelectedCustomer}
                valueKey="ID"
                labelKey="DISPLAY_LABEL"
                allowClear
                clearLabel="— Search a customer —"
                size="lg"
                style={{ maxWidth: 480 }}
              />
            </div>
            {assignments.length > 0 && (
              <div style={{ flex: "1 1 320px" }}>
                <label className={styles.selectorLabel}>Select Lead / Project</label>
                <AssignmentSearchSelect
                  assignments={assignments}
                  value={selectedAssignment}
                  onChange={setSelectedAssignment}
                />
              </div>
            )}
          </div>
          {selectedAssignmentObj && (
            <div className={styles.assignmentSummaryBar}>
              <span><strong>Lead:</strong> {selectedAssignmentObj.lead_contact_name || "—"}</span>
              <span><strong>Project:</strong> {selectedAssignmentObj.project_name || "—"}</span>
              <span><strong>Quantity:</strong> {selectedAssignmentObj.quantity ?? 1}</span>
            </div>
          )}
        </div>

        {loadingAssignments ? (
          <Loader />
        ) : !selectedCustomer ? (
          <EmptyState
            icon={TaskIcon}
            iconAlt="Customer Task Timeline"
            title="Select a customer to begin"
            description="Search and select a customer above to view their production task timeline."
          />
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={TaskIcon}
            iconAlt="Customer Task Timeline"
            title="No Lead/Project assignments for this customer"
            description="A production schedule is generated automatically once a customer's payment reaches the first configured Payment Milestone."
          />
        ) : !selectedAssignment ? (
          <EmptyState
            icon={TaskIcon}
            iconAlt="Customer Task Timeline"
            title="Select a Lead / Project"
            description="Choose a Lead/Project above to view its task timeline."
          />
        ) : (
          <>
            <div className={styles.filterBar}>
              <div className={styles.filterGroup}>
                <label>Employee</label>
                <PMSelect
                  options={employeeOptions}
                  value={filterEmployee}
                  onChange={(v) => setFilterEmployee(v || "")}
                  valueKey="ID"
                  labelKey="NAME"
                  allowClear
                  clearLabel="All Employees"
                  placeholder="Search employees…"
                />
              </div>
              <div className={styles.filterGroup}>
                <label>Department</label>
                <PMSelect
                  options={departments}
                  value={filterDept}
                  onChange={handleDeptChange}
                  valueKey="ID"
                  labelKey="NAME"
                  allowClear
                  clearLabel="All Departments"
                />
              </div>
              <div className={styles.filterGroup}>
                <label>Role</label>
                <PMSelect
                  options={rolesForDept(filterDept)}
                  value={filterRole}
                  onChange={handleRoleChange}
                  valueKey="ID"
                  labelKey="NAME"
                  allowClear
                  clearLabel="All Roles"
                />
              </div>
              <div className={styles.filterGroup}>
                <label>Task Status</label>
                <PMSelect
                  options={TASK_STATUS_OPTIONS}
                  value={filterStatus}
                  onChange={(v) => setFilterStatus(v || "")}
                  valueKey="value"
                  labelKey="label"
                  allowClear
                  clearLabel="All Statuses"
                />
              </div>
              {unitOptions.length > 0 && (
                <div className={styles.filterGroup}>
                  <label>Project Unit</label>
                  <PMSelect
                    options={unitOptions}
                    value={filterUnit}
                    onChange={(v) => setFilterUnit(v || "")}
                    valueKey="value"
                    labelKey="label"
                    allowClear
                    clearLabel="All Units"
                  />
                </div>
              )}
              <DateTimeRangeFilter
                value={dateRange}
                onChange={setDateRange}
                onClear={() => setDateRange(EMPTY_RANGE)}
                showTime={false}
              />
              {hasFilters && (
                <div className={styles.filterActions}>
                  <PMButton variant="outline" onClick={handleResetFilters}>Reset Filters</PMButton>
                </div>
              )}
            </div>

            {loadingTasks ? (
              <Loader />
            ) : tasks.length === 0 ? (
              <EmptyState
                icon={TaskIcon}
                iconAlt="Customer Task Timeline"
                title={hasFilters ? "No tasks match your filters" : "No tasks yet"}
                description={
                  hasFilters
                    ? "Clear the filters above to see every task for this Lead/Project."
                    : "Tasks appear here once a Production Schedule for this Lead/Project has been approved."
                }
              />
            ) : (
              <GanttChart tasks={tasks} monthIdx={monthIdx} setMonthIdx={setMonthIdx} onSelectTask={setSelectedTask} />
            )}
          </>
        )}
      </div>

      <TaskDetailModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        projectQuantity={selectedAssignmentObj?.quantity ?? 1}
      />
    </div>
  );
}
