import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import TablePagination from "../components/TablePagination";

import IconButton from "../components/IconButton";

import GeofenceGate from "../components/GeofenceGate";

import { formatISTTime, istEpoch } from "../utils/time";

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
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12,
        marginTop: 14
      }}>
        <div style={geoWidget("#10b981", "#ecfdf5")}>
          <div style={geoLabel}>📍 Inside Geofence</div>
          <div style={geoValue("#065f46")}>{geoStats?.inside_geofence ?? "—"}</div>
          <div style={geoSub}>employees inside office today</div>
        </div>
        <div style={geoWidget("#ef4444", "#fef2f2")}>
          <div style={geoLabel}>🚫 Outside Geofence</div>
          <div style={geoValue("#991b1b")}>{geoStats?.outside_geofence ?? "—"}</div>
          <div style={geoSub}>marked from outside the radius</div>
        </div>
        <div style={geoWidget("#f59e0b", "#fffbeb")}>
          <div style={geoLabel}>🚨 Security Failures (Today)</div>
          <div style={geoValue("#854d0e")}>{geoStats?.security_failures_today ?? "—"}</div>
          <div style={geoSub}>
            <a href="/geofence" style={{ color: "#854d0e", textDecoration: "underline" }}>
              review log →
            </a>
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
                  style={{
                    textAlign: "center",
                    color: "#94a3b8",
                    padding: "30px"
                  }}
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

                  <td>{coordCell(row.CHECKIN_LATITUDE, row.CHECKIN_LONGITUDE)}</td>

                  <td>{coordCell(row.CHECKOUT_LATITUDE, row.CHECKOUT_LONGITUDE)}</td>

                  <td>
                    {row.CHECKIN_DISTANCE != null
                      ? `${Math.round(row.CHECKIN_DISTANCE)} m`
                      : "—"}
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
      <div style={{ padding: 40, color: "#94a3b8" }}>
        Loading floor board…
      </div>
    );
  }

  if (!data) {

    return (
      <div style={{ padding: 40, color: "#b91c1c" }}>
        Could not load board. Check backend.
      </div>
    );
  }

  const s = data.summary || {};

  return (

    <div style={{ padding: 8 }}>

      {/* Summary tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 18
        }}
      >

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
      <div
        style={{
          fontSize: 11,
          color: "#94a3b8",
          marginBottom: 12,
          textAlign: "right"
        }}
      >
        Auto-refreshing every 10s · as of {data.as_of?.slice(11, 19)}
      </div>

      {/* Employee tile grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14
        }}
      >

        {(data.employees || []).map((emp) => (

          <EmployeeTile key={emp.EMPLOYEE_ID} emp={emp} tick={tick} />
        ))}

        {(data.employees || []).length === 0 && (

          <div
            style={{
              gridColumn: "1 / -1",
              padding: 40,
              textAlign: "center",
              color: "#94a3b8",
              background: "white",
              borderRadius: 10
            }}
          >
            No active employees. Run /demo/seed-bvc24 to populate.
          </div>
        )}
      </div>
    </div>
  );
}


function SummaryTile({ label, value, sub, color }) {

  return (

    <div
      style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        borderTop: `3px solid ${color}`
      }}
    >

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: "#64748b",
          textTransform: "uppercase"
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 6
        }}
      >
        {value}
      </div>

      {sub && (

        <div
          style={{
            fontSize: 11,
            color: "#94a3b8",
            marginTop: 2
          }}
        >
          {sub}
        </div>
      )}
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

    <div
      style={{
        background: "white",
        borderRadius: 14,
        padding: 18,
        boxShadow: "0 6px 20px rgba(15,23,42,0.08)",
        borderLeft: `5px solid ${accent}`,
        position: "relative",
        overflow: "hidden"
      }}
    >

      {/* Header: avatar + name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14
        }}
      >

        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: "50%",
            background: stateBg,
            color: stateFg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 700,
            flexShrink: 0
          }}
        >
          {(emp.NAME || "?").charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>

          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#0f172a",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {emp.NAME}
          </div>

          <div
            style={{
              fontSize: 11,
              color: "#94a3b8",
              fontFamily: "ui-monospace, monospace"
            }}
          >
            {emp.EMPLOYEE_CODE}
            {emp.DEPARTMENT_CODE && (
              <span> · {emp.DEPARTMENT_CODE}</span>
            )}
          </div>
        </div>

        <span
          style={{
            background: stateBg,
            color: stateFg,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: "uppercase"
          }}
        >
          {stateLabel}
        </span>
      </div>

      {/* Clock row: CHECK_IN | CHECK_OUT */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 12
        }}
      >

        <div
          style={{
            padding: "8px 12px",
            background: "#f8fafc",
            borderRadius: 8,
            textAlign: "center"
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              fontWeight: 600
            }}
          >
            Check-In
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: emp.CHECK_IN ? "#10b981" : "#cbd5e1",
              fontFamily: "ui-monospace, monospace",
              marginTop: 2
            }}
          >
            {emp.CHECK_IN ? formatISTTime(emp.CHECK_IN) : "—:—"}
          </div>
        </div>

        <div
          style={{
            padding: "8px 12px",
            background: "#f8fafc",
            borderRadius: 8,
            textAlign: "center"
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              fontWeight: 600
            }}
          >
            Check-Out
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: emp.CHECK_OUT ? "#ef4444" : "#cbd5e1",
              fontFamily: "ui-monospace, monospace",
              marginTop: 2
            }}
          >
            {emp.CHECK_OUT ? formatISTTime(emp.CHECK_OUT) : "—:—"}
          </div>
        </div>
      </div>

      {/* Live worked-hours counter when checked in */}
      {isCheckedIn && (

        <div
          style={{
            background:
              isCheckedOut ? "#f1f5f9" : "#ecfdf5",
            border: `1px solid ${isCheckedOut ? "#cbd5e1" : "#a7f3d0"}`,
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >

          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: 0.8
            }}
          >
            {isCheckedOut ? "Worked" : "Live ⏱"}
          </div>

          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 16,
              fontWeight: 700,
              color: isCheckedOut ? "#475569" : "#047857"
            }}
          >
            {liveHours}
          </div>
        </div>
      )}

      {/* Current task or completed-today summary */}
      {emp.CURRENT_TASK_NAME ? (

        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 8,
            padding: 10
          }}
        >

          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#1e40af",
              textTransform: "uppercase",
              letterSpacing: 0.8
            }}
          >
            Now Working On
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#0f172a",
              marginTop: 2,
              lineHeight: 1.3
            }}
          >
            {emp.CURRENT_TASK_NAME}
          </div>

          {emp.CURRENT_PROJECT && (

            <div
              style={{
                fontSize: 11,
                color: "#64748b",
                marginTop: 2
              }}
            >
              {emp.CURRENT_PROJECT}
            </div>
          )}

          <div
            style={{
              fontSize: 10,
              color: "#1e40af",
              marginTop: 4,
              fontWeight: 600
            }}
          >
            Status: {emp.CURRENT_TASK_STATUS}
          </div>
        </div>
      ) : isCheckedIn ? (

        <div
          style={{
            background: "#f8fafc",
            border: "1px dashed #cbd5e1",
            borderRadius: 8,
            padding: 10,
            textAlign: "center",
            fontSize: 12,
            color: "#94a3b8"
          }}
        >
          No active task
        </div>
      ) : null}

      {/* Tasks completed today badge */}
      {emp.TASKS_COMPLETED_TODAY > 0 && (

        <div
          style={{
            marginTop: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "#475569"
          }}
        >

          <span>Tasks done today</span>

          <span
            style={{
              background: "#dcfce7",
              color: "#166534",
              padding: "2px 10px",
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 13
            }}
          >
            ✓ {emp.TASKS_COMPLETED_TODAY}
          </span>
        </div>
      )}
    </div>
  );
}


// ---- Report-cell helpers for the geofence columns ----
function coordCell(lat, lng) {
  if (lat == null || lng == null) return "—";
  const short = (n) => Number(n).toFixed(5);
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Google Maps"
      style={{
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
        color: "#6366f1",
        textDecoration: "none"
      }}
    >
      {short(lat)}, {short(lng)} 🗺
    </a>
  );
}

function geofenceBadge(status) {
  const theme = {
    INSIDE:  { bg: "#dcfce7", fg: "#166534", label: "Inside" },
    OUTSIDE: { bg: "#fee2e2", fg: "#991b1b", label: "Outside" },
    UNKNOWN: { bg: "#f1f5f9", fg: "#475569", label: "—" }
  }[status || "UNKNOWN"] || { bg: "#f1f5f9", fg: "#475569", label: "—" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.5,
      background: theme.bg,
      color: theme.fg
    }}>
      {theme.label}
    </span>
  );
}


// ---- Geofence-widget tiny style helpers ----
function geoWidget(border, bg) {
  return {
    background: bg,
    border: `1px solid ${border}33`,
    borderTop: `3px solid ${border}`,
    padding: "12px 16px",
    borderRadius: 10,
    boxShadow: "0 2px 8px rgba(15,23,42,0.04)"
  };
}
const geoLabel = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 1,
  color: "#475569",
  textTransform: "uppercase"
};
function geoValue(color) {
  return {
    fontSize: 28, fontWeight: 800, color, marginTop: 4, lineHeight: 1
  };
}
const geoSub = { fontSize: 11, color: "#64748b", marginTop: 6 };


export default Attendance;
