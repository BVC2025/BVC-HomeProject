// =====================================================================
// PayrollRecords — admin-side flat listing of every generated payslip.
// ---------------------------------------------------------------------
// Displays each PayrollSlip joined with employee + department + run
// header so HR / MD can review historical payroll without drilling
// into individual run pages. Backed by:
//   GET    /payroll/records            (list + filters + pagination)
//   GET    /payroll/records/summary    (four-tile dashboard header)
//   DELETE /payroll/slips/{id}         (per-row delete, PAID blocked)
// Per-row View reuses the existing <PayslipPreview> component; Download
// and Print hit the same /my-payslips/{id}/pdf endpoint the employee
// portal uses, so admin + employee always see identical letterhead.
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import API, { API_BASE_URL } from "../services/api";
import PayslipPreview from "../components/PayslipPreview";
import styles from "./PayrollRecords.module.css";


// ---- Icons ----
const icon = (children, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);
const I = {
  view:      icon(<><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></>),
  download:  icon(<><path d="M12 3v13" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></>),
  print:     icon(<><rect x="6" y="14" width="12" height="8" rx="1" /><path d="M6 14V4h9l3 3v7" /><path d="M6 14H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1" /><path d="M18 14h2a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1" /></>),
  trash:     icon(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></>),
  search:    icon(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></>),
  users:     icon(<><path d="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="8" r="4" /><path d="M23 20v-2a4 4 0 0 0-3-3.87" /><path d="M17 4.13a4 4 0 0 1 0 7.75" /></>),
  cash:      icon(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 10v4M18 10v4" /></>),
  doc:       icon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 12h8M8 16h5" /></>),
  hourglass: icon(<><path d="M6 2h12" /><path d="M6 22h12" /><path d="M6 2v6l6 4 6-4V2" /><path d="M6 22v-6l6-4 6 4v6" /></>),
};

const MONTHS = [
  { n: 1,  label: "January"   }, { n: 2,  label: "February" },
  { n: 3,  label: "March"     }, { n: 4,  label: "April"    },
  { n: 5,  label: "May"       }, { n: 6,  label: "June"     },
  { n: 7,  label: "July"      }, { n: 8,  label: "August"   },
  { n: 9,  label: "September" }, { n: 10, label: "October"  },
  { n: 11, label: "November"  }, { n: 12, label: "December" },
];

const STATUS_OPTIONS = [
  { value: "",         label: "All statuses" },
  { value: "PENDING",  label: "Pending"      },
  { value: "PAID",     label: "Paid"         },
];


// ---- Helpers ----
function inr(n) {
  const v = Number(n || 0);
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "—"; }
}
function monthName(n) {
  const m = MONTHS.find((x) => x.n === n);
  return m ? m.label : "—";
}


// =====================================================================
// Component
// =====================================================================

export default function PayrollRecords() {

  const navigate = useNavigate();

  // ---- Filters ----
  const today = new Date();
  const [q,           setQ          ] = useState("");
  const [deptId,      setDeptId     ] = useState("");
  const [year,        setYear       ] = useState("");
  const [month,       setMonth      ] = useState("");
  const [status,      setStatus     ] = useState("");
  const [dateFrom,    setDateFrom   ] = useState("");
  const [dateTo,      setDateTo     ] = useState("");
  const [page,        setPage       ] = useState(1);
  const [pageSize,    setPageSize   ] = useState(20);

  // ---- Data ----
  const [rows,        setRows       ] = useState([]);
  const [total,       setTotal      ] = useState(0);
  const [summary,     setSummary    ] = useState({
    total_records: 0, total_amount: 0, employees_paid: 0, pending: 0,
  });
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading    ] = useState(true);
  const [error,       setError      ] = useState("");

  // ---- Modal state ----
  const [previewSlipId, setPreviewSlipId] = useState(null);
  const [pdfBusyFor,    setPdfBusyFor   ] = useState(null); // slip.ID mid-download

  // ---- Load departments once ----
  useEffect(() => {
    API.get("/departments")
      .then((r) => setDepartments(r.data || []))
      .catch(() => setDepartments([]));
  }, []);

  // ---- Load rows + summary whenever filters change ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (q)         params.set("q", q);
    if (deptId)    params.set("department_id", deptId);
    if (year)      params.set("year",   year);
    if (month)     params.set("month",  month);
    if (status)    params.set("status", status);
    if (dateFrom)  params.set("date_from", dateFrom);
    if (dateTo)    params.set("date_to",   dateTo);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));

    const summaryParams = new URLSearchParams();
    if (year)  summaryParams.set("year",  year);
    if (month) summaryParams.set("month", month);

    Promise.all([
      API.get(`/payroll/records?${params.toString()}`),
      API.get(`/payroll/records/summary?${summaryParams.toString()}`),
    ])
      .then(([listRes, sumRes]) => {
        if (cancelled) return;
        setRows(listRes.data?.rows || []);
        setTotal(listRes.data?.total || 0);
        setSummary(sumRes.data || {});
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.detail || "Could not load payroll records.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [q, deptId, year, month, status, dateFrom, dateTo, page, pageSize]);

  // Reset page whenever a filter (other than page itself) changes.
  useEffect(() => { setPage(1); }, [q, deptId, year, month, status, dateFrom, dateTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // ---- Row actions ----
  const openView = (row) => setPreviewSlipId(row.PAYROLL_ID);

  const openPdfNewTab = (row) => {
    window.open(`${API_BASE_URL}/my-payslips/${row.PAYROLL_ID}/pdf`, "_blank");
  };

  const downloadPdf = async (row) => {
    setPdfBusyFor(row.PAYROLL_ID);
    try {
      const res = await API.get(`/my-payslips/${row.PAYROLL_ID}/pdf`, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `Payslip-${row.PAYSLIP_NUMBER || row.PAYROLL_ID}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch (err) {
      alert(err?.response?.data?.detail || "Download failed.");
    } finally {
      setPdfBusyFor(null);
    }
  };

  const deleteRow = async (row) => {
    if (!window.confirm(
      `Delete payroll record for ${row.EMPLOYEE_NAME} (${monthName(row.PAY_MONTH)} ${row.PAY_YEAR})? This cannot be undone.`
    )) return;
    try {
      await API.delete(`/payroll/slips/${row.PAYROLL_ID}`);
      // Refresh in place — cheapest way is to nudge one of the filter
      // deps; toggling page then back forces the effect to re-run.
      setRows((prev) => prev.filter((r) => r.PAYROLL_ID !== row.PAYROLL_ID));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      alert(err?.response?.data?.detail || "Delete failed.");
    }
  };

  const clearFilters = () => {
    setQ(""); setDeptId(""); setYear(""); setMonth("");
    setStatus(""); setDateFrom(""); setDateTo("");
  };

  // ---- Year dropdown values — last 5 + next 1 ----
  const yearOptions = useMemo(() => {
    const cur = today.getFullYear();
    const list = [];
    for (let y = cur + 1; y >= cur - 4; y--) list.push(y);
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ==================================================================
  // Render
  // ==================================================================

  return (
    <div className={styles.page}>

      {/* ---------- Header ---------- */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Payroll Records</h1>
          <div className={styles.subtitle}>
            Complete payroll history — every generated payslip, ready
            for review, download, or MD reporting.
          </div>
        </div>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => navigate("/payslip-generator")}
          title="Open the Zoho-style payslip generator form"
        >
          + Generate New Payroll
        </button>
      </div>

      {/* ---------- Summary tiles ---------- */}
      <div className={styles.tileRow}>
        <SummaryTile
          label="Total Payrolls Generated"
          value={summary.total_records}
          icon={I.doc}
          tint="blue"
        />
        <SummaryTile
          label="Total Payroll Amount"
          value={inr(summary.total_amount)}
          icon={I.cash}
          tint="green"
          isCurrency
        />
        <SummaryTile
          label="Employees Paid"
          value={summary.employees_paid}
          icon={I.users}
          tint="amber"
        />
        <SummaryTile
          label="Pending Payrolls"
          value={summary.pending}
          icon={I.hourglass}
          tint="red"
        />
      </div>

      {/* ---------- Filter bar ---------- */}
      <div className={styles.filterCard}>

        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>{I.search}</span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by name or employee code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className={styles.filterGrid}>

          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Department</span>
            <select
              className={styles.filterInput}
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.ID} value={d.ID}>{d.NAME}</option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Month</span>
            <select
              className={styles.filterInput}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">All months</option>
              {MONTHS.map((m) => (
                <option key={m.n} value={m.n}>{m.label}</option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Year</span>
            <select
              className={styles.filterInput}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">All years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Status</span>
            <select
              className={styles.filterInput}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>

          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Pay Date</span>
            <input
              type="date"
              className={styles.filterInput}
              value={dateFrom}
              onChange={(e) => {
                // One date input drives both bounds — the backend still
                // takes a range, so we set FROM and TO to the same day
                // and it filters to just that day's payslips.
                const d = e.target.value;
                setDateFrom(d);
                setDateTo(d);
              }}
            />
          </label>

        </div>

        <div className={styles.filterFoot}>
          <div className={styles.filterCount}>
            {loading
              ? "Loading…"
              : total === 0
                ? "No records"
                : `${total} record${total === 1 ? "" : "s"}`}
          </div>
          <button
            type="button"
            className={styles.filterClear}
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* ---------- Table ---------- */}
      <div className={styles.tableCard}>
        {error && <div className={styles.errorRow}>{error}</div>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Payroll ID</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Period</th>
                <th>Pay Date</th>
                <th className={styles.numTh}>Basic</th>
                <th className={styles.numTh}>Earnings</th>
                <th className={styles.numTh}>Deductions</th>
                <th className={styles.numTh}>Net Salary</th>
                <th>Status</th>
                <th>Generated</th>
                <th className={styles.actionsTh}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={13} className={styles.emptyRow}>Loading payroll records…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={13} className={styles.emptyRow}>
                    No payroll records match the current filters.
                  </td>
                </tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={r.PAYROLL_ID}>
                  <td className={styles.mono}>{r.PAYSLIP_NUMBER || `#${r.PAYROLL_ID}`}</td>
                  <td>
                    <div className={styles.empName}>{r.EMPLOYEE_NAME || "—"}</div>
                    <div className={styles.empCode}>{r.EMPLOYEE_CODE || "—"}</div>
                  </td>
                  <td>{r.DEPARTMENT || "—"}</td>
                  <td>{r.DESIGNATION || "—"}</td>
                  <td>
                    <div className={styles.periodMain}>{monthName(r.PAY_MONTH)}</div>
                    <div className={styles.periodSub}>{r.PAY_YEAR}</div>
                  </td>
                  <td>{fmtDate(r.PAY_DATE)}</td>
                  <td className={styles.numTd}>{inr(r.BASIC_SALARY)}</td>
                  <td className={styles.numTd}>{inr(r.TOTAL_EARNINGS)}</td>
                  <td className={`${styles.numTd} ${styles.deductionCell}`}>−{inr(r.TOTAL_DEDUCTIONS)}</td>
                  <td className={`${styles.numTd} ${styles.netCell}`}>{inr(r.NET_SALARY)}</td>
                  <td>
                    <span className={`${styles.statusChip} ${styles[`status_${(r.STATUS || "PENDING").toLowerCase()}`]}`}>
                      {r.STATUS || "PENDING"}
                    </span>
                  </td>
                  <td>
                    <div>{r.GENERATED_BY || "System"}</div>
                    <div className={styles.periodSub}>{fmtDate(r.GENERATED_DATE)}</div>
                  </td>
                  <td className={styles.actionsTd}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="View payslip"
                      onClick={() => openView(r)}
                    >
                      {I.view}
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Download PDF"
                      disabled={pdfBusyFor === r.PAYROLL_ID}
                      onClick={() => downloadPdf(r)}
                    >
                      {I.download}
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Print"
                      onClick={() => openPdfNewTab(r)}
                    >
                      {I.print}
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      title={r.STATUS === "PAID" ? "Paid slips cannot be deleted" : "Delete"}
                      disabled={r.STATUS === "PAID"}
                      onClick={() => deleteRow(r)}
                    >
                      {I.trash}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---------- Pagination ---------- */}
        {total > 0 && (
          <div className={styles.pager}>
            <div className={styles.pagerInfo}>
              Showing {(page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, total)} of {total}
            </div>
            <div className={styles.pagerRight}>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <div className={styles.pagerNum}>
                Page {page} of {totalPages}
              </div>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
              <select
                className={styles.pagerSize}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ---------- Preview modal ---------- */}
      {previewSlipId && (
        <PayslipPreview
          slipId={previewSlipId}
          onClose={() => setPreviewSlipId(null)}
        />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// SummaryTile — 4 cards at the top with icon + label + value.
// ---------------------------------------------------------------------
function SummaryTile({ label, value, icon, tint }) {
  return (
    <div className={`${styles.tile} ${styles[`tile_${tint}`]}`}>
      <div className={`${styles.tileIcon} ${styles[`tint_${tint}`]}`}>
        {icon}
      </div>
      <div className={styles.tileBody}>
        <div className={styles.tileLabel}>{label}</div>
        <div className={styles.tileValue}>{value ?? 0}</div>
      </div>
    </div>
  );
}
