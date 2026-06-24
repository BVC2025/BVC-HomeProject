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

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import API from "../services/api";


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
  { key: "activity", label: "Activity History" },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

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
        ];
        const [depts, desigs, allEmps, lb] = await Promise.all(calls);
        if (cancelled) return;

        setDepartments(depts.data || []);
        setDesignations(desigs.data || []);
        setLeaveBalance(lb?.data || null);

        const all = allEmps.data || [];
        if (e.REPORTING_MANAGER_ID) {
          setManager(all.find((x) => x.ID === e.REPORTING_MANAGER_ID) || null);
        }
        setReports(all.filter((x) => x.REPORTING_MANAGER_ID === e.ID));

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
  }, [id]);

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
        />

        {/* ================ CENTER CONTENT ================ */}
        <div style={{ minWidth: 0 }}>

          {/* Metric tiles */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
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
              value="-"
              sub="this month"
              color="#7c3aed"
              onClick={() => setTab("attendance")}
            />
            <MetricTile
              label="Payroll"
              value={emp.SALARY ? "Set" : "Pending"}
              sub={emp.SALARY ? inr(emp.SALARY) : "no salary"}
              color="#B47900"
              onClick={() => setTab("payroll")}
            />
            <MetricTile
              label="Assets"
              value="0"
              sub="allocated"
              color="#0891b2"
              onClick={() => setTab("assets")}
            />
            <MetricTile
              label="Performance"
              value="-"
              sub="this quarter"
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
            {tab === "payroll" && <PayrollTab emp={emp} />}
            {tab === "assets" && <AssetsTab emp={emp} />}
            {tab === "leave" && <LeaveTab emp={emp} leaveBalance={leaveBalance} />}
            {tab === "attendance" && <AttendanceTab emp={emp} />}
            {tab === "performance" && <PerformanceTab emp={emp} />}
            {tab === "activity" && <ActivityHistoryTab emp={emp} />}
          </div>
        </div>

        {/* AI Agent panel removed from this page.
            To bring it back, paste this inside the grid:
              <AIAgentPanel emp={emp} />
            and switch the grid back to "280px 1fr 360px". */}
      </div>
    </div>
  );
}


// =====================================================================
// LEFT SIDEBAR
// =====================================================================

function LeftSidebar({ emp, photoSrc, departmentName, designationName }) {
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


function DocumentsTab({ emp }) {
  const docs = [
    { key: "AADHAAR_NUMBER", label: "Aadhaar", value: emp.AADHAAR_NUMBER, type: "ID" },
    { key: "PAN_NUMBER", label: "PAN", value: emp.PAN_NUMBER, type: "ID" },
    { key: "PASSPORT", label: "Passport", value: null, type: "ID", stub: true },
    { key: "RESUME", label: "Resume", value: null, type: "FILE", stub: true },
    { key: "EDU_CERT", label: "Educational certificates", value: null, type: "FILE", stub: true },
    { key: "EXP_CERT", label: "Experience certificates", value: null, type: "FILE", stub: true },
  ];

  return (
    <div>
      <SectionTitle>Documents</SectionTitle>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
        marginTop: 10,
      }}>
        {docs.map((d) => (
          <div key={d.key} style={{
            padding: 14,
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            background: d.value ? "#f0fdf4" : "#f8fafc",
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: 1, textTransform: "uppercase" }}>
              {d.label}
            </div>
            <div style={{
              fontSize: 14,
              fontWeight: 700,
              color: d.value ? "#166534" : "#94a3b8",
              marginTop: 6,
              fontFamily: d.value ? "ui-monospace, monospace" : "inherit",
            }}>
              {d.value || (d.stub ? "Upload required" : "Not set")}
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                disabled={d.stub}
                title={d.stub ? "File upload module coming in next phase" : "Edit"}
                style={{
                  padding: "5px 12px",
                  background: d.stub ? "#f1f5f9" : "white",
                  color: d.stub ? "#cbd5e1" : BVC_DARK,
                  border: "1px solid " + (d.stub ? "#e2e8f0" : "#cbd5e1"),
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: d.stub ? "not-allowed" : "pointer",
                }}
              >
                {d.value ? "Update" : (d.stub ? "Upload (Phase B)" : "Add")}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 14,
        padding: 12,
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: 8,
        fontSize: 12,
        color: "#7c2d12",
      }}>
        Aadhaar &amp; PAN numbers above read from existing employee record. File-upload + OCR
        extraction for passport, resume, and certificates ships in Phase B (no DB change needed
        for this page to be useful today).
      </div>
    </div>
  );
}


function PayrollTab({ emp }) {
  return (
    <div>
      <SectionTitle>Compensation</SectionTitle>
      <FieldRow label="Monthly salary" value={inr(emp.SALARY)} />

      <SectionTitle>Bank details</SectionTitle>
      <FieldRow label="Bank name" value={emp.BANK_NAME} />
      <FieldRow label="Account number" value={emp.BANK_ACCOUNT_NUMBER} />
      <FieldRow label="IFSC code" value={emp.IFSC_CODE} />

      <SectionTitle>Tax (KYC)</SectionTitle>
      <FieldRow label="PAN" value={emp.PAN_NUMBER} />
      <FieldRow label="Aadhaar" value={emp.AADHAAR_NUMBER} />

      <SectionTitle>Salary structure &amp; payslips</SectionTitle>
      <div style={{
        padding: 14,
        background: "#f8fafc",
        border: "1px dashed #cbd5e1",
        borderRadius: 10,
        fontSize: 13,
        color: "#64748b",
      }}>
        Detailed earnings/deductions breakdown and downloadable payslips are available on the
        dedicated Payroll page. This tab summarises what's stored on the employee record itself.
      </div>
    </div>
  );
}


function AssetsTab({ emp }) {
  const types = [
    { label: "Laptop", icon: "L" },
    { label: "Mobile", icon: "M" },
    { label: "SIM Card", icon: "S" },
    { label: "Access Card", icon: "A" },
    { label: "ID Card", icon: "I" },
  ];
  return (
    <div>
      <SectionTitle>Allocated assets</SectionTitle>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
        marginTop: 8,
      }}>
        {types.map((t) => (
          <div key={t.label} style={{
            padding: 14,
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            background: "#f8fafc",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: BVC_DARK,
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
            }}>
              {t.icon}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{t.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Not allocated</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 14,
        padding: 12,
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: 8,
        fontSize: 12,
        color: "#7c2d12",
      }}>
        Asset allocation requests will ship as a new (additive) `asset_request` table in Phase B.
        This tab is the catalog of asset types.
      </div>
    </div>
  );
}


function LeaveTab({ emp, leaveBalance }) {
  return (
    <div>
      <SectionTitle>Leave balance</SectionTitle>
      {leaveBalance ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 10,
          marginTop: 8,
        }}>
          {Object.entries(leaveBalance)
            .filter(([k]) => /REMAINING|TOTAL/.test(k))
            .map(([k, v]) => (
              <div key={k} style={{
                padding: 14,
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                background: "#f0fdf4",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", letterSpacing: 0.5 }}>
                  {k.replace(/_/g, " ")}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                  {v ?? "-"}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div style={{ padding: 14, color: "#94a3b8", fontStyle: "italic", fontSize: 13 }}>
          No leave balance on file yet.
        </div>
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
    API.get("/attendance")
      .then((r) => {
        if (cancelled) return;
        const mine = (r.data || []).filter((x) => x.EMPLOYEE_ID === emp.ID);
        setRecords(mine);
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
    return { present, late, absent, hours, monthLabel: now.toLocaleString("default", { month: "long", year: "numeric" }) };
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
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
        marginTop: 8,
      }}>
        <MetricTile label="Present" value={stats.present} color="#059669" />
        <MetricTile label="Late" value={stats.late} color="#B47900" />
        <MetricTile label="Absent" value={stats.absent} color="#991b1b" />
        <MetricTile label="Hours worked" value={stats.hours.toFixed(1)} sub="hours this month" color="#1d4ed8" />
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
