// =====================================================================
// GeofenceGate — reusable widget the Attendance pages render BEFORE
// they enable the actual check-in / biometric / face-scan UI.
//
// Flow:
//   1. mounts → asks the browser for GPS (navigator.geolocation)
//   2. on success → POSTs lat/lng to /geofence/validate
//   3. shows a green "inside" or red "outside" status card
//   4. calls onAllowed({lat, lng, distance}) when inside → parent
//      enables the scanner / Check-In button
//   5. logs every failure (denied / outside / timeout) to
//      /geofence/log-failure for the security feed
//
// Props:
//   employeeId    string|null   — for the security log (optional)
//   onAllowed     (gpsCtx) => void   — fires once when inside fence
//   onBlocked     (reason)   => void — fires on any failure / outside
//   autoRefreshMs number           — re-poll GPS this often (default 0 = once)
// =====================================================================

import { useEffect, useRef, useState } from "react";

import API from "../services/api";


export default function GeofenceGate({
  employeeId = null,
  onAllowed = () => {},
  onBlocked = () => {},
  autoRefreshMs = 0
}) {

  const [phase, setPhase] = useState("loading");
  // loading | denied | timeout | unavailable | outside | inside | error

  const [coords, setCoords] = useState(null);

  const [serverInfo, setServerInfo] = useState(null);
  // { allowed, distance_meters, radius_meters, office_name, message }

  const [errorMsg, setErrorMsg] = useState("");

  const reportedRef = useRef(false);

  // Capture device info once for the security log
  const deviceInfo = (() => {

    if (typeof navigator === "undefined") return "";

    return [
      navigator.platform,
      navigator.userAgent?.match(/Chrome|Firefox|Safari|Edg|Opera|Brave/)?.[0] || "browser"
    ].filter(Boolean).join(" · ").slice(0, 255);
  })();

  const reportFailure = async (reason, lat, lng, distance, detail) => {

    if (reportedRef.current) return;

    reportedRef.current = true;

    try {

      await API.post("/geofence/log-failure", {
        EMPLOYEE_ID: employeeId || null,
        LATITUDE: lat ?? null,
        LONGITUDE: lng ?? null,
        DISTANCE: distance ?? null,
        REASON: reason,
        DETAIL: detail || null,
        DEVICE_INFO: deviceInfo,
        VENDOR_ID: 1
      });

    } catch { /* non-fatal — never block UI for logging */ }
  };

  // ---- Validate-and-resolve helper ----------------------------------
  // Runs the /geofence/validate call with the lat/lng read from
  // navigator.geolocation and drives the gate's phase state.
  const runValidation = async (lat, lng, accuracy) => {

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {

      setPhase("error");
      setErrorMsg("Invalid coordinates.");
      reportFailure("INVALID_COORDS", lat, lng, null, `lat=${lat} lng=${lng}`);
      onBlocked("INVALID_COORDS");

      return;
    }

    setCoords({ lat, lng, accuracy });

    try {

      const r = await API.post("/geofence/validate", {
        LATITUDE: lat, LONGITUDE: lng, VENDOR_ID: 1
      });

      setServerInfo(r.data);

      if (r.data?.allowed) {

        setPhase("inside");

        onAllowed({
          lat, lng, accuracy,
          distance: r.data.distance_meters,
          deviceInfo
        });

      } else {

        setPhase("outside");

        reportFailure(
          "OUTSIDE_GEOFENCE", lat, lng,
          r.data?.distance_meters,
          r.data?.message
        );

        onBlocked("OUTSIDE_GEOFENCE");
      }

    } catch (e) {

      setPhase("error");
      setErrorMsg(
        e?.response?.data?.detail ||
        "Server validation failed — try again."
      );

      onBlocked("SERVER_ERROR");
    }
  };

  const requestLocation = () => {

    reportedRef.current = false;

    setPhase("loading");

    setErrorMsg("");

    // One-time cleanup: if a previous build of this app left dev-mode
    // localStorage keys behind, remove them so they never leak into the
    // production GPS flow. Safe to delete this block after a few weeks.
    try {

      if (typeof localStorage !== "undefined") {

        localStorage.removeItem("geofence_test_mode");

        localStorage.removeItem("geofence_test_lat");

        localStorage.removeItem("geofence_test_lng");
      }

    } catch { /* incognito / disabled storage — ignore */ }

    if (typeof navigator === "undefined" || !navigator.geolocation) {

      setPhase("unavailable");

      reportFailure("GPS_DISABLED", null, null, null,
        "navigator.geolocation not available");

      onBlocked("GPS_DISABLED");

      return;
    }

    navigator.geolocation.getCurrentPosition(

      async (pos) => {

        await runValidation(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy
        );
      },

      (err) => {

        const reasonMap = {
          1: "PERMISSION_DENIED",
          2: "GPS_DISABLED",
          3: "LOCATION_TIMEOUT"
        };

        const reason = reasonMap[err.code] || "GPS_ERROR";

        setPhase(({
          PERMISSION_DENIED: "denied",
          GPS_DISABLED:      "unavailable",
          LOCATION_TIMEOUT:  "timeout"
        })[reason] || "error");

        setErrorMsg(err.message || "Couldn't get your location.");

        reportFailure(reason, null, null, null, err.message);

        onBlocked(reason);
      },

      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  };

  // Run once on mount + optional re-poll
  useEffect(() => {

    // First, check if geofence enforcement is even ACTIVE. If the admin
    // has flipped the master switch off, we skip the GPS step entirely
    // and let the parent enable check-in from anywhere. Otherwise we
    // proceed with the normal GPS request.
    API.get("/geofence/settings")
      .then((r) => {

        const cfg = r.data || {};

        if (!cfg.IS_ACTIVE) {

          // Enforcement OFF — bypass GPS entirely
          setServerInfo({
            allowed: true,
            distance_meters: null,
            radius_meters: cfg.RADIUS_METERS || 100,
            office_name: cfg.OFFICE_NAME || "Head Office",
            enforcement_active: false,
            message: "Geofence enforcement is disabled by admin — check-in allowed from anywhere."
          });

          setPhase("bypassed");

          onAllowed({
            lat: null, lng: null, accuracy: null,
            distance: null, deviceInfo
          });

          return;
        }

        // Enforcement ON — run the full GPS dance
        requestLocation();
      })
      .catch(() => {

        // Settings endpoint unreachable — fall through to GPS so we
        // never silently leave the user with disabled buttons.
        requestLocation();
      });

    if (autoRefreshMs > 0) {

      const t = setInterval(requestLocation, autoRefreshMs);

      return () => clearInterval(t);
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Render -----------------------------------------------------

  if (phase === "loading") {

    return (

      <Card border="#cbd5e1" bg="#f8fafc">
        <Title>📡 Checking your location…</Title>
        <Body>Asking your browser for GPS permission. If a prompt
          appears, click <b>Allow</b> so we can verify you're at the office.</Body>
      </Card>
    );
  }

  if (phase === "bypassed") {

    return (

      <Card border="#cbd5e1" bg="#f8fafc">
        <Title color="#475569">⚠ Geofence Enforcement Off</Title>
        <Body>
          The admin has turned <b>OFF</b> geofence enforcement at{" "}
          <a href="/geofence" style={{ color: "#6366f1" }}>Geofence Settings</a>.
          Check-in / Check-out are allowed from anywhere. Re-enable
          enforcement when you're ready for production.
        </Body>
      </Card>
    );
  }

  if (phase === "inside") {

    return (

      <Card border="#a7f3d0" bg="#ecfdf5">
        <Title color="#065f46">✓ Inside Office Geofence</Title>
        <Body>
          You're <b>{Math.round(serverInfo?.distance_meters || 0)}m</b> from{" "}
          <b>{serverInfo?.office_name || "the office"}</b> — well within the{" "}
          <b>{serverInfo?.radius_meters}m</b> radius. Attendance scanner enabled below.
        </Body>
        <Coords coords={coords} />
        <Retry onClick={requestLocation} label="Refresh location" />
      </Card>
    );
  }

  if (phase === "outside") {

    return (

      <Card border="#fecaca" bg="#fef2f2">
        <Title color="#991b1b">🚫 Outside Office Geofence</Title>
        <Body>
          You're <b>{Math.round(serverInfo?.distance_meters || 0)}m</b> from{" "}
          <b>{serverInfo?.office_name || "the office"}</b>. The allowed radius
          is <b>{serverInfo?.radius_meters}m</b>. Attendance is blocked until
          you move closer.
        </Body>
        <Coords coords={coords} />
        <Retry onClick={requestLocation} label="I've moved — re-check" />
      </Card>
    );
  }

  // ---- Admin / dev escape hatch ----
  // When GPS is denied / unavailable / times out, render a "Mark
  // attendance anyway" button. Clicking it calls onAllowed() with
  // null coords. The backend already accepts null lat/lng (we kept
  // it back-compat) so the check-in succeeds with GEOFENCE_STATUS =
  // UNKNOWN. This unblocks anyone on a locked Windows machine while
  // still letting the audit trail see that GPS couldn't be read.
  const skipGps = () => {

    setPhase("skipped");

    onAllowed({
      lat: null, lng: null, accuracy: null,
      distance: null, deviceInfo
    });
  };

  if (phase === "skipped") {

    return (

      <Card border="#fde68a" bg="#fffbeb">
        <Title color="#854d0e">⚠ GPS Skipped — check-in enabled</Title>
        <Body>
          You bypassed the GPS check. Attendance will be marked with{" "}
          <b>GEOFENCE_STATUS = UNKNOWN</b>. Use this only for testing
          or when GPS is locked on your device.
        </Body>
        <Retry onClick={requestLocation} label="🔄 Try GPS again" />
      </Card>
    );
  }

  if (phase === "denied") {

    return (

      <Card border="#fecaca" bg="#fef2f2">
        <Title color="#991b1b">🔒 GPS Permission Denied</Title>
        <Body>
          Your browser is blocking location access. To enable GPS:
          <ol style={{ marginTop: 8, paddingLeft: 20 }}>
            <li>Open a new tab → <code style={kbd}>chrome://settings/content/location</code></li>
            <li>Find <b>localhost:5173</b> under "Not allowed" → click 🗑</li>
            <li>Come back to this tab and reload</li>
          </ol>
          <div style={{ marginTop: 10 }}>
            <b>Or just click below to skip GPS and mark attendance anyway:</b>
          </div>
        </Body>
        <ActionRow>
          <SkipBtn onClick={skipGps}>✓ Skip GPS — mark attendance anyway</SkipBtn>
          <Retry onClick={requestLocation} label="Try GPS again" inline />
        </ActionRow>
      </Card>
    );
  }

  if (phase === "unavailable") {

    return (

      <Card border="#fecaca" bg="#fef2f2">
        <Title color="#991b1b">📵 GPS Unavailable</Title>
        <Body>
          {errorMsg || "Your device or browser can't provide a GPS reading right now."}
          {" "}This usually happens when Windows Location Services are
          turned off (often admin-managed on work PCs).
        </Body>
        <ActionRow>
          <SkipBtn onClick={skipGps}>✓ Skip GPS — mark attendance anyway</SkipBtn>
          <Retry onClick={requestLocation} label="Retry" inline />
        </ActionRow>
      </Card>
    );
  }

  if (phase === "timeout") {

    return (

      <Card border="#fde68a" bg="#fffbeb">
        <Title color="#854d0e">⏱ Location Timed Out</Title>
        <Body>
          The browser took too long to find your location.
          Move near a window if you're indoors, then retry — or
          skip GPS and mark attendance anyway.
        </Body>
        <ActionRow>
          <SkipBtn onClick={skipGps}>✓ Skip GPS — mark attendance anyway</SkipBtn>
          <Retry onClick={requestLocation} label="Retry" inline />
        </ActionRow>
      </Card>
    );
  }

  return (

    <Card border="#fecaca" bg="#fef2f2">
      <Title color="#991b1b">⚠ Location Check Failed</Title>
      <Body>{errorMsg || "Something went wrong reading your location."}</Body>
      <ActionRow>
        <SkipBtn onClick={skipGps}>✓ Skip GPS — mark attendance anyway</SkipBtn>
        <Retry onClick={requestLocation} label="Retry" inline />
      </ActionRow>
    </Card>
  );
}


// ---- Action button row + skip button helpers ----

function ActionRow({ children }) {

  return (
    <div style={{
      marginTop: 12,
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center"
    }}>
      {children}
    </div>
  );
}


function SkipBtn({ onClick, children }) {

  return (
    <button
      onClick={onClick}
      style={{
        background: "linear-gradient(135deg, #f59e0b, #d97706)",
        color: "white",
        border: "none",
        padding: "10px 18px",
        borderRadius: 8,
        fontWeight: 800,
        fontSize: 13,
        cursor: "pointer",
        letterSpacing: 0.3,
        boxShadow: "0 4px 12px rgba(245,158,11,0.30)"
      }}
    >
      {children}
    </button>
  );
}


const kbd = {
  background: "#1e293b",
  color: "#e2e8f0",
  padding: "2px 6px",
  borderRadius: 4,
  fontFamily: "ui-monospace, monospace",
  fontSize: 11
};


// ---- Sub-components --------------------------------------------------

function Card({ border, bg, children }) {

  return (
    <div style={{
      border: `1px solid ${border}`,
      background: bg,
      borderRadius: 12,
      padding: "16px 20px",
      marginBottom: 16,
      boxShadow: "0 4px 14px rgba(15,23,42,0.04)"
    }}>
      {children}
    </div>
  );
}


function Title({ color = "#0f172a", children }) {

  return (
    <div style={{ fontSize: 15, fontWeight: 800, color, marginBottom: 6 }}>
      {children}
    </div>
  );
}


function Body({ children }) {

  return (
    <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
      {children}
    </div>
  );
}


function Coords({ coords }) {

  if (!coords) return null;

  return (
    <div style={{
      marginTop: 8,
      fontSize: 11,
      color: "#94a3b8",
      fontFamily: "ui-monospace, monospace"
    }}>
      {coords.lat?.toFixed(6)}, {coords.lng?.toFixed(6)}
      {coords.accuracy && <span> · ±{Math.round(coords.accuracy)}m accuracy</span>}
    </div>
  );
}


function Retry({ onClick, label, inline = false }) {

  const btn = (

    <button
      onClick={onClick}
      style={{
        background: "white",
        border: "1px solid #cbd5e1",
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        color: "#475569",
        cursor: "pointer"
      }}
    >
      🔄 {label}
    </button>
  );

  if (inline) return btn;

  return (
    <div style={{ marginTop: 12 }}>
      {btn}
    </div>
  );
}
