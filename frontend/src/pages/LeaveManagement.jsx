import { useEffect, useState } from "react";

import API from "../services/api";
import styles from "./LeaveManagement.module.css";


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
    <div className={styles.tile} style={{ "--tile-color": color }}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
      {sub && <div className={styles.tileSub}>{sub}</div>}
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
    <div className={styles.overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={styles.dialog}>
        <div className={styles.dialogTitle}>Reject leave request</div>
        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (sent to the employee by email)..."
          className={styles.dialogTextarea}
        />
        <div className={styles.dialogActions}>
          <button onClick={onClose} className={styles.dialogCancelBtn}>Cancel</button>
          <button onClick={submit} disabled={submitting} className={styles.dialogSubmitBtn}>
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
      <div className={styles.tableWrap}>
        <div className={styles.tableScroll}>
          <table className={styles.tableEl}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Employee</th>
                <th className={styles.th}>Type</th>
                <th className={styles.th}>Dates</th>
                <th className={styles.thRight}>Days</th>
                <th className={styles.th}>Reason</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Approved By</th>
                {showActions && <th className={styles.thRight}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={showActions ? 8 : 7} className={styles.emptyCell}>
                    No leave requests in this view.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.ID} className={styles.tdRow}>
                  <td className={styles.tdCell}>
                    <div className={styles.empName}>{r.EMPLOYEE_NAME || "—"}</div>
                    <div className={styles.empCode}>{r.EMPLOYEE_CODE}</div>
                  </td>
                  <td className={styles.tdCell}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: `${TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"}22`,
                      color: TYPE_THEMES[r.LEAVE_TYPE] || "#94a3b8"
                    }}>
                      {r.LEAVE_TYPE}
                    </span>
                  </td>
                  <td className={styles.tdCell}>
                    <div>{r.START_DATE}</div>
                    {r.END_DATE !== r.START_DATE && (
                      <div className={styles.endDate}>→ {r.END_DATE}</div>
                    )}
                  </td>
                  <td className={styles.tdCellRight}>{r.DAYS}</td>
                  <td className={styles.tdCellReason}>
                    {r.REASON}
                    {r.REJECTION_REASON && (
                      <div className={styles.rejReason}>Rejection: {r.REJECTION_REASON}</div>
                    )}
                  </td>
                  <td className={styles.tdCell}>
                    <StatusPill status={r.STATUS} />
                  </td>
                  <td className={styles.tdCell}>{r.APPROVED_BY_EMAIL || "—"}</td>
                  {showActions && (
                    <td className={styles.tdCellActions}>
                      {r.STATUS === "PENDING_APPROVAL" ? (
                        <div className={styles.actionBtns}>
                          <button onClick={() => approve(r.ID)} className={styles.approveBtn}>✓ Approve</button>
                          <button onClick={() => setRejectingId(r.ID)} className={styles.rejectBtn}>✗ Reject</button>
                        </div>
                      ) : (
                        <span className={styles.noAction}>—</span>
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

    <div className={styles.page}>

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Leave Management</h1>
        <div className={styles.pageSub}>Apply, review, and track leave across BVC24.</div>
      </div>

      {/* Policy banner */}
      <div className={styles.policyBanner}>
        <div className={styles.policyLabel}>BVC24 Leave Policy — Process Flow</div>
        <div className={styles.policyItem}>
          <div className={styles.policyItemTitle}>① Every leave needs approval</div>
          <div className={styles.policyItemText}>
            <strong>Reason is required</strong>
            {" "}— including half-day and one-day requests. Nothing is
            auto-approved. The request lands in the manager's queue immediately.
          </div>
        </div>
        <div className={styles.policyItem}>
          <div className={styles.policyItemTitle}>② Manager decision</div>
          <div className={styles.policyItemText}>
            An approval email is sent to the manager (<strong>APPROVER_EMAIL</strong>) with
            Approve / Reject buttons. On approval → employee gets email + in-app
            notification, balance is deducted automatically.
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      {summary && (
        <div className={styles.tilesGrid}>
          <Tile label="Pending" value={summary.pending} sub="needs MD action" color="#f59e0b" />
          <Tile label="Approved" value={summary.approved} color="#10b981" />
          <Tile label="Rejected" value={summary.rejected} color="#ef4444" />
          <Tile label="Cancelled" value={summary.cancelled} color="#94a3b8" />
          <Tile label="On Leave Today" value={summary.on_leave_today} sub="currently absent" color="#7c3aed" />
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabBar}>
        {[
          { key: "pending", label: `Pending (${pending.length})` },
          { key: "all", label: "All Requests" }
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`${styles.tab}${tab === t.key ? ` ${styles.tabActive}` : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Employee filter */}
      <div className={styles.filterRow}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            value={empQuery}
            onChange={(e) => setEmpQuery(e.target.value)}
            placeholder="Filter by Employee ID or name…"
            className={styles.searchInput}
          />
          {empQuery && (
            <button onClick={() => setEmpQuery("")} title="Clear filter" className={styles.clearBtn}>✕</button>
          )}
        </div>
        {
          empQuery.trim() && (
            <span className={styles.filterResult}>
              {(tab === "pending" ? pending : all).filter(matchesEmp).length} match
              {(tab === "pending" ? pending : all).filter(matchesEmp).length === 1 ? "" : "es"} for "{empQuery.trim()}"
            </span>
          )
        }
      </div >

      {tab === "pending" && (
        < LeaveTable rows={pending.filter(matchesEmp)} onChanged={fetchAll} showActions={true} />
      )
      }

      {
        tab === "all" && (
          <>
            <div className={styles.statusFilterRow}>
              {["", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => setStatusFilter(s)}
                  className={`${styles.statusBtn}${statusFilter === s ? ` ${styles.statusBtnActive}` : ""}`}
                >
                  {s ? s.replaceAll("_", " ") : "All"}
                </button>
              ))
              }
            </div >
            <LeaveTable rows={all.filter(matchesEmp)} onChanged={fetchAll} showActions={true} />
          </>
        )
      }
    </div >
  );
}


export default LeaveManagement;
