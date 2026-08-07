// =====================================================================
// MyHelpDeskPanel — employee help-desk tickets.
// ---------------------------------------------------------------------
// Employees can raise tickets in four categories and track their
// status until closure:
//   • Complaint
//   • IT Request
//   • HR Request
//   • Maintenance
//
// Layout, top → bottom:
//   1. Header with counts + "Raise a ticket" primary button
//   2. Status filter chips (All / Open / In progress / Resolved / Closed)
//   3. Category filter chips
//   4. Ticket cards, newest first
//   5. New-ticket modal (category, subject, description, priority)
//   6. Detail modal with status progress + resolution notes
//
// Backend endpoints:
//   POST  /helpdesk                — create ticket
//   GET   /helpdesk/my?employee_id=X   — list my tickets
//   GET   /helpdesk/{id}           — full ticket (for detail modal)
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./MyHelpDeskPanel.module.css";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  ticket:      icon(<>
    <path d="M20 12a3 3 0 0 1 0-6V4H4v2a3 3 0 0 1 0 6 3 3 0 0 1 0 6v2h16v-2a3 3 0 0 1 0-6z" />
    <path d="M13 6v2M13 12v2M13 18v-2" />
  </>),
  plus:        icon(<><path d="M12 5v14" /><path d="M5 12h14" /></>, 16),
  complaint:   icon(<>
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>),
  it:          icon(<>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M2 20h20" />
    <path d="M9 16h6" />
  </>),
  hr:          icon(<>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
  </>),
  maintenance: icon(<>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9L4 21l-3-3 8.7-9.6a6 6 0 0 1 7.9-7.9L14.7 6.3z" />
  </>),
  other:       icon(<>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
  </>),
  close:       icon(<path d="M18 6L6 18M6 6l12 12" />, 18),
  send:        icon(<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />, 16),
  empty:       icon(<>
    <path d="M20 12a3 3 0 0 1 0-6V4H4v2a3 3 0 0 1 0 6 3 3 0 0 1 0 6v2h16v-2a3 3 0 0 1 0-6z" />
  </>, 32),
};


// ------------------------------------------------------------------
// Category + status metadata
// ------------------------------------------------------------------

const CATEGORIES = [
  { key: "COMPLAINT",   label: "Complaint",   short: "Complaint",   icon: I.complaint,   tone: "red"    },
  { key: "IT_REQUEST",  label: "IT Request",  short: "IT",          icon: I.it,          tone: "blue"   },
  { key: "HR_REQUEST",  label: "HR Request",  short: "HR",          icon: I.hr,          tone: "amber"  },
  { key: "MAINTENANCE", label: "Maintenance", short: "Maintenance", icon: I.maintenance, tone: "green"  },
  { key: "OTHER",       label: "Other",       short: "Other",       icon: I.other,       tone: "muted"  },
];

function catOf(key) {
  return CATEGORIES.find((c) => c.key === (key || "").toUpperCase()) || CATEGORIES[4];
}


const STATUSES = [
  { key: "OPEN",        label: "Open",        chip: "chip_open"      },
  { key: "IN_PROGRESS", label: "In progress", chip: "chip_progress"  },
  { key: "RESOLVED",    label: "Resolved",    chip: "chip_resolved"  },
  { key: "CLOSED",      label: "Closed",      chip: "chip_closed"    },
  { key: "REJECTED",    label: "Rejected",    chip: "chip_rejected"  },
];

function statusOf(key) {
  const k = (key || "OPEN").toUpperCase();
  return STATUSES.find((s) => s.key === k) || STATUSES[0];
}


const PRIORITIES = [
  { key: "LOW",    label: "Low"    },
  { key: "MEDIUM", label: "Medium" },
  { key: "HIGH",   label: "High"   },
  { key: "URGENT", label: "Urgent" },
];


// ------------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------------

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
export default function MyHelpDeskPanel({ employeeId }) {

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [statusFilter, setStatusFilter]     = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [showNew, setShowNew] = useState(false);
  const [openTicket, setOpenTicket] = useState(null);


  // ---- Fetch ----
  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const res = await API.get(
        `/helpdesk/my?employee_id=${encodeURIComponent(employeeId)}`
      );
      setTickets(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      if (e?.response?.status === 404) {
        setTickets([]);
      } else {
        setError(e?.response?.data?.detail || "Failed to load tickets.");
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);


  // ---- Derived counts ----
  const statusCounts = useMemo(() => {
    const c = { all: tickets.length, OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0, REJECTED: 0 };
    tickets.forEach((t) => {
      const k = (t.STATUS || "OPEN").toUpperCase();
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [tickets]);

  const categoryCounts = useMemo(() => {
    const c = { all: tickets.length };
    CATEGORIES.forEach((cat) => (c[cat.key] = 0));
    tickets.forEach((t) => {
      const k = (t.CATEGORY || "OTHER").toUpperCase();
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [tickets]);


  // ---- Filtered list ----
  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      const s = (t.STATUS   || "").toUpperCase();
      const g = (t.CATEGORY || "").toUpperCase();
      if (statusFilter   !== "all" && s !== statusFilter)   return false;
      if (categoryFilter !== "all" && g !== categoryFilter) return false;
      return true;
    });
  }, [tickets, statusFilter, categoryFilter]);


  // ---- Create ----
  const onCreated = useCallback((created) => {
    setShowNew(false);
    // Optimistic prepend, then re-load to get the server-side truth
    setTickets((prev) => [created, ...prev]);
    load();
  }, [load]);


  // ==================================================================
  // Render
  // ==================================================================
  return (
    <div className={styles.wrap}>

      {/* ---------- Header ---------- */}
      <header className={styles.head}>
        <div>
          <div className={styles.headEyebrow}>Employee Self-Service</div>
          <h1 className={styles.headTitle}>
            Help Desk
            <span className={styles.headCount}>{tickets.length}</span>
          </h1>
          <p className={styles.headSub}>
            Raise complaints, IT / HR requests and maintenance tickets
            here. Track each ticket's progress until it's resolved.
          </p>
        </div>

        <button
          type="button"
          className={styles.newBtn}
          onClick={() => setShowNew(true)}
        >
          {I.plus}
          <span>Raise a ticket</span>
        </button>
      </header>


      {/* ---------- Status filter ---------- */}
      <div className={styles.filters} role="tablist">
        <FilterChip active={statusFilter === "all"}
                    label="All"
                    count={statusCounts.all}
                    onClick={() => setStatusFilter("all")} />
        {STATUSES.map((s) => (
          <FilterChip
            key={s.key}
            active={statusFilter === s.key}
            label={s.label}
            count={statusCounts[s.key] || 0}
            onClick={() => setStatusFilter(s.key)}
          />
        ))}
      </div>


      {/* ---------- Category filter ---------- */}
      <div className={styles.filtersCat} role="tablist">
        <CatChip active={categoryFilter === "all"}
                 label="All categories"
                 count={categoryCounts.all}
                 onClick={() => setCategoryFilter("all")} />
        {CATEGORIES.map((c) => (
          <CatChip
            key={c.key}
            active={categoryFilter === c.key}
            label={c.short}
            icon={c.icon}
            tone={c.tone}
            count={categoryCounts[c.key] || 0}
            onClick={() => setCategoryFilter(c.key)}
          />
        ))}
      </div>


      {/* ---------- Content ---------- */}
      {loading && (
        <div className={styles.loading}>Loading your tickets…</div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>{I.empty}</span>
          <div>
            <div className={styles.emptyTitle}>
              {tickets.length === 0
                ? "No tickets yet"
                : "No tickets match this filter"}
            </div>
            <div className={styles.emptyBody}>
              {tickets.length === 0
                ? "Raise your first ticket using the button above. Every ticket you create is tracked here from open through to resolution."
                : "Try a different status or category filter to see the other tickets."}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className={styles.list}>
          {filtered.map((t) => (
            <TicketCard
              key={t.ID}
              ticket={t}
              onOpen={() => setOpenTicket(t)}
            />
          ))}
        </ul>
      )}


      {/* ---------- Modals ---------- */}
      {showNew && (
        <NewTicketModal
          employeeId={employeeId}
          onClose={() => setShowNew(false)}
          onCreated={onCreated}
        />
      )}

      {openTicket && (
        <TicketDetailModal
          ticket={openTicket}
          onClose={() => setOpenTicket(null)}
        />
      )}
    </div>
  );
}


// ==================================================================
// Sub-components
// ==================================================================

function FilterChip({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`${styles.chipBtn} ${active ? styles.chipBtn_active : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className={styles.chipCount}>{count}</span>
    </button>
  );
}


function CatChip({ active, label, count, icon, tone, onClick }) {
  const cls = [
    styles.catBtn,
    active ? styles.catBtn_active : "",
    tone && !active ? styles[`catBtn_${tone}`] || "" : "",
  ].filter(Boolean).join(" ");
  return (
    <button type="button" role="tab" aria-selected={active}
            className={cls} onClick={onClick}>
      {icon && <span className={styles.catBtnIcon}>{icon}</span>}
      <span>{label}</span>
      <span className={styles.chipCount}>{count}</span>
    </button>
  );
}


function TicketCard({ ticket, onOpen }) {
  const cat  = catOf(ticket.CATEGORY);
  const stat = statusOf(ticket.STATUS);
  const pri  = (ticket.PRIORITY || "MEDIUM").toUpperCase();

  return (
    <li className={styles.card} onClick={onOpen}>
      <div className={`${styles.cardIcon} ${styles[`tint_${cat.tone}`]}`}>
        {cat.icon}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.ticketNumber}>{ticket.TICKET_NUMBER}</span>
          <span className={`${styles.catPill} ${styles[`catPill_${cat.tone}`]}`}>
            {cat.short}
          </span>
          <span className={styles.spacer} />
          <span className={`${styles.chip} ${styles[stat.chip]}`}>{stat.label}</span>
        </div>

        <div className={styles.cardTitle}>{ticket.SUBJECT}</div>

        {ticket.DESCRIPTION && (
          <div className={styles.cardDesc}>{ticket.DESCRIPTION}</div>
        )}

        <div className={styles.cardMeta}>
          <span>Raised {fmtDate(ticket.CREATED_AT)}</span>
          <span className={styles.dot}>·</span>
          <span className={`${styles.priTag} ${styles[`pri_${pri.toLowerCase()}`]}`}>
            {pri} priority
          </span>
          {ticket.ASSIGNED_TO_NAME && (
            <>
              <span className={styles.dot}>·</span>
              <span>Assigned to {ticket.ASSIGNED_TO_NAME}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}


// ==================================================================
// New ticket modal
// ==================================================================
function NewTicketModal({ employeeId, onClose, onCreated }) {

  const [category, setCategory] = useState("COMPLAINT");
  const [subject,  setSubject]  = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) { setError("Subject is required."); return; }
    setError("");
    setSaving(true);
    try {
      const res = await API.post("/helpdesk", {
        EMPLOYEE_ID: employeeId,
        CATEGORY:    category,
        SUBJECT:     subject.trim(),
        DESCRIPTION: description.trim() || null,
        PRIORITY:    priority,
      });
      onCreated?.(res.data);
    } catch (err) {
      const raw = err?.response?.data?.detail;
      const msg = typeof raw === "string" && raw
        ? raw
        : Array.isArray(raw) && raw.length
          ? raw.map((e) => e?.msg || "").filter(Boolean).join(" · ")
          : "Could not submit the ticket. Please try again.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}
         role="dialog" aria-modal="true">
      <form className={styles.modal} onSubmit={submit}
            onClick={(e) => e.stopPropagation()}>

        <header className={styles.modalHead}>
          <div>
            <div className={styles.modalEyebrow}>New ticket</div>
            <h2 className={styles.modalTitle}>Raise a help desk ticket</h2>
          </div>
          <button type="button" className={styles.modalClose}
                  onClick={onClose} aria-label="Close">
            {I.close}
          </button>
        </header>

        <div className={styles.modalBody}>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.field}>
            <label className={styles.label}>Category</label>
            <div className={styles.catPickerRow}>
              {CATEGORIES.filter((c) => c.key !== "OTHER").map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`${styles.catPick} ${category === c.key ? styles.catPick_active : ""} ${styles[`catPick_${c.tone}`]}`}
                  onClick={() => setCategory(c.key)}
                >
                  <span className={styles.catPickIcon}>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={`${styles.label} ${styles.labelReq}`}>Subject</label>
            <input
              type="text"
              className={styles.input}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="Short summary of the issue"
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Description</label>
            <textarea
              className={styles.textarea}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more context — when it happened, steps to reproduce, expected outcome…"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Priority</label>
            <div className={styles.priRow}>
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.priBtn} ${priority === p.key ? styles.priBtn_active : ""} ${styles[`pri_${p.key.toLowerCase()}`]}`}
                  onClick={() => setPriority(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className={styles.modalFoot}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {I.send}
            <span>{saving ? "Submitting…" : "Submit ticket"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}


// ==================================================================
// Detail modal
// ==================================================================
function TicketDetailModal({ ticket, onClose }) {

  const cat  = catOf(ticket.CATEGORY);
  const stat = statusOf(ticket.STATUS);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Progress stepper — visualises status pipeline
  const steps = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
  const currentIdx = steps.indexOf((ticket.STATUS || "OPEN").toUpperCase());
  const isRejected = (ticket.STATUS || "").toUpperCase() === "REJECTED";

  return (
    <div className={styles.modalOverlay} onClick={onClose}
         role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        <header className={styles.modalHead}>
          <div>
            <div className={styles.modalEyebrow}>
              {ticket.TICKET_NUMBER}
              <span className={`${styles.catPill} ${styles[`catPill_${cat.tone}`]}`}
                    style={{ marginLeft: 8 }}>
                {cat.short}
              </span>
            </div>
            <h2 className={styles.modalTitle}>{ticket.SUBJECT}</h2>
          </div>
          <button type="button" className={styles.modalClose}
                  onClick={onClose} aria-label="Close">
            {I.close}
          </button>
        </header>

        <div className={styles.modalBody}>

          {/* Status pipeline */}
          {isRejected ? (
            <div className={`${styles.stepper} ${styles.stepper_rejected}`}>
              <span className={`${styles.chip} ${styles.chip_rejected}`}>
                Rejected
              </span>
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
          )}

          {/* Metadata grid */}
          <div className={styles.metaGrid}>
            <MetaRow label="Raised on"  value={fmtDateTime(ticket.CREATED_AT)} />
            <MetaRow label="Status"     value={<span className={`${styles.chip} ${styles[stat.chip]}`}>{stat.label}</span>} />
            <MetaRow label="Priority"   value={(ticket.PRIORITY || "MEDIUM")} />
            <MetaRow label="Category"   value={cat.label} />
            {ticket.ASSIGNED_TO_NAME && (
              <MetaRow label="Assigned to" value={ticket.ASSIGNED_TO_NAME} />
            )}
            {ticket.RESOLVED_AT && (
              <MetaRow label="Resolved on" value={fmtDateTime(ticket.RESOLVED_AT)} />
            )}
          </div>

          {ticket.DESCRIPTION && (
            <div className={styles.descBlock}>
              <div className={styles.blockLabel}>Description</div>
              <div className={styles.descText}>{ticket.DESCRIPTION}</div>
            </div>
          )}

          {ticket.RESOLUTION_NOTES && (
            <div className={styles.resolutionBlock}>
              <div className={styles.blockLabel}>Resolution notes</div>
              <div className={styles.descText}>{ticket.RESOLUTION_NOTES}</div>
            </div>
          )}
        </div>

        <footer className={styles.modalFoot}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Close
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
