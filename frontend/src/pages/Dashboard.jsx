import { lazy, Suspense, useEffect, useRef, useState } from "react";

import {
  Link,
  NavLink,
  Routes,
  Route,
  useNavigate,
  useLocation
} from "react-router-dom";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Label,
  LabelList,
  ResponsiveContainer
} from "recharts";

import API from "../services/api";

import {
  isVoiceEnabled,
  speak,
  buildAlertSpeech,
  getLastSeenId,
  setLastSeenId
} from "../services/voiceAlerts";

import Employees from "./Employees";
import EmployeeOnboardingReview from "./EmployeeOnboardingReview";
import Customers from "./Customers";
import Quotations from "./Quotations";
import SalesOrders from "./SalesOrders";
import InvoiceOrder from "./InvoiceOrder";
import PurchaseOrders from "./PurchaseOrders";
import Inventory from "./Inventory";
import Attendance from "./Attendance";
import Machines from "./Machines";
import Reports from "./Reports";
import Settings from "./Settings";
import Organization from "./Organization";
// MDReview removed Phase 2 — superseded by Star Performance
import Production from "./Production";
import Quality from "./Quality";
import Suppliers from "./Suppliers";
import Purchase from "./Purchase";
import LeaveManagement from "./LeaveManagement";
import DashboardHome from "./DashboardHome";
import AdminDashboard from "./AdminDashboard";
import AdminDashboardV2 from "./AdminDashboardV2";
import EnterpriseCommandCenter from "./EnterpriseCommandCenter";
import RoleManagement from "./RoleManagement";
import RbacPermissions from "./RbacPermissions";
import HolidayCalendar from "./HolidayCalendar";
import WorkCenters from "./WorkCenters";
import CompanySettings from "./CompanySettings";
import GeofenceSettings from "./GeofenceSettings";
import EmployeeMemos from "./EmployeeMemos";
import ApprovalCenter from "./ApprovalCenter";
// AICommandCenter + Workflow removed Phase 2 — were placeholder stubs
import Payroll from "./Payroll";
import StarPerformance from "./StarPerformance";
import Allowances from "./Allowances";
import ChatBot from "../components/ChatBot";
const DepartmentManagement = lazy(() => import("./DepartmentManagement"));
const OrgRoleManagement = lazy(() => import("./OrgRoleManagement"));
const ProjectCategoryManagement = lazy(() => import("./ProjectCategoryManagement"));
const ProjectPage = lazy(() => import("./ProjectPage"));
const TaskTemplatePage = lazy(() => import("./TaskTemplatePage"));

import styles from "./Dashboard.module.css";
import {
  PALETTE as CHART_COLORS,
  TASK_STATUS_COLORS,
  ATTENDANCE_COLORS,
  ChartGradients,
  ChartTooltip,
  DonutCenter,
  renderPercentLabel,
  sumValues
} from "../utils/chartHelpers";

function NotificationBell() {

  const [items, setItems] = useState([]);

  const [unread, setUnread] = useState(0);

  const [open, setOpen] = useState(false);

  const [firstFetch, setFirstFetch] = useState(true);

  const fetchUnread = async () => {

    try {

      const res = await API.get(
        "/notifications/unread-count"
      );

      setUnread(res.data.count || 0);

    } catch (e) {

      console.log(e);
    }
  };

  const fetchList = async () => {

    try {

      const res = await API.get("/notifications");

      setItems(res.data);

      checkForVoiceAlerts(res.data);

    } catch (e) {

      console.log(e);
    }
  };

  const checkForVoiceAlerts = (rows) => {

    if (!Array.isArray(rows) || rows.length === 0) {

      if (firstFetch) setFirstFetch(false);

      return;
    }

    const maxId = Math.max(...rows.map((n) => n.ID));

    if (firstFetch) {

      setLastSeenId(maxId);

      setFirstFetch(false);

      return;
    }

    if (!isVoiceEnabled()) {

      setLastSeenId(maxId);

      return;
    }

    const lastSeen = getLastSeenId();

    const fresh = rows.filter(
      (n) =>
        n.ID > lastSeen
        && !n.IS_READ
        && (n.TYPE === "ERROR" || n.TYPE === "WARNING")
    );

    if (fresh.length > 0) {

      const sorted = [...fresh].sort(
        (a, b) => a.ID - b.ID
      );

      sorted.forEach((n, idx) => {

        setTimeout(() => {

          speak(buildAlertSpeech(n.TITLE, n.MESSAGE));

        }, idx * 4500);
      });
    }

    setLastSeenId(maxId);
  };

  const generate = async () => {

    try {

      await API.post("/notifications/generate");

      fetchUnread();

      fetchList();

    } catch (e) {

      console.log(e);
    }
  };

  useEffect(() => {

    fetchUnread();

    generate();

    const interval = setInterval(() => {

      fetchUnread();

      generate();

    }, 30000);

    return () => clearInterval(interval);

  }, []);

  const toggle = () => {

    const next = !open;

    setOpen(next);

    if (next) fetchList();
  };

  const markRead = async (id) => {

    try {

      await API.put(`/notifications/${id}/read`);

      fetchList();

      fetchUnread();

    } catch (e) {

      console.log(e);
    }
  };

  const markAllRead = async () => {

    try {

      await API.put("/notifications/mark-all-read");

      fetchList();

      fetchUnread();

    } catch (e) {

      console.log(e);
    }
  };

  const remove = async (id) => {

    try {

      await API.delete(`/notifications/${id}`);

      fetchList();

      fetchUnread();

    } catch (e) {

      console.log(e);
    }
  };

  const typeClass = (type) => {

    if (type === "ERROR") return "notif-error";

    if (type === "WARNING") return "notif-warning";

    if (type === "SUCCESS") return "notif-success";

    return "notif-info";
  };

  return (

    <div className="notification-wrapper">

      <button
        className="notification-bell"
        onClick={toggle}
        aria-label="Notifications"
      >

        <svg
          width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="#dc2626" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>

        {
          unread > 0 && (
            <span className="notification-badge">
              {unread > 99 ? "99+" : unread}
            </span>
          )
        }

      </button>

      {
        open && (

          <div className="notification-panel">

            <div className="notification-header">

              <strong>Notifications</strong>

              <div>

                <button
                  className="notif-link"
                  onClick={markAllRead}
                >
                  Mark all read
                </button>

                <button
                  className="notif-link"
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>

              </div>

            </div>

            <div className="notification-list">

              {
                items.length === 0 ? (

                  <p className="notif-empty">
                    No notifications
                  </p>

                ) : (

                  items.map((n) => (

                    <div
                      key={n.ID}
                      className={
                        "notif-item " +
                        typeClass(n.TYPE) +
                        (n.IS_READ ? " notif-read" : "")
                      }
                    >

                      <div className="notif-content">

                        <div className="notif-title">
                          {n.TITLE}
                        </div>

                        <div className="notif-msg">
                          {n.MESSAGE}
                        </div>

                        <div className="notif-time">
                          {
                            n.CREATED_AT
                              ? new Date(
                                n.CREATED_AT
                              ).toLocaleString()
                              : ""
                          }
                        </div>

                      </div>

                      <div className="notif-actions">

                        <button
                          className="notif-link"
                          title="Play voice alert"
                          onClick={() =>
                            speak(
                              buildAlertSpeech(
                                n.TITLE,
                                n.MESSAGE
                              )
                            )
                          }
                        >
                          🔊
                        </button>

                        {
                          !n.IS_READ && (
                            <button
                              className="notif-link"
                              onClick={() =>
                                markRead(n.ID)
                              }
                            >
                              Mark read
                            </button>
                          )
                        }

                        <button
                          className="notif-link notif-del"
                          onClick={() => remove(n.ID)}
                        >
                          Delete
                        </button>

                      </div>

                    </div>
                  ))
                )
              }

            </div>

          </div>
        )
      }

    </div>
  );
}

const CHART_ITEM_CAP = 20;

const DEFAULT_TOP_N = 10;


function InventorySummaryCard({ items, loading }) {

  // `items` is the full sorted-by-value list from the API.
  // Selection is local; backend always returns everything.
  const [selected, setSelected] = useState(new Set());

  const initialized = useRef(false);

  // Pre-select the top N by value on first arrival.
  // Polling will keep refreshing `items` but we won't
  // override what the user has chosen after this point.
  useEffect(() => {

    if (initialized.current) return;

    if (!items || items.length === 0) return;

    initialized.current = true;

    setSelected(
      new Set(
        items
          .slice(0, DEFAULT_TOP_N)
          .map((i) => i.name)
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const toggle = (name) => {

    setSelected((prev) => {

      const next = new Set(prev);

      if (next.has(name)) next.delete(name);
      else next.add(name);

      return next;
    });
  };

  const clearAll = () => setSelected(new Set());

  const selectTopN = (n) => {

    setSelected(
      new Set(items.slice(0, n).map((i) => i.name))
    );
  };

  // Chart data: only selected items, capped at CHART_ITEM_CAP
  const chartData = items
    .filter((i) => selected.has(i.name))
    .slice(0, CHART_ITEM_CAP);

  const totalSelected = selected.size;

  const isOverCap = totalSelected > CHART_ITEM_CAP;

  return (

    <div className="chart-card">

      <div className={styles.chartCardHeader}>
        <h3 className={styles.chartCardTitle}>Inventory Summary</h3>

        <div className={styles.chartCapNote}>
          {chartData.length} of {items.length} shown
          {isOverCap && (
            <span className={styles.chartCapWarn}>
              {" "}· capped at {CHART_ITEM_CAP}
            </span>
          )}
        </div>
      </div>

      {/* Chip row */}
      {items.length > 0 && (
        <div className={styles.chipRow}>
          {items.map((it) => {
            const isOn = selected.has(it.name);
            return (
              <button
                key={it.name}
                type="button"
                onClick={() => toggle(it.name)}
                className={`${styles.chip}${isOn ? ` ${styles.chipOn}` : ""}`}
                title={`₹${(it.value || 0).toLocaleString()}`}
              >
                {isOn && <span>✓ </span>}
                {it.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick actions */}
      {items.length > 0 && (
        <div className={styles.quickRow}>
          <button type="button" onClick={() => selectTopN(DEFAULT_TOP_N)} className={styles.miniBtn}>
            Top {DEFAULT_TOP_N} by value
          </button>
          <button type="button" onClick={() => selectTopN(CHART_ITEM_CAP)} className={styles.miniBtn}>
            Top {CHART_ITEM_CAP}
          </button>
          <button type="button" onClick={() => selectTopN(items.length)} className={styles.miniBtn}>
            All ({items.length})
          </button>
          <button type="button" onClick={clearAll} className={`${styles.miniBtn} ${styles.miniBtnDanger}`}>
            Clear
          </button>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 ? (

        <ResponsiveContainer width="100%" height={280}>

          <BarChart
            data={chartData}
            margin={{ top: 20, right: 12, left: -10, bottom: 4 }}
          >
            <defs>
              <ChartGradients />
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e2e8f0"
              vertical={false}
            />

            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "#475569" }}
              axisLine={{ stroke: "#cbd5e1" }}
              tickLine={false}
              interval={0}
              angle={chartData.length > 8 ? -30 : 0}
              textAnchor={chartData.length > 8 ? "end" : "middle"}
              height={chartData.length > 8 ? 60 : 30}
            />

            <YAxis
              tick={{ fontSize: 11, fill: "#475569" }}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip
              cursor={{ fill: "rgba(37, 99, 235, 0.06)" }}
              content={
                <ChartTooltip
                  valueFmt={(v) =>
                    typeof v === "number" && v >= 1000
                      ? v.toLocaleString()
                      : v
                  }
                />
              }
            />

            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
            />

            <Bar
              dataKey="quantity"
              name="Quantity"
              fill="url(#grad-0)"
              radius={[8, 8, 0, 0]}
              animationDuration={900}
            />

            <Bar
              dataKey="value"
              name="Value (₹)"
              fill="url(#grad-1)"
              radius={[8, 8, 0, 0]}
              animationDuration={900}
            />

          </BarChart>

        </ResponsiveContainer>

      ) : (

        <p className="empty-chart">
          {loading
            ? "Loading…"
            : items.length === 0
              ? "No inventory data"
              : "Pick at least one item from the chips above."}
        </p>
      )}

    </div>
  );
}



function DashboardHomeLegacy() {

  const [stats, setStats] = useState(null);

  const [charts, setCharts] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const fetchAll = async () => {

    try {

      const [statsRes, chartsRes] = await Promise.all([
        API.get("/dashboard-stats"),
        API.get("/chart-data")
      ]);

      setStats(statsRes.data);

      setCharts(chartsRes.data);

      setError("");

    } catch (err) {

      console.log(err);

      setError("Unable to load live stats");

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

    const interval = setInterval(fetchAll, 10000);

    return () => clearInterval(interval);

  }, []);

  return (

    <>

      <div className="dashboard-header">

        <h1>Live ERP Analytics</h1>

        <button
          className="refresh-btn"
          onClick={fetchAll}
        >
          Refresh
        </button>

      </div>

      {
        error && (
          <p className="dashboard-error">
            {error}
          </p>
        )
      }

      <div className="cards">

        <div className="card card-blue">

          <h3>Total Employees</h3>

          <p>
            {loading ? "…" : stats?.total_employees ?? 0}
          </p>

        </div>

        <div className="card card-violet">

          <h3>Total Projects</h3>

          <p>
            {loading ? "…" : stats?.total_projects ?? 0}
          </p>

        </div>

        <div className="card card-amber">

          <h3>Pending Tasks</h3>

          <p>
            {loading ? "…" : stats?.pending_tasks ?? 0}
          </p>

        </div>

        <div className="card card-green">

          <h3>Inventory Items</h3>

          <p>
            {loading ? "…" : stats?.inventory_items ?? 0}
          </p>

        </div>

      </div>

      <h2 className="section-title">Task Breakdown</h2>

      <div className="cards">

        <div className="card">

          <h3>In Progress</h3>

          <p>
            {loading ? "…" : stats?.in_progress_tasks ?? 0}
          </p>

        </div>

        <div className="card">

          <h3>Completed</h3>

          <p>
            {loading ? "…" : stats?.completed_tasks ?? 0}
          </p>

        </div>

        <div className="card">

          <h3>On Hold</h3>

          <p>
            {loading ? "…" : stats?.on_hold_tasks ?? 0}
          </p>

        </div>

        <div className="card">

          <h3>Total Tasks</h3>

          <p>
            {loading ? "…" : stats?.total_tasks ?? 0}
          </p>

        </div>

      </div>

      <h2 className="section-title">Inventory Overview</h2>

      <div className="cards">

        <div className="card">

          <h3>Total Stock Units</h3>

          <p>
            {loading ? "…" : stats?.total_stock ?? 0}
          </p>

        </div>

        <div className="card">

          <h3>Inventory Value</h3>

          <p>
            {
              loading
                ? "…"
                : `₹ ${Number(
                  stats?.inventory_value ?? 0
                ).toLocaleString()}`
            }
          </p>

        </div>

      </div>

      <h2 className="section-title">Attendance Today</h2>

      <div className="cards">

        <div className="card card-green">

          <h3>Present</h3>

          <p>
            {loading ? "…" : stats?.present_today ?? 0}
          </p>

        </div>

        <div className="card card-amber">

          <h3>Late</h3>

          <p>
            {loading ? "…" : stats?.late_today ?? 0}
          </p>

        </div>

        <div className="card card-blue">

          <h3>Absent</h3>

          <p>
            {loading ? "…" : stats?.absent_today ?? 0}
          </p>

        </div>

      </div>

      <h2 className="section-title">Analytics & Charts</h2>

      <div className="charts-grid">

        <div className="chart-card">

          <h3>Tasks Status</h3>

          {
            charts?.tasks_by_status?.length ? (

              <ResponsiveContainer width="100%" height={280}>

                <PieChart>

                  <Pie
                    data={charts.tasks_by_status}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                    label={renderPercentLabel}
                    labelLine={false}
                    animationBegin={0}
                    animationDuration={800}
                    isAnimationActive
                  >
                    {charts.tasks_by_status.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={
                          TASK_STATUS_COLORS[entry.name] ||
                          CHART_COLORS[idx % CHART_COLORS.length]
                        }
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    ))}
                    <Label
                      position="center"
                      content={(props) => (
                        <DonutCenter
                          {...props}
                          total={sumValues(charts.tasks_by_status)}
                          caption="Total tasks"
                        />
                      )}
                    />
                  </Pie>

                  <Tooltip content={<ChartTooltip />} />

                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                  />

                </PieChart>

              </ResponsiveContainer>

            ) : (

              <p className="empty-chart">
                {loading ? "Loading…" : "No task data"}
              </p>
            )
          }

        </div>

        <div className="chart-card">

          <h3>Projects Overview</h3>

          {
            charts?.projects_per_customer?.length ? (

              <ResponsiveContainer width="100%" height={280}>

                <BarChart
                  data={charts.projects_per_customer}
                  margin={{ top: 20, right: 12, left: -10, bottom: 4 }}
                >
                  <defs>
                    <ChartGradients />
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    vertical={false}
                  />

                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#475569" }}
                    axisLine={{ stroke: "#cbd5e1" }}
                    tickLine={false}
                  />

                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#475569" }}
                    axisLine={false}
                    tickLine={false}
                  />

                  <Tooltip
                    cursor={{ fill: "rgba(124, 58, 237, 0.08)" }}
                    content={<ChartTooltip />}
                  />

                  <Bar
                    dataKey="value"
                    name="Projects"
                    fill="url(#grad-4)"
                    radius={[8, 8, 0, 0]}
                    animationDuration={900}
                  >
                    <LabelList
                      dataKey="value"
                      position="top"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        fill: "#7c3aed"
                      }}
                    />
                  </Bar>

                </BarChart>

              </ResponsiveContainer>

            ) : (

              <p className="empty-chart">
                {loading ? "Loading…" : "No customer data"}
              </p>
            )
          }

        </div>

        <InventorySummaryCard
          items={charts?.inventory_summary || []}
          loading={loading}
        />

        <div className="chart-card">

          <h3>Attendance Today</h3>

          {
            charts?.attendance_today?.length ? (

              <ResponsiveContainer width="100%" height={280}>

                <PieChart>

                  <Pie
                    data={charts.attendance_today}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                    label={renderPercentLabel}
                    labelLine={false}
                    animationBegin={0}
                    animationDuration={800}
                    isAnimationActive
                  >
                    {charts.attendance_today.map((entry, idx) => (
                      <Cell
                        key={`att-${idx}`}
                        fill={
                          ATTENDANCE_COLORS[entry.name] ||
                          CHART_COLORS[idx % CHART_COLORS.length]
                        }
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    ))}
                    <Label
                      position="center"
                      content={(props) => (
                        <DonutCenter
                          {...props}
                          total={sumValues(charts.attendance_today)}
                          caption="Marked today"
                        />
                      )}
                    />
                  </Pie>

                  <Tooltip content={<ChartTooltip />} />

                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                  />

                </PieChart>

              </ResponsiveContainer>

            ) : (

              <p className="empty-chart">
                {
                  loading
                    ? "Loading…"
                    : "No attendance recorded today"
                }
              </p>
            )
          }

        </div>

        <div className="chart-card">

          <h3>Employee Distribution</h3>

          {
            charts?.employees_per_role?.length ? (

              <ResponsiveContainer width="100%" height={280}>

                <PieChart>

                  <Pie
                    data={charts.employees_per_role}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                    label={renderPercentLabel}
                    labelLine={false}
                    animationBegin={0}
                    animationDuration={800}
                    isAnimationActive
                  >
                    {charts.employees_per_role.map((_entry, idx) => (
                      <Cell
                        key={`role-${idx}`}
                        fill={CHART_COLORS[idx % CHART_COLORS.length]}
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    ))}
                    <Label
                      position="center"
                      content={(props) => (
                        <DonutCenter
                          {...props}
                          total={sumValues(charts.employees_per_role)}
                          caption="Employees"
                        />
                      )}
                    />
                  </Pie>

                  <Tooltip content={<ChartTooltip />} />

                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                  />

                </PieChart>

              </ResponsiveContainer>

            ) : (

              <p className="empty-chart">
                {loading ? "Loading…" : "No employee data"}
              </p>
            )
          }

        </div>

      </div>

      <p className="dashboard-footer">
        Auto-refreshing every 10 seconds
      </p>

    </>
  );
}


// =================================================================
// Sidebar navigation — grouped, collapsible sections for a cleaner
// professional layout. Top-level items (Dashboard) stay always-visible;
// the rest are inside category groups.
//
// Icons are inline SVGs (Heroicons-style outline) instead of emojis —
// matches the BVC24 corporate brand and renders consistently across
// platforms.
// =================================================================

function SidebarIcon({ name }) {

  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="9" rx="1.4" />
          <rect x="14" y="3" width="7" height="5" rx="1.4" />
          <rect x="3" y="16" width="7" height="5" rx="1.4" />
          <rect x="14" y="12" width="7" height="9" rx="1.4" />
        </svg>
      );
    case "approvals":
      return (
        <svg {...props}>
          <path d="M9 12l2 2 4-4" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "roles":
      return (
        <svg {...props}>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "rbac":
      return (
        <svg {...props}>
          <path d="M12 3l8 3v6c0 5-3.6 8.4-8 9-4.4-.6-8-4-8-9V6l8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "employees":
      return (
        <svg {...props}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M3 21c0-3.6 2.7-6 6-6s6 2.4 6 6" />
          <circle cx="17" cy="9" r="2.6" />
          <path d="M15 21c0-2.5 1.6-4.5 4-4.5" />
        </svg>
      );
    case "memos":
      return (
        <svg {...props}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "attendance":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      );
    case "leaves":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
          <circle cx="12" cy="15" r="1.2" fill="currentColor" />
        </svg>
      );
    case "payroll":
      return (
        <svg {...props}>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <circle cx="12" cy="12.5" r="2.6" />
          <path d="M3 10h18" />
        </svg>
      );
    case "star":
      return (
        <svg {...props}>
          <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.7 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z" />
        </svg>
      );
    case "allowances":
      return (
        <svg {...props}>
          {/* Receipt / expense voucher */}
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "customers":
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21c0-4 3-7 7-7s7 3 7 7" />
        </svg>
      );
    case "quotations":
      return (
        <svg {...props}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
          <path d="M10 13h4M10 17h4" />
        </svg>
      );
    case "salesorders":
      return (
        <svg {...props}>
          <rect x="6" y="4" width="12" height="17" rx="2" />
          <rect x="9" y="2.5" width="6" height="3" rx="1" />
          <path d="M9 11h6M9 15h6" />
        </svg>
      );

    case "invoiceorders":
      return (
        <svg {...props}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 7h6" />
          <path d="M12 9v10" />
          <path d="M14.2 11.4c0-1-1-1.6-2.2-1.6s-2.2.6-2.2 1.6.9 1.5 2.2 1.6c1.3.1 2.2.7 2.2 1.7s-1 1.6-2.2 1.6-2.2-.6-2.2-1.6" />
        </svg>
      );
    case "projects":
      return (
        <svg {...props}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
      );
    case "machines":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1c.5.5 1.2.6 1.8.3.7-.3 1.1-1 1.1-1.7V3a2 2 0 0 1 4 0v.1c0 .7.4 1.4 1 1.7.6.3 1.3.2 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8c.3.6 1 1 1.7 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "production":
      return (
        <svg {...props}>
          <path d="M3 21V11l5 3V11l5 3V11l5 3v7z" />
          <path d="M3 21h18" />
          <rect x="9" y="17" width="2" height="3" />
          <rect x="14" y="17" width="2" height="3" />
        </svg>
      );
    case "quality":
      return (
        <svg {...props}>
          <path d="M12 3l8 3v6c0 5-3.6 8.4-8 9-4.4-.6-8-4-8-9V6l8-3z" />
          <path d="M8.5 12l2.5 2.5L15.5 10" />
        </svg>
      );
    case "suppliers":
      return (
        <svg {...props}>
          <path d="M3 7h11v10H3z" />
          <path d="M14 10h4l3 3v4h-7z" />
          <circle cx="7" cy="18.5" r="1.8" />
          <circle cx="17" cy="18.5" r="1.8" />
        </svg>
      );
    case "purchase":
      return (
        <svg {...props}>
          <path d="M3 5h2l2.5 11h10l2-7H6.5" />
          <circle cx="9" cy="20" r="1.5" />
          <circle cx="17" cy="20" r="1.5" />
        </svg>
      );
    case "purchaseorders":
      return (
        <svg {...props}>
          <rect x="5" y="4" width="14" height="17" rx="2" />
          <path d="M9 9h6M9 13h6M9 17h4" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...props}>
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4V11" />
          <path d="M21 7v10l-9 4" />
        </svg>
      );
    case "reports":
      return (
        <svg {...props}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "company":
      return (
        <svg {...props}>
          <rect x="4" y="3" width="16" height="18" rx="1.5" />
          <path d="M8 7h2M8 11h2M8 15h2M14 7h2M14 11h2M14 15h2" />
          <path d="M10 21v-3h4v3" />
        </svg>
      );
    case "geofence":
      return (
        <svg {...props}>
          <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
      );
    case "holidays":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
          <circle cx="8" cy="14" r="1.2" fill="currentColor" />
          <circle cx="16" cy="14" r="1.2" fill="currentColor" />
          <circle cx="12" cy="17.5" r="1.2" fill="currentColor" />
        </svg>
      );
    case "workcenters":
      return (
        <svg {...props}>
          <rect x="3" y="10" width="4" height="11" rx="0.6" />
          <rect x="10" y="6" width="4" height="15" rx="0.6" />
          <rect x="17" y="13" width="4" height="8" rx="0.6" />
          <path d="M3 21h18" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1c.5.5 1.2.6 1.8.3.7-.3 1.1-1 1.1-1.7V3a2 2 0 0 1 4 0v.1c0 .7.4 1.4 1 1.7.6.3 1.3.2 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8c.3.6 1 1 1.7 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "departments":
      return (
        <svg {...props}>
          <rect x="3" y="10" width="18" height="11" rx="2" />
          <path d="M7 10V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
          <path d="M10 14h4" />
        </svg>
      );
    case "org-roles":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="3" />
          <path d="M4 20c0-3 2-5 4-5s4 2 4 5" />
          <path d="M14 10h6M14 14h6" />
        </svg>
      );
    case "proj-cat":
      return (
        <svg {...props}>
          <path d="M4 7h16M4 12h10M4 17h7" />
          <circle cx="19" cy="16" r="3" />
          <path d="M19 13v3l2 1" />
        </svg>
      );
    case "sub-template":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 9h18M8 13h3M8 16h5" />
        </svg>
      );
    case "task-tmpl":
      return (
        <svg {...props}>
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "custom-fields":
      return (
        <svg {...props}>
          <path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h5" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}


const NAV_TOP = [
  { to: "/", icon: <SidebarIcon name="dashboard" />, label: "Dashboard" }
];

const NAV_GROUPS = [
  {
    key: "org",
    label: "Organization",
    items: [
      { to: "/approvals", icon: <SidebarIcon name="approvals" />, label: "Approval Center" },
      // { to: "/roles",             icon: <SidebarIcon name="roles"       />, label: "Roles & Permissions" },  // permanently hidden — RBAC page replaces it
      { to: "/rbac", icon: <SidebarIcon name="rbac" />, label: "RBAC" },
      { to: "/departments", icon: <SidebarIcon name="departments" />, label: "Department Management" },
      { to: "/org-roles", icon: <SidebarIcon name="org-roles" />, label: "Role Management" },
      { to: "/employees", icon: <SidebarIcon name="employees" />, label: "Employees" },
      { to: "/memos", icon: <SidebarIcon name="memos" />, label: "Memos" },
      { to: "/attendance", icon: <SidebarIcon name="attendance" />, label: "Attendance" },
      { to: "/leave-management", icon: <SidebarIcon name="leaves" />, label: "Leave Management" },
      { to: "/payroll", icon: <SidebarIcon name="payroll" />, label: "Payroll" },
      { to: "/star-performance", icon: <SidebarIcon name="star" />, label: "Star Performance" }
    ]
  },
  {
    key: "crm",
    label: "CRM & Sales",
    items: [
      { to: "/customers", icon: <SidebarIcon name="customers" />, label: "Customers" },
      { to: "/quotations", icon: <SidebarIcon name="quotations" />, label: "Quotations" },
      { to: "/sales-orders", icon: <SidebarIcon name="salesorders" />, label: "Sales Orders" },
      { to: "/invoice-orders", icon: <SidebarIcon name="invoiceorders" />, label: "Invoice" }
    ]
  },
  // {
  //   key: "organization",
  //   label: "Org Structure",
  //   items: [
  //     { to: "/departments", icon: <SidebarIcon name="departments" />, label: "Department Management" },
  //     { to: "/org-roles", icon: <SidebarIcon name="org-roles" />, label: "Role Management" }
  //   ]
  // },
  {
    key: "project-mgmt",
    label: "Project Management",
    items: [
      { to: "/project-categories", icon: <SidebarIcon name="proj-cat" />, label: "Project Categories" },
      { to: "/projects", icon: <SidebarIcon name="sub-template" />, label: "Projects" },
      { to: "/task-templates", icon: <SidebarIcon name="task-tmpl" />, label: "Task Templates" }
    ]
  },
  {
    key: "manufacturing",
    label: "Manufacturing",
    items: [
      { to: "/machines", icon: <SidebarIcon name="machines" />, label: "Machines" },
      { to: "/work-centers", icon: <SidebarIcon name="workcenters" />, label: "Work Centers" },
      { to: "/production", icon: <SidebarIcon name="production" />, label: "Production & BOM" },
      { to: "/quality", icon: <SidebarIcon name="quality" />, label: "Quality Management" }
    ]
  },
  {
    key: "purchase",
    label: "Purchase & Inventory",
    items: [
      { to: "/suppliers", icon: <SidebarIcon name="suppliers" />, label: "Suppliers" },
      { to: "/purchase", icon: <SidebarIcon name="purchase" />, label: "BOM-Supplier Map" },
      { to: "/purchase-orders", icon: <SidebarIcon name="purchaseorders" />, label: "Purchase Orders" },
      { to: "/inventory", icon: <SidebarIcon name="inventory" />, label: "Inventory" }
    ]
  },
  {
    key: "reports",
    label: "Reports & Analytics",
    items: [
      { to: "/reports", icon: <SidebarIcon name="reports" />, label: "Reports" }
    ]
  },
  {
    key: "system",
    label: "System",
    items: [
      { to: "/company-settings", icon: <SidebarIcon name="company" />, label: "Company Settings" },
      { to: "/holidays", icon: <SidebarIcon name="holidays" />, label: "Holiday Calendar" },
      { to: "/geofence", icon: <SidebarIcon name="geofence" />, label: "Geofence Settings" },
      { to: "/settings", icon: <SidebarIcon name="settings" />, label: "Settings" }
    ]
  }
];


function SidebarNav({ onItemClick }) {

  const location = useLocation();

  // Section that contains the current route opens by default;
  // others stay collapsed. User can toggle freely.
  const activeGroupKey = NAV_GROUPS.find((g) =>
    g.items.some((it) => location.pathname === it.to)
  )?.key;

  const [openSections, setOpenSections] = useState(() => {

    const init = {};

    NAV_GROUPS.forEach((g) => {

      // Default: only the active group is open; the rest collapsed.
      // Gives a clean look while keeping the user's current context
      // visible.
      init[g.key] = g.key === activeGroupKey;
    });

    // First load with no active section (e.g. on Dashboard route):
    // open the first business-relevant group so the menu isn't
    // collapsed entirely.
    if (!activeGroupKey) {

      init["org"] = true;
    }

    return init;
  });

  // Keep the active section open across navigation
  useEffect(() => {

    if (activeGroupKey) {

      setOpenSections((prev) =>
        prev[activeGroupKey] ? prev : { ...prev, [activeGroupKey]: true }
      );
    }

  }, [activeGroupKey]);

  const toggle = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const linkClass = ({ isActive }) => (isActive ? "active" : "");

  return (

    <ul className="sidebar-nav">

      {/* Top-level pinned items */}
      {NAV_TOP.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.to === "/"}
            onClick={onItemClick}
            className={linkClass}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        </li>
      ))}

      {/* Grouped sections */}
      {NAV_GROUPS.map((group) => {

        const isOpen = !!openSections[group.key];

        const hasActive = group.items.some(
          (it) => location.pathname === it.to
        );

        return (
          <li key={group.key} className="sidebar-section">

            <button
              type="button"
              onClick={() => toggle(group.key)}
              className={`${styles.navGroupBtn}${hasActive ? ` ${styles.navGroupBtnActive}` : ""}`}
            >
              <span className={styles.navGroupLabelSpan}>{group.label}</span>
              <span className={`${styles.navGroupArrow}${isOpen ? ` ${styles.navGroupArrowOpen}` : ""}`}>
                ▾
              </span>
            </button>

            <div
              className={`${styles.navGroupItems} ${isOpen ? styles.navGroupItemsOpen : styles.navGroupItemsClosed}`}
              style={{ maxHeight: isOpen ? `${group.items.length * 46}px` : 0 }}
            >
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onItemClick}
                  className={`${linkClass} ${styles.navSubItem}`}
                >
                  <span className="sidebar-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </li>
        );
      })}

    </ul>
  );
}


function Dashboard() {

  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = () => setSidebarOpen(false);

  const username =
    localStorage.getItem("username") || "User";

  const handleLogout = () => {

    // if (!window.confirm("Log out of Vending ERP?")) {

    //   return;
    // }

    localStorage.removeItem("auth");

    localStorage.removeItem("username");

    localStorage.removeItem("loginTime");

    navigate("/login", { replace: true });
  };

  return (

    <div className="dashboard">

      <button
        className="menu-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle menu"
      >
        {sidebarOpen ? "✕" : "☰"}
      </button>

      {
        sidebarOpen && (
          <div
            className="sidebar-overlay"
            onClick={closeSidebar}
          />
        )
      }

      <div
        className={
          "sidebar" + (sidebarOpen ? " sidebar-open" : "")
        }
      >

        <div className="sidebar-brand">

          <img
            src="/logo.webp"
            alt="Bharath Vending Corporation"
            className="sidebar-logo"
          />

          <h2>Bharath ERP</h2>

        </div>

        <SidebarNav onItemClick={closeSidebar} />

        <div className="sidebar-footer">

          <div className="user-info">

            <div className="user-avatar">
              {username.charAt(0).toUpperCase()}
            </div>

            <div className="user-details">

              <span className="user-name">
                {username}
              </span>

              <span className="user-role">
                Administrator
              </span>

            </div>

          </div>

          <button
            className="logout-btn"
            onClick={handleLogout}
          >
            ↪ Logout
          </button>

        </div>

      </div>

      <div className="main-content">

        <div className="topbar">

          <NotificationBell />

        </div>

        <Routes>

          {/* AI Mission Control — Phase 1 foundation (new default) */}
          <Route path="/" element={<EnterpriseCommandCenter />} />
          <Route path="/dashboard-v2" element={<AdminDashboardV2 />} />

          {/* Earlier dashboards reachable for comparison / fallback */}
          <Route path="/dashboard-v1" element={<AdminDashboard />} />

          <Route path="/roles" element={<RoleManagement />} />
          <Route path="/rbac" element={<RbacPermissions />} />

          <Route path="/company-settings" element={<CompanySettings />} />
          <Route path="/holidays" element={<HolidayCalendar />} />
          <Route path="/geofence" element={<GeofenceSettings />} />
          <Route path="/memos" element={<EmployeeMemos />} />

          <Route path="/approvals" element={<ApprovalCenter />} />

          {/* Legacy dashboard kept reachable for reference */}
          <Route path="/dashboard-legacy" element={<DashboardHome />} />

          <Route
            path="/organization"
            element={<Organization />}
          />

          <Route
            path="/employees"
            element={<Employees />}
          />

          <Route
            path="/employee-onboarding"
            element={<EmployeeOnboardingReview />}
          />

          <Route
            path="/customers"
            element={<Customers />}
          />

          <Route
            path="/quotations"
            element={<Quotations />}
          />

          <Route
            path="/sales-orders"
            element={<SalesOrders />}
          />

          <Route
            path="/invoice-orders"
            element={<InvoiceOrder />}
          />
          {/* new */}



          <Route
            path="/projects"
            element={<Suspense fallback={null}><ProjectPage /></Suspense>}
          />

          <Route
            path="/inventory"
            element={<Inventory />}
          />

          <Route
            path="/attendance"
            element={<Attendance />}
          />

          <Route
            path="/machines"
            element={<Machines />}
          />

          <Route
            path="/work-centers"
            element={<WorkCenters />}
          />

          <Route
            path="/production"
            element={<Production />}
          />

          <Route
            path="/quality"
            element={<Quality />}
          />

          <Route
            path="/suppliers"
            element={<Suppliers />}
          />

          <Route
            path="/purchase"
            element={<Purchase />}
          />

          <Route
            path="/purchase-orders"
            element={<PurchaseOrders />}
          />

          <Route
            path="/leave-management"
            element={<LeaveManagement />}
          />

          <Route
            path="/payroll"
            element={<Payroll />}
          />

          <Route
            path="/star-performance"
            element={<StarPerformance />}
          />

          <Route
            path="/allowances"
            element={<Allowances />}
          />

          <Route
            path="/reports"
            element={<Reports />}
          />

          <Route
            path="/settings"
            element={<Settings />}
          />

          {/* Organization & Project Management module */}
          <Route path="/departments" element={<Suspense fallback={null}><DepartmentManagement /></Suspense>} />
          <Route path="/org-roles" element={<Suspense fallback={null}><OrgRoleManagement /></Suspense>} />
          <Route path="/project-categories" element={<Suspense fallback={null}><ProjectCategoryManagement /></Suspense>} />
          <Route path="/task-templates" element={<Suspense fallback={null}><TaskTemplatePage /></Suspense>} />

        </Routes>

      </div>

      <ChatBot />

    </div>
  );
}

export default Dashboard;
