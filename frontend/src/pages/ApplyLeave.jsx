import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";


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

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 14,
        marginBottom: 22
      }}
    >

      {["CASUAL", "SICK", "EARNED"].map((t) => {

        const b = balance[t];

        const pct = (b.remaining / b.total) * 100;

        return (

          <div
            key={t}
            style={{
              background: "white",
              padding: 16,
              borderRadius: 12,
              boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
              borderTop: `3px solid ${TYPE_THEMES[t]}`
            }}
          >

            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                color: "#64748b",
                textTransform: "uppercase"
              }}
            >
              {t} Leave
            </div>

            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: "#0f172a",
                marginTop: 6
              }}
            >
              {b.remaining}
              <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
                {" "}/ {b.total} days
              </span>
            </div>

            <div
              style={{
                height: 6,
                background: "#f1f5f9",
                borderRadius: 999,
                marginTop: 8,
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: TYPE_THEMES[t],
                  borderRadius: 999
                }}
              />
            </div>

            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                marginTop: 4
              }}
            >
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

    <div
      style={{
        background: "white",
        padding: 24,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 20
      }}
    >

      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "#0f172a",
          marginBottom: 6
        }}
      >
        Apply for Leave
      </div>

      <PolicyBanner days={days} needsApproval={needsApproval} />

      <form onSubmit={submit}>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 14
          }}
        >

          <div>

            <label
              style={{
                fontSize: 11,
                color: "#64748b",
                display: "block",
                marginBottom: 4,
                fontWeight: 600
              }}
            >
              Leave Type
            </label>

            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              style={{
                width: "100%",
                padding: "9px 10px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13
              }}
            >
              <option value="CASUAL">Casual</option>
              <option value="SICK">Sick</option>
              <option value="EARNED">Earned</option>
              <option value="UNPAID">Unpaid</option>
              <option value="LOP">Loss of Pay</option>
            </select>
          </div>

          <div>

            <label
              style={{
                fontSize: 11,
                color: "#64748b",
                display: "block",
                marginBottom: 4,
                fontWeight: 600
              }}
            >
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
              style={{
                width: "100%",
                padding: "9px 10px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13
              }}
            />
          </div>

          <div>

            <label
              style={{
                fontSize: 11,
                color: "#64748b",
                display: "block",
                marginBottom: 4,
                fontWeight: 600
              }}
            >
              To
            </label>

            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={halfDay}
              style={{
                width: "100%",
                padding: "9px 10px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
                background: halfDay ? "#f1f5f9" : "white"
              }}
            />
          </div>
        </div>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#475569",
            marginBottom: 14,
            cursor: "pointer"
          }}
        >
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

          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "block",
              marginBottom: 4,
              fontWeight: 600
            }}
          >
            Reason{" "}
            <span style={{ color: "#b91c1c" }}>
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
            style={{
              width: "100%",
              padding: 10,
              border: `1px solid ${
                reasonRequired && !reason.trim() ? "#fca5a5" : "#e2e8f0"
              }`,
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
              background:
                reasonRequired && !reason.trim() ? "#fef2f2" : "white"
            }}
          />
        </div>

        {error && (

          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              padding: 10,
              borderRadius: 6,
              fontSize: 13,
              marginTop: 12
            }}
          >
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
          ? "linear-gradient(135deg, #fef9c3 0%, #fef3c7 100%)"
          : "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
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
        rejection you'll receive a notification.
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
        : "Manager clicks Approve → you'll be notified"
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

    <div
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 16,
        marginTop: 16,
        boxShadow: "0 4px 14px rgba(15,23,42,0.04)"
      }}
    >

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: "1px solid #f1f5f9"
        }}
      >

        <span
          style={{
            fontSize: 22,
            background: isAuto ? "#dcfce7" : "#fef3c7",
            color: isAuto ? "#166534" : "#854d0e",
            width: 38,
            height: 38,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700
          }}
        >
          {isAuto ? "✓" : "⏳"}
        </span>

        <div>

          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#0f172a"
            }}
          >
            {isAuto ? "Leave Auto-Approved" : "Sent for Manager Approval"}
          </div>

          <div style={{ fontSize: 12, color: "#64748b" }}>
            {result.message}
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0
        }}
      >

        {steps.map((s, i) => (

          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              padding: "8px 0",
              opacity: s.done || s.pending ? 1 : 0.45
            }}
          >

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0
              }}
            >

              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: s.done
                    ? "#10b981"
                    : s.pending
                      ? "#f59e0b"
                      : "#cbd5e1",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                {s.done ? "✓" : s.pending ? "…" : i + 1}
              </div>

              {i < steps.length - 1 && (
                <div
                  style={{
                    width: 2,
                    flex: 1,
                    background: s.done ? "#10b981" : "#cbd5e1",
                    marginTop: 2,
                    minHeight: 18
                  }}
                />
              )}
            </div>

            <div style={{ flex: 1, paddingTop: 1 }}>

              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: s.done
                    ? "#166534"
                    : s.pending
                      ? "#92400e"
                      : "#475569"
                }}
              >
                {s.label}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  marginTop: 1
                }}
              >
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

    <div
      style={{
        background: "white",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
      }}
    >

      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #f1f5f9",
          fontSize: 14,
          fontWeight: 700,
          color: "#0f172a"
        }}
      >
        My Leave Requests ({rows.length})
      </div>

      <div style={{ overflow: "auto" }}>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13
          }}
        >

          <thead>
            <tr
              style={{
                background: "#f8fafc",
                color: "#475569",
                fontSize: 11,
                letterSpacing: 0.8,
                textTransform: "uppercase"
              }}
            >
              <th style={{ textAlign: "left", padding: 12 }}>Type</th>
              <th style={{ textAlign: "left", padding: 12 }}>Dates</th>
              <th style={{ textAlign: "right", padding: 12 }}>Days</th>
              <th style={{ textAlign: "left", padding: 12 }}>Reason</th>
              <th style={{ textAlign: "left", padding: 12 }}>Status</th>
              <th style={{ textAlign: "right", padding: 12 }}>Action</th>
            </tr>
          </thead>

          <tbody>

            {rows.length === 0 && (

              <tr>
                <td
                  colSpan="6"
                  style={{
                    padding: 30,
                    textAlign: "center",
                    color: "#94a3b8"
                  }}
                >
                  No leave requests yet.
                </td>
              </tr>
            )}

            {rows.map((r) => {

              const st = STATUS_THEMES[r.STATUS] || STATUS_THEMES.PENDING_APPROVAL;

              const canCancel =
                r.STATUS === "PENDING_APPROVAL" || r.STATUS === "APPROVED";

              return (

                <tr
                  key={r.ID}
                  style={{ borderBottom: "1px solid #f1f5f9" }}
                >

                  <td style={{ padding: 12 }}>

                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: `${TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"}22`,
                        color: TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"
                      }}
                    >
                      {r.LEAVE_TYPE}
                    </span>
                  </td>

                  <td style={{ padding: 12, color: "#475569" }}>

                    <div>{r.START_DATE}</div>

                    {r.END_DATE !== r.START_DATE && (

                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        → {r.END_DATE}
                      </div>
                    )}
                  </td>

                  <td
                    style={{
                      padding: 12,
                      textAlign: "right",
                      fontWeight: 700
                    }}
                  >
                    {r.DAYS}
                  </td>

                  <td
                    style={{
                      padding: 12,
                      color: "#475569",
                      maxWidth: 240
                    }}
                  >
                    {r.REASON}

                    {r.REJECTION_REASON && (

                      <div
                        style={{
                          fontSize: 11,
                          color: "#b91c1c",
                          marginTop: 4,
                          fontStyle: "italic"
                        }}
                      >
                        {r.REJECTION_REASON}
                      </div>
                    )}
                  </td>

                  <td style={{ padding: 12 }}>

                    <span
                      style={{
                        display: "inline-block",
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: st.bg,
                        color: st.fg
                      }}
                    >
                      {st.label}
                    </span>
                  </td>

                  <td style={{ padding: 12, textAlign: "right" }}>

                    {canCancel ? (

                      <button
                        onClick={() => cancel(r.ID)}
                        style={{
                          border: "1px solid #fecaca",
                          background: "white",
                          color: "#b91c1c",
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>—</span>
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

    <div
      style={{
        minHeight: "100vh",
        background: "#f1f5f9",
        padding: 32,
        fontFamily: "'Segoe UI', sans-serif"
      }}
    >

      <div
        style={{
          maxWidth: 900,
          margin: "0 auto"
        }}
      >

        <div style={{ marginBottom: 24 }}>

          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#0f172a",
              margin: 0
            }}
          >
            My Leave
          </h1>

          <div
            style={{
              fontSize: 13,
              color: "#64748b",
              marginTop: 4
            }}
          >
            Apply, track, and cancel your leave requests. Every
            leave — including half-day and one-day requests —
            needs your manager's approval before it takes effect.
          </div>
        </div>

        {/* Employee picker — only shown for kiosk/standalone use
            (not when logged in as employee, who must stay in their
            own context and can't switch identity here) */}
        {!isEmployeeAuth && !employeeId && (

          <div
            style={{
              background: "white",
              padding: 24,
              borderRadius: 12,
              boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
              marginBottom: 20
            }}
          >

            <div
              style={{
                fontSize: 14,
                color: "#0f172a",
                marginBottom: 10,
                fontWeight: 600
              }}
            >
              Who are you?
            </div>

            <select
              onChange={(e) => {

                setEmployeeId(e.target.value);

                localStorage.setItem("employee_id", e.target.value);
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                fontSize: 14
              }}
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

          <div
            style={{
              background: "white",
              padding: "14px 18px",
              borderRadius: 10,
              boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >

            <div>

              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontWeight: 600
                }}
              >
                Logged in as
              </div>

              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#0f172a"
                }}
              >
                {selectedEmp?.NAME || employeeNameFromAuth || "—"}
                {" "}
                <span
                  style={{
                    fontSize: 12,
                    color: "#94a3b8",
                    fontFamily: "ui-monospace, monospace"
                  }}
                >
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
              style={{
                border: isEmployeeAuth ? "1px solid #fecaca" : "1px solid #e2e8f0",
                background: isEmployeeAuth ? "#fef2f2" : "white",
                color: isEmployeeAuth ? "#b91c1c" : "#475569",
                padding: "6px 14px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              {isEmployeeAuth ? "⏻ Logout" : "Switch user"}
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
