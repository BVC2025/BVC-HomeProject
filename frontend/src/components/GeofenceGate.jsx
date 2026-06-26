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
import styles from "./GeofenceGate.module.css";


export default function GeofenceGate({
  employeeId = null,
  onAllowed = () => { },
  onBlocked = () => { },
  autoRefreshMs = 0,
  compact = false,    // Render a single-line status pill instead of the big card
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

    // ---- Accuracy gate ---------------------------------------------
    // Real GPS / Wi-Fi positioning is accurate to 5-100m. An accuracy
    // reading worse than 500m almost always means the browser fell back
    // to IP-geolocation — which places the device anywhere in a city-wide
    // circle. Letting that through would block legit at-office users
    // because the "you are here" guess is kilometres off. Block it
    // explicitly with a clear message instead.
    const MAX_TRUSTED_ACCURACY_METERS = 500;

    if (Number.isFinite(accuracy) && accuracy > MAX_TRUSTED_ACCURACY_METERS) {

      setPhase("low_accuracy");

      reportFailure(
        "LOW_GPS_ACCURACY", lat, lng, null,
        `accuracy=${Math.round(accuracy)}m (threshold ${MAX_TRUSTED_ACCURACY_METERS}m)`
      );

      onBlocked("LOW_GPS_ACCURACY");

      return;
    }

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
          GPS_DISABLED: "unavailable",
          LOCATION_TIMEOUT: "timeout"
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

  // ---- Admin / dev escape hatch (moved up so compact-mode render can
  //      reference it before any phase-based return) ----
  function skipGps() {
    setPhase("skipped");
    onAllowed({
      lat: Number.isFinite(coords?.lat) ? coords.lat : null,
      lng: Number.isFinite(coords?.lng) ? coords.lng : null,
      accuracy: coords?.accuracy ?? null,
      distance: null,
      deviceInfo,
      gpsSkipped: true,
    });
  }

  // ---- Render -----------------------------------------------------

  // Compact mode: render a single-line status pill regardless of phase.
  // Same callbacks still fire — only the visual is condensed.
  if (compact) {
    return (
      <CompactBar
        phase={phase}
        coords={coords}
        serverInfo={serverInfo}
        errorMsg={errorMsg}
        onSkip={skipGps}
        onRetry={requestLocation}
      />
    );
  }

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
          <a href="/geofence" className={styles.gpsLink}>Geofence Settings</a>.
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

  // (skipGps was moved up before the render block — see above.)

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
            <li>Open a new tab → <code className={styles.kbd}>chrome://settings/content/location</code></li>
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

  if (phase === "low_accuracy") {

    const acc = coords?.accuracy
      ? Math.round(coords.accuracy)
      : null;

    return (

      <Card border="#fde68a" bg="#fffbeb">
        <Title color="#854d0e">⚠ GPS reading is too imprecise</Title>
        <Body>
          The browser returned a location accurate to <b>±{acc ? acc.toLocaleString() : "?"}m</b>{" "}
          — that's not a real GPS fix, it's an IP-based guess that can
          be tens of kilometres off. Even if you're sitting at the office,
          the geofence check would fail because we can't trust this reading.
          <br /><br />
          <b>Fixes that usually work:</b>
          <ol style={{ margin: "6px 0 0 18px", padding: 0, lineHeight: 1.6 }}>
            <li>Open this page on your <b>mobile phone</b> with Location ON
              — phones have real GPS chips and Wi-Fi positioning.</li>
            <li>If you're on a desktop, connect to <b>office Wi-Fi</b> so
              Windows can use Wi-Fi triangulation instead of IP.</li>
            <li>Check Windows&nbsp;Settings → Privacy → Location is ON,
              AND your browser is allowed.</li>
            <li>Worst case: ask an admin to mark your attendance from
              the Live Floor Board.</li>
          </ol>
        </Body>
        <ActionRow>
          <SkipBtn onClick={skipGps}>✓ Skip GPS — mark attendance anyway</SkipBtn>
          <Retry onClick={requestLocation} label="🔄 Retry GPS" inline />
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
  return <div className={styles.actionRow}>{children}</div>;
}

function SkipBtn({ onClick, children }) {
  return <button onClick={onClick} className={styles.skipBtn}>{children}</button>;
}

// ---- Sub-components --------------------------------------------------

function Card({ border, bg, children }) {
  return (
    <div className={styles.card} style={{ border: `1px solid ${border}`, background: bg }}>
      {children}
    </div>
  );
}

function Title({ color = "var(--text-primary)", children }) {
  return (
    <div className={styles.title} style={{ color }}>
      {children}
    </div>
  );
}

function Body({ children }) {
  return <div className={styles.body}>{children}</div>;
}

function Coords({ coords }) {
  if (!coords) return null;
  return (
    <div className={styles.coords}>
      {coords.lat?.toFixed(6)}, {coords.lng?.toFixed(6)}
      {coords.accuracy && <span> · ±{Math.round(coords.accuracy)}m accuracy</span>}
    </div>
  );
}

function Retry({ onClick, label, inline = false }) {
  const btn = (
    <button onClick={onClick} className={styles.retryBtn}>🔄 {label}</button>
  );
  if (inline) return btn;
  return <div className={styles.retryWrap}>{btn}</div>;
}


// =====================================================================
// CompactBar — one-line status pill used when GeofenceGate is mounted
// with compact={true}. Same callbacks fire; only the UI is condensed
// so it doesn't dominate the page like the full-card variant.
// =====================================================================
function CompactBar({ phase, coords, serverInfo, errorMsg, onSkip, onRetry }) {

  // Map each phase to a single-line meta object: dot colour + label + sub
  const meta = (() => {
    const acc = coords?.accuracy ? Math.round(coords.accuracy) : null;
    switch (phase) {
      case "loading":
        return { color: "#94a3b8", label: "Checking location…", sub: "Please allow GPS access if prompted." };
      case "inside":
        return {
          color: "#16a34a", label: "Verified — inside office",
          sub: serverInfo?.distance_meters != null
            ? `${Math.round(serverInfo.distance_meters)}m from centre` : null
        };
      case "outside":
        return {
          color: "#dc2626", label: "Outside office boundary",
          sub: serverInfo?.distance_meters != null
            ? `${Math.round(serverInfo.distance_meters)}m away` : null
        };
      case "bypassed":
      case "skipped":
        return { color: "#7c3aed", label: "GPS skipped — manual override active", sub: null };
      case "denied":
        return {
          color: "#dc2626", label: "Location permission denied",
          sub: "Enable it in browser settings to verify presence."
        };
      case "unavailable":
        return {
          color: "#dc2626", label: "GPS unavailable",
          sub: "Windows Location may be turned off."
        };
      case "low_accuracy":
        return {
          color: "#d97706", label: `GPS imprecise${acc ? ` (±${acc.toLocaleString()}m)` : ""}`,
          sub: "Use phone, or click Skip to mark anyway."
        };
      case "timeout":
        return {
          color: "#d97706", label: "GPS timed out",
          sub: "Try Retry, or click Skip to mark anyway."
        };
      case "error":
        return {
          color: "#dc2626", label: "GPS error",
          sub: errorMsg || "Couldn't read location."
        };
      default:
        return { color: "#94a3b8", label: phase || "Pending", sub: null };
    }
  })();

  const passed = phase === "inside" || phase === "bypassed" || phase === "skipped";
  const canSkip = !passed;
  const canRetry = phase !== "loading" && phase !== "inside";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "white", border: "1px solid #e2e8f0",
      borderRadius: 10, padding: "10px 14px", margin: "10px 0 12px 0",
      flexWrap: "wrap",
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: "50%",
        background: meta.color, flexShrink: 0,
        boxShadow: `0 0 0 3px ${meta.color}33`,
      }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
        {meta.label}
      </span>
      {meta.sub && (
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {meta.sub}
        </span>
      )}
      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        {canRetry && (
          <button onClick={onRetry} style={{
            padding: "5px 10px", background: "white", color: "#475569",
            border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 11,
            fontWeight: 700, cursor: "pointer",
          }}>↻ Retry</button>
        )}
        {canSkip && (
          <button onClick={onSkip} style={{
            padding: "5px 10px", background: "#fef3c7", color: "#92400e",
            border: "1px solid #fde68a", borderRadius: 6, fontSize: 11,
            fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
          }}>Skip GPS</button>
        )}
      </div>
    </div>
  );
}

