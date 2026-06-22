// =====================================================================
// MyPayslipsPanel — Employee Self-Service → Payslips
//
// Lists every monthly payslip for the logged-in employee with:
//   • View (opens PDF in a new browser tab)
//   • Download (saves the PDF to disk)
//   • Print  (opens the PDF and triggers print dialog)
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";

const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8001";


const STATUS_THEME = {
  DRAFT:     { bg: "#fef3c7", fg: "#854d0e" },
  FINALIZED: { bg: "#dbeafe", fg: "#1e40af" },
  PAID:      { bg: "#dcfce7", fg: "#166534" },
};


function StatusPill({ status }) {
  const t = STATUS_THEME[status] || { bg: "#f1f5f9", fg: "#475569" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, background: t.bg, color: t.fg,
      letterSpacing: 0.4,
    }}>
      {status || "—"}
    </span>
  );
}


function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}


export default function MyPayslipsPanel({ employeeId }) {

  const [rows, setRows]         = useState([]);
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [year,  setYear]        = useState("");      // filter by year, empty = all
  const [busyId, setBusyId]     = useState(null);    // slip id with in-flight download

  const load = async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const [list, sum] = await Promise.all([
        API.get(`/my-payslips?employee_id=${encodeURIComponent(employeeId)}`),
        API.get(`/my-payslips/summary?employee_id=${encodeURIComponent(employeeId)}`),
      ]);
      setRows(list.data || []);
      setSummary(sum.data || null);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load payslips.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [employeeId]);

  // ---- Filter / derived ----
  const years = useMemo(() => {
    const set = new Set(rows.map((r) => r.YEAR));
    return Array.from(set).sort((a, b) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    if (!year) return rows;
    return rows.filter((r) => String(r.YEAR) === String(year));
  }, [rows, year]);

  // ---- Actions ----
  const pdfUrl = (slipId) =>
    `${BACKEND_URL}/my-payslips/${slipId}/pdf`;

  const onView = (slipId) => {
    window.open(pdfUrl(slipId), "_blank");
  };

  const onDownload = async (slip) => {
    setBusyId(slip.ID);
    try {
      const res = await API.get(`/my-payslips/${slip.ID}/pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url  = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Payslip-${slip.PAYSLIP_NUMBER}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(e?.response?.data?.detail || "Download failed");
    } finally {
      setBusyId(null);
    }
  };

  const onPrint = (slipId) => {
    // Open the PDF in a new window; the user can use the browser's
    // built-in PDF viewer print button. Inline-disposition makes the
    // browser render it inline so the print toolbar appears.
    const w = window.open(pdfUrl(slipId), "_blank");
    if (w) {
      // Some browsers block window.print() on cross-tab PDFs; we
      // leave the print action to the user's PDF viewer UI which is
      // more reliable.
    }
  };

  // ---- Render ----
  return (
    <div style={{ display: "grid", gap: 16 }}>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
        borderRadius: 14, padding: "18px 22px", color: "white",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 2,
          color: BVC_GOLD, textTransform: "uppercase",
        }}>
          Employee Self-Service
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
          My Payslips
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
          View, download or print any monthly payslip. PDFs are letterhead-quality with full earnings &amp; deductions breakdown.
        </div>
      </div>

      {/* Summary tiles */}
      {summary && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}>
          <Tile label="Total payslips" value={summary.total}            sub="all-time"                 color="#1d4ed8" />
          <Tile label="Latest net pay" value={inr(summary.last_net)}     sub={summary.last_label}        color="#059669" />
          <Tile label={`YTD ${summary.ytd_year}`} value={inr(summary.ytd_net)} sub="net pay this year"  color="#7A1022" />
          <Tile label="Available years" value={years.length || 0}        sub={years.slice(0,3).join(", ") || "—"} color="#B47900" />
        </div>
      )}

      {/* Filter bar */}
      <div style={{
        background: "white", padding: 14, borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569",
                       letterSpacing: 0.5 }}>
          FILTER
        </span>
        <button
          onClick={() => setYear("")}
          style={{
            ...chip,
            background: year === "" ? "#0f172a" : "white",
            color:      year === "" ? "white"   : "#475569",
            border:     year === "" ? "1px solid #0f172a" : "1px solid #e2e8f0",
          }}
        >
          All years
        </button>
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setYear(String(y))}
            style={{
              ...chip,
              background: String(year) === String(y) ? "#0f172a" : "white",
              color:      String(year) === String(y) ? "white"   : "#475569",
              border:     String(year) === String(y) ? "1px solid #0f172a" : "1px solid #e2e8f0",
            }}
          >
            {y}
          </button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {filtered.length} of {rows.length}
        </div>
      </div>

      {/* List */}
      {loading && (
        <div style={{ padding: 30, textAlign: "center", color: "#94a3b8",
                      fontStyle: "italic" }}>
          Loading your payslips...
        </div>
      )}

      {!loading && error && (
        <div style={{
          padding: 14, background: "#fef2f2", color: "#991b1b",
          border: "1px solid #fecaca", borderRadius: 10, fontSize: 13,
        }}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{
          padding: 40, textAlign: "center", color: "#64748b",
          background: "#f8fafc", border: "1px dashed #cbd5e1",
          borderRadius: 12, fontSize: 13,
        }}>
          No payslips yet for this view. New payslips appear here as soon as HR generates them.
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{
          background: "white", borderRadius: 12, overflow: "hidden",
          boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse",
                            fontSize: 13 }}>
              <thead>
                <tr style={{
                  background: "#f8fafc", fontSize: 10,
                  letterSpacing: 0.8, color: "#64748b",
                  textTransform: "uppercase",
                }}>
                  <th style={th}>Period</th>
                  <th style={th}>Payslip #</th>
                  <th style={{ ...th, textAlign: "right" }}>Gross</th>
                  <th style={{ ...th, textAlign: "right" }}>Deductions</th>
                  <th style={{ ...th, textAlign: "right" }}>Net</th>
                  <th style={th}>Days</th>
                  <th style={th}>Status</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={td}>
                      <div style={{ fontWeight: 800, color: "#0f172a" }}>
                        {r.MONTH_NAME}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {r.YEAR}
                      </div>
                    </td>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace",
                                 fontSize: 11, color: "#475569" }}>
                      {r.PAYSLIP_NUMBER}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{inr(r.GROSS_PAY)}</td>
                    <td style={{ ...td, textAlign: "right", color: "#b91c1c" }}>
                      −{inr(r.TOTAL_DEDUCTIONS)}
                    </td>
                    <td style={{ ...td, textAlign: "right",
                                 fontWeight: 800, color: "#166534" }}>
                      {inr(r.NET_PAY)}
                    </td>
                    <td style={td}>
                      <div style={{ fontSize: 12 }}>
                        <b>{r.DAYS_PRESENT}</b> / {r.WORKING_DAYS}
                      </div>
                      {(r.UNPAID_LEAVE_DAYS > 0 || r.DAYS_LATE > 0) && (
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                          {r.DAYS_LATE > 0     ? `${r.DAYS_LATE} late · ` : ""}
                          {r.UNPAID_LEAVE_DAYS > 0 ? `${r.UNPAID_LEAVE_DAYS} LOP` : ""}
                        </div>
                      )}
                    </td>
                    <td style={td}><StatusPill status={r.RUN_STATUS} /></td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button onClick={() => onView(r.ID)}
                                style={btnSecondary}>View</button>
                        <button onClick={() => onDownload(r)}
                                disabled={busyId === r.ID}
                                style={btnPrimary}>
                          {busyId === r.ID ? "..." : "Download"}
                        </button>
                        <button onClick={() => onPrint(r.ID)}
                                style={btnSecondary}>Print</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


function Tile({ label, value, sub, color }) {
  return (
    <div style={{
      background: "white", borderRadius: 12,
      padding: "14px 16px", borderTop: `3px solid ${color}`,
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: "#64748b",
        letterSpacing: 1, textTransform: "uppercase",
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 4,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


const th = { padding: "10px 12px", textAlign: "left",
             fontWeight: 700, borderBottom: "1px solid #e2e8f0" };

const td = { padding: "10px 12px", verticalAlign: "top" };

const chip = {
  padding: "6px 12px", borderRadius: 999, fontSize: 12,
  fontWeight: 700, cursor: "pointer", letterSpacing: 0.2,
};

const btnPrimary = {
  padding: "6px 12px", background: BVC_RED, color: "white",
  border: "none", borderRadius: 6, fontWeight: 800, fontSize: 11,
  cursor: "pointer",
};
const btnSecondary = {
  padding: "6px 12px", background: "white", color: "#475569",
  border: "1px solid #cbd5e1", borderRadius: 6, fontWeight: 700,
  fontSize: 11, cursor: "pointer",
};
