// =====================================================================
// Admin -> Allowances.
//
// MD's queue of employee-submitted expense claims. Lists every claim,
// filters by status, and lets the MD approve or reject inline.
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_GOLD = "#F4B324";


const STATUS_THEME = {
  PENDING:  { bg: "#fef3c7", fg: "#854d0e", label: "PENDING" },
  APPROVED: { bg: "#dcfce7", fg: "#166534", label: "APPROVED" },
  REJECTED: { bg: "#fee2e2", fg: "#991b1b", label: "REJECTED" },
};


function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}


function StatusPill({ status }) {
  const t = STATUS_THEME[status] || STATUS_THEME.PENDING;
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      background: t.bg,
      color: t.fg,
      letterSpacing: 0.5,
    }}>
      {t.label}
    </span>
  );
}


function Tile({ label, value, sub, color }) {
  return (
    <div style={{
      background: "white",
      borderRadius: 14,
      padding: "18px 20px",
      boxShadow: "0 6px 20px rgba(15,23,42,0.07)",
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        color: "#64748b",
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 800,
        color: "#0f172a",
        marginTop: 4,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


export default function Allowances() {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [minAmount, setMinAmount] = useState("");

  const [decidingId, setDecidingId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await API.get("/allowances");
      setRows(res.data || []);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load allowances.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    const minAmt = minAmount === "" ? null : Number(minAmount);

    return rows.filter((r) => {
      if (statusFilter && r.STATUS !== statusFilter) return false;

      if (q) {
        const hay = [
          r.EMPLOYEE_NAME,
          r.EMPLOYEE_ID,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (minAmt !== null && !isNaN(minAmt)) {
        if (Number(r.AMOUNT || 0) < minAmt) return false;
      }

      return true;
    });
  }, [rows, statusFilter, employeeQuery, minAmount]);

  // Tiles recompute LIVE from whatever rows are visible right now —
  // so when the MD narrows down to "Puvi · APPROVED only", the
  // totals reflect that view rather than the whole dataset.
  const summary = useMemo(() => {
    const list = filtered;
    return {
      total:      list.length,
      pending:    list.filter((r) => r.STATUS === "PENDING").length,
      approved:   list.filter((r) => r.STATUS === "APPROVED").length,
      rejected:   list.filter((r) => r.STATUS === "REJECTED").length,
      total_amount:    list.reduce((s, r) => s + Number(r.AMOUNT || 0), 0),
      pending_amount:  list.filter((r) => r.STATUS === "PENDING")
                           .reduce((s, r) => s + Number(r.AMOUNT || 0), 0),
      approved_amount: list.filter((r) => r.STATUS === "APPROVED")
                           .reduce((s, r) => s + Number(r.AMOUNT || 0), 0),
    };
  }, [filtered]);

  const clearFilters = () => {
    setStatusFilter("");
    setEmployeeQuery("");
    setMinAmount("");
  };

  const anyFilterActive = !!(statusFilter || employeeQuery.trim() || minAmount !== "");

  // When the employee query targets a single person, surface their
  // per-employee stats as a banner so the MD sees the full picture
  // (e.g. "Puvi — 5 claims, ₹4,500 total, ₹1,200 pending").
  const employeeFocus = useMemo(() => {
    if (!employeeQuery.trim()) return null;
    const names = [...new Set(filtered.map((r) => r.EMPLOYEE_NAME).filter(Boolean))];
    if (names.length !== 1) return null;
    const list = filtered;
    return {
      name:    names[0],
      count:   list.length,
      total:   list.reduce((s, r) => s + Number(r.AMOUNT || 0), 0),
      pending: list.filter((r) => r.STATUS === "PENDING")
                   .reduce((s, r) => s + Number(r.AMOUNT || 0), 0),
      approved: list.filter((r) => r.STATUS === "APPROVED")
                    .reduce((s, r) => s + Number(r.AMOUNT || 0), 0),
    };
  }, [filtered, employeeQuery]);

  const decide = async (id, action) => {
    if (action === "REJECT" && !reviewNotes.trim()) {
      alert("Please add a short reason for rejection.");
      return;
    }
    if (!window.confirm(`Confirm ${action} for this expense claim?`)) return;

    try {
      await API.patch(`/allowances/${id}/decide`, {
        ACTION: action,
        REVIEW_NOTES: reviewNotes || null,
      });
      setDecidingId(null);
      setReviewNotes("");
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Decision failed.");
    }
  };

  return (
    <div style={{ padding: 24, background: "#f1f5f9", minHeight: "calc(100vh - 80px)" }}>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
        borderRadius: 16,
        padding: "20px 26px",
        marginBottom: 20,
        color: "white",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 2,
          color: BVC_GOLD, textTransform: "uppercase",
        }}>
          BVC24 &middot; MD review queue
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
          Employee Allowances
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
          Review office-related expense claims submitted by employees and
          approve or reject them.
        </div>
      </div>

      {/* Summary tiles — recompute live from the current filtered view */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
        marginBottom: 14,
      }}>
        <Tile
          label={anyFilterActive ? "Total (filtered)" : "Total claims"}
          value={summary.total}
          sub={inr(summary.total_amount)}
          color="#1d4ed8"
        />
        <Tile label="Pending"  value={summary.pending}  sub={inr(summary.pending_amount)}  color="#B47900" />
        <Tile label="Approved" value={summary.approved} sub={inr(summary.approved_amount)} color="#059669" />
        <Tile label="Rejected" value={summary.rejected} color="#991b1b" />
      </div>

      {/* Per-employee focus banner — only when the query narrows to ONE person */}
      {employeeFocus && (
        <div style={{
          padding: "12px 16px",
          background: "linear-gradient(135deg,#fffbeb,#fef3c7)",
          border: "1px solid #F4B324",
          borderRadius: 10,
          marginBottom: 14,
          fontSize: 13,
          color: "#7c2d12",
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          alignItems: "center",
        }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>
            {employeeFocus.name}
          </div>
          <div>
            <b>{employeeFocus.count}</b> claim{employeeFocus.count === 1 ? "" : "s"}
          </div>
          <div>
            Total submitted: <b>{inr(employeeFocus.total)}</b>
          </div>
          <div>
            Pending: <b style={{ color: "#854d0e" }}>{inr(employeeFocus.pending)}</b>
          </div>
          <div>
            Approved: <b style={{ color: "#166534" }}>{inr(employeeFocus.approved)}</b>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{
        background: "white",
        padding: 14,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        display: "flex",
        gap: 10,
        alignItems: "center",
        marginBottom: 18,
        flexWrap: "wrap",
      }}>

        {/* Employee name / id search */}
        <input
          type="text"
          value={employeeQuery}
          onChange={(e) => setEmployeeQuery(e.target.value)}
          placeholder="Search by employee name..."
          style={{
            flex: "1 1 240px",
            minWidth: 200,
            padding: "8px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />

        {/* Min amount threshold */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#475569", fontWeight: 700, letterSpacing: 0.4 }}>
            MIN AMOUNT &#8377;
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="0"
            style={{
              width: 90,
              padding: "8px 10px",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "inherit",
              textAlign: "right",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Status filter buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          {["PENDING", "APPROVED", "REJECTED"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: statusFilter === s ? "1px solid #0f172a" : "1px solid #e2e8f0",
                background: statusFilter === s ? "#0f172a" : "white",
                color: statusFilter === s ? "white" : "#475569",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: 0.3,
              }}
            >
              {s}
            </button>
          ))}
          <button
            onClick={clearFilters}
            title="Clear all filters and show every claim from every employee"
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: !anyFilterActive ? "1px solid #0f172a" : "1px solid #e2e8f0",
              background: !anyFilterActive ? "#0f172a" : "white",
              color: !anyFilterActive ? "white" : "#475569",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
              letterSpacing: 0.3,
            }}
          >
            ALL
          </button>
        </div>

        <div style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {filtered.length} of {rows.length}
        </div>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          Loading claims...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{
          padding: 50,
          textAlign: "center",
          color: "#94a3b8",
          background: "white",
          borderRadius: 14,
          border: "1px dashed #cbd5e1",
        }}>
          No claims in this view.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
          overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{
                background: "#f8fafc",
                fontSize: 10,
                letterSpacing: 0.8,
                color: "#64748b",
                textTransform: "uppercase",
              }}>
                <th style={th}>Employee</th>
                <th style={th}>Category</th>
                <th style={th}>Expense date</th>
                <th style={{ ...th, textAlign: "right" }}>Amount</th>
                <th style={th}>Submitted</th>
                <th style={th}>Status</th>
                <th style={th}>Description</th>
                <th style={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>
                      {r.EMPLOYEE_NAME || "-"}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
                      {r.EMPLOYEE_ID}
                    </div>
                  </td>
                  <td style={td}>{r.CATEGORY.replace(/_/g, " ")}</td>
                  <td style={td}>{r.EXPENSE_DATE || "-"}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{inr(r.AMOUNT)}</td>
                  <td style={td}>
                    {r.SUBMITTED_AT ? new Date(r.SUBMITTED_AT).toLocaleDateString("en-IN") : "-"}
                  </td>
                  <td style={td}><StatusPill status={r.STATUS} /></td>
                  <td style={{ ...td, color: "#475569", fontSize: 12, maxWidth: 280 }}>
                    {r.DESCRIPTION || "-"}
                    {r.REVIEW_NOTES && (
                      <div style={{
                        marginTop: 4,
                        padding: "4px 8px",
                        background: r.STATUS === "REJECTED" ? "#fef2f2" : "#f0fdf4",
                        border: `1px solid ${r.STATUS === "REJECTED" ? "#fecaca" : "#bbf7d0"}`,
                        borderRadius: 6,
                        fontSize: 11,
                        fontStyle: "italic",
                      }}>
                        MD: {r.REVIEW_NOTES}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {r.STATUS === "PENDING" && decidingId !== r.ID && (
                      <button
                        onClick={() => { setDecidingId(r.ID); setReviewNotes(""); }}
                        style={btnPrimary}
                      >
                        Review
                      </button>
                    )}

                    {r.STATUS === "PENDING" && decidingId === r.ID && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
                        <textarea
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          rows={2}
                          placeholder="Optional note (required to reject)"
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            fontSize: 12,
                            fontFamily: "inherit",
                            resize: "vertical",
                            boxSizing: "border-box",
                          }}
                        />
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => decide(r.ID, "APPROVE")}
                            style={btnApprove}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => decide(r.ID, "REJECT")}
                            style={btnReject}
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => { setDecidingId(null); setReviewNotes(""); }}
                            style={btnCancel}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {r.STATUS !== "PENDING" && (
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        {r.REVIEWED_AT ? new Date(r.REVIEWED_AT).toLocaleDateString("en-IN") : "-"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


const th = {
  padding: "10px 12px",
  textAlign: "left",
  fontWeight: 700,
  borderBottom: "1px solid #e2e8f0",
};

const td = {
  padding: "10px 12px",
  verticalAlign: "top",
};

const btnPrimary = {
  padding: "7px 14px",
  background: "#0f172a",
  color: "white",
  border: "none",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const btnApprove = {
  flex: 1,
  padding: "6px 10px",
  background: "#059669",
  color: "white",
  border: "none",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 11,
  cursor: "pointer",
};

const btnReject = {
  flex: 1,
  padding: "6px 10px",
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 11,
  cursor: "pointer",
};

const btnCancel = {
  padding: "6px 10px",
  background: "white",
  color: "#475569",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 11,
  cursor: "pointer",
};
