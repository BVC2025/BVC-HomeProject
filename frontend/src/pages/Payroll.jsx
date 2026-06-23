import { useEffect, useMemo, useState } from "react";

import API from "../services/api";
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


function Payroll() {

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

  // ----- Load slips for the selected month --------------------------
  const fetchSlips = async (y, m) => {

    setLoading(true);

    setErrorMsg("");

    try {

      const runs = await API.get(`/payroll/runs?year=${y}`);

      const match = (runs.data || []).find(
        (r) => r.PAY_YEAR === y && r.PAY_MONTH === m
      );

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

  // ----- Generate (or refresh) the run ------------------------------
  const generate = async () => {

    setGenerating(true);

    try {

      await API.post("/payroll/generate", {
        YEAR: year,
        MONTH: month,
        OVERWRITE: true
      });

      await fetchSlips(year, month);

    } catch (err) {

      const detail = err?.response?.data?.detail || "Generation failed.";

      alert(detail);

    } finally {

      setGenerating(false);
    }
  };

  // ----- Mark one employee paid -------------------------------------
  const markPaid = async (slipId) => {

    try {

      const res = await API.patch(`/payroll/slips/${slipId}/mark-paid`);

      const updated = res.data?.slip;

      if (updated) {

        setSlips((prev) =>
          prev.map((s) => (s.ID === updated.ID ? { ...s, ...updated } : s))
        );
      }

    } catch (err) {

      alert(err?.response?.data?.detail || "Could not mark paid.");
    }
  };

  return (

    <div className={styles.page}>

      {/* Hero */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>Finance</div>
          <h1 className={styles.heroTitle}>Payroll</h1>
        </div>
      </div>

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
          {generating
            ? "Generating…"
            : slips.length
              ? "Re-generate"
              : "Generate Payroll"}
        </button>

        <div className={styles.controlsHint}>
          Salary is auto-computed from attendance, approved leaves, and
          permission hours for the selected month.
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>

        {loading && (
          <div className={styles.loadingText}>Loading…</div>
        )}

        {!loading && errorMsg && (
          <div className={styles.errorText}>{errorMsg}</div>
        )}

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
              </div>
              <div className={styles.tableMetaSub}>
                {slips.filter((s) => s.STATUS === "PAID").length} paid ·
                {" "}
                {slips.filter((s) => s.STATUS !== "PAID").length} pending
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

                  const leaveDays =
                    Number(s.PAID_LEAVE_DAYS || 0) +
                    Number(s.UNPAID_LEAVE_DAYS || 0);

                  return (
                    <tr
                      key={s.ID}
                      className={`${styles.tr}${isPaid ? ` ${styles.trPaid}` : ""}`}
                    >
                      <td className={styles.td}>
                        <div className={styles.empName}>{s.EMPLOYEE_NAME || "—"}</div>
                        <div className={styles.empCode}>{s.EMPLOYEE_CODE || ""}</div>
                      </td>

                      <td className={styles.tdRight}>
                        ₹ {inr(s.BASE_SALARY)}
                      </td>

                      <td className={styles.tdCenter}>
                        {s.DAYS_PRESENT ?? 0}
                        <span className={styles.empCode}>
                          {" / "}{s.WORKING_DAYS ?? 26}
                        </span>
                      </td>

                      <td className={styles.tdCenter}>
                        {leaveDays}
                      </td>

                      <td className={styles.tdCenter}>
                        {Number(s.PERMISSION_HOURS || 0).toFixed(1)}h
                      </td>

                      <td className={styles.tdCenter}>
                        <span className={styles.starRating}>
                          {Number(s.PERFORMANCE_STARS || 0).toFixed(1)}★
                        </span>
                      </td>

                      <td className={styles.bonusCell}>
                        ₹ {inr(s.STAR_BONUS)}
                      </td>

                      <td className={styles.netPay}>
                        ₹ {inr(s.NET_PAY)}
                      </td>

                      <td className={styles.tdRight}>
                        {isPaid ? (
                          <span className={styles.paidBadge}>✓ Paid</span>
                        ) : (
                          <button
                            onClick={() => markPaid(s.ID)}
                            className={styles.markPaidBtn}
                          >
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
    </div>
  );
}


// suppress unused var lint — run is fetched but only kept in state for
// potential future use (pay-run header display)
// void run;


export default Payroll;
