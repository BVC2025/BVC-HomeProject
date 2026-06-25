// =====================================================================
// Employee Profile — Odoo-style 3-column employee record page.
//
// Layout:
//   LEFT  (280px)  : photo + identity + contact + status
//   CENTER (flex)  : 6 metric tiles + 10-tab content
//   RIGHT (360px)  : AI Employee Agent panel (chat + voice + quick actions)
//
// READS from existing endpoints — no schema changes. Tabs that depend on
// not-yet-built modules (Documents, Assets, Activity History) show
// structured placeholders so the page is usable today and ships
// incrementally.
// =====================================================================

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import API, { API_BASE_URL } from "../services/api";
import EmployeeStatusModal from "../components/EmployeeStatusModal";


const BVC_RED = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_GOLD = "#F4B324";

const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8001";


const STATUS_THEME = {
  ACTIVE: { bg: "#dcfce7", fg: "#166534" },
  SUSPENDED: { bg: "#fef3c7", fg: "#854d0e" },
  RESIGNED: { bg: "#f1f5f9", fg: "#475569" },
  TERMINATED: { bg: "#fee2e2", fg: "#991b1b" },
};


const TABS = [
  { key: "overview", label: "Overview" },
  { key: "work", label: "Work Information" },
  { key: "personal", label: "Personal Information" },
  { key: "documents", label: "Documents" },
  { key: "payroll", label: "Payroll" },
  { key: "assets", label: "Assets" },
  { key: "leave", label: "Leave" },
  { key: "attendance", label: "Attendance" },
  { key: "performance", label: "Performance" },
];


// ---------- helpers ----------

function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(s) {
  if (!s) return "-";
  try { return new Date(s).toLocaleDateString("en-IN"); }
  catch { return s; }
}


// ---------- small UI atoms ----------

function StatusPill({ status }) {
  const t = STATUS_THEME[status] || STATUS_THEME.ACTIVE;
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 800,
      background: t.bg,
      color: t.fg,
      letterSpacing: 0.5,
    }}>
      {status || "ACTIVE"}
    </span>
  );
}


function MetricTile({ label, value, sub, color, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "white",
        borderRadius: 12,
        padding: "14px 16px",
        borderTop: `3px solid ${color}`,
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!onClick) return;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 22px rgba(15,23,42,0.10)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 4px 14px rgba(15,23,42,0.05)";
      }}
    >
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#64748b",
        letterSpacing: 1,
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 800,
        color: "#0f172a",
        marginTop: 4,
        letterSpacing: -0.5,
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


function FieldRow({ label, value }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "180px 1fr",
      padding: "10px 0",
      borderBottom: "1px solid #f1f5f9",
      fontSize: 13,
    }}>
      <div style={{ color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ color: "#0f172a" }}>
        {value === null || value === undefined || value === "" ? (
          <span style={{ color: "#cbd5e1" }}>Not set</span>
        ) : value}
      </div>
    </div>
  );
}


function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 800,
      color: "#0f172a",
      letterSpacing: 1.4,
      textTransform: "uppercase",
      marginTop: 18,
      marginBottom: 8,
      paddingBottom: 6,
      borderBottom: `2px solid ${BVC_RED}`,
      width: "fit-content",
    }}>
      {children}
    </div>
  );
}


// =====================================================================
// MAIN PAGE
// =====================================================================

export default function EmployeeProfile() {

  const { id } = useParams();
  const navigate = useNavigate();

  const [emp, setEmp] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [manager, setManager] = useState(null);
  const [reports, setReports] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState(null);
  // Tile data (live, not placeholders)
  const [monthlyHours, setMonthlyHours] = useState(0);      // actual sum of WORKED_HOURS this month
  const [monthlyOtHours, setMonthlyOtHours] = useState(0);  // actual sum of OVERTIME_HOURS this month
  const [expectedMonthlyHours, setExpectedMonthlyHours] = useState(0); // (working days in month) × 8
  const [perfScore, setPerfScore] = useState(null);         // 0-100 productivity score
  const [assetsCount, setAssetsCount] = useState(null);     // count of allocated assets
  const [assets, setAssets] = useState([]);                 // full list of allocated assets
  const [salaryStructure, setSalaryStructure] = useState(null); // CTC structure (or null)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  // Status-change modal
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);   // bump to refetch employee

  // Load everything we can in parallel — every call hits an EXISTING
  // endpoint, no new backend required for this page to ship.
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      try {
        // The URL param can be either a UUID (from clicking "Open Profile"
        // on a card) or an EMPLOYEE_CODE like "EMP101" (typed manually or
        // shared as a link). Try UUID endpoint first; on 404 fall back
        // to /employees/by-code/{code}. Both endpoints already exist.
        let empData = null;
        try {
          const r = await API.get(`/employees/${id}`);
          empData = r.data;
        } catch (e1) {
          if (e1?.response?.status === 404) {
            const r = await API.get(`/employees/by-code/${id}`);
            empData = r.data;
          } else {
            throw e1;
          }
        }
        if (cancelled) return;
        const e = empData;
        setEmp(e);

        const calls = [
          API.get("/departments").catch(() => ({ data: [] })),
          API.get("/designations").catch(() => ({ data: [] })),
          API.get(`/employees?status=ACTIVE`).catch(() => ({ data: [] })),
          API.get(`/leave/balance/${e.ID}`).catch(() => ({ data: null })),
          // Live tile data — portal-dashboard returns both productivity
          // score AND attendance_summary (monthly hours) in one call.
          API.get(`/employee/${e.ID}/portal-dashboard`).catch(() => ({ data: null })),
          // Asset allocation count — Onboarding module's per-employee endpoint.
          API.get(`/hr-onboarding/employees/${e.ID}/assets`).catch(() => ({ data: [] })),
          // Salary structure (CTC). 404 is expected for unconfigured employees.
          API.get(`/payroll/salary-structures/${e.ID}`).catch(() => ({ data: null })),
          // Current-month attendance — used to sum actual WORKED_HOURS for the
          // "Monthly Hours" tile. We want REAL hours, not present_days × 8.
          (() => {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const last = new Date(y, now.getMonth() + 1, 0).getDate();
            return API.get("/attendance", {
              params: {
                employee_id: e.ID,
                start_date: `${y}-${m}-01`,
                end_date:   `${y}-${m}-${String(last).padStart(2, "0")}`,
                limit: 500,
              },
            }).catch(() => ({ data: { rows: [] } }));
          })(),
        ];
        const [depts, desigs, allEmps, lb, portal, assetsRes, struct, attMonth] = await Promise.all(calls);
        if (cancelled) return;

        setDepartments(depts.data || []);
        setDesignations(desigs.data || []);
        setLeaveBalance(lb?.data || null);

        const all = allEmps.data || [];
        if (e.REPORTING_MANAGER_ID) {
          setManager(all.find((x) => x.ID === e.REPORTING_MANAGER_ID) || null);
        }
        setReports(all.filter((x) => x.REPORTING_MANAGER_ID === e.ID));

        // ---- Tile values (live, never undefined) ----
        const portalData = portal?.data || {};

        // Monthly Hours — numerator = sum of actual WORKED_HOURS across
        // the current month's attendance rows. Denominator = expected
        // hours for the month (working days × 8). Working days are
        // every day this month EXCEPT Sundays. Numerator reflects what
        // the employee actually logged via check-in/check-out; it is
        // 0 when there are no attendance records (e.g. after data wipe).
        const monthRows = Array.isArray(attMonth?.data?.rows)
          ? attMonth.data.rows
          : Array.isArray(attMonth?.data)
            ? attMonth.data
            : [];
        const summedHours = monthRows.reduce(
          (s, r) => s + (Number(r.WORKED_HOURS) || 0),
          0
        );
        setMonthlyHours(Math.round(summedHours * 10) / 10);

        // Overtime — sum of OVERTIME_HOURS column from the SAME monthly
        // rows. Each row's OVERTIME_HOURS is computed by the backend
        // from (OT_CHECK_OUT - OT_CHECK_IN), so this number reflects
        // only explicitly-logged OT sessions.
        const summedOt = monthRows.reduce(
          (s, r) => s + (Number(r.OVERTIME_HOURS) || 0),
          0
        );
        setMonthlyOtHours(Math.round(summedOt * 10) / 10);

        // Compute expected monthly hours from THIS calendar month.
        // Working day = any date in the month whose weekday is not Sunday.
        const now = new Date();
        const y = now.getFullYear();
        const mo = now.getMonth();
        const lastDay = new Date(y, mo + 1, 0).getDate();
        let workingDays = 0;
        for (let d = 1; d <= lastDay; d++) {
          if (new Date(y, mo, d).getDay() !== 0) workingDays += 1;
        }
        setExpectedMonthlyHours(workingDays * 8);

        // productivity.score is 0-100 from the perf service.
        const productivity = portalData.productivity || {};
        const score = productivity.score ?? portalData.performance?.score ?? null;
        setPerfScore(typeof score === "number" ? score : null);

        const assetRows = Array.isArray(assetsRes?.data) ? assetsRes.data : [];
        setAssets(assetRows);
        // Only count assets that are currently ISSUED (not RETURNED/LOST/etc.)
        setAssetsCount(
          assetRows.filter((a) => (a.status || "").toUpperCase() === "ISSUED").length
        );

        setSalaryStructure(struct?.data || null);

        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.detail || "Failed to load employee");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAll();
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  const departmentName = useMemo(() => {
    if (!emp) return "";
    // Backend already inlines DEPARTMENT = {ID, NAME, CODE} on the
    // employee payload. Prefer it; fall back to the lookup table.
    if (emp.DEPARTMENT && emp.DEPARTMENT.NAME) return emp.DEPARTMENT.NAME;
    return departments.find((d) => d.ID === emp.DEPARTMENT_ID)?.NAME || "-";
  }, [emp, departments]);

  const designationName = useMemo(() => {
    if (!emp) return "";
    // Backend inlines DESIGNATION = {ID, TITLE}. The Designation model
    // column is TITLE (not NAME) — that mismatch is why this row was
    // blank before.
    if (emp.DESIGNATION && emp.DESIGNATION.TITLE) return emp.DESIGNATION.TITLE;
    return designations.find((d) => d.ID === emp.DESIGNATION_ID)?.TITLE || "-";
  }, [emp, designations]);

  // Effective monthly salary — prefer the salary structure's GROSS_MONTHLY
  // when set (this is the "Total Salary" HR enters via the CTC builder);
  // otherwise fall back to emp.SALARY column.
  const effectiveSalary = useMemo(() => {
    const gross = Number(salaryStructure?.GROSS_MONTHLY) || 0;
    if (gross > 0) return gross;
    return Number(emp?.SALARY) || 0;
  }, [emp, salaryStructure]);

  if (loading) {
    return (
      <div style={{ padding: 40, color: "#94a3b8", fontStyle: "italic" }}>
        Loading employee profile...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{
          padding: 16,
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 10,
          fontSize: 14,
        }}>
          {error}
        </div>
      </div>
    );
  }
  if (!emp) return null;

  const photoSrc = emp.PHOTO_URL ? `${BACKEND_URL}${emp.PHOTO_URL}` : null;

  return (
    <div style={{
      padding: 20,
      background: "#f1f5f9",
      minHeight: "calc(100vh - 80px)",
    }}>

      {/* Breadcrumb */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 14,
        fontSize: 12,
        color: "#64748b",
      }}>
        <Link to="/employees" style={{ color: "#64748b", textDecoration: "none" }}>
          Employees
        </Link>
        <span>/</span>
        <span style={{ color: "#0f172a", fontWeight: 700 }}>{emp.NAME}</span>
      </div>

      {/* 2-column layout (left sidebar + center content).
          The right-side AI Agent panel was removed per design — keeping
          the AIAgentPanel component definition further down so it can
          be re-added with a single line if needed. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "280px 1fr",
        gap: 16,
        alignItems: "flex-start",
      }}>

        {/* ================ LEFT SIDEBAR ================ */}
        <LeftSidebar
          emp={emp}
          photoSrc={photoSrc}
          departmentName={departmentName}
          designationName={designationName}
          onChangeStatus={() => setStatusModalOpen(true)}
        />

        {/* ================ CENTER CONTENT ================ */}
        <div style={{ minWidth: 0 }}>

          {/* Metric tiles */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 10,
            marginBottom: 14,
          }}>
            <MetricTile
              label="Documents"
              value={countDocuments(emp)}
              sub="on file"
              color="#1d4ed8"
              onClick={() => setTab("documents")}
            />
            <MetricTile
              label="Leave Balance"
              value={leaveBalance?.TOTAL_REMAINING ?? leaveBalance?.CASUAL_REMAINING ?? "-"}
              sub="days left"
              color="#059669"
              onClick={() => setTab("leave")}
            />
            <MetricTile
              label="Monthly Hours"
              value={`${Number.isInteger(monthlyHours) ? monthlyHours : monthlyHours.toFixed(1)} / ${expectedMonthlyHours}`}
              sub="hours this month"
              color="#7c3aed"
              onClick={() => setTab("attendance")}
            />
            <MetricTile
              label="Monthly OT"
              value={`${Number.isInteger(monthlyOtHours) ? monthlyOtHours : monthlyOtHours.toFixed(1)}h`}
              sub="overtime this month"
              color="#a855f7"
              onClick={() => setTab("attendance")}
            />
            <MetricTile
              label="Payroll"
              value={effectiveSalary > 0 ? "Set" : "Pending"}
              sub={effectiveSalary > 0 ? inr(effectiveSalary) : "no salary"}
              color="#B47900"
              onClick={() => setTab("payroll")}
            />
            <MetricTile
              label="Assets"
              value={assetsCount == null ? "—" : String(assetsCount)}
              sub="allocated"
              color="#0891b2"
              onClick={() => setTab("assets")}
            />
            <MetricTile
              label="Performance"
              value={perfScore == null ? "—" : `${Math.round(perfScore)}`}
              sub={perfScore == null ? "this quarter" : "/ 100 score"}
              color="#991b1b"
              onClick={() => setTab("performance")}
            />
          </div>

          {/* Tab bar */}
          <div style={{
            background: "white",
            borderRadius: 12,
            padding: "6px 6px 0",
            boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
            marginBottom: 14,
            overflowX: "auto",
            display: "flex",
            gap: 2,
          }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: "10px 14px",
                  background: "transparent",
                  border: "none",
                  borderBottom: tab === t.key
                    ? `3px solid ${BVC_RED}`
                    : "3px solid transparent",
                  color: tab === t.key ? BVC_DARK : "#64748b",
                  fontWeight: tab === t.key ? 800 : 600,
                  fontSize: 13,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  letterSpacing: -0.005 + "em",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab body */}
          <div style={{
            background: "white",
            borderRadius: 12,
            padding: 22,
            boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
            minHeight: 400,
          }}>
            {tab === "overview" && <OverviewTab emp={emp} departmentName={departmentName} designationName={designationName} manager={manager} reports={reports} />}
            {tab === "work" && <WorkInfoTab emp={emp} departmentName={departmentName} designationName={designationName} manager={manager} />}
            {tab === "personal" && <PersonalInfoTab emp={emp} />}
            {tab === "documents" && <DocumentsTab emp={emp} />}
            {tab === "payroll" && <PayrollTab emp={emp} salaryStructure={salaryStructure} effectiveSalary={effectiveSalary} />}
            {tab === "assets" && <AssetsTab emp={emp} assets={assets} />}
            {tab === "leave" && <LeaveTab emp={emp} leaveBalance={leaveBalance} />}
            {tab === "attendance" && <AttendanceTab emp={emp} />}
            {tab === "performance" && <PerformanceTab emp={emp} />}
          </div>
        </div>

        {/* AI Agent panel removed from this page.
            To bring it back, paste this inside the grid:
              <AIAgentPanel emp={emp} />
            and switch the grid back to "280px 1fr 360px". */}
      </div>

      {/* ================ STATUS CHANGE MODAL ================ */}
      {statusModalOpen && (
        <EmployeeStatusModal
          employee={emp}
          onClose={() => setStatusModalOpen(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}


// =====================================================================
// LEFT SIDEBAR
// =====================================================================

function LeftSidebar({ emp, photoSrc, departmentName, designationName, onChangeStatus }) {
  return (
    <div style={{
      background: "white",
      borderRadius: 14,
      padding: 22,
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
      position: "sticky",
      top: 80,
    }}>

      {/* Photo */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        {photoSrc ? (
          <img
            src={photoSrc}
            alt={emp.NAME}
            style={{
              width: 140,
              height: 140,
              borderRadius: "50%",
              objectFit: "cover",
              border: `4px solid ${BVC_GOLD}`,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}
          />
        ) : (
          <div style={{
            width: 140,
            height: 140,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 56,
            fontWeight: 800,
            border: `4px solid ${BVC_GOLD}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}>
            {(emp.NAME || "?").charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Name + code */}
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: -0.3 }}>
          {emp.NAME}
        </div>
        <div style={{
          fontSize: 11,
          color: "#64748b",
          fontFamily: "ui-monospace, monospace",
          marginTop: 2,
          letterSpacing: 0.5,
        }}>
          {emp.EMPLOYEE_CODE}
        </div>
        <div style={{ marginTop: 8 }}>
          <StatusPill status={emp.STATUS} />
        </div>
        {onChangeStatus && (
          <button
            onClick={onChangeStatus}
            title="Change employee lifecycle status (Active / On Notice / Resigned / Terminated / Retired)"
            style={{
              marginTop: 10,
              background: "white",
              color: "#C8102E",
              border: "1px solid #C8102E",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            Change Status
          </button>
        )}
      </div>

      {/* Identity rows */}
      <div style={{ fontSize: 12 }}>
        <SidebarRow label="DESIGNATION" value={designationName} />
        <SidebarRow label="DEPARTMENT" value={departmentName} />
        <SidebarRow label="EMAIL" value={emp.EMAIL} mono />
        <SidebarRow label="PHONE" value={emp.PHONE} mono />
        <SidebarRow label="JOINED" value={fmtDate(emp.JOINING_DATE)} />
      </div>
    </div>
  );
}

function SidebarRow({ label, value, mono }) {
  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid #f1f5f9" }}>
      <div style={{
        fontSize: 9,
        fontWeight: 800,
        color: "#94a3b8",
        letterSpacing: 1,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 12,
        color: "#0f172a",
        marginTop: 2,
        wordBreak: "break-all",
        fontFamily: mono ? "ui-monospace, monospace" : "inherit",
      }}>
        {value || <span style={{ color: "#cbd5e1" }}>Not set</span>}
      </div>
    </div>
  );
}


// =====================================================================
// TABS — Overview / Work / Personal (full); rest stubbed with their
// expected fields so the page is structurally complete.
// =====================================================================

function OverviewTab({ emp, departmentName, designationName, manager, reports }) {
  return (
    <div>
      <SectionTitle>Job & organization</SectionTitle>
      <FieldRow label="Department" value={departmentName} />
      <FieldRow label="Job Position" value={designationName} />
      <FieldRow label="Manager" value={manager ? `${manager.NAME} (${manager.EMPLOYEE_CODE})` : "-"} />
      <FieldRow label="Work Location" value={emp.WORK_LOCATION} />
      <FieldRow label="Employment Type" value={emp.EMPLOYMENT_TYPE} />

      <SectionTitle>Reporting structure</SectionTitle>
      {reports.length === 0 ? (
        <div style={{ padding: 14, color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
          No direct reports.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 10,
          marginTop: 8,
        }}>
          {reports.map((r) => (
            <div key={r.ID} style={{
              padding: "10px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              background: "#f8fafc",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{r.NAME}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {r.EMPLOYEE_CODE}
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionTitle>Organization chart</SectionTitle>
      <OrgChartMini emp={emp} manager={manager} reports={reports} />
    </div>
  );
}


function OrgChartMini({ emp, manager, reports }) {
  return (
    <div style={{ padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      {manager && (
        <>
          <OrgNode name={manager.NAME} code={manager.EMPLOYEE_CODE} muted />
          <div style={{ width: 2, height: 18, background: "#cbd5e1" }} />
        </>
      )}
      <OrgNode name={emp.NAME} code={emp.EMPLOYEE_CODE} primary />
      {reports.length > 0 && (
        <>
          <div style={{ width: 2, height: 18, background: "#cbd5e1" }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {reports.slice(0, 5).map((r) => (
              <OrgNode key={r.ID} name={r.NAME} code={r.EMPLOYEE_CODE} muted />
            ))}
            {reports.length > 5 && (
              <div style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>
                +{reports.length - 5} more
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function OrgNode({ name, code, primary, muted }) {
  return (
    <div style={{
      padding: "8px 14px",
      borderRadius: 10,
      background: primary ? `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})` : "#f1f5f9",
      color: primary ? "white" : "#475569",
      border: primary ? "none" : "1px solid #e2e8f0",
      textAlign: "center",
      minWidth: 140,
      boxShadow: primary ? "0 6px 14px rgba(200,16,46,0.25)" : "none",
    }}>
      <div style={{ fontSize: 12, fontWeight: 800 }}>{name}</div>
      <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
        {code}
      </div>
    </div>
  );
}


function WorkInfoTab({ emp, departmentName, designationName, manager }) {
  return (
    <div>
      <SectionTitle>Work</SectionTitle>
      <FieldRow label="Department" value={departmentName} />
      <FieldRow label="Job Position" value={designationName} />
      <FieldRow label="Manager" value={manager ? `${manager.NAME} (${manager.EMPLOYEE_CODE})` : "-"} />
      <FieldRow label="Employment Type" value={emp.EMPLOYMENT_TYPE} />
      <FieldRow label="Joining Date" value={fmtDate(emp.JOINING_DATE)} />
      <FieldRow label="Confirmation Date" value={fmtDate(emp.CONFIRMATION_DATE)} />

      <SectionTitle>Location</SectionTitle>
      <FieldRow label="Work Location" value={emp.WORK_LOCATION} />

      <SectionTitle>Schedule</SectionTitle>
      <FieldRow label="Shift Start" value={emp.SHIFT_START} />
      <FieldRow label="Shift End" value={emp.SHIFT_END} />

      <SectionTitle>Skills & qualifications</SectionTitle>
      <FieldRow label="Skills" value={emp.SKILLS} />
      <FieldRow label="Qualification" value={emp.QUALIFICATION} />
      <FieldRow label="Year of passing" value={emp.YEAR_OF_PASSING} />
      <FieldRow label="Experience years" value={emp.EXPERIENCE_YEARS} />
    </div>
  );
}


function PersonalInfoTab({ emp }) {
  return (
    <div>
      <SectionTitle>Personal</SectionTitle>
      <FieldRow label="Date of birth" value={fmtDate(emp.DOB)} />
      <FieldRow label="Gender" value={emp.GENDER} />
      <FieldRow label="Marital status" value={emp.MARITAL_STATUS} />
      <FieldRow label="Blood group" value={emp.BLOOD_GROUP} />
      <FieldRow label="Nationality" value={emp.NATIONALITY} />

      <SectionTitle>Family</SectionTitle>
      <FieldRow label="Father's name" value={emp.FATHER_NAME} />
      <FieldRow label="Mother's name" value={emp.MOTHER_NAME} />

      <SectionTitle>Emergency contact</SectionTitle>
      <FieldRow label="Name" value={emp.EMERGENCY_CONTACT_NAME} />
      <FieldRow label="Phone" value={emp.EMERGENCY_CONTACT_PHONE} />
      <FieldRow label="Relation" value={emp.EMERGENCY_CONTACT_RELATION} />

      <SectionTitle>Address</SectionTitle>
      <FieldRow label="Street" value={emp.ADDRESS} />
      <FieldRow label="City" value={emp.CITY} />
      <FieldRow label="State" value={emp.STATE} />
      <FieldRow label="Pincode" value={emp.PINCODE} />
    </div>
  );
}


// Required document types — must be uploaded for a complete profile.
// Anything uploaded that isn't in this list is shown under "Other".
const REQUIRED_DOC_TYPES = [
  { key: "AADHAAR",       label: "Aadhaar",            group: "Identity" },
  { key: "PAN",           label: "PAN",                group: "Identity" },
  { key: "PHOTO",         label: "Photograph",         group: "Personal" },
  { key: "RESUME",        label: "Resume / CV",        group: "Employment" },
  { key: "OFFER_LETTER",  label: "Offer Letter",       group: "Employment" },
  { key: "BANK_PASSBOOK", label: "Bank Passbook",      group: "Personal"   },
  { key: "ADDRESS_PROOF", label: "Address Proof",      group: "Personal"   },
];

const DOC_TYPE_LABELS = {
  AADHAAR: "Aadhaar",
  PAN: "PAN",
  VOTER_ID: "Voter ID",
  PASSPORT: "Passport",
  DRIVING_LICENSE: "Driving License",
  TENTH_MARKSHEET: "10th Marksheet",
  TWELFTH_MARKSHEET: "12th Marksheet",
  DIPLOMA: "Diploma",
  DEGREE: "Degree",
  POSTGRADUATE: "Post-Graduate",
  EDUCATIONAL: "Educational",
  CERTIFICATE: "Certificate",
  RESUME: "Resume / CV",
  OFFER_LETTER: "Offer Letter",
  JOINING_LETTER: "Joining Letter",
  EXPERIENCE_LETTER: "Experience Letter",
  RELIEVING_LETTER: "Relieving Letter",
  SALARY_SLIP: "Previous Salary Slip",
  PHOTO: "Photograph",
  BIRTH_CERTIFICATE: "Birth Certificate",
  MARRIAGE_CERTIFICATE: "Marriage Certificate",
  ADDRESS_PROOF: "Address Proof",
  BANK_PASSBOOK: "Bank Passbook",
  OTHER: "Other",
};

function fmtBytes(n) {
  if (!n) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function DocumentsTab({ emp }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    API.get(`/employees/${emp.ID}/documents`)
      .then((r) => {
        if (cancelled) return;
        const rows = Array.isArray(r.data) ? r.data : [];
        // Only count ACTIVE docs as "uploaded". Archived/deleted-but-soft
        // docs shouldn't satisfy a required slot.
        setDocs(rows.filter((d) => (d.STATUS || "ACTIVE").toUpperCase() === "ACTIVE"));
        setError("");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.detail || "Failed to load documents");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [emp.ID]);

  // Index docs by DOC_TYPE for quick lookup
  const docsByType = useMemo(() => {
    const m = {};
    for (const d of docs) {
      const k = d.DOC_TYPE;
      if (!m[k]) m[k] = [];
      m[k].push(d);
    }
    return m;
  }, [docs]);

  const requiredKeys = new Set(REQUIRED_DOC_TYPES.map((d) => d.key));
  const extraDocs = docs.filter((d) => !requiredKeys.has(d.DOC_TYPE));

  const uploadedRequired = REQUIRED_DOC_TYPES.filter((d) => docsByType[d.key]?.length > 0);
  const pendingRequired  = REQUIRED_DOC_TYPES.filter((d) => !docsByType[d.key]?.length);

  if (loading) {
    return <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 13 }}>Loading documents...</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 }}>
        {error}
      </div>
    );
  }

  // Empty state — no documents at all
  if (docs.length === 0) {
    return (
      <div>
        <SectionTitle>Documents</SectionTitle>
        <div style={{
          padding: 30,
          textAlign: "center",
          background: "#f8fafc",
          border: "1px dashed #cbd5e1",
          borderRadius: 12,
          marginTop: 8,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            No Documents Uploaded
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            This employee hasn't uploaded any documents yet. All {REQUIRED_DOC_TYPES.length} required
            documents are pending below.
          </div>
        </div>

        <SectionTitle>Pending required documents ({pendingRequired.length})</SectionTitle>
        <DocGrid items={pendingRequired.map((d) => ({ ...d, status: "PENDING" }))} />
      </div>
    );
  }

  return (
    <div>
      {/* Summary row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
        marginBottom: 14,
      }}>
        <SummaryChip label="Uploaded" value={uploadedRequired.length} total={REQUIRED_DOC_TYPES.length}
                     bg="#dcfce7" border="#bbf7d0" fg="#166534" />
        <SummaryChip label="Pending"  value={pendingRequired.length}   total={REQUIRED_DOC_TYPES.length}
                     bg="#fef3c7" border="#fde68a" fg="#92400e" />
        <SummaryChip label="Extra"    value={extraDocs.length}         total={extraDocs.length}
                     bg="#e0e7ff" border="#c7d2fe" fg="#3730a3" />
      </div>

      {/* Uploaded required */}
      {uploadedRequired.length > 0 && (
        <>
          <SectionTitle>Uploaded ({uploadedRequired.length})</SectionTitle>
          <DocGrid items={uploadedRequired.map((d) => {
            const file = docsByType[d.key][0]; // latest upload
            return {
              ...d,
              status: "UPLOADED",
              file,
            };
          })} />
        </>
      )}

      {/* Pending required */}
      {pendingRequired.length > 0 && (
        <>
          <SectionTitle>Pending ({pendingRequired.length})</SectionTitle>
          <DocGrid items={pendingRequired.map((d) => ({ ...d, status: "PENDING" }))} />
        </>
      )}

      {/* Extra (non-required) uploads */}
      {extraDocs.length > 0 && (
        <>
          <SectionTitle>Other uploads ({extraDocs.length})</SectionTitle>
          <DocGrid items={extraDocs.map((d) => ({
            key: d.DOC_TYPE,
            label: DOC_TYPE_LABELS[d.DOC_TYPE] || d.DOC_TYPE,
            group: "Other",
            status: "UPLOADED",
            file: d,
          }))} />
        </>
      )}
    </div>
  );
}

function SummaryChip({ label, value, total, bg, border, fg }) {
  return (
    <div style={{
      padding: 12,
      border: `1px solid ${border}`,
      background: bg,
      borderRadius: 10,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: fg, textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
        {value}{total != null && label !== "Extra" ? <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}> / {total}</span> : null}
      </span>
    </div>
  );
}

function DocGrid({ items }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      gap: 12,
      marginTop: 8,
      marginBottom: 16,
    }}>
      {items.map((d) => <DocCard key={d.key + (d.file?.ID || "")} d={d} />)}
    </div>
  );
}

function DocCard({ d }) {
  const isUploaded = d.status === "UPLOADED";
  const tone = isUploaded
    ? { bg: "#f0fdf4", border: "#bbf7d0", pillBg: "#dcfce7", pillFg: "#166534" }
    : { bg: "#fffbeb", border: "#fde68a", pillBg: "#fef3c7", pillFg: "#92400e" };
  const fileUrl = d.file?.FILE_URL ? `${API_BASE_URL}${d.file.FILE_URL}` : null;

  return (
    <div style={{
      padding: 14,
      border: `1px solid ${tone.border}`,
      borderRadius: 12,
      background: tone.bg,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
            {d.label}
          </div>
          {d.group && (
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>
              {d.group}
            </div>
          )}
        </div>
        <span style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.4,
          background: tone.pillBg,
          color: tone.pillFg,
        }}>
          {d.status}
        </span>
      </div>

      {isUploaded && d.file ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#334155", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
               title={d.file.FILE_NAME}>
            {d.file.FILE_NAME}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
            {fmtBytes(d.file.SIZE_BYTES)}
            {d.file.UPLOADED_AT && <> &middot; {fmtDate(d.file.UPLOADED_AT)}</>}
          </div>
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                marginTop: 8,
                padding: "5px 12px",
                background: "white",
                color: BVC_DARK,
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              View / Download
            </a>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 12, color: "#92400e", fontStyle: "italic" }}>
          Not uploaded yet — required for a complete profile.
        </div>
      )}
    </div>
  );
}


function PayrollTab({ emp, salaryStructure, effectiveSalary }) {
  const s = salaryStructure;
  return (
    <div>
      <SectionTitle>Compensation</SectionTitle>
      <FieldRow label="Monthly salary" value={effectiveSalary > 0 ? inr(effectiveSalary) : "-"} />
      {emp.PREVIOUS_SALARY != null && emp.PREVIOUS_SALARY !== "" && (
        <FieldRow label="Previous salary" value={inr(emp.PREVIOUS_SALARY)} />
      )}

      <SectionTitle>Bank details</SectionTitle>
      <FieldRow label="Bank name" value={emp.BANK_NAME} />
      <FieldRow label="Account number" value={emp.BANK_ACCOUNT_NUMBER} />
      <FieldRow label="IFSC code" value={emp.IFSC_CODE} />

      <SectionTitle>Tax (KYC)</SectionTitle>
      <FieldRow label="PAN" value={emp.PAN_NUMBER} />
      <FieldRow label="Aadhaar" value={emp.AADHAAR_NUMBER} />

      <SectionTitle>Salary structure (CTC)</SectionTitle>
      {s ? (
        <div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 10,
            marginTop: 8,
            marginBottom: 12,
          }}>
            <PayCell label="Basic"           value={s.BASIC} />
            <PayCell label="HRA"             value={s.HRA} />
            <PayCell label="DA"              value={s.DA} />
            <PayCell label="Conveyance"      value={s.CONVEYANCE_ALLOWANCE} />
            <PayCell label="Medical"         value={s.MEDICAL_ALLOWANCE} />
            <PayCell label="Special"         value={s.SPECIAL_ALLOWANCE} />
            <PayCell label="Other"           value={s.OTHER_ALLOWANCES} />
            <PayCell label="Annual bonus"    value={s.ANNUAL_BONUS} />
            <PayCell label="Incentives"      value={s.INCENTIVES} />
          </div>
          <div style={{
            padding: 12,
            background: "#fef9c3",
            border: "1px solid #fde68a",
            borderRadius: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: "#854d0e", textTransform: "uppercase" }}>
              Gross monthly
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              {inr(s.GROSS_MONTHLY)}
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
            PF: <strong>{s.PF_APPLICABLE ? "Applicable" : "Not applicable"}</strong>
            {" · "}
            ESI: <strong>{s.ESI_APPLICABLE ? "Applicable" : "Not applicable"}</strong>
            {s.PT_STATE && <> {" · "} PT state: <strong>{s.PT_STATE}</strong></>}
          </div>
        </div>
      ) : (
        <div style={{
          padding: 14,
          background: "#f8fafc",
          border: "1px dashed #cbd5e1",
          borderRadius: 10,
          fontSize: 13,
          color: "#64748b",
        }}>
          No CTC structure on file yet. Add one from the Employee form
          (Salary section) — the gross monthly will appear here.
        </div>
      )}
    </div>
  );
}

function PayCell({ label, value }) {
  return (
    <div style={{
      padding: 10,
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      background: "#f8fafc",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 0.6, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
        {value != null && Number(value) > 0 ? inr(value) : "-"}
      </div>
    </div>
  );
}


function AssetsTab({ emp, assets }) {
  const active = (assets || []).filter((a) => (a.status || "").toUpperCase() === "ISSUED");
  const returned = (assets || []).filter((a) => (a.status || "").toUpperCase() !== "ISSUED");

  return (
    <div>
      <SectionTitle>Allocated assets ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <div style={{ padding: 14, color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
          No assets currently allocated to this employee.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
          marginTop: 8,
        }}>
          {active.map((a) => (
            <AssetCard key={a.id} asset={a} />
          ))}
        </div>
      )}

      {returned.length > 0 && (
        <>
          <SectionTitle>History ({returned.length})</SectionTitle>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
            marginTop: 8,
          }}>
            {returned.map((a) => (
              <AssetCard key={a.id} asset={a} muted />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AssetCard({ asset, muted }) {
  const status = (asset.status || "").toUpperCase();
  const tone = status === "ISSUED"
    ? { bg: "#dcfce7", fg: "#166534" }
    : status === "RETURNED"
      ? { bg: "#e2e8f0", fg: "#334155" }
      : { bg: "#fee2e2", fg: "#991b1b" };
  const initial = (asset.asset_name || "?").charAt(0).toUpperCase();
  return (
    <div style={{
      padding: 14,
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      background: muted ? "#f8fafc" : "white",
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      opacity: muted ? 0.85 : 1,
    }}>
      <div style={{
        width: 38,
        height: 38,
        borderRadius: 8,
        background: BVC_DARK,
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        flexShrink: 0,
      }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{asset.asset_name}</div>
          <span style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            background: tone.bg,
            color: tone.fg,
            letterSpacing: 0.3,
          }}>
            {status || "-"}
          </span>
        </div>
        {asset.asset_category && (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{asset.asset_category}</div>
        )}
        {asset.serial_number && (
          <div style={{ fontSize: 11, color: "#475569", marginTop: 6, fontFamily: "monospace" }}>
            SN: {asset.serial_number}
          </div>
        )}
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
          {asset.issued_date && <>Issued {fmtDate(asset.issued_date)}</>}
          {asset.returned_date && <> &middot; Returned {fmtDate(asset.returned_date)}</>}
        </div>
        {asset.notes && (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, fontStyle: "italic" }}>
            {asset.notes}
          </div>
        )}
      </div>
    </div>
  );
}


function LeaveTab({ emp, leaveBalance }) {
  // Backend returns { employee: {...}, balance: { CASUAL, SICK, EARNED,
  // MATERNITY } }. Each bucket is { total, used, carryover, remaining }.
  const balance = leaveBalance?.balance || null;
  const buckets = [
    { key: "CASUAL",    label: "Casual",    fg: "#1e40af", bg: "#dbeafe" },
    { key: "SICK",      label: "Sick",      fg: "#9a3412", bg: "#ffedd5" },
    { key: "EARNED",    label: "Earned",    fg: "#166534", bg: "#dcfce7" },
    { key: "MATERNITY", label: "Maternity", fg: "#86198f", bg: "#fae8ff" },
  ];

  const totalAvail = balance
    ? buckets.reduce((s, b) => s + (balance[b.key]?.remaining || 0), 0)
    : 0;
  const totalUsed = balance
    ? buckets.reduce((s, b) => s + (balance[b.key]?.used || 0), 0)
    : 0;

  return (
    <div>
      <SectionTitle>Leave balance &middot; {leaveBalance?.balance?.YEAR || new Date().getFullYear()}</SectionTitle>
      {!balance ? (
        <div style={{ padding: 14, color: "#94a3b8", fontStyle: "italic", fontSize: 13 }}>
          No leave balance on file yet.
        </div>
      ) : (
        <>
          {/* Summary chips */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10,
            marginBottom: 12,
          }}>
            <div style={{
              padding: 12, border: "1px solid #d1fae5", background: "#ecfdf5",
              borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "#065f46", textTransform: "uppercase" }}>
                Available
              </span>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{totalAvail}</span>
            </div>
            <div style={{
              padding: 12, border: "1px solid #e2e8f0", background: "#f8fafc",
              borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "#475569", textTransform: "uppercase" }}>
                Used
              </span>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{totalUsed}</span>
            </div>
          </div>

          {/* Per-type grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 10,
          }}>
            {buckets.map((b) => {
              const data = balance[b.key] || { total: 0, used: 0, carryover: 0, remaining: 0 };
              const totalPool = (data.total || 0) + (data.carryover || 0);
              const pctUsed = totalPool > 0 ? Math.min(100, Math.round((data.used / totalPool) * 100)) : 0;
              return (
                <div key={b.key} style={{
                  padding: 12,
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  background: "white",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: 8,
                  }}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px", borderRadius: 999,
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                      background: b.bg, color: b.fg, textTransform: "uppercase",
                    }}>
                      {b.label}
                    </span>
                    <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                      {data.used} / {totalPool}
                    </span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
                    {data.remaining}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, fontWeight: 600, letterSpacing: 0.3 }}>
                    REMAINING
                  </div>
                  <div style={{
                    height: 6, background: "#f1f5f9", borderRadius: 999, marginTop: 8, overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${pctUsed}%`, height: "100%",
                      background: pctUsed > 80 ? "#ef4444" : pctUsed > 50 ? "#f59e0b" : "#10b981",
                      transition: "width 0.3s",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}


function AttendanceTab({ emp }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    API.get("/attendance", { params: { employee_id: emp.ID, limit: 500 } })
      .then((r) => {
        if (cancelled) return;
        // Endpoint now returns envelope { total, limit, offset, rows }.
        // Fall back to a raw array for older responses.
        const rows = Array.isArray(r.data?.rows)
          ? r.data.rows
          : Array.isArray(r.data)
            ? r.data
            : [];
        setRecords(rows);
        setError("");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.detail || "Failed to load attendance");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [emp.ID]);

  // Stats for the current calendar month
  const stats = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthRows = records.filter((r) => (r.DATE || "").startsWith(ym));
    const present = monthRows.filter((r) => r.STATUS === "PRESENT").length;
    const late = monthRows.filter((r) => r.STATUS === "LATE").length;
    const absent = monthRows.filter((r) => r.STATUS === "ABSENT").length;
    const hours = monthRows.reduce((s, r) => s + (Number(r.WORKED_HOURS) || 0), 0);
    const otHours = monthRows.reduce((s, r) => s + (Number(r.OVERTIME_HOURS) || 0), 0);
    return { present, late, absent, hours, otHours, monthLabel: now.toLocaleString("default", { month: "long", year: "numeric" }) };
  }, [records]);

  const recent = records.slice(0, 30);

  if (loading) {
    return <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 13 }}>Loading attendance...</div>;
  }
  if (error) {
    return <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 }}>{error}</div>;
  }

  return (
    <div>
      <SectionTitle>This month &middot; {stats.monthLabel}</SectionTitle>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10,
        marginTop: 8,
      }}>
        <MetricTile label="Present" value={stats.present} color="#059669" />
        <MetricTile label="Late" value={stats.late} color="#B47900" />
        <MetricTile label="Absent" value={stats.absent} color="#991b1b" />
        <MetricTile label="Hours worked" value={stats.hours.toFixed(1)} sub="hours this month" color="#1d4ed8" />
        <MetricTile label="OT Hours" value={stats.otHours.toFixed(1)} sub="overtime this month" color="#7c3aed" />
      </div>

      <SectionTitle>Recent records ({recent.length})</SectionTitle>
      {recent.length === 0 ? (
        <div style={{ padding: 14, color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
          No attendance records yet for this employee.
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", fontSize: 10, letterSpacing: 0.8, color: "#64748b", textTransform: "uppercase" }}>
                <th style={tabTh}>Date</th>
                <th style={tabTh}>Check-in</th>
                <th style={tabTh}>Check-out</th>
                <th style={{ ...tabTh, textAlign: "right" }}>Hours</th>
                <th style={tabTh}>OT In</th>
                <th style={tabTh}>OT Out</th>
                <th style={{ ...tabTh, textAlign: "right" }}>OT Hrs</th>
                <th style={tabTh}>Status</th>
                <th style={tabTh}>Geofence</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={tabTd}>{r.DATE || "-"}</td>
                  <td style={tabTd}>{r.CHECK_IN ? new Date(r.CHECK_IN).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "-"}</td>
                  <td style={tabTd}>{r.CHECK_OUT ? new Date(r.CHECK_OUT).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "-"}</td>
                  <td style={{ ...tabTd, textAlign: "right", fontWeight: 700 }}>{r.WORKED_HOURS != null ? Number(r.WORKED_HOURS).toFixed(1) : "-"}</td>
                  <td style={{ ...tabTd, color: "#7c3aed" }}>{r.OT_CHECK_IN ? new Date(r.OT_CHECK_IN).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "-"}</td>
                  <td style={{ ...tabTd, color: "#7c3aed" }}>{r.OT_CHECK_OUT ? new Date(r.OT_CHECK_OUT).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "-"}</td>
                  <td style={{ ...tabTd, textAlign: "right", fontWeight: 700, color: r.OVERTIME_HOURS > 0 ? "#7c3aed" : "#94a3b8" }}>{r.OVERTIME_HOURS != null && r.OVERTIME_HOURS > 0 ? Number(r.OVERTIME_HOURS).toFixed(1) : "-"}</td>
                  <td style={tabTd}><AttStatusBadge status={r.STATUS} /></td>
                  <td style={{ ...tabTd, fontSize: 11, color: "#64748b" }}>{r.GEOFENCE_STATUS || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function AttStatusBadge({ status }) {
  const m = {
    PRESENT: { bg: "#dcfce7", fg: "#166534" },
    LATE: { bg: "#fef3c7", fg: "#854d0e" },
    ABSENT: { bg: "#fee2e2", fg: "#991b1b" },
  };
  const t = m[status] || { bg: "#f1f5f9", fg: "#475569" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 700,
      background: t.bg,
      color: t.fg,
      letterSpacing: 0.3,
    }}>
      {status || "-"}
    </span>
  );
}


function PerformanceTab({ emp }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    API.get(`/stars/employee/${emp.ID}/history`)
      .then((r) => {
        if (cancelled) return;
        setHistory(r.data?.history || []);
        setError("");
      })
      .catch((e) => {
        if (cancelled) return;
        // 404 just means no score yet — not a real error
        if (e?.response?.status === 404) {
          setHistory([]);
          setError("");
        } else {
          setError(e?.response?.data?.detail || "Failed to load performance");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [emp.ID]);

  const latest = history[history.length - 1] || null;

  // Build a tiny sparkline of OVERALL_STARS from history (max 12 points)
  const trend = history.slice(-12);
  const maxStars = Math.max(5, ...trend.map((s) => Number(s.OVERALL_STARS) || 0));

  if (loading) {
    return <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 13 }}>Loading performance...</div>;
  }
  if (error) {
    return <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 }}>{error}</div>;
  }

  return (
    <div>
      <SectionTitle>Latest score</SectionTitle>
      {!latest ? (
        <div style={{
          padding: 14,
          background: "#f8fafc",
          border: "1px dashed #cbd5e1",
          borderRadius: 10,
          fontSize: 13,
          color: "#64748b",
        }}>
          No performance score computed for this employee yet. The MD computes star scores monthly
          on the Star Performance page.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          marginTop: 8,
        }}>
          <MetricTile
            label="Overall stars"
            value={Number(latest.OVERALL_STARS || 0).toFixed(1) + " / 5"}
            sub={`${latest.PAY_YEAR}-${String(latest.PAY_MONTH).padStart(2, "0")}`}
            color="#B47900"
          />
          <MetricTile
            label="Attendance stars"
            value={Number(latest.ATTENDANCE_STARS || 0).toFixed(1)}
            color="#059669"
          />
          <MetricTile
            label="Task stars"
            value={Number(latest.TASK_STARS || 0).toFixed(1)}
            color="#1d4ed8"
          />
          <MetricTile
            label="Leave stars"
            value={Number(latest.LEAVE_STARS || 0).toFixed(1)}
            color="#7c3aed"
          />
        </div>
      )}

      {trend.length > 1 && (
        <>
          <SectionTitle>Trend (last {trend.length} periods)</SectionTitle>
          <div style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            height: 120,
            padding: "10px 4px",
            background: "#f8fafc",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            marginTop: 8,
          }}>
            {trend.map((s, i) => {
              const v = Number(s.OVERALL_STARS) || 0;
              const h = (v / maxStars) * 100;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{
                    width: "100%",
                    height: `${h}%`,
                    background: `linear-gradient(180deg, ${BVC_RED}, ${BVC_DARK})`,
                    borderRadius: "6px 6px 0 0",
                    minHeight: 4,
                  }} />
                  <div style={{
                    fontSize: 9,
                    color: "#94a3b8",
                    marginTop: 4,
                    fontFamily: "ui-monospace, monospace",
                  }}>
                    {String(s.PAY_MONTH).padStart(2, "0")}/{String(s.PAY_YEAR).slice(2)}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#0f172a" }}>
                    {v.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {latest?.REMARKS && (
        <>
          <SectionTitle>MD remarks</SectionTitle>
          <div style={{
            padding: "10px 14px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            fontSize: 13,
            color: "#7c2d12",
            fontStyle: "italic",
          }}>
            {latest.REMARKS}
          </div>
        </>
      )}
    </div>
  );
}


function ActivityHistoryTab({ emp }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Try by USER_ID first, then by USER_CODE — covers both seeded styles.
    API.get(`/audit-logs?user_id=${emp.ID}&limit=100`)
      .then((r) => {
        if (cancelled) return;
        const list = r.data?.rows || r.data?.logs || r.data || [];
        if (Array.isArray(list) && list.length > 0) {
          setLogs(list);
          setError("");
          return;
        }
        // No matches by USER_ID — fall back to USER_CODE
        return API.get(`/audit-logs?user_code=${encodeURIComponent(emp.EMPLOYEE_CODE)}&limit=100`)
          .then((r2) => {
            if (cancelled) return;
            const list2 = r2.data?.rows || r2.data?.logs || r2.data || [];
            setLogs(Array.isArray(list2) ? list2 : []);
            setError("");
          });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.detail || "Failed to load activity");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [emp.ID, emp.EMPLOYEE_CODE]);

  if (loading) {
    return <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 13 }}>Loading activity...</div>;
  }
  if (error) {
    return <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 }}>{error}</div>;
  }

  return (
    <div>
      <SectionTitle>Recent activity ({logs.length})</SectionTitle>
      {logs.length === 0 ? (
        <div style={{ padding: 14, color: "#94a3b8", fontStyle: "italic", fontSize: 13 }}>
          No audit-log entries yet for this employee.
        </div>
      ) : (
        <div style={{
          marginTop: 8,
          borderLeft: `2px solid ${BVC_RED}`,
          paddingLeft: 14,
        }}>
          {logs.slice(0, 50).map((log) => (
            <ActivityRow key={log.ID} log={log} />
          ))}
          {logs.length > 50 && (
            <div style={{ fontSize: 11, color: "#94a3b8", padding: "10px 0", fontStyle: "italic" }}>
              Showing 50 of {logs.length} entries. Full history available on the Audit Logs page.
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function ActivityRow({ log }) {
  const isFailure = log.STATUS_CODE >= 400;
  const verb = (log.METHOD || "?") + " " + (log.PATH || "");
  const when = log.CREATED_AT
    ? new Date(log.CREATED_AT).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "-";
  return (
    <div style={{
      position: "relative",
      padding: "10px 0 10px 14px",
      borderBottom: "1px solid #f1f5f9",
      fontSize: 13,
    }}>
      <span style={{
        position: "absolute",
        left: -20,
        top: 15,
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: isFailure ? "#dc2626" : BVC_RED,
        border: "2px solid white",
        boxShadow: "0 0 0 1px " + (isFailure ? "#dc2626" : BVC_RED),
      }} />
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 4,
        flexWrap: "wrap",
        gap: 8,
      }}>
        <div style={{
          fontWeight: 700,
          color: "#0f172a",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          wordBreak: "break-all",
        }}>
          {verb}
        </div>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          padding: "1px 8px",
          borderRadius: 999,
          background: isFailure ? "#fee2e2" : "#dcfce7",
          color: isFailure ? "#991b1b" : "#166534",
        }}>
          {log.STATUS_CODE}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span>{when}</span>
        {log.TARGET_TYPE && <span>target: <b>{log.TARGET_TYPE}</b>{log.TARGET_ID ? ` #${log.TARGET_ID}` : ""}</span>}
        {log.IP_ADDRESS && <span style={{ fontFamily: "ui-monospace, monospace" }}>{log.IP_ADDRESS}</span>}
      </div>
    </div>
  );
}


// ---------- shared helpers ----------

function countDocuments(emp) {
  let n = 0;
  if (emp.AADHAAR_NUMBER) n++;
  if (emp.PAN_NUMBER) n++;
  // Passport/Resume/Certs are file-upload (Phase B) — not counted yet
  return n;
}

const tabTh = {
  padding: "8px 10px",
  textAlign: "left",
  fontWeight: 700,
  borderBottom: "1px solid #e2e8f0",
};

const tabTd = {
  padding: "10px 10px",
  verticalAlign: "top",
};
