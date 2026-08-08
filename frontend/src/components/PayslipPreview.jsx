// =====================================================================
// PayslipPreview — Zoho-style HTML preview of a single payslip.
// ---------------------------------------------------------------------
// Opens as a full-screen overlay when the employee taps "View" on a
// payslip card. Fetches the full breakdown from
//   GET /my-payslips/{slip_id}
// and lays it out as a letterhead-style document:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ Payslip Preview            [ ← Go Back ]  [ ↓ Download ] │
//   ├──────────────────────────────────────────────────────────┤
//   │ ┌──────────────────────────────────────────────────────┐ │
//   │ │ Bharath Vending Corporation BVC   Payslip For Month  │ │
//   │ │ India                             July 2026          │ │
//   │ │                                                       │ │
//   │ │ EMPLOYEE SUMMARY        ┌───────────────────────┐   │ │
//   │ │ Name  : Monika          │ ₹20,000               │   │ │
//   │ │ ID    : 1234            │ Total Net Pay         │   │ │
//   │ │ ...                     │ Paid Days: 24 · LOP: 1│   │ │
//   │ │                         └───────────────────────┘   │ │
//   │ │                                                       │ │
//   │ │  EARNINGS      AMOUNT    │ DEDUCTIONS     AMOUNT    │ │
//   │ │  Basic       ₹20,000.00  │ Income Tax     ₹0.00     │ │
//   │ │  HRA         ₹0.00       │ Provident Fund ₹0.00     │ │
//   │ │  Gross Earn  ₹20,000.00  │ Total Deductions ₹0.00   │ │
//   │ │                                                       │ │
//   │ │  TOTAL NET PAYABLE                       ₹20,000.00  │ │
//   │ │  Amount In Words: Indian Rupee Twenty Thousand Only  │ │
//   │ └──────────────────────────────────────────────────────┘ │
//   └──────────────────────────────────────────────────────────┘
// =====================================================================

import { useEffect, useState } from "react";

import API from "../services/api";
import styles from "./PayslipPreview.module.css";


// Backend base for opening the PDF in a new tab
const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8001";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{children}</svg>
);

const I = {
  back: icon(<><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></>),
  download: icon(<><path d="M12 3v13" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></>),
  close: icon(<path d="M18 6L6 18M6 6l12 12" />, 18),
};


// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "₹0.00";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}


// ==================================================================
// Component
// ==================================================================

export default function PayslipPreview({ slipId, onClose, onDownload }) {

  const [data, setData] = useState(null);
  const [loading, setLoad] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- Fetch full detail ----
  useEffect(() => {
    if (!slipId) return;
    let cancelled = false;
    setLoad(true);
    setError("");

    API.get(`/my-payslips/${slipId}`)
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.detail || "Could not load payslip.");
      })
      .finally(() => { if (!cancelled) setLoad(false); });

    return () => { cancelled = true; };
  }, [slipId]);


  // ---- Lock body scroll while preview is open ----
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);


  // ---- ESC to close ----
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  // ---- Download the PDF ----
  const handleDownload = async () => {
    if (!data) return;
    if (onDownload) {
      // Parent supplied a custom handler (probably reuses its
      // busy-map). Delegate; it'll open the same slip.
      onDownload({
        ID: data.ID,
        PAYSLIP_NUMBER: data.PAYSLIP_NUMBER,
      });
      return;
    }
    // Inline fallback — fetches the PDF blob and forces a save.
    setBusy(true);
    try {
      const res = await API.get(`/my-payslips/${data.ID}/pdf`, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Payslip-${data.PAYSLIP_NUMBER || data.ID}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(e?.response?.data?.detail || "Download failed");
    } finally {
      setBusy(false);
    }
  };


  // ==================================================================
  // Render
  // ==================================================================
  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={styles.container}
        onClick={(e) => e.stopPropagation()}
      >

        {/* ------------ Header ------------ */}
        <header className={styles.header}>
          <div className={styles.headerTitle}>Payslip Preview</div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={onClose}
            >
              {I.back}
              <span>Go Back</span>
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handleDownload}
              disabled={busy || !data}
            >
              {I.download}
              <span>{busy ? "Downloading…" : "Download"}</span>
            </button>
            {/* Small close X for accessibility on mobile */}
            <button
              type="button"
              className={styles.btnClose}
              onClick={onClose}
              aria-label="Close"
            >
              {I.close}
            </button>
          </div>
        </header>


        {/* ------------ Loading / error ------------ */}
        {loading && (
          <div className={styles.stateWrap}>
            <div className={styles.spinner} />
            <div className={styles.stateText}>Loading payslip…</div>
          </div>
        )}

        {!loading && error && (
          <div className={styles.stateWrap}>
            <div className={styles.errorBox}>{error}</div>
          </div>
        )}


        {/* ------------ Payslip document ------------ */}
        {!loading && !error && data && (
          <div className={styles.docFrame}>
            <div className={styles.doc}>

              {/* -- Company header row -- */}
              <div className={styles.docHead}>
                <div className={styles.docCompany}>
                  <div className={styles.companyName}>{data.COMPANY?.NAME}</div>
                  <div className={styles.companyLoc}>{data.COMPANY?.LOCATION}</div>
                </div>
                <div className={styles.docPeriod}>
                  <div className={styles.periodLabel}>Payslip For the Month</div>
                  <div className={styles.periodValue}>{data.PAY_PERIOD_LABEL}</div>
                </div>
              </div>

              {/* -- Summary row: employee | net pay card -- */}
              <div className={styles.summaryRow}>
                <div className={styles.empBox}>
                  <div className={styles.empHead}>Employee Summary</div>
                  <SumRow label="Employee Name" value={data.EMPLOYEE?.NAME || "—"} />
                  <SumRow label="Employee ID" value={data.EMPLOYEE?.CODE || "—"} />
                  {data.EMPLOYEE?.DESIGNATION && (
                    <SumRow label="Designation" value={data.EMPLOYEE.DESIGNATION} />
                  )}
                  {data.EMPLOYEE?.DEPARTMENT && (
                    <SumRow label="Department" value={data.EMPLOYEE.DEPARTMENT} />
                  )}
                  <SumRow label="Pay Period" value={data.PAY_PERIOD_LABEL} />
                  <SumRow label="Pay Date" value={data.PAY_DATE} />
                </div>

                <div className={styles.netBox}>
                  <div className={styles.netValue}>{inr(data.NET_PAY)}</div>
                  <div className={styles.netLabel}>Total Net Pay</div>

                  <div className={styles.netDivider} />

                  <div className={styles.netMeta}>
                    <SumRow
                      label="Paid Days"
                      value={String(Math.round(Number(data.DAYS?.PAID || 0) * 10) / 10)}
                      compact
                    />
                    <SumRow
                      label="LOP Days"
                      value={String(Math.round(Number(data.DAYS?.LOP || 0) * 10) / 10)}
                      compact
                    />
                  </div>
                </div>
              </div>

              {/* -- Earnings + Deductions two-column table -- */}
              <div className={styles.tableFrame}>
                <div className={styles.tableCol}>
                  <div className={styles.tableHead}>
                    <span>Earnings</span>
                    <span>Amount</span>
                  </div>
                  {data.EARNINGS?.map((row, i) => (
                    <div key={i} className={styles.tableRow}>
                      <span>{row.label}</span>
                      <span className={styles.amt}>{inr(row.amount)}</span>
                    </div>
                  ))}
                  <div className={`${styles.tableRow} ${styles.tableTotal}`}>
                    <span>Gross Earnings</span>
                    <span className={styles.amt}>{inr(data.GROSS_PAY)}</span>
                  </div>
                </div>

                <div className={styles.tableCol}>
                  <div className={styles.tableHead}>
                    <span>Deductions</span>
                    <span>Amount</span>
                  </div>
                  {data.DEDUCTIONS?.map((row, i) => (
                    <div key={i} className={styles.tableRow}>
                      <span>{row.label}</span>
                      <span className={styles.amt}>{inr(row.amount)}</span>
                    </div>
                  ))}
                  <div className={`${styles.tableRow} ${styles.tableTotal}`}>
                    <span>Total Deductions</span>
                    <span className={styles.amt}>{inr(data.TOTAL_DEDUCTIONS)}</span>
                  </div>
                </div>
              </div>

              {/* -- Net Payable bar -- */}
              <div className={styles.netBar}>
                <div className={styles.netBarLeft}>
                  <div className={styles.netBarLabel}>Total Net Payable</div>
                  <div className={styles.netBarHint}>Gross Earnings − Total Deductions</div>
                </div>
                <div className={styles.netBarValue}>{inr(data.NET_PAY)}</div>
              </div>

              {/* -- Amount in words -- */}
              <div className={styles.words}>
                <span className={styles.wordsLabel}>Amount In Words:</span>
                <span className={styles.wordsValue}>{data.NET_PAY_IN_WORDS}</span>
              </div>

              {/* -- Payslip number footer -- */}
              <div className={styles.footer}>
                Payslip #{data.PAYSLIP_NUMBER || data.ID}
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}


// ------------------------------------------------------------------
// Helper: labelled row inside the summary + net-pay boxes.
// ------------------------------------------------------------------
function SumRow({ label, value, compact = false }) {
  return (
    <div className={compact ? styles.sumRowCompact : styles.sumRow}>
      <span className={styles.sumLabel}>{label}</span>
      <span className={styles.sumColon}>:</span>
      <span className={styles.sumValue}>{value}</span>
    </div>
  );
}
