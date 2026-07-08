// =====================================================================
// Payroll — unified page (combines old Payroll list + PayslipGenerator).
//
// Calculation rules (per HR spec):
//   • Monthly working days = 26 (fixed)
//   • Per-day rate = base_salary / 26
//   • Up to 1 CASUAL leave/month is paid; extra CL is unpaid
//   • Up to 4 hrs of PERMISSION/month is paid; extra is unpaid (4h = 1 day)
//   • Check-in after 09:15 is counted as Late (informational, no deduction)
//   • Absent days deduct at per-day rate
//   • Increment: HR manually picks ₹500/₹1000/₹1500/₹2000 per employee
//   • Net Salary = Base − Deduction + Increment
//
// Data sources (all server-driven, nothing static):
//   GET  /employees?status=ACTIVE
//   GET  /departments
//   GET  /attendance?employee_id=X&start_date&end_date    (per employee)
//   GET  /leave/all?start_date&end_date&status=APPROVED   (single batch)
//   GET  /payroll/runs?year=YYYY                          → find run for month
//   GET  /payroll/runs/{id}                               → existing slips
//   POST /payroll/generate                                → create/refresh run
//   GET  /payroll/runs/{id}/export.csv                    → Excel export
//   GET  /payroll/runs/{run_id}/slip/{emp_id}/pdf         → single payslip PDF
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";
import styles from "./Payroll.module.css";


const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const WORKING_DAYS  = 26;   // fixed per HR rule
const MAX_PAID_CL   = 1;    // CL paid up to 1/month
const MAX_PAID_PERM = 4;    // permission paid up to 4 hours/month
const HOURS_PER_DAY = 8;    // for converting permission hours to days

// Inline increment choices for HR
const INCREMENT_OPTIONS = [0, 500, 1000, 1500, 2000];


function inr(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  });
}

function inr2(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });
}


// -----------------------------------------------------------------
// MAIN PAGE
// -----------------------------------------------------------------
export default function Payroll() {

  const today = new Date();

  // ----- filters -----
  const [search, setSearch] = useState("");
  const [deptId, setDeptId] = useState("");
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [statusFilter, setStatusFilter] = useState("");

  // ----- data -----
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [salaryStructMap, setSalaryStructMap] = useState({}); // EMP_ID -> GROSS_MONTHLY
  const [run, setRun] = useState(null);
  const [slips, setSlips] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({}); // EMP_ID -> stats
  const [leaveMap, setLeaveMap] = useState({});           // EMP_ID -> stats
  const [increments, setIncrements] = useState({});       // EMP_ID -> chosen ₹ amount
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // ----- bulk selection -----
  const [selected, setSelected] = useState(new Set());

  // ----- row menu -----
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const [summaryFor, setSummaryFor] = useState(null);

  // ----- pagination -----
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const yearOptions = useMemo(() => {
    const yr = today.getFullYear();
    return [yr - 2, yr - 1, yr, yr + 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== initial load: employees + departments + salary structures =====
  // We fetch ALL employees (no status filter) and exclude only those
  // who have been fully offboarded — RESIGNED / TERMINATED — since
  // employees on notice / long leave / inactive still need a payslip
  // for the months they worked.
  //
  // Salary structures (CTC breakdown) are fetched too so the page can
  // show the GROSS_MONTHLY when HR entered the salary as a breakdown
  // (Basic + HRA + DA + …) rather than the single employee.SALARY field.
  useEffect(() => {
    Promise.all([
      API.get("/employees").catch(() => ({ data: [] })),
      API.get("/departments").catch(() => ({ data: [] })),
      API.get("/payroll/salary-structures").catch(() => ({ data: [] })),
    ]).then(([empRes, deptRes, structRes]) => {
      const all = Array.isArray(empRes.data) ? empRes.data : [];
      const payable = all.filter((e) => {
        const s = (e.STATUS || "ACTIVE").toUpperCase();
        return s !== "RESIGNED" && s !== "TERMINATED";
      });
      setEmployees(payable);
      setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);

      // Build a map: EMPLOYEE_ID -> GROSS_MONTHLY from the CTC breakdown.
      // The backend already computes GROSS as the sum of BASIC + HRA + DA +
      // CONVEYANCE + MEDICAL + SPECIAL + OTHER + BONUS + INCENTIVES.
      const structs = Array.isArray(structRes.data) ? structRes.data : [];
      const m = {};
      for (const s of structs) {
        const gross = Number(s.GROSS_MONTHLY || 0);
        if (gross > 0 && s.EMPLOYEE_ID) m[s.EMPLOYEE_ID] = gross;
      }
      setSalaryStructMap(m);
    });
  }, []);

  // ===== month boundaries =====
  const monthBounds = useMemo(() => {
    const y = year;
    const m = String(month).padStart(2, "0");
    const lastDay = new Date(y, month, 0).getDate();
    return {
      start: `${y}-${m}-01`,
      end:   `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // ===== load run + slips for the selected month =====
  const loadRun = async () => {
    setLoading(true);
    try {
      const runsRes = await API.get(`/payroll/runs?year=${year}`);
      const match = (runsRes.data || []).find(
        (r) => r.PAY_YEAR === year && r.PAY_MONTH === month
      );
      if (!match) {
        setRun(null);
        setSlips([]);
      } else {
        const detail = await API.get(`/payroll/runs/${match.ID}`);
        setRun(detail.data?.run || null);
        setSlips(detail.data?.slips || []);
        // Pre-fill increments from saved INCENTIVES (where the increment is stored)
        const map = {};
        for (const s of (detail.data?.slips || [])) {
          if (Number(s.INCENTIVES) > 0) map[s.EMPLOYEE_ID] = Number(s.INCENTIVES);
        }
        setIncrements(map);
      }
    } catch (err) {
      console.log(err);
      setRun(null);
      setSlips([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRun();
    setSelected(new Set());
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // ===== fetch monthly attendance for all employees (parallel) =====
  useEffect(() => {
    if (employees.length === 0) return;
    let cancelled = false;

    // helper — parse a check-in ISO and decide if it counts as Late (after 09:15)
    const isLateByTime = (iso) => {
      if (!iso) return false;
      const d = new Date(iso);
      const mins = d.getHours() * 60 + d.getMinutes();
      return mins > (9 * 60 + 15);  // 09:15 cut-off
    };

    Promise.all(
      employees.map((e) =>
        API.get("/attendance", {
          params: {
            employee_id: e.ID,
            start_date: monthBounds.start,
            end_date:   monthBounds.end,
            limit: 500,
          },
        }).then((r) => {
          const rows = Array.isArray(r.data?.rows)
            ? r.data.rows
            : Array.isArray(r.data) ? r.data : [];
          // PRESENT counts everyone present that day (including those marked LATE)
          const present = rows.filter((x) =>
            x.STATUS === "PRESENT" || x.STATUS === "LATE"
          ).length;
          const absent  = rows.filter((x) => x.STATUS === "ABSENT").length;
          // Late check-in count uses BOTH the STATUS=LATE marker AND the
          // 09:15 time rule on raw CHECK_IN — handles backfilled records
          // where STATUS may not be set correctly.
          const late = rows.filter((x) =>
            x.STATUS === "LATE" || isLateByTime(x.CHECK_IN)
          ).length;
          // Total OT hours this month = sum of OVERTIME_HOURS from each row.
          // Backend computes OVERTIME_HOURS from (OT_CHECK_OUT − OT_CHECK_IN)
          // when an explicit OT session was logged.
          const otHours = rows.reduce(
            (s, x) => s + Math.max(0, Number(x.OVERTIME_HOURS) || 0),
            0
          );
          return [e.ID, { present, absent, late, otHours: Math.round(otHours * 10) / 10 }];
        }).catch(() => [e.ID, { present: 0, absent: 0, late: 0, otHours: 0 }])
      )
    ).then((pairs) => {
      if (cancelled) return;
      const map = {};
      for (const [k, v] of pairs) map[k] = v;
      setAttendanceMap(map);
    });
    return () => { cancelled = true; };
  }, [employees, monthBounds.start, monthBounds.end]);

  // ===== fetch APPROVED leave for the month (one call, group by employee) =====
  useEffect(() => {
    if (employees.length === 0) return;
    let cancelled = false;
    API.get("/leave/all", {
      params: {
        start_date: monthBounds.start,
        end_date:   monthBounds.end,
        status: "APPROVED",
        limit: 1000,
      },
    }).then((r) => {
      if (cancelled) return;
      const rows = Array.isArray(r.data?.rows)
        ? r.data.rows
        : Array.isArray(r.data) ? r.data : [];
      const map = {};
      for (const lr of rows) {
        const id = lr.EMPLOYEE_ID;
        if (!map[id]) {
          map[id] = { clDays: 0, permissionHours: 0, otherUnpaidDays: 0 };
        }
        const t = (lr.LEAVE_TYPE || "").toUpperCase();
        if (t === "CASUAL") {
          map[id].clDays += Number(lr.DAYS || 0);
        } else if (t === "PERMISSION") {
          map[id].permissionHours += Number(lr.DURATION_HOURS || 0);
        } else if (t === "UNPAID" || t === "LOP") {
          map[id].otherUnpaidDays += Number(lr.DAYS || 0);
        }
        // SICK / EARNED / MATERNITY are treated as paid (no deduction)
      }
      setLeaveMap(map);
    }).catch(() => {
      if (!cancelled) setLeaveMap({});
    });
    return () => { cancelled = true; };
  }, [employees, monthBounds.start, monthBounds.end]);

  // ===== build per-employee summary using the HR rules =====
  const allRows = useMemo(() => {
    const slipByEmp = {};
    for (const s of slips) slipByEmp[s.EMPLOYEE_ID] = s;

    return employees.map((e) => {
      const slip = slipByEmp[e.ID];
      const att  = attendanceMap[e.ID] || { present: 0, absent: 0, late: 0, otHours: 0 };
      const lv   = leaveMap[e.ID]     || { clDays: 0, permissionHours: 0, otherUnpaidDays: 0 };

      // Base salary precedence:
      //   1. slip.BASE_SALARY  — locked-in figure after payroll was generated
      //   2. salary_structure.GROSS_MONTHLY — when HR set the CTC breakdown
      //   3. employee.SALARY  — when HR set the simple monthly amount
      const slipBase  = Number(slip?.BASE_SALARY || 0);
      const ctcBase   = Number(salaryStructMap[e.ID] || 0);
      const flatBase  = Number(e.SALARY || 0);
      const base = slipBase > 0 ? slipBase : (ctcBase > 0 ? ctcBase : flatBase);
      const perDay = base / WORKING_DAYS;
      const hourly = perDay / HOURS_PER_DAY;

      // CL: up to 1 paid, extra is unpaid
      const clTotal       = lv.clDays;
      const clPaid        = Math.min(clTotal, MAX_PAID_CL);
      const clUnpaidDays  = Math.max(0, clTotal - MAX_PAID_CL);

      // Permission: up to 4 hrs paid, extra is unpaid
      const permTotalH      = lv.permissionHours;
      const permPaidH       = Math.min(permTotalH, MAX_PAID_PERM);
      const permUnpaidH     = Math.max(0, permTotalH - MAX_PAID_PERM);
      const permUnpaidDays  = permUnpaidH / HOURS_PER_DAY;

      const unpaidDays = att.absent + clUnpaidDays + permUnpaidDays + lv.otherUnpaidDays;
      const deduction  = Math.round(unpaidDays * perDay * 100) / 100;

      // OT pay = ot hours × hourly rate (straight time, no multiplier).
      // Added to the final salary so a worker who put in extra hours
      // earns more this month.
      const otHours = Number(att.otHours || 0);
      const otPay   = Math.round(otHours * hourly * 100) / 100;

      const increment = Number(increments[e.ID] || 0);
      const net = Math.max(0, base - deduction + increment + otPay);

      return {
        emp: e,
        slip,
        base,
        perDay,
        hourly,
        present: att.present,
        absent:  att.absent,
        late:    att.late,
        otHours,
        otPay,
        clTotal,
        clPaid,
        clUnpaidDays,
        permTotalH,
        permPaidH,
        permUnpaidH,
        permUnpaidDays,
        unpaidDays,
        deduction,
        increment,
        net,
        slipStatus: slip?.STATUS || "PENDING",
      };
    });
  }, [employees, slips, attendanceMap, leaveMap, increments, salaryStructMap]);

  // ===== filter =====
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (deptId && r.emp.DEPARTMENT_ID !== Number(deptId)) return false;
      if (statusFilter && r.slipStatus !== statusFilter) return false;
      if (q) {
        const hay = `${r.emp.NAME || ""} ${r.emp.EMPLOYEE_CODE || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, search, deptId, statusFilter]);

  // ===== pagination =====
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  // ===== KPIs (computed from current rows so they always match the table) =====
  const kpis = useMemo(() => {
    const total = employees.length;
    const totalPay = allRows.reduce((s, r) => s + r.net, 0);
    const processed = slips.filter((s) => s.STATUS === "PAID").length;
    const pending = total - processed;
    const pct = total ? (processed / total) * 100 : 0;
    return { total, totalPay, processed, pending, pct };
  }, [employees, slips, allRows]);

  // ===== selection helpers =====
  const allOnPageSelected = pagedRows.length > 0 && pagedRows.every((r) => selected.has(r.emp.ID));
  const togglePageAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pagedRows.forEach((r) => next.delete(r.emp.ID));
      else                   pagedRows.forEach((r) => next.add(r.emp.ID));
      return next;
    });
  };
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ===== actions =====
  const runPayroll = async () => {
    setGenerating(true);
    try {
      // Send the HR-chosen increments so they land in the saved slips.
      // WORKING_DAYS=26 is fixed per HR rule (not derived from holidays).
      await API.post("/payroll/generate", {
        YEAR: year,
        MONTH: month,
        OVERWRITE: true,
        WORKING_DAYS: WORKING_DAYS,
        INCREMENTS_BY_EMPLOYEE: increments,   // backend additive
      });
      await loadRun();
    } catch (err) {
      alert(err?.response?.data?.detail || "Payroll generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const generatePayslipForOne = (empId) => {
    if (!run) { alert("Run payroll for this month first."); return; }
    window.open(`${API_BASE_URL}/payroll/runs/${run.ID}/slip/${empId}/pdf`, "_blank");
  };

  const downloadExcel = () => {
    if (!run) { alert("Run payroll for this month first."); return; }
    window.open(`${API_BASE_URL}/payroll/runs/${run.ID}/export.csv`, "_blank");
  };

  const downloadPdfBulk = () => {
    if (!run) { alert("Run payroll for this month first."); return; }
    const ids = selected.size > 0
      ? [...selected]
      : filteredRows.map((r) => r.emp.ID);
    if (ids.length === 0) { alert("No employees selected."); return; }
    if (ids.length > 5 && !window.confirm(`Open ${ids.length} payslip PDFs in new tabs?`)) return;
    ids.forEach((id) => {
      window.open(`${API_BASE_URL}/payroll/runs/${run.ID}/slip/${id}/pdf`, "_blank");
    });
  };

  const markPaidOne = async (slipId) => {
    try {
      await API.patch(`/payroll/slips/${slipId}/mark-paid`);
      await loadRun();
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not mark paid.");
    }
  };

  const setIncrementFor = (empId, value) => {
    setIncrements((prev) => {
      const next = { ...prev };
      const n = Number(value || 0);
      if (n === 0) delete next[empId];
      else next[empId] = n;
      return next;
    });
  };

  // close row menu on outside click
  useEffect(() => {
    if (openMenuFor === null) return;
    const close = () => setOpenMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuFor]);

  return (
    <div className={styles.page}>

      {/* ===== KPI ROW ===== */}
      <div className={styles.kpiRow}>
        <KpiCard
          label="Total Employees"
          value={kpis.total}
          sub="All Active Employees"
          accent="#2563eb" bg="#dbeafe"
          icon={<IconUsers />}
        />
        <KpiCard
          label="Total Payroll Amount"
          value={`₹ ${inr(kpis.totalPay)}`}
          sub={`${MONTH_NAMES[month - 1]} ${year} Payroll`}
          accent="#16a34a" bg="#dcfce7"
          icon={<IconRupee />}
        />
        <KpiCard
          label="Processed Employees"
          value={kpis.processed}
          sub={`${kpis.pct.toFixed(1)}% Completed`}
          accent="#7c3aed" bg="#ede9fe"
          icon={<IconCheckBox />}
        />
        <KpiCard
          label="Pending Employees"
          value={kpis.pending}
          sub={`${(100 - kpis.pct).toFixed(1)}% Remaining`}
          accent="#f59e0b" bg="#fef3c7"
          icon={<IconClock />}
        />
      </div>

      {/* ===== FILTER BAR ===== */}
      <div className={styles.filterCard}>
        <div className={styles.filterField}>
          <label>Search Employee</label>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}><IconSearch /></span>
            <input
              type="text"
              placeholder="Search by name or employee ID…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className={styles.searchInput}
            />
          </div>
        </div>

        <div className={styles.filterField}>
          <label>Department</label>
          <select
            value={deptId}
            onChange={(e) => { setDeptId(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.ID} value={d.ID}>{d.NAME}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label>Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={styles.filterSelect}
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label>Year</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={styles.filterSelect}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label>Payroll Status</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            <option value="">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="PAID">Paid</option>
          </select>
        </div>

        <button onClick={runPayroll} disabled={generating} className={styles.runBtn}>
          {generating ? "Running…" : <><IconPlay /> Run Payroll</>}
        </button>
      </div>

      {/* Rule helper bar (always visible) */}
      <div className={styles.rulesStrip}>
        <span>Working Days: <strong>{WORKING_DAYS}</strong></span>
        <span>Paid CL: <strong>{MAX_PAID_CL}/month</strong></span>
        <span>Paid Permission: <strong>{MAX_PAID_PERM} hrs/month</strong></span>
        <span>Late cut-off: <strong>09:15</strong></span>
        <span>OT: <strong>hourly rate × hours</strong></span>
        <span>Period: <strong>{MONTH_NAMES[month - 1]} {year}</strong></span>
      </div>

      {/* ===== ACTION ROW ===== */}
      <div className={styles.actionRow}>
        <button
          onClick={() => {
            if (selected.size === 1) generatePayslipForOne([...selected][0]);
            else                     downloadPdfBulk();
          }}
          className={`${styles.actionBtn} ${styles.actionBtnBlue}`}
        >
          <IconDoc /> Generate Payslip
        </button>
        <button onClick={downloadExcel} className={`${styles.actionBtn} ${styles.actionBtnGreen}`}>
          <IconSheet /> Export Excel
        </button>
        <button onClick={downloadPdfBulk} className={`${styles.actionBtn} ${styles.actionBtnRed}`}>
          <IconPdf /> Download PDF
        </button>
      </div>

      {/* ===== TABLE ===== */}
      <div className={styles.tableCard}>
        {loading ? (
          <div className={styles.loadingRow}>Loading…</div>
        ) : pagedRows.length === 0 ? (
          <div className={styles.emptyRow}>No employees match the current filters.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th className={styles.thCheck}>
                    <input type="checkbox" checked={allOnPageSelected} onChange={togglePageAll} />
                  </th>
                  <th className={styles.thEmp}>Employee</th>
                  <th className={styles.thNum}>Base Salary<br /><span className={styles.thMuted}>(₹)</span></th>
                  <th className={`${styles.thNum} ${styles.thPresent}`}>Present<br />Days</th>
                  <th className={`${styles.thNum} ${styles.thAbsent}`}>Absent<br />Days</th>
                  <th className={styles.thNum}>CL<br /><span className={styles.thMuted}>(used / paid)</span></th>
                  <th className={`${styles.thNum} ${styles.thPermission}`}>Permission<br /><span className={styles.thMuted}>(hrs used / 4)</span></th>
                  <th className={styles.thNum}>Late<br />Check-ins</th>
                  <th className={styles.thNum}>OT<br /><span className={styles.thMuted}>(hours)</span></th>
                  <th className={styles.thNum}>Deduction<br /><span className={styles.thMuted}>(₹)</span></th>
                  <th className={styles.thNum}>Increment<br /><span className={styles.thMuted}>(₹)</span></th>
                  <th className={`${styles.thNum} ${styles.thTotal}`}>Total Salary<br /><span className={styles.thMuted}>(₹)</span></th>
                  <th className={styles.thAct} />
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  const isSelected = selected.has(r.emp.ID);
                  const clOver   = r.clUnpaidDays   > 0;
                  const permOver = r.permUnpaidH    > 0;
                  return (
                    <tr key={r.emp.ID} className={isSelected ? styles.trSelected : undefined}>
                      <td className={styles.tdCheck}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(r.emp.ID)} />
                      </td>
                      <td className={styles.tdEmp}>
                        <Avatar emp={r.emp} />
                        <div>
                          <div className={styles.empName}>{r.emp.NAME}</div>
                          <div className={styles.empCode}>{r.emp.EMPLOYEE_CODE}</div>
                        </div>
                      </td>
                      <td className={styles.tdNum}>₹ {inr(r.base)}</td>
                      <td className={styles.tdNum}>
                        <span className={`${styles.pill} ${styles.pillGreen}`}>{r.present}</span>
                      </td>
                      <td className={styles.tdNum}>
                        <span className={`${styles.pill} ${styles.pillRed}`}>{r.absent}</span>
                      </td>
                      <td className={styles.tdNum}>
                        <span className={clOver ? `${styles.pill} ${styles.pillRed}` : styles.pillMuted}>
                          {r.clTotal} / {r.clPaid}
                        </span>
                      </td>
                      <td className={styles.tdNum}>
                        <span className={permOver ? `${styles.pill} ${styles.pillRed}` : `${styles.pill} ${styles.pillAmber}`}>
                          {r.permTotalH.toFixed(1)} / {MAX_PAID_PERM}
                        </span>
                      </td>
                      <td className={styles.tdNum}>{r.late}</td>
                      <td className={styles.tdNum}>
                        {r.otHours > 0 ? (
                          <span title={`OT pay: ₹ ${inr(r.otPay)} (${r.otHours.toFixed(1)} h × ₹ ${inr2(r.hourly)}/h)`}
                                style={{ color: "#7c3aed", fontWeight: 700 }}>
                            {r.otHours.toFixed(1)} h
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td className={`${styles.tdNum} ${r.deduction > 0 ? styles.tdDeduction : ""}`}>
                        {r.deduction > 0 ? `− ₹ ${inr(r.deduction)}` : "—"}
                      </td>
                      <td className={styles.tdNum}>
                        <select
                          value={r.increment}
                          onChange={(e) => setIncrementFor(r.emp.ID, e.target.value)}
                          className={styles.incrementSelect}
                        >
                          {INCREMENT_OPTIONS.map((amt) => (
                            <option key={amt} value={amt}>
                              {amt === 0 ? "— none —" : `₹ ${inr(amt)}`}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`${styles.tdNum} ${styles.tdTotal}`}>₹ {inr(r.net)}</td>
                      <td className={styles.tdAct}>
                        <button
                          className={styles.menuBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuFor(openMenuFor === r.emp.ID ? null : r.emp.ID);
                          }}
                        >⋮</button>
                        {openMenuFor === r.emp.ID && (
                          <div className={styles.rowMenu} onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setSummaryFor(r); setOpenMenuFor(null); }}>
                              View salary summary
                            </button>
                            <button onClick={() => { generatePayslipForOne(r.emp.ID); setOpenMenuFor(null); }}>
                              Download payslip PDF
                            </button>
                            {r.slip && r.slip.STATUS !== "PAID" && (
                              <button onClick={() => { markPaidOne(r.slip.ID); setOpenMenuFor(null); }}>
                                Mark paid
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== PAGINATION ===== */}
      {filteredRows.length > 0 && (
        <div className={styles.pager}>
          <div className={styles.pagerLeft}>
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} entries
          </div>
          <Pagination current={page} total={totalPages} onChange={setPage} />
          <select
            className={styles.pageSizeSelect}
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </div>
      )}

      {/* ===== SALARY SUMMARY MODAL ===== */}
      {summaryFor && (
        <SalarySummaryModal
          row={summaryFor}
          period={`${MONTH_NAMES[month - 1]} ${year}`}
          onClose={() => setSummaryFor(null)}
        />
      )}

    </div>
  );
}


// =====================================================================
// SalarySummaryModal — full calculation breakdown for one employee
// =====================================================================
function SalarySummaryModal({ row, period, onClose }) {
  const r = row;
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalPanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalEyebrow}>Salary Summary · {period}</div>
            <div className={styles.modalTitle}>{r.emp.NAME}</div>
            <div className={styles.modalSub}>{r.emp.EMPLOYEE_CODE} · Base ₹ {inr(r.base)} / month</div>
          </div>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.summaryGrid}>
            <SummaryRow label="Working days (fixed)"        value={WORKING_DAYS} />
            <SummaryRow label="Present days"                value={r.present} />
            <SummaryRow label="Absent days"                 value={r.absent}        warn={r.absent > 0} />
            <SummaryRow label={`CL used (paid up to ${MAX_PAID_CL})`} value={`${r.clTotal} / ${r.clPaid} paid`}
                        warn={r.clUnpaidDays > 0} />
            <SummaryRow label={`Permission used (paid up to ${MAX_PAID_PERM}h)`}
                        value={`${r.permTotalH.toFixed(1)} h / ${r.permPaidH.toFixed(1)} h paid`}
                        warn={r.permUnpaidH > 0} />
            <SummaryRow label="Late check-ins"              value={r.late} />
            <SummaryRow label="OT hours (overtime)"         value={`${r.otHours.toFixed(1)} h`}
                        good={r.otHours > 0} />
            <SummaryRow label="Per-day rate"                value={`₹ ${inr2(r.perDay)}`} />
            <SummaryRow label="Hourly rate"                 value={`₹ ${inr2(r.hourly)}`} />
            <SummaryRow label="Total unpaid days"           value={r.unpaidDays.toFixed(2)} />
          </div>

          <div className={styles.summaryDivider} />

          <div className={styles.summaryGrid}>
            <SummaryRow label="Base salary"                 value={`₹ ${inr(r.base)}`} />
            <SummaryRow label="Deduction (unpaid days)"     value={`− ₹ ${inr(r.deduction)}`}
                        bad />
            <SummaryRow label="Increment (HR selected)"     value={`+ ₹ ${inr(r.increment)}`}
                        good={r.increment > 0} />
            <SummaryRow label="OT pay (overtime × hourly)"  value={`+ ₹ ${inr(r.otPay)}`}
                        good={r.otPay > 0} />
          </div>

          <div className={styles.summaryDivider} />

          <div className={styles.summaryNet}>
            <div className={styles.summaryNetLabel}>Total salary payable</div>
            <div className={styles.summaryNetValue}>₹ {inr(r.net)}</div>
          </div>

          {(r.clUnpaidDays > 0 || r.permUnpaidH > 0) && (
            <div className={styles.summaryNote}>
              ⚠ This employee exceeded the monthly cap on
              {r.clUnpaidDays > 0 && " CL"}
              {r.clUnpaidDays > 0 && r.permUnpaidH > 0 && " /"}
              {r.permUnpaidH > 0 && " permission"}.
              The excess was treated as unpaid leave.
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.modalDoneBtn}>Done</button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, warn, bad, good }) {
  return (
    <div className={styles.summaryRow}>
      <div className={styles.summaryLabel}>{label}</div>
      <div className={
        `${styles.summaryValue} ${warn ? styles.summaryWarn : ""} ${bad ? styles.summaryBad : ""} ${good ? styles.summaryGood : ""}`
      }>{value}</div>
    </div>
  );
}


// =====================================================================
// KPI CARD
// =====================================================================
function KpiCard({ label, value, sub, accent, bg, icon }) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiIcon} style={{ background: bg, color: accent }}>
        {icon}
      </div>
      <div className={styles.kpiBody}>
        <div className={styles.kpiLabel}>{label}</div>
        <div className={styles.kpiValue}>{value}</div>
        <div className={styles.kpiSub}>{sub}</div>
      </div>
    </div>
  );
}


// =====================================================================
// AVATAR
// =====================================================================
function Avatar({ emp }) {
  const photoUrl = emp?.PHOTO_URL
    ? (emp.PHOTO_URL.startsWith("http")
      ? emp.PHOTO_URL
      : `${API_BASE_URL}${emp.PHOTO_URL}`)
    : null;
  const initials = (emp?.NAME || "?")
    .split(/\s+/).slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
  const palette = ["#fee2e2", "#dbeafe", "#dcfce7", "#fef3c7", "#ede9fe", "#fff7ed"];
  const fgPal   = ["#991b1b", "#1e40af", "#166534", "#854d0e", "#5b21b6", "#9a3412"];
  let h = 0;
  for (const ch of (emp?.NAME || "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const idx = Math.abs(h) % palette.length;
  return photoUrl ? (
    <img src={photoUrl} alt="" className={styles.avatarImg} />
  ) : (
    <div className={styles.avatarInitials} style={{ background: palette[idx], color: fgPal[idx] }}>
      {initials}
    </div>
  );
}


// =====================================================================
// PAGINATION
// =====================================================================
function Pagination({ current, total, onChange }) {
  const pages = useMemo(() => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
    if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
    return [1, "…", current - 1, current, current + 1, "…", total];
  }, [current, total]);

  return (
    <div className={styles.pagerCenter}>
      <button className={styles.pagerArrow} disabled={current <= 1} onClick={() => onChange(current - 1)}>‹</button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e-${i}`} className={styles.pagerDots}>…</span>
        ) : (
          <button key={p} className={`${styles.pagerNum} ${p === current ? styles.pagerNumActive : ""}`} onClick={() => onChange(p)}>{p}</button>
        )
      )}
      <button className={styles.pagerArrow} disabled={current >= total} onClick={() => onChange(current + 1)}>›</button>
    </div>
  );
}


// =====================================================================
// ICONS
// =====================================================================
const SVG = (path, more = {}) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...more}>
    {path}
  </svg>
);

const IconUsers = () => SVG(<>
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
  <circle cx="9" cy="7" r="4" />
  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
</>);
const IconRupee = () => SVG(<>
  <path d="M6 3h12" /><path d="M6 8h12" />
  <path d="M6 13l8.5 8" /><path d="M6 13h3a5 5 0 0 0 0-10" />
</>);
const IconCheckBox = () => SVG(<>
  <path d="M9 11l3 3L22 4" />
  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
</>);
const IconClock = () => SVG(<>
  <circle cx="12" cy="12" r="10" />
  <polyline points="12 6 12 12 16 14" />
</>);
const IconSearch = () => SVG(<>
  <circle cx="11" cy="11" r="7" />
  <path d="m21 21-4.3-4.3" />
</>);
const IconPlay = () => SVG(<>
  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
</>);
const IconDoc = () => SVG(<>
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
  <polyline points="14 2 14 8 20 8" />
  <line x1="9" y1="15" x2="15" y2="15" />
</>);
const IconSheet = () => SVG(<>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <line x1="3" y1="9" x2="21" y2="9" />
  <line x1="9" y1="3" x2="9" y2="21" />
</>);
const IconPdf = () => SVG(<>
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
  <polyline points="14 2 14 8 20 8" />
  <path d="M9 13v6" /><path d="M12 13v6" /><path d="M15 13v6" />
</>);
