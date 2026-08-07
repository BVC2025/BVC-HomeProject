import { useEffect, useMemo, useRef, useState } from "react";

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
  const [selectedEmployee, setSelectedEmployee] = useState("");
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

  // ---- Biometric CSV import (manual upload from USB dump) ----
  const csvFileRef = useRef(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvResult, setCsvResult] = useState(null);

  const handleCsvChosen = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|txt|dat)$/i.test(file.name)) {
      alert(
        "Please pick the .csv / .txt / .dat file downloaded from the biometric device."
      );
      event.target.value = "";
      return;
    }
    setCsvBusy(true);
    setCsvResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await API.post("/api/attendance/import-csv", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setCsvResult(res.data);
      // Refresh attendance so the newly-applied punches show up.
      fetchTodayAttendance();
      fetchAllAttendance();
    } catch (err) {
      setCsvResult({
        error:
          err?.response?.data?.detail ||
          err?.message ||
          "Import failed. Check the file format.",
      });
    } finally {
      setCsvBusy(false);
      if (csvFileRef.current) csvFileRef.current.value = "";
    }
  };

  const browserInfo = useMemo(
    () =>
      typeof navigator !== "undefined"
        ? `${navigator.userAgent || ""}`.slice(0, 255)
        : null,
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

  const fetchAllAttendance = async (
    filters = historyFilters,
    pageNum = page,
    pgSize = pageSize
  ) => {
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
      const response = await API.get("/attendance/today");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        BYPASS_GEOFENCE: !!gpsCtx.gpsSkipped,
      });
      refreshAll();
    } catch (error) {
      console.log(error);
      const detail = error?.response?.data?.detail || "Error checking in";
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
        BYPASS_GEOFENCE: !!gpsCtx.gpsSkipped,
      });
      refreshAll();
    } catch (error) {
      console.log(error);
      const detail = error?.response?.data?.detail || "Error checking out";
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
    if (!window.confirm("Mark this employee absent today?")) {
      return;
    }
    try {
      await API.post("/mark-absent", {
        EMPLOYEE_ID: selectedEmployee,
        VENDOR_ID: 1,
      });
      refreshAll();
    } catch (error) {
      console.log(error);
      const detail = error?.response?.data?.detail || "Error marking absent";
      alert(detail);
    }
  };

  const deleteRecord = async (id) => {
    if (!window.confirm("Delete this attendance record?")) {
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
      minute: "2-digit",
    });
  };

  const statusBadge = (status, lateMinutes = 0) => {
    const cls =
      status === "PRESENT"
        ? "badge-present"
        : status === "LATE"
          ? "badge-late"
          : status === "ABSENT"
            ? "badge-absent"
            : "badge-other";

    const label =
      status === "LATE" && Number(lateMinutes) > 0
        ? `LATE · ${Number(lateMinutes)}m`
        : status;

    return <span className={`status-badge ${cls}`}>{label}</span>;
  };

  const presentCount = todayRecords.filter((r) => r.STATUS === "PRESENT").length;
  const lateCount = todayRecords.filter((r) => r.STATUS === "LATE").length;
  const absentCount = todayRecords.filter((r) => r.STATUS === "ABSENT").length;

  const rows = view === "today" ? todayRecords : records;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [view]);

  // For History view (view === "all"), rows come already paged from the server.
  // For Today view, paginate client-side as before.
  const pagedRows = useMemo(
    () =>
      view === "all"
        ? rows // server-paginated
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

    const load = () =>
      API.get("/geofence/dashboard")
        .then((r) => mounted && setGeoStats(r.data))
        .catch(() => { });

    load();

    const t = setInterval(load, 60000);

    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className={styles.attendancePage}>

      {/* ===================================================================
          1. HEADER — title on the left, primary action on the right.
             Sits in its own row so nothing else fights for horizontal space.
          =================================================================== */}
      <div className={styles.headerStrip}>
        <div className={styles.headerTitleRow}>
          <div className={styles.headerLeft}>
            <h1 className={styles.headerTitle}>Attendance</h1>
            <span className={styles.headerDate}>
              {new Date().toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>

          <div className={styles.headerActions}>
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv,.txt,.dat"
              onChange={handleCsvChosen}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => csvFileRef.current?.click()}
              disabled={csvBusy}
              title="Upload the attendance file you downloaded from the biometric device via USB"
              className={styles.primaryCta}
            >
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {csvBusy ? "Importing…" : "Import Biometric CSV"}
            </button>
          </div>
        </div>

        {csvResult && (
          <div
            className={csvResult.error ? styles.csvToastError : styles.csvToastOk}
          >
            {csvResult.error ? (
              <span>❌ {csvResult.error}</span>
            ) : (
              <span>
                ✓ Applied <b>{csvResult.applied}</b> / {csvResult.total_rows}
                {csvResult.skipped_duplicate > 0 && ` · ${csvResult.skipped_duplicate} dup`}
                {csvResult.skipped_unmapped > 0 && ` · ${csvResult.skipped_unmapped} unmapped`}
                {csvResult.skipped_invalid > 0 && ` · ${csvResult.skipped_invalid} invalid`}
                {csvResult.sample_unmapped_ids?.length > 0 &&
                  ` (unknown IDs: ${csvResult.sample_unmapped_ids.slice(0, 5).join(", ")})`}
              </span>
            )}
          </div>
        )}
      </div>


      {/* ===================================================================
          2. KPI GRID — four unified tiles (present / late / absent / total).
             The old page duplicated these across two rows (small border-top
             cards top-right + inline pills below) — one clean grid replaces
             both.
          =================================================================== */}
      <div className={styles.kpiGrid}>
        <KpiTile label="Present Today" value={presentCount}       tint="green" icon={KpiIcons.check} />
        <KpiTile label="Late Today"    value={lateCount}          tint="amber" icon={KpiIcons.clock} />
        <KpiTile label="Absent Today"  value={absentCount}        tint="red"   icon={KpiIcons.x} />
        <KpiTile label="Total Employees" value={employees.length} tint="blue"  icon={KpiIcons.users} />
      </div>


      {/* ===================================================================
          3. GEOFENCE STRIP — three compact tiles in the same visual language
             as the KPI grid above. Replaces the earlier stack of tall
             coloured banners + a redundant pill row.
          =================================================================== */}
      <div className={styles.geoGrid}>
        <GeoTile
          label="Inside Geofence"
          value={geoStats?.inside_geofence ?? "—"}
          sub="employees inside office today"
          tint="green"
        />
        <GeoTile
          label="Outside Geofence"
          value={geoStats?.outside_geofence ?? "—"}
          sub="marked from outside the radius"
          tint="red"
        />
        <GeoTile
          label="Security Failures (Today)"
          value={geoStats?.security_failures_today ?? "—"}
          sub={<a href="/geofence" className={styles.geoSubLink}>review log →</a>}
          tint="amber"
        />
      </div>


      {/* ===================================================================
          4. ACTION CARD — mark-attendance controls in one bordered panel.
             Compact GPS gate + employee picker + all five action buttons.
          =================================================================== */}
      <div className={styles.actionCard}>
        <GeofenceGate
          compact
          employeeId={selectedEmployee || null}
          onAllowed={(ctx) => setGpsCtx(ctx)}
          onBlocked={() => setGpsCtx(null)}
        />

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
      </div>


          <div className="tabs">
            <button
              className={"tab-btn" + (view === "board" ? " tab-active" : "")}
              onClick={() => setView("board")}
            >
              🖥️ Live Floor Board
            </button>

            <button
              className={"tab-btn" + (view === "today" ? " tab-active" : "")}
              onClick={() => setView("today")}
            >
              Today
            </button>

            <button
              className={"tab-btn" + (view === "all" ? " tab-active" : "")}
              onClick={() => setView("all")}
            >
              All Records
            </button>

            <button
              className={"tab-btn" + (view === "report" ? " tab-active" : "")}
              onClick={() => setView("report")}
            >
              Report
            </button>

            <button
              className={"tab-btn" + (view === "tracking" ? " tab-active" : "")}
              onClick={() => setView("tracking")}
            >
              Employee Tracking
            </button>

            <button
              className={"tab-btn" + (view === "monthly" ? " tab-active" : "")}
              onClick={() => setView("monthly")}
            >
              Monthly Summary
            </button>

            <button
              className={"tab-btn" + (view === "download" ? " tab-active" : "")}
              onClick={() => setView("download")}
            >
              Download
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
                    setHistoryFilters({
                      ...historyFilters,
                      start_date: e.target.value,
                    });
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
                    setHistoryFilters({
                      ...historyFilters,
                      end_date: e.target.value,
                    });
                  }}
                />
              </div>
              <div className={styles.filterField}>
                <label>Employee</label>
                <select
                  value={historyFilters.employee_id}
                  onChange={(e) => {
                    setPage(1);
                    setHistoryFilters({
                      ...historyFilters,
                      employee_id: e.target.value,
                    });
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
                        (historyFilters.status === s
                          ? styles.statusChipActive
                          : "")
                      }
                    >
                      {s || "ALL"}
                    </button>
                  ))}
                </div>
              </div>
              {(historyFilters.start_date ||
                historyFilters.end_date ||
                historyFilters.employee_id ||
                historyFilters.status) && (
                  <button
                    type="button"
                    className={styles.filterClear}
                    onClick={() => {
                      setPage(1);
                      setHistoryFilters({
                        start_date: "",
                        end_date: "",
                        employee_id: "",
                        status: "",
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
          {view === "monthly" && <MonthlySummary />}
          {view === "download" && <DownloadAttendance employees={employees} />}

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
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan="11" className={styles.emptyCell}>
                          No attendance records
                        </td>
                      </tr>
                    ) : (
                      pagedRows.map((row) => (
                        <tr key={row.ID}>
                          <td>{row.DATE}</td>
                          <td>{row.EMPLOYEE_NAME || row.EMPLOYEE_ID}</td>
                          <td>{formatTime(row.CHECK_IN)}</td>
                          <td>{formatTime(row.CHECK_OUT)}</td>
                          <td>
                            {row.WORKED_HOURS !== null &&
                              row.WORKED_HOURS !== undefined
                              ? `${row.WORKED_HOURS} h`
                              : "—"}
                          </td>
                          <td>{statusBadge(row.STATUS, row.LATE_MINUTES)}</td>
                          <td>
                            {coordCell(
                              row.CHECKIN_LATITUDE,
                              row.CHECKIN_LONGITUDE,
                              row.GEOFENCE_STATUS
                            )}
                          </td>
                          <td>
                            {coordCell(
                              row.CHECKOUT_LATITUDE,
                              row.CHECKOUT_LONGITUDE,
                              row.GEOFENCE_STATUS
                            )}
                          </td>
                          <td>
                            {row.CHECKIN_DISTANCE != null ? (
                              `${Math.round(row.CHECKIN_DISTANCE)} m`
                            ) : row.GEOFENCE_STATUS === "UNKNOWN" ? (
                              <span className={styles.gpsSkip}>GPS skipped</span>
                            ) : (
                              "—"
                            )}
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
                    )}
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
    return <div className={styles.boardLoading}>Loading floor board…</div>;
  }

  if (!data) {
    return (
      <div className={styles.boardError}>Could not load board. Check backend.</div>
    );
  }

  const s = data.summary || {};

  return (
    <div className={styles.boardPad}>
      {/* Summary tiles */}
      <div className={styles.boardSummaryGrid}>
        <SummaryTile label="Active Employees" value={s.total_active ?? 0} color="#3b82f6" />

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
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}

function EmployeeTile({ emp, tick }) {
  const isCheckedIn = !!emp.CHECK_IN;
  const isCheckedOut = !!emp.CHECK_OUT;

  // status palette
  let accent = "#94a3b8"; // not checked in
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
        <div className={styles.empAvatar} style={{ background: stateBg, color: stateFg }}>
          {(emp.NAME || "?").charAt(0).toUpperCase()}
        </div>

        <div className={styles.empMeta}>
          <div className={styles.empTileName}>{emp.NAME}</div>
          <div className={styles.empTileCode}>
            {emp.EMPLOYEE_CODE}
            {emp.DEPARTMENT_CODE && <span> · {emp.DEPARTMENT_CODE}</span>}
          </div>
        </div>

        <span className={styles.statePill} style={{ background: stateBg, color: stateFg }}>
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
            borderColor: isCheckedOut ? "#cbd5e1" : "#a7f3d0",
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
        <div className={`${styles.taskCard} ${styles.taskCardEmpty}`}>No active task</div>
      ) : null}

      {/* Tasks completed today badge */}
      {emp.TASKS_COMPLETED_TODAY > 0 && (
        <div className={styles.tasksDoneRow}>
          <span>Tasks done today</span>
          <span className={styles.tasksDoneBadge}>✓ {emp.TASKS_COMPLETED_TODAY}</span>
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
        <span title="Employee skipped the GPS check at check-in" className={styles.gpsSkip}>
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
      <span
        title="No geofence data captured for this row"
        className={`${styles.statusBadge} ${styles.badgeOther}`}
      >
        —
      </span>
    );
  }
  const theme = {
    INSIDE: {
      cls: styles.badgePresent,
      label: "INSIDE",
      title: "Checked in inside the office geofence",
    },
    OUTSIDE: {
      cls: styles.badgeAbsent,
      label: "OUTSIDE",
      title: "Checked in outside the allowed radius",
    },
    UNKNOWN: {
      cls: styles.badgeLate,
      label: "GPS SKIPPED",
      title: "Employee bypassed GPS — coordinates not captured",
    },
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
    .toISOString()
    .slice(0, 10);
  const monthEnd = today.toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(monthEnd);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError("");
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

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, []);

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
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className={styles.filterField}>
          <label>To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className={styles.statusChips} style={{ alignSelf: "flex-end" }}>
          <button type="button" className={styles.statusChip} onClick={() => setRange(7)}>
            Last 7d
          </button>
          <button type="button" className={styles.statusChip} onClick={() => setRange(30)}>
            Last 30d
          </button>
          <button type="button" className={styles.statusChip} onClick={() => setRange(90)}>
            Last 90d
          </button>
          <button
            type="button"
            className={styles.statusChip}
            onClick={() => {
              const t = new Date();
              setStartDate(new Date(t.getFullYear(), t.getMonth(), 1).toISOString().slice(0, 10));
              setEndDate(t.toISOString().slice(0, 10));
            }}
          >
            This month
          </button>
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
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 24, color: "#64748b" }}>
                  No active employees found.
                </td>
              </tr>
            )}
            {data?.rows?.map((r) => (
              <tr key={r.employee_id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{r.employee_name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{r.employee_code}</div>
                </td>
                <td>{r.working_days}</td>
                <td>{Number.isInteger(r.present) ? r.present : r.present.toFixed(1)}</td>
                <td
                  style={{
                    color: r.late >= 5 ? "#dc2626" : r.late >= 3 ? "#d97706" : "#475569",
                  }}
                >
                  {r.late}
                </td>
                <td style={{ color: r.absent > 0 ? "#dc2626" : "#475569" }}>{r.absent}</td>
                <td>{r.worked_hours}</td>
                <td>{r.overtime_hours}</td>
                <td>
                  <div className={styles.attendanceBar}>
                    <div
                      className={styles.attendanceBarFill}
                      style={{
                        width: `${Math.max(0, Math.min(100, r.attendance_pct))}%`,
                        background:
                          r.attendance_pct >= 95
                            ? "#16a34a"
                            : r.attendance_pct >= 75
                              ? "#d97706"
                              : "#dc2626",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      marginTop: 2,
                      color:
                        r.attendance_pct >= 95
                          ? "#16a34a"
                          : r.attendance_pct >= 75
                            ? "#d97706"
                            : "#dc2626",
                    }}
                  >
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
    <div className={styles.reportTile} style={accent ? { borderLeftColor: accent } : undefined}>
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
    if (!empId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await API.get(`/attendance/employee/${empId}/tracking`, {
        params: { days },
      });
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load tracking data");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [empId, days]);

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
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={
                  `${styles.statusChip} ` + (days === d ? styles.statusChipActive : "")
                }
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div className={styles.filterResultCount}>
          {loading ? "Loading…" : data ? `${data.window.working_days} working days` : "Select an employee"}
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
            <ReportTile
              label="Attendance"
              value={`${data.summary.attendance_pct}%`}
              accent={
                data.summary.attendance_pct >= 95
                  ? "#16a34a"
                  : data.summary.attendance_pct >= 75
                    ? "#d97706"
                    : "#dc2626"
              }
            />
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
                  {data.timeline
                    .slice()
                    .reverse()
                    .slice(0, 30)
                    .map((t) => (
                      <tr key={t.date}>
                        <td>{t.date}</td>
                        <td>{t.weekday}</td>
                        <td>{t.check_in || "—"}</td>
                        <td>{t.check_out || "—"}</td>
                        <td>{t.worked_hours || "—"}</td>
                        <td>{t.overtime_hours || "—"}</td>
                        <td>
                          <TrackingStatus status={t.status} />
                        </td>
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
    day.status === "PRESENT"
      ? "#16a34a"
      : day.status === "LATE"
        ? "#d97706"
        : day.status === "ABSENT"
          ? "#dc2626"
          : day.status === "HALF_DAY"
            ? "#7c3aed"
            : day.status === "WEEKLY_OFF"
              ? "#cbd5e1"
              : "#f1f5f9"; // NO_DATA
  return (
    <div
      title={`${day.date} (${day.weekday}) — ${day.status}${day.check_in ? ` · in ${day.check_in}` : ""
        }${day.check_out ? `, out ${day.check_out}` : ""}`}
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

// ----- KPI + Geofence tiles for the redesigned header block -----
const KpiIcons = {
  check: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  ),
  clock: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  x: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  ),
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="8" r="4" />
      <path d="M23 20v-2a4 4 0 0 0-3-3.87" />
      <path d="M17 4.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

function KpiTile({ label, value, tint = "blue", icon }) {
  return (
    <div className={`${styles.kpiTile} ${styles[`kpiTile_${tint}`]}`}>
      <div className={`${styles.kpiIcon} ${styles[`kpiIcon_${tint}`]}`}>
        {icon}
      </div>
      <div className={styles.kpiBody}>
        <div className={styles.kpiLabel}>{label}</div>
        <div className={styles.kpiValue}>{value}</div>
      </div>
    </div>
  );
}

function GeoTile({ label, value, sub, tint = "green" }) {
  return (
    <div className={`${styles.geoTile} ${styles[`geoTile_${tint}`]}`}>
      <div className={styles.geoTileLabel}>{label}</div>
      <div className={`${styles.geoTileValue} ${styles[`geoTileValue_${tint}`]}`}>
        {value}
      </div>
      {sub && <div className={styles.geoTileSub}>{sub}</div>}
    </div>
  );
}


// ----- Compact stat pill used in the page header -----
function StatItem({ label, value, tone = "slate", small, href }) {
  const cls =
    tone === "green"
      ? styles.statItemGreen
      : tone === "amber"
        ? styles.statItemAmber
        : tone === "red"
          ? styles.statItemRed
          : styles.statItemSlate;
  const Tag = href ? "a" : "div";
  const tagProps = href ? { href } : {};
  return (
    <Tag {...tagProps} className={`${styles.statItem} ${cls} ${small ? styles.statItemSmall : ""}`}>
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
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.4,
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// =====================================================================
// MonthlySummary — HR admin roll-up of a whole month's attendance.
//
// One row per active employee: present/late/absent counts, late
// minutes, OT hours, memo eligibility flags, star-score breakdown.
// Company-wide totals shown as tiles at the top.
// =====================================================================
function MonthlySummary() {

  const now = new Date();
  // Default to LAST month — current month is incomplete and the memo
  // engine also evaluates the previous month.
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultMonth =
    `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  // filter: all | warning | appreciation | absent | late

  // AI memo automation trigger state
  const [aiRunBusy, setAiRunBusy] = useState(false);
  const [aiRunResult, setAiRunResult] = useState(null);
  const [aiRunError, setAiRunError] = useState("");

  const load = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setLoading(true);
    setError("");
    try {
      const res = await API.get("/attendance/summary/monthly", { params: { month } });
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load monthly summary");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const runAiMemos = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    if (!window.confirm(
      `Generate AI-personalised memos for ${data?.month_label || month}?\n\n`
      + `Every employee flagged as warning-eligible or appreciation-eligible will `
      + `receive a written memo AND a notification. Already-issued memos are skipped.`
    )) return;
    setAiRunBusy(true);
    setAiRunError("");
    setAiRunResult(null);
    try {
      const res = await API.post("/memos/automation/run-monthly", { month });
      setAiRunResult(res.data);
      // Reload the summary so memo-count columns refresh
      await load();
    } catch (e) {
      setAiRunError(e?.response?.data?.detail || "Memo generation failed");
    } finally {
      setAiRunBusy(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month]);

  const rows = (data?.employees || []).filter((r) => {
    if (filter === "warning") return r.memo_flags?.will_get_warning;
    if (filter === "appreciation") return r.memo_flags?.will_get_appreciation;
    if (filter === "absent") return r.unpaid_absences > 0;
    if (filter === "late") return r.late_arrivals >= 3;
    return true;
  });

  return (
    <div style={ms.wrap}>

      {/* Header — month picker + label */}
      <div style={ms.head}>
        <div>
          <div style={ms.eyebrow}>Attendance · Monthly Summary</div>
          <h2 style={ms.title}>{data?.month_label || month}</h2>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={ms.monthInput}
        />
      </div>

      {/* Loading / error */}
      {loading && <div style={ms.info}>Loading monthly summary…</div>}
      {error && <div style={ms.error}><b>Error:</b> {error}</div>}

      {/* Company-wide totals */}
      {data?.totals && !loading && (
        <div style={ms.tiles}>
          <Tile label="Employees" value={data.totals.employees} />
          <Tile label="Total Presents" value={data.totals.days_present} tone="ok" />
          <Tile label="Unpaid Absences" value={data.totals.unpaid_absences} tone={data.totals.unpaid_absences ? "warn" : "muted"} />
          <Tile label="Late Arrivals" value={data.totals.late_arrivals} tone={data.totals.late_arrivals ? "warn" : "muted"} />
          <Tile label="OT Hours" value={data.totals.total_ot_hours + "h"} tone="info" />
          <Tile label="Missed Check-outs" value={data.totals.missed_checkouts} tone={data.totals.missed_checkouts ? "warn" : "muted"} />
          <Tile label="Will get Warning" value={data.totals.will_get_warning} tone={data.totals.will_get_warning ? "danger" : "muted"} />
          <Tile label="Will get Appreciation" value={data.totals.will_get_appreciation} tone="ok" />
        </div>
      )}

      {/* Filter chips */}
      {data && !loading && (
        <div style={ms.chipRow}>
          {[
            ["all", "All"],
            ["warning", "Warning-eligible"],
            ["appreciation", "Appreciation-eligible"],
            ["absent", "Any Unpaid Absence"],
            ["late", "3+ Late"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                ...ms.chip,
                background: filter === k ? "#dc2626" : "#fff",
                color: filter === k ? "#fff" : "#475569",
                borderColor: filter === k ? "#dc2626" : "#cbd5e1",
              }}
            >
              {label}
            </button>
          ))}
          <span style={ms.chipCount}>
            {rows.length} of {data.employees.length}
          </span>
        </div>
      )}

      {/* AI Memo Automation panel */}
      {data && !loading && (
        <div style={ms.aiPanel}>
          <div style={{ flex: 1 }}>
            <div style={ms.aiTitle}>AI Memo Automation</div>
            <div style={ms.aiDesc}>
              Generates AI-personalised memos for every employee flagged
              above. Warnings for {data.totals.will_get_warning} employee(s),
              appreciations for {data.totals.will_get_appreciation}. Already-
              issued memos are skipped. Employees also get a bell
              notification. Manual memo entry is unaffected.
            </div>
          </div>
          <button
            onClick={runAiMemos}
            disabled={aiRunBusy}
            style={{ ...ms.aiBtn, opacity: aiRunBusy ? 0.6 : 1 }}
          >
            {aiRunBusy ? "Generating…" : "✨ Generate Monthly Memos"}
          </button>
        </div>
      )}

      {aiRunError && (
        <div style={ms.error}><b>Error:</b> {aiRunError}</div>
      )}

      {aiRunResult && (
        <div style={ms.aiResult}>
          <b>✓ Run complete for {aiRunResult.month}:</b>
          {" "}{aiRunResult.warnings_created} warning(s),
          {" "}{aiRunResult.appreciations_created} appreciation(s),
          {" "}{aiRunResult.skipped_already_issued} skipped (already issued),
          {" "}{aiRunResult.errors?.length || 0} error(s).
          {aiRunResult.errors?.length > 0 && (
            <ul style={{ margin: "6px 0 0 18px", fontSize: 12 }}>
              {aiRunResult.errors.slice(0, 5).map((e, i) => (<li key={i}>{e}</li>))}
            </ul>
          )}
        </div>
      )}

      {/* Grid */}
      {data && !loading && (
        <div style={ms.tableWrap}>
          <table style={ms.table}>
            <thead>
              <tr style={ms.trHead}>
                <th style={ms.th}>Code</th>
                <th style={ms.th}>Name</th>
                <th style={ms.thN}>Present</th>
                <th style={ms.thN}>Absent</th>
                <th style={ms.thN}>Leave</th>
                <th style={ms.thN}>Late</th>
                <th style={ms.thN}>Late min</th>
                <th style={ms.thN}>Missed C-Out</th>
                <th style={ms.thN}>Worked hrs</th>
                <th style={ms.thN}>OT hrs</th>
                <th style={ms.thN}>CL avail</th>
                <th style={ms.thN}>Star (a)</th>
                <th style={ms.th}>Memo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id} style={ms.tr}>
                  <td style={ms.td}>{r.employee_code}</td>
                  <td style={ms.td}><b>{r.name}</b></td>
                  <td style={ms.tdN}>{r.days_present}</td>
                  <td style={{ ...ms.tdN, color: r.unpaid_absences ? "#b91c1c" : "#0f172a", fontWeight: r.unpaid_absences ? 700 : 400 }}>
                    {r.unpaid_absences}
                  </td>
                  <td style={ms.tdN}>{r.days_on_leave}</td>
                  <td style={{ ...ms.tdN, color: r.late_arrivals >= 5 ? "#b91c1c" : (r.late_arrivals >= 3 ? "#d97706" : "#0f172a"), fontWeight: r.late_arrivals >= 5 ? 700 : 400 }}>
                    {r.late_arrivals}
                  </td>
                  <td style={ms.tdN}>{r.total_late_minutes}</td>
                  <td style={ms.tdN}>{r.missed_checkouts}</td>
                  <td style={ms.tdN}>{r.total_worked_hours}</td>
                  <td style={ms.tdN}>{r.total_ot_hours}</td>
                  <td style={ms.tdN}>
                    {r.leave_balance?.casual?.available ?? "—"}
                  </td>
                  <td style={ms.tdN}><b>{r.star_score_attendance}</b>/80</td>
                  <td style={ms.td}>
                    {r.memo_flags?.will_get_warning && (
                      <span style={ms.badgeWarn}>⚠ Warning</span>
                    )}
                    {r.memo_flags?.will_get_appreciation && (
                      <span style={ms.badgeOk}>★ Appreciation</span>
                    )}
                    {!r.memo_flags?.will_get_warning && !r.memo_flags?.will_get_appreciation && (
                      <span style={ms.badgeMuted}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ ...ms.td, textAlign: "center", padding: 28, color: "#64748b" }}>
                    No employees match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend / rules */}
      {data && !loading && (
        <div style={ms.legend}>
          <b>Memo rules:</b> Warning if <b>5+ late</b> OR <b>1+ unpaid absence</b> OR <b>5+ missed check-outs</b>.
          Appreciation if <b>0 late</b> AND <b>0 unpaid absences</b> (and at least one day present).
          Unpaid absence = no check-in and no approved leave on a working day.
        </div>
      )}

    </div>
  );
}


function Tile({ label, value, tone = "muted" }) {
  const colors = {
    ok:     { bg: "#ecfdf5", fg: "#065f46", border: "#a7f3d0" },
    warn:   { bg: "#fffbeb", fg: "#92400e", border: "#fde68a" },
    danger: { bg: "#fef2f2", fg: "#991b1b", border: "#fecaca" },
    info:   { bg: "#eff6ff", fg: "#1e40af", border: "#bfdbfe" },
    muted:  { bg: "#f8fafc", fg: "#334155", border: "#e2e8f0" },
  };
  const c = colors[tone] || colors.muted;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "10px 14px", minWidth: 130 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: c.fg, opacity: 0.85 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c.fg, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}


const ms = {
  wrap: { padding: "10px 0" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 },
  eyebrow: { fontSize: 11, fontWeight: 800, color: "#dc2626", letterSpacing: 1.6, textTransform: "uppercase" },
  title: { fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "4px 0 0 0" },
  monthInput: { padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, fontFamily: "inherit" },
  info: { padding: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, color: "#475569" },
  error: { padding: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, marginBottom: 12 },
  tiles: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  chipRow: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" },
  chip: { padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  chipCount: { fontSize: 12, color: "#64748b", marginLeft: "auto" },
  tableWrap: { overflowX: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "inherit" },
  trHead: { background: "#f8fafc" },
  th: { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 800, color: "#475569", letterSpacing: 0.4, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" },
  thN: { padding: "10px 12px", textAlign: "center", fontSize: 11, fontWeight: 800, color: "#475569", letterSpacing: 0.4, textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px 12px", color: "#0f172a" },
  tdN: { padding: "10px 12px", textAlign: "center", color: "#0f172a" },
  badgeWarn: { display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", fontSize: 11, fontWeight: 800 },
  badgeOk: { display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", fontSize: 11, fontWeight: 800 },
  badgeMuted: { display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0", fontSize: 11, fontWeight: 800 },
  legend: { marginTop: 12, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, color: "#475569", lineHeight: 1.6 },
  aiPanel: { display: "flex", gap: 14, alignItems: "center", padding: 14, background: "linear-gradient(135deg, #fef2f2 0%, #fffbeb 100%)", border: "1px solid #fecaca", borderRadius: 10, marginBottom: 12, flexWrap: "wrap" },
  aiTitle: { fontSize: 14, fontWeight: 800, color: "#991b1b", marginBottom: 4 },
  aiDesc: { fontSize: 12.5, color: "#78350f", lineHeight: 1.5 },
  aiBtn: { padding: "10px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  aiResult: { marginBottom: 12, padding: 12, background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", borderRadius: 8, fontSize: 13 },
};


// =====================================================================
// DownloadAttendance — one-click monthly Excel export.
//
// Renders a small card with a month picker (defaults to current month),
// an optional employee filter, and a Download button. Hits
// GET /attendance/export.xlsx?month=YYYY-MM&employee_id=... and streams
// the file back as a real browser download.
// =====================================================================
function DownloadAttendance({ employees }) {

  // Default to the current month in YYYY-MM.
  const now = new Date();
  const defaultMonth =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastDownload, setLastDownload] = useState(null);

  const download = async () => {

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      setError("Pick a month first (YYYY-MM).");
      return;
    }

    setBusy(true);
    setError("");

    try {

      const res = await API.get("/attendance/download/xlsx", {
        params: {
          month,
          ...(employeeId ? { employee_id: employeeId } : {}),
        },
        responseType: "blob",
      });

      // Trigger a real browser download.
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);

      const filename = employeeId
        ? `attendance-${month}-${employeeId.slice(0, 8)}.xlsx`
        : `attendance-${month}.xlsx`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setLastDownload({
        filename,
        at: new Date().toLocaleTimeString(),
      });

    } catch (e) {

      // If the server returned an error blob, decode it so we can show
      // the actual message instead of "[object Blob]".
      let msg = "Download failed. Try again.";

      if (e?.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const j = JSON.parse(text);
          msg = j.detail || msg;
        } catch { /* ignore parse failure */ }
      } else if (e?.response?.data?.detail) {
        msg = e.response.data.detail;
      }

      setError(msg);

    } finally {
      setBusy(false);
    }
  };

  // Human label for the picked month.
  const monthLabel = (() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return month;
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  })();

  return (
    <div style={dl.wrap}>

      <div style={dl.card}>

        <div style={dl.eyebrow}>Attendance · Admin</div>

        <h2 style={dl.title}>Download Attendance</h2>

        <p style={dl.lede}>
          Export a month's attendance rows as an Excel file. Includes
          check-in / check-out times, worked and OT hours, status,
          late-by minutes, and the source (biometric device or web).
        </p>

        <div style={dl.field}>
          <label style={dl.label}>Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={dl.input}
          />
          <div style={dl.hint}>
            Selected: <b>{monthLabel}</b>
          </div>
        </div>

        <div style={dl.field}>
          <label style={dl.label}>Employee (optional)</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            style={dl.input}
          >
            <option value="">All employees</option>
            {(employees || []).map((emp) => (
              <option key={emp.ID} value={emp.ID}>
                {emp.NAME} ({emp.EMPLOYEE_CODE || "—"})
              </option>
            ))}
          </select>
          <div style={dl.hint}>
            Leave blank to export the whole company. Pick one employee
            to export just their month.
          </div>
        </div>

        <button
          onClick={download}
          disabled={busy}
          style={{ ...dl.btn, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Preparing file…" : "⬇ Download Excel"}
        </button>

        {error && (
          <div style={dl.error}>
            <b>Error:</b> {error}
          </div>
        )}

        {lastDownload && !error && (
          <div style={dl.success}>
            ✓ Downloaded <b>{lastDownload.filename}</b> at {lastDownload.at}
          </div>
        )}

        <div style={dl.help}>
          <div style={dl.helpTitle}>What's in the file</div>
          <ul style={dl.helpList}>
            <li>Employee code, name, date, day-of-week</li>
            <li>Check-in / check-out / OT check-in / OT check-out times</li>
            <li>Worked hours + OT hours (decimal)</li>
            <li>Status (PRESENT / LATE / ABSENT / HALF_DAY)</li>
            <li>Late-by minutes (0 if on time)</li>
            <li>Source (ESSL_ADMS = biometric, else web/manual)</li>
            <li>Any admin remarks</li>
          </ul>
        </div>

      </div>
    </div>
  );
}


const dl = {
  wrap: {
    padding: "16px 0",
  },
  card: {
    maxWidth: 640,
    background: "#fff",
    borderRadius: 14,
    padding: 28,
    boxShadow: "0 6px 20px rgba(15,23,42,0.06)",
    border: "1px solid #e2e8f0",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: "#dc2626",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 22,
    fontWeight: 800,
    margin: "6px 0 8px 0",
    color: "#0f172a",
    letterSpacing: -0.3,
  },
  lede: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 1.55,
    margin: "0 0 20px 0",
  },
  field: {
    marginBottom: 16,
  },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#475569",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  hint: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
  },
  btn: {
    marginTop: 6,
    padding: "12px 22px",
    border: "none",
    borderRadius: 10,
    background: "#dc2626",
    color: "#fff",
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: 0.4,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  error: {
    marginTop: 16,
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 8,
    fontSize: 13,
  },
  success: {
    marginTop: 16,
    padding: "10px 14px",
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    color: "#065f46",
    borderRadius: 8,
    fontSize: 13,
  },
  help: {
    marginTop: 22,
    padding: 14,
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
  },
  helpTitle: {
    fontSize: 12,
    fontWeight: 800,
    color: "#0f172a",
    marginBottom: 6,
  },
  helpList: {
    margin: 0,
    paddingLeft: 20,
    fontSize: 12.5,
    lineHeight: 1.7,
    color: "#475569",
  },
};


export default Attendance;
