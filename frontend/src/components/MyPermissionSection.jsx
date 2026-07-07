/*
 * MyPermissionSection — employee-facing hourly permission requests.
 *
 * Policy:
 *   • Max 4 hours of paid permission per calendar month.
 *   • Requests count toward the cap the moment they're submitted
 *     (PENDING + APPROVED), so an employee can't stack pending
 *     requests past the limit while waiting for approval.
 *   • Manager / HR approves via the same email-token flow as leaves.
 *
 * Backend:
 *   POST   /leave/apply-permission          submit
 *   GET    /leave/my-permissions?employee_id=X
 *   GET    /leave/permission-balance/{id}   current-month usage
 *   POST   /leave/{id}/cancel               withdraw a PENDING row
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./MyPermissionSection.module.css";


const STATUS_THEME = {
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#92400e", label: "Pending" },
  APPROVED:         { bg: "#dcfce7", fg: "#166534", label: "Approved" },
  REJECTED:         { bg: "#fee2e2", fg: "#991b1b", label: "Rejected" },
  CANCELLED:        { bg: "#f1f5f9", fg: "#475569", label: "Cancelled" },
  EXPIRED:          { bg: "#f1f5f9", fg: "#475569", label: "Expired" },
};


function StatusPill({ status }) {
  const theme = STATUS_THEME[(status || "").toUpperCase()] || {
    bg: "#f1f5f9", fg: "#475569", label: status || "—",
  };
  return (
    <span
      className={styles.pill}
      style={{ background: theme.bg, color: theme.fg }}
    >
      <span className={styles.pillDot} style={{ background: theme.fg }} />
      {theme.label}
    </span>
  );
}


function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function dayNumber(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.getDate();
}

function monthShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
}


// ---------------------------------------------------------------------
// Balance ring — pure SVG, two concentric circles
// ---------------------------------------------------------------------

function BalanceRing({ used, cap }) {

  const size = 156;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const capSafe = cap > 0 ? cap : 1;
  const pct = Math.min(100, (used / capSafe) * 100);
  const dashOffset = c - (pct / 100) * c;

  const remaining = Math.max(0, cap - used);
  const overCap = used > cap;

  // Ring colour: green under 50%, amber 50-90%, red past 90% / over
  const ringColour =
    overCap || pct >= 100 ? "#dc2626"
    : pct >= 90 ? "#f59e0b"
    : pct >= 50 ? "#f59e0b"
    : "#16a34a";

  return (
    <div className={styles.ringWrap}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={stroke}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.2s" }}
        />
      </svg>

      {/* Centre text — remaining hours */}
      <div className={styles.ringCentre}>
        <div className={styles.ringLabel}>Remaining</div>
        <div
          className={styles.ringValue}
          style={{ color: remaining > 0 ? "#0f172a" : "#dc2626" }}
        >
          {remaining.toFixed(1)}
          <span>h</span>
        </div>
        <div className={styles.ringSub}>of {cap.toFixed(1)}h</div>
      </div>
    </div>
  );
}


// =====================================================================
// Main component
// =====================================================================

export default function MyPermissionSection({ employeeId }) {

  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast]     = useState("");

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const refresh = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const [balRes, histRes] = await Promise.all([
        API.get(`/leave/permission-balance/${encodeURIComponent(employeeId)}`),
        API.get("/leave/my-permissions", { params: { employee_id: employeeId } }),
      ]);
      setBalance(balRes.data || null);
      setHistory(Array.isArray(histRes.data) ? histRes.data : []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { refresh(); }, [refresh]);

  const cancel = async (row) => {
    if (!window.confirm(`Withdraw your ${row.DURATION_HOURS}h permission request for ${fmtDate(row.START_DATE)}?`)) return;
    try {
      await API.post(`/leave/${row.ID}/cancel`);
      setToast("Request withdrawn");
      refresh();
    } catch (err) {
      setToast(err?.response?.data?.detail || "Could not withdraw.");
    }
  };

  const cap        = Number(balance?.cap_hours       ?? 4);
  const used       = Number(balance?.used_hours      ?? 0);
  const pending    = Number(balance?.pending_hours   ?? 0);
  const remaining  = Number(balance?.remaining_hours ?? Math.max(0, cap - used));
  const canRequest = balance ? !!balance.can_request : true;

  const monthLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }, []);

  return (
    <div className={styles.wrap}>

      {/* =============================================================
          HERO — balance ring + stat rail
          ============================================================= */}
      <section className={styles.hero}>

        <div className={styles.heroHeader}>
          <div>
            <div className={styles.eyebrow}>Permission balance</div>
            <div className={styles.heroTitle}>{monthLabel}</div>
          </div>
          <button
            type="button"
            className={styles.newBtn}
            disabled={!canRequest || loading}
            onClick={() => setShowForm(true)}
            title={canRequest ? "Submit a new permission request"
                              : "Monthly limit reached"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.6"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Permission
          </button>
        </div>

        <div className={styles.heroBody}>

          <BalanceRing used={used} cap={cap} />

          <div className={styles.heroStats}>

            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Used</div>
              <div className={styles.heroStatValue}>
                {used.toFixed(1)}<span>h</span>
              </div>
            </div>

            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Pending</div>
              <div
                className={styles.heroStatValue}
                style={{ color: pending > 0 ? "#d97706" : "#0f172a" }}
              >
                {pending.toFixed(1)}<span>h</span>
              </div>
            </div>

            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Monthly cap</div>
              <div className={styles.heroStatValue}>
                {cap.toFixed(1)}<span>h</span>
              </div>
            </div>

          </div>
        </div>

        {!canRequest && (
          <div className={styles.limitBanner}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round"
                 aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <div>
              <div className={styles.limitBannerTitle}>
                Monthly permission limit reached
              </div>
              <div className={styles.limitBannerSub}>
                Contact HR if you need an override for operational reasons.
              </div>
            </div>
          </div>
        )}
      </section>

      {showForm && (
        <PermissionForm
          employeeId={employeeId}
          maxHoursAvailable={remaining}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            setToast("Request submitted — waiting for approval");
            refresh();
          }}
        />
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}


// =====================================================================
// Submission form (modal)
// =====================================================================

function PermissionForm({ employeeId, maxHoursAvailable, onClose, onSaved }) {

  const today = new Date().toISOString().slice(0, 10);

  const [date,     setDate]     = useState(today);
  const [hours,    setHours]    = useState("1");
  const [subtype,  setSubtype]  = useState("SHORT_PERMISSION");
  const [reason,   setReason]   = useState("");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");

    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
      setError("Enter the number of hours you need.");
      return;
    }
    if (h > maxHoursAvailable) {
      setError(
        `You only have ${maxHoursAvailable.toFixed(1)}h remaining this month — ` +
        `please request at most that.`
      );
      return;
    }
    if (!reason.trim()) {
      setError("A short reason is required.");
      return;
    }

    setSaving(true);
    try {
      await API.post("/leave/apply-permission", {
        EMPLOYEE_ID:        employeeId,
        PERMISSION_DATE:    date,
        DURATION_HOURS:     h,
        PERMISSION_SUBTYPE: subtype,
        REASON:             reason.trim(),
      });
      onSaved?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not submit the request.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className={styles.modal}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalEyebrow}>Permission Request</div>
          <div className={styles.modalTitle}>Ask for time off during working hours</div>
          <div className={styles.modalSub}>
            You have {maxHoursAvailable.toFixed(1)}h remaining this month (of 4h cap).
          </div>
        </div>

        <div className={styles.modalBody}>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.input}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Hours *</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                max={maxHoursAvailable}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Type</label>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className={styles.input}
            >
              <option value="SHORT_PERMISSION">Short permission (errand / break)</option>
              <option value="LATE_COMING">Late coming</option>
              <option value="EARLY_EXIT">Early exit</option>
              <option value="HALF_DAY">Half day</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Reason *</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Bank appointment, family visit, medical checkup…"
              className={styles.input}
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </div>

          {error && (
            <div className={styles.errorBanner}>{error}</div>
          )}

          <div className={styles.modalActions}>
            <button type="button" onClick={onClose} className={styles.btnCancel}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={styles.btnSubmit}>
              {saving ? "Submitting…" : "Send request"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
