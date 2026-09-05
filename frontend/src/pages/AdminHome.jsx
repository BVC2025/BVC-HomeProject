// =====================================================================
// BVC24 — Admin Home Dashboard
//
// Clean, brand-aligned overview of the entire ERP. Four sections:
//   1. Header    — logo + company + system status + live clock
//   2. Executive — 4 headline KPIs (attendance, revenue, sales, prod)
//   3. Modules   — 8 module cards summarising the whole ERP
//   4. Bottom    — Priority (needs action) | Recent activity
//
// Palette: BVC24 red + white + gold (accent only).
// No emojis in copy. Inline SVG icons. Terse labels.
// Auto-refreshes every 30 seconds.
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";

import styles from "./AdminHome.module.css";


// ---------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------

function inrShort(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (Math.abs(v) >= 100000)   return `₹${(v / 100000).toFixed(2)} L`;
  if (Math.abs(v) >= 1000)     return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}


function fmtIntOrDash(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-IN");
}


function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata"
  });
}


// ---------------------------------------------------------------------
// SVG icon set — inline, single component, brand-friendly
// ---------------------------------------------------------------------

function Icon({ name, size = 22, color = "currentColor", strokeWidth = 1.8 }) {

  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  switch (name) {
    case "users":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "rupee":
      return (
        <svg {...common}>
          <path d="M6 4h12M6 8h12M9 4c4 0 5 2.5 5 5s-1 4.5-5 4.5H6l8 7" />
        </svg>
      );
    case "cart":
      return (
        <svg {...common}>
          <circle cx="9" cy="20" r="1.5" />
          <circle cx="18" cy="20" r="1.5" />
          <path d="M2 3h3l3 12h12l2-8H6" />
        </svg>
      );
    case "factory":
      return (
        <svg {...common}>
          <path d="M2 20h20" />
          <path d="M4 20V8l5 4V8l5 4V8l5 4v8" />
          <path d="M9 20v-4M14 20v-4" />
        </svg>
      );
    case "briefcase":
      return (
        <svg {...common}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
    case "cash":
      return (
        <svg {...common}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 10v.01M18 14v.01" />
        </svg>
      );
    case "handshake":
      return (
        <svg {...common}>
          <path d="M11 17l2 2a1 1 0 0 0 1.4 0l4-4" />
          <path d="M2 13l3-3a2 2 0 0 1 2.8 0l4.2 4.2" />
          <path d="M8 11l2 2M22 13l-5-5-3 3-3-3-4 4" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill={color} />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "box":
      return (
        <svg {...common}>
          <path d="M21 8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" />
          <path d="M1 5h22v3H1z" />
          <path d="M10 12h4" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common} width={size} height={size}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "dot":
      return (
        <svg {...common} width={8} height={8}>
          <circle cx="12" cy="12" r="8" fill={color} stroke="none" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="m12 3 10 18H2Z" />
          <path d="M12 10v4M12 18v.01" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    default:
      return null;
  }
}


// ---------------------------------------------------------------------
// Header — logo + company + status pills + live clock
// ---------------------------------------------------------------------

function Header() {

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    timeZone: "Asia/Kolkata"
  });

  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: "Asia/Kolkata"
  });

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src="/logo.webp" alt="BVC24" className={styles.brandLogo} />
        <div>
          <div className={styles.brandCompany}>Bharath Vending Corporation</div>
          <div className={styles.brandTag}>BVC24 Enterprise ERP</div>
        </div>
      </div>

      <div className={styles.headerRight}>
        <div className={styles.statusPill}>
          <span className={styles.statusDot} />
          All Systems Operational
        </div>
        <div className={styles.clockWrap}>
          <div className={styles.clockDate}>{dateStr}</div>
          <div className={styles.clockTime}>{timeStr}</div>
        </div>
      </div>
    </header>
  );
}


// ---------------------------------------------------------------------
// Executive KPI tile
// ---------------------------------------------------------------------

function KpiTile({ iconName, label, value, sub, accent, onClick }) {

  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.kpiTile}
      style={{ "--kpiAccent": accent }}
    >
      <div className={styles.kpiIconWrap} style={{ background: `${accent}18`, color: accent }}>
        <Icon name={iconName} size={24} color={accent} />
      </div>
      <div className={styles.kpiBody}>
        <div className={styles.kpiLabel}>{label}</div>
        <div className={styles.kpiValue}>{value}</div>
        {sub && <div className={styles.kpiSub}>{sub}</div>}
      </div>
    </button>
  );
}


// ---------------------------------------------------------------------
// Module card
// ---------------------------------------------------------------------

function ModuleCard({ iconName, title, blurb, metrics, to, accent }) {

  const nav = useNavigate();

  return (
    <div
      className={styles.moduleCard}
      onClick={() => nav(to)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") nav(to); }}
    >
      <div className={styles.moduleHead}>
        <div className={styles.moduleIcon} style={{ background: `${accent}14`, color: accent }}>
          <Icon name={iconName} size={22} color={accent} />
        </div>
        <div className={styles.moduleTitle}>{title}</div>
      </div>

      {blurb && <div className={styles.moduleBlurb}>{blurb}</div>}

      <div className={styles.moduleMetrics}>
        {metrics.map((m) => (
          <div key={m.label} className={styles.metricRow}>
            <span className={styles.metricLabel}>{m.label}</span>
            <span className={styles.metricValue}>{m.value}</span>
          </div>
        ))}
      </div>

      <div className={styles.moduleFoot}>
        Open <Icon name="arrow" size={14} />
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Priority list — things needing action
// ---------------------------------------------------------------------

function PriorityCard({ items, loading }) {

  const nav = useNavigate();

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.panelEyebrow}>Needs Action</div>
          <div className={styles.panelTitle}>Priority</div>
        </div>
      </div>

      {loading && (
        <div className={styles.emptyState}>Loading…</div>
      )}

      {!loading && items.length === 0 && (
        <div className={styles.emptyState}>
          <Icon name="check" size={18} color="#16a34a" />
          <span>All clear. Nothing needs your attention.</span>
        </div>
      )}

      {!loading && items.map((it, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => nav(it.to)}
          className={styles.priorityRow}
        >
          <span
            className={styles.priorityDot}
            style={{ background: it.color || "#dc2626" }}
          />
          <span className={styles.priorityText}>
            <span className={styles.priorityCount}>{it.count}</span>
            <span className={styles.priorityLabel}>{it.label}</span>
          </span>
          <Icon name="arrow" size={14} color="#94a3b8" />
        </button>
      ))}
    </section>
  );
}


// ---------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------

function ActivityCard({ events, loading }) {

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.panelEyebrow}>Live</div>
          <div className={styles.panelTitle}>Recent Activity</div>
        </div>
        <div className={styles.livePill}>
          <span className={styles.liveDot} />
          Live
        </div>
      </div>

      {loading && (
        <div className={styles.emptyState}>Loading…</div>
      )}

      {!loading && events.length === 0 && (
        <div className={styles.emptyState}>No activity in the last few minutes.</div>
      )}

      {!loading && events.slice(0, 8).map((evt) => (
        <div key={evt.ID} className={styles.activityRow}>
          <div
            className={styles.activityAvatar}
            style={{
              background: evt.RESULT === "SUCCESS" ? "#dcfce7" : "#fee2e2",
              color:      evt.RESULT === "SUCCESS" ? "#166534" : "#991b1b"
            }}
          >
            {(evt.EMPLOYEE_NAME || "?").charAt(0).toUpperCase()}
          </div>
          <div className={styles.activityBody}>
            <div className={styles.activityName}>
              {evt.EMPLOYEE_NAME || `FP #${evt.FINGERPRINT_ID || "?"}`}
            </div>
            <div className={styles.activityMeta}>
              {evt.EMPLOYEE_CODE || "—"} · {evt.DEVICE_ID || "Gate"}
            </div>
          </div>
          <div className={styles.activityTime}>
            {fmtTime(evt.EVENT_TIME)}
          </div>
        </div>
      ))}
    </section>
  );
}


// =====================================================================
// Main page
// =====================================================================

export default function AdminHome() {

  const nav = useNavigate();

  const [stats,      setStats]      = useState(null);
  const [board,      setBoard]      = useState(null);
  const [leave,      setLeave]      = useState(null);
  const [quality,    setQuality]    = useState(null);
  const [production, setProduction] = useState(null);
  const [approvals,  setApprovals]  = useState(null);
  const [lowStock,   setLowStock]   = useState({ total: 0, rows: [] });
  const [events,     setEvents]     = useState([]);
  const [loading,    setLoading]    = useState(true);

  const fetchAll = async () => {
    const safe = (p, fallback) => p.then((r) => r.data).catch(() => fallback);

    const [
      statsData, boardData, leaveData, qualityData,
      prodData,  apprData,  lowData,   eventsData
    ] = await Promise.all([
      safe(API.get("/admin/dashboard-stats"),            null),
      safe(API.get("/attendance/live-board"),            null),
      safe(API.get("/leave/dashboard?vendor_id=1"),      null),
      safe(API.get("/quality/dashboard?vendor_id=1"),    null),
      safe(API.get("/production/dashboard?vendor_id=1"), null),
      safe(API.get("/admin/approvals/pending"),          null),
      safe(API.get("/inventory?status=LOW_STOCK&limit=5"), []),
      safe(API.get("/biometric/events?limit=8"),          [])
    ]);

    setStats(statsData || {});
    setBoard(boardData);
    setLeave(leaveData);
    setQuality(qualityData);
    setProduction(prodData);
    setApprovals(apprData);

    const lowRows = Array.isArray(lowData) ? lowData : (lowData?.rows || []);
    setLowStock({ total: lowRows.length, rows: lowRows });

    setEvents(Array.isArray(eventsData) ? eventsData : []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // -------- Derived: executive KPIs ----------------------------------

  const kpis = useMemo(() => {
    const inOffice    = board?.summary?.in_office;
    const totalActive = board?.summary?.total_active;

    return [
      {
        iconName: "users",
        label:    "In Office",
        value:    inOffice !== undefined
                    ? `${inOffice} / ${totalActive ?? 0}`
                    : "—",
        sub:      "today",
        accent:   "#dc2626",
        to:       "/attendance"
      },
      {
        iconName: "rupee",
        label:    "Revenue",
        value:    stats?.monthly_revenue !== undefined
                    ? inrShort(stats.monthly_revenue)
                    : "—",
        sub:      "this month",
        accent:   "#0891b2",
        to:       "/sales-orders"
      },
      {
        iconName: "cart",
        label:    "Sales Orders",
        value:    fmtIntOrDash(stats?.total_sales_orders),
        sub:      "active",
        accent:   "#d4a017",
        to:       "/sales-orders"
      },
      {
        iconName: "factory",
        label:    "Work Orders",
        value:    fmtIntOrDash(stats?.production_status?.TOTAL_ACTIVE
                              ?? production?.total_work_orders),
        sub:      "in production",
        accent:   "#7c3aed",
        to:       "/production"
      }
    ];
  }, [stats, board, production]);


  // -------- Derived: module cards ------------------------------------

  const modules = useMemo(() => {
    const present     = board?.summary?.in_office;
    const activeCount = board?.summary?.total_active;
    const onLeave     = leave?.on_leave_today;
    const pendingLv   = stats?.leave_requests_pending;

    const passRate    = quality?.pass_rate_pct;
    const openNCRs    = quality?.open_ncrs;

    const soTotal     = stats?.total_sales_orders;
    const custTotal   = stats?.total_customers;
    const quotations  = stats?.total_quotations;

    const wosLive     = stats?.production_status?.TOTAL_ACTIVE;
    const wipUnits    = production?.total_units_in_progress;

    const invValue    = stats?.inventory_value;
    const lowCount    = lowStock.total;

    return [
      {
        iconName: "users",
        title:    "Human Resources",
        accent:   "#dc2626",
        to:       "/employees",
        blurb:    "Employees, attendance, shifts, leave",
        metrics: [
          { label: "Present today", value: present !== undefined ? `${present} / ${activeCount ?? 0}` : "—" },
          { label: "On leave",      value: fmtIntOrDash(onLeave) },
          { label: "Leave pending", value: fmtIntOrDash(pendingLv) }
        ]
      },
      {
        iconName: "briefcase",
        title:    "Recruitment",
        accent:   "#ea580c",
        to:       "/recruitment",
        blurb:    "Requisitions, candidates, offers",
        metrics: [
          { label: "Module status", value: "Ready" },
          { label: "Open positions", value: "—" },
          { label: "Offers pending", value: "—" }
        ]
      },
      {
        iconName: "cash",
        title:    "Payroll",
        accent:   "#16a34a",
        to:       "/payroll",
        blurb:    "Payslips, allowances, star performance",
        metrics: [
          { label: "Active employees", value: fmtIntOrDash(activeCount) },
          { label: "This month",       value: "Run pending" },
          { label: "Allowances",       value: "Configured" }
        ]
      },
      {
        iconName: "handshake",
        title:    "Sales & CRM",
        accent:   "#0891b2",
        to:       "/sales-orders",
        blurb:    "Customers, quotations, sales orders",
        metrics: [
          { label: "Customers",   value: fmtIntOrDash(custTotal) },
          { label: "Quotations",  value: fmtIntOrDash(quotations) },
          { label: "Sales orders", value: fmtIntOrDash(soTotal) }
        ]
      },
      {
        iconName: "target",
        title:    "Lead Management",
        accent:   "#d4a017",
        to:       "/lead-management/leads",
        blurb:    "Live leads, WhatsApp, polling",
        metrics: [
          { label: "Module status",  value: "Ready" },
          { label: "Live viewer",    value: "Available" },
          { label: "Polling",        value: "Configured" }
        ]
      },
      {
        iconName: "factory",
        title:    "Manufacturing",
        accent:   "#7c3aed",
        to:       "/production",
        blurb:    "BOM, work orders, machines, work centres",
        metrics: [
          { label: "Active WOs",   value: fmtIntOrDash(wosLive) },
          { label: "Units in WIP", value: fmtIntOrDash(wipUnits) },
          { label: "Done today",   value: fmtIntOrDash(production?.units_done_today) }
        ]
      },
      {
        iconName: "shield",
        title:    "Quality Control",
        accent:   "#059669",
        to:       "/quality",
        blurb:    "Inspections, NCRs, pass-rate",
        metrics: [
          { label: "Pass rate",  value: passRate !== undefined ? `${Math.round(passRate)}%` : "—" },
          { label: "Open NCRs",  value: fmtIntOrDash(openNCRs) },
          { label: "Critical",   value: fmtIntOrDash(quality?.critical_open_ncrs) }
        ]
      },
      {
        iconName: "box",
        title:    "Inventory & Suppliers",
        accent:   "#0f172a",
        to:       "/inventory",
        blurb:    "Products, stock, suppliers, purchase",
        metrics: [
          { label: "Inventory value", value: invValue !== undefined ? inrShort(invValue) : "—" },
          { label: "Low stock",       value: fmtIntOrDash(lowCount) },
          { label: "Purchase orders", value: fmtIntOrDash(stats?.purchase_orders) }
        ]
      }
    ];
  }, [stats, board, leave, quality, production, lowStock]);


  // -------- Derived: priority list -----------------------------------

  const priorityItems = useMemo(() => {
    const list = [];

    const pendingLv = stats?.leave_requests_pending || 0;
    if (pendingLv > 0) {
      list.push({
        count: pendingLv,
        label: pendingLv === 1 ? "leave request pending" : "leave requests pending",
        to: "/leave-management",
        color: "#d4a017"
      });
    }

    const low = lowStock.total || 0;
    if (low > 0) {
      list.push({
        count: low,
        label: low === 1 ? "item running low on stock" : "items running low on stock",
        to: "/inventory",
        color: "#dc2626"
      });
    }

    const critNCR = quality?.critical_open_ncrs || 0;
    if (critNCR > 0) {
      list.push({
        count: critNCR,
        label: critNCR === 1 ? "critical NCR open" : "critical NCRs open",
        to: "/quality",
        color: "#dc2626"
      });
    }

    const openNCR = (quality?.open_ncrs || 0) - critNCR;
    if (openNCR > 0) {
      list.push({
        count: openNCR,
        label: openNCR === 1 ? "quality NCR to review" : "quality NCRs to review",
        to: "/quality",
        color: "#0891b2"
      });
    }

    const apprBuckets = approvals?.buckets || {};
    const apprCount = Object.values(apprBuckets).reduce((sum, v) => {
      if (Array.isArray(v)) return sum + v.length;
      if (v && typeof v === "object") return sum + (v.count || 0);
      return sum;
    }, 0);
    if (apprCount > 0) {
      list.push({
        count: apprCount,
        label: apprCount === 1 ? "approval waiting" : "approvals waiting",
        to: "/approvals",
        color: "#7c3aed"
      });
    }

    const pendingPay = stats?.pending_payments || 0;
    if (pendingPay > 0) {
      list.push({
        count: inrShort(pendingPay),
        label: "in pending customer payments",
        to: "/sales-orders",
        color: "#16a34a"
      });
    }

    return list;
  }, [stats, quality, approvals, lowStock]);


  // -------- Render ---------------------------------------------------

  return (
    <div className={styles.page}>

      <Header />

      {/* Executive KPI row */}
      <section className={styles.kpiRow}>
        {kpis.map((k) => (
          <KpiTile
            key={k.label}
            iconName={k.iconName}
            label={k.label}
            value={k.value}
            sub={k.sub}
            accent={k.accent}
            onClick={() => nav(k.to)}
          />
        ))}
      </section>

      {/* Modules — the ERP at a glance */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <div className={styles.sectionEyebrow}>ERP At A Glance</div>
            <div className={styles.sectionTitle}>Modules</div>
          </div>
          <div className={styles.sectionSub}>
            Every module in one view. Click any card to open it.
          </div>
        </div>

        <div className={styles.modulesGrid}>
          {modules.map((m) => (
            <ModuleCard key={m.title} {...m} />
          ))}
        </div>
      </section>

      {/* Priority + Activity */}
      <section className={styles.bottomRow}>
        <PriorityCard items={priorityItems} loading={loading} />
        <ActivityCard events={events}       loading={loading} />
      </section>

      <footer className={styles.footer}>
        Auto-refreshing every 30 seconds · BVC24 Enterprise ERP
      </footer>
    </div>
  );
}
