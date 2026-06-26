import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import TablePagination from "../components/TablePagination";

import IconButton from "../components/IconButton";

import GeofenceGate from "../components/GeofenceGate";

import { formatISTTime, istEpoch } from "../utils/time";
import styles from "./Attendance.module.css";

function Attendance() {

  const [records, setRecords] = useState([]);

  const [todayRecords, setTodayRecords] = useState([]);

  const [employees, setEmployees] = useState([]);

  const [selectedEmployee, setSelectedEmployee] =
    useState("");

  const [view, setView] = useState("today");

  // ---- History filters (only used when view === "all") ----
  const [historyFilters, setHistoryFilters] = useState({
    start_date: "",
    end_date: "",
    employee_id: "",
    status: "",
  });
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ---- Geofencing: gate the check-in/out buttons until inside ----
  const [gpsCtx, setGpsCtx] = useState(null);
  // gpsCtx = { lat, lng, distance, accuracy, deviceInfo } | null

  const browserInfo = useMemo(
    () => (typeof navigator !== "undefined"
      ? `${navigator.userAgent || ""}`.slice(0, 255)
      : null),
    []
  );

  const fetchEmployees = async () => {

    try {

      const response = await API.get("/employees");

      setEmployees(response.data);

    } catch (error) {

      console.log(error);
    }
  };

  const fetchAllAttendance = async (filters = historyFilters, pageNum = page, pgSize = pageSize) => {

    setHistoryLoading(true);
    try {

      const params = {
        limit: pgSize,
        offset: (pageNum - 1) * pgSize,
      };
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      if (filters.employee_id) params.employee_id = filters.employee_id;
      if (filters.status) params.status = filters.status;

      const response = await API.get("/attendance", { params });

      // Backend now returns { total, limit, offset, rows }.
      // Handle both the new shape and the legacy plain-array shape
      // for safety while caches are warm.
      const data = response.data;
      if (Array.isArray(data)) {
        setRecords(data);
        setHistoryTotal(data.length);
      } else {
        setRecords(data.rows || []);
        setHistoryTotal(data.total || 0);
      }

    } catch (error) {
      console.log(error);
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchTodayAttendance = async () => {

    try {

      const response = await API.get(
        "/attendance/today"
      );

      setTodayRecords(response.data);

    } catch (error) {

      console.log(error);
    }
  };

  const refreshAll = () => {

    fetchTodayAttendance();

    fetchAllAttendance();
  };

  useEffect(() => {

    fetchEmployees();

    refreshAll();

  }, []);

  const checkIn = async () => {

    if (!selectedEmployee) {

      alert("Please select an employee");

      return;
    }

    if (!gpsCtx) {

      alert("Waiting for GPS — the geofence check above must pass first.");

      return;
    }

    try {

      await API.post("/check-in", {

        EMPLOYEE_ID: selectedEmployee,

        VENDOR_ID: 1,

        LATITUDE: gpsCtx.lat,

        LONGITUDE: gpsCtx.lng,

        DEVICE_INFO: gpsCtx.deviceInfo,

        BROWSER_INFO: browserInfo,

        // True when the user clicked "Skip GPS" on the gate. Tells the
        // backend to still store the coords + distance but skip the
        // out-of-geofence 403 reject. False on normal in-radius check-ins.
        BYPASS_GEOFENCE: !!gpsCtx.gpsSkipped
      });

      refreshAll();

    } catch (error) {

      console.log(error);

      const detail =
        error?.response?.data?.detail ||
        "Error checking in";

      alert(detail);
    }
  };

  const checkOut = async () => {

    if (!selectedEmployee) {

      alert("Please select an employee");

      return;
    }

    if (!gpsCtx) {

      alert("Waiting for GPS — the geofence check above must pass first.");

      return;
    }

    try {

      await API.post("/check-out", {

        EMPLOYEE_ID: selectedEmployee,

        LATITUDE: gpsCtx.lat,

        LONGITUDE: gpsCtx.lng,

        DEVICE_INFO: gpsCtx.deviceInfo,

        BYPASS_GEOFENCE: !!gpsCtx.gpsSkipped
      });

      refreshAll();

    } catch (error) {

      console.log(error);

      const detail =
        error?.response?.data?.detail ||
        "Error checking out";

      alert(detail);
    }
  };

  const otCheckIn = async () => {

    if (!selectedEmployee) {

      alert("Please select an employee");

      return;
    }

    try {

      await API.post("/ot-check-in", { EMPLOYEE_ID: selectedEmployee });

      refreshAll();

    } catch (error) {

      console.log(error);

      alert(error?.response?.data?.detail || "Error starting OT");
    }
  };

  const otCheckOut = async () => {

    if (!selectedEmployee) {

      alert("Please select an employee");

      return;
    }

    try {

      await API.post("/ot-check-out", { EMPLOYEE_ID: selectedEmployee });

      refreshAll();

    } catch (error) {

      console.log(error);

      alert(error?.response?.data?.detail || "Error closing OT");
    }
  };

  const markAbsent = async () => {

    if (!selectedEmployee) {

      alert("Please select an employee");

      return;
    }

    if (
      !window.confirm(
        "Mark this employee absent today?"
      )
    ) {

      return;
    }

    try {

      await API.post("/mark-absent", {

        EMPLOYEE_ID: selectedEmployee,

        VENDOR_ID: 1
      });

      refreshAll();

    } catch (error) {

      console.log(error);

      const detail =
        error?.response?.data?.detail ||
        "Error marking absent";

      alert(detail);
    }
  };

  const deleteRecord = async (id) => {

    if (
      !window.confirm("Delete this attendance record?")
    ) {

      return;
    }

    try {

      await API.delete(`/attendance/${id}`);

      refreshAll();

    } catch (error) {

      console.log(error);

      alert("Error deleting record");
    }
  };

  const formatTime = (iso) => {

    if (!iso) return "—";

    const d = new Date(iso);

    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const statusBadge = (status) => {

    const cls =
      status === "PRESENT"
        ? "badge-present"
        : status === "LATE"
          ? "badge-late"
          : status === "ABSENT"
            ? "badge-absent"
            : "badge-other";

    return (
      <span className={`status-badge ${cls}`}>
        {status}
      </span>
    );
  };

  const presentCount = todayRecords.filter(
    (r) => r.STATUS === "PRESENT"
  ).length;

  const lateCount = todayRecords.filter(
    (r) => r.STATUS === "LATE"
  ).length;

  const absentCount = todayRecords.filter(
    (r) => r.STATUS === "ABSENT"
  ).length;

  const rows = view === "today" ? todayRecords : records;

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {

    setPage(1);

  }, [view]);

  // For History view (view === "all"), rows come already paged from the server.
  // For Today view, paginate client-side as before.
  const pagedRows = useMemo(
    () => view === "all"
      ? rows                                                // server-paginated
      : rows.slice((page - 1) * pageSize, page * pageSize), // client-paginated
    [rows, page, pageSize, view]
  );

  // Total used by the paginator — server count for History, length for Today.
  const totalRows = view === "all" ? historyTotal : rows.length;

  // Refetch history when filters or pagination change (only while on History tab).
  useEffect(() => {
    if (view === "all") {
      fetchAllAttendance(historyFilters, page, pageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, historyFilters, page, pageSize]);

  // ---- Geofence widget counters (live from backend) ----
  const [geoStats, setGeoStats] = useState(null);

  useEffect(() => {

    let mounted = true;

    const load = () => API
      .get("/geofence/dashboard")
      .then((r) => mounted && setGeoStats(r.data))
      .catch(() => { });

    load();

    const t = setInterval(load, 60000);

    return () => { mounted = false; clearInterval(t); };

  }, []);

  return (

    <div>

      {/* ===== Clean compact header ===== */}
      <div className={styles.headerStrip}>
        <div className={styles.headerTitleRow}>
          <h1 className={styles.headerTitle}>Attendance</h1>
          <div className={styles.headerDate}>
            {new Date().toLocaleDateString("en-IN", {
              weekday: "short", day: "numeric", month: "long", year: "numeric",
            })}
          </div>
        </div>

        {/* One inline stat row instead of seven cards */}
        <div className={styles.statRow}>
          <StatItem label="Present" value={presentCount} tone="green" />
          <StatItem label="Late" value={lateCount} tone="amber" />
          <StatItem label="Absent" value={absentCount} tone="red" />
          <StatItem label="Total" value={employees.length} tone="slate" />
          <div className={styles.statDivider} />
          <StatItem label="Inside" value={geoStats?.inside_geofence ?? "—"} tone="green" small />
          <StatItem label="Outside" value={geoStats?.outside_geofence ?? "—"} tone="red" small />
          <StatItem
            label="Sec. fails"
            value={geoStats?.security_failures_today ?? "—"}
            tone="amber"
            small
            href="/geofence"
          />
        </div>
      </div>

      {/* Compact GPS gate — single-line status */}
      <GeofenceGate
        compact
        employeeId={selectedEmployee || null}
        onAllowed={(ctx) => setGpsCtx(ctx)}
        onBlocked={() => setGpsCtx(null)}
      />

      {/* Mark-attendance action bar */}
      <div className={styles.markBar}>

        <select
          className={styles.markSelect}
          value={selectedEmployee}
          onChange={(e) => setSelectedEmployee(e.target.value)}
        >
          <option value="">Select employee…</option>
          {employees.map((emp) => (
            <option key={emp.ID} value={emp.ID}>
              {emp.NAME} ({emp.EMPLOYEE_CODE || emp.EMAIL})
            </option>
          ))}
        </select>

        <button
          className={`${styles.markBtn} ${styles.markBtnPrimary}`}
          onClick={checkIn}
          disabled={!gpsCtx}
          title={!gpsCtx ? "Waiting for geofence verification…" : "Check In"}
        >
          Check In
        </button>

        <button
          className={`${styles.markBtn} ${styles.markBtnSecondary}`}
          onClick={checkOut}
          disabled={!gpsCtx}
          title={!gpsCtx ? "Waiting for geofence verification…" : "Check Out"}
        >
          Check Out
        </button>

        <button
          className={`${styles.markBtn} ${styles.markBtnOt}`}
          onClick={otCheckIn}
          title="Start OT session (after regular check-out)"
        >
          OT Check In
        </button>

        <button
          className={`${styles.markBtn} ${styles.markBtnOt}`}
          onClick={otCheckOut}
          title="Close OT session"
        >
          OT Check Out
        </button>

        <button
          className={`${styles.markBtn} ${styles.markBtnDanger}`}
          onClick={markAbsent}
        >
          Mark Absent
        </button>

      </div>

      <div className="tabs">

        <button
          className={
            "tab-btn" +
            (view === "board" ? " tab-active" : "")
          }
          onClick={() => setView("board")}
        >
          🖥️ Live Floor Board
        </button>

        <button
          className={
            "tab-btn" +
            (view === "today" ? " tab-active" : "")
          }
          onClick={() => setView("today")}
        >
          Today
        </button>

        <button
          className={
            "tab-btn" +
            (view === "all" ? " tab-active" : "")
          }
          onClick={() => setView("all")}
        >
          All Records
        </button>

        <button
          className={
            "tab-btn" +
            (view === "report" ? " tab-active" : "")
          }
          onClick={() => setView("report")}
        >
          Report
        </button>

        <button
          className={
            "tab-btn" +
            (view === "tracking" ? " tab-active" : "")
          }
          onClick={() => setView("tracking")}
        >
          Employee Tracking
        </button>

      </div>

      {view === "board" && <LiveFloorBoard />}

      {/* ===== History filter bar — only on the All Records view ===== */}
      {view === "all" && (
        <div className={styles.historyFilters}>
          <div className={styles.filterField}>
            <label>From</label>
            <input
              type="date"
              value={historyFilters.start_date}
              onChange={(e) => {
                setPage(1);
                setHistoryFilters({ ...historyFilters, start_date: e.target.value });
              }}
            />
          </div>
          <div className={styles.filterField}>
            <label>To</label>
            <input
              type="date"
              value={historyFilters.end_date}
              onChange={(e) => {
                setPage(1);
                setHistoryFilters({ ...historyFilters, end_date: e.target.value });
              }}
            />
          </div>
          <div className={styles.filterField}>
            <label>Employee</label>
            <select
              value={historyFilters.employee_id}
              onChange={(e) => {
                setPage(1);
                setHistoryFilters({ ...historyFilters, employee_id: e.target.value });
              }}
            >
              <option value="">All employees</option>
              {employees.map((emp) => (
                <option key={emp.ID} value={emp.ID}>
                  {emp.NAME} ({emp.EMPLOYEE_CODE || "—"})
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterField}>
            <label>Status</label>
            <div className={styles.statusChips}>
              {["", "PRESENT", "LATE", "ABSENT", "HALF_DAY"].map((s) => (
                <button
                  key={s || "ALL"}
                  type="button"
                  onClick={() => {
                    setPage(1);
                    setHistoryFilters({ ...historyFilters, status: s });
                  }}
                  className={
                    `${styles.statusChip} ` +
                    (historyFilters.status === s ? styles.statusChipActive : "")
                  }
                >
                  {s || "ALL"}
                </button>
              ))}
            </div>
          </div>
          {(historyFilters.start_date || historyFilters.end_date ||
            historyFilters.employee_id || historyFilters.status) && (
              <button
                type="button"
                className={styles.filterClear}
                onClick={() => {
                  setPage(1);
                  setHistoryFilters({
                    start_date: "", end_date: "", employee_id: "", status: "",
                  });
                }}
              >
                ✕ Clear filters
              </button>
            )}
          <div className={styles.filterResultCount}>
            {historyLoading
              ? "Loading…"
              : `${historyTotal} record${historyTotal === 1 ? "" : "s"}`}
          </div>
        </div>
      )}

      {view === "report" && <AttendanceReport employees={employees} />}
      {view === "tracking" && <EmployeeTracking employees={employees} />}

      {(view === "today" || view === "all") && (
        <>

          <div className="table-wrapper">

            <table className="employee-table">

              <thead>

                <tr>

                  <th>Date</th>

                  <th>Employee</th>

                  <th>Check In</th>

                  <th>Check Out</th>

                  <th>Hours</th>

                  <th>Status</th>

                  <th>Check-In Location</th>

                  <th>Check-Out Location</th>

                  <th>Distance</th>

                  <th>Geofence</th>

                  <th>Actions</th>

                </tr>

              </thead>

              <tbody>

                {
                  rows.length === 0 ? (

                    <tr>

                      <td
                        colSpan="11"
                        className={styles.emptyCell}
                      >
                        No attendance records
                      </td>

                    </tr>

                  ) : (

                    pagedRows.map((row) => (

                      <tr key={row.ID}>

                        <td>{row.DATE}</td>

                        <td>
                          {row.EMPLOYEE_NAME || row.EMPLOYEE_ID}
                        </td>

                        <td>{formatTime(row.CHECK_IN)}</td>

                        <td>{formatTime(row.CHECK_OUT)}</td>

                        <td>
                          {
                            row.WORKED_HOURS !== null &&
                              row.WORKED_HOURS !== undefined
                              ? `${row.WORKED_HOURS} h`
                              : "—"
                          }
                        </td>

                        <td>{statusBadge(row.STATUS)}</td>

                        <td>{coordCell(row.CHECKIN_LATITUDE, row.CHECKIN_LONGITUDE, row.GEOFENCE_STATUS)}</td>

                        <td>{coordCell(row.CHECKOUT_LATITUDE, row.CHECKOUT_LONGITUDE, row.GEOFENCE_STATUS)}</td>

                        <td>
                          {row.CHECKIN_DISTANCE != null
                            ? `${Math.round(row.CHECKIN_DISTANCE)} m`
                            : (row.GEOFENCE_STATUS === "UNKNOWN"
                              ? <span className={styles.gpsSkip}>GPS skipped</span>
                              : "—")}
                        </td>

                        <td>{geofenceBadge(row.GEOFENCE_STATUS)}</td>

                        <td>

                          <IconButton
                            variant="delete"
                            onClick={() => deleteRecord(row.ID)}
                            title="Delete attendance record"
                          />

                        </td>

                      </tr>
                    ))
                  )
                }

              </tbody>

            </table>

          </div>

          <TablePagination
            total={totalRows}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />

        </>
      )}

    </div>
  );
}


// ----------------------------------------------------------------
// Live Floor Board — wall-display style tile grid showing every
// active employee with their CHECK_IN, CHECK_OUT, current task,
// live worked-hours counter, and tasks completed today.
//
// Polls the backend every 10 seconds so it stays current without
// any user interaction. Designed to be put on a TV screen on the
// shop floor.
// ----------------------------------------------------------------

function LiveFloorBoard() {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [tick, setTick] = useState(0);

  const fetchBoard = async () => {

    try {

      const res = await API.get("/attendance/live-board");

      setData(res.data);

    } catch (e) {

      // non-fatal
    } finally {

      setLoading(false);
    }
  };

  // Initial fetch + 10-sec poll for live updates
  useEffect(() => {

    fetchBoard();

    const id = setInterval(fetchBoard, 10 * 1000);

    return () => clearInterval(id);

  }, []);

  // Local-only tick every second so worked-hours counters animate
  // smoothly between server polls
  useEffect(() => {

    const id = setInterval(() => setTick((t) => t + 1), 1000);

    return () => clearInterval(id);

  }, []);

  if (loading) {

    return (
      <div className={styles.boardLoading}>
        Loading floor board…
      </div>
    );
  }

  if (!data) {

    return (
      <div className={styles.boardError}>
        Could not load board. Check backend.
      </div>
    );
  }

  const s = data.summary || {};

  return (

    <div className={styles.boardPad}>

      {/* Summary tiles */}
      <div className={styles.boardSummaryGrid}>

        <SummaryTile
          label="Active Employees"
          value={s.total_active ?? 0}
          color="#3b82f6"
        />

        <SummaryTile
          label="In Office Now"
          value={s.in_office ?? 0}
          sub="checked-in, not yet out"
          color="#10b981"
        />

        <SummaryTile
          label="Checked Out"
          value={s.checked_out ?? 0}
          sub="done for the day"
          color="#94a3b8"
        />

        <SummaryTile
          label="Not Checked In"
          value={s.not_checked_in ?? 0}
          sub="absent / late"
          color="#ef4444"
        />
      </div>

      {/* Auto-refresh note */}
      <div className={styles.boardRefreshNote}>
        Auto-refreshing every 10s · as of {data.as_of?.slice(11, 19)}
      </div>

      {/* Employee tile grid */}
      <div className={styles.boardTileGrid}>

        {(data.employees || []).map((emp) => (

          <EmployeeTile key={emp.EMPLOYEE_ID} emp={emp} tick={tick} />
        ))}

        {(data.employees || []).length === 0 && (

          <div className={styles.boardEmpty}>
            No active employees. Run /demo/seed-bvc24 to populate.
          </div>
        )}
      </div>
    </div>
  );
}


function SummaryTile({ label, value, sub, color }) {

  return (

    <div className={styles.summaryTile} style={{ borderTopColor: color }}>

      <div className={styles.summaryTileLabel}>{label}</div>

      <div className={styles.summaryTileValue}>{value}</div>

      {sub && <div className={styles.summaryTileSub}>{sub}</div>}
    </div>
  );
}


function liveWorkedHours(checkInIso, checkOutIso) {

  if (!checkInIso) return null;

  const start = istEpoch(checkInIso);

  const end = checkOutIso ? istEpoch(checkOutIso) : Date.now();

  if (start == null) return null;

  const ms = end - start;

  if (ms < 0) return "0:00:00";

  const totalSec = Math.floor(ms / 1000);

  const h = Math.floor(totalSec / 3600);

  const m = Math.floor((totalSec % 3600) / 60);

  const s = totalSec % 60;

  return (
    String(h).padStart(2, "0") + ":"
    + String(m).padStart(2, "0") + ":"
    + String(s).padStart(2, "0")
  );
}


function EmployeeTile({ emp, tick }) {

  const isCheckedIn = !!emp.CHECK_IN;

  const isCheckedOut = !!emp.CHECK_OUT;

  // status palette
  let accent = "#94a3b8";   // not checked in

  let stateLabel = "Not in";

  let stateBg = "#f1f5f9";

  let stateFg = "#475569";

  if (isCheckedOut) {

    accent = "#94a3b8";

    stateLabel = "Checked out";

    stateBg = "#f1f5f9";

    stateFg = "#475569";

  } else if (isCheckedIn) {

    if (emp.STATUS === "LATE") {

      accent = "#f59e0b";

      stateLabel = "In · LATE";

      stateBg = "#fef3c7";

      stateFg = "#854d0e";

    } else {

      accent = "#10b981";

      stateLabel = "Working";

      stateBg = "#dcfce7";

      stateFg = "#166534";
    }
  }

  // re-read tick so this re-renders every second for live counter
  void tick;

  const liveHours = liveWorkedHours(emp.CHECK_IN, emp.CHECK_OUT);

  return (

    <div className={styles.empTile} style={{ borderLeftColor: accent }}>

      {/* Header: avatar + name */}
      <div className={styles.empTileHeader}>

        <div
          className={styles.empAvatar}
          style={{ background: stateBg, color: stateFg }}
        >
          {(emp.NAME || "?").charAt(0).toUpperCase()}
        </div>

        <div className={styles.empMeta}>
          <div className={styles.empTileName}>{emp.NAME}</div>
          <div className={styles.empTileCode}>
            {emp.EMPLOYEE_CODE}
            {emp.DEPARTMENT_CODE && <span> · {emp.DEPARTMENT_CODE}</span>}
          </div>
        </div>

        <span
          className={styles.statePill}
          style={{ background: stateBg, color: stateFg }}
        >
          {stateLabel}
        </span>
      </div>

      {/* Clock row: CHECK_IN | CHECK_OUT */}
      <div className={styles.clockRow}>

        <div className={styles.clockCell}>
          <div className={styles.clockCellLabel}>Check-In</div>
          <div
            className={styles.clockCellTime}
            style={{ color: emp.CHECK_IN ? "#10b981" : "#cbd5e1" }}
          >
            {emp.CHECK_IN ? formatISTTime(emp.CHECK_IN) : "—:—"}
          </div>
        </div>

        <div className={styles.clockCell}>
          <div className={styles.clockCellLabel}>Check-Out</div>
          <div
            className={styles.clockCellTime}
            style={{ color: emp.CHECK_OUT ? "#ef4444" : "#cbd5e1" }}
          >
            {emp.CHECK_OUT ? formatISTTime(emp.CHECK_OUT) : "—:—"}
          </div>
        </div>
      </div>

      {/* Live worked-hours counter when checked in */}
      {isCheckedIn && (
        <div
          className={styles.liveCounter}
          style={{
            background: isCheckedOut ? "#f1f5f9" : "#ecfdf5",
            borderColor: isCheckedOut ? "#cbd5e1" : "#a7f3d0"
          }}
        >
          <div className={styles.liveCounterLabel}>
            {isCheckedOut ? "Worked" : "Live ⏱"}
          </div>
          <div
            className={styles.liveCounterValue}
            style={{ color: isCheckedOut ? "#475569" : "#047857" }}
          >
            {liveHours}
          </div>
        </div>
      )}

      {/* Current task or completed-today summary */}
      {emp.CURRENT_TASK_NAME ? (
        <div className={`${styles.taskCard} ${styles.taskCardActive}`}>
          <div className={styles.taskLabel}>Now Working On</div>
          <div className={styles.taskName}>{emp.CURRENT_TASK_NAME}</div>
          {emp.CURRENT_PROJECT && (
            <div className={styles.taskProject}>{emp.CURRENT_PROJECT}</div>
          )}
          <div className={styles.taskStatus}>Status: {emp.CURRENT_TASK_STATUS}</div>
        </div>
      ) : isCheckedIn ? (
        <div className={`${styles.taskCard} ${styles.taskCardEmpty}`}>
          No active task
        </div>
      ) : null}

      {/* Tasks completed today badge */}
      {emp.TASKS_COMPLETED_TODAY > 0 && (
        <div className={styles.tasksDoneRow}>
          <span>Tasks done today</span>
          <span className={styles.tasksDoneBadge}>
            ✓ {emp.TASKS_COMPLETED_TODAY}
          </span>
        </div>
      )}
    </div>
  );
}


// ---- Report-cell helpers for the geofence columns ----
function coordCell(lat, lng, status) {
  // If no coords AND status is UNKNOWN, the employee bypassed the GPS
  // gate — surface that explicitly so it's not confused with legacy
  // rows that have no geofence data at all.
  if (lat == null || lng == null) {
    if (status === "UNKNOWN") {
      return (
        <span
          title="Employee skipped the GPS check at check-in"
          className={styles.gpsSkip}
        >
          GPS skipped
        </span>
      );
    }
    return "—";
  }
  const short = (n) => Number(n).toFixed(5);
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Google Maps"
      className={styles.coordLink}
    >
      {short(lat)}, {short(lng)} 🗺
    </a>
  );
}

function geofenceBadge(status) {
  // Distinguish three states:
  //   INSIDE / OUTSIDE — GPS was captured + validated against geofence
  //   UNKNOWN          — admin clicked "Skip GPS" (legitimate but unverified)
  //   null / missing   — legacy row (e.g. auto-login check-in pre-Phase-2)
  if (!status) {
    return (
      <span title="No geofence data captured for this row"
        className={`${styles.statusBadge} ${styles.badgeOther}`}>—</span>
    );
  }
  const theme = {
    INSIDE: { cls: styles.badgePresent, label: "INSIDE", title: "Checked in inside the office geofence" },
    OUTSIDE: { cls: styles.badgeAbsent, label: "OUTSIDE", title: "Checked in outside the allowed radius" },
    UNKNOWN: { cls: styles.badgeLate, label: "GPS SKIPPED", title: "Employee bypassed GPS — coordinates not captured" }
  }[status] || { cls: styles.badgeOther, label: status, title: status };
  return (
    <span title={theme.title} className={`${styles.statusBadge} ${theme.cls}`}>
      {theme.label}
    </span>
  );
}



// =====================================================================
// AttendanceReport — date-range summary with per-employee aggregates.
// Uses GET /attendance/report?start_date=&end_date=
// =====================================================================

function AttendanceReport() {

  // Default = current month
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString().slice(0, 10);
  const monthEnd = today.toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(monthEnd);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError("");
    try {
      const res = await API.get("/attendance/report", {
        params: { start_date: startDate, end_date: endDate },
      });
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  // Auto-reload when dates change
  useEffect(() => {
    if (startDate && endDate) load();
    // eslint-disable-next-line
  }, [startDate, endDate]);

  // Quick-range buttons
  const setRange = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };

  return (
    <div className={styles.reportWrap}>

      {/* Filter row */}
      <div className={styles.historyFilters}>
        <div className={styles.filterField}>
          <label>From</label>
          <input type="date" value={startDate}
            onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className={styles.filterField}>
          <label>To</label>
          <input type="date" value={endDate}
            onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className={styles.statusChips} style={{ alignSelf: "flex-end" }}>
          <button type="button" className={styles.statusChip}
            onClick={() => setRange(7)}>Last 7d</button>
          <button type="button" className={styles.statusChip}
            onClick={() => setRange(30)}>Last 30d</button>
          <button type="button" className={styles.statusChip}
            onClick={() => setRange(90)}>Last 90d</button>
          <button type="button" className={styles.statusChip}
            onClick={() => {
              const t = new Date();
              setStartDate(new Date(t.getFullYear(), t.getMonth(), 1)
                .toISOString().slice(0, 10));
              setEndDate(t.toISOString().slice(0, 10));
            }}>This month</button>
        </div>
        <div className={styles.filterResultCount}>
          {loading ? "Loading…" : data ? `${data.totals.employees} employees` : ""}
        </div>
      </div>

      {error && <div className={styles.reportError}>{error}</div>}

      {/* Summary tiles */}
      {data && (
        <div className={styles.reportTotals}>
          <ReportTile label="Working Days" value={data.totals.working_days} />
          <ReportTile label="Avg Attendance" value={`${data.totals.avg_attendance_pct}%`} />
          <ReportTile label="Total Present" value={data.totals.total_present} />
          <ReportTile label="Total Late" value={data.totals.total_late} accent="#d97706" />
          <ReportTile label="Total Absent" value={data.totals.total_absent} accent="#dc2626" />
          <ReportTile label="OT Hours" value={data.totals.total_overtime} accent="#0891b2" />
        </div>
      )}

      {/* Per-employee table */}
      <div className="table-wrapper">
        <table className="employee-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Working Days</th>
              <th>Present</th>
              <th>Late</th>
              <th>Absent</th>
              <th>Worked Hours</th>
              <th>OT Hours</th>
              <th>Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "#64748b" }}>
                No active employees found.
              </td></tr>
            )}
            {data?.rows?.map((r) => (
              <tr key={r.employee_id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{r.employee_name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{r.employee_code}</div>
                </td>
                <td>{r.working_days}</td>
                <td>{Number.isInteger(r.present) ? r.present : r.present.toFixed(1)}</td>
                <td style={{ color: r.late >= 5 ? "#dc2626" : r.late >= 3 ? "#d97706" : "#475569" }}>
                  {r.late}
                </td>
                <td style={{ color: r.absent > 0 ? "#dc2626" : "#475569" }}>
                  {r.absent}
                </td>
                <td>{r.worked_hours}</td>
                <td>{r.overtime_hours}</td>
                <td>
                  <div className={styles.attendanceBar}>
                    <div className={styles.attendanceBarFill}
                      style={{
                        width: `${Math.max(0, Math.min(100, r.attendance_pct))}%`,
                        background:
                          r.attendance_pct >= 95 ? "#16a34a" :
                            r.attendance_pct >= 75 ? "#d97706" : "#dc2626",
                      }} />
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 700, marginTop: 2,
                    color: r.attendance_pct >= 95 ? "#16a34a" :
                      r.attendance_pct >= 75 ? "#d97706" : "#dc2626"
                  }}>
                    {r.attendance_pct.toFixed(1)}%
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function ReportTile({ label, value, accent }) {
  return (
    <div className={styles.reportTile}
      style={accent ? { borderLeftColor: accent } : undefined}>
      <div className={styles.reportTileLabel}>{label}</div>
      <div className={styles.reportTileValue}>{value}</div>
    </div>
  );
}


// =====================================================================
// EmployeeTracking — per-employee detailed attendance over last N days.
// Uses GET /attendance/employee/{id}/tracking?days=N
// =====================================================================

function EmployeeTracking({ employees }) {

  const [empId, setEmpId] = useState("");
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!empId) { setData(null); return; }
    setLoading(true); setError("");
    try {
      const res = await API.get(
        `/attendance/employee/${empId}/tracking`,
        { params: { days } }
      );
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load tracking data");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [empId, days]);

  // Group timeline rows by ISO week for the heatmap layout
  const weeks = useMemo(() => {
    if (!data?.timeline) return [];
    const grouped = [];
    let current = [];
    let lastWeek = null;
    for (const t of data.timeline) {
      const d = new Date(t.date);
      // ISO week number — use Sun-Sat grouping
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const week = Math.floor(((d - yearStart) / 86400000 + yearStart.getDay()) / 7);
      if (lastWeek !== null && week !== lastWeek) {
        grouped.push(current);
        current = [];
      }
      current.push(t);
      lastWeek = week;
    }
    if (current.length) grouped.push(current);
    return grouped;
  }, [data]);

  return (
    <div className={styles.trackingWrap}>

      {/* Controls */}
      <div className={styles.historyFilters}>
        <div className={styles.filterField}>
          <label>Employee</label>
          <select value={empId} onChange={(e) => setEmpId(e.target.value)}>
            <option value="">— Pick an employee —</option>
            {employees.map((emp) => (
              <option key={emp.ID} value={emp.ID}>
                {emp.NAME} ({emp.EMPLOYEE_CODE || "—"})
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label>Window</label>
          <div className={styles.statusChips}>
            {[30, 60, 90, 180].map((d) => (
              <button key={d} type="button"
                onClick={() => setDays(d)}
                className={
                  `${styles.statusChip} ` +
                  (days === d ? styles.statusChipActive : "")
                }
              >{d}d</button>
            ))}
          </div>
        </div>
        <div className={styles.filterResultCount}>
          {loading ? "Loading…"
            : data ? `${data.window.working_days} working days`
              : "Select an employee"}
        </div>
      </div>

      {error && <div className={styles.reportError}>{error}</div>}

      {!empId && !data && (
        <div className={styles.trackingEmpty}>
          Pick an employee above to see their attendance tracking.
        </div>
      )}

      {data && (
        <>
          {/* KPI tiles */}
          <div className={styles.reportTotals}>
            <ReportTile label="Attendance" value={`${data.summary.attendance_pct}%`}
              accent={data.summary.attendance_pct >= 95 ? "#16a34a"
                : data.summary.attendance_pct >= 75 ? "#d97706" : "#dc2626"} />
            <ReportTile label="Present" value={data.summary.present} />
            <ReportTile label="Late" value={data.summary.late} accent="#d97706" />
            <ReportTile label="Absent" value={data.summary.absent} accent="#dc2626" />
            <ReportTile label="Worked Hours" value={data.summary.worked_hours} />
            <ReportTile label="OT Hours" value={data.summary.overtime_hours} accent="#0891b2" />
          </div>

          {/* Calendar heatmap */}
          <div className={styles.heatmapCard}>
            <div className={styles.heatmapTitle}>
              {days}-day calendar — {data.window.start_date} to {data.window.end_date}
            </div>
            <div className={styles.heatmapGrid}>
              {weeks.map((week, wi) => (
                <div key={wi} className={styles.heatmapWeek}>
                  {week.map((t) => (
                    <HeatCell key={t.date} day={t} />
                  ))}
                </div>
              ))}
            </div>
            <div className={styles.heatmapLegend}>
              <LegendDot color="#16a34a" label="Present" />
              <LegendDot color="#d97706" label="Late" />
              <LegendDot color="#dc2626" label="Absent" />
              <LegendDot color="#7c3aed" label="Half-day" />
              <LegendDot color="#cbd5e1" label="Weekly off" />
              <LegendDot color="#f1f5f9" label="No data" />
            </div>
          </div>

          {/* Recent records table */}
          <div className={styles.heatmapCard}>
            <div className={styles.heatmapTitle}>Recent days</div>
            <div className="table-wrapper">
              <table className="employee-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Hours</th>
                    <th>OT</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.timeline.slice().reverse().slice(0, 30).map((t) => (
                    <tr key={t.date}>
                      <td>{t.date}</td>
                      <td>{t.weekday}</td>
                      <td>{t.check_in || "—"}</td>
                      <td>{t.check_out || "—"}</td>
                      <td>{t.worked_hours || "—"}</td>
                      <td>{t.overtime_hours || "—"}</td>
                      <td><TrackingStatus status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


function HeatCell({ day }) {
  const color =
    day.status === "PRESENT" ? "#16a34a" :
      day.status === "LATE" ? "#d97706" :
        day.status === "ABSENT" ? "#dc2626" :
          day.status === "HALF_DAY" ? "#7c3aed" :
            day.status === "WEEKLY_OFF" ? "#cbd5e1" :
              "#f1f5f9"; // NO_DATA
  return (
    <div
      title={`${day.date} (${day.weekday}) — ${day.status}${day.check_in ? ` · in ${day.check_in}` : ""}${day.check_out ? `, out ${day.check_out}` : ""}`}
      className={styles.heatCell}
      style={{ background: color }}
    />
  );
}


function LegendDot({ color, label }) {
  return (
    <span className={styles.legendItem}>
      <span className={styles.legendDot} style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}


// ----- Compact stat pill used in the page header -----
function StatItem({ label, value, tone = "slate", small, href }) {
  const cls =
    tone === "green" ? styles.statItemGreen :
      tone === "amber" ? styles.statItemAmber :
        tone === "red" ? styles.statItemRed :
          styles.statItemSlate;
  const Tag = href ? "a" : "div";
  const tagProps = href ? { href } : {};
  return (
    <Tag
      {...tagProps}
      className={`${styles.statItem} ${cls} ${small ? styles.statItemSmall : ""}`}
    >
      <span className={styles.statItemValue}>{value}</span>
      <span className={styles.statItemLabel}>{label}</span>
    </Tag>
  );
}


function TrackingStatus({ status }) {
  const map = {
    PRESENT: { bg: "#dcfce7", fg: "#166534" },
    LATE: { bg: "#fef3c7", fg: "#92400e" },
    ABSENT: { bg: "#fee2e2", fg: "#991b1b" },
    HALF_DAY: { bg: "#ede9fe", fg: "#5b21b6" },
    WEEKLY_OFF: { bg: "#f1f5f9", fg: "#475569" },
    NO_DATA: { bg: "#f8fafc", fg: "#94a3b8" },
  };
  const c = map[status] || map.NO_DATA;
  return (
    <span style={{
      background: c.bg, color: c.fg, padding: "2px 10px",
      borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
    }}>{status.replace("_", " ")}</span>
  );
}


export default Attendance;
