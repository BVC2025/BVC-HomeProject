/*
 * MyAttendancePanel — Employee attendance widget (redesigned).
 *
 * Deliberately minimal: shows only what the employee needs to see:
 *   • Today's check-in / check-out / working hours / status
 *   • A single primary action (Check In or Check Out)
 *   • Recent attendance history (last 30 days)
 *
 * Employees do NOT see:
 *   • GPS coordinates
 *   • Distance from office
 *   • Geofence radius / office coords
 *   • Failed-attempt logs
 *   • Any admin-facing tracking metadata
 *
 * The GPS layer still runs (silently) so auto-check-in can succeed
 * when the employee is within 50 m of the office. Failures — GPS
 * denied, outside radius, timeout — surface as a gentle
 * "Check-in unavailable — try again later" and NEVER expose why.
 *
 * All admin tracking still happens server-side via the existing
 * attendance_security_logs and geofence status columns. This
 * component just doesn't render them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import API from "../services/api";
import { formatISTTime } from "../utils/time";
import styles from "./MyAttendancePanel.module.css";


// ---------- Small helpers ----------

const STATUS_THEME = {
  PRESENT:    { bg: "#dcfce7", fg: "#166534", label: "Present" },
  LATE:       { bg: "#fef3c7", fg: "#92400e", label: "Late" },
  ABSENT:     { bg: "#fee2e2", fg: "#991b1b", label: "Absent" },
  EARLY_EXIT: { bg: "#fed7aa", fg: "#9a3412", label: "Early exit" },
  ON_TIME:    { bg: "#dcfce7", fg: "#166534", label: "On time" },
};

function Badge({ status }) {
  const theme = STATUS_THEME[(status || "").toUpperCase()] || {
    bg: "#f1f5f9", fg: "#475569", label: status || "Not marked",
  };
  return (
    <span
      className={styles.badge}
      style={{ background: theme.bg, color: theme.fg }}
    >
      <span className={styles.badgeDot} style={{ background: theme.fg }} />
      {theme.label}
    </span>
  );
}

function fmtWorkedHours(h) {
  const val = Number(h || 0);
  if (val <= 0) return "—";
  const hours = Math.floor(val);
  const mins  = Math.round((val - hours) * 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0)  return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// ---------- Silent GPS one-shot ----------
//
// Wraps navigator.geolocation in a promise. Always resolves — never
// rejects — so the caller can decide what to do on failure without
// try/catch noise. On denial / timeout / no support, resolves with
// { coords: null }.

function getPositionSilent(options = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ coords: null, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        coords: {
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy,
        },
        reason: null,
      }),
      (err) => resolve({ coords: null, reason: err.code || "error" }),
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60_000,
        ...options,
      }
    );
  });
}


// =====================================================================
// ActionButton — one of the four attendance-lifecycle buttons.
// Three visual states: enabled (accent), done (green pill), locked (grey).
// =====================================================================

function ActionButton({
  label,
  done,
  doneAt,
  enabled,
  lockedHint,
  busy,
  onClick,
  variant = "primary",     // "primary" (check-in/out) or "ot" (purple accent)
}) {

  let mode = "locked";

  if (done)   mode = "done";
  else if (enabled) mode = "enabled";

  const isOt = variant === "ot";

  const styleFor = {
    enabled: {
      background: isOt ? "#7c3aed" : "var(--clr-primary)",
      color:      "#fff",
      cursor:     busy ? "wait" : "pointer",
      opacity:    busy ? 0.7 : 1,
    },
    done: {
      background: "var(--success-bg)",
      color:      "var(--success-dark)",
      border:     "1px solid var(--success-border)",
      cursor:     "default",
    },
    locked: {
      background: "var(--surface)",
      color:      "var(--text-muted)",
      border:     "1px dashed var(--border)",
      cursor:     "not-allowed",
      opacity:    0.75,
    },
  }[mode];

  const isDisabled = mode !== "enabled" || busy;

  return (
    <button
      type="button"
      className={styles.actionBtn}
      style={styleFor}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
    >
      <span className={styles.actionBtnLabel}>{label}</span>
      <span className={styles.actionBtnHint}>
        {done && doneAt
          ? `Done · ${formatISTTime(doneAt)}`
          : mode === "enabled"
            ? (busy ? "Working…" : "Tap to record")
            : (lockedHint || "Locked")}
      </span>
    </button>
  );
}


// =====================================================================
// Main component
// =====================================================================

export default function MyAttendancePanel({ employeeId }) {

  const [today, setToday]     = useState(null);       // today's Attendance row (or null)
  const [busy, setBusy]       = useState(false);
  const [toast, setToast]     = useState("");
  const [autoTried, setAutoTried] = useState(false);
  const [tick, setTick]       = useState(0);

  // Keep a ref so the initial-mount auto check-in doesn't race the
  // history-load effect.
  const autoRef = useRef(false);

  // -------------------------------------------------------------
  // Data loaders
  // -------------------------------------------------------------

  const refreshToday = useCallback(async () => {
    if (!employeeId) return;
    try {
      const res = await API.get("/attendance/today");
      const todayISO = new Date().toISOString().slice(0, 10);
      const mine = (res.data || []).find((r) => {
        const okEmp = (r.EMPLOYEE_ID || "") === employeeId
                   || (r.EMPLOYEE_CODE || "") === employeeId;
        const okDay = (r.DATE || "").slice(0, 10) === todayISO;
        return okEmp && okDay;
      });
      setToday(mine || null);
    } catch {
      /* silent — the employee doesn't need to see fetch errors */
    }
  }, [employeeId]);

  // Initial load
  useEffect(() => {
    refreshToday();
  }, [refreshToday]);

  // 60-second tick so the "worked hours" counter climbs while
  // the employee is checked in but not yet checked out.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Auto-clear toast after a few seconds
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  void tick; // keeps the linter quiet — used to force re-render

  // -------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------

  const doCheckIn = useCallback(async ({ silent } = {}) => {
    if (!employeeId || busy) return false;

    const { coords } = await getPositionSilent();

    if (!coords) {
      if (!silent) setToast("Location required to check in — enable it and try again.");
      return false;
    }

    setBusy(true);
    try {
      await API.post("/check-in", {
        EMPLOYEE_ID: employeeId,
        LATITUDE:  coords.latitude,
        LONGITUDE: coords.longitude,
        ACCURACY:  coords.accuracy,
        VENDOR_ID: 1,
      });
      if (!silent) setToast("Checked in");
      await refreshToday();
      return true;
    } catch (err) {
      // Actionable messages, but never leak distance, coords, or
      // office details. Admin still sees full context in the
      // attendance_security_logs.
      if (!silent) {
        const status = err?.response?.status;
        const detail = (err?.response?.data?.detail || "").toLowerCase();

        if (status === 400 && detail.includes("already")) {
          setToast("You're already checked in today.");
        } else if (status === 403 || detail.includes("geofence") || detail.includes("outside")) {
          setToast("You need to be at the office location to check in.");
        } else if (status === 401) {
          setToast("Your session has expired. Please log in again.");
        } else if (status === 404) {
          setToast("Your employee record isn't set up yet. Contact HR.");
        } else if (!err?.response) {
          // Network error / backend down
          setToast("Can't reach the server. Check your connection.");
        } else {
          setToast("Check-in unavailable — try again in a moment.");
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [employeeId, busy, refreshToday]);

  // Generic action runner used by the OT buttons — same error-mapping
  // as check-in but with action-specific verbs so the toast reads well.
  const runAction = useCallback(async ({ url, payload, successMsg, actionLabel }) => {
    if (!employeeId || busy) return;
    setBusy(true);
    try {
      await API.post(url, payload);
      setToast(successMsg);
      await refreshToday();
    } catch (err) {
      const status = err?.response?.status;
      const detail = (err?.response?.data?.detail || "").toLowerCase();
      if (status === 400 && (detail.includes("already") || detail.includes("closed"))) {
        setToast(`${actionLabel} — already recorded.`);
      } else if (status === 400 && detail.includes("check-out")) {
        setToast("Finish your regular check-out before starting OT.");
      } else if (status === 400 && detail.includes("check-in")) {
        setToast("You need to check in first.");
      } else if (status === 400 && detail.includes("no ot session")) {
        setToast("Start OT before ending it.");
      } else if (status === 404) {
        setToast("Check in first — no attendance record for today yet.");
      } else if (!err?.response) {
        setToast("Can't reach the server. Check your connection.");
      } else {
        setToast(`${actionLabel} unavailable — try again in a moment.`);
      }
    } finally {
      setBusy(false);
    }
  }, [employeeId, busy, refreshToday]);

  const doOtCheckIn = useCallback(async () => {
    await runAction({
      url: "/ot-check-in",
      payload: { EMPLOYEE_ID: employeeId },
      successMsg: "OT session started",
      actionLabel: "OT check-in",
    });
  }, [employeeId, runAction]);

  const doOtCheckOut = useCallback(async () => {
    await runAction({
      url: "/ot-check-out",
      payload: { EMPLOYEE_ID: employeeId },
      successMsg: "OT session ended",
      actionLabel: "OT check-out",
    });
  }, [employeeId, runAction]);

  const doCheckOut = useCallback(async () => {
    if (!employeeId || busy) return;
    const { coords } = await getPositionSilent();
    if (!coords) {
      setToast("Location required to check out — enable it and try again.");
      return;
    }
    setBusy(true);
    try {
      await API.post("/check-out", {
        EMPLOYEE_ID: employeeId,
        LATITUDE:  coords.latitude,
        LONGITUDE: coords.longitude,
        ACCURACY:  coords.accuracy,
        VENDOR_ID: 1,
      });
      setToast("Checked out — have a good evening!");
      await refreshToday();
    } catch (err) {
      const status = err?.response?.status;
      const detail = (err?.response?.data?.detail || "").toLowerCase();

      if (status === 403 || detail.includes("geofence") || detail.includes("outside")) {
        setToast("You need to be at the office location to check out.");
      } else if (status === 400 && detail.includes("already")) {
        setToast("You've already checked out today.");
      } else if (status === 400 && detail.includes("has not checked in")) {
        setToast("You haven't checked in yet today.");
      } else if (!err?.response) {
        setToast("Can't reach the server. Check your connection.");
      } else {
        setToast("Check-out unavailable — try again in a moment.");
      }
    } finally {
      setBusy(false);
    }
  }, [employeeId, busy, refreshToday]);

  // Silent auto check-in on mount — only if not already checked in.
  useEffect(() => {
    if (autoRef.current) return;
    if (!employeeId) return;
    // Wait one tick so `today` has loaded from the initial refresh.
    const t = setTimeout(async () => {
      if (autoRef.current) return;
      autoRef.current = true;
      // Skip if already checked in today
      if (today && today.CHECK_IN) return;
      await doCheckIn({ silent: true });
      setAutoTried(true);
    }, 900);
    return () => clearTimeout(t);
  }, [employeeId, today, doCheckIn]);

  // -------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------

  const hasCheckedIn  = !!(today && today.CHECK_IN);
  const hasCheckedOut = !!(today && today.CHECK_OUT);

  // Live worked hours (climbs while checked in but not out)
  const liveWorkedHours = useMemo(() => {
    if (!today) return 0;
    if (today.WORKED_HOURS && today.CHECK_OUT) return today.WORKED_HOURS;
    if (today.CHECK_IN && !today.CHECK_OUT) {
      const start = new Date(today.CHECK_IN);
      const now = new Date();
      return Math.max(0, (now - start) / 3_600_000);
    }
    return 0;
  }, [today, tick]);   // eslint-disable-line react-hooks/exhaustive-deps

  const overtimeHours = Number(today?.OVERTIME_HOURS || 0);

  return (
    <div className={styles.wrap}>

      {/* ---------- Today's card ---------- */}
      <section className={styles.todayCard}>
        <div className={styles.todayHeader}>
          <div className={styles.todayHeadLeft}>
            <div className={styles.todayEyebrow}>Today</div>
            <div className={styles.todayDate}>
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long", day: "numeric", month: "long", year: "numeric",
              })}
            </div>
          </div>
          <Badge status={today?.STATUS || (hasCheckedIn ? "PRESENT" : null)} />
        </div>

        <div className={styles.todayStats}>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>Check-in</div>
            <div className={styles.statValue}>
              {today?.CHECK_IN ? formatISTTime(today.CHECK_IN) : "—"}
            </div>
          </div>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>Check-out</div>
            <div className={styles.statValue}>
              {today?.CHECK_OUT ? formatISTTime(today.CHECK_OUT) : "—"}
            </div>
          </div>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>Working hours</div>
            <div className={styles.statValue}>
              {fmtWorkedHours(liveWorkedHours)}
            </div>
          </div>
          {overtimeHours > 0 && (
            <div className={styles.statCell}>
              <div className={styles.statLabel}>Overtime</div>
              <div className={styles.statValue} style={{ color: "#7c3aed" }}>
                {fmtWorkedHours(overtimeHours)}
              </div>
            </div>
          )}
        </div>

        {/* Four buttons showing the full attendance lifecycle. Each
            button knows whether it's the next available action, an
            already-recorded milestone, or a locked prerequisite. */}
        <div className={styles.actionGrid}>
          <ActionButton
            label="Check in"
            done={hasCheckedIn}
            doneAt={today?.CHECK_IN}
            enabled={!hasCheckedIn}
            busy={busy}
            onClick={() => doCheckIn({ silent: false })}
          />
          <ActionButton
            label="Check out"
            done={hasCheckedOut}
            doneAt={today?.CHECK_OUT}
            enabled={hasCheckedIn && !hasCheckedOut}
            lockedHint={!hasCheckedIn ? "After check-in" : null}
            busy={busy}
            onClick={doCheckOut}
          />
          <ActionButton
            label="OT check in"
            done={!!today?.OT_CHECK_IN}
            doneAt={today?.OT_CHECK_IN}
            enabled={hasCheckedOut && !today?.OT_CHECK_IN}
            lockedHint={!hasCheckedOut ? "After check-out" : null}
            busy={busy}
            onClick={doOtCheckIn}
            variant="ot"
          />
          <ActionButton
            label="OT check out"
            done={!!today?.OT_CHECK_OUT}
            doneAt={today?.OT_CHECK_OUT}
            enabled={!!today?.OT_CHECK_IN && !today?.OT_CHECK_OUT}
            lockedHint={!today?.OT_CHECK_IN ? "After OT check-in" : null}
            busy={busy}
            onClick={doOtCheckOut}
            variant="ot"
          />
        </div>

        {hasCheckedIn && hasCheckedOut && !today?.OT_CHECK_IN && (
          <div className={styles.doneRow}>
            Attendance recorded for today.
            {overtimeHours > 0 && (
              <span style={{ color: "#7c3aed", fontWeight: 700, marginLeft: 6 }}>
                Including {fmtWorkedHours(overtimeHours)} OT.
              </span>
            )}
          </div>
        )}
      </section>

      {toast && (
        <div className={styles.toast}>{toast}</div>
      )}
    </div>
  );
}
