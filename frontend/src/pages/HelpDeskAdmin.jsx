// =====================================================================
// HelpDeskAdmin — admin-side triage for employee-raised tickets.
// ---------------------------------------------------------------------
// Layout, top → bottom:
//   1. Header with title / subtitle
//   2. 5-tile KPI row (Total / Open / In progress / Resolved / Closed)
//   3. Filter bar (search + status + category + priority + sort)
//   4. Ticket table
//   5. Detail modal — description, timeline, assign, status, notes
// Backed by:
//   GET   /helpdesk/admin/stats
//   GET   /helpdesk/admin/list
//   GET   /helpdesk/{id}
//   PATCH /helpdesk/{id}/status
//   PATCH /helpdesk/{id}/assign
//   PATCH /helpdesk/{id}/close
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./HelpDeskAdmin.module.css";


// ---------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------
const icon = (children, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);
const I = {
  ticket:   icon(<>
    <path d="M20 12a3 3 0 0 1 0-6V4H4v2a3 3 0 0 1 0 6 3 3 0 0 1 0 6v2h16v-2a3 3 0 0 1 0-6z" />
    <path d="M13 6v2M13 12v2M13 18v-2" />
  </>, 18),
  search:   icon(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></>),
  close:    icon(<><path d="M18 6L6 18M6 6l12 12" /></>, 18),
  chevron:  icon(<><path d="M9 18l6-6-6-6" /></>, 14),
  view:     icon(<><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></>),
  open:     icon(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></>, 18),
  progress: icon(<>
    <path d="M4 12a8 8 0 0 1 8-8" />
    <path d="M20 12a8 8 0 0 1-8 8" />
    <path d="M12 6l2 2-2 2M12 14l-2 2 2 2" />
  </>, 18),
  resolved: icon(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>, 18),
  closed:   icon(<><rect x="4" y="6" width="16" height="14" rx="2" /><path d="M8 6V4a4 4 0 0 1 8 0v2" /></>, 18),
};


// ---------------------------------------------------------------------
// Enums / options
// ---------------------------------------------------------------------
const CATEGORIES = [
  { key: "COMPLAINT",   label: "Complaint",   short: "Complaint",   tone: "red"    },
  { key: "IT_REQUEST",  label: "IT Request",  short: "IT",          tone: "blue"   },
  { key: "HR_REQUEST",  label: "HR Request",  short: "HR",          tone: "amber"  },
  { key: "MAINTENANCE", label: "Maintenance", short: "Maintenance", tone: "green"  },
  { key: "OTHER",       label: "Other",       short: "Other",       tone: "muted"  },
];
const catOf = (k) =>
  CATEGORIES.find((c) => c.key === (k || "").toUpperCase()) || CATEGORIES[4];

const STATUSES = [
  { key: "OPEN",        label: "Open",        chip: "chip_open"     },
  { key: "IN_PROGRESS", label: "In progress", chip: "chip_progress" },
  { key: "RESOLVED",    label: "Resolved",    chip: "chip_resolved" },
  { key: "CLOSED",      label: "Closed",      chip: "chip_closed"   },
  { key: "REJECTED",    label: "Rejected",    chip: "chip_rejected" },
];
const statusOf = (k) =>
  STATUSES.find((s) => s.key === (k || "OPEN").toUpperCase()) || STATUSES[0];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];


// ---------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return "—"; }
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}


// =====================================================================
// Component
// =====================================================================
export default function HelpDeskAdmin() {

  // ---- Filters ----
  const [q,        setQ]        = useState("");
  const [status,   setStatus]   = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [sort,     setSort]     = useState("newest");
  const [page,     setPage]     = useState(1);
  const pageSize                 = 25;

  // ---- Data ----
  const [stats,   setStats]   = useState(null);
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  // ---- Assignable admins (for the modal dropdown) ----
  const [admins, setAdmins] = useState([]);

  // ---- Detail modal ----
  const [openTicketId, setOpenTicketId] = useState(null);
  const [openTicket,   setOpenTicket]   = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await API.get("/helpdesk/admin/stats");
      setStats(res.data || null);
    } catch { setStats(null); }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await API.get("/helpdesk/admin/list", {
        params: {
          q:        q || undefined,
          status:   status || undefined,
          category: category || undefined,
          priority: priority || undefined,
          sort,
          page,
          page_size: pageSize,
        },
      });
      setRows(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load help desk tickets.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, status, category, priority, sort, page]);

  const loadAdmins = useCallback(async () => {
    try {
      const res = await API.get("/employees", { params: { status: "ACTIVE" } });
      const list = Array.isArray(res.data) ? res.data : [];
      setAdmins(list);
    } catch { setAdmins([]); }
  }, []);

  useEffect(() => { loadStats(); loadAdmins(); }, [loadStats, loadAdmins]);
  useEffect(() => { loadList(); }, [loadList]);

  // Reset to page 1 whenever a filter changes
  useEffect(() => { setPage(1); }, [q, status, category, priority, sort]);

  // Open detail modal — fetch full ticket
  const openDetail = async (ticketId) => {
    setOpenTicketId(ticketId);
    setOpenTicket(null);
    try {
      const res = await API.get(`/helpdesk/${ticketId}`);
      setOpenTicket(res.data || null);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load ticket.");
      setOpenTicketId(null);
    }
  };

  const closeDetail = () => {
    setOpenTicketId(null);
    setOpenTicket(null);
  };

  // Whenever the modal saves, refresh both the row and the stats
  const onTicketUpdated = (updated) => {
    setOpenTicket(updated);
    setRows((prev) => prev.map((r) => (r.ID === updated.ID ? updated : r)));
    loadStats();
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.page}>

      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Help Desk</h1>
          <p className={styles.subtitle}>
            Employee-raised tickets across complaints, IT, HR and maintenance.
            Assign, update status and record resolution notes.
          </p>
        </div>
      </header>

      {/* KPI tiles */}
      <div className={styles.tileRow}>
        <Tile tone="blue"   icon={I.ticket}   label="Total"       value={stats?.total ?? "—"} />
        <Tile tone="red"    icon={I.open}     label="Open"        value={stats?.open ?? "—"} />
        <Tile tone="amber"  icon={I.progress} label="In progress" value={stats?.in_progress ?? "—"} />
        <Tile tone="green"  icon={I.resolved} label="Resolved"    value={stats?.resolved ?? "—"} />
        <Tile tone="muted"  icon={I.closed}   label="Closed"      value={stats?.closed ?? "—"} />
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>{I.search}</span>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search ticket number, subject, employee…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <select className={styles.select}
                value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>

        <select className={styles.select}
                value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        <select className={styles.select}
                value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
          ))}
        </select>

        <select className={styles.select}
                value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="priority">Priority (Urgent → Low)</option>
        </select>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Employee</th>
              <th>Department</th>
              <th>Category</th>
              <th>Subject</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Assigned to</th>
              <th>Created</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan="10" className={styles.tableEmpty}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan="10" className={styles.tableEmpty}>
                No tickets match the current filters.
              </td></tr>
            )}
            {!loading && rows.map((t) => {
              const cat  = catOf(t.CATEGORY);
              const stat = statusOf(t.STATUS);
              return (
                <tr key={t.ID}>
                  <td className={styles.mono}>{t.TICKET_NUMBER}</td>
                  <td>
                    <div className={styles.nameCell}>
                      <span className={styles.empName}>{t.EMPLOYEE_NAME || "—"}</span>
                      {t.EMPLOYEE_CODE && (
                        <span className={styles.empCode}>{t.EMPLOYEE_CODE}</span>
                      )}
                    </div>
                  </td>
                  <td>{t.DEPARTMENT || "—"}</td>
                  <td>
                    <span className={`${styles.catPill} ${styles[`catPill_${cat.tone}`]}`}>
                      {cat.short}
                    </span>
                  </td>
                  <td className={styles.subjectCell}>{t.SUBJECT}</td>
                  <td>
                    <span className={`${styles.priority} ${styles[`priority_${(t.PRIORITY || "MEDIUM").toLowerCase()}`]}`}>
                      {t.PRIORITY || "MEDIUM"}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.chip} ${styles[stat.chip]}`}>
                      {stat.label}
                    </span>
                  </td>
                  <td>{t.ASSIGNED_TO_NAME || <span className={styles.muted}>Unassigned</span>}</td>
                  <td>{fmtDate(t.CREATED_AT)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      title="View / manage"
                      onClick={() => openDetail(t.ID)}
                    >
                      {I.view}<span>Open</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className={styles.pageBar}>
          <span className={styles.pageInfo}>
            Page {page} of {totalPages} · {total} tickets
          </span>
          <div className={styles.pageBtns}>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >Prev</button>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >Next</button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {openTicketId && (
        <TicketDetailModal
          ticketId={openTicketId}
          ticket={openTicket}
          admins={admins}
          onClose={closeDetail}
          onUpdated={onTicketUpdated}
        />
      )}
    </div>
  );
}


// =====================================================================
// KPI Tile
// =====================================================================
function Tile({ tone, icon, label, value }) {
  return (
    <div className={`${styles.tile} ${styles[`tile_${tone}`]}`}>
      <div className={`${styles.tileIcon} ${styles[`tint_${tone}`]}`}>{icon}</div>
      <div className={styles.tileBody}>
        <div className={styles.tileLabel}>{label}</div>
        <div className={styles.tileValue}>{value}</div>
      </div>
    </div>
  );
}


// =====================================================================
// Detail modal — full detail + admin actions
// =====================================================================
function TicketDetailModal({ ticketId, ticket, admins, onClose, onUpdated }) {

  const [newStatus,   setNewStatus]   = useState("");
  const [assigneeId,  setAssigneeId]  = useState("");
  const [resolution,  setResolution]  = useState("");
  const [internal,    setInternal]    = useState("");
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState("");

  useEffect(() => {
    if (!ticket) return;
    setNewStatus(ticket.STATUS || "");
    setAssigneeId(ticket.ASSIGNED_TO_ID || "");
    setResolution(ticket.RESOLUTION_NOTES || "");
    setInternal(ticket.INTERNAL_NOTES || "");
  }, [ticket]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveAll = async () => {
    if (!ticket) return;
    setSaving(true);
    setErr("");
    try {
      const body = {
        STATUS:           newStatus || undefined,
        ASSIGNED_TO_ID:   assigneeId || undefined,
        RESOLUTION_NOTES: resolution,
        INTERNAL_NOTES:   internal,
      };
      const res = await API.patch(`/helpdesk/${ticket.ID}/status`, body);
      onUpdated(res.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const closeTicket = async () => {
    if (!ticket) return;
    setSaving(true);
    setErr("");
    try {
      const res = await API.patch(`/helpdesk/${ticket.ID}/close`, {
        RESOLUTION_NOTES: resolution || undefined,
      });
      onUpdated(res.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Close failed.");
    } finally {
      setSaving(false);
    }
  };

  const cat  = ticket ? catOf(ticket.CATEGORY) : null;
  const stat = ticket ? statusOf(ticket.STATUS) : null;

  const steps = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
  const currentIdx = ticket ? steps.indexOf((ticket.STATUS || "OPEN").toUpperCase()) : -1;
  const isRejected = (ticket?.STATUS || "").toUpperCase() === "REJECTED";

  return (
    <div className={styles.modalOverlay} onClick={onClose}
         role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        {/* Head */}
        <header className={styles.modalHead}>
          <div>
            <div className={styles.modalEyebrow}>
              {ticket?.TICKET_NUMBER || `#${ticketId}`}
              {cat && (
                <span className={`${styles.catPill} ${styles[`catPill_${cat.tone}`]}`}
                      style={{ marginLeft: 8 }}>
                  {cat.short}
                </span>
              )}
            </div>
            <h2 className={styles.modalTitle}>
              {ticket?.SUBJECT || "Loading…"}
            </h2>
          </div>
          <button type="button" className={styles.modalClose}
                  onClick={onClose} aria-label="Close">
            {I.close}
          </button>
        </header>

        <div className={styles.modalBody}>

          {/* Status pipeline */}
          {ticket && (isRejected ? (
            <div className={`${styles.stepper} ${styles.stepper_rejected}`}>
              <span className={`${styles.chip} ${styles.chip_rejected}`}>Rejected</span>
              <span className={styles.stepperNote}>
                This ticket was rejected. See resolution notes below.
              </span>
            </div>
          ) : (
            <div className={styles.stepper}>
              {steps.map((s, i) => {
                const active = i <= currentIdx;
                return (
                  <div key={s} className={styles.stepWrap}>
                    <div className={`${styles.stepDot} ${active ? styles.stepDot_active : ""}`}>
                      {i + 1}
                    </div>
                    <span className={`${styles.stepLabel} ${active ? styles.stepLabel_active : ""}`}>
                      {statusOf(s).label}
                    </span>
                    {i < steps.length - 1 && (
                      <span className={`${styles.stepLine} ${i < currentIdx ? styles.stepLine_active : ""}`} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Metadata */}
          {ticket && (
            <div className={styles.metaGrid}>
              <MetaRow label="Employee"  value={
                <>
                  {ticket.EMPLOYEE_NAME || "—"}
                  {ticket.EMPLOYEE_CODE && (
                    <span className={styles.empCode} style={{ marginLeft: 8 }}>
                      {ticket.EMPLOYEE_CODE}
                    </span>
                  )}
                </>
              } />
              <MetaRow label="Department" value={ticket.DEPARTMENT || "—"} />
              <MetaRow label="Category"   value={cat ? cat.label : "—"} />
              <MetaRow label="Priority"   value={ticket.PRIORITY || "MEDIUM"} />
              <MetaRow label="Status"     value={stat ? <span className={`${styles.chip} ${styles[stat.chip]}`}>{stat.label}</span> : "—"} />
              <MetaRow label="Raised on"  value={fmtDateTime(ticket.CREATED_AT)} />
              {ticket.ASSIGNED_TO_NAME && (
                <MetaRow label="Assigned to" value={ticket.ASSIGNED_TO_NAME} />
              )}
              {ticket.RESOLVED_AT && (
                <MetaRow label="Resolved on" value={fmtDateTime(ticket.RESOLVED_AT)} />
              )}
              {ticket.CLOSED_AT && (
                <MetaRow label="Closed on" value={fmtDateTime(ticket.CLOSED_AT)} />
              )}
            </div>
          )}

          {ticket?.DESCRIPTION && (
            <div className={styles.descBlock}>
              <div className={styles.blockLabel}>Description</div>
              <div className={styles.descText}>{ticket.DESCRIPTION}</div>
            </div>
          )}

          {/* --- Admin actions --- */}
          {ticket && (
            <div className={styles.adminActions}>
              <div className={styles.blockLabel}>Manage ticket</div>

              <div className={styles.actionsGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>Status</label>
                  <select
                    className={styles.select}
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Assign to</label>
                  <select
                    className={styles.select}
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                  >
                    <option value="">— Unassigned —</option>
                    {admins.map((a) => (
                      <option key={a.ID} value={a.ID}>
                        {a.NAME} {a.EMPLOYEE_CODE ? `(${a.EMPLOYEE_CODE})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Internal notes (not visible to employee)</label>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={internal}
                  onChange={(e) => setInternal(e.target.value)}
                  placeholder="Notes for the admin team…"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Resolution notes (visible to employee)</label>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="What was done to resolve this ticket…"
                />
              </div>

              {err && <div className={styles.error}>{err}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className={styles.modalFoot}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Close
          </button>
          <div style={{ flex: 1 }} />
          {ticket && ticket.STATUS !== "CLOSED" && (
            <button
              type="button"
              className={styles.btnDanger}
              disabled={saving}
              onClick={closeTicket}
            >
              Close ticket
            </button>
          )}
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={saving || !ticket}
            onClick={saveAll}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
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
