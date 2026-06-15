import { useEffect, useState } from "react";

import API from "../services/api";


const STATUS_THEMES = {
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#854d0e", label: "Pending" },
  APPROVED: { bg: "#dcfce7", fg: "#166534", label: "Approved" },
  REJECTED: { bg: "#fee2e2", fg: "#b91c1c", label: "Rejected" },
  CANCELLED: { bg: "#f1f5f9", fg: "#475569", label: "Cancelled" },
  EXPIRED: { bg: "#f1f5f9", fg: "#94a3b8", label: "Expired" }
};


const TYPE_THEMES = {
  CASUAL: "#3b82f6",
  SICK: "#ef4444",
  EARNED: "#10b981",
  UNPAID: "#94a3b8",
  LOP: "#6b7280"
};


function Tile({ label, value, sub, color }) {

  return (

    <div
      style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        borderTop: `3px solid ${color}`
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
        {label}
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 6
        }}
      >
        {value}
      </div>

      {sub && (

        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            marginTop: 2
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}


function StatusPill({ status }) {

  const t = STATUS_THEMES[status] || STATUS_THEMES.PENDING_APPROVAL;

  return (

    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: t.bg,
        color: t.fg
      }}
    >
      {t.label}
    </span>
  );
}


function RejectDialog({ leaveId, onClose, onDone }) {

  const [reason, setReason] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {

    setSubmitting(true);

    try {

      await API.patch(`/leave/${leaveId}/reject`, {
        REJECTION_REASON: reason || "Rejected from dashboard"
      });

      onDone?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");

    } finally {

      setSubmitting(false);
    }
  };

  return (

    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 950
      }}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          padding: 24,
          borderRadius: 12,
          width: 460,
          maxWidth: "90%"
        }}
      >

        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#0f172a",
            marginBottom: 14
          }}
        >
          Reject leave request
        </div>

        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (sent to the employee by email)..."
          style={{
            width: "100%",
            padding: 10,
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical"
          }}
        />

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 16,
            justifyContent: "flex-end"
          }}
        >

          <button
            onClick={onClose}
            style={{
              border: "1px solid #e2e8f0",
              background: "white",
              padding: "8px 18px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13
            }}
          >
            Cancel
          </button>

          <button
            onClick={submit}
            disabled={submitting}
            style={{
              border: "none",
              background: submitting ? "#94a3b8" : "#ef4444",
              color: "white",
              padding: "8px 18px",
              borderRadius: 6,
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 13
            }}
          >
            {submitting ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}


function LeaveTable({ rows, onChanged, showActions }) {

  const [rejectingId, setRejectingId] = useState(null);

  const approve = async (id) => {

    if (!confirm("Approve this leave request?")) return;

    try {

      await API.patch(`/leave/${id}/approve`);

      onChanged?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  return (

    <>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

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
                <th style={{ textAlign: "left", padding: 12 }}>Employee</th>
                <th style={{ textAlign: "left", padding: 12 }}>Type</th>
                <th style={{ textAlign: "left", padding: 12 }}>Dates</th>
                <th style={{ textAlign: "right", padding: 12 }}>Days</th>
                <th style={{ textAlign: "left", padding: 12 }}>Reason</th>
                <th style={{ textAlign: "left", padding: 12 }}>Status</th>
                <th style={{ textAlign: "left", padding: 12 }}>Approved By</th>
                {showActions && (
                  <th style={{ textAlign: "right", padding: 12 }}>Action</th>
                )}
              </tr>
            </thead>

            <tbody>

              {rows.length === 0 && (

                <tr>
                  <td
                    colSpan={showActions ? 8 : 7}
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    No leave requests in this view.
                  </td>
                </tr>
              )}

              {rows.map((r) => (

                <tr
                  key={r.ID}
                  style={{ borderBottom: "1px solid #f1f5f9" }}
                >

                  <td style={{ padding: 12 }}>

                    <div style={{ fontWeight: 600, color: "#0f172a" }}>
                      {r.EMPLOYEE_NAME || "—"}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color: "#94a3b8",
                        fontFamily: "ui-monospace, monospace"
                      }}
                    >
                      {r.EMPLOYEE_CODE}
                    </div>
                  </td>

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
                      fontWeight: 700,
                      fontSize: 15
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
                        Rejection: {r.REJECTION_REASON}
                      </div>
                    )}
                  </td>

                  <td style={{ padding: 12 }}>
                    <StatusPill status={r.STATUS} />
                  </td>

                  <td
                    style={{
                      padding: 12,
                      fontSize: 11,
                      color: "#475569"
                    }}
                  >
                    {r.APPROVED_BY_EMAIL || "—"}
                  </td>

                  {showActions && (

                    <td
                      style={{ padding: 12, textAlign: "right" }}
                    >

                      {r.STATUS === "PENDING_APPROVAL" ? (

                        <div
                          style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
                        >

                          <button
                            onClick={() => approve(r.ID)}
                            style={{
                              border: "none",
                              background: "#10b981",
                              color: "white",
                              padding: "5px 12px",
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 600
                            }}
                          >
                            ✓ Approve
                          </button>

                          <button
                            onClick={() => setRejectingId(r.ID)}
                            style={{
                              border: "none",
                              background: "#ef4444",
                              color: "white",
                              padding: "5px 12px",
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 600
                            }}
                          >
                            ✗ Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rejectingId && (

        <RejectDialog
          leaveId={rejectingId}
          onClose={() => setRejectingId(null)}
          onDone={() => {

            setRejectingId(null);

            onChanged?.();
          }}
        />
      )}
    </>
  );
}


function LeaveManagement() {

  const [tab, setTab] = useState("pending");

  const [pending, setPending] = useState([]);

  const [all, setAll] = useState([]);

  const [summary, setSummary] = useState(null);

  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("");

  // Live filter by Employee ID (code) or name — applied client-side to
  // the already-loaded rows so it works on both the Pending and All tabs.
  const [empQuery, setEmpQuery] = useState("");

  const matchesEmp = (r) => {

    const q = empQuery.trim().toLowerCase();

    if (!q) return true;

    return (
      (r.EMPLOYEE_CODE || "").toLowerCase().includes(q) ||
      (r.EMPLOYEE_NAME || "").toLowerCase().includes(q)
    );
  };

  const fetchAll = async () => {

    setLoading(true);

    try {

      const [pRes, aRes, sRes] = await Promise.all([
        API.get("/leave/pending?vendor_id=1"),
        API.get("/leave/all", {
          params: {
            vendor_id: 1,
            ...(statusFilter ? { status: statusFilter } : {})
          }
        }),
        API.get("/leave/dashboard?vendor_id=1")
      ]);

      setPending(pRes.data || []);

      setAll(aRes.data || []);

      setSummary(sRes.data);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

  }, [statusFilter]);

  return (

    <div
      style={{
        padding: 24,
        background: "#f1f5f9",
        minHeight: "100%"
      }}
    >

      <div style={{ marginBottom: 20 }}>

        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: "#0f172a",
            margin: 0
          }}
        >
          Leave Management
        </h1>

        <div
          style={{
            fontSize: 13,
            color: "#64748b",
            marginTop: 4
          }}
        >
          Apply, review, and track leave across BVC24.
        </div>
      </div>

      {/* Policy banner explaining the BVC24 day-based rule */}
      <div
        style={{
          background:
            "linear-gradient(135deg, #fef2f2 0%, #fff4e6 100%)",
          border: "1px solid #c7d2fe",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          display: "flex",
          gap: 14,
          flexWrap: "wrap"
        }}
      >

        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#4338ca",
            textTransform: "uppercase",
            flexBasis: "100%"
          }}
        >
          BVC24 Leave Policy — Process Flow
        </div>

        <div style={{ flex: 1, minWidth: 260 }}>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 4
            }}
          >
            ① Every leave needs approval
          </div>

          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
            <strong style={{ color: "#f59e0b" }}>Reason is required</strong>
            {" "}— including half-day and one-day requests. Nothing is
            auto-approved. The request lands in the manager's queue
            immediately.
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 260 }}>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 4
            }}
          >
            ② Manager decision
          </div>

          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
            An approval email is sent to the manager
            (<strong>APPROVER_EMAIL</strong>) with Approve / Reject
            buttons. On approval → employee gets email + in-app
            notification, balance is deducted automatically. On
            rejection → employee receives a rejection notification.
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      {summary && (

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 14,
            marginBottom: 20
          }}
        >

          <Tile
            label="Pending"
            value={summary.pending}
            sub="needs MD action"
            color="#f59e0b"
          />

          <Tile
            label="Approved"
            value={summary.approved}
            color="#10b981"
          />

          <Tile
            label="Rejected"
            value={summary.rejected}
            color="#ef4444"
          />

          <Tile
            label="Cancelled"
            value={summary.cancelled}
            color="#94a3b8"
          />

          <Tile
            label="On Leave Today"
            value={summary.on_leave_today}
            sub="currently absent"
            color="#7c3aed"
          />
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "1px solid #e2e8f0"
        }}
      >

        {[
          { key: "pending", label: `Pending (${pending.length})` },
          { key: "all", label: "All Requests" }
        ].map((t) => (

          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              border: "none",
              background: "transparent",
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              color: tab === t.key ? "#1e40af" : "#64748b",
              cursor: "pointer",
              borderBottom:
                tab === t.key
                  ? "3px solid #1e40af"
                  : "3px solid transparent",
              marginBottom: -1
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Employee filter — narrows the table below by Employee ID or name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap"
        }}
      >

        <div
          style={{
            position: "relative",
            flex: "0 0 300px",
            maxWidth: "100%"
          }}
        >

          <span
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 13,
              color: "#94a3b8",
              pointerEvents: "none"
            }}
          >
            🔍
          </span>

          <input
            value={empQuery}
            onChange={(e) => setEmpQuery(e.target.value)}
            placeholder="Filter by Employee ID or name…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "9px 30px 9px 32px",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 13,
              outline: "none",
              background: "white"
            }}
          />

          {empQuery && (

            <button
              onClick={() => setEmpQuery("")}
              title="Clear filter"
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#94a3b8",
                fontSize: 14,
                lineHeight: 1,
                padding: 4
              }}
            >
              ✕
            </button>
          )}
        </div>

        {empQuery.trim() && (

          <span style={{ fontSize: 12, color: "#64748b" }}>
            {(tab === "pending" ? pending : all).filter(matchesEmp).length}{" "}
            match
            {(tab === "pending" ? pending : all).filter(matchesEmp).length === 1
              ? ""
              : "es"}{" "}
            for “{empQuery.trim()}”
          </span>
        )}
      </div>

      {tab === "pending" && (

        <LeaveTable
          rows={pending.filter(matchesEmp)}
          onChanged={fetchAll}
          showActions={true}
        />
      )}

      {tab === "all" && (

        <>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 14,
              flexWrap: "wrap"
            }}
          >

            {["", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map(
              (s) => (

                <button
                  key={s || "all"}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    border: "1px solid #e2e8f0",
                    background:
                      statusFilter === s ? "#1e40af" : "white",
                    color:
                      statusFilter === s ? "white" : "#475569",
                    padding: "6px 12px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600
                  }}
                >
                  {s ? s.replaceAll("_", " ") : "All"}
                </button>
              )
            )}
          </div>

          <LeaveTable
            rows={all.filter(matchesEmp)}
            onChanged={fetchAll}
            showActions={true}
          />
        </>
      )}
    </div>
  );
}


export default LeaveManagement;
