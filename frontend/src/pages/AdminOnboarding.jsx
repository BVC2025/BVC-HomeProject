// =====================================================================
// AdminOnboarding — dashboard-style onboarding home.
//
// Layout mirrors the design mock:
//   • Header row with New Onboarding CTA
//   • 4 KPI tiles (New Joiners / In Progress / Completed / Pending)
//   • 3-column bottom row: Process timeline · Recent Onboardings · Quick Links
//   • Detail modal opens when a joiner row is clicked — the modal shows
//     the phase-grouped checklist and drives every mutation.
//
// Wiring: uses the existing /hr-onboarding/* backend routes. No backend
// changes needed.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";

import styles from "./AdminOnboarding.module.css";


// =====================================================================
// Constants
// =====================================================================

const PHASES = [
  {
    key:   "PRE_JOINING",
    title: "Employee Details & Offer Letter",
    hint:  "Capture personal and job-related information",
    categories: ["DOC", "DEPT", "ROLE"],
  },
  {
    key:   "DOC_VERIFY",
    title: "Document Verification",
    hint:  "Verify and upload required documents",
    categories: [],   // routed via the CATEGORY=DOC subset in the modal
  },
  {
    key:   "DAY_ONE",
    title: "System Access Setup",
    hint:  "Create system accounts, allocate assets, issue welcome kit",
    categories: ["ASSET", "KIT"],
  },
  {
    key:   "TRAINING",
    title: "Orientation & Training",
    hint:  "Assign induction and training materials",
    categories: ["TRAINING", "OTHER"],
  },
];

const CATEGORY_ACCENT = {
  DOC:      "#0891b2",
  DEPT:     "#7c3aed",
  ROLE:     "#7c3aed",
  ASSET:    "#0284c7",
  TRAINING: "#d97706",
  KIT:      "#16a34a",
  OTHER:    "#64748b",
};

const STATUS_PILL = {
  NOT_STARTED: { label: "Pending",     tone: "amber" },
  IN_PROGRESS: { label: "In Progress", tone: "amber" },
  COMPLETE:    { label: "Completed",   tone: "green" },
};


// =====================================================================
// Icons
// =====================================================================

function Icon({ name, size = 22, color = "currentColor", strokeWidth = 1.8 }) {
  const p = {
    width: size, height: size,
    viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth,
    strokeLinecap: "round", strokeLinejoin: "round",
  };
  switch (name) {
    case "users":
      return (
        <svg {...p}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...p}>
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "clock":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case "plus":
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...p}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "link":
      return (
        <svg {...p}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case "user-plus":
      return (
        <svg {...p}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M20 8v6M23 11h-6" />
        </svg>
      );
    case "list":
      return (
        <svg {...p}>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    case "file-check":
      return (
        <svg {...p}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="m9 15 2 2 4-4" />
        </svg>
      );
    case "book":
      return (
        <svg {...p}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
          <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
        </svg>
      );
    case "close":
      return (
        <svg {...p}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "check":
      return (
        <svg {...p} strokeWidth={3}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    default:
      return null;
  }
}


// =====================================================================
// KPI tile
// =====================================================================

function KpiTile({ iconName, label, value, sub, tone }) {
  return (
    <div className={`${styles.kpi} ${styles[`kpi_${tone}`]}`}>
      <div className={styles.kpiIcon}>
        <Icon name={iconName} size={22} />
      </div>
      <div className={styles.kpiBody}>
        <div className={styles.kpiLabel}>{label}</div>
        <div className={styles.kpiValue}>{value}</div>
        {sub && <div className={styles.kpiSub}>{sub}</div>}
      </div>
    </div>
  );
}


// =====================================================================
// Status pill
// =====================================================================

function StatusPill({ status }) {
  const meta = STATUS_PILL[status] || STATUS_PILL.NOT_STARTED;
  return (
    <span className={`${styles.pill} ${styles[`pill_${meta.tone}`]}`}>
      {meta.label}
    </span>
  );
}


function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}


// =====================================================================
// Detail modal
// =====================================================================

function DetailModal({ empId, onClose }) {

  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [autoBusy, setAutoBusy]   = useState(false);
  const [toast, setToast]         = useState("");

  const load = useCallback(async () => {
    if (!empId) return;
    setLoading(true);
    try {
      const res = await API.get(`/hr-onboarding/employees/${empId}/checklist`);
      setChecklist(res.data);
    } finally {
      setLoading(false);
    }
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (item) => {
    const next = item.status === "DONE" ? "PENDING" : "DONE";
    try {
      await API.patch(
        `/hr-onboarding/employees/${empId}/checklist/${item.id}`,
        { status: next },
      );
      await load();
    } catch (err) {
      setToast(err?.response?.data?.detail || "Update failed");
    }
  };

  const runAuto = async () => {
    setAutoBusy(true); setToast("");
    try {
      const res = await API.post(`/hr-onboarding/employees/${empId}/auto-onboard`);
      const n = res.data?.completed_count ?? 0;
      setToast(`Auto-onboard ran — ${n} step${n === 1 ? "" : "s"} advanced`);
      await load();
    } catch (err) {
      setToast(err?.response?.data?.detail || "Auto-onboard failed");
    } finally {
      setAutoBusy(false);
    }
  };

  const itemsByPhase = useMemo(() => {
    const items = checklist?.items || [];
    const buckets = { PRE_JOINING: [], DOC_VERIFY: [], DAY_ONE: [], TRAINING: [] };
    for (const it of items) {
      if (it.category === "DOC") {
        buckets.DOC_VERIFY.push(it);
      } else if (["DEPT", "ROLE"].includes(it.category)) {
        buckets.PRE_JOINING.push(it);
      } else if (["ASSET", "KIT"].includes(it.category)) {
        buckets.DAY_ONE.push(it);
      } else {
        buckets.TRAINING.push(it);
      }
    }
    return buckets;
  }, [checklist]);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modalPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalEyebrow}>Onboarding Checklist</div>
            <div className={styles.modalTitle}>
              {checklist?.employee_name || "Loading…"}
            </div>
            {checklist && (
              <div className={styles.modalMeta}>
                {checklist.employee_code || "—"}
                {checklist.department  && <> · {checklist.department}</>}
                {checklist.designation && <> · {checklist.designation}</>}
              </div>
            )}
          </div>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            title="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {checklist && (
          <div className={styles.modalProgressRow}>
            <div className={styles.modalProgressText}>
              <strong>{checklist.done_items}</strong> of{" "}
              <strong>{checklist.total_items}</strong> steps complete
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${checklist.completion_pct || 0}%` }}
              />
            </div>
            <button
              type="button"
              onClick={runAuto}
              disabled={autoBusy}
              className={styles.btnPrimary}
            >
              {autoBusy ? "Running…" : "Run Auto-Onboard"}
            </button>
          </div>
        )}

        {toast && (
          <div className={styles.toast} onClick={() => setToast("")}>
            {toast}
          </div>
        )}

        <div className={styles.modalBody}>
          {loading && <div className={styles.emptyState}>Loading checklist…</div>}

          {!loading && checklist && PHASES.map((phase) => {
            const items = itemsByPhase[phase.key] || [];
            const done  = items.filter((i) => i.status === "DONE").length;
            return (
              <section key={phase.key} className={styles.phase}>
                <div className={styles.phaseHead}>
                  <div>
                    <div className={styles.phaseTitle}>{phase.title}</div>
                    <div className={styles.phaseHint}>{phase.hint}</div>
                  </div>
                  <div className={styles.phaseCount}>
                    {done} / {items.length}
                  </div>
                </div>
                {items.length === 0 ? (
                  <div className={styles.phaseEmpty}>
                    No items for this phase.
                  </div>
                ) : (
                  items.map((it) => {
                    const isDone = it.status === "DONE";
                    const accent = CATEGORY_ACCENT[it.category] || CATEGORY_ACCENT.OTHER;
                    return (
                      <div
                        key={it.id}
                        className={`${styles.checkRow} ${isDone ? styles.checkRowDone : ""}`}
                      >
                        <button
                          type="button"
                          className={styles.checkBox}
                          onClick={() => toggle(it)}
                        >
                          {isDone && <Icon name="check" size={12} />}
                        </button>
                        <div className={styles.checkBody}>
                          <div className={styles.checkLabel}>{it.label}</div>
                          <div className={styles.checkMeta}>
                            <span
                              className={styles.categoryChip}
                              style={{ color: accent, borderColor: `${accent}33` }}
                            >
                              {it.category}
                            </span>
                            {isDone && it.completed_date && (
                              <span className={styles.checkMetaMuted}>
                                · done {fmtDate(it.completed_date)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Main page — dashboard layout
// =====================================================================

export default function AdminOnboarding() {

  const nav = useNavigate();

  const [overview, setOverview] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get("/hr-onboarding/overview",
        { params: { only_in_progress: false } });
      setOverview(Array.isArray(res.data) ? res.data : []);
    } catch {
      setOverview([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Reload after modal closes so the KPI counters + recent list refresh
  const closeModal = () => {
    setSelected(null);
    loadOverview();
  };


  // ---- KPI derivation ------------------------------------------------

  const kpis = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear  = now.getFullYear();

    let newJoiners = 0;
    let inProgress = 0;
    let completed  = 0;
    let pendingSteps = 0;

    for (const row of overview) {
      if (row.joining_date) {
        const d = new Date(row.joining_date);
        if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
          newJoiners += 1;
        }
      }
      if (row.status === "IN_PROGRESS")  inProgress += 1;
      if (row.status === "COMPLETE")     completed  += 1;
      if (row.status === "IN_PROGRESS" || row.status === "NOT_STARTED") {
        pendingSteps += Math.max(0, (row.total_items || 0) - (row.done_items || 0));
      }
    }

    return { newJoiners, inProgress, completed, pendingSteps };
  }, [overview]);

  const recent = useMemo(() => {
    return [...overview]
      .sort((a, b) => {
        const ad = a.joining_date ? new Date(a.joining_date).getTime() : 0;
        const bd = b.joining_date ? new Date(b.joining_date).getTime() : 0;
        return bd - ad;
      })
      .slice(0, 6);
  }, [overview]);


  // ---- Render --------------------------------------------------------

  return (
    <div className={styles.page}>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <Icon name="users" size={22} color="#dc2626" />
          </div>
          <div>
            <div className={styles.title}>Onboarding</div>
            <div className={styles.subtitle}>Welcome new employees to your organization</div>
          </div>
        </div>
        <button
          type="button"
          className={styles.newBtn}
          onClick={() => nav("/employees")}
          title="Open Employees to add a new hire"
        >
          <Icon name="plus" size={16} />
          <span>New Onboarding</span>
        </button>
      </header>

      {/* KPI row */}
      <section className={styles.kpiGrid}>
        <KpiTile
          iconName="users"
          label="New Joiners"
          value={loading ? "—" : kpis.newJoiners}
          sub="This Month"
          tone="blue"
        />
        <KpiTile
          iconName="clipboard"
          label="Onboarding In Progress"
          value={loading ? "—" : kpis.inProgress}
          sub="Active new hires"
          tone="green"
        />
        <KpiTile
          iconName="check-circle"
          label="Completed"
          value={loading ? "—" : kpis.completed}
          sub="All steps done"
          tone="purple"
        />
        <KpiTile
          iconName="clock"
          label="Pending Tasks"
          value={loading ? "—" : kpis.pendingSteps}
          sub="Across all joiners"
          tone="amber"
        />
      </section>

      {/* 3-column bottom grid */}
      <section className={styles.grid3}>

        {/* --- Process timeline --- */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardIcon} style={{ background: "#dbeafe", color: "#1d4ed8" }}>
              <Icon name="clipboard" size={16} />
            </div>
            <div className={styles.cardTitle}>Onboarding Process</div>
          </div>

          <ol className={styles.timeline}>
            {PHASES.map((phase, idx) => (
              <li key={phase.key} className={styles.timelineItem}>
                <div className={styles.timelineDot}>{idx + 1}</div>
                <div className={styles.timelineBody}>
                  <div className={styles.timelineTitle}>{phase.title}</div>
                  <div className={styles.timelineHint}>{phase.hint}</div>
                </div>
                <Icon name="arrow" size={14} color="#94a3b8" />
              </li>
            ))}
          </ol>
        </section>

        {/* --- Recent Onboardings --- */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardIcon} style={{ background: "#fef2f2", color: "#dc2626" }}>
              <Icon name="users" size={16} />
            </div>
            <div className={styles.cardTitle}>Recent Onboardings</div>
            <button
              type="button"
              className={styles.viewAllBtn}
              onClick={() => nav("/onboarding-legacy")}
            >
              View All
            </button>
          </div>

          {loading && (
            <div className={styles.emptyState}>Loading joiners…</div>
          )}

          {!loading && recent.length === 0 && (
            <div className={styles.emptyState}>
              No joiners yet. Add an employee to start onboarding.
            </div>
          )}

          {!loading && recent.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Employee Name</th>
                  <th>Department</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr
                    key={row.employee_id}
                    className={styles.tableRow}
                    onClick={() => setSelected(row.employee_id)}
                  >
                    <td className={styles.tableName}>
                      {row.employee_name || "—"}
                    </td>
                    <td className={styles.tableDept}>
                      {row.department || "—"}
                    </td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* --- Quick Links --- */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardIcon} style={{ background: "#fef3c7", color: "#b45309" }}>
              <Icon name="link" size={16} />
            </div>
            <div className={styles.cardTitle}>Quick Links</div>
          </div>

          <div className={styles.quickList}>
            <QuickLink
              iconName="user-plus"
              label="Add New Employee"
              onClick={() => nav("/employees")}
            />
            <QuickLink
              iconName="list"
              label="View Employee List"
              onClick={() => nav("/employees")}
            />
            <QuickLink
              iconName="clipboard"
              label="Onboarding Checklist"
              onClick={() => nav("/onboarding-legacy")}
            />
            <QuickLink
              iconName="file-check"
              label="Required Documents"
              onClick={() => nav("/employees")}
            />
            <QuickLink
              iconName="book"
              label="Training Resources"
              onClick={() => nav("/onboarding-legacy")}
            />
          </div>
        </section>
      </section>

      {selected && (
        <DetailModal empId={selected} onClose={closeModal} />
      )}
    </div>
  );
}


// =====================================================================
// Quick-link row
// =====================================================================

function QuickLink({ iconName, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className={styles.quickLink}>
      <span className={styles.quickLinkIcon}>
        <Icon name={iconName} size={16} />
      </span>
      <span className={styles.quickLinkLabel}>{label}</span>
      <Icon name="arrow" size={14} color="#94a3b8" />
    </button>
  );
}
