// =====================================================================
// BiometricImport — admin page at /biometric-import
//
// Fallback path when the ESSL/ZKTeco device can't reach the ERP over
// the network. Admin exports attendance from the device onto a USB
// pen drive, then uploads that file here. Backend parses the ATTLOG
// format, dedups, maps PIN → Employee, writes Attendance rows.
//
// How to export on the device (ESSL X2008):
//   1. Insert USB pen drive
//   2. Menu → USB Manager → Download → Attendance Data
//   3. Wait for "Download successful"
//   4. Remove USB, plug into PC
//   5. Upload the file (usually 1_attlog.dat or attlog.txt) here
// =====================================================================

import { useState } from "react";

import API from "../services/api";


const DEFAULT_SN = "JNP2255102739";   // ESSL X2008 currently on-site

// Month picker default — the current month, in YYYY-MM shape
function _thisMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}


export default function BiometricImport() {

  const [file, setFile] = useState(null);

  const [deviceSn, setDeviceSn] = useState(DEFAULT_SN);

  const [busy, setBusy] = useState(false);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  // Per-employee calc summary — fetched after a successful upload,
  // or on demand via the "Refresh" button below the table.
  const [summaryMonth, setSummaryMonth] = useState(_thisMonthISO());
  const [workingDaysOverride, setWorkingDaysOverride] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  // When the upload flow calls fetchSummary right after import, it
  // passes the list of Employee.IDs that appeared in the file, so the
  // table shows only those employees. The "Calculate" button clears
  // this filter and shows everyone.
  const [uploadFilterIds, setUploadFilterIds] = useState(null);

  // Close-and-run (Phase 2) — one-click month closure + payroll run
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeResult, setCloseResult] = useState(null);
  const [closeError, setCloseError] = useState("");


  // --------------------------------------------------------------
  // Close month + auto-generate payroll — hits /payroll/close-and-run.
  // Fills ABSENT rows for missing working days, then generates the
  // PayrollRun + slips for the selected month.
  // --------------------------------------------------------------
  const closeAndRun = async () => {
    if (!summaryMonth || !/^\d{4}-\d{2}$/.test(summaryMonth)) {
      setCloseError("Pick a month in YYYY-MM format first.");
      return;
    }
    const ok = window.confirm(
      `Close ${summaryMonth} and generate payroll?\n\n` +
      `This will:\n` +
      `- Fill ABSENT for every working day (Mon–Sat) with no punch and no leave\n` +
      `- Generate a DRAFT PayrollRun with per-employee slips\n\n` +
      `Safe to re-run — existing rows are preserved. OK to continue?`
    );
    if (!ok) return;

    const [yStr, mStr] = summaryMonth.split("-");
    setCloseBusy(true);
    setCloseError("");
    setCloseResult(null);
    try {
      const body = {
        VENDOR_ID: 1,
        YEAR: Number(yStr),
        MONTH: Number(mStr),
        UP_TO_TODAY_ONLY: false,
        OVERWRITE: false,
      };
      const wd = parseInt(workingDaysOverride, 10);
      if (!Number.isNaN(wd) && wd > 0) body.WORKING_DAYS = wd;

      const res = await API.post("/payroll/close-and-run", body);
      setCloseResult(res.data);
      // Refresh the calc table so ABSENT rows show up
      fetchSummary(summaryMonth, null);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Close + run failed";
      setCloseError(String(detail));
    } finally {
      setCloseBusy(false);
    }
  };


  // --------------------------------------------------------------
  // Summary fetch — hits /iclock/import-summary?year=&month=
  // Reads Attendance rows (already written by the upload above OR
  // by the ADMS-push flow) and applies the payroll rules.
  //
  // filterIds: array of Employee.IDs to scope the result to. null =
  // no filter (show everyone). Pass [] to explicitly show nobody.
  // --------------------------------------------------------------
  const fetchSummary = async (month = summaryMonth, filterIds = null) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      setSummaryError("Pick a month in YYYY-MM format first.");
      return;
    }
    const [yStr, mStr] = month.split("-");
    setSummaryBusy(true);
    setSummaryError("");
    try {
      const params = { year: Number(yStr), month: Number(mStr) };
      const wd = parseInt(workingDaysOverride, 10);
      if (!Number.isNaN(wd) && wd > 0) params.working_days = wd;
      if (Array.isArray(filterIds) && filterIds.length > 0) {
        params.employee_ids = filterIds.join(",");
      }
      const res = await API.get("/iclock/import-summary", { params });
      setSummary(res.data);
      setUploadFilterIds(
        Array.isArray(filterIds) && filterIds.length > 0 ? filterIds : null
      );
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Failed to load summary";
      setSummaryError(String(detail));
      setSummary(null);
    } finally {
      setSummaryBusy(false);
    }
  };


  const upload = async (e) => {

    e.preventDefault();

    if (!file) {

      setError("Choose a file first.");

      return;
    }

    setBusy(true);

    setError("");

    setResult(null);

    try {

      const fd = new FormData();

      fd.append("file", file);

      fd.append("device_sn", (deviceSn || "MANUAL_USB").trim());

      const res = await API.post("/iclock/import-attlog", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      setResult(res.data);

      // Auto-fire the summary for the picked month so HR sees the
      // calculated numbers immediately after upload. Scope to just
      // the employees that were present in the uploaded file.
      const affected = Array.isArray(res.data?.affected_employee_ids)
        ? res.data.affected_employee_ids
        : [];
      fetchSummary(summaryMonth, affected);

    } catch (err) {

      const detail = err?.response?.data?.detail || err?.message || "Upload failed";

      setError(String(detail));

    } finally {

      setBusy(false);
    }
  };


  return (

    <div style={styles.page}>

      <div style={styles.card}>

        <div style={styles.eyebrow}>ATTENDANCE · ADMIN</div>

        <h1 style={styles.title}>Biometric Data Import (USB)</h1>

        <p style={styles.lede}>
          Upload the attendance log exported from the ESSL device via
          USB pen drive. Punches will be matched to employees via the
          PIN column and written into today's Attendance table.
        </p>

        <form onSubmit={upload} style={styles.form}>

          <label style={styles.label}>Device Serial Number</label>

          <input
            type="text"
            value={deviceSn}
            onChange={(e) => setDeviceSn(e.target.value)}
            placeholder="JNP2255102739"
            style={styles.input}
          />

          <div style={styles.hint}>
            Auto-filled with the ESSL X2008 on-site. Change if you're
            uploading data from a different device.
          </div>

          <label style={{ ...styles.label, marginTop: 18 }}>
            Attendance File
          </label>

          <input
            type="file"
            accept=".dat,.txt,.csv,.log,.xlsx,.xlsm,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={styles.file}
          />

          <div style={styles.hint}>
            Accepted: text exports (<code>1_attlog.dat</code>,
            {" "}<code>attlog.txt</code>) or an Excel workbook
            (<code>.xlsx</code>) with columns for PIN/EnrollNo and
            Date/Time.
          </div>

          <button type="submit" disabled={busy || !file} style={styles.btn}>
            {busy ? "Uploading…" : "Upload & Import"}
          </button>

        </form>

        {error && (
          <div style={styles.error}>
            <b>Error:</b> {error}
          </div>
        )}

        {result && (
          <div style={styles.success}>
            <div style={styles.successTitle}>
              ✓ Imported {result.rows_inserted} new punches
            </div>
            <table style={styles.table}>
              <tbody>
                <tr>
                  <td>File</td>
                  <td>{result.filename}</td>
                </tr>
                <tr>
                  <td>Device SN</td>
                  <td>{result.device_sn}</td>
                </tr>
                <tr>
                  <td>Records seen in file</td>
                  <td>{result.records_seen}</td>
                </tr>
                <tr>
                  <td>New rows inserted</td>
                  <td>{result.rows_inserted}</td>
                </tr>
                <tr>
                  <td>Skipped (already imported)</td>
                  <td>{result.rows_skipped_as_duplicate}</td>
                </tr>
              </tbody>
            </table>
            <div style={styles.next}>
              Head to <a href="/attendance" style={styles.link}>Attendance → Today</a>
              {" "}to verify the check-in / check-out times landed on each employee.
            </div>
          </div>
        )}

        {/* ================================================
             Per-employee calculation summary
             ================================================ */}
        <div style={styles.summary}>
          <div style={styles.summaryHead}>
            <div>
              <div style={styles.summaryTitle}>Monthly calculation</div>
              <div style={styles.summarySub}>
                Reads the attendance rows for the chosen month and
                applies the payroll rules (OT starts 7:00 PM, 3 late
                arrivals = 0.5 day deduction, OT hours offset by late
                minutes). Read-only — nothing is written to payroll.
              </div>
            </div>
          </div>

          <div style={styles.filterRow}>
            <div style={styles.filterField}>
              <label style={styles.filterLabel}>Month</label>
              <input
                type="month"
                value={summaryMonth}
                onChange={(e) => setSummaryMonth(e.target.value)}
                style={styles.filterInput}
              />
            </div>

            <div style={styles.filterField}>
              <label style={styles.filterLabel}>Working days (override)</label>
              <input
                type="number"
                min="1"
                max="31"
                placeholder="auto"
                value={workingDaysOverride}
                onChange={(e) => setWorkingDaysOverride(e.target.value)}
                style={styles.filterInput}
              />
            </div>

            <button
              type="button"
              onClick={() => fetchSummary(summaryMonth, null)}
              disabled={summaryBusy}
              style={styles.summaryBtn}
            >
              {summaryBusy ? "Loading…" : "Calculate"}
            </button>

            <button
              type="button"
              onClick={closeAndRun}
              disabled={closeBusy || summaryBusy}
              style={styles.closeRunBtn}
              title="Fill ABSENT rows for missing days, then generate DRAFT payroll for this month"
            >
              {closeBusy ? "Closing…" : "Close month + generate payroll"}
            </button>
          </div>

          {summaryError && (
            <div style={styles.error}><b>Error:</b> {summaryError}</div>
          )}

          {closeError && (
            <div style={styles.error}><b>Close error:</b> {closeError}</div>
          )}

          {closeResult && (
            <div style={styles.closeSuccess}>
              <div style={styles.closeSuccessTitle}>
                Payroll ready — {closeResult.run?.PERIOD_LABEL || `${closeResult.run?.PAY_YEAR}-${String(closeResult.run?.PAY_MONTH || "").padStart(2, "0")}`}
              </div>
              <div style={styles.closeSuccessBody}>
                {closeResult.closure?.absent_rows_created} ABSENT row(s) filled ·
                {" "}{closeResult.run?.EMPLOYEE_COUNT || 0} payslip(s) generated ·
                {" "}total net ₹{Number(closeResult.run?.TOTAL_NET || 0).toLocaleString("en-IN")}
                {" "}·{" "}
                <a href="/payroll-records" style={styles.link}>
                  Open Payroll Records
                </a>
              </div>
            </div>
          )}

          {summary && summary.employees && summary.employees.length > 0 && (
            <>
              <div style={styles.summaryMeta}>
                {summary.count} employee{summary.count === 1 ? "" : "s"} · month {summary.year}-{String(summary.month).padStart(2, "0")}
                {uploadFilterIds && uploadFilterIds.length > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "#b45309", fontWeight: 700 }}>
                      showing only employees from the last upload
                    </span>
                    {"  "}
                    <button
                      type="button"
                      onClick={() => fetchSummary(summaryMonth, null)}
                      style={styles.clearFilterBtn}
                    >
                      Show all
                    </button>
                  </>
                )}
              </div>
              <div style={styles.tableWrap}>
                <table style={styles.calcTable}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Code</th>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Basic</th>
                      <th style={styles.th}>WD</th>
                      <th style={styles.th}>Pres</th>
                      <th style={styles.th}>Abs</th>
                      <th style={styles.th}>CL</th>
                      <th style={styles.th}>Late</th>
                      <th style={styles.th} title="Half-day deduction from 3× late rule">½D-pen</th>
                      <th style={styles.th}>Gross OT (h)</th>
                      <th style={styles.th} title="Gross OT − late minutes, capped at 0">Net OT (h)</th>
                      <th style={styles.th}>Per-day ₹</th>
                      <th style={styles.th}>Abs. deduction ₹</th>
                      <th style={styles.th}>OT pay ₹</th>
                      <th style={styles.th}>Net ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.employees.map((r) => (
                      <tr key={r.employee_id}>
                        <td style={styles.tdMono}>{r.employee_code || "—"}</td>
                        <td style={styles.td}>{r.name || "—"}</td>
                        <td style={styles.tdNum}>{Number(r.basic_salary || 0).toLocaleString("en-IN")}</td>
                        <td style={styles.tdNum}>{r.working_days}</td>
                        <td style={styles.tdNum}>{r.present_days}</td>
                        <td style={styles.tdNum}>{r.absent_days}</td>
                        <td style={styles.tdNum}>{r.cl_used}</td>
                        <td style={styles.tdNum}>{r.late_arrivals}</td>
                        <td style={styles.tdNum}>{r.half_day_penalty}</td>
                        <td style={styles.tdNum}>{r.gross_ot_hours}</td>
                        <td style={{ ...styles.tdNum, fontWeight: 700 }}>{r.net_ot_hours}</td>
                        <td style={styles.tdNum}>{Number(r.per_day_rate || 0).toLocaleString("en-IN")}</td>
                        <td style={{ ...styles.tdNum, color: "#b91c1c" }}>
                          {Number(r.absence_deduction || 0).toLocaleString("en-IN")}
                        </td>
                        <td style={{ ...styles.tdNum, color: "#047857" }}>
                          {Number(r.ot_pay || 0).toLocaleString("en-IN")}
                        </td>
                        <td style={{ ...styles.tdNum, fontWeight: 800 }}>
                          {Number(r.net_pay || 0).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.summaryFoot}>
                Legend — WD = working days · Pres = days present ·
                Abs = days absent · CL = casual leave used ·
                ½D-pen = half-day penalty from 3× late rule ·
                Net OT = Gross OT with late-minute offset applied.
              </div>
            </>
          )}

          {summary && summary.employees && summary.employees.length === 0 && !summaryBusy && (
            <div style={styles.summaryEmpty}>
              {uploadFilterIds && uploadFilterIds.length > 0 ? (
                <>
                  Uploaded file didn't match any known employees for
                  this month.{" "}
                  <button
                    type="button"
                    onClick={() => fetchSummary(summaryMonth, null)}
                    style={styles.clearFilterBtn}
                  >
                    Show all
                  </button>
                </>
              ) : (
                <>
                  No active employees found for that month. Upload the
                  attendance file above, then click <b>Calculate</b>.
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.help}>
          <div style={styles.helpTitle}>Export from device — step-by-step</div>
          <ol style={styles.helpList}>
            <li>Insert a USB pen drive into the ESSL X2008.</li>
            <li>On the device: <b>Menu → USB Manager → Download → Attendance Data</b>.</li>
            <li>Wait for the "Download successful" beep.</li>
            <li>Remove the USB drive, plug it into this PC.</li>
            <li>Choose the file above (usually <code>1_attlog.dat</code>).</li>
            <li>Click <b>Upload &amp; Import</b>.</li>
          </ol>
        </div>

      </div>
    </div>
  );
}


const styles = {
  page: {
    minHeight: "100vh",
    padding: 24,
    background: "var(--layout-bg, #f4f6fa)",
    boxSizing: "border-box",
  },
  card: {
    maxWidth: "100%",
    margin: "0 auto",
    background: "var(--card-bg, #fff)",
    borderRadius: 14,
    padding: 28,
    boxShadow: "0 6px 20px rgba(15,23,42,0.06)",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: "#dc2626",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    margin: "6px 0 8px 0",
    color: "var(--text-primary, #0f172a)",
    letterSpacing: -0.3,
  },
  lede: {
    fontSize: 14,
    color: "var(--text-secondary, #475569)",
    lineHeight: 1.55,
    margin: "0 0 22px 0",
  },
  form: {
    display: "flex",
    flexDirection: "column",
  },
  label: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "var(--text-secondary, #475569)",
    marginBottom: 6,
  },
  input: {
    padding: "10px 12px",
    border: "1px solid var(--border-strong, #cbd5e1)",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
  },
  file: {
    padding: 6,
    border: "1px dashed #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "#f8fafc",
  },
  hint: {
    fontSize: 12,
    color: "var(--text-muted, #64748b)",
    marginTop: 4,
    lineHeight: 1.5,
  },
  btn: {
    marginTop: 22,
    padding: "12px 20px",
    border: "none",
    borderRadius: 10,
    background: "#dc2626",
    color: "#fff",
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: 0.4,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  error: {
    marginTop: 18,
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 8,
    fontSize: 13,
  },
  success: {
    marginTop: 18,
    padding: 16,
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    borderRadius: 10,
  },
  successTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: "#065f46",
    marginBottom: 10,
  },
  table: {
    width: "100%",
    fontSize: 13,
    borderCollapse: "collapse",
  },
  next: {
    marginTop: 12,
    fontSize: 13,
    color: "#065f46",
  },
  link: {
    color: "#dc2626",
    fontWeight: 700,
    textDecoration: "underline",
  },
  help: {
    marginTop: 28,
    padding: 16,
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid var(--border, #e2e8f0)",
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: "var(--text-primary, #0f172a)",
    marginBottom: 8,
  },
  helpList: {
    margin: 0,
    paddingLeft: 20,
    fontSize: 13,
    lineHeight: 1.7,
    color: "var(--text-secondary, #475569)",
  },

  // ---- monthly-calc summary block ----
  summary: {
    marginTop: 28,
    padding: 18,
    background: "#ffffff",
    border: "1px solid var(--border, #e2e8f0)",
    borderRadius: 12,
  },
  summaryHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
    gap: 10,
    flexWrap: "wrap",
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: "var(--text-primary, #0f172a)",
  },
  summarySub: {
    fontSize: 12.5,
    color: "var(--text-secondary, #475569)",
    lineHeight: 1.5,
    maxWidth: 620,
    marginTop: 4,
  },
  filterRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  filterField: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "var(--text-secondary, #475569)",
  },
  filterInput: {
    padding: "9px 12px",
    border: "1px solid var(--border-strong, #cbd5e1)",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    minWidth: 160,
  },
  summaryBtn: {
    padding: "10px 18px",
    border: "none",
    borderRadius: 8,
    background: "#0f172a",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    height: 40,
  },
  summaryMeta: {
    fontSize: 12,
    color: "var(--text-muted, #64748b)",
    marginBottom: 8,
  },
  tableWrap: {
    overflowX: "auto",
    borderRadius: 8,
    border: "1px solid var(--border, #e2e8f0)",
  },
  calcTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12.5,
    minWidth: 1100,
  },
  th: {
    padding: "8px 10px",
    textAlign: "left",
    background: "#f8fafc",
    borderBottom: "1px solid var(--border, #e2e8f0)",
    fontWeight: 700,
    color: "var(--text-secondary, #334155)",
    fontSize: 11.5,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid #f1f5f9",
    color: "var(--text-primary, #0f172a)",
    whiteSpace: "nowrap",
  },
  tdMono: {
    padding: "8px 10px",
    borderBottom: "1px solid #f1f5f9",
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 12,
    color: "var(--text-secondary, #475569)",
  },
  tdNum: {
    padding: "8px 10px",
    borderBottom: "1px solid #f1f5f9",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-primary, #0f172a)",
  },
  summaryFoot: {
    marginTop: 10,
    fontSize: 11.5,
    color: "var(--text-muted, #64748b)",
    lineHeight: 1.55,
  },
  closeRunBtn: {
    padding: "10px 18px",
    border: "none",
    borderRadius: 8,
    background: "#dc2626",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    height: 40,
  },
  closeSuccess: {
    marginTop: 12,
    padding: 14,
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    borderRadius: 10,
  },
  closeSuccessTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: "#065f46",
    marginBottom: 4,
  },
  closeSuccessBody: {
    fontSize: 13,
    color: "#065f46",
    lineHeight: 1.5,
  },
  clearFilterBtn: {
    marginLeft: 8,
    padding: "3px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  summaryEmpty: {
    padding: 22,
    textAlign: "center",
    color: "var(--text-muted, #64748b)",
    fontSize: 13,
    background: "#f8fafc",
    borderRadius: 8,
    border: "1px dashed #cbd5e1",
  },
};
