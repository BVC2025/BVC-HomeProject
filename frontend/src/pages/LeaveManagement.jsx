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

  // ----- History tab: server-side filters + pagination -----
  const [historyFilters, setHistoryFilters] = useState({
    start_date: "",
    end_date:   "",
    employee_id: "",
    leave_type:  "",
    department_id: "",
  });
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage]   = useState(1);
  const [historyPageSize] = useState(50);

  const [employees, setEmployees]     = useState([]);
  const [departments, setDepartments] = useState([]);

  // Fetch dropdown sources once
  useEffect(() => {
    API.get("/employees").then((r) => setEmployees(r.data || [])).catch(() => {});
    API.get("/departments").then((r) => setDepartments(r.data || [])).catch(() => {});
  }, []);

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

      // Build /leave/all params from server-side filters + pagination
      const allParams = {
        vendor_id: 1,
        limit:  historyPageSize,
        offset: (historyPage - 1) * historyPageSize,
      };
      if (statusFilter)               allParams.status        = statusFilter;
      if (historyFilters.start_date)  allParams.start_date    = historyFilters.start_date;
      if (historyFilters.end_date)    allParams.end_date      = historyFilters.end_date;
      if (historyFilters.employee_id) allParams.employee_id   = historyFilters.employee_id;
      if (historyFilters.leave_type)  allParams.leave_type    = historyFilters.leave_type;
      if (historyFilters.department_id) allParams.department_id = historyFilters.department_id;

      const [pRes, aRes, sRes] = await Promise.all([
        API.get("/leave/pending?vendor_id=1"),
        API.get("/leave/all", { params: allParams }),
        API.get("/leave/dashboard?vendor_id=1"),
      ]);

      setPending(pRes.data || []);

      // Backend now returns { total, limit, offset, rows }.
      // Fall back to plain array for the cache-warm window.
      const aData = aRes.data;
      if (Array.isArray(aData)) {
        setAll(aData);
        setHistoryTotal(aData.length);
      } else {
        setAll(aData.rows || []);
        setHistoryTotal(aData.total || 0);
      }

      setSummary(sRes.data);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, historyFilters, historyPage]);

  return (

    <div className={styles.page}>

      {/* ── Page banner — clean white, thin red accent ── */}
      <div className={styles.pageBanner}>
        <div className={styles.pageBannerLeft}>
          <div className={styles.pageBannerEyebrow}>HR · Leave</div>
          <h1 className={styles.pageBannerTitle}>Leave Management</h1>
          <div className={styles.pageBannerSub}>
            Apply, review, and track leave across BVC24.
          </div>
        </div>
        <div className={styles.pageBannerActions}>
          <div className={styles.bannerHint}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
            </svg>
            <span>Every request needs approval · reason mandatory · manager decides via email · balance auto-deducted</span>
          </div>
        </div>
      </div>

      {/* ── Summary tiles — compact, professional, top accent ── */}
      {summary && (
        <div className={styles.tilesGrid}>
          <Tile label="Pending" value={summary.pending} sub="needs MD action" color="#f59e0b" />
          <Tile label="Approved" value={summary.approved} sub="this period" color="#10b981" />
          <Tile label="Rejected" value={summary.rejected} sub="declined" color="#ef4444" />
          <Tile label="Cancelled" value={summary.cancelled} sub="withdrawn" color="#94a3b8" />
          <Tile label="On Leave Today" value={summary.on_leave_today} sub="currently absent" color="#7c3aed" />
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabBar}>
        {[
          { key: "pending",   label: `Pending (${pending.length})` },
          { key: "all",       label: "All Requests" },
          { key: "balances",  label: "Balances" },
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
          <span className={styles.searchIcon}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
          </span>
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
        <div className={styles.tabContent}>
          <LeaveTable rows={pending.filter(matchesEmp)} onChanged={fetchAll} showActions={true} />
        </div>
      )
      }

      {
        tab === "all" && (
          <div className={styles.tabContent}>
            {/* ===== Server-side history filter bar ===== */}
            <div className={styles.historyFilterBar}>
              <div className={styles.histField}>
                <label>From</label>
                <input
                  type="date"
                  value={historyFilters.start_date}
                  onChange={(e) => {
                    setHistoryPage(1);
                    setHistoryFilters({ ...historyFilters, start_date: e.target.value });
                  }}
                />
              </div>
              <div className={styles.histField}>
                <label>To</label>
                <input
                  type="date"
                  value={historyFilters.end_date}
                  onChange={(e) => {
                    setHistoryPage(1);
                    setHistoryFilters({ ...historyFilters, end_date: e.target.value });
                  }}
                />
              </div>
              <div className={styles.histField}>
                <label>Employee</label>
                <select
                  value={historyFilters.employee_id}
                  onChange={(e) => {
                    setHistoryPage(1);
                    setHistoryFilters({ ...historyFilters, employee_id: e.target.value });
                  }}
                >
                  <option value="">All employees</option>
                  {employees.map((emp) => (
                    <option key={emp.ID} value={emp.ID}>
                      {emp.NAME} ({emp.EMPLOYEE_CODE || "—"})
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.histField}>
                <label>Type</label>
                <select
                  value={historyFilters.leave_type}
                  onChange={(e) => {
                    setHistoryPage(1);
                    setHistoryFilters({ ...historyFilters, leave_type: e.target.value });
                  }}
                >
                  <option value="">All types</option>
                  {["CASUAL", "SICK", "UNPAID", "LOP", "PERMISSION", "MATERNITY"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className={styles.histField}>
                <label>Department</label>
                <select
                  value={historyFilters.department_id}
                  onChange={(e) => {
                    setHistoryPage(1);
                    setHistoryFilters({ ...historyFilters, department_id: e.target.value });
                  }}
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d.ID} value={d.ID}>{d.NAME}</option>
                  ))}
                </select>
              </div>
              {(historyFilters.start_date || historyFilters.end_date ||
                historyFilters.employee_id || historyFilters.leave_type ||
                historyFilters.department_id) && (
                <button
                  type="button"
                  className={styles.histClear}
                  onClick={() => {
                    setHistoryPage(1);
                    setHistoryFilters({
                      start_date: "", end_date: "", employee_id: "",
                      leave_type: "", department_id: "",
                    });
                  }}
                >✕ Clear</button>
              )}
              <div className={styles.histCount}>
                {historyTotal} record{historyTotal === 1 ? "" : "s"}
              </div>
            </div>

            {/* Status chips (kept for quick toggling) */}
            <div className={styles.statusFilterRow}>
              {["", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => { setHistoryPage(1); setStatusFilter(s); }}
                  className={`${styles.statusBtn}${statusFilter === s ? ` ${styles.statusBtnActive}` : ""}`}
                >
                  {s ? s.replaceAll("_", " ") : "All"}
                </button>
              ))}
            </div>

            <LeaveTable rows={all.filter(matchesEmp)} onChanged={fetchAll} showActions={true} />

            {/* ===== Pagination (server-side) ===== */}
            {historyTotal > historyPageSize && (
              <div className={styles.histPager}>
                <button
                  type="button"
                  disabled={historyPage <= 1}
                  onClick={() => setHistoryPage(historyPage - 1)}
                  className={styles.histPagerBtn}
                >← Previous</button>
                <span className={styles.histPagerInfo}>
                  Page {historyPage} of {Math.max(1, Math.ceil(historyTotal / historyPageSize))}
                </span>
                <button
                  type="button"
                  disabled={historyPage * historyPageSize >= historyTotal}
                  onClick={() => setHistoryPage(historyPage + 1)}
                  className={styles.histPagerBtn}
                >Next →</button>
              </div>
            )}
          </div>
        )
      }

      {tab === "balances" && (
        <div className={styles.tabContent}>
          <BalanceOverview />
        </div>
      )}
    </div >
  );
}


// =====================================================================
// HR Leave Balance overview — one row per active employee, columns per
// leave type (CL/SL/EL/Maternity) with usage bars + an "Adjust" button.
// =====================================================================

function BalanceOverview() {

  const [data, setData] = useState({ year: new Date().getFullYear(), rows: [] });
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [adjustEmp, setAdjustEmp] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await API.get("/leave/balances/all", { params: { year } });
      setData(res.data || { year, rows: [] });
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year]);

  // Quick "running low" flag — < 25% available across all paid types
  const isLow = (emp) => {
    const total = (emp.casual.total + emp.sick.total) +
                  (emp.casual.carryover + emp.sick.carryover);
    const avail = emp.casual.available + emp.sick.available;
    if (total <= 0) return false;
    return (avail / total) < 0.25;
  };

  return (
    <div className={styles.balanceTabRoot}>
      {/* Year switcher */}
      <div className={styles.balanceHeaderRow}>
        <div className={styles.balanceYearSwitcher}>
          <button onClick={() => setYear(year - 1)} className={styles.balanceYearBtn}>←</button>
          <span className={styles.balanceYearLabel}>{year}</span>
          <button onClick={() => setYear(year + 1)} className={styles.balanceYearBtn}>→</button>
        </div>
        <div className={styles.histCount}>
          {loading ? "Loading…" : `${data.rows.length} employee${data.rows.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* Table */}
      <div className={styles.balanceTableWrap}>
        <table className={styles.balanceTable}>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Casual</th>
              <th>Sick</th>
              <th>Maternity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && data.rows.length === 0 && (
              <tr><td colSpan={5} className={styles.balanceEmpty}>
                No active employees found.
              </td></tr>
            )}
            {data.rows.map((emp) => (
              <tr key={emp.employee_id}
                  className={isLow(emp) ? styles.balanceRowLow : ""}>
                <td>
                  <div className={styles.balanceEmpName}>{emp.employee_name}</div>
                  <div className={styles.balanceEmpCode}>{emp.employee_code || "—"}</div>
                </td>
                <BalanceCell data={emp.casual} />
                <BalanceCell data={emp.sick} />
                <BalanceCell data={emp.maternity} hideIfZero />
                <td>
                  <button
                    type="button"
                    onClick={() => setAdjustEmp(emp)}
                    className={styles.balanceAdjustBtn}
                  >Adjust</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adjustEmp && (
        <AdjustmentModal
          employee={adjustEmp}
          year={year}
          onClose={() => setAdjustEmp(null)}
          onSaved={() => { setAdjustEmp(null); load(); }}
        />
      )}
    </div>
  );
}


function BalanceCell({ data, hideIfZero }) {
  if (hideIfZero && data.total === 0 && data.used === 0) {
    return <td className={styles.balanceCellEmpty}>—</td>;
  }
  const total = data.total + data.carryover;
  const pct   = total ? Math.min(100, (data.used / total) * 100) : 0;
  const tier  = pct >= 80 ? "high" : pct >= 50 ? "mid" : "low";
  return (
    <td>
      <div className={styles.balanceCellLine}>
        <b>{data.available}</b>
        <span className={styles.balanceCellTotal}> / {total}</span>
      </div>
      <div className={styles.balanceBar}>
        <div
          className={`${styles.balanceBarFill} ${styles[`balanceBar_${tier}`] || ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={styles.balanceCellUsed}>{data.used} used</div>
    </td>
  );
}


function AdjustmentModal({ employee, year, onClose, onSaved }) {

  const [leaveType, setLeaveType] = useState("CASUAL");
  const [delta,     setDelta]     = useState("");
  const [reason,    setReason]    = useState("");
  const [notes,     setNotes]     = useState("");
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState("");
  const [history,   setHistory]   = useState([]);

  // Load prior adjustments for context
  useEffect(() => {
    API.get(`/leave/balance/${employee.employee_id}/adjustments`)
      .then((r) => setHistory(r.data || []))
      .catch(() => {});
  }, [employee.employee_id]);

  const submit = async () => {
    setError("");
    const num = parseFloat(delta);
    if (!num || num === 0) { setError("Enter a non-zero delta (use - for debit)."); return; }
    if (reason.trim().length < 3) { setError("Reason must be at least 3 characters."); return; }
    setBusy(true);
    try {
      await API.patch(`/leave/balance/${employee.employee_id}/adjust`, {
        leave_type: leaveType,
        delta_days: num,
        reason: reason.trim(),
        notes:  notes.trim() || null,
        year,
      });
      onSaved?.();
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to adjust balance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} className={styles.adjOverlay}>
      <div onClick={(e) => e.stopPropagation()} className={styles.adjPanel}>
        <div className={styles.adjHeader}>
          <div>
            <div className={styles.adjEyebrow}>HR · BALANCE ADJUSTMENT</div>
            <div className={styles.adjTitle}>{employee.employee_name}</div>
            <div className={styles.adjSub}>
              {employee.employee_code} · Year {year}
            </div>
          </div>
          <button onClick={onClose} className={styles.adjClose}>× Close</button>
        </div>

        <div className={styles.adjBody}>

          <div className={styles.adjField}>
            <label>Leave type</label>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              {["CASUAL", "SICK", "MATERNITY"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className={styles.adjField}>
            <label>Delta days  (use + to credit, - to debit)</label>
            <input
              type="number" step="0.5"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 2  or  -1"
            />
          </div>

          <div className={styles.adjField}>
            <label>Reason  (required)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Comp-off credited for working on 2026-06-22"
            />
          </div>

          <div className={styles.adjField}>
            <label>Notes  (optional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any extra context HR should keep…"
            />
          </div>

          {error && <div className={styles.adjError}>{error}</div>}

          {history.length > 0 && (
            <div className={styles.adjHistory}>
              <div className={styles.adjHistoryHeader}>
                Past adjustments ({history.length})
              </div>
              {history.slice(0, 6).map((h) => (
                <div key={h.id} className={styles.adjHistoryRow}>
                  <span className={`${styles.adjHistoryDelta} ${h.delta_days > 0 ? styles.adjDeltaPos : styles.adjDeltaNeg}`}>
                    {h.delta_days > 0 ? "+" : ""}{h.delta_days}d
                  </span>
                  <span className={styles.adjHistoryType}>{h.leave_type}</span>
                  <span className={styles.adjHistoryReason}>{h.reason}</span>
                  <span className={styles.adjHistoryDate}>
                    {h.adjusted_at?.slice(0, 10)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.adjFooter}>
          <button onClick={onClose} className={styles.adjCancelBtn}>Cancel</button>
          <button onClick={submit} disabled={busy}
                  className={styles.adjSubmitBtn}>
            {busy ? "Saving…" : "Apply adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}


export default LeaveManagement;
