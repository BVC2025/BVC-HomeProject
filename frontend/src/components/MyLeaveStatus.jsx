// =====================================================================
// MyLeaveStatus — employee's own leave requests with live status.
//
// Sits below the AI chat on the Leave tab. Auto-refreshes via a
// `refreshSignal` prop bumped by the chat after a successful submit,
// and on a 30-second polling interval so newly-approved/rejected
// leaves appear without a manual reload.
// =====================================================================

import { useEffect, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";


const STATUS_THEME = {
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#854d0e", label: "Pending approval" },
  APPROVED:         { bg: "#dcfce7", fg: "#166534", label: "Approved" },
  REJECTED:         { bg: "#fee2e2", fg: "#991b1b", label: "Rejected" },
  CANCELLED:        { bg: "#f1f5f9", fg: "#475569", label: "Cancelled" },
  EXPIRED:          { bg: "#f1f5f9", fg: "#475569", label: "Expired" },
};


export default function MyLeaveStatus({ employeeId, refreshSignal = 0 }) {

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [cancelling, setCancelling] = useState(null);

  const load = async () => {
    if (!employeeId) return;
    try {
      const res = await API.get(
        `/leave/my-requests?employee_id=${encodeURIComponent(employeeId)}`
      );
      setRows(Array.isArray(res.data) ? res.data : []);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't load your leave history.");
    } finally {
      setLoading(false);
    }
  };

  // Initial load + when the chat tells us to refresh
  useEffect(() => { load(); }, [employeeId, refreshSignal]);

  // Auto-refresh every 30s while the tab is open so approvals appear
  // without the employee having to reload.
  useEffect(() => {
    if (!employeeId) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [employeeId]);

  const cancel = async (lr) => {
    if (!window.confirm(
      `Cancel your ${lr.LEAVE_TYPE} leave for ${lr.START_DATE} to ${lr.END_DATE}?`
    )) return;
    setCancelling(lr.ID);
    try {
      await API.patch(`/leave/${lr.ID}/cancel`);
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Cancel failed.");
    } finally {
      setCancelling(null);
    }
  };

  const pending  = rows.filter((r) => r.STATUS === "PENDING_APPROVAL").length;
  const approved = rows.filter((r) => r.STATUS === "APPROVED").length;
  const rejected = rows.filter((r) => r.STATUS === "REJECTED").length;

  return (
    <div style={{
      background: "white",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      marginTop: 16,
      overflow: "hidden",
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
    }}>

      {/* Header */}
      <div style={{
        padding: "14px 18px",
        borderBottom: "1px solid #f1f5f9",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
      }}>
        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 800,
            color: BVC_RED,
            letterSpacing: 1.6,
            textTransform: "uppercase",
          }}>
            My Leave Requests
          </div>
          <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
            Track approval status from your manager
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <Pill label="Pending"  count={pending}  theme={STATUS_THEME.PENDING_APPROVAL} />
          <Pill label="Approved" count={approved} theme={STATUS_THEME.APPROVED} />
          <Pill label="Rejected" count={rejected} theme={STATUS_THEME.REJECTED} />
          <button
            onClick={load}
            title="Refresh"
            style={{
              padding: "4px 10px",
              background: "white",
              color: "#475569",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 14 }}>
        {loading && (
          <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 13, padding: 10 }}>
            Loading your leave history…
          </div>
        )}

        {error && (
          <div style={{
            padding: 10,
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div style={{
            padding: 18,
            background: "#fafbfc",
            border: "1px dashed #cbd5e1",
            borderRadius: 10,
            textAlign: "center",
            color: "#64748b",
            fontSize: 13,
          }}>
            No leave requests yet. Use the chat above to apply for one — it'll
            show up here with live approval status.
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((lr) => (
              <LeaveRow
                key={lr.ID}
                lr={lr}
                cancelling={cancelling === lr.ID}
                onCancel={() => cancel(lr)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// -------------------- LeaveRow --------------------

function LeaveRow({ lr, cancelling, onCancel }) {
  const theme = STATUS_THEME[lr.STATUS] || {
    bg: "#f1f5f9", fg: "#475569", label: lr.STATUS,
  };
  const canCancel = lr.STATUS === "PENDING_APPROVAL" || lr.STATUS === "APPROVED";

  // "Manager" line: prefer email of approver if recorded, else show pending
  const approver = lr.APPROVED_BY_EMAIL || "(pending manager)";
  const resolvedAt = lr.APPROVAL_RESOLVED_AT
    ? new Date(lr.APPROVAL_RESOLVED_AT).toLocaleString("en-IN", {
        dateStyle: "medium", timeStyle: "short",
      })
    : null;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      gap: 14,
      padding: "12px 14px",
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      background: "#fafbfc",
      alignItems: "flex-start",
    }}>

      {/* Left rail — status colour bar */}
      <div style={{
        width: 4,
        alignSelf: "stretch",
        background: theme.fg,
        borderRadius: 2,
      }} />

      {/* Center — content */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 4,
        }}>
          <span style={{
            fontSize: 14,
            fontWeight: 800,
            color: "#0f172a",
          }}>
            #{lr.ID} &middot; {lr.LEAVE_TYPE}
          </span>
          <span style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 800,
            background: theme.bg,
            color: theme.fg,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}>
            {theme.label}
          </span>
        </div>

        <div style={{ fontSize: 13, color: "#475569" }}>
          {lr.START_DATE} → {lr.END_DATE} &middot; <b>{lr.DAYS}</b> day
          {lr.DAYS == 1 ? "" : "s"}
        </div>

        {lr.REASON && (
          <div style={{
            fontSize: 12,
            color: "#64748b",
            marginTop: 3,
            fontStyle: "italic",
          }}>
            "{lr.REASON}"
          </div>
        )}

        {/* Approver / resolution info */}
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
          {lr.STATUS === "PENDING_APPROVAL" && (
            <>Awaiting decision from {approver}</>
          )}
          {lr.STATUS === "APPROVED" && (
            <>
              Approved by <b style={{ color: "#166534" }}>{approver}</b>
              {resolvedAt && <> on {resolvedAt}</>}
            </>
          )}
          {lr.STATUS === "REJECTED" && (
            <>
              Rejected
              {approver !== "(pending manager)" && (
                <> by <b style={{ color: "#991b1b" }}>{approver}</b></>
              )}
              {resolvedAt && <> on {resolvedAt}</>}
            </>
          )}
          {lr.STATUS === "CANCELLED" && <>Cancelled by you</>}
        </div>

        {lr.STATUS === "REJECTED" && lr.REJECTION_REASON && (
          <div style={{
            marginTop: 6,
            padding: "6px 10px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#7f1d1d",
            borderRadius: 6,
            fontSize: 12,
          }}>
            <b>Manager note:</b> {lr.REJECTION_REASON}
          </div>
        )}
      </div>

      {/* Right — actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {canCancel && (
          <button
            onClick={onCancel}
            disabled={cancelling}
            style={{
              padding: "6px 12px",
              background: cancelling ? "#f1f5f9" : "white",
              color: cancelling ? "#94a3b8" : "#b91c1c",
              border: "1px solid #fecaca",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: cancelling ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {cancelling ? "..." : "Cancel"}
          </button>
        )}
        <div style={{
          fontSize: 10,
          color: "#94a3b8",
          fontFamily: "ui-monospace, monospace",
          textAlign: "right",
        }}>
          {lr.CREATED_AT
            ? new Date(lr.CREATED_AT).toLocaleDateString("en-IN")
            : ""}
        </div>
      </div>
    </div>
  );
}


// -------------------- Pill --------------------

function Pill({ label, count, theme }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      background: theme.bg,
      color: theme.fg,
    }}>
      <span style={{ letterSpacing: 0.3 }}>{label}</span>
      <span style={{
        background: "rgba(255,255,255,0.7)",
        color: theme.fg,
        padding: "0 6px",
        borderRadius: 999,
        fontWeight: 800,
      }}>
        {count}
      </span>
    </span>
  );
}
