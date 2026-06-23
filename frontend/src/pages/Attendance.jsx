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

  const fetchAllAttendance = async () => {

    try {

      const response = await API.get("/attendance");

      setRecords(response.data);

    } catch (error) {

      console.log(error);
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

        BROWSER_INFO: browserInfo
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

        DEVICE_INFO: gpsCtx.deviceInfo
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

  const pagedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize]
  );

  // ---- Geofence widget counters (live from backend) ----
  const [geoStats, setGeoStats] = useState(null);

  useEffect(() => {

    let mounted = true;

    const load = () => API
      .get("/geofence/dashboard")
      .then((r) => mounted && setGeoStats(r.data))
      .catch(() => {});

    load();

    const t = setInterval(load, 60000);

    return () => { mounted = false; clearInterval(t); };

  }, []);

  return (

    <div>

      <h1>Attendance</h1>

      <div className="cards">

        <div className="card card-green">

          <h3>Present Today</h3>

          <p>{presentCount}</p>

        </div>

        <div className="card card-amber">

          <h3>Late Today</h3>

          <p>{lateCount}</p>

        </div>

        <div className="card card-blue">

          <h3>Absent Today</h3>

          <p>{absentCount}</p>

        </div>

        <div className="card card-violet">

          <h3>Total Employees</h3>

          <p>{employees.length}</p>

        </div>

      </div>

      {/* ===== Geofence widgets — live counts from /geofence/dashboard ===== */}
      <div className={styles.geoStrip}>
        <div className={`${styles.geoWidget} ${styles.geoWidgetGreen}`}>
          <div className={styles.geoLabel}>📍 Inside Geofence</div>
          <div className={`${styles.geoValue} ${styles.geoValueGreen}`}>{geoStats?.inside_geofence ?? "—"}</div>
          <div className={styles.geoSub}>employees inside office today</div>
        </div>
        <div className={`${styles.geoWidget} ${styles.geoWidgetRed}`}>
          <div className={styles.geoLabel}>🚫 Outside Geofence</div>
          <div className={`${styles.geoValue} ${styles.geoValueRed}`}>{geoStats?.outside_geofence ?? "—"}</div>
          <div className={styles.geoSub}>marked from outside the radius</div>
        </div>
        <div className={`${styles.geoWidget} ${styles.geoWidgetAmber}`}>
          <div className={styles.geoLabel}>🚨 Security Failures (Today)</div>
          <div className={`${styles.geoValue} ${styles.geoValueAmber}`}>{geoStats?.security_failures_today ?? "—"}</div>
          <div className={styles.geoSub}>
            <a href="/geofence" className={styles.geoSubLink}>review log →</a>
          </div>
        </div>
      </div>

      <h2 className="section-title">Mark Attendance</h2>

      {/* Geofence gate — must pass before Check-In/Out work */}
      <GeofenceGate
        employeeId={selectedEmployee || null}
        onAllowed={(ctx) => setGpsCtx(ctx)}
        onBlocked={() => setGpsCtx(null)}
      />

      <div className="employee-form">

        <select
          value={selectedEmployee}
          onChange={(e) =>
            setSelectedEmployee(e.target.value)
          }
        >

          <option value="">
            -- Select Employee --
          </option>

          {
            employees.map((emp) => (

              <option key={emp.ID} value={emp.ID}>
                {emp.NAME} ({emp.EMAIL})
              </option>
            ))
          }

        </select>

        <button
          className="start-btn"
          onClick={checkIn}
          disabled={!gpsCtx}
          title={!gpsCtx ? "Waiting for geofence verification…" : "Check In"}
          style={!gpsCtx ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        >
          Check In
        </button>

        <button
          className="complete-btn"
          onClick={checkOut}
          disabled={!gpsCtx}
          title={!gpsCtx ? "Waiting for geofence verification…" : "Check Out"}
          style={!gpsCtx ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        >
          Check Out
        </button>

        <button
          className="hold-btn"
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

      </div>

      {view === "board" && <LiveFloorBoard />}

      {view !== "board" && (
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
        total={rows.length}
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
    INSIDE:  { cls: styles.badgePresent, label: "INSIDE",      title: "Checked in inside the office geofence" },
    OUTSIDE: { cls: styles.badgeAbsent,  label: "OUTSIDE",     title: "Checked in outside the allowed radius" },
    UNKNOWN: { cls: styles.badgeLate,    label: "GPS SKIPPED", title: "Employee bypassed GPS — coordinates not captured" }
  }[status] || { cls: styles.badgeOther, label: status, title: status };
  return (
    <span title={theme.title} className={`${styles.statusBadge} ${theme.cls}`}>
      {theme.label}
    </span>
  );
}



export default Attendance;
