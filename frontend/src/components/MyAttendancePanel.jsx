import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import GeofenceGate from "./GeofenceGate";
import { formatISTTime } from "../utils/time";


// =====================================================================
// MyAttendancePanel
// ---------------------------------------------------------------------
// Employee-side attendance dashboard. Three cards + action buttons:
//
//   1. Today's Attendance Status   — Status badge, Check-In, Check-Out,
//                                    Total Working Hours
//   2. Live Geofence Status        — Your coords, Office coords,
//                                    Distance, Allowed Radius, GPS
//                                    Accuracy, INSIDE/OUTSIDE badge
//   3. Last Attendance Attempt     — Time, Distance, Result,
//                                    Failure Reason (if blocked)
//
// All data sourced from existing endpoints; no new backend logic.
//   - GET  /attendance/today                  → today's row
//   - GET  /geofence/settings?vendor_id=1     → office coords + radius
//   - GET  /geofence/security-logs?employee_id=...&limit=5
//                                             → failed attempts
//   - POST /check-in, /check-out, /mark-absent (existing actions)
// =====================================================================

const BVC = {
  PRIMARY: "#C8102E",
  DARK:    "#8B0B1F",
  DEEPEST: "#4A0E18",
  ACCENT:  "#F4B324",
  INK:     "#0f172a",
  MUTED:   "#94a3b8",
  TINT:    "#fef2f2",
  BORDER:  "#fecaca",
  BG:      "#F5F6FA"
};

const CARD = {
  background: "#fff",
  borderRadius: 14,
  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
  padding: 22,
  marginBottom: 16
};

const CARD_HEADER = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  marginBottom: 16
};

const SECTION_LABEL = {
  textTransform: "uppercase",
  fontSize: 11,
  letterSpacing: 1.2,
  fontWeight: 700,
  color: BVC.DEEPEST,
  margin: 0
};

// Color-coded badges per requirement:
//   Present / Inside  → Green
//   Late              → Yellow
//   Absent / Outside  → Red
const BADGE_THEME = {
  PRESENT:    { bg: "#dcfce7", fg: "#166534", label: "Present" },
  LATE:       { bg: "#fef3c7", fg: "#92400e", label: "Late" },
  ABSENT:     { bg: "#fee2e2", fg: "#991b1b", label: "Absent" },
  EARLY_EXIT: { bg: "#fed7aa", fg: "#9a3412", label: "Early Exit" },
  INSIDE:     { bg: "#dcfce7", fg: "#166534", label: "Inside" },
  OUTSIDE:    { bg: "#fee2e2", fg: "#991b1b", label: "Outside" },
  CHECKING:   { bg: "#e0f2fe", fg: "#0c4a6e", label: "Checking…" },
  DENIED:     { bg: "#fee2e2", fg: "#991b1b", label: "GPS Denied" },
  TIMEOUT:    { bg: "#fef3c7", fg: "#92400e", label: "GPS Timeout" },
  UNAVAILABLE:{ bg: "#fee2e2", fg: "#991b1b", label: "GPS Unavailable" },
  ALLOWED:    { bg: "#dcfce7", fg: "#166534", label: "Allowed" },
  BLOCKED:    { bg: "#fee2e2", fg: "#991b1b", label: "Blocked" },
  PENDING:    { bg: "#f1f5f9", fg: "#475569", label: "Not marked" }
};


function Badge({ kind, label }) {
  const theme = BADGE_THEME[kind] || { bg: "#e5e7eb", fg: "#475569", label: kind || "—" };
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 12px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      background: theme.bg,
      color: theme.fg,
      whiteSpace: "nowrap"
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: theme.fg, display: "inline-block"
      }} />
      {label || theme.label}
    </span>
  );
}


function elapsedSince(iso) {
  if (!iso) return "";
  const hasTz = /[+-]\d{2}:?\d{2}$|Z$/.test(iso);
  const d = new Date(hasTz ? iso : iso + "Z");
  if (isNaN(d.getTime())) return "";
  const ms = Date.now() - d.getTime();
  if (ms < 0) return "";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}


function fmtCoord(n) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toFixed(6);
}


function fmtDistance(m) {
  if (m == null || isNaN(m)) return "—";
  const v = Number(m);
  if (v >= 1000) return `${(v / 1000).toFixed(2)} km`;
  return `${Math.round(v)} m`;
}


function fmtAttemptTime(iso) {
  if (!iso) return "—";
  const hasTz = /[+-]\d{2}:?\d{2}$|Z$/.test(iso);
  const d = new Date(hasTz ? iso : iso + "Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true
  });
}


function reasonLabel(reason) {
  return ({
    OUTSIDE_GEOFENCE:  "Outside office geofence",
    PERMISSION_DENIED: "Location permission denied",
    GPS_DISABLED:      "GPS turned off",
    LOCATION_TIMEOUT:  "GPS timed out",
    SERVER_ERROR:      "Server validation error",
    GPS_ERROR:         "GPS error"
  })[reason] || reason || "Unknown";
}


export default function MyAttendancePanel({ employeeId }) {

  const [gpsCtx, setGpsCtx]               = useState(null);
  const [geoState, setGeoState]           = useState("CHECKING");
  const [geoReason, setGeoReason]         = useState(null);
  const [office, setOffice]               = useState(null);  // {lat, lng, radius, name}
  const [today, setToday]                 = useState(null);
  const [lastAttempt, setLastAttempt]     = useState(null);
  const [busy, setBusy]                   = useState(false);
  const [notice, setNotice]               = useState(null);
  const [tick, setTick]                   = useState(0);

  const browserInfo = useMemo(
    () => (typeof navigator !== "undefined"
      ? `${navigator.userAgent || ""}`.slice(0, 255)
      : null),
    []
  );

  // ---- Fetch office settings once -----------------------------------
  useEffect(() => {
    API.get("/geofence/settings")
      .then(r => setOffice({
        lat:    r.data?.LATITUDE,
        lng:    r.data?.LONGITUDE,
        radius: r.data?.RADIUS_METERS,
        name:   r.data?.OFFICE_NAME,
        active: !!r.data?.IS_ACTIVE
      }))
      .catch(() => { /* non-fatal */ });
  }, []);

  // ---- Fetch today's row -------------------------------------------
  const refreshToday = useCallback(async () => {
    if (!employeeId) return;
    try {
      const res = await API.get("/attendance/today");
      const todayISO = new Date().toISOString().slice(0, 10);
      const mine = (res.data || []).find(r => {
        const matchesEmp = (r.EMPLOYEE_ID || "") === employeeId
                       || (r.EMPLOYEE_CODE || "") === employeeId;
        const matchesDay = (r.DATE || "").slice(0, 10) === todayISO;
        return matchesEmp && matchesDay;
      });
      setToday(mine || null);
    } catch { /* non-fatal */ }
  }, [employeeId]);

  // ---- Fetch most-recent failed attempt for this employee ----------
  const refreshLastAttempt = useCallback(async () => {
    if (!employeeId) return;
    try {
      const res = await API.get("/geofence/security-logs", {
        params: { employee_id: employeeId, limit: 5 }
      });
      const rows = res.data || [];
      if (rows.length > 0) {
        setLastAttempt({
          time:     rows[0].CREATED_AT,
          distance: rows[0].DISTANCE,
          reason:   rows[0].REASON,
          detail:   rows[0].DETAIL,
          result:   "BLOCKED"
        });
      } else {
        setLastAttempt(null);
      }
    } catch { /* non-fatal */ }
  }, [employeeId]);

  useEffect(() => { refreshToday(); }, [refreshToday]);
  useEffect(() => { refreshLastAttempt(); }, [refreshLastAttempt]);

  // 30s ticker for "Working For" + lastAttempt refresh
  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1);
      refreshLastAttempt();
    }, 30000);
    return () => clearInterval(id);
  }, [refreshLastAttempt]);

  // Auto-clear notices
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  void tick;

  // ---- Geofence gate callbacks --------------------------------------
  const onGpsAllowed = (ctx) => {
    setGpsCtx(ctx);
    setGeoState("INSIDE");
    setGeoReason(null);
  };

  const onGpsBlocked = (reason) => {
    setGpsCtx(null);
    const map = {
      OUTSIDE_GEOFENCE:  "OUTSIDE",
      PERMISSION_DENIED: "DENIED",
      GPS_DISABLED:      "UNAVAILABLE",
      LOCATION_TIMEOUT:  "TIMEOUT",
      SERVER_ERROR:      "OUTSIDE"
    };
    setGeoState(map[reason] || "OUTSIDE");
    setGeoReason(reason);
    // Refetch security log so the "Last Attempt" card reflects the
    // failure that GeofenceGate just logged server-side.
    setTimeout(refreshLastAttempt, 700);
  };

  // ---- Action handlers ----------------------------------------------
  const handleCheckIn = async () => {
    if (!gpsCtx) {
      setNotice({ type: "err", text: "Waiting for GPS — must be inside the office geofence." });
      return;
    }
    setBusy(true);
    try {
      await API.post("/check-in", {
        EMPLOYEE_ID:  employeeId,
        VENDOR_ID:    1,
        LATITUDE:     gpsCtx.lat,
        LONGITUDE:    gpsCtx.lng,
        DEVICE_INFO:  gpsCtx.deviceInfo,
        BROWSER_INFO: browserInfo
      });
      setNotice({ type: "ok", text: "✓ Checked in successfully." });
      refreshToday();
    } catch (err) {
      setNotice({
        type: "err",
        text: err?.response?.data?.detail || err?.message || "Check-in failed"
      });
      setTimeout(refreshLastAttempt, 700);
    } finally { setBusy(false); }
  };

  const handleCheckOut = async () => {
    if (!gpsCtx) {
      setNotice({ type: "err", text: "Waiting for GPS — must be inside the office geofence." });
      return;
    }
    setBusy(true);
    try {
      await API.post("/check-out", {
        EMPLOYEE_ID: employeeId,
        LATITUDE:    gpsCtx.lat,
        LONGITUDE:   gpsCtx.lng,
        DEVICE_INFO: gpsCtx.deviceInfo
      });
      setNotice({ type: "ok", text: "✓ Checked out — have a good day!" });
      refreshToday();
    } catch (err) {
      setNotice({
        type: "err",
        text: err?.response?.data?.detail || err?.message || "Check-out failed"
      });
      setTimeout(refreshLastAttempt, 700);
    } finally { setBusy(false); }
  };

  const handleMarkAbsent = async () => {
    if (!window.confirm("Mark yourself absent for today? This cannot be undone from here.")) {
      return;
    }
    setBusy(true);
    try {
      await API.post("/mark-absent", { EMPLOYEE_ID: employeeId, VENDOR_ID: 1 });
      setNotice({ type: "ok", text: "Marked absent for today." });
      refreshToday();
    } catch (err) {
      setNotice({
        type: "err",
        text: err?.response?.data?.detail || err?.message || "Failed to mark absent"
      });
    } finally { setBusy(false); }
  };

  // ---- Derived state ------------------------------------------------
  const status        = today?.STATUS || "PENDING";
  const isCheckedIn   = !!today?.CHECK_IN;
  const isCheckedOut  = !!today?.CHECK_OUT;
  const isAbsent      = status === "ABSENT";
  const canCheckIn    = !!gpsCtx && !busy && !isCheckedIn && !isAbsent;
  const canCheckOut   = !!gpsCtx && !busy && isCheckedIn && !isCheckedOut;
  const canMarkAbsent = !busy && !isCheckedIn && !isAbsent;

  const workingHours =
    today?.WORKED_HOURS != null
      ? `${Number(today.WORKED_HOURS).toFixed(2)} h`
      : (isCheckedIn && !isCheckedOut ? `${elapsedSince(today.CHECK_IN)} (running)` : "—");

  return (
    <div>

      {/* ============================================================ */}
      {/* CARD 1 — TODAY'S ATTENDANCE STATUS                            */}
      {/* ============================================================ */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h3 style={SECTION_LABEL}>📅 Today's Attendance Status</h3>
          <Badge kind={status} />
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12
        }}>
          <StatTile label="Status" value={BADGE_THEME[status]?.label || "Not marked"}
                    color={BADGE_THEME[status]?.fg || BVC.MUTED} />
          <StatTile label="Check-In Time"
                    value={today?.CHECK_IN ? formatISTTime(today.CHECK_IN) : "—"}
                    color={today?.CHECK_IN ? "#16a34a" : BVC.MUTED} />
          <StatTile label="Check-Out Time"
                    value={today?.CHECK_OUT ? formatISTTime(today.CHECK_OUT) : "—"}
                    color={today?.CHECK_OUT ? "#dc2626" : BVC.MUTED} />
          <StatTile label="Total Working Hours" value={workingHours} color={BVC.PRIMARY} />
        </div>
      </div>

      {/* ============================================================ */}
      {/* CARD 2 — LIVE GEOFENCE STATUS                                 */}
      {/* ============================================================ */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h3 style={SECTION_LABEL}>📍 Live Geofence Status</h3>
          <Badge kind={geoState} />
        </div>

        {/* Original GeofenceGate banner — shows friendly "Inside/Outside" message */}
        <GeofenceGate
          employeeId={employeeId || null}
          onAllowed={onGpsAllowed}
          onBlocked={onGpsBlocked}
        />

        {/* Structured numeric grid per requirement */}
        <div style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 10
        }}>
          <StatTile label="Your Latitude"
                    value={fmtCoord(gpsCtx?.lat)} mono color={BVC.INK} />
          <StatTile label="Your Longitude"
                    value={fmtCoord(gpsCtx?.lng)} mono color={BVC.INK} />
          <StatTile label="Office Latitude"
                    value={fmtCoord(office?.lat)} mono color={BVC.INK} />
          <StatTile label="Office Longitude"
                    value={fmtCoord(office?.lng)} mono color={BVC.INK} />
          <StatTile label="Distance From Office"
                    value={fmtDistance(gpsCtx?.distance)}
                    color={geoState === "INSIDE" ? "#16a34a" : "#dc2626"} />
          <StatTile label="Allowed Radius"
                    value={office?.radius != null ? `${office.radius} m` : "—"}
                    color={BVC.INK} />
          <StatTile label="GPS Accuracy"
                    value={gpsCtx?.accuracy != null
                      ? `±${Math.round(gpsCtx.accuracy)} m`
                      : "—"}
                    color={BVC.MUTED} />
          <StatTile label="Geofence Status"
                    value={BADGE_THEME[geoState]?.label || geoState}
                    color={BADGE_THEME[geoState]?.fg || BVC.MUTED} />
        </div>

        {geoReason && geoState !== "INSIDE" && (
          <div style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 13,
            color: "#991b1b"
          }}>
            <strong>Why blocked:</strong> {reasonLabel(geoReason)}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* ACTION BUTTONS                                                */}
      {/* ============================================================ */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h3 style={SECTION_LABEL}>✋ Mark My Attendance</h3>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <ActionButton
            label="✓ Check In"
            enabled={canCheckIn}
            onClick={handleCheckIn}
            colorOn="linear-gradient(135deg, #16a34a, #15803d)"
            shadowOn="rgba(22,163,74,0.35)"
            title={!gpsCtx ? "Waiting for GPS — must be inside the office geofence."
                  : isCheckedIn ? "You've already checked in today."
                  : "Check in for today"}
          />
          <ActionButton
            label="→ Check Out"
            enabled={canCheckOut}
            onClick={handleCheckOut}
            colorOn={`linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DARK})`}
            shadowOn="rgba(200,16,46,0.35)"
            title={!gpsCtx ? "Waiting for GPS — must be inside the office geofence."
                  : !isCheckedIn ? "You must check in before you can check out."
                  : isCheckedOut ? "You've already checked out today."
                  : "Check out for today"}
          />
          <ActionButton
            label="✗ Mark Absent"
            enabled={canMarkAbsent}
            onClick={handleMarkAbsent}
            colorOn="linear-gradient(135deg, #d97706, #b45309)"
            shadowOn="rgba(217,119,6,0.35)"
            title={isCheckedIn ? "Can't mark absent — already checked in."
                  : isAbsent ? "You're already marked absent today."
                  : "Mark yourself absent for today"}
          />
        </div>

        {notice && (
          <div style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 8,
            background: notice.type === "ok" ? "#dcfce7" : "#fee2e2",
            color:      notice.type === "ok" ? "#166534" : "#991b1b",
            border: "1px solid " + (notice.type === "ok" ? "#86efac" : "#fca5a5"),
            fontSize: 13,
            fontWeight: 600
          }}>
            {notice.text}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* CARD 3 — LAST ATTENDANCE ATTEMPT                              */}
      {/* ============================================================ */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h3 style={SECTION_LABEL}>🕓 Last Attendance Attempt</h3>
          <Badge kind={lastAttempt ? "BLOCKED" : (isCheckedIn ? "ALLOWED" : "PENDING")} />
        </div>

        {!lastAttempt && !isCheckedIn && (
          <div style={{ color: BVC.MUTED, fontSize: 14, padding: "12px 0" }}>
            No attendance attempts yet today.
          </div>
        )}

        {!lastAttempt && isCheckedIn && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12
          }}>
            <StatTile label="Attempt Time"
                      value={today?.CHECK_IN ? formatISTTime(today.CHECK_IN) : "—"}
                      color={BVC.INK} />
            <StatTile label="Distance"
                      value={today?.DISTANCE_METERS != null
                        ? fmtDistance(today.DISTANCE_METERS) : "—"}
                      color={BVC.INK} />
            <StatTile label="Result" value="Allowed" color="#16a34a" />
            <StatTile label="Failure Reason" value="—" color={BVC.MUTED} />
          </div>
        )}

        {lastAttempt && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12
          }}>
            <StatTile label="Attempt Time"
                      value={fmtAttemptTime(lastAttempt.time)} color={BVC.INK} />
            <StatTile label="Distance"
                      value={fmtDistance(lastAttempt.distance)} color="#dc2626" />
            <StatTile label="Result" value="Blocked" color="#dc2626" />
            <StatTile label="Failure Reason"
                      value={reasonLabel(lastAttempt.reason)} color="#991b1b" />
          </div>
        )}

        {lastAttempt?.detail && (
          <div style={{
            marginTop: 10,
            padding: "10px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 12,
            color: "#7f1d1d",
            lineHeight: 1.5
          }}>
            {lastAttempt.detail}
          </div>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Small private components
// ---------------------------------------------------------------------
function StatTile({ label, value, color, mono }) {
  return (
    <div style={{
      background: "#fafbfc",
      border: "1px solid #e5e7eb",
      borderRadius: 10,
      padding: "10px 14px"
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: 0.7,
        marginBottom: 4
      }}>
        {label}
      </div>
      <div style={{
        fontSize: mono ? 14 : 16,
        fontWeight: 800,
        color: color || "#0f172a",
        lineHeight: 1.25,
        fontFamily: mono
          ? "ui-monospace, SFMono-Regular, Menlo, monospace"
          : "inherit",
        wordBreak: "break-word"
      }}>
        {value}
      </div>
    </div>
  );
}


function ActionButton({ label, enabled, onClick, colorOn, shadowOn, title }) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={title}
      style={{
        flex: "1 1 180px",
        minHeight: 48,
        padding: "12px 18px",
        border: "none",
        borderRadius: 10,
        background: enabled ? colorOn : "#cbd5e1",
        color: "#fff",
        fontSize: 15,
        fontWeight: 700,
        cursor: enabled ? "pointer" : "not-allowed",
        boxShadow: enabled ? `0 4px 14px ${shadowOn}` : "none",
        transition: "0.2s"
      }}
    >
      {label}
    </button>
  );
}
