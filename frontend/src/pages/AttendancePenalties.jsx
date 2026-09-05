import { useEffect, useMemo, useState } from "react";
import API from "../services/api";

/* Attendance Penalties admin page.

   Lists auto-generated LOP rows created by the daily 23:00 scheduler
   (late 3x/month + permission > 2h/month). Admin can Approve (payroll
   will deduct) or Waive (row stays for audit but no deduction).

   Kept intentionally in one file with inline styles so no CSS module
   or route surgery is needed to ship. */

const KIND_LABEL = {
  LATE: "3+ Late Arrivals",
  PERMISSION: "Permission > 2h",
};

const STATUS_STYLE = {
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#854d0e", label: "Pending" },
  APPROVED: { bg: "#dcfce7", fg: "#166534", label: "Approved" },
  CANCELLED: { bg: "#f1f5f9", fg: "#475569", label: "Waived" },
};

const KIND_STYLE = {
  LATE: { bg: "#fee2e2", fg: "#b91c1c" },
  PERMISSION: { bg: "#e0e7ff", fg: "#3730a3" },
};

export default function AttendancePenalties() {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("PENDING_APPROVAL");
  const [kindFilter, setKindFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const fetchRows = async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (kindFilter) params.kind = kindFilter;
      const res = await API.get("/attendance-penalties", { params });
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load penalties.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [statusFilter, kindFilter]);

  const runScan = async () => {
    setScanning(true);
    setMessage("");
    setError("");
    try {
      const res = await API.post("/attendance-penalties/scan");
      const s = res.data || {};
      setMessage(
        `Scan complete — ${s.employees_scanned || 0} employees checked, ` +
        `${s.late_penalties_created || 0} new late penalties, ` +
        `${s.permission_penalties_created || 0} new permission penalties ` +
        `(${(s.late_skipped_existing || 0) + (s.permission_skipped_existing || 0)} skipped as already existing).`
      );
      await fetchRows();
      setTimeout(() => setMessage(""), 10000);
    } catch (e) {
      setError(e?.response?.data?.detail || "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const decide = async (row, action) => {
    if (
      action === "waive" &&
      !window.confirm(
        `Waive this ${KIND_LABEL[row.kind] || row.kind} penalty for ` +
        `${row.employee_name}? Payroll will not deduct it. This can't be undone.`
      )
    ) return;

    setBusyId(row.id);
    setMessage("");
    setError("");
    try {
      await API.post(`/attendance-penalties/${row.id}/${action}`);
      setMessage(
        action === "approve"
          ? `Approved — payroll will deduct 0.5 day for ${row.employee_name}.`
          : `Waived — no deduction for ${row.employee_name}.`
      );
      await fetchRows();
      setTimeout(() => setMessage(""), 8001);
    } catch (e) {
      setError(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const S = useMemo(() => ({
    page: {
      padding: "24px 28px 40px 28px",
      maxWidth: 1200,
      margin: "0 auto",
    },
    header: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
      marginBottom: 20,
    },
    title: { margin: 0, fontSize: 22, fontWeight: 700, color: "#dc2626" },
    subtitle: {
      margin: "4px 0 0 0",
      fontSize: 13,
      color: "var(--text-secondary, #6b7280)",
      maxWidth: 720,
      lineHeight: 1.5,
    },
    filters: {
      display: "flex",
      gap: 10,
      alignItems: "center",
      marginBottom: 16,
      flexWrap: "wrap",
    },
    select: {
      padding: "8px 12px",
      borderRadius: 8,
      border: "1px solid var(--border, #d1d5db)",
      background: "var(--card-bg, #ffffff)",
      color: "inherit",
      fontSize: 13,
    },
    scanBtn: {
      padding: "9px 18px",
      borderRadius: 8,
      border: "none",
      background: "#dc2626",
      color: "#ffffff",
      fontWeight: 600,
      fontSize: 13,
      cursor: "pointer",
    },
    banner: (kind) => ({
      padding: "10px 14px",
      borderRadius: 8,
      marginBottom: 12,
      fontSize: 13,
      background: kind === "error" ? "#fef2f2" : "#dcfce7",
      color: kind === "error" ? "#b91c1c" : "#15803d",
      border: `1px solid ${kind === "error" ? "#fecaca" : "#86efac"}`,
    }),
    table: {
      width: "100%",
      borderCollapse: "collapse",
      background: "var(--card-bg, #ffffff)",
      borderRadius: 10,
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      fontSize: 13,
    },
    th: {
      textAlign: "left",
      padding: "12px 16px",
      background: "#f9fafb",
      borderBottom: "1px solid #e5e7eb",
      fontWeight: 600,
      color: "#374151",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    td: {
      padding: "12px 16px",
      borderBottom: "1px solid #f3f4f6",
      color: "var(--text, #1f2937)",
      verticalAlign: "top",
    },
    tag: (style) => ({
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      background: style?.bg || "#e5e7eb",
      color: style?.fg || "#374151",
      whiteSpace: "nowrap",
    }),
    approveBtn: {
      padding: "6px 12px",
      borderRadius: 6,
      border: "none",
      background: "#16a34a",
      color: "#ffffff",
      fontWeight: 600,
      fontSize: 12,
      cursor: "pointer",
      marginRight: 6,
    },
    waiveBtn: {
      padding: "6px 12px",
      borderRadius: 6,
      border: "1px solid #dc2626",
      background: "#ffffff",
      color: "#dc2626",
      fontWeight: 600,
      fontSize: 12,
      cursor: "pointer",
    },
    empty: {
      padding: "40px 20px",
      textAlign: "center",
      color: "var(--text-secondary, #9ca3af)",
      fontSize: 14,
    },
  }), []);

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Attendance Penalties</h1>
          <p style={S.subtitle}>
            Auto-generated half-day LOP entries. The scheduler runs daily at 23:00 IST and
            creates a row when an employee has 3+ late arrivals or more than 2 hours of
            permission in the current calendar month. Rows land as <strong>Pending</strong>
            {" "}until you approve or waive. Waived rows stay for audit but payroll doesn't
            deduct.
          </p>
        </div>
        <button style={S.scanBtn} onClick={runScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Run scan now"}
        </button>
      </div>

      {message && <div style={S.banner("ok")}>{message}</div>}
      {error && <div style={S.banner("error")}>{error}</div>}

      <div style={S.filters}>
        <label style={{ fontSize: 12, color: "#6b7280" }}>Status</label>
        <select
          style={S.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="CANCELLED">Waived</option>
        </select>

        <label style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>Kind</label>
        <select
          style={S.select}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="">Both</option>
          <option value="LATE">3+ Late Arrivals</option>
          <option value="PERMISSION">Permission &gt; 2h</option>
        </select>
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Employee</th>
            <th style={S.th}>Kind</th>
            <th style={S.th}>Trigger date</th>
            <th style={S.th}>Days</th>
            <th style={S.th}>Reason</th>
            <th style={S.th}>Status</th>
            <th style={S.th}>Created</th>
            <th style={S.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan="8" style={S.empty}>Loading…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan="8" style={S.empty}>
                Nothing here. Either the scheduler hasn't found any thresholds crossed
                yet, or every row is already decided.
              </td>
            </tr>
          )}
          {!loading && rows.map((r) => (
            <tr key={r.id}>
              <td style={S.td}>
                <div style={{ fontWeight: 600 }}>{r.employee_name || "—"}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{r.employee_code}</div>
              </td>
              <td style={S.td}>
                <span style={S.tag(KIND_STYLE[r.kind])}>
                  {KIND_LABEL[r.kind] || r.kind}
                </span>
              </td>
              <td style={S.td}>{r.start_date || "—"}</td>
              <td style={S.td}>{r.days}</td>
              <td style={{ ...S.td, maxWidth: 320 }}>
                {r.reason || "—"}
                {r.penalty_key && (
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, fontFamily: "monospace" }}>
                    {r.penalty_key}
                  </div>
                )}
              </td>
              <td style={S.td}>
                <span style={S.tag(STATUS_STYLE[r.status])}>
                  {STATUS_STYLE[r.status]?.label || r.status}
                </span>
              </td>
              <td style={S.td}>
                {r.created_at
                  ? new Date(r.created_at).toLocaleDateString()
                  : "—"}
              </td>
              <td style={S.td}>
                {r.status === "PENDING_APPROVAL" && (
                  <>
                    <button
                      style={S.approveBtn}
                      onClick={() => decide(r, "approve")}
                      disabled={busyId === r.id}
                    >
                      Approve
                    </button>
                    <button
                      style={S.waiveBtn}
                      onClick={() => decide(r, "waive")}
                      disabled={busyId === r.id}
                    >
                      Waive
                    </button>
                  </>
                )}
                {r.status === "APPROVED" && (
                  <button
                    style={S.waiveBtn}
                    onClick={() => decide(r, "waive")}
                    disabled={busyId === r.id}
                  >
                    Waive
                  </button>
                )}
                {r.status === "CANCELLED" && (
                  <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
