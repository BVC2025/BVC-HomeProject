// =====================================================================
// MyLeaveRequest — clean, form-first leave-apply page for the ESS.
// ---------------------------------------------------------------------
// Layout, top → bottom:
//   1. Balance strip — total remaining days + per-type breakdown
//   2. Apply form — type · start · end · half-day · reason · submit
//   3. My requests — recent history with status chips
//
// Uses the native <input type="date"> picker so we don't ship a
// heavyweight calendar library. Every field is validated inline and
// the submit button stays disabled until the request is complete.
//
// Backend endpoints:
//   POST /leave/apply                  — submit
//   GET  /leave/balance/{employee_id}  — balance summary
//   GET  /leave/my-requests            — history (for this employee)
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
  calendar: icon(<><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></>),
  send:     icon(<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />),
  empty:    icon(<>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M3 9h18M8 2v4M16 2v4" />
  </>, 30),
};


// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const LEAVE_TYPES = [
  { value: "CASUAL",    label: "Casual leave" },
  { value: "SICK",      label: "Sick leave" },
  { value: "EARNED",    label: "Earned leave" },
  { value: "MATERNITY", label: "Maternity leave" },
  { value: "UNPAID",    label: "Unpaid leave" },
  { value: "OTHERS",    label: "Others" },
];

// Types where days are deducted from the employee's quota. Used to
// decide when to warn the employee that this request will eat their
// remaining balance.
const BALANCE_DEDUCTING_TYPES = new Set([
  "CASUAL", "SICK", "EARNED", "MATERNITY",
]);

const STATUS_META = {
  PENDING:   { label: "Pending",   cls: "chip_pending"   },
  APPROVED:  { label: "Approved",  cls: "chip_approved"  },
  REJECTED:  { label: "Rejected",  cls: "chip_rejected"  },
  CANCELLED: { label: "Cancelled", cls: "chip_cancelled" },
};


// ------------------------------------------------------------------
// Small formatting helpers
// ------------------------------------------------------------------

function todayISO() {
  // Build YYYY-MM-DD from LOCAL date parts. toISOString() would emit
  // UTC — for IST (UTC+5:30) that means anything before 05:30 IST
  // reports yesterday, causing the date field to pre-fill wrong.
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

function diffDays(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const a = new Date(startISO), b = new Date(endISO);
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}


// ==================================================================
// Component
// ==================================================================

export default function MyLeaveRequest({ employeeId, onSubmitted }) {

  // ---- Form ----
  const [leaveType, setLeaveType] = useState("CASUAL");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate,   setEndDate]   = useState(todayISO());
  const [halfDay,   setHalfDay]   = useState(false);
  const [halfDaySide, setHalfDaySide] = useState("FIRST"); // FIRST or SECOND half
  const [reason,    setReason]    = useState("");

  // ---- Async state ----
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  // ---- UI: balance-deduction confirmation modal ----
  const [showBalanceConfirm, setShowBalanceConfirm] = useState(false);

  // ---- Load balance + history on mount / employee change ----
  const refresh = useCallback(async () => {
    if (!employeeId) return;
    try {
      const [balRes, histRes] = await Promise.all([
        API.get(`/leave/balance/${encodeURIComponent(employeeId)}`),
        API.get("/leave/my-requests", { params: { employee_id: employeeId } }),
      ]);
      setBalance(balRes.data || null);
      const rows = Array.isArray(histRes.data)
        ? histRes.data
        : histRes.data?.requests || [];
      // Only day-based leaves — permissions have their own page.
      setHistory(rows.filter((r) => (r.LEAVE_TYPE || "").toUpperCase() !== "PERMISSION"));
    } catch { /* silent — empty state handles missing data */ }
  }, [employeeId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-clear the success banner after a few seconds
  useEffect(() => {
    if (!success) return undefined;
    const id = window.setTimeout(() => setSuccess(""), 3500);
    return () => window.clearTimeout(id);
  }, [success]);


  // ---- Derived numbers ----
  const dayCount = useMemo(() => {
    const raw = diffDays(startDate, endDate);
    return halfDay ? 0.5 : raw;
  }, [startDate, endDate, halfDay]);

  const totalRemaining = useMemo(() => {
    if (!balance) return null;
    return ["CASUAL", "SICK", "EARNED"].reduce((s, k) => {
      const v = balance[k];
      return s + (v && typeof v === "object" ? Number(v.remaining) || 0 : 0);
    }, 0);
  }, [balance]);

  const breakdown = useMemo(() => {
    if (!balance) return [];
    const rows = [];
    if (balance.CASUAL) rows.push({ key: "casual", label: "Casual", value: balance.CASUAL.remaining ?? 0 });
    if (balance.SICK)   rows.push({ key: "sick",   label: "Sick",   value: balance.SICK.remaining   ?? 0 });
    if (balance.EARNED) rows.push({ key: "earned", label: "Earned", value: balance.EARNED.remaining ?? 0 });
    return rows;
  }, [balance]);

  // Days already consumed this calendar month from balance-backed leaves
  // (approved + still-pending count against balance). Used to gate the
  // "you have already taken leave" confirmation popup.
  const daysUsedThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return history.reduce((sum, r) => {
      const type = (r.LEAVE_TYPE || "").toUpperCase();
      if (!BALANCE_DEDUCTING_TYPES.has(type)) return sum;
      const status = (r.STATUS || "").toUpperCase();
      if (status !== "APPROVED" && status !== "PENDING") return sum;
      const start = r.START_DATE ? new Date(r.START_DATE) : null;
      if (!start || isNaN(start)) return sum;
      if (start < monthStart || start >= monthEnd) return sum;
      return sum + (Number(r.DAYS) || 0);
    }, 0);
  }, [history]);


  // ---- Validation ----
  const validationError = (() => {
    if (!startDate) return "Please choose a start date.";
    if (!endDate)   return "Please choose an end date.";
    if (new Date(endDate) < new Date(startDate)) return "End date must be on or after the start date.";
    if (halfDay && startDate !== endDate) return "Half-day leave must be a single date.";
    if (!reason.trim()) return "Please provide a reason for your leave request.";
    return null;
  })();


  // Actual API call — kept separate so the balance-confirmation modal
  // can call it on OK without having to re-run form validation.
  const doSubmit = useCallback(async () => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await API.post("/leave/apply", {
        EMPLOYEE_ID: employeeId,
        LEAVE_TYPE:  leaveType,
        START_DATE:  startDate,
        END_DATE:    halfDay ? startDate : endDate,
        HALF_DAY:    halfDay,
        DAYS:        dayCount,
        REASON:      reason.trim() || null,
      });
      setSuccess("Leave request submitted. Your manager has been notified.");
      setReason("");
      setHalfDay(false);
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
    employeeId, leaveType, startDate, endDate,
    halfDay, dayCount, reason, onSubmitted, refresh,
  ]);

  // ---- Submit ----
  const submit = useCallback((e) => {
    e.preventDefault();
    if (validationError) { setError(validationError); return; }
    if (!employeeId)     { setError("Employee not identified — please log in again."); return; }

    // Confirmation popup — fires when the employee already used at
    // least one balance-backed leave day this month AND is now asking
    // for two or more additional days from a balance-consuming type.
    // Purely informational; a confirmation click proceeds normally.
    const willDeduct = BALANCE_DEDUCTING_TYPES.has(leaveType);
    if (willDeduct && daysUsedThisMonth >= 1 && dayCount >= 2) {
      setShowBalanceConfirm(true);
      return;
    }

    doSubmit();
  }, [
    validationError, employeeId, leaveType,
    daysUsedThisMonth, dayCount, doSubmit,
  ]);

  const confirmAndSubmit = useCallback(() => {
    setShowBalanceConfirm(false);
    doSubmit();
  }, [doSubmit]);


  // ==================================================================
  // Render
  // ==================================================================
  return (
    <div className={styles.wrap}>

      {/* ---------- Balance strip ---------- */}
      <section className={styles.balance}>
        <div className={styles.balanceHead}>
          <span className={styles.balanceIcon}>{I.calendar}</span>
          <div>
            <div className={styles.balanceTitle}>Leave balance</div>
            <div className={styles.balanceValue}>
              {totalRemaining ?? "—"}
              <small>days available</small>
            </div>
          </div>
        </div>

        {breakdown.length > 0 && (
          <div className={styles.balanceBreakdown}>
            {breakdown.map((r) => (
              <span
                key={r.key}
                className={`${styles.breakdownPill} ${styles[`breakdownPill_${r.key}`]}`}
              >
                {r.label} <b>{r.value}</b>
              </span>
            ))}
          </div>
        )}
      </section>


      {/* ---------- Apply form ---------- */}
      <section className={styles.cardWide}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>Apply for leave</div>
          <div className={styles.sectionSub}>
            Manager approval required · submitted requests are non-editable
          </div>
        </div>

        {error   && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        <form className={styles.form} onSubmit={submit}>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Leave type</label>
              <select
                className={styles.select}
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Duration</label>
              <div className={styles.subChoice}>
                <button
                  type="button"
                  className={`${styles.subChoiceBtn} ${!halfDay ? styles.subChoiceBtn_active : ""}`}
                  onClick={() => setHalfDay(false)}
                >
                  Full day
                </button>
                <button
                  type="button"
                  className={`${styles.subChoiceBtn} ${halfDay ? styles.subChoiceBtn_active : ""}`}
                  onClick={() => { setHalfDay(true); setEndDate(startDate); }}
                >
                  Half day
                </button>
              </div>
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={`${styles.label} ${styles.labelRequired}`}>Start date</label>
              <input
                type="date"
                className={styles.input}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (halfDay || new Date(endDate) < new Date(e.target.value)) {
                    setEndDate(e.target.value);
                  }
                }}
                min={todayISO()}
              />
            </div>

            {!halfDay ? (
              <div className={styles.field}>
                <label className={`${styles.label} ${styles.labelRequired}`}>End date</label>
                <input
                  type="date"
                  className={styles.input}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || todayISO()}
                />
              </div>
            ) : (
              <div className={styles.field}>
                <label className={styles.label}>Half of the day</label>
                <div className={styles.subChoice}>
                  <button
                    type="button"
                    className={`${styles.subChoiceBtn} ${halfDaySide === "FIRST" ? styles.subChoiceBtn_active : ""}`}
                    onClick={() => setHalfDaySide("FIRST")}
                  >
                    First half
                  </button>
                  <button
                    type="button"
                    className={`${styles.subChoiceBtn} ${halfDaySide === "SECOND" ? styles.subChoiceBtn_active : ""}`}
                    onClick={() => setHalfDaySide("SECOND")}
                  >
                    Second half
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className={styles.computed}>
            You're applying for <b>{dayCount === 0.5 ? "0.5" : dayCount}</b> {dayCount === 1 ? "day" : "days"} of {LEAVE_TYPES.find((t) => t.value === leaveType)?.label || "leave"}.
          </div>

          <div className={styles.field}>
            <label className={`${styles.label} ${styles.labelRequired}`}>
              Reason
            </label>
            <textarea
              className={styles.textarea}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the reason for your leave — your manager sees this"
            />
            <div className={styles.hint}>
              This goes to your manager along with the request. Submitting sends an approval email to your reporting manager.
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
          <div className={styles.sectionTitle}>My leave requests</div>
          <div className={styles.sectionSub}>
            {history.length} in total
          </div>
        </div>

        {history.length === 0 ? (
          <div className={styles.empty}>
            {I.empty}
            <div>
              <div className={styles.emptyTitle}>No leave requests yet</div>
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
              const range = r.START_DATE === r.END_DATE
                ? fmtDate(r.START_DATE)
                : `${fmtDate(r.START_DATE)} → ${fmtDate(r.END_DATE)}`;
              return (
                <li key={r.ID} className={styles.historyRow}>
                  <span className={styles.historyBadge}>{I.calendar}</span>
                  <div className={styles.historyBody}>
                    <div className={styles.historyTitle}>
                      <span>{(r.LEAVE_TYPE || "—")}</span>
                      <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: 12 }}>
                        {" · "}{r.DAYS || 0} day{r.DAYS === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className={styles.historyMeta}>
                      {range}
                      {r.REASON ? ` · ${r.REASON}` : ""}
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

      {/* -------- Balance-deduction confirmation modal -------- */}
      {showBalanceConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowBalanceConfirm(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: 14,
              maxWidth: 400,
              width: "100%",
              padding: "22px 22px 18px",
              boxShadow: "0 30px 60px rgba(15,23,42,0.35)",
              fontFamily: "inherit",
              color: "#1e293b",
            }}
          >
            <div style={{
              fontSize: 15, fontWeight: 800, marginBottom: 8, color: "#0f172a",
            }}>
              Balance deduction
            </div>
            <div style={{
              fontSize: 13.5, color: "#475569", lineHeight: 1.55, marginBottom: 18,
            }}>
              You have already taken leave. This leave will be deducted from your leave balance.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowBalanceConfirm(false)}
                style={{
                  padding: "9px 16px", borderRadius: 8, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 600, fontSize: 13,
                  background: "#ffffff", color: "#475569",
                  border: "1px solid #e2e8f0",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAndSubmit}
                autoFocus
                style={{
                  padding: "9px 18px", borderRadius: 8, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 700, fontSize: 13,
                  background: "#dc2626", color: "#ffffff",
                  border: "1px solid #dc2626",
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
