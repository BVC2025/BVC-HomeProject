import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";
import styles from "./ApplyLeave.module.css";


// Standalone "Apply Leave" page for employees. Accessible at
// `/apply-leave?employee_id=...` so the employee dashboard /
// kiosk can link straight to it; no admin auth required.


const TYPE_THEMES = {
  CASUAL: "#3b82f6",
  SICK: "#ef4444",
  EARNED: "#10b981",
  UNPAID: "#94a3b8",
  LOP: "#6b7280"
};


const STATUS_THEMES = {
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#854d0e", label: "Pending MD Approval" },
  APPROVED: { bg: "#dcfce7", fg: "#166534", label: "Approved" },
  REJECTED: { bg: "#fee2e2", fg: "#b91c1c", label: "Rejected" },
  CANCELLED: { bg: "#f1f5f9", fg: "#475569", label: "Cancelled" }
};


function todayIso() {

  return new Date().toISOString().slice(0, 10);
}


function BalanceCard({ balance }) {

  if (!balance) return null;

  return (

    <div className={styles.balanceCardGrid}>

      {["CASUAL", "SICK", "EARNED"].map((t) => {

        const b = balance[t];

        const pct = (b.remaining / b.total) * 100;

        return (

          <div
            key={t}
            className={styles.balanceTileCard}
            style={{ borderTop: `3px solid ${TYPE_THEMES[t]}` }}
          >

            <div className={styles.balanceTileLabel}>
              {t} Leave
            </div>

            <div className={styles.balanceTileValue}>
              {b.remaining}
              <span className={styles.balanceTileTotal}>
                {" "}/ {b.total} days
              </span>
            </div>

            <div className={styles.balanceProgressTrack}>
              <div
                className={styles.balanceProgressFill}
                style={{ width: `${pct}%`, background: TYPE_THEMES[t] }}
              />
            </div>

            <div className={styles.balanceUsed}>
              {b.used} used
            </div>
          </div>
        );
      })}
    </div>
  );
}


// BVC24 leave policy: every leave (including half-day / one-day)
// needs manager approval. Reason is required for every request.
// Keep this in sync with MAX_DAYS_NO_REASON_OR_APPROVAL in leave.py.
const MAX_DAYS_NO_APPROVAL = 0;


// Compute leave-day count from date range, honouring half-day toggle.
function computeDays(startIso, endIso, halfDay) {

  if (halfDay) return 0.5;

  if (!startIso || !endIso) return 0;

  const start = new Date(startIso);

  const end = new Date(endIso);

  if (isNaN(start) || isNaN(end) || end < start) return 0;

  const diffMs = end - start;

  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}


function ApplyLeaveForm({ employeeId, onApplied }) {

  const [leaveType, setLeaveType] = useState("CASUAL");

  const [startDate, setStartDate] = useState(todayIso());

  const [endDate, setEndDate] = useState(todayIso());

  const [reason, setReason] = useState("");

  const [halfDay, setHalfDay] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  // Live-computed values that drive the UI policy hints
  const days = computeDays(startDate, endDate, halfDay);

  const needsApproval = days > MAX_DAYS_NO_APPROVAL;

  const reasonRequired = needsApproval;

  const submit = async (e) => {

    e.preventDefault();

    if (reasonRequired && !reason.trim()) {

      setError(
        "A reason is required — every leave goes to your manager for approval."
      );

      return;
    }

    if (days <= 0) {

      setError("Please pick a valid date range.");

      return;
    }

    setSubmitting(true);

    setError("");

    setResult(null);

    try {

      const res = await API.post("/leave/apply", {
        EMPLOYEE_ID: employeeId,
        LEAVE_TYPE: leaveType,
        START_DATE: startDate,
        END_DATE: endDate,
        REASON: reason.trim() || null,
        HALF_DAY: halfDay
      });

      setResult(res.data);

      setReason("");

      onApplied?.();

    } catch (err) {

      setError(err?.response?.data?.detail || "Failed to apply");

    } finally {

      setSubmitting(false);
    }
  };

  return (

    <div className={styles.sectionCard}>

      <div className={styles.sectionCardTitle}>
        Apply for Leave
      </div>

      <PolicyBanner days={days} needsApproval={needsApproval} />

      <form onSubmit={submit}>

        <div className={styles.formGrid3}>

          <div>

            <label className={styles.fieldLabel}>
              Leave Type
            </label>

            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              className={styles.select}
            >
              <option value="CASUAL">Casual</option>
              <option value="SICK">Sick</option>
              <option value="EARNED">Earned</option>
              <option value="UNPAID">Unpaid</option>
              <option value="LOP">Loss of Pay</option>
            </select>
          </div>

          <div>

            <label className={styles.fieldLabel}>
              From
            </label>

            <input
              type="date"
              value={startDate}
              onChange={(e) => {

                setStartDate(e.target.value);

                if (e.target.value > endDate) {

                  setEndDate(e.target.value);
                }
              }}
              className={styles.input}
            />
          </div>

          <div>

            <label className={styles.fieldLabel}>
              To
            </label>

            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={halfDay}
              className={styles.input}
              style={halfDay ? { background: "var(--surface)" } : undefined}
            />
          </div>
        </div>

        <label className={styles.halfDayLabel}>
          <input
            type="checkbox"
            checked={halfDay}
            onChange={(e) => {

              setHalfDay(e.target.checked);

              if (e.target.checked) setEndDate(startDate);
            }}
          />
          Half-day leave (0.5 day)
        </label>

        <div>

          <label className={styles.fieldLabel}>
            Reason{" "}
            <span className={styles.reasonRequired}>
              * REQUIRED — every leave needs manager approval
            </span>
          </label>

          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={
              reasonRequired
                ? "Required — manager will read this before approving..."
                : "Optional — write only if you want to add context"
            }
            className={styles.textarea}
            style={
              reasonRequired && !reason.trim()
                ? { borderColor: "#fca5a5", background: "#fef2f2" }
                : undefined
            }
          />
        </div>

        {error && (
          <div className={styles.formError}>
            {error}
          </div>
        )}

        {result && <ResultStepper result={result} />}

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 16,
            border: "none",
            background: submitting
              ? "#94a3b8"
              : needsApproval
                ? "#f59e0b"
                : "#10b981",
            color: "white",
            padding: "12px 24px",
            borderRadius: 8,
            fontWeight: 700,
            cursor: submitting ? "not-allowed" : "pointer",
            fontSize: 14,
            boxShadow: needsApproval
              ? "0 6px 18px rgba(245,158,11,0.35)"
              : "0 6px 18px rgba(16,185,129,0.35)"
          }}
        >
          {submitting
            ? "Submitting…"
            : `📧 Submit for Manager Approval (${days} day${days === 1 ? "" : "s"})`}
        </button>
      </form>
    </div>
  );
}


// ----------------------------------------------------------------
// Policy banner — sits above the form and explains the BVC24 rule
// in plain English, with the current day count highlighted.
// ----------------------------------------------------------------

function PolicyBanner({ days, needsApproval }) {

  return (

    <div
      style={{
        background: needsApproval
          ? "#fef9c3"
          : "#ecfdf5",
        border: `1px solid ${needsApproval ? "#fde68a" : "#a7f3d0"}`,
        borderRadius: 10,
        padding: 14,
        marginBottom: 18,
        fontSize: 13,
        lineHeight: 1.55
      }}
    >

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6
        }}
      >

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: needsApproval ? "#92400e" : "#065f46",
            textTransform: "uppercase"
          }}
        >
          BVC24 Leave Policy
        </div>

        <div
          style={{
            background: needsApproval ? "#f59e0b" : "#10b981",
            color: "white",
            padding: "3px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6
          }}
        >
          This request: {days || 0} day{days === 1 ? "" : "s"}
        </div>
      </div>

      <div style={{ color: "#7c2d12" }}>
        Every leave — <strong>including half-day and one-day requests</strong> —
        needs <strong>manager approval</strong>. A{" "}
        <strong>reason is required</strong> on every request. Your
        balance is deducted only after the manager approves; on
        rejection you&apos;ll receive a notification.
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Result stepper — visual 4-step process flow that lights up the
// steps actually completed for this request.
// ----------------------------------------------------------------

function ResultStepper({ result }) {

  const isAuto = result.auto_approved;

  // Steps that always happen
  const steps = [
    {
      label: "Submitted",
      done: true,
      desc: `${result.days_requested || result.leave?.DAYS} day(s) recorded`
    },
    {
      label: "Manager review",
      done: isAuto,
      pending: !isAuto,
      desc: isAuto
        ? "Approved — balance updated"
        : "Email sent — awaiting response"
    },
    {
      label: isAuto ? "Email confirmation sent" : "On approval — email + in-app",
      done: isAuto,
      pending: !isAuto,
      desc: isAuto
        ? "Check your inbox"
        : "Manager clicks Approve → you’ll be notified"
    },
    {
      label: "Leave balance updated",
      done: isAuto,
      pending: !isAuto,
      desc: isAuto
        ? "Days deducted from balance"
        : "Deduction happens on manager approval"
    }
  ];

  return (

    <div className={styles.stepperCard}>

      <div className={styles.stepperHeader}>

        <span
          className={styles.stepperIconWrap}
          style={{
            background: isAuto ? "#dcfce7" : "#fef3c7",
            color: isAuto ? "#166534" : "#854d0e"
          }}
        >
          {isAuto ? "✓" : "⏳"}
        </span>

        <div>

          <div className={styles.stepperTitle}>
            {isAuto ? "Leave Auto-Approved" : "Sent for Manager Approval"}
          </div>

          <div className={styles.stepperMessage}>
            {result.message}
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div className={styles.stepperList}>

        {steps.map((s, i) => (

          <div
            key={i}
            className={styles.stepRow}
            style={{ opacity: s.done || s.pending ? 1 : 0.45 }}
          >

            <div className={styles.stepIndicatorCol}>

              <div
                className={styles.stepDot}
                style={{
                  background: s.done
                    ? "#10b981"
                    : s.pending
                      ? "#f59e0b"
                      : "#cbd5e1"
                }}
              >
                {s.done ? "✓" : s.pending ? "…" : i + 1}
              </div>

              {i < steps.length - 1 && (
                <div
                  className={styles.stepConnector}
                  style={{ background: s.done ? "#10b981" : "#cbd5e1" }}
                />
              )}
            </div>

            <div className={styles.stepContent}>

              <div
                className={styles.stepLabel}
                style={{
                  color: s.done
                    ? "#166534"
                    : s.pending
                      ? "#92400e"
                      : "#475569"
                }}
              >
                {s.label}
              </div>

              <div className={styles.stepDesc}>
                {s.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function MyRequestsTable({ rows, employeeId, onChanged }) {

  const cancel = async (id) => {

    if (!confirm("Cancel this leave request?")) return;

    try {

      await API.patch(`/leave/${id}/cancel`, { EMPLOYEE_ID: employeeId });

      onChanged?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  return (

    <div className={styles.tableCard}>

      <div className={styles.tableHeader}>
        My Leave Requests ({rows.length})
      </div>

      <div className={styles.tableScroll}>

        <table className={styles.table}>

          <thead>
            <tr className={styles.tableHeadRow}>
              <th className={styles.th}>Type</th>
              <th className={styles.th}>Dates</th>
              <th className={styles.thRight}>Days</th>
              <th className={styles.th}>Reason</th>
              <th className={styles.th}>Status</th>
              <th className={styles.thRight}>Action</th>
            </tr>
          </thead>

          <tbody>

            {rows.length === 0 && (

              <tr>
                <td colSpan="6" className={styles.tdEmpty}>
                  No leave requests yet.
                </td>
              </tr>
            )}

            {rows.map((r) => {

              const st = STATUS_THEMES[r.STATUS] || STATUS_THEMES.PENDING_APPROVAL;

              const canCancel =
                r.STATUS === "PENDING_APPROVAL" || r.STATUS === "APPROVED";

              return (

                <tr key={r.ID} className={styles.tdRow}>

                  <td className={styles.td}>

                    <span
                      className={styles.typeBadge}
                      style={{
                        background: `${TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"}22`,
                        color: TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"
                      }}
                    >
                      {r.LEAVE_TYPE}
                    </span>
                  </td>

                  <td className={styles.tdMuted}>

                    <div>{r.START_DATE}</div>

                    {r.END_DATE !== r.START_DATE && (

                      <div className={styles.endDate}>
                        → {r.END_DATE}
                      </div>
                    )}
                  </td>

                  <td className={styles.tdBold}>
                    {r.DAYS}
                  </td>

                  <td className={styles.tdMaxW}>
                    {r.REASON}

                    {r.REJECTION_REASON && (

                      <div className={styles.rejectionNote}>
                        {r.REJECTION_REASON}
                      </div>
                    )}
                  </td>

                  <td className={styles.td}>

                    <span
                      className={styles.statusBadge}
                      style={{ background: st.bg, color: st.fg }}
                    >
                      {st.label}
                    </span>
                  </td>

                  <td className={styles.tdRight}>

                    {canCancel ? (

                      <button
                        onClick={() => cancel(r.ID)}
                        className={styles.cancelBtn}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span className={styles.emDash}>&mdash;</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function ApplyLeave() {

  const navigate = useNavigate();

  // Authenticated-employee mode: when the user is logged in as an
  // employee, we hide the "Who are you?" picker (no impersonating
  // other employees) and turn "Switch user" into a real Logout.
  const isEmployeeAuth = (
    localStorage.getItem("auth") === "true"
    && localStorage.getItem("role") === "employee"
  );

  // Fallback name/code so the "Logged in as" card is correct even
  // before the /employees list has finished loading.
  const employeeNameFromAuth = localStorage.getItem("employee_name") || "";

  const employeeCodeFromAuth = localStorage.getItem("employee_id") || "";

  // Look up employee_id from URL query, then localStorage, then fall
  // back to a small picker so the demo never hits a dead end.
  const [employeeId, setEmployeeId] = useState(() => {

    const params = new URLSearchParams(window.location.search);

    return (
      params.get("employee_id")
      || localStorage.getItem("employee_id")
      || ""
    );
  });

  const [employees, setEmployees] = useState([]);

  const [balance, setBalance] = useState(null);

  const [myRequests, setMyRequests] = useState([]);

  const [loading, setLoading] = useState(false);

  const fetchEmployees = async () => {

    try {

      const res = await API.get("/employees");

      setEmployees(res.data || []);

    } catch (e) { /* non-critical */ }
  };

  const fetchData = async () => {

    if (!employeeId) return;

    setLoading(true);

    try {

      const [bRes, mRes] = await Promise.all([
        API.get(`/leave/balance/${employeeId}`),
        API.get(`/leave/my-requests`, {
          params: { employee_id: employeeId }
        })
      ]);

      setBalance(bRes.data.balance);

      setMyRequests(mRes.data || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchEmployees();

  }, []);

  useEffect(() => {

    fetchData();

  }, [employeeId]);

  // Match by UUID (when employee was picked from dropdown) OR by
  // EMPLOYEE_CODE (set when employee logged in via Login flow —
  // backend returns CODE as EMPLOYEE_ID).
  const selectedEmp = employees.find(
    (e) => e.ID === employeeId || e.EMPLOYEE_CODE === employeeId
  );

  return (

    <div className={styles.page}>

      <div className={styles.card}>

        <div className={styles.headerBlock}>

          <h1 className={styles.pageTitle}>
            My Leave
          </h1>

          <div className={styles.pageDesc}>
            Apply, track, and cancel your leave requests. Every
            leave — including half-day and one-day requests —
            needs your manager&apos;s approval before it takes effect.
          </div>
        </div>

        {/* Employee picker — only shown for kiosk/standalone use
            (not when logged in as employee, who must stay in their
            own context and can’t switch identity here) */}
        {!isEmployeeAuth && !employeeId && (

          <div className={styles.pickerCard}>

            <div className={styles.pickerLabel}>
              Who are you?
            </div>

            <select
              onChange={(e) => {

                setEmployeeId(e.target.value);

                localStorage.setItem("employee_id", e.target.value);
              }}
              className={styles.select}
            >
              <option value="">— pick your name —</option>
              {employees.map((e) => (
                <option key={e.ID} value={e.ID}>
                  {e.EMPLOYEE_CODE} — {e.NAME}
                </option>
              ))}
            </select>
          </div>
        )}

        {employeeId && (selectedEmp || isEmployeeAuth) && (

          <div className={styles.identityCard}>

            <div>

              <div className={styles.identityLabel}>
                Logged in as
              </div>

              <div className={styles.identityName}>
                {selectedEmp?.NAME || employeeNameFromAuth || "—"}
                {" "}
                <span className={styles.identityCode}>
                  ({selectedEmp?.EMPLOYEE_CODE || employeeCodeFromAuth})
                </span>
              </div>
            </div>

            <button
              onClick={() => {

                if (isEmployeeAuth) {

                  // Real logout — clear the whole session and bounce
                  // to the login screen.
                  if (!window.confirm("Logout?")) return;

                  localStorage.clear();

                  navigate("/login", { replace: true });

                } else {

                  // Kiosk / standalone mode — just clear the picked
                  // employee so the picker comes back.
                  setEmployeeId("");

                  localStorage.removeItem("employee_id");
                }
              }}
              className={styles.logoutBtn}
              style={{
                border: isEmployeeAuth ? "1px solid #fecaca" : "1px solid var(--border)",
                background: isEmployeeAuth ? "#fef2f2" : "var(--card-bg)",
                color: isEmployeeAuth ? "#b91c1c" : "var(--text-secondary)"
              }}
            >
              {isEmployeeAuth ? "↻ Logout" : "Switch user"}
            </button>
          </div>
        )}

        {employeeId && (

          <>

            <BalanceCard balance={balance} />

            <ApplyLeaveForm
              employeeId={employeeId}
              onApplied={fetchData}
            />

            <MyRequestsTable
              rows={myRequests}
              employeeId={employeeId}
              onChanged={fetchData}
            />
          </>
        )}
      </div>
    </div>
  );
}


export default ApplyLeave;
