// =====================================================================
// Geofence Settings — admin page at /geofence
//
// Configures the office coordinates + allowed radius. The Attendance
// page uses these to gate the biometric / face check-in flow.
// =====================================================================

import { useEffect, useState } from "react";

import API from "../services/api";


const DEFAULT_LAT = 11.04105;

const DEFAULT_LNG = 77.03944;

const DEFAULT_RADIUS = 100;


// Backend stores CREATED_AT via datetime.utcnow() — a NAIVE datetime
// without timezone info. ISO string comes out like "2026-06-05T05:05:44"
// (no trailing Z). JavaScript's Date() then treats it as LOCAL time,
// causing the 5.5-hour IST drift we saw. Fix: explicitly tag it as UTC
// (append Z) and format in Asia/Kolkata.
function fmtIST(iso) {

  if (!iso) return "";

  const isUtcTagged = iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso);

  const utc = isUtcTagged ? iso : iso + "Z";

  try {

    return new Date(utc).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });

  } catch {

    return iso;
  }
}


export default function GeofenceSettings() {

  const [form, setForm] = useState({
    OFFICE_NAME: "Head Office",
    LATITUDE: DEFAULT_LAT,
    LONGITUDE: DEFAULT_LNG,
    RADIUS_METERS: DEFAULT_RADIUS,
    IS_ACTIVE: true,
    VENDOR_ID: 1
  });

  const [loading,  setLoading]  = useState(true);

  const [saving,   setSaving]   = useState(false);

  const [savedAt,  setSavedAt]  = useState(null);

  const [error,    setError]    = useState("");

  const [recent,   setRecent]   = useState([]);

  // ---- Load current settings + recent security failures ----------
  useEffect(() => {

    Promise.all([
      API.get("/geofence/settings"),
      API.get("/geofence/security-logs?limit=10")
    ])
      .then(([s, logs]) => {

        const d = s.data || {};

        setForm({
          OFFICE_NAME:   d.OFFICE_NAME || "Head Office",
          LATITUDE:      d.LATITUDE ?? DEFAULT_LAT,
          LONGITUDE:     d.LONGITUDE ?? DEFAULT_LNG,
          RADIUS_METERS: d.RADIUS_METERS ?? DEFAULT_RADIUS,
          IS_ACTIVE:     d.IS_ACTIVE !== false,
          VENDOR_ID:     d.VENDOR_ID ?? 1
        });

        setRecent(logs.data || []);

      })
      .catch((e) =>
        setError(e?.response?.data?.detail || "Failed to load settings")
      )
      .finally(() => setLoading(false));

  }, []);

  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: e.target.type === "checkbox"
      ? e.target.checked
      : e.target.value
  }));

  // ---- Use current GPS to autofill office coordinates ------------
  const useCurrentLocation = () => {

    setError("");

    if (!navigator.geolocation) {

      setError("This browser doesn't support GPS.");

      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {

        setForm((f) => ({
          ...f,
          LATITUDE:  pos.coords.latitude,
          LONGITUDE: pos.coords.longitude
        }));

      },
      (err) => {

        const msg = ({
          1: "GPS permission denied — allow location access in your browser.",
          2: "Position unavailable — turn on GPS / move near a window.",
          3: "Timed out asking for your location — try again."
        })[err.code] || `GPS error: ${err.message}`;

        setError(msg);

      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ---- Save ------------------------------------------------------
  const save = async () => {

    setSaving(true);

    setError("");

    try {

      await API.put("/geofence/settings", {
        OFFICE_NAME:   form.OFFICE_NAME || "Head Office",
        LATITUDE:      Number(form.LATITUDE),
        LONGITUDE:     Number(form.LONGITUDE),
        RADIUS_METERS: Number(form.RADIUS_METERS) || DEFAULT_RADIUS,
        IS_ACTIVE:     !!form.IS_ACTIVE,
        VENDOR_ID:     form.VENDOR_ID || 1
      });

      setSavedAt(new Date());

    } catch (e) {

      setError(e?.response?.data?.detail || "Save failed");

    } finally {

      setSaving(false);
    }
  };

  if (loading) {

    return (
      <div style={{ padding: 40, color: "#64748b" }}>
        Loading geofence settings…
      </div>
    );
  }

  return (

    <div style={{ padding: 28, maxWidth: 980, margin: "0 auto" }}>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: "#64748b", textTransform: "uppercase" }}>
          Attendance · Admin Settings
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: "6px 0 6px" }}>
          📍 Geofence Settings
        </h1>
        <div style={{ color: "#475569", fontSize: 14 }}>
          Set the office coordinates and an allowed radius. Employees must be
          inside this radius to mark attendance.
        </div>
      </div>

      {/* ============ Form card ============ */}
      <div style={cardStyle()}>

        <Row>
          <Field label="Office Name" span={2}>
            <input
              type="text"
              value={form.OFFICE_NAME}
              onChange={set("OFFICE_NAME")}
              placeholder="Head Office"
              style={inputStyle()}
            />
          </Field>

          <Field label="Enforcement">
            <label style={toggleLabel}>
              <input
                type="checkbox"
                checked={form.IS_ACTIVE}
                onChange={set("IS_ACTIVE")}
              />
              <span style={{ fontWeight: 700, color: form.IS_ACTIVE ? "#10b981" : "#94a3b8" }}>
                {form.IS_ACTIVE ? "✓ Active — block out-of-fence" : "Off — allow from anywhere"}
              </span>
            </label>
          </Field>
        </Row>

        <Row>
          <Field label="Latitude">
            <input
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              value={form.LATITUDE}
              onChange={set("LATITUDE")}
              style={inputStyle()}
            />
          </Field>

          <Field label="Longitude">
            <input
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              value={form.LONGITUDE}
              onChange={set("LONGITUDE")}
              style={inputStyle()}
            />
          </Field>

          <Field label="Radius (meters)">
            <input
              type="number"
              min={10}
              max={10000}
              step={10}
              value={form.RADIUS_METERS}
              onChange={set("RADIUS_METERS")}
              style={inputStyle()}
            />
          </Field>
        </Row>

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={useCurrentLocation} style={btnGhost}>
            📍 Use my current GPS location
          </button>
          <a
            href={`https://www.google.com/maps?q=${form.LATITUDE},${form.LONGITUDE}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            🗺 Preview on Google Maps
          </a>
        </div>

        {error && (
          <div style={errorBox}>{error}</div>
        )}

        <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {savedAt && (
            <div style={{ fontSize: 12, color: "#10b981", fontWeight: 700 }}>
              ✓ Saved at {savedAt.toLocaleTimeString()}
            </div>
          )}
          <div style={{ marginLeft: "auto" }}>
            <button onClick={save} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "💾 Save Settings"}
            </button>
          </div>
        </div>
      </div>

      {/* ============ Help card ============ */}
      <div style={{ ...cardStyle(), background: "#eff6ff", border: "1px solid #bfdbfe" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#1e40af", marginBottom: 8 }}>
          How geofencing works
        </div>
        <ul style={{ margin: 0, paddingLeft: 22, fontSize: 13, color: "#1e3a8a", lineHeight: 1.7 }}>
          <li>The Attendance page asks the employee's browser for their GPS location</li>
          <li>It calculates the distance from this office using the Haversine formula</li>
          <li>If within <b>{form.RADIUS_METERS}m</b>, the face / biometric scanner is enabled</li>
          <li>Otherwise the attempt is logged below as <b>OUTSIDE_GEOFENCE</b> and blocked</li>
          <li>Every check-in row stores the exact lat/lng + distance for audit</li>
        </ul>
      </div>

      {/* ============ Recent security failures ============ */}
      <div style={cardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", letterSpacing: 0.4 }}>
            🚨 Recent Security Log (last 10)
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {recent.length > 0 && (
              <button
                onClick={async () => {
                  if (!window.confirm(
                    `Delete ALL ${recent.length} security log entries currently shown?\n\n` +
                    `This permanently removes the audit trail of failed attendance attempts. ` +
                    `Only do this if you've reviewed and resolved them.`
                  )) return;
                  try {
                    await API.delete("/geofence/security-logs?confirm=true");
                    setRecent([]);
                  } catch (e) {
                    setError(e?.response?.data?.detail || "Bulk delete failed");
                  }
                }}
                style={btnDangerSm}
                title="Delete all visible security log entries"
              >
                🗑 Clear All
              </button>
            )}
            <a href="/attendance" style={{ fontSize: 12, color: "#6366f1", textDecoration: "none" }}>
              Full attendance →
            </a>
          </div>
        </div>

        {recent.length === 0 && (
          <div style={{ padding: 24, color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
            No failed attempts logged yet.
          </div>
        )}

        {recent.length > 0 && (

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recent.map((r) => (
              <div key={r.ID} style={logRow}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                    {r.EMPLOYEE_NAME || r.EMPLOYEE_ID || "Anonymous"}
                    {r.EMPLOYEE_CODE && (
                      <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                        {r.EMPLOYEE_CODE}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {fmtIST(r.CREATED_AT)}
                    {r.IP_ADDRESS && <span> · IP {r.IP_ADDRESS}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 10 }}>
                  <div>
                    <ReasonPill reason={r.REASON} />
                    {r.DISTANCE != null && (
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                        {Math.round(r.DISTANCE)}m away
                      </div>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.confirm(
                        `Delete this security log entry?\n\n` +
                        `${r.EMPLOYEE_NAME || "Anonymous"} · ${r.REASON} · ${fmtIST(r.CREATED_AT)}`
                      )) return;
                      try {
                        await API.delete(`/geofence/security-logs/${r.ID}`);
                        setRecent((prev) => prev.filter((x) => x.ID !== r.ID));
                      } catch (e) {
                        setError(e?.response?.data?.detail || "Delete failed");
                      }
                    }}
                    title="Delete this entry"
                    style={iconBtnDanger}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ---- Sub-components --------------------------------------------------

function Row({ children }) {

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 14,
      marginBottom: 14
    }}>
      {children}
    </div>
  );
}


function Field({ label, span, children }) {

  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4, letterSpacing: 0.3, textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
    </div>
  );
}


function ReasonPill({ reason }) {

  const theme = {
    OUTSIDE_GEOFENCE:   { bg: "#fef3c7", fg: "#854d0e" },
    GPS_DISABLED:       { bg: "#fee2e2", fg: "#991b1b" },
    PERMISSION_DENIED:  { bg: "#fee2e2", fg: "#991b1b" },
    LOCATION_TIMEOUT:   { bg: "#fef3c7", fg: "#854d0e" },
    INVALID_COORDS:     { bg: "#fef3c7", fg: "#854d0e" },
    FACE_FAILED:        { bg: "#fee2e2", fg: "#991b1b" }
  }[reason] || { bg: "#f1f5f9", fg: "#475569" };

  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.6,
      background: theme.bg,
      color: theme.fg
    }}>
      {reason?.replace(/_/g, " ") || "—"}
    </span>
  );
}


// ---- Styles ---------------------------------------------------------

function cardStyle() {
  return {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 22,
    marginBottom: 18,
    boxShadow: "0 4px 14px rgba(15,23,42,0.04)"
  };
}


function inputStyle() {
  return {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box"
  };
}


const toggleLabel = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 0",
  cursor: "pointer",
  fontSize: 13
};


const btnPrimary = {
  background: "linear-gradient(135deg, #C8102E 0%, #8B0B1F 100%)",
  color: "white",
  border: "none",
  padding: "10px 22px",
  borderRadius: 10,
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
  letterSpacing: 0.3,
  boxShadow: "0 6px 16px rgba(200,16,46,0.30)"
};


const btnGhost = {
  background: "white",
  color: "#475569",
  border: "1px solid #cbd5e1",
  padding: "8px 14px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer"
};


const errorBox = {
  marginTop: 14,
  padding: "10px 14px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 8,
  color: "#991b1b",
  fontSize: 13
};


const btnDangerSm = {
  background: "white",
  color: "#dc2626",
  border: "1px solid #fecaca",
  padding: "5px 12px",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 11,
  cursor: "pointer",
  letterSpacing: 0.3
};

const iconBtnDanger = {
  background: "white",
  color: "#dc2626",
  border: "1px solid #fecaca",
  width: 32, height: 32,
  borderRadius: 6,
  fontSize: 14,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center"
};

const logRow = {
  display: "flex",
  alignItems: "center",
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  gap: 12,
  background: "white"
};
