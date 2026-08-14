// =====================================================================
// EmployeeStatusModal — HR-only employee lifecycle status changer.
//
// Opens from the EmployeeProfile page. Fetches the allowed-transitions
// DAG from the backend so the dropdown only shows legal next-statuses
// for the employee's current state, and renders the full audit trail
// inline so HR can see every prior change.
//
// Styled to match Employees.jsx's own token recipe (var(--card-bg),
// var(--shadow-md), var(--radius-xl), solid --clr-primary headers, the
// same statusPill tone system) — see EmployeeStatusModal.module.css.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import API from "../services/api";
import styles from "./EmployeeStatusModal.module.css";

const STATUS_TONES = {
  ACTIVE: "success",
  ON_NOTICE: "warning",
  RESIGNED: "muted",
  TERMINATED: "danger",
  RETIRED: "info",
  ON_LEAVE_LONG: "info",
};

const STATUS_LABELS = {
  ACTIVE: "Active",
  ON_NOTICE: "On Notice",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
  RETIRED: "Retired",
  ON_LEAVE_LONG: "On Long Leave",
};


export default function EmployeeStatusModal({ employee, onClose, onSaved }) {

  const [allowed, setAllowed] = useState({ statuses: [], transitions: {} });
  const [history, setHistory] = useState([]);
  const [newStatus, setNewStatus] = useState("");
  const [reason, setReason] = useState("");
  const [effDate, setEffDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>

        {/* ===== Header ===== */}
        <div className={styles.header}>
          <div>
            <div className={styles.headerEyebrow}>Employee Lifecycle</div>
            <div className={styles.headerTitle}>Change Status — {employee.NAME}</div>
          </div>
          <button onClick={onClose} className={styles.closeBtn}>Close</button>
        </div>

        {/* ===== Body (scrollable) ===== */}
        <div className={styles.body}>

          {/* Current status banner */}
          <div className={styles.currentStatusBar}>
            <div className={styles.currentStatusLabel}>Current status:</div>
            <StatusPill status={currentStatus} />
            <div className={styles.currentStatusCode}>{employee.EMPLOYEE_CODE}</div>
          </div>

          {/* New status selector */}
          {nextOptions.length === 0 ? (
            <div className={styles.warningBanner}>
              No further transitions allowed from <b>{currentStatus}</b>.
            </div>
          ) : (
            <>
              <Field label="New status *">
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className={styles.input}
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
                  className={styles.input}
                />
              </Field>

              <Field label="Effective date">
                <input
                  type="date"
                  value={effDate}
                  onChange={(e) => setEffDate(e.target.value)}
                  className={styles.input}
                />
              </Field>

              <Field label="Notes  (optional)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional context HR should preserve…"
                  rows={3}
                  className={`${styles.input} ${styles.textarea}`}
                />
              </Field>

              {error && <div className={styles.errorBanner}>{error}</div>}
            </>
          )}

          {/* ===== History panel ===== */}
          <div className={styles.historySection}>
            <div className={styles.historyTitle}>Status history ({history.length})</div>
            {history.length === 0 ? (
              <div className={styles.historyEmpty}>No prior status changes recorded.</div>
            ) : (
              <div className={styles.historyList}>
                {history.map((h) => (
                  <HistoryRow key={h.id} row={h} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ===== Footer ===== */}
        <div className={styles.footer}>
          <button onClick={onClose} className={styles.btnCancel}>Cancel</button>
          <button
            onClick={submit}
            disabled={busy || nextOptions.length === 0}
            className={styles.btnSave}
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
  const tone = STATUS_TONES[status] || "muted";
  return (
    <span className={styles.statusPill} data-tone={tone}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function HistoryRow({ row }) {
  return (
    <div className={styles.historyRow}>
      <div className={styles.historyRowTop}>
        {row.old_status && <StatusPill status={row.old_status} />}
        <span className={styles.historyArrow}>→</span>
        <StatusPill status={row.new_status} />
        <span className={styles.historyWhen}>
          {new Date(row.changed_at).toLocaleString()}
        </span>
      </div>
      <div className={styles.historyReason}>
        <b>Reason:</b> {row.reason}
      </div>
      {row.notes && (
        <div className={styles.historyNotes}>
          <b>Notes:</b> {row.notes}
        </div>
      )}
      <div className={styles.historyMeta}>
        Effective {row.effective_date}
        {row.changed_by_name && ` · by ${row.changed_by_name}`}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}
