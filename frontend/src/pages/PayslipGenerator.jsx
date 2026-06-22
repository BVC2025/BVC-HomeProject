// =====================================================================
// PayslipGenerator — HR-side page to generate ONE payslip for ONE
// employee. The slip is written to the same payroll_slip table the
// employee portal reads from, so the employee sees it instantly on
// their Payslips tab.
//
// Workflow:
//   1. HR picks an employee
//   2. HR picks year/month
//   3. The form pre-fills earnings from the employee's SALARY field
//      (basic = 60% · HRA = 25% · others split out by sensible defaults)
//      — HR can adjust every line
//   4. Statutory deductions auto-calc based on basic
//      (PF = 12% of basic capped at ₹1800, PT = ₹200, ESI = 0.75% if eligible)
//      — HR can override
//   5. Click Generate -> POST /payroll/generate-for-employee
//   6. Employee gets a Notification + the slip appears on their portal
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";

const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8001";

const MONTHS = [
  { n: 1,  label: "January" },   { n: 2,  label: "February" },
  { n: 3,  label: "March"   },   { n: 4,  label: "April"    },
  { n: 5,  label: "May"     },   { n: 6,  label: "June"     },
  { n: 7,  label: "July"    },   { n: 8,  label: "August"   },
  { n: 9,  label: "September" }, { n: 10, label: "October"  },
  { n: 11, label: "November"  }, { n: 12, label: "December" },
];


function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}


// Sensible default breakdown. HR can override every cell.
function defaultBreakdown(monthlySalary) {
  const s = Number(monthlySalary || 0);
  // Standard Indian salary split — typical mid-size company
  const basic       = Math.round(s * 0.50);
  const hra         = Math.round(s * 0.20);
  const conveyance  = Math.min(1600, Math.round(s * 0.05));
  const medical     = Math.min(1250, Math.round(s * 0.04));
  const special     = Math.max(0, s - basic - hra - conveyance - medical);

  // Statutory deductions
  const pf       = Math.round(Math.min(basic * 0.12, 1800));
  const pt       = s > 0 ? 200 : 0;
  const esiBase  = s + hra + conveyance + medical + special;
  const esi      = esiBase <= 21000 ? Math.round(esiBase * 0.0075) : 0;

  return {
    BASIC: basic,
    HRA: hra,
    DA: 0,
    CONVEYANCE: conveyance,
    MEDICAL_ALLOWANCE: medical,
    SPECIAL_ALLOWANCE: special,
    OTHER_ALLOWANCES: 0,
    BONUS: 0,
    INCENTIVES: 0,
    TASK_BONUS: 0,
    OT_PAY: 0,
    PF_EMPLOYEE: pf,
    ESI_EMPLOYEE: esi,
    PROFESSIONAL_TAX: pt,
    LATE_PENALTY: 0,
    OTHER_DEDUCTIONS: 0,
  };
}


export default function PayslipGenerator() {

  const today = new Date();

  // ---- form state ----
  const [employees, setEmployees] = useState([]);
  const [empId, setEmpId]   = useState("");
  const [year,  setYear]    = useState(today.getFullYear());
  const [month, setMonth]   = useState(today.getMonth() + 1);

  const [working, setWorking] = useState({
    WORKING_DAYS:       26,
    DAYS_PRESENT:       26,
    DAYS_LATE:          0,
    PAID_LEAVE_DAYS:    0,
    UNPAID_LEAVE_DAYS:  0,
    ABSENT_DAYS:        0,
    OT_HOURS:           0,
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
    OTHER_DEDUCTIONS: 0,
  });

  const [result, setResult] = useState(null);
  const [error,  setError]  = useState("");
  const [busy,   setBusy]   = useState(false);

  // ---- load employees ----
  useEffect(() => {
    API.get("/employees?status=ACTIVE")
       .then((r) => setEmployees(r.data || []))
       .catch(() => setEmployees([]));
  }, []);

  // ---- selected employee ----
  const selected = useMemo(
    () => employees.find((e) => e.ID === empId) || null,
    [employees, empId]
  );

  // ---- when employee changes, pre-fill from their SALARY ----
  useEffect(() => {
    if (!selected) return;
    const def = defaultBreakdown(selected.SALARY);
    setEarnings({
      BASIC: def.BASIC, HRA: def.HRA, DA: def.DA,
      CONVEYANCE: def.CONVEYANCE,
      MEDICAL_ALLOWANCE: def.MEDICAL_ALLOWANCE,
      SPECIAL_ALLOWANCE: def.SPECIAL_ALLOWANCE,
      OTHER_ALLOWANCES: def.OTHER_ALLOWANCES,
      BONUS: def.BONUS, INCENTIVES: def.INCENTIVES,
      TASK_BONUS: def.TASK_BONUS, OT_PAY: def.OT_PAY,
    });
    setDeductions({
      PF_EMPLOYEE: def.PF_EMPLOYEE,
      ESI_EMPLOYEE: def.ESI_EMPLOYEE,
      PROFESSIONAL_TAX: def.PROFESSIONAL_TAX,
      LATE_PENALTY: 0,
      OTHER_DEDUCTIONS: 0,
    });
    setResult(null);
    setError("");
  }, [selected]);

  // ---- live totals ----
  const gross = useMemo(
    () => Object.values(earnings).reduce((s, v) => s + Number(v || 0), 0),
    [earnings]
  );
  const totalDed = useMemo(
    () => Object.values(deductions).reduce((s, v) => s + Number(v || 0), 0),
    [deductions]
  );
  const net = gross - totalDed;

  // ---- submit ----
  const onGenerate = async () => {
    if (!empId) { setError("Pick an employee first."); return; }
    setBusy(true); setError(""); setResult(null);
    try {
      const payload = {
        EMPLOYEE_ID: empId,
        YEAR:  Number(year),
        MONTH: Number(month),
        ...working,
        ...earnings,
        ...deductions,
      };
      const res = await API.post("/payroll/generate-for-employee", payload);
      setResult(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not generate payslip");
    } finally { setBusy(false); }
  };

  // ---- render ----
  return (
    <div style={{ padding: 20, background: "#f1f5f9",
                  minHeight: "calc(100vh - 80px)" }}>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
        borderRadius: 16, padding: "20px 26px", color: "white",
        marginBottom: 18,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 2,
          color: BVC_GOLD, textTransform: "uppercase",
        }}>
          BVC24 · HR · Payroll
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
          Generate Employee Payslip
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
          Pick an employee, set the period, adjust earnings &amp; deductions, then generate. The slip appears instantly on the employee's Payslips tab.
        </div>
      </div>

      {/* Step 1: pick employee + period */}
      <Card title="① Employee &amp; Period">
        <div style={{
          display: "grid", gridTemplateColumns: "2fr 1fr 1fr",
          gap: 12,
        }}>
          <Field label="Employee">
            <select value={empId} onChange={(e) => setEmpId(e.target.value)}
                    style={input}>
              <option value="">— pick an employee —</option>
              {employees.map((e) => (
                <option key={e.ID} value={e.ID}>
                  {e.NAME} · {e.EMPLOYEE_CODE} · ₹{Number(e.SALARY || 0).toLocaleString("en-IN")}/month
                </option>
              ))}
            </select>
          </Field>
          <Field label="Year">
            <input type="number" min="2020" max="2099" value={year}
                   onChange={(e) => setYear(e.target.value)} style={input} />
          </Field>
          <Field label="Month">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                    style={input}>
              {MONTHS.map((m) => (
                <option key={m.n} value={m.n}>{m.label}</option>
              ))}
            </select>
          </Field>
        </div>

        {selected && (
          <div style={{
            marginTop: 12, padding: "10px 14px", background: "#fef4f5",
            border: "1px solid #fecaca", borderRadius: 10,
            display: "flex", flexWrap: "wrap", gap: 18, fontSize: 12,
            color: "#7A1022",
          }}>
            <div><b>{selected.NAME}</b> ({selected.EMPLOYEE_CODE})</div>
            <div>Stored monthly salary: <b>₹{Number(selected.SALARY || 0).toLocaleString("en-IN")}</b></div>
            <div>Email: {selected.EMAIL || "—"}</div>
          </div>
        )}
      </Card>

      {/* Step 2: attendance + earnings + deductions */}
      {selected && (
        <>
          <Card title="② Attendance">
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
            }}>
              <NumField label="Working Days"     value={working.WORKING_DAYS}      onChange={(v) => setWorking({...working, WORKING_DAYS: v})} />
              <NumField label="Present Days"     value={working.DAYS_PRESENT}      onChange={(v) => setWorking({...working, DAYS_PRESENT: v})} />
              <NumField label="Late Marks"       value={working.DAYS_LATE}         onChange={(v) => setWorking({...working, DAYS_LATE: v})} />
              <NumField label="Paid Leave Days"  value={working.PAID_LEAVE_DAYS}   onChange={(v) => setWorking({...working, PAID_LEAVE_DAYS: v})} />
              <NumField label="LOP Days"         value={working.UNPAID_LEAVE_DAYS} onChange={(v) => setWorking({...working, UNPAID_LEAVE_DAYS: v})} />
              <NumField label="Absent Days"      value={working.ABSENT_DAYS}       onChange={(v) => setWorking({...working, ABSENT_DAYS: v})} />
              <NumField label="OT Hours"         value={working.OT_HOURS}          onChange={(v) => setWorking({...working, OT_HOURS: v})} />
            </div>
          </Card>

          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16,
            marginBottom: 16,
          }}>
            <Card title="③ Earnings" headerColor="#166534">
              <NumField label="Basic Salary"        value={earnings.BASIC}             onChange={(v) => setEarnings({...earnings, BASIC: v})}             rupees />
              <NumField label="HRA"                 value={earnings.HRA}               onChange={(v) => setEarnings({...earnings, HRA: v})}               rupees />
              <NumField label="DA"                  value={earnings.DA}                onChange={(v) => setEarnings({...earnings, DA: v})}                rupees />
              <NumField label="Conveyance"          value={earnings.CONVEYANCE}        onChange={(v) => setEarnings({...earnings, CONVEYANCE: v})}        rupees />
              <NumField label="Medical Allowance"   value={earnings.MEDICAL_ALLOWANCE} onChange={(v) => setEarnings({...earnings, MEDICAL_ALLOWANCE: v})} rupees />
              <NumField label="Special Allowance"   value={earnings.SPECIAL_ALLOWANCE} onChange={(v) => setEarnings({...earnings, SPECIAL_ALLOWANCE: v})} rupees />
              <NumField label="Other Allowances"    value={earnings.OTHER_ALLOWANCES}  onChange={(v) => setEarnings({...earnings, OTHER_ALLOWANCES: v})}  rupees />
              <NumField label="Incentives"          value={earnings.INCENTIVES}        onChange={(v) => setEarnings({...earnings, INCENTIVES: v})}        rupees />
              <NumField label="Bonus"               value={earnings.BONUS}             onChange={(v) => setEarnings({...earnings, BONUS: v})}             rupees />
              <NumField label="Task Bonus"          value={earnings.TASK_BONUS}        onChange={(v) => setEarnings({...earnings, TASK_BONUS: v})}        rupees />
              <NumField label="Overtime Pay"        value={earnings.OT_PAY}            onChange={(v) => setEarnings({...earnings, OT_PAY: v})}            rupees />
              <Total label="Gross Earnings" value={gross} color="#166534" />
            </Card>

            <Card title="④ Deductions" headerColor="#991b1b">
              <NumField label="Provident Fund (PF)"  value={deductions.PF_EMPLOYEE}      onChange={(v) => setDeductions({...deductions, PF_EMPLOYEE: v})}      rupees />
              <NumField label="ESI"                  value={deductions.ESI_EMPLOYEE}     onChange={(v) => setDeductions({...deductions, ESI_EMPLOYEE: v})}     rupees />
              <NumField label="Professional Tax"     value={deductions.PROFESSIONAL_TAX} onChange={(v) => setDeductions({...deductions, PROFESSIONAL_TAX: v})} rupees />
              <NumField label="Late Penalty"         value={deductions.LATE_PENALTY}     onChange={(v) => setDeductions({...deductions, LATE_PENALTY: v})}     rupees />
              <NumField label="Other (TDS / Loan / Advances)" value={deductions.OTHER_DEDUCTIONS} onChange={(v) => setDeductions({...deductions, OTHER_DEDUCTIONS: v})} rupees />
              <Total label="Total Deductions" value={totalDed} color="#991b1b" />
            </Card>
          </div>

          {/* Net summary */}
          <Card title="⑤ Net Pay" headerColor={BVC_RED}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14, padding: "6px 4px",
            }}>
              <SummaryTile label="Gross Earnings"   value={inr(gross)}    color="#166534" />
              <SummaryTile label="Total Deductions" value={`− ${inr(totalDed)}`} color="#991b1b" />
              <SummaryTile label="NET PAY"          value={inr(net)}      color={BVC_DARK} bold />
            </div>

            {error && (
              <div style={{
                marginTop: 12, padding: "10px 14px",
                background: "#fef2f2", color: "#991b1b",
                border: "1px solid #fecaca", borderRadius: 8, fontSize: 13,
              }}>{error}</div>
            )}

            {result && (
              <div style={{
                marginTop: 12, padding: 14,
                background: "#f0fdf4", border: "1px solid #bbf7d0",
                borderRadius: 10,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#14532d",
                             letterSpacing: 1.4, textTransform: "uppercase" }}>
                  Payslip generated
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a",
                             marginTop: 4 }}>
                  Slip #{result.slip_id} · Net {inr(result.net)}
                </div>
                <div style={{ fontSize: 12, color: "#166534", marginTop: 4 }}>
                  {result.message}. The employee has been notified.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <a href={`${BACKEND_URL}/my-payslips/${result.slip_id}/pdf`}
                     target="_blank" rel="noreferrer" style={btnPrimaryLink}>
                    View PDF
                  </a>
                  <button onClick={() => setResult(null)} style={btnSecondary}>
                    Generate another
                  </button>
                </div>
              </div>
            )}

            {!result && (
              <div style={{ display: "flex", justifyContent: "flex-end",
                            marginTop: 14 }}>
                <button onClick={onGenerate} disabled={busy || !empId}
                        style={{
                          ...btnPrimary,
                          opacity: !empId ? 0.4 : 1,
                          cursor: !empId ? "not-allowed" : "pointer",
                        }}>
                  {busy ? "Generating..." : "Generate Payslip"}
                </button>
              </div>
            )}
          </Card>
        </>
      )}

      {!selected && (
        <div style={{
          padding: 40, background: "white", borderRadius: 12,
          textAlign: "center", color: "#94a3b8", fontSize: 13,
          fontStyle: "italic",
          boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        }}>
          Pick an employee above to load their salary and start a payslip.
        </div>
      )}
    </div>
  );
}


// ============================================================
// Small UI helpers
// ============================================================

function Card({ title, headerColor = BVC_DARK, children }) {
  return (
    <div style={{
      background: "white", borderRadius: 12,
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
      marginBottom: 16, overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 16px",
        background: "#fafbfc",
        borderBottom: `1px solid #e2e8f0`,
        borderLeft: `4px solid ${headerColor}`,
        fontSize: 12, fontWeight: 800, color: "#0f172a",
        letterSpacing: 0.5, textTransform: "uppercase",
      }}
      dangerouslySetInnerHTML={{ __html: title }}
      />
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}


function Field({ label, children }) {
  return (
    <div>
      <label style={{
        display: "block", fontSize: 10, fontWeight: 800,
        color: "#475569", letterSpacing: 1, textTransform: "uppercase",
        marginBottom: 4,
      }}>{label}</label>
      {children}
    </div>
  );
}


function NumField({ label, value, onChange, rupees }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: "block", fontSize: 10, fontWeight: 700,
        color: "#64748b", letterSpacing: 0.5,
        textTransform: "uppercase", marginBottom: 3,
      }}>{label}{rupees && " (₹)"}</label>
      <input
        type="number" min="0" step={rupees ? "1" : "0.5"}
        value={value === 0 ? 0 : (value || "")}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        style={{
          width: "100%", padding: "7px 10px",
          border: "1px solid #cbd5e1", borderRadius: 6,
          fontSize: 13, fontFamily: "inherit",
          textAlign: rupees ? "right" : "left",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}


function Total({ label, value, color }) {
  return (
    <div style={{
      marginTop: 8, padding: "10px 12px",
      background: "#f8fafc", border: `1px solid #e2e8f0`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 6,
      display: "flex", justifyContent: "space-between",
      alignItems: "center",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: "#0f172a",
        letterSpacing: 0.6, textTransform: "uppercase",
      }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color }}>
        {inr(value)}
      </div>
    </div>
  );
}


function SummaryTile({ label, value, color, bold }) {
  return (
    <div style={{
      background: bold ? color : "white",
      color: bold ? "white" : "#0f172a",
      border: bold ? "none" : `1px solid #e2e8f0`,
      borderTop: bold ? "none" : `3px solid ${color}`,
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800,
        color: bold ? BVC_GOLD : "#64748b",
        letterSpacing: 1, textTransform: "uppercase",
      }}>{label}</div>
      <div style={{
        fontSize: bold ? 24 : 20,
        fontWeight: 800, marginTop: 4,
      }}>{value}</div>
    </div>
  );
}


const input = {
  width: "100%", padding: "9px 11px",
  border: "1px solid #cbd5e1", borderRadius: 8,
  fontSize: 13, fontFamily: "inherit",
  background: "white", boxSizing: "border-box",
};

const btnPrimary = {
  padding: "10px 22px", background: BVC_RED, color: "white",
  border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13,
  cursor: "pointer",
};

const btnPrimaryLink = {
  ...btnPrimary, textDecoration: "none", display: "inline-block",
};

const btnSecondary = {
  padding: "10px 18px", background: "white", color: "#475569",
  border: "1px solid #cbd5e1", borderRadius: 8,
  fontWeight: 700, fontSize: 12, cursor: "pointer",
};
