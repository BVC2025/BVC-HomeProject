/*
 * MyAttendancePanel — Employee attendance widget (v3)
 *
 * Design goals
 * ------------
 *   1. Nothing about today's attendance appears until the employee
 *      has actually recorded a check-in. No auto-check-in on mount,
 *      no pre-emptive "Late" pill just because they logged in past
 *      9 AM. Login is not attendance.
 *   2. When they check in, we surface: the time, the status pill,
 *      and — if past 9 AM — a plain-English "Late by X minutes"
 *      line so they know the number, not just a colour.
 *   3. Four-stage attendance day: check-in → check-out → OT in →
 *      OT out. Each stage is a full-width action tile that shows
 *      when it's actionable, when it's already done, and when it's
 *      locked waiting on the prior stage.
 *   4. Overtime hours are computed server-side (Attendance.OVERTIME_HOURS)
 *      and shown in their own row once OT is done.
 *   5. Biometric-ready: a small footer hint tells employees this UI
 *      will accept fingerprint check-in when the device is wired in.
 *      The DOM shape stays the same either way — the biometric ADMS
 *      endpoint already writes to the same Attendance row.
 *
 * What employees do NOT see (deliberately)
 *   • GPS coordinates / distance from office
 *   • Geofence radius / office coordinates
 *   • Failed-attempt logs
 * Admin still sees all of this via attendance_security_logs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import { formatISTTime } from "../utils/time";
import styles from "./MyAttendancePanel.module.css";


// ------------------------------------------------------------------
// Icons — small stroke SVGs, inherit currentColor
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{children}</svg>
);

const I = {
  clockIn: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  clockOut: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 12l3 -3M12 12v5" /></>),
  overtime: icon(<><path d="M12 3v3" /><path d="M12 21v-3" /><path d="M3 12h3" /><path d="M21 12h-3" /><circle cx="12" cy="12" r="5" /></>),
  finger: icon(<>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a7 7 0 0 0-7 9c1 3 3 5 7 8" />
    <path d="M12 3a7 7 0 0 1 7 9c-1 3-3 5-7 8" />
    <path d="M12 8c-1.8 0-3 1.4-3 3v1c0 2 1 3.5 3 5" />
    <path d="M12 8c1.8 0 3 1.4 3 3v1c0 2-1 3.5-3 5" />
  </>),
  info: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 8v.01" /><path d="M11 12h1v4h1" /></>),
};


// ------------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------------

function fmtWorkedHours(h) {
  const val = Number(h || 0);
  if (val <= 0) return "—";
  const hours = Math.floor(val);
  const mins = Math.round((val - hours) * 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function fmtLateBy(minutes) {
  const m = Math.max(0, Math.round(Number(minutes || 0)));
  if (m === 0) return "";
  if (m < 60) return `Late by ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `Late by ${h} hour${h === 1 ? "" : "s"}`;
  return `Late by ${h}h ${rem}m`;
}


// ------------------------------------------------------------------
// Silent GPS one-shot — never rejects, always resolves.
// ------------------------------------------------------------------
function getPositionSilent(options = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ coords: null, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        coords: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        },
        reason: null,
      }),
      (err) => resolve({ coords: null, reason: err.code || "error" }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000, ...options }
    );
  });
}


// ==================================================================
// ActionTile — one of the four lifecycle buttons. State-driven look:
//   ready   → primary colour, tap to record
//   done    → soft green pill with the recorded time
//   locked  → dashed grey, hint tells why
// ==================================================================
function ActionTile({
  icon,
  title,
  ready,
  done,
  doneAt,
  lockedHint,
  busy,
  variant = "primary",
  onClick,
}) {
  const mode = done ? "done" : ready ? "ready" : "locked";
  const isDisabled = mode !== "ready" || busy;

  const cls = [
    styles.action,
    styles[`action_${mode}`],
    variant === "ot" ? styles.action_ot : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cls}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
    >
      <span className={styles.actionIcon}>{icon}</span>
      <span className={styles.actionBody}>
        <span className={styles.actionTitle}>{title}</span>
        <span className={styles.actionHint}>
          {mode === "done" && doneAt
            ? `Recorded · ${formatISTTime(doneAt)}`
            : mode === "ready"
              ? (busy ? "Working…" : "Tap to record")
              : (lockedHint || "Locked")}
        </span>
      </span>
    </button>
  );
}


// ==================================================================
// Main component
// ==================================================================
export default function MyAttendancePanel({ employeeId }) {

  const [today, setToday] = useState(null);   // today's Attendance row or null
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [tick, setTick] = useState(0);      // triggers hourly re-render

  // ---- Live geofence gate ------------------------------------------
  //   'checking' — GPS+validate in flight; keep tile enabled meanwhile
  //   'inside'   — server confirmed inside the fence
  //   'outside'  — server rejected; distance is set
  //   'unknown'  — geofence disabled by admin, GPS blocked, or server
  //                error. We DON'T lock the tile in this state — the
  //                backend still enforces on click, so worst case the
  //                user gets the toast fallback.
  const [geo, setGeo] = useState({
    status: "checking",
    distance: null,   // metres from office (when outside)
    radius: null,     // configured radius (when outside)
  });

  // ---- Refresh today's row ----
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
    } catch { /* silent — employees don't need to see fetch errors */ }
  }, [employeeId]);

  useEffect(() => { refreshToday(); }, [refreshToday]);

  // Force a re-render every minute so the live "worked hours"
  // counter climbs while the employee is checked in.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(id);
  }, [toast]);


  // -------------------------------------------------------------
  // Live geofence pre-check — runs on mount and on demand (e.g. when
  // the employee taps "Recheck location"). Decides whether to show
  // Check In as ready or locked BEFORE the click hits the backend.
  //
  //   1. Ask the server whether geofence enforcement is ON at all.
  //      If OFF, mark status 'unknown' (backend won't reject).
  //   2. Ask the browser for GPS. If blocked / unavailable, we
  //      keep 'unknown' — no client-side lock, backend still rules.
  //   3. POST /geofence/validate to check distance against radius.
  //      allowed = true  → 'inside'
  //      allowed = false → 'outside' (record distance/radius)
  // -------------------------------------------------------------
  const checkGeofence = useCallback(async () => {

    setGeo((g) => ({ ...g, status: "checking" }));

    try {

      const cfg = await API.get("/geofence/settings").then((r) => r.data || {});

      if (!cfg?.IS_ACTIVE) {

        setGeo({ status: "unknown", distance: null, radius: null });

        return;
      }

    } catch {
      // settings unreachable → don't lock the user out, backend still enforces
      setGeo({ status: "unknown", distance: null, radius: null });
      return;
    }

    const { coords } = await getPositionSilent();

    if (!coords) {

      setGeo({ status: "unknown", distance: null, radius: null });

      return;
    }

    try {

      const r = await API.post("/geofence/validate", {
        LATITUDE: coords.latitude,
        LONGITUDE: coords.longitude,
        VENDOR_ID: 1,
      });

      if (r.data?.allowed) {

        setGeo({
          status: "inside",
          distance: r.data.distance_meters ?? null,
          radius: r.data.radius_meters ?? null,
        });

      } else {

        setGeo({
          status: "outside",
          distance: r.data?.distance_meters ?? null,
          radius: r.data?.radius_meters ?? null,
        });
      }

    } catch {

      setGeo({ status: "unknown", distance: null, radius: null });
    }
  }, []);

  useEffect(() => { checkGeofence(); }, [checkGeofence]);


  // -------------------------------------------------------------
  // Silent auto check-in on portal load.
  // Runs ONCE per employee-id and only if today's row shows no
  // CHECK_IN_TIME yet. Requests GPS silently — if the browser blocks
  // it, we bail out and let the employee use the manual button.
  // Backend applies the same geofence rules the manual endpoint uses
  // PLUS the Wi-Fi allow-list, so this is safe against spoofed calls.
  // -------------------------------------------------------------
  const [autoTried, setAutoTried] = useState(false);

  useEffect(() => {
    if (!employeeId) return;
    if (autoTried) return;
    // Wait until refreshToday has completed at least once so we
    // don't fire on an already-checked-in day.
    if (today && today.CHECK_IN_TIME) { setAutoTried(true); return; }

    let cancelled = false;
    (async () => {
      const { coords } = await getPositionSilent();
      if (cancelled) return;
      // Even without coords we still call the endpoint — the server
      // then returns { status: "no_coords" } and we quietly stop.
      try {
        const res = await API.post("/geofence/auto-checkin", {
          EMPLOYEE_ID: employeeId,
          LATITUDE:   coords?.latitude,
          LONGITUDE:  coords?.longitude,
          DEVICE_INFO: (typeof navigator !== "undefined" && navigator.userAgent) || null,
          VENDOR_ID: 1,
        });
        if (cancelled) return;
        const s = res.data?.status;
        if (s === "checked_in") {
          setToast(`Auto check-in successful (${Math.round(res.data.distance_m)}m from office).`);
          await refreshToday();
        } else if (s === "already_checked_in") {
          // silent
        } else if (s === "manual_required") {
          setToast(res.data?.message || "Tap Check In to record attendance.");
        } else if (s === "no_coords") {
          setToast("Enable location and reload for auto check-in.");
        } else if (s === "geo_disabled") {
          // silent — geofencing turned off
        }
      } catch (err) {
        if (cancelled) return;
        // 403 = blocked outright (beyond MAX_RADIUS). Any other failure
        // is silent so the manual button stays as fallback.
        if (err?.response?.status === 403) {
          setToast(err?.response?.data?.detail || "Check-in blocked — you're too far from the office.");
        }
      } finally {
        if (!cancelled) setAutoTried(true);
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId, today, autoTried, refreshToday]);


  // -------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------
  const doCheckIn = useCallback(async () => {
    if (!employeeId || busy) return;
    const { coords } = await getPositionSilent();
    if (!coords) {
      setToast("Location required to check in — enable it and try again.");
      return;
    }
    setBusy(true);
    try {
      await API.post("/check-in", {
        EMPLOYEE_ID: employeeId,
        LATITUDE: coords.latitude,
        LONGITUDE: coords.longitude,
        ACCURACY: coords.accuracy,
        VENDOR_ID: 1,
      });
      setToast("Checked in");
      await refreshToday();
    } catch (err) {
      const status = err?.response?.status;
      const detail = (err?.response?.data?.detail || "").toLowerCase();
      if (status === 400 && detail.includes("already")) {
        setToast("You're already checked in today.");
      } else if (status === 403 || detail.includes("geofence") || detail.includes("outside")) {
        setToast("You need to be at the office to check in.");
      } else if (status === 401) {
        setToast("Your session has expired. Please log in again.");
      } else if (!err?.response) {
        setToast("Can't reach the server. Check your connection.");
      } else {
        setToast("Check-in unavailable — try again in a moment.");
      }
    } finally {
      setBusy(false);
    }
  }, [employeeId, busy, refreshToday]);

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
        LATITUDE: coords.latitude,
        LONGITUDE: coords.longitude,
        ACCURACY: coords.accuracy,
        VENDOR_ID: 1,
      });
      setToast("Checked out — have a good evening!");
      await refreshToday();
    } catch (err) {
      const status = err?.response?.status;
      const detail = (err?.response?.data?.detail || "").toLowerCase();
      if (status === 403 || detail.includes("geofence") || detail.includes("outside")) {
        setToast("You need to be at the office to check out.");
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

  const runAction = useCallback(async ({ url, successMsg, actionLabel }) => {
    if (!employeeId || busy) return;
    setBusy(true);
    try {
      await API.post(url, { EMPLOYEE_ID: employeeId });
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

  const doOtCheckIn = useCallback(() => runAction({
    url: "/ot-check-in", successMsg: "OT session started", actionLabel: "OT check-in",
  }), [runAction]);
  const doOtCheckOut = useCallback(() => runAction({
    url: "/ot-check-out", successMsg: "OT session ended", actionLabel: "OT check-out",
  }), [runAction]);


  // -------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------
  const hasCheckedIn = !!(today && today.CHECK_IN);
  const hasCheckedOut = !!(today && today.CHECK_OUT);
  const hasOtIn = !!(today && today.OT_CHECK_IN);
  const hasOtOut = !!(today && today.OT_CHECK_OUT);

  // Live worked hours (climbs while checked-in-not-out)
  const liveWorkedHours = useMemo(() => {
    if (!today) return 0;
    if (today.WORKED_HOURS && today.CHECK_OUT) return today.WORKED_HOURS;
    if (today.CHECK_IN && !today.CHECK_OUT) {
      const start = new Date(today.CHECK_IN);
      return Math.max(0, (new Date() - start) / 3_600_000);
    }
    return 0;
  }, [today, tick]);   // eslint-disable-line react-hooks/exhaustive-deps

  const overtimeHours = Number(today?.OVERTIME_HOURS || 0);

  // Live OT hours (climbs while OT is active but not closed). Once
  // OT_CHECK_OUT lands, the server writes OVERTIME_HOURS and we use
  // that as the source of truth.
  const liveOvertimeHours = useMemo(() => {
    if (!today) return 0;
    if (today.OVERTIME_HOURS && today.OT_CHECK_OUT) return today.OVERTIME_HOURS;
    if (today.OT_CHECK_IN && !today.OT_CHECK_OUT) {
      const start = new Date(today.OT_CHECK_IN);
      return Math.max(0, (new Date() - start) / 3_600_000);
    }
    return 0;
  }, [today, tick]);   // eslint-disable-line react-hooks/exhaustive-deps

  const isLate = hasCheckedIn && (today?.STATUS || "").toUpperCase() === "LATE";
  const lateText = isLate ? fmtLateBy(today?.LATE_MINUTES || 0) : "";

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });


  // -------------------------------------------------------------
  // Render
  // -------------------------------------------------------------
  return (
    <div className={styles.wrap}>

      {/* ================ 1. TODAY HEADER ================ */}
      <section className={styles.card}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.eyebrow}>Today</div>
            <div className={styles.date}>{dateLabel}</div>
          </div>

          {/* Status chip appears ONLY after check-in has been recorded.
              Merely being logged in doesn't imply attendance. */}
          {hasCheckedIn && (
            isLate
              ? <span className={`${styles.chip} ${styles.chip_late}`}>Late</span>
              : <span className={`${styles.chip} ${styles.chip_present}`}>Present</span>
          )}
        </div>

        {/* ================ 2. TIME STATS ================ */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Check-in</div>
            <div className={styles.statValue}>
              {hasCheckedIn ? formatISTTime(today.CHECK_IN) : "—"}
            </div>
            {lateText && (
              <div className={styles.statNote}>{lateText}</div>
            )}
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Check-out</div>
            <div className={styles.statValue}>
              {hasCheckedOut ? formatISTTime(today.CHECK_OUT) : "—"}
            </div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Working hours</div>
            <div className={styles.statValue}>
              {hasCheckedIn ? fmtWorkedHours(liveWorkedHours) : "—"}
            </div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>OT working hours</div>
            <div className={`${styles.statValue} ${styles.statValueOt}`}>
              {hasOtIn ? fmtWorkedHours(liveOvertimeHours) : "—"}
            </div>
          </div>
        </div>

        {/* ================ 3. OT SUMMARY (conditional) ================ */}
        {(hasOtIn || hasOtOut || overtimeHours > 0) && (
          <div className={styles.otBlock}>
            <div className={styles.otHead}>
              <span className={styles.otEyebrow}>Overtime</span>
              {hasOtOut && overtimeHours > 0 && (
                <span className={styles.otTotalPill}>
                  {fmtWorkedHours(overtimeHours)} total
                </span>
              )}
            </div>
            <div className={styles.otStats}>
              <div className={styles.stat}>
                <div className={styles.statLabel}>OT check-in</div>
                <div className={styles.statValue}>
                  {hasOtIn ? formatISTTime(today.OT_CHECK_IN) : "—"}
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>OT check-out</div>
                <div className={styles.statValue}>
                  {hasOtOut ? formatISTTime(today.OT_CHECK_OUT) : "—"}
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Overtime hours</div>
                <div className={`${styles.statValue} ${styles.statValueOt}`}>
                  {overtimeHours > 0 ? fmtWorkedHours(overtimeHours) : "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================ 4. LIFECYCLE ACTIONS ================ */}
        <div className={styles.actionGrid}>
          <ActionTile
            icon={I.clockIn}
            title="Check In"
            ready={!hasCheckedIn && geo.status !== "outside"}
            done={hasCheckedIn}
            doneAt={today?.CHECK_IN}
            lockedHint={
              geo.status === "outside"
                ? `Outside office · ${
                    geo.distance != null
                      ? `${Math.round(geo.distance)}m away (radius ${geo.radius ?? 50}m)`
                      : "move closer to check in"
                  }`
                : geo.status === "checking" && !hasCheckedIn
                  ? "Locating you…"
                  : null
            }
            busy={busy}
            onClick={doCheckIn}
          />
          <ActionTile
            icon={I.clockOut}
            title="Check Out"
            ready={hasCheckedIn && !hasCheckedOut}
            done={hasCheckedOut}
            doneAt={today?.CHECK_OUT}
            lockedHint={!hasCheckedIn ? "After Check In" : null}
            busy={busy}
            onClick={doCheckOut}
          />
          <ActionTile
            icon={I.overtime}
            title="OT Check In"
            ready={hasCheckedOut && !hasOtIn}
            done={hasOtIn}
            doneAt={today?.OT_CHECK_IN}
            lockedHint={!hasCheckedOut ? "After Check Out" : null}
            busy={busy}
            variant="ot"
            onClick={doOtCheckIn}
          />
          <ActionTile
            icon={I.overtime}
            title="OT Check Out"
            ready={hasOtIn && !hasOtOut}
            done={hasOtOut}
            doneAt={today?.OT_CHECK_OUT}
            lockedHint={!hasOtIn ? "After OT Check In" : null}
            busy={busy}
            variant="ot"
            onClick={doOtCheckOut}
          />
        </div>

        {/* Geofence recheck — visible when the pre-check locked out
            Check In. One tap re-reads GPS + revalidates, so the moment
            the employee walks inside the radius the tile unlocks. */}
        {geo.status === "outside" && !hasCheckedIn && (
          <div className={styles.geoRecheckRow}>
            <button
              type="button"
              className={styles.geoRecheckBtn}
              onClick={checkGeofence}
              disabled={busy}
            >
              Recheck location
            </button>
          </div>
        )}

        {/* ================ 5. BIOMETRIC HINT ================ */}
        <div className={styles.bioHint}>
          <span className={styles.bioHintIcon}>{I.finger}</span>
          <span>
            Fingerprint attendance will be automatic once the biometric
            device is on the office network.
          </span>
        </div>

      </section>

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
