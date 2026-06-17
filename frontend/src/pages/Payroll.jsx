import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


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

  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [run, setRun]     = useState(null);
  const [slips, setSlips] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg]     = useState("");

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

    <div>

      {/* Hero */}
      <div style={{
        background: "linear-gradient(135deg, #C8102E 0%, #A60F26 50%, #8B0B1F 100%)",
        color: "white",
        padding: "20px 28px",
        borderRadius: 14,
        marginBottom: 22,
        boxShadow: "0 6px 18px rgba(139,11,31,0.18)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: 2,
            color: "#fde047",
            fontWeight: 700,
            textTransform: "uppercase"
          }}>
            Finance
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: "4px 0 0",
            lineHeight: 1.2,
            color: "white",
            letterSpacing: -0.3
          }}>
            Payroll
          </h1>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        background: "white",
        padding: 16,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 18,
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        alignItems: "flex-end"
      }}>
        <div>
          <div style={pickerLabelStyle()}>Month</div>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={pickerStyle()}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={pickerLabelStyle()}>Year</div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={pickerStyle()}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <button
          onClick={generate}
          disabled={generating}
          style={{
            background: generating ? "#cbd5e1" : "#8B0B1F",
            color: "white",
            border: "none",
            padding: "10px 22px",
            borderRadius: 8,
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            cursor: generating ? "default" : "pointer"
          }}
        >
          {generating
            ? "Generating…"
            : slips.length
            ? "Re-generate"
            : "Generate Payroll"}
        </button>

        <div style={{
          fontSize: 11,
          color: "#94a3b8",
          flex: 1,
          minWidth: 200,
          lineHeight: 1.5
        }}>
          Salary is auto-computed from attendance, approved leaves, and
          permission hours for the selected month.
        </div>
      </div>

      {/* Body */}
      <div style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
      }}>

        {loading && (
          <div style={{ color: "#94a3b8", padding: 20 }}>
            Loading…
          </div>
        )}

        {!loading && errorMsg && (
          <div style={{
            color: "#991b1b",
            background: "#fee2e2",
            padding: 12,
            borderRadius: 8,
            fontSize: 13
          }}>
            {errorMsg}
          </div>
        )}

        {!loading && !errorMsg && slips.length === 0 && (
          <div style={{
            padding: 36,
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13
          }}>
            No payroll generated for {MONTH_NAMES[month - 1]} {year} yet.
            Click <strong>Generate Payroll</strong> above.
          </div>
        )}

        {!loading && slips.length > 0 && (
          <>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 10,
              flexWrap: "wrap",
              gap: 8
            }}>
              <div style={{
                fontSize: 13,
                fontWeight: 800,
                color: "#0f172a",
                letterSpacing: 0.3
              }}>
                {MONTH_NAMES[month - 1]} {year} · {slips.length} employees
              </div>

              <div style={{ fontSize: 11, color: "#64748b" }}>
                {slips.filter((s) => s.STATUS === "PAID").length} paid ·
                {" "}
                {slips.filter((s) => s.STATUS !== "PAID").length} pending
              </div>
            </div>

            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13
            }}>
              <thead>
                <tr style={{
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.5
                }}>
                  <th style={th()}>Employee</th>
                  <th style={th("right")}>Base</th>
                  <th style={th("center")}>Present</th>
                  <th style={th("center")}>Leave</th>
                  <th style={th("center")}>Permission</th>
                  <th style={th("center")}>Rating</th>
                  <th style={th("right")}>Bonus</th>
                  <th style={th("right")}>Net Pay</th>
                  <th style={th("right")}>Action</th>
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
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: isPaid ? "#f0fdf4" : "white"
                      }}
                    >
                      <td style={td()}>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>
                          {s.EMPLOYEE_NAME || "—"}
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>
                          {s.EMPLOYEE_CODE || ""}
                        </div>
                      </td>

                      <td style={{ ...td("right"), color: "#0f172a", fontWeight: 700 }}>
                        ₹ {inr(s.BASE_SALARY)}
                      </td>

                      <td style={td("center")}>
                        {s.DAYS_PRESENT ?? 0}
                        <span style={{ color: "#94a3b8" }}>
                          {" / "}{s.WORKING_DAYS ?? 26}
                        </span>
                      </td>

                      <td style={td("center")}>
                        {leaveDays}
                      </td>

                      <td style={td("center")}>
                        {Number(s.PERMISSION_HOURS || 0).toFixed(1)}h
                      </td>

                      <td style={td("center")}>
                        <span style={{ color: "#D4A017", fontWeight: 800 }}>
                          {Number(s.PERFORMANCE_STARS || 0).toFixed(1)}★
                        </span>
                      </td>

                      <td style={{ ...td("right"), color: "#92400e" }}>
                        ₹ {inr(s.STAR_BONUS)}
                      </td>

                      <td style={{ ...td("right"), fontWeight: 800, color: "#065f46" }}>
                        ₹ {inr(s.NET_PAY)}
                      </td>

                      <td style={td("right")}>
                        {isPaid ? (
                          <span style={paidBadgeStyle()}>
                            ✓ Paid
                          </span>
                        ) : (
                          <button
                            onClick={() => markPaid(s.ID)}
                            style={markPaidBtnStyle()}
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


// ---------------- styles ----------------

function pickerLabelStyle() {

  return {
    fontSize: 10,
    color: "#64748b",
    marginBottom: 4,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  };
}


function pickerStyle() {

  return {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    minWidth: 130,
    fontSize: 13,
    background: "white",
    color: "#0f172a"
  };
}


function paidBadgeStyle() {

  return {
    display: "inline-block",
    padding: "5px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    color: "#065f46",
    background: "#d1fae5",
    letterSpacing: 0.4
  };
}


function markPaidBtnStyle() {

  return {
    background: "#8B0B1F",
    color: "white",
    border: "none",
    padding: "6px 14px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    cursor: "pointer"
  };
}


function th(align = "left") {

  return {
    padding: "10px 8px",
    textAlign: align,
    fontWeight: 700,
    borderBottom: "1px solid #e2e8f0"
  };
}


function td(align = "left") {

  return {
    padding: "12px 8px",
    textAlign: align
  };
}


export default Payroll;
