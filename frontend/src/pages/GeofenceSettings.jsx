// =====================================================================
// Geofence Settings — admin page at /geofence
//
// Configures the office coordinates + allowed radius. The Attendance
// page uses these to gate the biometric / face check-in flow.
// =====================================================================

import { useEffect, useState } from "react";

import API from "../services/api";
import styles from "./GeofenceSettings.module.css";


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
      <div className={styles.loadingText}>
        Loading geofence settings…
      </div>
    );
  }

  return (

    <div className={styles.page}>

      <div className={styles.pageHeader}>
        <div className={styles.pageEyebrow}>Attendance · Admin Settings</div>
        <h1 className={styles.pageTitle}>📍 Geofence Settings</h1>
        <div className={styles.pageDesc}>
          Set the office coordinates and an allowed radius. Employees must be
          inside this radius to mark attendance.
        </div>
      </div>

      {/* ============ Form card ============ */}
      <div className={styles.card}>

        <Row>
          <Field label="Office Name" span={2}>
            <input
              type="text"
              value={form.OFFICE_NAME}
              onChange={set("OFFICE_NAME")}
              placeholder="Head Office"
              className={styles.input}
            />
          </Field>

          <Field label="Enforcement">
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={form.IS_ACTIVE}
                onChange={set("IS_ACTIVE")}
              />
              <span className={form.IS_ACTIVE ? `${styles.enforcementStatus} ${styles.enforcementStatusActive}` : styles.enforcementStatus}>
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
              className={styles.input}
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
              className={styles.input}
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
              className={styles.input}
            />
          </Field>
        </Row>

        <div className={styles.formActions}>
          <button onClick={useCurrentLocation} className={styles.gpsBtn}>
            📍 Use my current GPS location
          </button>
          <a
            href={`https://www.google.com/maps?q=${form.LATITUDE},${form.LONGITUDE}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.gpsBtn}
          >
            🗺 Preview on Google Maps
          </a>
        </div>

        {error && (
          <div className={styles.errorBox}>{error}</div>
        )}

        <div className={styles.formSaveRow}>
          {savedAt && (
            <div className={styles.savedConfirm}>
              ✓ Saved at {savedAt.toLocaleTimeString()}
            </div>
          )}
          <div className={styles.saveRowRight}>
            <button onClick={save} disabled={saving} className={styles.saveBtn}>
              {saving ? "Saving…" : "💾 Save Settings"}
            </button>
          </div>
        </div>
      </div>

      {/* ============ Help card ============ */}
      <div className={styles.infoCard}>
        <div className={styles.infoCardTitle}>How geofencing works</div>
        <ul className={styles.infoCardList}>
          <li>The Attendance page asks the employee's browser for their GPS location</li>
          <li>It calculates the distance from this office using the Haversine formula</li>
          <li>If within <b>{form.RADIUS_METERS}m</b>, the face / biometric scanner is enabled</li>
          <li>Otherwise the attempt is logged below as <b>OUTSIDE_GEOFENCE</b> and blocked</li>
          <li>Every check-in row stores the exact lat/lng + distance for audit</li>
        </ul>
      </div>

      {/* ============ Recent security failures ============ */}
      <div className={styles.card}>
        <div className={styles.secLogHeader}>
          <div className={styles.secLogTitle}>🚨 Recent Security Log (last 10)</div>
          <div className={styles.secLogHeaderRight}>
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
                className={styles.clearBtn}
                title="Delete all visible security log entries"
              >
                🗑 Clear All
              </button>
            )}
            <a href="/attendance" className={styles.viewLink}>
              Full attendance →
            </a>
          </div>
        </div>

        {recent.length === 0 && (
          <div className={styles.logEmpty}>No failed attempts logged yet.</div>
        )}

        {recent.length > 0 && (
          <div className={styles.logList}>
            {recent.map((r) => (
              <div key={r.ID} className={styles.logRow}>
                <div className={styles.logLeft}>
                  <div className={styles.logName}>
                    {r.EMPLOYEE_NAME || r.EMPLOYEE_ID || "Anonymous"}
                    {r.EMPLOYEE_CODE && (
                      <span className={styles.logCode}>{r.EMPLOYEE_CODE}</span>
                    )}
                  </div>
                  <div className={styles.logMeta}>
                    {fmtIST(r.CREATED_AT)}
                    {r.IP_ADDRESS && <span> · IP {r.IP_ADDRESS}</span>}
                  </div>
                </div>
                <div className={styles.logRight}>
                  <div>
                    <ReasonPill reason={r.REASON} />
                    {r.DISTANCE != null && (
                      <div className={styles.logDistance}>
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
                    className={styles.iconDangerBtn}
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
    <div className={styles.geofenceRow}>
      {children}
    </div>
  );
}


function Field({ label, span, children }) {

  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label className={styles.fieldLabel}>
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
    <span className={styles.reasonPill} style={{ background: theme.bg, color: theme.fg }}>
      {reason?.replace(/_/g, " ") || "—"}
    </span>
  );
}
