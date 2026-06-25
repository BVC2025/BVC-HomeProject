import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";
import styles from "./Payroll.module.css";


const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];


function inr(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });
}

function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-IN"); }
  catch { return s; }
}


export default function Payroll() {
  const [tab, setTab] = useState("current");

  return (
    <div className={styles.page}>

      {/* Hero — clean white banner */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>Finance</div>
          <h1 className={styles.heroTitle}>Payroll</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {[
          { key: "current", label: "Current Run" },
          { key: "history", label: "History" },
          { key: "reports", label: "Reports" },
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

      {tab === "current" && <CurrentRun />}
      {tab === "history" && <HistoryTab />}
      {tab === "reports" && <ReportsTab />}
    </div>
  );
}


// =====================================================================
// CURRENT RUN — month/year picker, generate, finalize, mark-paid
// =====================================================================
function CurrentRun() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [run, setRun] = useState(null);
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const yearOptions = useMemo(() => {
    const yr = today.getFullYear();
    return [yr - 2, yr - 1, yr, yr + 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSlips = async (y, m) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const runs = await API.get(`/payroll/runs?year=${y}`);
      const match = (runs.data || []).find((r) => r.PAY_YEAR === y && r.PAY_MONTH === m);
      if (!match) {
        setRun(null);
        setSlips([]);
        return;
      }
      const detail = await API.get(`/payroll/runs/${match.ID}`);
      setRun(detail.data?.run || null);
      setSlips(detail.data?.slips || []);
    } catch (err) {
      console.log(err);
      setErrorMsg("Could not load payroll for this month.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlips(year, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const generate = async () => {
    setGenerating(true);
    try {
      await API.post("/payroll/generate", { YEAR: year, MONTH: month, OVERWRITE: true });
      await fetchSlips(year, month);
    } catch (err) {
      alert(err?.response?.data?.detail || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const finalize = async () => {
    if (!run || run.STATUS !== "DRAFT") return;
    if (!window.confirm("Finalize this payroll run? After finalize, slips can no longer be edited.")) return;
    try {
      await API.patch(`/payroll/runs/${run.ID}/finalize`);
      await fetchSlips(year, month);
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not finalize.");
    }
  };

  const markRunPaid = async () => {
    if (!run) return;
    if (!window.confirm(`Mark all ${slips.length} slips as PAID? This sets payment status for the entire run.`)) return;
    try {
      await API.patch(`/payroll/runs/${run.ID}/mark-paid`);
      await fetchSlips(year, month);
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not mark paid.");
    }
  };

  const markPaid = async (slipId) => {
    try {
      const res = await API.patch(`/payroll/slips/${slipId}/mark-paid`);
      const updated = res.data?.slip;
      if (updated) {
        setSlips((prev) => prev.map((s) => (s.ID === updated.ID ? { ...s, ...updated } : s)));
      }
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not mark paid.");
    }
  };

  const statusTone = run?.STATUS === "PAID"
    ? { bg: "#dcfce7", fg: "#166534" }
    : run?.STATUS === "FINALIZED"
      ? { bg: "#dbeafe", fg: "#1e40af" }
      : run?.STATUS === "DRAFT"
        ? { bg: "#fef3c7", fg: "#92400e" }
        : { bg: "#f1f5f9", fg: "#475569" };

  const paidCount = slips.filter((s) => s.STATUS === "PAID").length;

  return (
    <>
      {/* Controls */}
      <div className={styles.controls}>
        <div>
          <div className={styles.pickerLabel}>Month</div>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={styles.picker}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>

        <div>
          <div className={styles.pickerLabel}>Year</div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={styles.picker}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <button
          onClick={generate}
          disabled={generating}
          className={styles.generateBtn}
        >
          {generating ? "Generating…" : slips.length ? "Re-generate" : "Generate Payroll"}
        </button>

        {/* Finalize — DRAFT only */}
        {run?.STATUS === "DRAFT" && (
          <button onClick={finalize} className={styles.finalizeBtn}>
            ✓ Finalize Run
          </button>
        )}

        {/* Mark All Paid — FINALIZED only */}
        {run?.STATUS === "FINALIZED" && (
          <button onClick={markRunPaid} className={styles.markAllPaidBtn}>
            ✓ Mark All Paid
          </button>
        )}

        <div className={styles.controlsHint}>
          Salary is auto-computed from attendance, approved leaves, and permission hours for the selected month.
        </div>
      </div>

      <div className={styles.body}>

        {loading && <div className={styles.loadingText}>Loading…</div>}
        {!loading && errorMsg && <div className={styles.errorText}>{errorMsg}</div>}
        {!loading && !errorMsg && slips.length === 0 && (
          <div className={styles.emptyText}>
            No payroll generated for {MONTH_NAMES[month - 1]} {year} yet.
            Click <strong>Generate Payroll</strong> above.
          </div>
        )}

        {!loading && slips.length > 0 && (
          <>
            <div className={styles.tableMeta}>
              <div className={styles.tableMetaTitle}>
                {MONTH_NAMES[month - 1]} {year} · {slips.length} employees
                {" "}
                <span style={{
                  display: "inline-block",
                  padding: "2px 10px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  background: statusTone.bg,
                  color: statusTone.fg,
                  marginLeft: 8,
                }}>
                  {run?.STATUS || "DRAFT"}
                </span>
              </div>
              <div className={styles.tableMetaSub}>
                {paidCount} paid · {slips.length - paidCount} pending ·
                {" "}Net ₹{inr(run?.TOTAL_NET)}
              </div>
            </div>

            <table className={styles.table}>
              <thead className={styles.thead}>
                <tr>
                  <th className={styles.th}>Employee</th>
                  <th className={styles.thRight}>Base</th>
                  <th className={styles.thCenter}>Present</th>
                  <th className={styles.thCenter}>Leave</th>
                  <th className={styles.thCenter}>Permission</th>
                  <th className={styles.thCenter}>Rating</th>
                  <th className={styles.thRight}>Bonus</th>
                  <th className={styles.thRight}>Net Pay</th>
                  <th className={styles.thRight}>Action</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => {
                  const isPaid = s.STATUS === "PAID";
                  const leaveDays = Number(s.PAID_LEAVE_DAYS || 0) + Number(s.UNPAID_LEAVE_DAYS || 0);
                  return (
                    <tr key={s.ID} className={`${styles.tr}${isPaid ? ` ${styles.trPaid}` : ""}`}>
                      <td className={styles.td}>
                        <div className={styles.empName}>{s.EMPLOYEE_NAME || "—"}</div>
                        <div className={styles.empCode}>{s.EMPLOYEE_CODE || ""}</div>
                      </td>
                      <td className={styles.tdRight}>₹ {inr(s.BASE_SALARY)}</td>
                      <td className={styles.tdCenter}>
                        {s.DAYS_PRESENT ?? 0}
                        <span className={styles.empCode}>{" / "}{s.WORKING_DAYS ?? 26}</span>
                      </td>
                      <td className={styles.tdCenter}>{leaveDays}</td>
                      <td className={styles.tdCenter}>{Number(s.PERMISSION_HOURS || 0).toFixed(1)}h</td>
                      <td className={styles.tdCenter}>
                        <span className={styles.starRating}>
                          {Number(s.PERFORMANCE_STARS || 0).toFixed(1)}★
                        </span>
                      </td>
                      <td className={styles.bonusCell}>₹ {inr(s.STAR_BONUS)}</td>
                      <td className={styles.netPay}>₹ {inr(s.NET_PAY)}</td>
                      <td className={styles.tdRight}>
                        {isPaid ? (
                          <span className={styles.paidBadge}>✓ Paid</span>
                        ) : (
                          <button onClick={() => markPaid(s.ID)} className={styles.markPaidBtn}>
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}


// =====================================================================
// HISTORY — list of past runs across years
// =====================================================================
function HistoryTab() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openRunId, setOpenRunId] = useState(null);
  const [openRunDetail, setOpenRunDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const yearOptions = useMemo(() => {
    const yr = today.getFullYear();
    return [yr - 3, yr - 2, yr - 1, yr];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOpenRunId(null);
    setOpenRunDetail(null);
    API.get(`/payroll/runs?year=${year}`)
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data) ? r.data : [];
        list.sort((a, b) => (b.PAY_YEAR - a.PAY_YEAR) || (b.PAY_MONTH - a.PAY_MONTH));
        setRuns(list);
      })
      .catch(() => setRuns([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year]);

  const openRun = async (id) => {
    if (openRunId === id) {
      setOpenRunId(null);
      setOpenRunDetail(null);
      return;
    }
    setOpenRunId(id);
    setOpenRunDetail(null);
    setDetailLoading(true);
    try {
      const r = await API.get(`/payroll/runs/${id}`);
      setOpenRunDetail(r.data || null);
    } catch (err) {
      console.log(err);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <div className={styles.controls}>
        <div>
          <div className={styles.pickerLabel}>Year</div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={styles.picker}
          >
            {yearOptions.map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>
        <div className={styles.controlsHint}>
          All payroll runs ever generated for {year}. Click a row to see the slips for that month.
        </div>
      </div>

      <div className={styles.body}>
        {loading && <div className={styles.loadingText}>Loading…</div>}

        {!loading && runs.length === 0 && (
          <div className={styles.emptyText}>
            No payroll runs found for {year}.
          </div>
        )}

        {!loading && runs.length > 0 && (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Period</th>
                <th className={styles.thCenter}>Status</th>
                <th className={styles.thCenter}>Employees</th>
                <th className={styles.thCenter}>Working Days</th>
                <th className={styles.thRight}>Total Gross</th>
                <th className={styles.thRight}>Deductions</th>
                <th className={styles.thRight}>Net</th>
                <th className={styles.th}>Generated</th>
                <th className={styles.thRight}>Action</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const tone = r.STATUS === "PAID"
                  ? { bg: "#dcfce7", fg: "#166534" }
                  : r.STATUS === "FINALIZED"
                    ? { bg: "#dbeafe", fg: "#1e40af" }
                    : { bg: "#fef3c7", fg: "#92400e" };
                const isOpen = openRunId === r.ID;
                return (
                  <>
                    <tr key={r.ID} className={styles.tr}>
                      <td className={styles.td}>
                        <div className={styles.empName}>
                          {MONTH_NAMES[r.PAY_MONTH - 1]} {r.PAY_YEAR}
                        </div>
                        <div className={styles.empCode}>{r.PERIOD_LABEL}</div>
                      </td>
                      <td className={styles.tdCenter}>
                        <span style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: 999,
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: 0.6,
                          background: tone.bg,
                          color: tone.fg,
                        }}>{r.STATUS}</span>
                      </td>
                      <td className={styles.tdCenter}>{r.EMPLOYEE_COUNT || 0}</td>
                      <td className={styles.tdCenter}>{r.WORKING_DAYS || "—"}</td>
                      <td className={styles.tdRight}>₹ {inr(r.TOTAL_GROSS)}</td>
                      <td className={styles.tdRight}>₹ {inr(r.TOTAL_DEDUCTIONS)}</td>
                      <td className={styles.netPay}>₹ {inr(r.TOTAL_NET)}</td>
                      <td className={styles.td} style={{ fontSize: 12, color: "#64748b" }}>
                        {fmtDate(r.CREATED_AT)}
                      </td>
                      <td className={styles.tdRight}>
                        <button
                          className={styles.markPaidBtn}
                          onClick={() => openRun(r.ID)}
                        >
                          {isOpen ? "Hide" : "View slips"}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0, background: "#f8fafc" }}>
                          {detailLoading && <div className={styles.loadingText}>Loading slips…</div>}
                          {!detailLoading && openRunDetail && (
                            <DrillSlipTable slips={openRunDetail.slips || []} />
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}


function DrillSlipTable({ slips }) {
  if (!slips.length) {
    return <div className={styles.emptyText}>No slips in this run.</div>;
  }
  return (
    <div style={{ padding: "12px 18px" }}>
      <table className={styles.table} style={{ marginBottom: 0 }}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Employee</th>
            <th className={styles.thRight}>Base</th>
            <th className={styles.thCenter}>Present</th>
            <th className={styles.thRight}>Net Pay</th>
            <th className={styles.thCenter}>Status</th>
          </tr>
        </thead>
        <tbody>
          {slips.map((s) => (
            <tr key={s.ID} className={`${styles.tr}${s.STATUS === "PAID" ? ` ${styles.trPaid}` : ""}`}>
              <td className={styles.td}>
                <div className={styles.empName}>{s.EMPLOYEE_NAME || "—"}</div>
                <div className={styles.empCode}>{s.EMPLOYEE_CODE || ""}</div>
              </td>
              <td className={styles.tdRight}>₹ {inr(s.BASE_SALARY)}</td>
              <td className={styles.tdCenter}>
                {s.DAYS_PRESENT ?? 0}
                <span className={styles.empCode}>{" / "}{s.WORKING_DAYS ?? 26}</span>
              </td>
              <td className={styles.netPay}>₹ {inr(s.NET_PAY)}</td>
              <td className={styles.tdCenter}>
                {s.STATUS === "PAID"
                  ? <span className={styles.paidBadge}>✓ Paid</span>
                  : <span className={styles.empCode}>Pending</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// =====================================================================
// REPORTS — department / designation / status breakdown + CSV download
// =====================================================================
function ReportsTab() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const yearOptions = useMemo(() => {
    const yr = today.getFullYear();
    return [yr - 3, yr - 2, yr - 1, yr];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load runs for the selected year, auto-select the most recent
  useEffect(() => {
    let cancelled = false;
    setLoadingRuns(true);
    API.get(`/payroll/runs?year=${year}`)
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data) ? r.data : [];
        list.sort((a, b) => (b.PAY_YEAR - a.PAY_YEAR) || (b.PAY_MONTH - a.PAY_MONTH));
        setRuns(list);
        setSelectedRunId(list[0]?.ID || null);
      })
      .catch(() => { setRuns([]); setSelectedRunId(null); })
      .finally(() => { if (!cancelled) setLoadingRuns(false); });
    return () => { cancelled = true; };
  }, [year]);

  // Load summary for the selected run
  useEffect(() => {
    if (!selectedRunId) { setSummary(null); return; }
    let cancelled = false;
    setLoadingSummary(true);
    API.get(`/payroll/runs/${selectedRunId}/summary`)
      .then((r) => { if (!cancelled) setSummary(r.data || null); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoadingSummary(false); });
    return () => { cancelled = true; };
  }, [selectedRunId]);

  const downloadCsv = () => {
    if (!selectedRunId) return;
    const url = `${API_BASE_URL}/payroll/runs/${selectedRunId}/export.csv`;
    window.open(url, "_blank");
  };

  return (
    <>
      <div className={styles.controls}>
        <div>
          <div className={styles.pickerLabel}>Year</div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={styles.picker}
          >
            {yearOptions.map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>
        <div>
          <div className={styles.pickerLabel}>Run</div>
          <select
            value={selectedRunId || ""}
            onChange={(e) => setSelectedRunId(Number(e.target.value) || null)}
            className={styles.picker}
            disabled={loadingRuns || runs.length === 0}
          >
            {runs.length === 0 && <option value="">(no runs)</option>}
            {runs.map((r) => (
              <option key={r.ID} value={r.ID}>
                {MONTH_NAMES[r.PAY_MONTH - 1]} {r.PAY_YEAR} — {r.STATUS}
              </option>
            ))}
          </select>
        </div>
        {selectedRunId && (
          <button onClick={downloadCsv} className={styles.generateBtn}>
            ⬇ Download CSV
          </button>
        )}
      </div>

      <div className={styles.body}>
        {loadingRuns && <div className={styles.loadingText}>Loading runs…</div>}
        {!loadingRuns && runs.length === 0 && (
          <div className={styles.emptyText}>No payroll runs for {year}.</div>
        )}
        {!loadingRuns && runs.length > 0 && loadingSummary && (
          <div className={styles.loadingText}>Loading report…</div>
        )}
        {!loadingRuns && summary && (
          <ReportContent summary={summary} />
        )}
      </div>
    </>
  );
}


function ReportContent({ summary }) {
  const t = summary.totals || {};
  return (
    <>
      {/* Totals tiles */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
        marginBottom: 18,
      }}>
        <ReportTile label="Employees"  value={t.employee_count || 0} color="#1d4ed8" />
        <ReportTile label="Gross"      value={`₹ ${inr(t.total_gross)}`} color="#059669" />
        <ReportTile label="Deductions" value={`₹ ${inr(t.total_deductions)}`} color="#dc2626" />
        <ReportTile label="Net Payout" value={`₹ ${inr(t.total_net)}`} color="#7c3aed" />
      </div>

      {/* By Department */}
      <div className={styles.tableMeta}>
        <div className={styles.tableMetaTitle}>By Department</div>
        <div className={styles.tableMetaSub}>{summary.by_department?.length || 0} departments</div>
      </div>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Department</th>
            <th className={styles.thCenter}>Employees</th>
            <th className={styles.thRight}>Gross</th>
            <th className={styles.thRight}>Deductions</th>
            <th className={styles.thRight}>Net</th>
          </tr>
        </thead>
        <tbody>
          {(summary.by_department || []).map((d) => (
            <tr key={d.department} className={styles.tr}>
              <td className={styles.td}><div className={styles.empName}>{d.department}</div></td>
              <td className={styles.tdCenter}>{d.employee_count}</td>
              <td className={styles.tdRight}>₹ {inr(d.total_gross)}</td>
              <td className={styles.tdRight}>₹ {inr(d.total_deductions)}</td>
              <td className={styles.netPay}>₹ {inr(d.total_net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Status breakdown */}
      <div style={{ height: 18 }} />
      <div className={styles.tableMeta}>
        <div className={styles.tableMetaTitle}>By Payment Status</div>
      </div>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Status</th>
            <th className={styles.thCenter}>Count</th>
            <th className={styles.thRight}>Net</th>
          </tr>
        </thead>
        <tbody>
          {(summary.by_status || []).map((s) => (
            <tr key={s.status} className={styles.tr}>
              <td className={styles.td}><div className={styles.empName}>{s.status}</div></td>
              <td className={styles.tdCenter}>{s.count}</td>
              <td className={styles.netPay}>₹ {inr(s.total_net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* By Designation */}
      <div style={{ height: 18 }} />
      <div className={styles.tableMeta}>
        <div className={styles.tableMetaTitle}>By Designation</div>
        <div className={styles.tableMetaSub}>{summary.by_designation?.length || 0} designations</div>
      </div>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Designation</th>
            <th className={styles.thCenter}>Employees</th>
            <th className={styles.thRight}>Net</th>
          </tr>
        </thead>
        <tbody>
          {(summary.by_designation || []).map((d) => (
            <tr key={d.designation} className={styles.tr}>
              <td className={styles.td}><div className={styles.empName}>{d.designation}</div></td>
              <td className={styles.tdCenter}>{d.employee_count}</td>
              <td className={styles.netPay}>₹ {inr(d.total_net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}


function ReportTile({ label, value, color }) {
  return (
    <div style={{
      background: "white",
      padding: "12px 14px",
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 1.2,
        color: "#94a3b8",
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 800,
        color: "#0f172a",
        marginTop: 4,
        lineHeight: 1.1,
        letterSpacing: "-0.3px",
      }}>
        {value}
      </div>
    </div>
  );
}
