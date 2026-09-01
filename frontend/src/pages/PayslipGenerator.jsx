// =====================================================================
// PayslipGenerator — Admin-side Zoho-style payslip form.
//
// Layout closely mirrors https://www.zoho.com/in/payroll/free-payslip-generator/
//   1. Company header  (logo + BVC name + address on left, month/year on right)
//   2. Employee Pay Summary  (Name, ID, Pay Period, Paid Days, LOP Days, Pay Date)
//   3. Income Details  (two-column earnings / deductions grid with subtotals)
//   4. Total Net Payable  (Gross - Deductions) + Amount in Words
//   5. Actions           (Generate / Update  +  Reset)
//
// Behaviour:
//   - Employee salary auto-fills from Employee.SALARY if a slip
//     doesn't already exist for that (employee, year, month) pair.
//   - If a slip DOES exist for that pair, its exact values load
//     into every field so HR can edit and re-save (upsert).
//   - Employee-side portal is READ-ONLY — this is the only screen
//     that can create or edit a slip.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import API from "../services/api";
import PayslipPreview from "../components/PayslipPreview";
import styles from "./PayslipGenerator.module.css";


const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8000";


const MONTHS = [
  { n: 1, label: "January" }, { n: 2, label: "February" },
  { n: 3, label: "March" }, { n: 4, label: "April" },
  { n: 5, label: "May" }, { n: 6, label: "June" },
  { n: 7, label: "July" }, { n: 8, label: "August" },
  { n: 9, label: "September" }, { n: 10, label: "October" },
  { n: 11, label: "November" }, { n: 12, label: "December" },
];


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
  send: icon(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>),
  reset: icon(<><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /></>),
  view: icon(<><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></>),
  download: icon(<><path d="M12 3v13" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></>),
  check: icon(<>
    <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
    <path d="M22 4 12 14.01l-3-3" />
  </>, 22),
};


// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function inr(n) {
  const v = Number(n || 0);
  return "₹" + v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Rupees to words (Indian numbering) — same shape as backend's
// amount_in_words but implemented client-side for the live preview
// under the Net Payable strip.
function rupeesToWords(num) {
  const n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return "Indian Rupee Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const chunk = (x) => {
    if (x === 0) return "";
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
    return ones[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + chunk(x % 100) : "");
  };
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thou = Math.floor((n % 100000) / 1000);
  const hund = n % 1000;
  const parts = [];
  if (crore) parts.push(chunk(crore) + " Crore");
  if (lakh) parts.push(chunk(lakh) + " Lakh");
  if (thou) parts.push(chunk(thou) + " Thousand");
  if (hund) parts.push(chunk(hund));
  return "Indian Rupee " + parts.join(" ") + " Only";
}

// Working-days-in-month helper — BVC is a 6-day work week (Mon–Sat),
// so working days = calendar days − Sundays. Returns 26 for months
// with 4 Sundays, 27 for months with 5. Doesn't account for public
// holidays; HR can still override the auto value.
function workingDaysInMonth(year, month) {
  const total = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let d = 1; d <= total; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) sundays++;
  }
  return total - sundays;
}

// Zero-valued starting state for a fresh (no existing slip) form.
// Deliberately does NOT pre-fill from Employee.SALARY — HR types every
// earnings + deductions cell so switching employees never carries
// stale values across. Only Absence Deduction is auto-computed later
// from the Absent-Days input.
const BLANK_EARNINGS = {
  BASIC: 0, HRA: 0, DA: 0,
  CONVEYANCE: 0, MEDICAL_ALLOWANCE: 0,
  SPECIAL_ALLOWANCE: 0, OTHER_ALLOWANCES: 0,
  BONUS: 0, INCENTIVES: 0, TASK_BONUS: 0, OT_PAY: 0,
};
const BLANK_DEDUCTIONS = {
  PF_EMPLOYEE: 0, ESI_EMPLOYEE: 0,
  PROFESSIONAL_TAX: 0, LATE_PENALTY: 0,
  ABSENCE_DEDUCTION: 0,
  OTHER_DEDUCTIONS: 0,
};
const BLANK_WORKING = {
  WORKING_DAYS: 26,   // overridden by workingDaysInMonth() when month/year is known
  DAYS_PRESENT: 0,
  DAYS_LATE: 0,
  PAID_LEAVE_DAYS: 0,
  UNPAID_LEAVE_DAYS: 0,
  ABSENT_DAYS: 0,
  OT_HOURS: 0,
};


// Ordered rows for the Income Details grid — labels + form keys.
// Simplified Income Details — matches the admin spec:
//   Left  (Earnings):  Basic Salary, Medical Allowance, Bonus, Incentive
//   Right (Deductions): PF, ESI, Late Penalty, Absent Deduction
// HRA / DA / Conveyance / Special / Other / Task Bonus / OT Pay /
// Professional Tax / Other Deductions still live in state (defaulting
// to 0) so the backend payload shape stays complete — they just aren't
// surfaced in the form.
const EARNING_ROWS = [
  { key: "BASIC", label: "Basic Salary" },
  { key: "MEDICAL_ALLOWANCE", label: "Medical Allowance" },
  { key: "BONUS", label: "Bonus" },
  { key: "INCENTIVES", label: "Incentive" },
];
const DEDUCTION_ROWS = [
  { key: "PF_EMPLOYEE", label: "PF" },
  { key: "ESI_EMPLOYEE", label: "ESI" },
  { key: "LATE_PENALTY", label: "Late Penalty" },
  // Auto-computed from unpaid absent days × (Basic Salary / Working
  // Days). HR can override the number by typing over it — the backend
  // then uses the entered value verbatim instead of the computed one.
  { key: "ABSENCE_DEDUCTION", label: "Absent Deduction" },
];


// ==================================================================
// Component
// ==================================================================
export default function PayslipGenerator() {

  const today = new Date();

  // Read pre-select query params: ?employee_id=X&year=Y&month=M.
  // These come from the Payroll page's "Generate Payslip" action or
  // the row-level "Edit payslip" so the admin lands on a form that's
  // already targeted at the intended employee + period.
  const [searchParams] = useSearchParams();
  const qEmpId = searchParams.get("employee_id") || "";
  const qYear = Number(searchParams.get("year")) || today.getFullYear();
  const qMonth = Number(searchParams.get("month")) || (today.getMonth() + 1);

  // ---- pickers ----
  const [employees, setEmployees] = useState([]);
  const [empId, setEmpId] = useState(qEmpId);
  const [year, setYear] = useState(qYear);
  const [month, setMonth] = useState(qMonth);

  // ---- company (BVC branding, read-only) ----
  const [company, setCompany] = useState(null);

  // ---- form state ----
  const [payDate, setPayDate] = useState(""); // yyyy-mm-dd
  const [working, setWorking] = useState({
    WORKING_DAYS: 26,
    DAYS_PRESENT: 26,
    DAYS_LATE: 0,
    PAID_LEAVE_DAYS: 0,
    UNPAID_LEAVE_DAYS: 0,
    ABSENT_DAYS: 0,
    OT_HOURS: 0,
  });
  const [earnings, setEarnings] = useState({
    BASIC: 0, HRA: 0, DA: 0,
    CONVEYANCE: 0, MEDICAL_ALLOWANCE: 0,
    SPECIAL_ALLOWANCE: 0, OTHER_ALLOWANCES: 0,
    BONUS: 0, INCENTIVES: 0, TASK_BONUS: 0, OT_PAY: 0,
  });
  const [deductions, setDeductions] = useState({
    PF_EMPLOYEE: 0, ESI_EMPLOYEE: 0,
    PROFESSIONAL_TAX: 0, LATE_PENALTY: 0,
    ABSENCE_DEDUCTION: 0,
    OTHER_DEDUCTIONS: 0,
  });
  // Auto-manages Absence Deduction from Absent Days × per-day rate.
  // Suspended once HR types their own value into the Absence row so
  // manual overrides don't get clobbered on the next Absent-Days edit.
  const [absenceDedManualOverride, setAbsenceDedManualOverride] = useState(false);
  // Same override pattern for Working Days (auto-set from calendar
  // when month/year change) and Casual Leave (first day of absence
  // is auto-assigned as a CL).
  const [workingDaysManualOverride, setWorkingDaysManualOverride] = useState(false);
  const [clManualOverride, setClManualOverride] = useState(false);

  // ---- flow state ----
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isEdit, setIsEdit] = useState(false); // true when a slip already exists → button says "Update"
  const [existingSlipId, setExistingSlipId] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  // Submit-to-Payroll-Records workflow. `submittedAt` is the ISO
  // timestamp from the backend; null while the slip is still a draft.
  // A saved-but-not-submitted slip does NOT appear in Payroll Records
  // until the admin clicks the Submit button that shows next to
  // Update Payslip.
  const [submittedAt, setSubmittedAt] = useState(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitDone, setSubmitDone] = useState(false); // green pill flash after success

  // ---- logo upload ----
  // The visible logo tile is a <label> that wraps a hidden <input type="file">
  // — clicking the label opens the file picker natively. The ref is only
  // used to clear the input value after upload so re-selecting the same
  // file re-fires onChange.
  const logoInputRef = useRef(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErr, setLogoErr] = useState("");

  const onLogoFileChosen = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side sanity checks before the trip to the server so the
    // user gets an immediate, specific error instead of a generic 400.
    // Keep in sync with backend `_ALLOWED_LOGO_EXTS`.
    const allowedExts = [
      ".png",
      ".jpg", ".jpeg", ".jfif", ".jpe", // JPEG variants
      ".webp",
      ".svg",
      ".gif",
    ];
    const nameLower = (file.name || "").toLowerCase();
    const okExt = allowedExts.some((x) => nameLower.endsWith(x));
    if (!okExt) {
      setLogoErr(
        `Unsupported file type. Allowed: ${allowedExts.join(", ")}. ` +
        `You picked "${file.name}".`
      );
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }
    // Backend has no size cap but a 5MB soft ceiling avoids obvious mistakes.
    if (file.size > 5 * 1024 * 1024) {
      setLogoErr(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Keep under 5 MB.`);
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }

    setLogoBusy(true);
    setLogoErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      // NOTE: do NOT set Content-Type manually — axios needs to add
      // the multipart boundary itself; setting it here breaks parsing
      // on the server side (server sees no boundary and returns 400).
      const res = await API.post("/settings/company/upload-logo", fd);
      // Backend returns the fresh CompanyMaster row — swap into state so
      // the logo appears immediately without a page reload.
      if (res.data?.company) {
        setCompany(res.data.company);
      } else if (res.data?.logo_url) {
        setCompany((c) => ({ ...(c || {}), LOGO_URL: res.data.logo_url }));
      }
    } catch (err) {
      // Surface the real server message instead of a generic string.
      let msg = "Logo upload failed.";
      const d = err?.response?.data;
      if (typeof d?.detail === "string") msg = d.detail;
      else if (Array.isArray(d?.detail)) msg = d.detail.map((x) => x?.msg || String(x)).join(" · ");
      else if (err?.response?.status) msg = `Logo upload failed (HTTP ${err.response.status}).`;
      else if (err?.message) msg = `Logo upload failed: ${err.message}`;
      setLogoErr(msg);
      // Also log so DevTools console has the full stack for deeper debugging.
      console.error("Logo upload error:", err);
    } finally {
      setLogoBusy(false);
      // Reset the input so choosing the same file again re-triggers onChange.
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  // ---- initial loads ----
  useEffect(() => {
    API.get("/employees?status=ACTIVE")
      .then((r) => setEmployees(r.data || []))
      .catch(() => setEmployees([]));
    API.get("/settings/company")
      .then((r) => setCompany(r.data || null))
      .catch(() => setCompany(null));
  }, []);

  const selected = useMemo(
    () => employees.find((e) => e.ID === empId) || null,
    [employees, empId]
  );

  // Whenever (employee, year, month) changes, look for an existing slip.
  // If found → overlay its stored values on top of the blank state.
  // Otherwise the state stays blank so nothing carries over between
  // employees.
  useEffect(() => {
    if (!selected) return;

    // -- Step 1: SYNCHRONOUS RESET --
    // Wipe every earnings / deductions / attendance cell to zero
    // BEFORE the API request. Without this, the previous employee's
    // values stay visible for however long the fetch takes, which is
    // exactly the "wrong values leaking between employees" bug.
    //
    // Basic Salary is seeded from Employee.SALARY as a fallback; the
    // async structure fetch below will overwrite it (plus HRA/DA/PF
    // etc.) if a full salary_structure row exists for this employee.
    setEarnings({
      ...BLANK_EARNINGS,
      BASIC: Number(selected.SALARY || 0),
    });
    setDeductions({ ...BLANK_DEDUCTIONS });
    setWorking({
      ...BLANK_WORKING,
      WORKING_DAYS: workingDaysInMonth(year, month),
    });
    setAbsenceDedManualOverride(false);
    setWorkingDaysManualOverride(false);
    setClManualOverride(false);
    setIsEdit(false);
    setExistingSlipId(null);
    setSubmittedAt(null);
    setSubmitDone(false);
    setPayDate("");
    setError("");
    setResult(null);

    // -- Step 2a: ASYNC OVERLAY — salary structure (Basic/HRA/DA/PF/ESI)
    // Fired in parallel with the slip-by-period lookup. Only applies
    // when no existing slip is found; a saved slip takes precedence
    // and is loaded verbatim below.
    let structureLoaded = false;
    API.get(`/payroll/salary-structures/${encodeURIComponent(empId)}`)
      .then((r) => {
        const s = r?.data;
        if (!s) return;
        structureLoaded = true;
        // Only overlay if the slip-by-period hasn't already loaded
        // real values (isEdit stays false until that response lands).
        setEarnings((prev) => ({
          ...prev,
          BASIC:             Number(s.BASIC ?? prev.BASIC ?? 0),
          HRA:               Number(s.HRA ?? 0),
          DA:                Number(s.DA ?? 0),
          CONVEYANCE:        Number(s.CONVEYANCE_ALLOWANCE ?? 0),
          MEDICAL_ALLOWANCE: Number(s.MEDICAL_ALLOWANCE ?? 0),
          SPECIAL_ALLOWANCE: Number(s.SPECIAL_ALLOWANCE ?? 0),
          OTHER_ALLOWANCES:  Number(s.OTHER_ALLOWANCES ?? 0),
        }));
        setDeductions((prev) => ({
          ...prev,
          PF_EMPLOYEE:      Number(s.PF_EMPLOYEE ?? 0),
          ESI_EMPLOYEE:     Number(s.ESI_EMPLOYEE ?? 0),
          PROFESSIONAL_TAX: Number(s.PROFESSIONAL_TAX ?? 0),
        }));
      })
      .catch(() => { /* no structure — Employee.SALARY fallback stands */ });

    // -- Step 2c: ASYNC OVERLAY — attendance-derived numbers.
    // Pulls the actual biometric numbers (present / late / absent / OT
    // hours, plus the calc-derived late penalty + absence deduction)
    // for this employee × month and fills the attendance section so
    // HR doesn't type them by hand. Skipped when a saved slip loads
    // (edit mode) — those saved values stay authoritative.
    API.get(
      `/iclock/import-summary?year=${year}&month=${month}` +
      `&employee_ids=${encodeURIComponent(empId)}`
    )
      .then((r) => {
        const rows = r?.data?.employees || [];
        const me = rows.find((x) => x.employee_id === empId);
        if (!me) return;
        setWorking((prev) => ({
          ...prev,
          WORKING_DAYS:      Number(me.working_days ?? prev.WORKING_DAYS ?? 0),
          DAYS_PRESENT:      Number(me.present_days ?? 0),
          DAYS_LATE:         Number(me.late_arrivals ?? 0),
          PAID_LEAVE_DAYS:   Number(me.cl_used ?? 0),
          UNPAID_LEAVE_DAYS: Number(me.lop_days ?? 0),
          ABSENT_DAYS:       Number(me.absent_days ?? 0),
          OT_HOURS:          Number(me.net_ot_hours ?? 0),
        }));
        setEarnings((prev) => ({
          ...prev,
          OT_PAY: Number(me.ot_pay ?? 0),
        }));
        setDeductions((prev) => ({
          ...prev,
          LATE_PENALTY:      Number(me.late_penalty ?? 0),
          ABSENCE_DEDUCTION: Number(me.absent_deduction_only ?? 0),
        }));
        // These are now sourced from the calc — lock them so the
        // auto-recompute effect below doesn't stomp on them.
        setAbsenceDedManualOverride(true);
        setClManualOverride(true);
      })
      .catch(() => { /* no calc data — HR fills these manually */ });

    // -- Step 2b: ASYNC OVERLAY (if a slip already exists) --
    let cancelled = false;

    API.get(`/payroll/slip-by-period?employee_id=${encodeURIComponent(empId)}&year=${year}&month=${month}`)
      .then((r) => {
        if (cancelled) return;
        const data = r.data || {};
        if (data.exists) {
          // Load existing slip verbatim → edit mode.
          setIsEdit(true);
          setExistingSlipId(data.slip_id);
          setWorking({
            WORKING_DAYS: data.WORKING_DAYS ?? 26,
            DAYS_PRESENT: data.DAYS_PRESENT ?? 0,
            DAYS_LATE: data.DAYS_LATE ?? 0,
            PAID_LEAVE_DAYS: data.PAID_LEAVE_DAYS ?? 0,
            UNPAID_LEAVE_DAYS: data.UNPAID_LEAVE_DAYS ?? 0,
            ABSENT_DAYS: data.ABSENT_DAYS ?? 0,
            OT_HOURS: data.OT_HOURS ?? 0,
          });
          setEarnings({
            BASIC: data.BASIC ?? 0,
            HRA: data.HRA ?? 0,
            DA: data.DA ?? 0,
            CONVEYANCE: data.CONVEYANCE ?? 0,
            MEDICAL_ALLOWANCE: data.MEDICAL_ALLOWANCE ?? 0,
            SPECIAL_ALLOWANCE: data.SPECIAL_ALLOWANCE ?? 0,
            OTHER_ALLOWANCES: data.OTHER_ALLOWANCES ?? 0,
            BONUS: data.BONUS ?? 0,
            INCENTIVES: data.INCENTIVES ?? 0,
            TASK_BONUS: data.TASK_BONUS ?? 0,
            OT_PAY: data.OT_PAY ?? 0,
          });
          setDeductions({
            PF_EMPLOYEE: data.PF_EMPLOYEE ?? 0,
            ESI_EMPLOYEE: data.ESI_EMPLOYEE ?? 0,
            PROFESSIONAL_TAX: data.PROFESSIONAL_TAX ?? 0,
            LATE_PENALTY: data.LATE_PENALTY ?? 0,
            ABSENCE_DEDUCTION: data.ABSENCE_DEDUCTION ?? 0,
            OTHER_DEDUCTIONS: data.OTHER_DEDUCTIONS ?? 0,
          });
          // Pay Date from the stored slip. Backend ships ISO
          // YYYY-MM-DD so the HTML5 <input type="date"> can consume
          // it directly without any parsing.
          if (data.PAY_DATE) setPayDate(data.PAY_DATE);
          // Publish state — hides the Submit button if the slip
          // was already pushed to Payroll Records earlier.
          setSubmittedAt(data.SUBMITTED_AT || null);
          // Load overrides selectively. A zero-value loaded field
          // usually means "old slip that pre-dates the auto-rule" —
          // we want the auto-effect to fire and fill it in. Non-zero
          // values that differ from what auto would produce are
          // treated as HR overrides and locked to preserve them.
          //
          // Working Days: lock only if the stored value differs from
          // the calendar-derived working days for this month/year.
          const autoWD = workingDaysInMonth(year, month);
          setWorkingDaysManualOverride(
            (data.WORKING_DAYS ?? autoWD) !== autoWD
          );

          // Casual Leave: auto is min(1, Absent). Lock only if HR
          // stored MORE CL than the auto rule provides (e.g. 2 CL
          // for a real 2-day sick leave). Loaded CL=0 with Absent>0
          // is the "old slip" case — leave unlocked so auto fires.
          const loadedAbsent = data.ABSENT_DAYS ?? 0;
          const loadedCL = data.PAID_LEAVE_DAYS ?? 0;
          const autoCL = loadedAbsent >= 1 ? 1 : 0;
          setClManualOverride(loadedCL > autoCL);

          // Absence Deduction: do NOT lock on load. Old slips saved
          // before this rule was in place have stale (or zero)
          // deduction values that don't reflect the current CL/Absent
          // split. Leaving the override off means the auto-recompute
          // effect fires immediately after load and produces the
          // correct value for the loaded earnings + attendance. HR
          // can still override any time by typing into the Absence
          // Deduction row — that flips the lock back on.
          setAbsenceDedManualOverride(false);
        }
        // No `else` branch — the synchronous reset at the top of the
        // effect already zeroed everything, so a "no existing slip"
        // response leaves the form blank. Same story for a network
        // error below.
      })
      .catch(() => { /* form stays in its just-reset blank state */ });

    return () => { cancelled = true; };
  }, [empId, year, month, selected]);

  // ---- live totals ----
  const gross = useMemo(
    () => Object.values(earnings).reduce((s, v) => s + Number(v || 0), 0),
    [earnings]
  );

  // Auto-set Working Days from the calendar when month/year change.
  // BVC 6-day week convention (calendar days − Sundays). HR can still
  // type a different number — that flips the override flag off any
  // further auto-sync until they clear it via Reset.
  useEffect(() => {
    if (workingDaysManualOverride) return;
    const wd = workingDaysInMonth(year, month);
    setWorking((w) => (w.WORKING_DAYS === wd ? w : { ...w, WORKING_DAYS: wd }));
  }, [year, month, workingDaysManualOverride]);

  // Auto-convert 1 absent day → Casual Leave. Fires only when HR
  // enters absent days AND hasn't typed a CL value themselves. The
  // first day of absence becomes a paid CL, the rest stay as
  // unpaid absent for the deduction calc.
  useEffect(() => {
    if (clManualOverride) return;
    const targetCL = Number(working.ABSENT_DAYS || 0) >= 1 ? 1 : 0;
    setWorking((w) => (
      Number(w.PAID_LEAVE_DAYS || 0) === targetCL
        ? w
        : { ...w, PAID_LEAVE_DAYS: targetCL }
    ));
  }, [working.ABSENT_DAYS, clManualOverride]);

  // Auto-compute Absent Deduction from UNPAID absent days × per-day
  // rate. Per-day is derived from Basic Salary (not full gross), per
  // the admin spec — the deduction should reduce salary based on the
  // employee's configured Basic. Because the first absent day is
  // auto-converted to a paid CL, only the remaining (Absent − CL) days
  // are unpaid. HR overrides via the deduction row still win.
  useEffect(() => {
    if (absenceDedManualOverride) return;
    const wd = Number(working.WORKING_DAYS || 0);
    const basic = Number(earnings.BASIC || 0);
    const unpaid = Math.max(
      0,
      Number(working.ABSENT_DAYS || 0) - Number(working.PAID_LEAVE_DAYS || 0)
    );
    const perDay = wd > 0 ? basic / wd : 0;
    const computed = Math.round(unpaid * perDay * 100) / 100;
    setDeductions((d) => (
      d.ABSENCE_DEDUCTION === computed
        ? d
        : { ...d, ABSENCE_DEDUCTION: computed }
    ));
  }, [earnings.BASIC, working.WORKING_DAYS, working.ABSENT_DAYS, working.PAID_LEAVE_DAYS, absenceDedManualOverride]);

  const totalDed = useMemo(
    () => Object.values(deductions).reduce((s, v) => s + Number(v || 0), 0),
    [deductions]
  );
  const net = Math.max(0, gross - totalDed);
  const netWords = rupeesToWords(net);

  const periodLabel = `${MONTHS.find((m) => m.n === month)?.label || ""} ${year}`;

  // The visible summary uses this simplified attendance model:
  //   Total Days   = Working Days − Absent Days
  //   Days Present = Total Days − Casual Leave
  //   LOP          is folded into Absent Days (single "unpaid" bucket)
  // These derived values get shipped to the backend so its calc engine
  // sees the same numbers HR would expect from the visible form.
  const totalDays = Math.max(0, Number(working.WORKING_DAYS || 0) - Number(working.ABSENT_DAYS || 0));
  const derivedPresent = Math.max(0, totalDays - Number(working.PAID_LEAVE_DAYS || 0));

  // ---- submit ----
  const onGenerate = async () => {
    if (!empId) { setError("Please pick an employee first."); return; }
    setBusy(true); setError(""); setResult(null);
    try {
      // Backend still expects the full attendance breakdown, but the
      // simplified visible form only surfaces Working / Absent / CL /
      // Late / OT. Because the first absent day is auto-converted to
      // a paid CL, the value shipped as ABSENT_DAYS is the *unpaid*
      // remainder (raw Absent − CL). That keeps the backend's own
      // absence-deduction calc consistent with what the form previews.
      const rawAbsent = Number(working.ABSENT_DAYS || 0);
      const rawCL = Number(working.PAID_LEAVE_DAYS || 0);
      const unpaidAbsent = Math.max(0, rawAbsent - rawCL);
      const attendancePayload = {
        WORKING_DAYS: Number(working.WORKING_DAYS || 0),
        DAYS_PRESENT: Math.max(0, Number(working.WORKING_DAYS || 0) - rawAbsent),
        DAYS_LATE: Number(working.DAYS_LATE || 0),
        PAID_LEAVE_DAYS: rawCL,
        UNPAID_LEAVE_DAYS: 0,
        ABSENT_DAYS: unpaidAbsent,
        OT_HOURS: Number(working.OT_HOURS || 0),
      };
      const payload = {
        EMPLOYEE_ID: empId,
        YEAR: Number(year),
        MONTH: Number(month),
        // Ship the admin-typed Pay Date as YYYY-MM-DD. Backend parses
        // and stores it on PayrollSlip.PAY_DATE so the preview shows
        // exactly what HR set, not the run's created_at.
        PAY_DATE: payDate || null,
        ...attendancePayload,
        ...earnings,
        ...deductions,
      };
      const res = await API.post("/payroll/generate-for-employee", payload);
      setResult(res.data);
      setIsEdit(true);
      setExistingSlipId(res.data?.slip_id || null);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not save payslip");
    } finally { setBusy(false); }
  };

  // Publish the saved slip to Payroll Records. Requires an existing
  // slip_id (either freshly created via Generate/Update, or loaded
  // from an existing slip in Edit mode). Idempotent on the backend
  // side, but we still guard against double-clicks with submitBusy.
  const onSubmit = async () => {
    const slipId = result?.slip_id || existingSlipId;
    if (!slipId) {
      setError("Save the payslip first before submitting to Payroll Records.");
      return;
    }
    setSubmitBusy(true);
    setError("");
    try {
      const res = await API.patch(`/payroll/slips/${slipId}/submit`);
      setSubmittedAt(res.data?.submitted_at || new Date().toISOString());
      setSubmitDone(true);
      // Auto-fade the "Submitted ✓" toast after a couple of seconds
      // so the button reverts to its steady "Already submitted" state.
      setTimeout(() => setSubmitDone(false), 3000);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not submit to Payroll Records.");
    } finally {
      setSubmitBusy(false);
    }
  };

  const onReset = () => {
    if (!selected) {
      setEmpId(""); setYear(today.getFullYear()); setMonth(today.getMonth() + 1);
      return;
    }
    setEarnings({ ...BLANK_EARNINGS });
    setDeductions({ ...BLANK_DEDUCTIONS });
    setWorking({
      ...BLANK_WORKING,
      WORKING_DAYS: workingDaysInMonth(year, month),
    });
    setAbsenceDedManualOverride(false);
    setWorkingDaysManualOverride(false);
    setClManualOverride(false);
    setPayDate("");
    setResult(null); setError("");
  };


  // ---- Render ----
  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>

        {/* --- Breadcrumb --- */}
        <div className={styles.crumb}>
          <div>
            <h1 className={styles.crumbTitle}>
              {isEdit ? "Edit Payslip" : "Generate Payslip"}
            </h1>
            <div className={styles.crumbSub}>
              Fill the details below to {isEdit ? "update" : "create"} an employee payslip.
              Once saved it appears on the employee's Payslips tab automatically —
              read-only for them, editable here.
            </div>
          </div>
        </div>


        {/* --- 1. Company header --- */}
        <div className={styles.card}>
          <div className={styles.companyRow}>

            {/* Logo tile — a <label> that contains the file <input>, so
                the browser opens the file picker on click natively (no
                programmatic .click() call, which some browsers block).
                Accepts png / jpg / jpeg / webp / svg (backend enforces).
                Hover shows the "Upload / Change" hint. */}
            <label
              className={`${styles.companyLogo} ${logoBusy ? styles.companyLogoBusy : ""}`}
              title={company?.LOGO_URL ? "Change company logo" : "Upload company logo"}
              aria-label={company?.LOGO_URL ? "Change company logo" : "Upload company logo"}
            >
              {company?.LOGO_URL ? (
                <img
                  src={company.LOGO_URL.startsWith("http")
                    ? company.LOGO_URL
                    : `${BACKEND_URL}${company.LOGO_URL}`}
                  alt=""
                />
              ) : (
                <span className={styles.companyLogoInitials}>BVC</span>
              )}
              <span className={styles.companyLogoOverlay}>
                {logoBusy
                  ? "Uploading…"
                  : (company?.LOGO_URL ? "Change" : "Upload")}
              </span>
              <input
                ref={logoInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.jfif,.jpe,.webp,.svg,.gif,image/*"
                onChange={onLogoFileChosen}
                disabled={logoBusy}
                style={{
                  position: "absolute",
                  width: 1, height: 1,
                  opacity: 0,
                  pointerEvents: "none",
                }}
              />
            </label>

            <div className={styles.companyInfo}>
              <div className={styles.companyName}>
                {company?.LEGAL_NAME || "Bharath Vending Corporation"}
              </div>
              {/* One-line location: City, State, Country only — no
                  street address / pincode. Everything is filtered so
                  a missing field just closes up gracefully. */}
              <div className={styles.companyLine}>
                {[
                  company?.CITY,
                  company?.STATE,
                  company?.COUNTRY || "India",
                ].filter(Boolean).join(", ")}
              </div>
            </div>

            <div className={styles.periodBlock}>
              <div className={styles.periodLabel}>Payslip For the Month</div>
              <div className={styles.periodRow}>
                <select
                  className={`${styles.periodInput} ${styles.periodInputMonth}`}
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {MONTHS.map((m) => (
                    <option key={m.n} value={m.n}>{m.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="2020"
                  max="2099"
                  className={`${styles.periodInput} ${styles.periodInputYear}`}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value) || year)}
                />
              </div>
            </div>
          </div>
        </div>


        {/* --- 2. Employee Pay Summary ---
            Layout is fixed at 5 rows × 2 columns, in this exact order:
              Row 1: Employee Name  | Employee ID
              Row 2: Working Days   | Casual Leave
              Row 3: Absent Days    | Days Late
              Row 4: Total Days     | OT Hours
              Row 5: Pay Period     | Pay Date
            Total Days = Working Days − Absent Days (computed, read-only).
            LOP is rolled into Absent Days for this simplified layout;
            Days Present is derived (Total Days − Casual Leave) so the
            backend calc gets values without HR having to enter them. */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Employee Details</h2>
          </div>

          <div className={styles.summaryGrid}>

            {/* Row 1 */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Employee Name</label>
              <select
                className={styles.fieldSelect}
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
              >
                <option value="">— pick an employee —</option>
                {employees.map((e) => (
                  <option key={e.ID} value={e.ID}>
                    {e.NAME} · {e.EMPLOYEE_CODE}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Employee ID</label>
              <input
                type="text"
                readOnly
                className={`${styles.fieldInput} ${styles.fieldInputRO}`}
                value={selected?.EMPLOYEE_CODE || ""}
                placeholder="— auto —"
              />
            </div>

            {/* Rows 1.5 & 1.75 — Master-data auto-fills. All four are
                read-only and populate from Employee Master (/employees).
                No HR editing so the payslip stays consistent with the
                canonical employee record. */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Department</label>
              <input
                type="text"
                readOnly
                className={`${styles.fieldInput} ${styles.fieldInputRO}`}
                value={
                  // Backend returns {ID, NAME, CODE} for DEPARTMENT;
                  // legacy code paths may still ship a plain string.
                  // Handle both so the field never renders as
                  // "[object Object]".
                  (typeof selected?.DEPARTMENT === "object"
                    ? selected?.DEPARTMENT?.NAME
                    : selected?.DEPARTMENT) || ""
                }
                placeholder="— auto —"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Designation</label>
              <input
                type="text"
                readOnly
                className={`${styles.fieldInput} ${styles.fieldInputRO}`}
                value={
                  // Backend returns {ID, TITLE} for DESIGNATION.
                  (typeof selected?.DESIGNATION === "object"
                    ? selected?.DESIGNATION?.TITLE
                    : selected?.DESIGNATION) || ""
                }
                placeholder="— auto —"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Bank Name</label>
              <input
                type="text"
                readOnly
                className={`${styles.fieldInput} ${styles.fieldInputRO}`}
                value={selected?.BANK_NAME || ""}
                placeholder="— auto —"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Bank Account Number</label>
              <input
                type="text"
                readOnly
                className={`${styles.fieldInput} ${styles.fieldInputRO}`}
                value={selected?.BANK_ACCOUNT_NUMBER || ""}
                placeholder="— auto —"
              />
            </div>

            {/* Row 2 — Working Days auto-fills from the calendar (Mon–Sat
                → calendar days minus Sundays) whenever month/year changes.
                Typing here flips the override so subsequent month changes
                stop auto-updating this cell. */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Working Days</label>
              <input
                type="number"
                min="0"
                className={styles.fieldInput}
                value={working.WORKING_DAYS}
                onChange={(e) => {
                  setWorkingDaysManualOverride(true);
                  setWorking({ ...working, WORKING_DAYS: Number(e.target.value) || 0 });
                }}
                title="Auto = calendar days − Sundays for the picked month; type to override."
              />
            </div>

            {/* Casual Leave — first day of Absent is auto-assigned as
                1 CL. Typing your own value here locks the auto behaviour
                so subsequent Absent-Days edits don't reset it. */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Casual Leave</label>
              <input
                type="number"
                min="0"
                step="0.5"
                className={styles.fieldInput}
                value={working.PAID_LEAVE_DAYS}
                onChange={(e) => {
                  setClManualOverride(true);
                  setWorking({ ...working, PAID_LEAVE_DAYS: Number(e.target.value) || 0 });
                }}
                title="Paid CL days. Auto = 1 when Absent ≥ 1; type to override."
              />
            </div>

            {/* Row 3 */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Absent Days</label>
              <input
                type="number"
                min="0"
                step="0.5"
                className={styles.fieldInput}
                value={working.ABSENT_DAYS}
                onChange={(e) => setWorking({ ...working, ABSENT_DAYS: Number(e.target.value) || 0 })}
                title="Unauthorised absent days (includes LOP)"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Days Late</label>
              <input
                type="number"
                min="0"
                className={styles.fieldInput}
                value={working.DAYS_LATE}
                onChange={(e) => setWorking({ ...working, DAYS_LATE: Number(e.target.value) || 0 })}
              />
            </div>

            {/* Row 4 — Total Days = paid days = Working − unpaid absent.
                Since Casual Leave is paid, we add it back:
                  Total = Working − Absent + CL. */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Total Days</label>
              <input
                type="number"
                readOnly
                className={`${styles.fieldInput} ${styles.fieldInputRO}`}
                value={Math.max(
                  0,
                  Number(working.WORKING_DAYS || 0)
                  - Number(working.ABSENT_DAYS || 0)
                  + Number(working.PAID_LEAVE_DAYS || 0)
                )}
                title="Working Days − Absent Days + Casual Leave (CL is paid)"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>OT Hours</label>
              <input
                type="number"
                min="0"
                step="0.25"
                className={styles.fieldInput}
                value={working.OT_HOURS}
                onChange={(e) => setWorking({ ...working, OT_HOURS: Number(e.target.value) || 0 })}
              />
            </div>

            {/* Row 5 */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Pay Period</label>
              <input
                type="text"
                readOnly
                className={`${styles.fieldInput} ${styles.fieldInputRO}`}
                value={periodLabel}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Pay Date</label>
              <input
                type="date"
                className={styles.fieldInput}
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>

          </div>
        </div>


        {/* --- 3. Income Details --- */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Income Details</h2>
          </div>

          <div className={styles.incomeGrid}>

            <div className={styles.incomeColLeft}>
              <div className={styles.incomeHead}>
                <span className={styles.incomeHeadLabel}>Earnings</span>
                <span className={`${styles.incomeHeadLabel} ${styles.incomeHeadAmount}`}>Amount</span>
              </div>
              {EARNING_ROWS.map((row) => (
                <div key={row.key} className={styles.incomeRow}>
                  <span className={styles.incomeRowLabel}>{row.label}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={styles.incomeRowInput}
                    value={earnings[row.key]}
                    onChange={(e) => setEarnings({ ...earnings, [row.key]: Number(e.target.value) || 0 })}
                  />
                </div>
              ))}
              <div className={styles.incomeSub}>
                <span>Gross Earnings</span>
                <span className={styles.incomeSubValue}>{inr(gross)}</span>
              </div>
            </div>

            <div className={styles.incomeColRight}>
              <div className={styles.incomeHead}>
                <span className={styles.incomeHeadLabel}>Deductions</span>
                <span className={`${styles.incomeHeadLabel} ${styles.incomeHeadAmount}`}>Amount</span>
              </div>
              {DEDUCTION_ROWS.map((row) => (
                <div key={row.key} className={styles.incomeRow}>
                  <span className={styles.incomeRowLabel}>{row.label}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={styles.incomeRowInput}
                    value={deductions[row.key]}
                    onChange={(e) => {
                      // Any manual edit to the Absence row locks off
                      // the auto-computed value so HR's override sticks.
                      if (row.key === "ABSENCE_DEDUCTION") {
                        setAbsenceDedManualOverride(true);
                      }
                      setDeductions({ ...deductions, [row.key]: Number(e.target.value) || 0 });
                    }}
                    title={row.key === "ABSENCE_DEDUCTION"
                      ? "Auto = Absent Days × (Gross ÷ Working Days). Editing here overrides the auto value."
                      : undefined}
                  />
                </div>
              ))}
              <div className={styles.incomeSub}>
                <span>Total Deductions</span>
                <span className={styles.incomeSubValue}>{inr(totalDed)}</span>
              </div>
            </div>

          </div>
        </div>


        {/* --- 4. Total Net Payable --- */}
        <div className={styles.netBox}>
          <div>
            <div className={styles.netLabel}>Total Net Payable</div>
            <div className={styles.netFormula}>Gross Earnings − Total Deductions</div>
          </div>
          <div className={styles.netValue}>{inr(net)}</div>
          <div className={styles.netWords}>
            Amount In Words: <b>{netWords}</b>
          </div>
        </div>


        {/* --- Alerts --- */}
        {logoErr && <div className={styles.errorAlert}>{logoErr}</div>}
        {error && <div className={styles.errorAlert}>{error}</div>}


        {/* --- Success (after generate/update) --- */}
        {result && (
          <div className={styles.successCard}>
            <div className={styles.successIcon}>{I.check}</div>
            <div className={styles.successBody}>
              <div className={styles.successTitle}>
                {isEdit ? "Payslip updated" : "Payslip generated"}
              </div>
              <div className={styles.successSub}>
                Slip #{result.slip_id} · Net {inr(result.net)}
              </div>
              <div className={styles.successHint}>
                Visible instantly on the employee's Payslips tab.
              </div>
            </div>
            <div className={styles.successActions}>
              <button className={styles.btnPrimary} onClick={() => setShowPreview(true)}>
                {I.view}<span>Preview</span>
              </button>
              <a
                href={`${BACKEND_URL}/my-payslips/${result.slip_id}/pdf`}
                target="_blank" rel="noreferrer"
                className={styles.btnSecondary}
              >
                {I.download}<span>View PDF</span>
              </a>
            </div>
          </div>
        )}


        {/* --- Actions ---
            Submit button appears next to Update once a slip has been
            saved (either just now via Generate/Update, or loaded via
            Edit mode). Publishing to Payroll Records is a separate,
            deliberate step so drafts don't leak into the audit trail. */}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onReset}
            title="Clear the form and start over"
          >
            {I.reset}<span>Reset</span>
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={onGenerate}
            disabled={busy || !empId}
            title={!empId ? "Pick an employee first" : (isEdit ? "Update this employee's payslip" : "Generate this employee's payslip")}
          >
            {I.send}
            <span>
              {busy
                ? "Saving…"
                : (isEdit ? "Update Payslip" : "Generate Payslip")}
            </span>
          </button>

          {/* Submit-to-Payroll-Records button. Visible only when a slip
              exists to submit (result from a fresh save, or existingSlipId
              from Edit mode). Switches to a green "Submitted" pill after
              success so HR sees the state transition. */}
          {(result?.slip_id || existingSlipId) && (
            <button
              type="button"
              className={
                submittedAt
                  ? `${styles.btnPrimary} ${styles.btnSubmitted}`
                  : styles.btnPrimary
              }
              onClick={onSubmit}
              disabled={submitBusy || !!submittedAt}
              title={
                submittedAt
                  ? `Already submitted on ${new Date(submittedAt).toLocaleString("en-IN")}`
                  : "Publish this payslip to Payroll Records"
              }
            >
              {I.send}
              <span>
                {submitBusy
                  ? "Submitting…"
                  : submitDone
                    ? "Submitted ✓"
                    : submittedAt
                      ? "Already Submitted"
                      : "Submit"}
              </span>
            </button>
          )}
        </div>

      </div>

      {/* Zoho-style HTML preview — same component the employee sees */}
      {showPreview && (result?.slip_id || existingSlipId) && (
        <PayslipPreview
          slipId={result?.slip_id || existingSlipId}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
