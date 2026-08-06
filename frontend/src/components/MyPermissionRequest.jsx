// =====================================================================
// MyPermissionRequest — hourly permission page for the ESS.
// ---------------------------------------------------------------------
// Layout:
//   1. Balance strip — free hours used this month (4 h/month cap)
//   2. Apply form:
//      - Date picker
//      - Duration presets: 1 hour / 2 hours / Half day / Custom
//      - Start time + end time
//      - Reason
//   3. My permission requests — history with status chips
//
// The permission subtype is derived from the chosen preset:
//   1h / 2h  → SHORT_PERMISSION
//   Half day → HALF_DAY
//   Custom   → SHORT_PERMISSION (server rules apply)
//
// Backend endpoints:
//   POST /leave/apply-permission                 — submit
//   GET  /leave/permission-balance/{emp_id}      — remaining free hours
//   GET  /leave/my-permissions?employee_id=…     — history
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./LeaveAndPermission.module.css";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  clock: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  send:  icon(<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />),
  empty: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, 30),
};


// ------------------------------------------------------------------
// Duration presets
// ------------------------------------------------------------------
const PRESETS = [
  { key: "1H",       label: "1 hour",   hint: "60 minutes",  hours: 1,   subtype: "SHORT_PERMISSION" },
  { key: "2H",       label: "2 hours",  hint: "120 minutes", hours: 2,   subtype: "SHORT_PERMISSION" },
  { key: "HALF",     label: "Half day", hint: "4 hours",     hours: 4,   subtype: "HALF_DAY"         },
  { key: "CUSTOM",   label: "Custom",   hint: "You decide",  hours: null,subtype: "SHORT_PERMISSION" },
];

const STATUS_META = {
  PENDING:   { label: "Pending",   cls: "chip_pending"   },
  APPROVED:  { label: "Approved",  cls: "chip_approved"  },
  REJECTED:  { label: "Rejected",  cls: "chip_rejected"  },
  CANCELLED: { label: "Cancelled", cls: "chip_cancelled" },
};


// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function todayISO() {
  // Build YYYY-MM-DD from LOCAL date parts. Using toISOString() here
  // silently converts to UTC — IST is UTC+5:30, so any local time up
  // to 05:30 IST would report yesterday. This bug showed the date as
  // "05-08-2026" when the actual local date was 06-08-2026.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return String(value); }
}

// "13:15" + 1.5h → "14:45"
function addHours(hhmm, hours) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const H = Math.floor(total / 60) % 24;
  const M = Math.round(total % 60);
  return `${String(H).padStart(2, "0")}:${String(M).padStart(2, "0")}`;
}

function diffHours(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max(0, mins / 60);
}


// ==================================================================
// Component
// ==================================================================

export default function MyPermissionRequest({ employeeId, onSubmitted }) {

  // ---- Form state ----
  const [preset,    setPreset]    = useState("1H");
  const [date,      setDate]      = useState(todayISO());
  const [startTime, setStartTime] = useState("00:00");
  const [endTime,   setEndTime]   = useState("00:00");
  const [reason,    setReason]    = useState("");

  // ---- Async state ----
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  // ---- Fetch balance + history ----
  const refresh = useCallback(async () => {
    if (!employeeId) return;
    try {
      const [balRes, histRes] = await Promise.all([
        API.get(`/leave/permission-balance/${encodeURIComponent(employeeId)}`),
        API.get("/leave/my-permissions", { params: { employee_id: employeeId } }),
      ]);
      setBalance(balRes.data || null);
      const rows = Array.isArray(histRes.data)
        ? histRes.data
        : histRes.data?.permissions || [];
      setHistory(rows);
    } catch { /* silent — empty state below handles missing data */ }
  }, [employeeId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!success) return undefined;
    const id = window.setTimeout(() => setSuccess(""), 3500);
    return () => window.clearTimeout(id);
  }, [success]);


  // ---- Preset switching ----
  const applyPreset = (p) => {
    setPreset(p.key);
    if (p.hours != null) {
      setEndTime(addHours(startTime, p.hours));
    }
  };

  // When start time moves, keep the duration honoured for fixed presets
  const onStartTimeChange = (newStart) => {
    setStartTime(newStart);
    const p = PRESETS.find((x) => x.key === preset);
    if (p && p.hours != null) {
      setEndTime(addHours(newStart, p.hours));
    }
  };


  // ---- Derived numbers ----
  const durationHours = useMemo(() => diffHours(startTime, endTime), [startTime, endTime]);

  const activePreset = PRESETS.find((p) => p.key === preset) || PRESETS[0];

  // Balance shape depends on backend; support both { used_hours, free_hours }
  // and { used, remaining, cap } shapes.
  const balanceInfo = useMemo(() => {
    if (!balance) return null;
    const used  = Number(balance.used_hours ?? balance.used ?? 0);
    const cap   = Number(balance.cap ?? balance.free_cap ?? balance.free_hours_cap ?? 4);
    const remaining = Number(
      balance.free_hours_left ?? balance.remaining ?? Math.max(0, cap - used)
    );
    return { used, cap, remaining };
  }, [balance]);


  // ---- Validation ----
  const validationError = (() => {
    if (!date) return "Please choose a date.";
    if (!startTime || !endTime) return "Please choose start and end times.";
    if (durationHours <= 0) return "End time must be after start time.";
    if (durationHours > 8)  return "Permission can't exceed 8 hours (that's a full-day leave).";
    if (!reason.trim())     return "Reason is required so your manager can decide.";
    return null;
  })();


  // ---- Submit ----
  const submit = useCallback(async (e) => {
    e.preventDefault();
    if (validationError) { setError(validationError); return; }
    if (!employeeId)     { setError("Employee not identified — please log in again."); return; }

    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await API.post("/leave/apply-permission", {
        EMPLOYEE_ID:        employeeId,
        PERMISSION_DATE:    date,
        DURATION_HOURS:     Number(durationHours.toFixed(2)),
        PERMISSION_SUBTYPE: activePreset.subtype,
        REASON:             reason.trim(),
      });
      setSuccess("Permission request submitted. Your manager has been notified.");
      setReason("");
      onSubmitted?.();
      refresh();
    } catch (err) {
      const raw = err?.response?.data?.detail;
      const msg = typeof raw === "string" && raw
        ? raw
        : Array.isArray(raw) && raw.length
          ? raw.map((e) => e?.msg || "").filter(Boolean).join(" · ")
          : "Could not submit the request. Please try again.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [
    validationError, employeeId, date, durationHours,
    activePreset, reason, onSubmitted, refresh,
  ]);


  // ==================================================================
  // Render
  // ==================================================================
  return (
    <div className={styles.wrap}>

      {/* ---------- Balance strip ---------- */}
      <section className={styles.balance}>
        <div className={styles.balanceHead}>
          <span className={styles.balanceIcon}>{I.clock}</span>
          <div>
            <div className={styles.balanceTitle}>Permission this month</div>
            <div className={styles.balanceValue}>
              {balanceInfo ? balanceInfo.remaining.toFixed(1) : "—"}
              <small>hours remaining</small>
            </div>
          </div>
        </div>

        {balanceInfo && (
          <div className={styles.balanceBreakdown}>
            <span className={`${styles.breakdownPill} ${styles.breakdownPill_casual}`}>
              Used <b>{balanceInfo.used.toFixed(1)}h</b>
            </span>
            <span className={`${styles.breakdownPill} ${styles.breakdownPill_earned}`}>
              Free cap <b>{balanceInfo.cap.toFixed(1)}h</b>
            </span>
          </div>
        )}
      </section>


      {/* ---------- Apply form ---------- */}
      <section className={styles.cardWide}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>Apply for permission</div>
          <div className={styles.sectionSub}>
            Sub-day time off · counted in hours, not days
          </div>
        </div>

        {error   && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        <form className={styles.form} onSubmit={submit}>

          {/* Date */}
          <div className={styles.field}>
            <label className={`${styles.label} ${styles.labelRequired}`}>Date</label>
            <input
              type="date"
              className={styles.input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={todayISO()}
            />
          </div>

          {/* Duration presets */}
          <div className={styles.field}>
            <label className={styles.label}>Duration</label>
            <div className={styles.presetRow}>
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.presetChip} ${preset === p.key ? styles.presetChip_active : ""}`}
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                  <span className={styles.presetChip_hint}>· {p.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Start / End time */}
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={`${styles.label} ${styles.labelRequired}`}>Start time</label>
              <input
                type="time"
                className={styles.input}
                value={startTime}
                onChange={(e) => onStartTimeChange(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={`${styles.label} ${styles.labelRequired}`}>End time</label>
              <input
                type="time"
                className={styles.input}
                value={endTime}
                onChange={(e) => { setEndTime(e.target.value); setPreset("CUSTOM"); }}
              />
            </div>
          </div>

          <div className={styles.computed}>
            You're requesting <b>{durationHours.toFixed(1)}h</b> of permission
            on <b>{fmtDate(date)}</b> from <b>{startTime}</b> to <b>{endTime}</b>.
          </div>

          {/* Reason */}
          <div className={styles.field}>
            <label className={`${styles.label} ${styles.labelRequired}`}>Reason</label>
            <textarea
              className={styles.textarea}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Doctor's appointment, family errand, etc."
            />
            <div className={styles.hint}>
              This goes to your manager along with the request. Free-permission cap: 4 hours per month — hours beyond that may be deducted from pay.
            </div>
          </div>

          <div className={styles.submitRow}>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={saving || !!validationError}
              title={validationError || undefined}
            >
              {I.send}
              {saving ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      </section>


      {/* ---------- History ---------- */}
      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>My permission requests</div>
          <div className={styles.sectionSub}>
            {history.length} in total
          </div>
        </div>

        {history.length === 0 ? (
          <div className={styles.empty}>
            {I.empty}
            <div>
              <div className={styles.emptyTitle}>No permission requests yet</div>
              <div className={styles.emptyBody}>
                Requests you submit above will appear here with their status.
              </div>
            </div>
          </div>
        ) : (
          <ul className={styles.historyList}>
            {history.slice(0, 20).map((r) => {
              const status = (r.STATUS || "PENDING").toUpperCase();
              const meta = STATUS_META[status] || STATUS_META.PENDING;
              const hours = Number(r.HOURS ?? r.DURATION_HOURS ?? 0);
              return (
                <li key={r.ID} className={styles.historyRow}>
                  <span className={styles.historyBadge}>{I.clock}</span>
                  <div className={styles.historyBody}>
                    <div className={styles.historyTitle}>
                      <span>{fmtDate(r.START_DATE || r.PERMISSION_DATE)}</span>
                      <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: 12 }}>
                        {" · "}{hours.toFixed(1)}h
                      </span>
                    </div>
                    <div className={styles.historyMeta}>
                      {r.REASON || "(no reason provided)"}
                    </div>
                  </div>
                  <div className={styles.historyRight}>
                    <span className={`${styles.chip} ${styles[meta.cls]}`}>
                      {meta.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

    </div>
  );
}
