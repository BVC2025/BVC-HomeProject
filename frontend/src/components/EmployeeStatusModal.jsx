// =====================================================================
// EmployeeStatusModal — HR-only employee lifecycle status changer.
//
// Opens from the EmployeeProfile page. Fetches the allowed-transitions
// DAG from the backend so the dropdown only shows legal next-statuses
// for the employee's current state, and renders the full audit trail
// inline so HR can see every prior change.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import API from "../services/api";

const BVC_RED   = "#C8102E";
const BVC_DARK  = "#7A1022";
const BVC_TEXT  = "#0f172a";
const BVC_MUTED = "#64748b";
const BVC_LINE  = "#e2e8f0";
const BVC_BG    = "#fafbfc";

const STATUS_COLORS = {
  ACTIVE:        { fg: "#166534", bg: "#dcfce7" },
  ON_NOTICE:     { fg: "#92400e", bg: "#fef3c7" },
  RESIGNED:      { fg: "#475569", bg: "#e2e8f0" },
  TERMINATED:    { fg: "#991b1b", bg: "#fee2e2" },
  RETIRED:       { fg: "#1e40af", bg: "#dbeafe" },
  ON_LEAVE_LONG: { fg: "#6b21a8", bg: "#f3e8ff" },
};

const STATUS_LABELS = {
  ACTIVE:        "Active",
  ON_NOTICE:     "On Notice",
  RESIGNED:      "Resigned",
  TERMINATED:    "Terminated",
  RETIRED:       "Retired",
  ON_LEAVE_LONG: "On Long Leave",
};


export default function EmployeeStatusModal({ employee, onClose, onSaved }) {

  const [allowed, setAllowed] = useState({ statuses: [], transitions: {} });
  const [history, setHistory] = useState([]);
  const [newStatus, setNewStatus] = useState("");
  const [reason, setReason]   = useState("");
  const [effDate, setEffDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");

  const currentStatus = (employee?.STATUS || "ACTIVE").toUpperCase();

  // ---- Load the lifecycle DAG + audit history ----
  const load = useCallback(async () => {
    if (!employee?.ID) return;
    try {
      const [t, h] = await Promise.all([
        API.get("/employees/status/allowed-transitions"),
        API.get(`/employees/${employee.ID}/status-history`),
      ]);
      setAllowed(t.data || { statuses: [], transitions: {} });
      setHistory(h.data || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load status info");
    }
  }, [employee?.ID]);

  useEffect(() => { load(); }, [load]);

  // ---- Allowed next statuses for the current one ----
  const nextOptions = allowed.transitions?.[currentStatus] || [];

  // ---- Submit ----
  const submit = async () => {
    if (busy) return;
    if (!newStatus) {
      setError("Pick a new status.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    setBusy(true); setError("");
    try {
      await API.patch(`/employees/${employee.ID}/status`, {
        new_status: newStatus,
        reason: reason.trim(),
        effective_date: effDate,
        notes: notes.trim() || null,
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to change status");
    } finally {
      setBusy(false);
    }
  };

  if (!employee) return null;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
      backdropFilter: "blur(2px)", zIndex: 2000,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "white", borderRadius: 16, width: "100%", maxWidth: 720,
        maxHeight: "92dvh", display: "flex", flexDirection: "column",
        overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
      }}>

        {/* ===== Header ===== */}
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", padding: "16px 22px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
              EMPLOYEE LIFECYCLE
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
              Change Status — {employee.NAME}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.18)", color: "white", border: "none",
            padding: "6px 12px", borderRadius: 6, fontSize: 13, fontWeight: 800,
            cursor: "pointer",
          }}>× Close</button>
        </div>

        {/* ===== Body (scrollable) ===== */}
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>

          {/* Current status banner */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: BVC_BG, padding: "12px 14px",
            borderRadius: 10, marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, color: BVC_MUTED, fontWeight: 700 }}>
              Current status:
            </div>
            <StatusPill status={currentStatus} />
            <div style={{ fontSize: 12, color: BVC_MUTED, marginLeft: "auto" }}>
              {employee.EMPLOYEE_CODE}
            </div>
          </div>

          {/* New status selector */}
          {nextOptions.length === 0 ? (
            <div style={{
              padding: "10px 14px", background: "#fef3c7",
              border: "1px solid #fde68a", borderRadius: 8, fontSize: 13,
              color: "#92400e", marginBottom: 14,
            }}>
              No further transitions allowed from <b>{currentStatus}</b>.
            </div>
          ) : (
            <>
              <Field label="New status *">
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">— Select —</option>
                  {nextOptions.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
                  ))}
                </select>
              </Field>

              <Field label="Reason *  (required, min 3 chars)">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Submitted resignation letter on 2026-06-24"
                  style={inputStyle}
                />
              </Field>

              <Field label="Effective date">
                <input
                  type="date"
                  value={effDate}
                  onChange={(e) => setEffDate(e.target.value)}
                  style={inputStyle}
                />
              </Field>

              <Field label="Notes  (optional)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional context HR should preserve…"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </Field>

              {error && (
                <div style={{
                  padding: "9px 12px", background: "#fef2f2",
                  border: "1px solid #fecaca", borderRadius: 8,
                  color: "#991b1b", fontSize: 13, marginBottom: 12,
                }}>{error}</div>
              )}
            </>
          )}

          {/* ===== History panel ===== */}
          <div style={{
            marginTop: 18, paddingTop: 18,
            borderTop: `1px solid ${BVC_LINE}`,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 1.4,
              color: BVC_MUTED, textTransform: "uppercase", marginBottom: 10,
            }}>
              Status history ({history.length})
            </div>
            {history.length === 0 ? (
              <div style={{
                padding: 14, textAlign: "center", color: BVC_MUTED,
                fontStyle: "italic", fontSize: 13,
              }}>
                No prior status changes recorded.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((h) => (
                  <HistoryRow key={h.id} row={h} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ===== Footer ===== */}
        <div style={{
          padding: "14px 22px", borderTop: `1px solid ${BVC_LINE}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button
            onClick={submit}
            disabled={busy || nextOptions.length === 0}
            style={btnPrimary(busy || nextOptions.length === 0)}
          >
            {busy ? "Saving…" : "Save Change"}
          </button>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Atoms
// =====================================================================

function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || { fg: BVC_TEXT, bg: BVC_LINE };
  return (
    <span style={{
      background: c.bg, color: c.fg,
      padding: "4px 12px", borderRadius: 999,
      fontSize: 12, fontWeight: 800, letterSpacing: 0.4,
    }}>{STATUS_LABELS[status] || status}</span>
  );
}

function HistoryRow({ row }) {
  return (
    <div style={{
      background: BVC_BG, border: `1px solid ${BVC_LINE}`,
      borderRadius: 10, padding: "10px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8,
                    flexWrap: "wrap", marginBottom: 4 }}>
        {row.old_status && <StatusPill status={row.old_status} />}
        <span style={{ color: BVC_MUTED, fontSize: 14 }}>→</span>
        <StatusPill status={row.new_status} />
        <span style={{ marginLeft: "auto", fontSize: 11, color: BVC_MUTED }}>
          {new Date(row.changed_at).toLocaleString()}
        </span>
      </div>
      <div style={{ fontSize: 13, color: BVC_TEXT, marginTop: 2 }}>
        <b>Reason:</b> {row.reason}
      </div>
      {row.notes && (
        <div style={{ fontSize: 12, color: BVC_MUTED, marginTop: 4 }}>
          <b>Notes:</b> {row.notes}
        </div>
      )}
      <div style={{ fontSize: 11, color: BVC_MUTED, marginTop: 4 }}>
        Effective {row.effective_date}
        {row.changed_by_name && ` · by ${row.changed_by_name}`}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: "block", fontSize: 12, fontWeight: 700,
        color: BVC_MUTED, marginBottom: 4, letterSpacing: 0.3,
      }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  padding: "9px 12px", border: `1px solid ${BVC_LINE}`,
  borderRadius: 8, fontSize: 14, background: "white", color: BVC_TEXT,
};

const btnSecondary = {
  padding: "9px 16px", background: "white", color: BVC_RED,
  border: `1px solid ${BVC_RED}`, borderRadius: 8,
  fontSize: 13, fontWeight: 700, cursor: "pointer",
};

function btnPrimary(disabled) {
  return {
    padding: "9px 18px", background: disabled ? "#cbd5e1" : BVC_RED,
    color: "white", border: "none", borderRadius: 8,
    fontSize: 13, fontWeight: 800, letterSpacing: 0.4,
    cursor: disabled ? "default" : "pointer",
    textTransform: "uppercase",
  };
}
