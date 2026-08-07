// =====================================================================
// MyPayslipsPanel — Employee Self-Service → Payslips (redesigned)
//
// Card-based layout matching the rest of the redesigned ESS pages
// (attendance, leave, permission, tasks, home). Same principles:
//   • Cream page bg, elevated white cards
//   • Restrained accent palette (BVC red for net pay + primary
//     actions, green for take-home, red for deductions, slate for
//     everything else)
//   • Native form controls, generous whitespace, Inter typography
//
// Sections top → bottom:
//   1. Hero — welcome band with a big "latest net pay" number
//   2. Stat strip — 3 tiles: total slips · latest · YTD
//   3. Year filter — chip switcher
//   4. Payslip cards — one card per slip, with View / Download /
//      Print actions. Each card shows month header, payslip #, big
//      net-pay number, and a compact Gross / Deductions / Days row.
//
// Backend endpoints (unchanged):
//   GET /my-payslips?employee_id=…            — list
//   GET /my-payslips/summary?employee_id=…    — summary tile data
//   GET /my-payslips/{id}/pdf                 — PDF (View / Download)
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";

import API from "../services/api";
import PayslipPreview from "./PayslipPreview";
import styles from "./MyPayslipsPanel.module.css";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  wallet:   icon(<>
    <path d="M20 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z" />
    <path d="M2 10h20" />
    <circle cx="16" cy="15" r="1.5" fill="currentColor" />
  </>),
  slips:    icon(<>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8M8 17h5" />
  </>),
  calendar: icon(<><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></>),
  rupee:    icon(<>
    <path d="M6 4h12" />
    <path d="M6 8h12" />
    <path d="M6 13h4a4 4 0 0 0 0-8H6" />
    <path d="M6 13l8 8" />
  </>),
  view:     icon(<><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></>, 15),
  download: icon(<><path d="M12 3v13" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></>, 15),
  print:    icon(<><rect x="6" y="14" width="12" height="8" rx="1" /><path d="M6 14V4h9l3 3v7" /><path d="M6 14H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1" /><path d="M18 14h2a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1" /></>, 15),
  empty:    icon(<>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </>, 32),
};


// ------------------------------------------------------------------
// Formatters
// ------------------------------------------------------------------

function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Terse rupee, no paise, for summary tiles ("₹3,994")
function inrShort(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
}


// Backend URL for opening PDFs in a new tab
const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8001";


// Status → chip class (matches the rest of the redesigned pages)
const STATUS_META = {
  DRAFT:     { label: "Draft",     cls: "chip_warn"    },
  FINALIZED: { label: "Finalized", cls: "chip_info"    },
  PAID:      { label: "Paid",      cls: "chip_success" },
};


// ==================================================================
// Component
// ==================================================================

export default function MyPayslipsPanel({ employeeId }) {

  const [rows, setRows]       = useState([]);
  const [summary, setSummary] = useState(null);
  const [statutory, setStatutory] = useState(null);  // CTC + YTD PF/ESI/Tax/Bonus
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  // monthKey format: "YYYY-MM" (e.g. "2026-06"); "" means show every payslip.
  const [monthKey, setMonthKey] = useState("");
  const [monthOpen, setMonthOpen] = useState(false);
  const monthRef = useRef(null);
  const [busyId, setBusyId]   = useState(null);
  const [previewId, setPreviewId] = useState(null);  // slip currently being previewed

  // ---- Load ----
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const [list, sum, stat] = await Promise.all([
          API.get(`/my-payslips?employee_id=${encodeURIComponent(employeeId)}`),
          API.get(`/my-payslips/summary?employee_id=${encodeURIComponent(employeeId)}`),
          // Statutory summary — soft-fail so an older backend still
          // renders the rest of the page.
          API.get(`/my-payslips/statutory-summary?employee_id=${encodeURIComponent(employeeId)}`)
             .catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        setRows(list.data || []);
        setSummary(sum.data || null);
        setStatutory(stat.data || null);
      } catch (e) {
        if (cancelled) return;
        setError(e?.response?.data?.detail || "Failed to load payslips.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [employeeId]);

  // Close the custom month dropdown when the user clicks anywhere
  // outside it. Attached only while the dropdown is open so we don't
  // leak listeners.
  useEffect(() => {
    if (!monthOpen) return undefined;
    const onDocClick = (e) => {
      if (monthRef.current && !monthRef.current.contains(e.target)) {
        setMonthOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [monthOpen]);


  // ---- Filter / derived ----

  // Dropdown lists every month up to today (no future months —
  // 'Sep 2026' is not selectable in Aug 2026 because no payslip could
  // exist for it yet). For the current calendar year we emit months
  // Jan..currentMonth; every earlier year that has at least one
  // payslip gets all 12 months. Newest first.
  //
  // Each option also carries `hasData` — true when a payslip exists
  // for that year+month. The dropdown appends a subtle ✓ so employees
  // can spot months with actual data.
  const monthOptions = useMemo(() => {
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;

    const dataKeys = new Set(
      rows.map((r) => {
        const y = Number(r.YEAR);
        const m = Number(r.MONTH);
        return y && m ? `${y}-${String(m).padStart(2, "0")}` : "";
      }).filter(Boolean)
    );

    const years = new Set(rows.map((r) => Number(r.YEAR)).filter(Boolean));
    years.add(nowYear);
    const sortedYears = Array.from(years).sort((a, b) => b - a);

    const opts = [];
    for (const y of sortedYears) {
      const startMonth = y === nowYear ? nowMonth : 12;
      for (let m = startMonth; m >= 1; m -= 1) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        opts.push({
          key,
          year: y,
          month: m,
          label: `${monthNames[m - 1]} ${y}`,
          hasData: dataKeys.has(key),
        });
      }
    }
    return opts;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!monthKey) return rows;
    const [y, m] = monthKey.split("-");
    return rows.filter(
      (r) => String(r.YEAR) === y && String(r.MONTH).padStart(2, "0") === m
    );
  }, [rows, monthKey]);


  // ---- Actions ----
  const pdfUrl = (slipId) => `${BACKEND_URL}/my-payslips/${slipId}/pdf`;

  // "View" opens the HTML preview modal (Zoho-style letterhead
  // layout). Raw-PDF fallback is still available via the Print
  // button which uses window.open on the /pdf endpoint.
  const onView = (slipId) => setPreviewId(slipId);

  const onDownload = async (slip) => {
    setBusyId(slip.ID);
    try {
      const res = await API.get(`/my-payslips/${slip.ID}/pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `Payslip-${slip.PAYSLIP_NUMBER}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(e?.response?.data?.detail || "Download failed");
    } finally {
      setBusyId(null);
    }
  };

  const onPrint = (slipId) => {
    // Let the browser's built-in PDF viewer own the print action —
    // window.print() on a cross-tab PDF is unreliable.
    window.open(pdfUrl(slipId), "_blank");
  };


  // ==================================================================
  // Render
  // ==================================================================
  return (
    <div className={styles.wrap}>

      {/* ---------- 1. HERO ---------- */}
      <section className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.heroEyebrow}>Employee Self-Service</div>
          <h1 className={styles.heroTitle}>My Salary</h1>
          <p className={styles.heroSub}>
            Monthly payslip, CTC breakdown, statutory deductions and
            bonus history — all in one place. Every payslip PDF is
            letterhead-quality and downloadable.
          </p>
        </div>

        {(statutory || summary) && (
          <div className={styles.heroRight}>
            <div className={styles.heroBigLabel}>
              {statutory?.ctc_annual ? `CTC ${statutory.year || ""}` : "Latest net pay"}
            </div>
            <div className={styles.heroBigValue}>
              {inrShort(statutory?.ctc_annual || summary?.last_net || 0)}
            </div>
            <div className={styles.heroBigSub}>
              {statutory?.ctc_annual
                ? `annual · monthly gross ${inrShort(statutory.monthly_gross)}`
                : (summary?.last_label || "—")}
            </div>
          </div>
        )}
      </section>


      {/* ---------- 2. STAT STRIP ---------- */}
      {(summary || statutory) && (
        <section className={styles.statRow}>
          <StatTile
            iconTone="green"
            icon={I.wallet}
            label="Latest net pay"
            value={inrShort(summary?.last_net || 0)}
            sub={summary?.last_label || "—"}
          />
          <StatTile
            iconTone="blue"
            icon={I.rupee}
            label="PF (YTD)"
            value={inrShort(statutory?.pf_ytd || 0)}
            sub="employee provident fund"
          />
          <StatTile
            iconTone="red"
            icon={I.rupee}
            label="ESI + Tax (YTD)"
            value={inrShort(
              (statutory?.esi_ytd || 0) + (statutory?.tax_ytd || 0)
            )}
            sub="statutory deductions"
          />
          <StatTile
            iconTone="green"
            icon={I.wallet}
            label="Bonus (YTD)"
            value={inrShort(
              (statutory?.bonus_ytd || 0) + (statutory?.incentive_ytd || 0)
            )}
            sub="task + star + annual"
          />
        </section>
      )}


      {/* ---------- 3. MONTH FILTER ---------- */}
      {monthOptions.length > 0 && (
        <section className={styles.filterRow}>
          <span className={styles.filterLabel}>Filter</span>
          <div className={styles.filterChips}>
            <div className={styles.monthPicker} ref={monthRef}>
              <button
                type="button"
                className={styles.monthTrigger}
                onClick={() => setMonthOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={monthOpen}
              >
                <span>
                  {monthKey
                    ? monthOptions.find((o) => o.key === monthKey)?.label || "All months"
                    : "All months"}
                </span>
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ transform: monthOpen ? "rotate(180deg)" : undefined }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {monthOpen && (
                <ul className={styles.monthMenu} role="listbox">
                  <li
                    role="option"
                    aria-selected={monthKey === ""}
                    className={
                      `${styles.monthItem}${monthKey === "" ? " " + styles.monthItem_active : ""}`
                    }
                    onClick={() => { setMonthKey(""); setMonthOpen(false); }}
                  >
                    All months
                  </li>
                  {monthOptions.map((opt) => (
                    <li
                      key={opt.key}
                      role="option"
                      aria-selected={monthKey === opt.key}
                      className={
                        `${styles.monthItem}`
                        + (monthKey === opt.key ? " " + styles.monthItem_active : "")
                        + (opt.hasData ? " " + styles.monthItem_hasData : "")
                      }
                      onClick={() => { setMonthKey(opt.key); setMonthOpen(false); }}
                    >
                      <span>{opt.label}</span>
                      {opt.hasData && (
                        <span className={styles.monthDot} aria-hidden="true" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <span className={styles.filterCount}>
            {filtered.length} of {rows.length}
          </span>
        </section>
      )}


      {/* ---------- 4. LIST ---------- */}
      {loading && (
        <div className={styles.loading}>Loading your payslips…</div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>{I.empty}</span>
          <div>
            <div className={styles.emptyTitle}>
              {monthKey
                ? `No payslip for ${monthOptions.find((o) => o.key === monthKey)?.label || "this month"}`
                : "No payslips yet"}
            </div>
            <div className={styles.emptyBody}>
              {monthKey
                ? "HR hasn't cut a payslip for you in this month. Months with a payslip show a red dot in the dropdown."
                : "New payslips appear here as soon as HR generates them for you."}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className={styles.slipList}>
          {filtered.map((r) => (
            <PayslipCard
              key={r.ID}
              slip={r}
              busy={busyId === r.ID}
              onView={onView}
              onDownload={onDownload}
              onPrint={onPrint}
            />
          ))}
        </ul>
      )}

      {/* -------- Zoho-style HTML preview modal -------- */}
      {previewId != null && (
        <PayslipPreview
          slipId={previewId}
          onClose={() => setPreviewId(null)}
          onDownload={(slip) => onDownload(slip)}
        />
      )}

    </div>
  );
}


// ==================================================================
// Sub-components
// ==================================================================

function StatTile({ icon, label, value, sub, iconTone = "red" }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statHead}>
        <span className={`${styles.statIcon} ${styles[`tint_${iconTone}`]}`}>
          {icon}
        </span>
        <span className={styles.statLabel}>{label}</span>
      </div>
      <div className={styles.statValue}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}


function PayslipCard({ slip, busy, onView, onDownload, onPrint }) {

  const status = (slip.RUN_STATUS || "").toUpperCase();
  const meta   = STATUS_META[status] || { label: status || "—", cls: "chip_muted" };

  const daysNote = (() => {
    const parts = [];
    if (slip.ABSENT_DAYS > 0) parts.push(`${slip.ABSENT_DAYS} absent`);
    if (slip.DAYS_LATE  > 0) parts.push(`${slip.DAYS_LATE} late`);
    return parts.join(" · ");
  })();

  // Deductions breakdown — shown as a small hint under the total so the
  // employee sees WHY the number is what it is, not just "-₹17,505".
  const deductionsBreakdown = (() => {
    const parts = [];
    if (slip.ABSENCE_DEDUCTION > 0)   parts.push(`Absence ${inr(slip.ABSENCE_DEDUCTION)}`);
    if (slip.PF_EMPLOYEE > 0)         parts.push(`PF ${inr(slip.PF_EMPLOYEE)}`);
    if (slip.ESI_EMPLOYEE > 0)        parts.push(`ESI ${inr(slip.ESI_EMPLOYEE)}`);
    if (slip.PT_EMPLOYEE > 0)         parts.push(`PT ${inr(slip.PT_EMPLOYEE)}`);
    if (slip.PERMISSION_DEDUCTION > 0) parts.push(`Perm ${inr(slip.PERMISSION_DEDUCTION)}`);
    if (slip.LATE_PENALTY > 0)        parts.push(`Late ${inr(slip.LATE_PENALTY)}`);
    return parts.join(" · ");
  })();

  return (
    <li className={styles.slip}>

      {/* LEFT — month + payslip number */}
      <div className={styles.slipHead}>
        <div className={styles.slipMonth}>
          {slip.MONTH_NAME || "—"}
          <span className={styles.slipYear}>{slip.YEAR}</span>
        </div>
        <div className={styles.slipNumber}>{slip.PAYSLIP_NUMBER || "—"}</div>
      </div>

      {/* MIDDLE — big net pay + gross/deductions rows */}
      <div className={styles.slipBody}>
        <div className={styles.slipNetBlock}>
          <div className={styles.slipNetLabel}>Net pay</div>
          <div className={styles.slipNetValue}>{inr(slip.NET_PAY)}</div>
        </div>

        <div className={styles.slipStats}>
          <div className={styles.slipStat}>
            <span className={styles.slipStatLabel}>Gross</span>
            <span className={styles.slipStatValue}>{inr(slip.GROSS_PAY)}</span>
          </div>
          <div className={styles.slipStat}>
            <span className={styles.slipStatLabel}>Deductions</span>
            <span className={`${styles.slipStatValue} ${styles.deduction}`}>
              −{inr(slip.TOTAL_DEDUCTIONS)}
            </span>
            {deductionsBreakdown && (
              <span className={styles.slipStatHint}>{deductionsBreakdown}</span>
            )}
          </div>
          <div className={styles.slipStat}>
            <span className={styles.slipStatLabel}>Attendance</span>
            <span className={styles.slipStatValue}>
              {slip.DAYS_PRESENT ?? 0}
              <small>/{slip.WORKING_DAYS ?? 0} days</small>
            </span>
            {daysNote && <span className={styles.slipStatHint}>{daysNote}</span>}
          </div>
        </div>
      </div>

      {/* RIGHT — status + actions */}
      <div className={styles.slipRight}>
        <span className={`${styles.chip} ${styles[meta.cls]}`}>{meta.label}</span>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionGhost}
            onClick={() => onView(slip.ID)}
            title="Open PDF in a new tab"
          >
            {I.view}
            <span>View</span>
          </button>
          <button
            type="button"
            className={styles.actionPrimary}
            onClick={() => onDownload(slip)}
            disabled={busy}
            title="Download PDF"
          >
            {I.download}
            <span>{busy ? "…" : "Download"}</span>
          </button>
          <button
            type="button"
            className={styles.actionGhost}
            onClick={() => onPrint(slip.ID)}
            title="Open PDF and print"
          >
            {I.print}
            <span>Print</span>
          </button>
        </div>
      </div>
    </li>
  );
}
