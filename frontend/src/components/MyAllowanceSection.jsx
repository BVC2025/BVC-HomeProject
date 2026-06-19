// =====================================================================
// MyAllowanceSection — Employee Portal -> Allowance tab.
//
// Employee submits office-related expense claims (travel, food, fuel
// etc.) for MD approval. Shows the submit form + history of past
// claims with status badges.
// =====================================================================

import { useEffect, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_GOLD = "#F4B324";


const CATEGORIES = [
  { value: "TRAVEL",          label: "Travel" },
  { value: "FOOD",            label: "Food" },
  { value: "ACCOMMODATION",   label: "Accommodation" },
  { value: "OFFICE_SUPPLIES", label: "Office supplies" },
  { value: "FUEL",            label: "Fuel" },
  { value: "COMMUNICATION",   label: "Communication" },
  { value: "CLIENT_MEETING",  label: "Client meeting" },
  { value: "TRAINING",        label: "Training" },
  { value: "OTHER",           label: "Other" },
];


const STATUS_THEME = {
  PENDING:  { bg: "#fef3c7", fg: "#854d0e", label: "PENDING" },
  APPROVED: { bg: "#dcfce7", fg: "#166534", label: "APPROVED" },
  REJECTED: { bg: "#fee2e2", fg: "#991b1b", label: "REJECTED" },
};


function StatusPill({ status }) {
  const t = STATUS_THEME[status] || STATUS_THEME.PENDING;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 800,
        background: t.bg,
        color: t.fg,
        letterSpacing: 0.5,
      }}
    >
      {t.label}
    </span>
  );
}


function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}


export default function MyAllowanceSection({ employeeId }) {

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [form, setForm] = useState({
    CATEGORY: "TRAVEL",
    AMOUNT: "",
    EXPENSE_DATE: new Date().toISOString().slice(0, 10),
    DESCRIPTION: "",
  });

  const [submitting, setSubmitting] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const load = async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        API.get(`/allowances?employee_id=${encodeURIComponent(employeeId)}`),
        API.get(`/allowances/summary?employee_id=${encodeURIComponent(employeeId)}`),
      ]);
      setRows(list.data || []);
      setSummary(sum.data || null);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load allowances.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [employeeId]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.AMOUNT || Number(form.AMOUNT) <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (!form.EXPENSE_DATE) {
      setError("Expense date is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await API.post("/allowances", {
        EMPLOYEE_ID: employeeId,
        CATEGORY: form.CATEGORY,
        AMOUNT: Number(form.AMOUNT),
        EXPENSE_DATE: form.EXPENSE_DATE,
        DESCRIPTION: form.DESCRIPTION || null,
      });
      showToast("Expense submitted. The MD has been notified.");
      setForm({
        CATEGORY: "TRAVEL",
        AMOUNT: "",
        EXPENSE_DATE: new Date().toISOString().slice(0, 10),
        DESCRIPTION: "",
      });
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "9px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "white",
    boxSizing: "border-box",
  };

  const labelStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: "#475569",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 4,
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
        borderRadius: 14,
        padding: "18px 22px",
        color: "white",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 2,
          color: BVC_GOLD, textTransform: "uppercase",
        }}>
          Expense claims
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
          Submit office-related expenses for approval
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
          Travel, food, supplies, fuel and more. The Managing Director receives
          an email the moment you submit.
        </div>
      </div>

      {/* Summary tiles */}
      {summary && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}>
          <Tile label="Total claims"     value={summary.total}     color="#1d4ed8" />
          <Tile label="Pending"          value={summary.pending}   color="#B47900" sub={inr(summary.pending_amount)} />
          <Tile label="Approved"         value={summary.approved}  color="#059669" sub={inr(summary.approved_amount)} />
          <Tile label="Rejected"         value={summary.rejected}  color="#991b1b" />
        </div>
      )}

      {/* Submit form */}
      <form
        onSubmit={submit}
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 18,
        }}
      >
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1.4,
          color: "#0f172a",
          textTransform: "uppercase",
          marginBottom: 12,
        }}>
          New expense
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          marginBottom: 12,
        }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select
              value={form.CATEGORY}
              onChange={(e) => setForm({ ...form, CATEGORY: e.target.value })}
              style={inputStyle}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Amount (&#8377;)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.AMOUNT}
              onChange={(e) => setForm({ ...form, AMOUNT: e.target.value })}
              placeholder="e.g. 1250"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Expense date</label>
            <input
              type="date"
              value={form.EXPENSE_DATE}
              onChange={(e) => setForm({ ...form, EXPENSE_DATE: e.target.value })}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Description</label>
          <textarea
            rows={3}
            value={form.DESCRIPTION}
            onChange={(e) => setForm({ ...form, DESCRIPTION: e.target.value })}
            placeholder="What was the expense for? Who was it with? Where?"
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        {error && (
          <div style={{
            padding: "8px 12px",
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 12,
            marginBottom: 10,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "10px 22px",
              background: submitting ? "#94a3b8" : `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`,
              color: "white",
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 13,
              cursor: submitting ? "wait" : "pointer",
              boxShadow: "0 6px 18px rgba(200,16,46,0.30)",
            }}
          >
            {submitting ? "Submitting..." : "Submit for approval"}
          </button>
        </div>
      </form>

      {/* History */}
      <div style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 18,
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1.4,
          color: "#0f172a",
          textTransform: "uppercase",
          marginBottom: 12,
        }}>
          My submitted claims ({rows.length})
        </div>

        {loading && (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: 12 }}>
            Loading...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{
            color: "#64748b",
            fontSize: 13,
            padding: 14,
            background: "#f8fafc",
            border: "1px dashed #cbd5e1",
            borderRadius: 8,
            textAlign: "center",
          }}>
            No expense claims yet. Submit your first one above.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}>
              <thead>
                <tr style={{
                  background: "#f8fafc",
                  fontSize: 10,
                  letterSpacing: 0.8,
                  color: "#64748b",
                  textTransform: "uppercase",
                }}>
                  <th style={th}>Submitted</th>
                  <th style={th}>Category</th>
                  <th style={th}>Expense date</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                  <th style={th}>Status</th>
                  <th style={th}>Description / reviewer note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={td}>{r.SUBMITTED_AT ? new Date(r.SUBMITTED_AT).toLocaleDateString("en-IN") : "-"}</td>
                    <td style={td}>{r.CATEGORY.replace(/_/g, " ")}</td>
                    <td style={td}>{r.EXPENSE_DATE || "-"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{inr(r.AMOUNT)}</td>
                    <td style={td}><StatusPill status={r.STATUS} /></td>
                    <td style={{ ...td, color: "#475569", fontSize: 12 }}>
                      {r.DESCRIPTION || "-"}
                      {r.REVIEW_NOTES && (
                        <div style={{
                          marginTop: 4,
                          padding: "4px 8px",
                          background: r.STATUS === "REJECTED" ? "#fef2f2" : "#f0fdf4",
                          border: `1px solid ${r.STATUS === "REJECTED" ? "#fecaca" : "#bbf7d0"}`,
                          borderRadius: 6,
                          fontSize: 11,
                          fontStyle: "italic",
                        }}>
                          MD: {r.REVIEW_NOTES}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          background: "#0f172a",
          color: "white",
          padding: "12px 18px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 700,
          boxShadow: "0 12px 36px rgba(0,0,0,0.30)",
          zIndex: 9999,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}


function Tile({ label, value, sub, color }) {
  return (
    <div style={{
      background: "white",
      borderRadius: 12,
      padding: "14px 16px",
      borderTop: `3px solid ${color}`,
      boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        color: "#64748b",
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24,
        fontWeight: 800,
        color: "#0f172a",
        marginTop: 4,
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


const th = {
  padding: "8px 10px",
  textAlign: "left",
  fontWeight: 700,
  borderBottom: "1px solid #e2e8f0",
};

const td = {
  padding: "10px 10px",
  verticalAlign: "top",
};
