// =====================================================================
// MyMemosPanel — Employee-side Memo module.
// ---------------------------------------------------------------------
// Employees can VIEW every memo issued to them:
//   • Warning letters
//   • Appreciation / recognition letters
//   • Notices (information, show-cause, etc.)
//
// Full history is maintained (no delete). Employees can acknowledge
// pending memos so HR/admin can see the read receipt.
//
// Backend endpoints:
//   GET  /memos/employee/{employee_id}     — list, newest first
//   POST /memos/{memo_id}/acknowledge      — mark read receipt
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";
import styles from "./MyMemosPanel.module.css";


// Turn a memo's ATTACHMENT_URL into a full URL the browser can open.
// The DB stores paths like "/static/memos/xxxx.pdf" which are served
// by the BACKEND (port 8000). If we just use the relative path, the
// browser resolves it against the FRONTEND (port 4173/5173) — the SPA
// router then matches nothing and bounces the user to the profile
// page. Prepending API_BASE_URL fixes that.
function resolveMemoAsset(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{children}</svg>
);

const I = {
  warn: icon(<><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>, 18),
  applaud: icon(<><path d="M14 9l-3 6h4l-3 6" /><path d="M9 3l2 2" /><path d="M15 3l-2 2" /><path d="M12 1v2" /></>, 18),
  notice: icon(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M9 13h6M9 17h4" /></>, 18),
  paperclip: icon(<path d="M21 12.5L12.5 21a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l7.4-7.4" />, 14),
  check: icon(<path d="M4 12l6 6L20 6" />, 14),
  close: icon(<path d="M18 6L6 18M6 6l12 12" />, 18),
  eye: icon(<><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></>, 14),
  empty: icon(<>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </>, 30),
};


// ------------------------------------------------------------------
// Memo type → visual category
// ------------------------------------------------------------------
//   Warning bucket   → WARNING · DISCIPLINARY · SHOW_CAUSE_NOTICE ·
//                       CUSTOMER_COMPLAINT
//   Appreciation     → APPRECIATION · PERFORMANCE_RECOGNITION
//   Notice           → INFORMATION (and any other unrecognised type)
// ------------------------------------------------------------------

function categoryOf(type) {
  const t = (type || "").toUpperCase();
  if (["WARNING", "DISCIPLINARY", "SHOW_CAUSE_NOTICE",
    "CUSTOMER_COMPLAINT"].includes(t)) return "warning";
  if (["APPRECIATION", "PERFORMANCE_RECOGNITION"].includes(t))
    return "appreciation";
  return "notice";
}

function typeLabel(type) {
  const t = (type || "").toUpperCase();
  const map = {
    WARNING: "Warning letter",
    DISCIPLINARY: "Disciplinary",
    SHOW_CAUSE_NOTICE: "Show-cause notice",
    CUSTOMER_COMPLAINT: "Customer complaint",
    APPRECIATION: "Appreciation letter",
    PERFORMANCE_RECOGNITION: "Performance recognition",
    INFORMATION: "Notice",
  };
  return map[t] || t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) || "Memo";
}

function categoryIcon(category) {
  if (category === "warning") return I.warn;
  if (category === "appreciation") return I.applaud;
  return I.notice;
}

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return String(value); }
}

function fmtDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(value); }
}


// ==================================================================
// Component
// ==================================================================
export default function MyMemosPanel({ employeeId, initialOpenId = null, onInitialOpenConsumed }) {

  const [memos, setMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");     // all | warning | appreciation | notice
  const [openMemo, setOpenMemo] = useState(null);    // the memo shown in the detail modal
  const [ackBusy, setAckBusy] = useState(false);


  // ---- Fetch ----
  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const res = await API.get(`/memos/employee/${encodeURIComponent(employeeId)}`);
      setMemos(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      if (e?.response?.status === 404) {
        setMemos([]);
      } else {
        setError(e?.response?.data?.detail || "Failed to load memos.");
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  // Auto-open a specific memo when arriving from a notification click.
  useEffect(() => {
    if (!initialOpenId || memos.length === 0) return;
    const target = memos.find((m) => m.ID === Number(initialOpenId));
    if (target) {
      setOpenMemo(target);
      onInitialOpenConsumed?.();
    }
  }, [initialOpenId, memos, onInitialOpenConsumed]);


  // ---- Derived ----
  const counts = useMemo(() => {
    const c = { all: memos.length, warning: 0, appreciation: 0, notice: 0 };
    memos.forEach((m) => { c[categoryOf(m.MEMO_TYPE)]++; });
    return c;
  }, [memos]);

  const filtered = useMemo(() => {
    if (filter === "all") return memos;
    return memos.filter((m) => categoryOf(m.MEMO_TYPE) === filter);
  }, [memos, filter]);

  const pendingCount = useMemo(
    () => memos.filter((m) => !m.ACKNOWLEDGED_BY_EMPLOYEE).length,
    [memos]
  );


  // ---- Acknowledge ----
  const acknowledge = useCallback(async (memoId) => {
    setAckBusy(true);
    try {
      await API.post(`/memos/${memoId}/acknowledge`);
      // Optimistically flip the flag
      setMemos((prev) => prev.map((m) =>
        m.ID === memoId
          ? {
            ...m,
            ACKNOWLEDGED_BY_EMPLOYEE: true,
            ACKNOWLEDGED_DATE: new Date().toISOString()
          }
          : m
      ));
      setOpenMemo((prev) =>
        prev && prev.ID === memoId
          ? {
            ...prev, ACKNOWLEDGED_BY_EMPLOYEE: true,
            ACKNOWLEDGED_DATE: new Date().toISOString()
          }
          : prev);
    } catch (e) {
      alert(e?.response?.data?.detail || "Could not acknowledge memo.");
    } finally {
      setAckBusy(false);
    }
  }, []);


  // ==================================================================
  // Render
  // ==================================================================

  const filters = [
    { key: "all", label: "All", count: counts.all },
    { key: "warning", label: "Warnings", count: counts.warning },
    { key: "appreciation", label: "Appreciations", count: counts.appreciation },
    { key: "notice", label: "Notices", count: counts.notice },
  ];

  return (
    <div className={styles.wrap}>

      {/* ---------- Header ---------- */}
      <header className={styles.head}>
        <div className={styles.headTitle}>
          My Memos
          <span className={styles.headCount}>{counts.all}</span>
        </div>
        <div className={styles.headSub}>
          {pendingCount > 0
            ? `${pendingCount} awaiting your acknowledgement · full history preserved, no deletions`
            : "Full history preserved · records cannot be deleted"}
        </div>
      </header>


      {/* ---------- Category filter ---------- */}
      <div className={styles.filters} role="tablist">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`${styles.filterChip} ${filter === f.key ? styles.filterChip_active : ""}`}
            onClick={() => setFilter(f.key)}
          >
            <span>{f.label}</span>
            <span className={styles.filterCount}>{f.count}</span>
          </button>
        ))}
      </div>


      {/* ---------- List ---------- */}
      {loading && (
        <div className={styles.loading}>Loading your memos…</div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>{I.empty}</span>
          <div>
            <div className={styles.emptyTitle}>
              {filter === "all" ? "No memos yet" : `No ${filter} memos`}
            </div>
            <div className={styles.emptyBody}>
              When HR issues a memo, it will appear here permanently.
            </div>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className={styles.list}>
          {filtered.map((m) => (
            <MemoCard
              key={m.ID}
              memo={m}
              onView={() => setOpenMemo(m)}
              onAcknowledge={() => acknowledge(m.ID)}
              ackBusy={ackBusy}
            />
          ))}
        </ul>
      )}


      {/* ---------- Detail modal ---------- */}
      {openMemo && (
        <MemoDetailModal
          memo={openMemo}
          onClose={() => setOpenMemo(null)}
          onAcknowledge={() => acknowledge(openMemo.ID)}
          ackBusy={ackBusy}
        />
      )}
    </div>
  );
}


// ==================================================================
// MemoCard — one row in the list
// ==================================================================
function MemoCard({ memo, onView, onAcknowledge, ackBusy }) {

  const cat = categoryOf(memo.MEMO_TYPE);
  const acked = !!memo.ACKNOWLEDGED_BY_EMPLOYEE;

  return (
    <li
      className={`${styles.card} ${styles[`card_${cat}`]}`}
      onClick={onView}
    >
      <div className={styles.cardBadge}>{categoryIcon(cat)}</div>

      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={`${styles.typePill} ${styles[`typePill_${cat}`]}`}>
            {typeLabel(memo.MEMO_TYPE)}
          </span>
          {memo.MEMO_NUMBER && (
            <span className={styles.memoNumber}>{memo.MEMO_NUMBER}</span>
          )}
          <span className={styles.spacer} />
          {acked ? (
            <span className={styles.ackedPill}>
              {I.check}<span>Acknowledged</span>
            </span>
          ) : (
            <span className={styles.pendingPill}>Awaiting your ack.</span>
          )}
        </div>

        <div className={styles.cardTitle}>{memo.SUBJECT || "(no subject)"}</div>

        {memo.DESCRIPTION && (
          <div className={styles.cardDesc}>{memo.DESCRIPTION}</div>
        )}

        <div className={styles.cardMeta}>
          <span>{fmtDate(memo.ISSUE_DATE || memo.CREATED_AT)}</span>
          {memo.ISSUED_BY && (
            <>
              <span className={styles.metaDot}>·</span>
              <span>Issued by {memo.ISSUED_BY}</span>
            </>
          )}
          {memo.ATTACHMENT_URL && (
            <>
              <span className={styles.metaDot}>·</span>
              <a
                className={styles.attach}
                href={resolveMemoAsset(memo.ATTACHMENT_URL)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {I.paperclip}
                <span>Attachment</span>
              </a>
            </>
          )}
        </div>
      </div>

      <div
        className={styles.cardActions}
        onClick={(e) => e.stopPropagation()}
      >
        {!acked && (
          <button
            type="button"
            className={styles.actionBtnPrimary}
            onClick={onAcknowledge}
            disabled={ackBusy}
          >
            {I.check}
            <span>{ackBusy ? "…" : "Acknowledge"}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.actionBtnGhost}
          onClick={onView}
        >
          {I.eye}
          <span>View</span>
        </button>
      </div>
    </li>
  );
}


// ==================================================================
// MemoDetailModal — full read of one memo
// ==================================================================
function MemoDetailModal({ memo, onClose, onAcknowledge, ackBusy }) {

  const cat = categoryOf(memo.MEMO_TYPE);
  const acked = !!memo.ACKNOWLEDGED_BY_EMPLOYEE;

  // ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        <header className={styles.modalHead}>
          <div className={styles.modalTitleWrap}>
            <span className={`${styles.typePill} ${styles[`typePill_${cat}`]}`}>
              {typeLabel(memo.MEMO_TYPE)}
            </span>
            {memo.MEMO_NUMBER && (
              <span className={styles.modalNumber}>{memo.MEMO_NUMBER}</span>
            )}
          </div>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close"
          >
            {I.close}
          </button>
        </header>

        <div className={styles.modalBody}>
          <h2 className={styles.modalSubject}>{memo.SUBJECT || "(no subject)"}</h2>

          <div className={styles.modalMetaGrid}>
            <MetaRow label="Issue date" value={fmtDate(memo.ISSUE_DATE || memo.CREATED_AT)} />
            {memo.ISSUED_BY && <MetaRow label="Issued by" value={memo.ISSUED_BY} />}
            {memo.SEVERITY && <MetaRow label="Severity" value={memo.SEVERITY} />}
            {memo.STATUS && <MetaRow label="Status" value={memo.STATUS} />}
            {acked && memo.ACKNOWLEDGED_DATE && (
              <MetaRow label="Acknowledged" value={fmtDateTime(memo.ACKNOWLEDGED_DATE)} />
            )}
          </div>

          {memo.DESCRIPTION && (
            <div className={styles.modalDesc}>{memo.DESCRIPTION}</div>
          )}

          {memo.REMARKS && (
            <div className={styles.modalRemarks}>
              <div className={styles.modalRemarksLabel}>Remarks</div>
              <div>{memo.REMARKS}</div>
            </div>
          )}

          {memo.ATTACHMENT_URL && (
            <a
              className={styles.modalAttach}
              href={resolveMemoAsset(memo.ATTACHMENT_URL)}
              target="_blank"
              rel="noreferrer"
            >
              {I.paperclip}
              <span>{memo.ATTACHMENT_NAME || "View attachment"}</span>
            </a>
          )}
        </div>

        <footer className={styles.modalFoot}>
          <button
            type="button"
            className={styles.modalBtnGhost}
            onClick={onClose}
          >
            Close
          </button>
          {!acked ? (
            <button
              type="button"
              className={styles.modalBtnPrimary}
              onClick={onAcknowledge}
              disabled={ackBusy}
            >
              {I.check}
              <span>{ackBusy ? "Recording…" : "Acknowledge"}</span>
            </button>
          ) : (
            <span className={styles.ackedPill}>
              {I.check}<span>Acknowledged</span>
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}


function MetaRow({ label, value }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  );
}
