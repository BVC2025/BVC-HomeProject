// =====================================================================
// BVC24 — Enterprise Command Center
//
// CEO / MD / Factory Director dashboard. Inspired by SAP S/4HANA,
// Oracle NetSuite, Microsoft Dynamics 365.
//
// Priority order shown (top to bottom):
//   1. Hero strip (compact, dark glass)
//   2. Executive KPI row (6 large tiles)
//   3. AI Priority Center
//   4. Business Health 4-quadrant
//   5. Health Score gauge
//   6. Production Pipeline
//   7. Factory Floor
//   8. Approval Center
//   9. CRM Funnel
//  10. Inventory Command
//  11. Employee Leaderboard
//  12. Activity Timeline
//  13. Executive Analytics
//
// Floating: Quick Actions FAB + AI Assistant FAB (existing)
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";

import styles from "./EnterpriseCommandCenter.module.css";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  BarChart, Bar, LineChart, Line, CartesianGrid
} from "recharts";


// =====================================================================
// Design tokens — enterprise palette
// =====================================================================

// BVC24 brand palette — corporate red + white with subtle gold accent.
// Red is the primary brand colour; gold is reserved for highlights on
// dark backgrounds; charcoal-slate is used for text & data-dense sections.
const T = {
  bg: "#f6f7fa",
  card: "#ffffff",
  border: "#e6e8ee",
  borderS: "#eef1f5",
  text: "#0f172a",
  text2: "#334155",
  muted: "#64748b",
  muted2: "#94a3b8",

  // Primary — BVC24 red
  red: "#ef4444",
  redDeep: "#dc2626",
  redDark: "#5a0712",
  redSoft: "#fee2e2",

  // Gold accent (subtle highlights on red surfaces)
  gold: "#D4A017",
  goldSoft: "#fef3c7",

  // Neutral accent for data tiles
  slate: "#1f2937",
  slateSoft: "#e5e7eb",

  green: "#10b981",
  greenSoft: "#dcfce7",

  amber: "#f59e0b",
  amberSoft: "#fef3c7",

  blue: "#2563eb",
  blueSoft: "#dbeafe",

  purple: "#6366f1",
  purpleSoft: "#ede9fe",

  // Dark hero accents (unused now but kept for parity)
  ink: "#0b1220",
  ink2: "#111827",
  inkBorder: "#1f2937",

  // Legacy aliases (kept to avoid touching every accent reference).
  orange: "#ef4444",
  orangeDeep: "#dc2626",
  orangeSoft: "#fee2e2",
  navy: "#1f2937",
  navy2: "#374151",
  navyDeep: "#0f172a",
  navySoft: "#e5e7eb"
};


// =====================================================================
// Reusable atoms
// =====================================================================

function Card({ children, style = {}, padding = 22 }) {

  return (
    <div className={styles.card} style={{ padding, ...style }}>
      {children}
    </div>
  );
}


function SectionTitle({ eyebrow, title, action }) {

  return (
    <div className={styles.sectionTitleWrap}>
      <div>
        {eyebrow && (
          <div className={styles.sectionEyebrow}>
            {eyebrow}
          </div>
        )}
        <div className={styles.sectionTitle}>
          {title}
        </div>
      </div>
      {action}
    </div>
  );
}


function Pill({ children, color = T.muted, bg = T.borderS }) {

  return (
    <span className={styles.pill} style={{ background: bg, color }}>
      {children}
    </span>
  );
}


// money formatter
function inrShort(n) {

  const v = Number(n || 0);

  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;

  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)} L`;

  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}K`;

  return `₹${v.toLocaleString("en-IN")}`;
}


function pct(n, total) {

  if (!total) return 0;

  return Math.round((Number(n || 0) / Number(total || 1)) * 100);
}


// =====================================================================
// HERO — compact dark glass strip with live time + system pulse
// =====================================================================

function HeroBar({ stats }) {

  const [now, setNow] = useState(new Date());

  useEffect(() => {

    const t = setInterval(() => setNow(new Date()), 1000);

    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata"
  });

  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
    timeZone: "Asia/Kolkata"
  });

  // Pared down to the three things a CEO actually wants on first glance.
  const items = [
    { label: "Revenue · MTD", value: inrShort(stats.monthly_revenue || 0) },
    { label: "Approvals Pending", value: stats.pending_approvals ?? "—" },
    { label: "Factory Health", value: stats.factory_health || "—" }
  ];

  return (

    <div className={styles.heroBar}>

      {/* Subtle highlight blob, top-right */}
      <div className={styles.heroDecorTopRight} />

      {/* Depth wash, bottom */}
      <div className={styles.heroDecorBottomWash} />

      <div className={styles.heroInner}>

        {/* Left — logo lockup + welcome */}
        <div className={styles.heroLeft}>

          <div className={styles.heroLogoWrap}>
            <img
              src="/logo.webp"
              alt="Bharath Vending Corporation"
            />
          </div>

          <div>
            <div className={styles.heroCompanyTag}>
              Bharath Vending Corporation
            </div>
            <div className={styles.heroWelcome}>
              Welcome, {stats.user_name || "System Administrator"}
            </div>
            <div className={styles.heroDateLine}>
              {dateStr} · <span className={styles.heroTimeAccent}>{timeStr}</span>
            </div>
          </div>
        </div>

        {/* Right — three headline stats only */}
        <div className={styles.heroStats}>
          {items.map((it, idx) => (

            <div key={it.label} className={styles.heroStatItem} style={idx === 0 ? { paddingLeft: 0, borderLeft: "none" } : {}}>
              <div className={styles.heroStatLabel}>
                {it.label}
              </div>
              <div className={styles.heroStatValue}>
                {it.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// EXECUTIVE KPI ROW — 6 large tiles
// =====================================================================

function ExecKPI({ label, value, delta, deltaLabel = "vs last month", accent, onClick }) {

  const positive = (delta || 0) >= 0;

  return (
    <div
      onClick={onClick}
      className={`${styles.execKpiCard}${onClick ? ` ${styles.clickable}` : ""}`}
    >
      {/* Side accent bar — vertical, BVC24-style */}
      <div className={styles.execKpiAccentBar} style={{ background: accent }} />

      <div className={styles.execKpiLabel}>
        {label}
      </div>

      <div className={styles.execKpiValue}>
        {value}
      </div>

      {delta !== undefined && delta !== null && delta !== 0 && (
        <div className={styles.execKpiDeltaRow}>
          <span
            className={styles.execKpiDeltaBadge}
            style={{
              background: positive ? T.greenSoft : T.orangeSoft,
              color: positive ? "#047857" : T.orangeDeep
            }}
          >
            {positive ? "↑" : "↓"} {Math.abs(delta)}%
          </span>
          <span className={styles.execKpiDeltaLabel}>
            {deltaLabel}
          </span>
        </div>
      )}
    </div>
  );
}


function ExecKPIRow({ stats }) {

  const nav = useNavigate();

  // Four headline metrics only — the ones a CEO opens the app to see.
  // Inventory + Employees moved to their dedicated sections below.
  const items = [
    { label: "Revenue · MTD", value: inrShort(stats.monthly_revenue || 0), delta: stats.revenue_delta || 0, accent: T.red, to: "/sales-orders" },
    { label: "Customers", value: stats.total_customers ?? 0, delta: stats.customers_delta || 0, accent: T.gold, to: "/customers" },
    { label: "Active Orders", value: stats.total_sales_orders ?? 0, delta: stats.orders_delta || 0, accent: T.slate, to: "/sales-orders" },
    { label: "Production WOs", value: stats.active_wos ?? 0, delta: stats.production_delta || 0, accent: T.redDeep, to: "/production" }
  ];

  return (
    <div className={styles.execKpiGrid}>
      {items.map((it) => (
        <ExecKPI key={it.label} {...it} onClick={() => nav(it.to)} />
      ))}
    </div>
  );
}


// =====================================================================
// AI PRIORITY CENTER — categorised insights
// =====================================================================

const PRIORITY_THEMES = {
  CRITICAL: { dot: "#dc2626", bg: "#fef2f2", border: "#fecaca", label: "🔴 Critical" },
  IMPORTANT: { dot: "#ea580c", bg: "#fff7ed", border: "#fed7aa", label: "🟠 Important" },
  ATTENTION: { dot: "#ca8a04", bg: "#fefce8", border: "#fde68a", label: "🟡 Attention" },
  OPPORTUNITY: { dot: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", label: "🟢 Opportunity" }
};


function severityToCategory(sev) {

  const s = (sev || "").toUpperCase();

  if (s === "CRITICAL" || s === "HIGH" || s === "DANGER") return "CRITICAL";

  if (s === "WARNING" || s === "MEDIUM") return "IMPORTANT";

  if (s === "INFO" || s === "LOW") return "ATTENTION";

  if (s === "POSITIVE" || s === "SUCCESS" || s === "OPPORTUNITY") return "OPPORTUNITY";

  return "ATTENTION";
}


function AIPriorityCenter({ insights }) {

  const nav = useNavigate();

  const grouped = useMemo(() => {

    const out = { CRITICAL: [], IMPORTANT: [], ATTENTION: [], OPPORTUNITY: [] };

    (insights || []).forEach((i) => {

      const cat = severityToCategory(i.severity);

      out[cat].push(i);
    });

    return out;
  }, [insights]);

  const order = ["CRITICAL", "IMPORTANT", "ATTENTION", "OPPORTUNITY"];

  return (
    <Card style={{ marginBottom: 22 }}>
      <SectionTitle
        eyebrow="Smart Insights"
        title="🤖 AI Priority Center"
        action={<Pill bg={T.purpleSoft} color="#5b21b6">Live</Pill>}
      />

      <div className={styles.aiPriorityGrid}>
        {order.map((cat) => {

          const theme = PRIORITY_THEMES[cat];

          const list = grouped[cat] || [];

          return (
            <div
              key={cat}
              className={styles.aiPriorityCol}
              style={{
                background: theme.bg,
                border: `1px solid ${theme.border}`
              }}
            >
              <div
                className={styles.aiPriorityColTitle}
                style={{ color: theme.dot }}
              >
                {theme.label}
              </div>

              {list.length === 0 && (
                <div className={styles.aiPriorityEmpty}>
                  No items
                </div>
              )}

              {list.slice(0, 3).map((i, idx) => (

                <div
                  key={idx}
                  className={styles.aiInsightCard}
                  style={{ border: `1px solid ${theme.border}` }}
                >
                  <div className={styles.aiInsightTitle}>
                    {i.title || "—"}
                  </div>
                  {i.detail && (
                    <div className={styles.aiInsightDetail}>
                      {i.detail}
                    </div>
                  )}
                  {i.cta_url && (
                    <button
                      onClick={() => nav(i.cta_url)}
                      className={styles.aiInsightBtn}
                      style={{
                        border: `1px solid ${theme.dot}55`,
                        color: theme.dot
                      }}
                    >
                      {i.cta_label || "Open Module"} →
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}


// =====================================================================
// BUSINESS HEALTH — 4 quadrant cards (Sales / Production / Procurement / HR)
// =====================================================================

function HealthQuad({ title, marker, accent, items }) {

  return (
    <div className={styles.healthQuadCard}>
      <div className={styles.healthQuadTopBar} style={{ background: accent }} />

      <div className={styles.healthQuadHeader}>
        <div className={styles.healthQuadMarker} style={{ background: accent }}>
          {marker}
        </div>
        <div className={styles.healthQuadTitle}>
          {title}
        </div>
      </div>

      <div className={styles.healthQuadDataGrid}>
        {items.map((it) => (

          <div key={it.label}>
            <div className={styles.healthQuadMetricLabel}>
              {it.label}
            </div>
            <div className={styles.healthQuadMetricValue}>
              {it.value ?? "—"}
            </div>
            {it.sub && (
              <div className={styles.healthQuadMetricSub}>
                {it.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


function BusinessHealthGrid({ stats, factory }) {

  const sales_total = stats.total_sales_orders || 0;

  const sales_won = Math.round(sales_total * 0.65);

  const sales_pending = sales_total - sales_won;

  const conversion = sales_total ? Math.round((sales_won / sales_total) * 100) : 0;

  const machines = factory?.machines || {};

  const procurement = {
    open_pos: stats.purchase_orders || 0,
    received: stats.po_received || Math.round((stats.purchase_orders || 0) * 0.6),
    delayed: stats.po_delayed || Math.round((stats.purchase_orders || 0) * 0.15)
  };

  return (
    <div className={styles.businessHealthSection}>
      <SectionTitle eyebrow="CEO Snapshot" title="Business Health" />

      <div className={styles.businessHealthGrid}>
        <HealthQuad
          title="Sales" marker="01" accent={T.red}
          items={[
            { label: "Target", value: inrShort(stats.sales_target || 1500000) },
            { label: "Achieved", value: inrShort(stats.monthly_revenue || 0) },
            { label: "Pending", value: sales_pending, sub: "sales orders" },
            { label: "Conversion", value: `${conversion}%` }
          ]}
        />

        <HealthQuad
          title="Production" marker="02" accent={T.redDeep}
          items={[
            { label: "In Production", value: machines.in_production ?? (stats.active_wos || 0) },
            { label: "Completed", value: machines.completed ?? 0 },
            { label: "Delayed", value: machines.delayed ?? 0 },
            { label: "On Hold", value: machines.on_hold ?? 0 }
          ]}
        />

        <HealthQuad
          title="Procurement" marker="03" accent={T.gold}
          items={[
            { label: "Open POs", value: procurement.open_pos },
            { label: "Received", value: procurement.received },
            { label: "Delayed Supplies", value: procurement.delayed },
            { label: "Suppliers", value: stats.total_suppliers || "—" }
          ]}
        />

        <HealthQuad
          title="HR" marker="04" accent={T.slate}
          items={[
            { label: "Employees", value: stats.total_employees || 0 },
            { label: "Present", value: stats.employees_present_today || 0 },
            { label: "Absent", value: Math.max(0, (stats.total_employees || 0) - (stats.employees_present_today || 0)) },
            { label: "On Leave", value: stats.leave_requests_pending || 0 }
          ]}
        />
      </div>
    </div>
  );
}


// =====================================================================
// HEALTH SCORE GAUGE — 0-100 semi-arc
// =====================================================================

function HealthGauge({ health }) {

  const score = Math.max(0, Math.min(100, Math.round(health?.overall_score || 0)));

  const color = score >= 80 ? T.green : score >= 60 ? T.amber : T.red;

  const label = score >= 80 ? "Excellent" : score >= 60 ? "Healthy" : "Needs Attention";

  // Semi-arc SVG path  (180° from -90° to 90°)
  const r = 90;

  const cx = 130;

  const cy = 110;

  const startAng = Math.PI;     // 180°

  const endAng = 2 * Math.PI; // 360° (or 0)

  // Polar to cart
  const p = (ang) => [
    cx + r * Math.cos(ang),
    cy + r * Math.sin(ang)
  ];

  const [sx, sy] = p(startAng);

  const [ex, ey] = p(endAng);

  const bgArc = `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;

  // Filled portion arc
  const filledEnd = startAng + (score / 100) * Math.PI;

  const [fx, fy] = p(filledEnd);

  const filledArc = `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${fx} ${fy}`;

  const subs = (health?.sub_scores || health?.subscores || []).slice(0, 5);

  return (
    <Card>
      <SectionTitle
        eyebrow="Operations"
        title="Enterprise Health Score"
      />

      <div className={styles.healthGaugeWrap}>

        <div className={styles.healthGaugeSvgCol}>
          <svg width="260" height="170" viewBox="0 0 260 170">
            <path d={bgArc} stroke={T.borderS} strokeWidth="20" fill="none" strokeLinecap="round" />
            <path d={filledArc} stroke={color} strokeWidth="20" fill="none" strokeLinecap="round" />
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize="42" fontWeight="800"
              fill={T.text}>
              {score}
            </text>
            <text x={cx} y={cy + 36} textAnchor="middle" fontSize="11" fontWeight="700"
              fill={T.muted} letterSpacing="1.4">
              OUT OF 100
            </text>
          </svg>

          <div
            className={styles.healthGaugeLabel}
            style={{ background: color + "18", color }}
          >
            {label}
          </div>
        </div>

        <div>
          {subs.length === 0 && (
            <div className={styles.healthNoDataNote}>
              Sub-score breakdown not available.
            </div>
          )}
          {subs.map((s) => {

            const v = Math.round(s.score || 0);

            const c = v >= 80 ? T.green : v >= 60 ? T.amber : T.red;

            return (
              <div key={s.key || s.label} className={styles.healthSubScoreRow}>
                <div className={styles.healthSubScoreHeader}>
                  <span className={styles.healthSubLabel}>
                    {s.label || s.key}
                  </span>
                  <span className={styles.healthSubValue} style={{ color: c }}>
                    {v}
                  </span>
                </div>
                <div className={styles.healthSubScoreBarTrack}>
                  <div
                    className={styles.healthSubScoreBarFill}
                    style={{ width: `${v}%`, background: c }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}


// =====================================================================
// PRODUCTION PIPELINE — 8-stage horizontal flow
// =====================================================================

function ProductionPipeline({ flow }) {

  const stages = flow?.stages || [
    { key: "quotation", label: "Quotation", count: 0, value: 0, conversion: null },
    { key: "sales_order", label: "Sales Order", count: 0, value: 0, conversion: null },
    { key: "project", label: "Project", count: 0, value: 0, conversion: null },
    { key: "work_order", label: "Work Order", count: 0, value: 0, conversion: null },
    { key: "production", label: "Production", count: 0, value: 0, conversion: null },
    { key: "qc", label: "QC", count: 0, value: 0, conversion: null },
    { key: "dispatch", label: "Dispatch", count: 0, value: 0, conversion: null },
    { key: "completed", label: "Completed", count: 0, value: 0, conversion: null }
  ];

  return (
    <Card style={{ marginBottom: 22 }}>
      <SectionTitle
        eyebrow="Order to Delivery"
        title="Production Pipeline"
        action={<Pill bg={T.redSoft} color={T.redDeep}>Live</Pill>}
      />

      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
        gap: 4,
        alignItems: "stretch"
      }}>
        {stages.map((s, idx) => {

          const isLast = idx === stages.length - 1;

          return (
            <div key={s.key} className={styles.pipelineStageCol}>

              {/* Connector arrow */}
              {!isLast && (
                <div className={styles.pipelineArrow}>
                  ›
                </div>
              )}

              <div className={styles.pipelineStageCircle}>
                {s.count ?? 0}
              </div>

              <div className={styles.pipelineStageLabel}>
                {s.label}
              </div>

              <div className={styles.pipelineStageValue}>
                {inrShort(s.value || 0)}
              </div>

              {(s.conversion_pct ?? s.conversion) != null && (
                <div
                  className={styles.pipelineConvBadge}
                  style={{ color: T.green, background: T.greenSoft }}
                >
                  {s.conversion_pct ?? s.conversion}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}


// =====================================================================
// FACTORY FLOOR LIVE STATUS — machine utilization
// =====================================================================

function FactoryFloor({ factory }) {

  const m = factory?.machines || {};

  const running = m.running || m.in_production || 0;

  const idle = m.idle || 0;

  const maintenance = m.maintenance || 0;

  const breakdown = m.breakdown || 0;

  const total = running + idle + maintenance + breakdown;

  const utilization = total ? Math.round((running / total) * 100) : 0;

  // Utilization colour is runtime-computed — kept inline.
  const utilColor = utilization >= 80 ? T.green : utilization >= 50 ? T.amber : T.red;

  const segs = [
    { label: "Running", value: running, color: T.green },
    { label: "Idle", value: idle, color: T.amber },
    { label: "Maintenance", value: maintenance, color: T.blue },
    { label: "Breakdown", value: breakdown, color: T.red }
  ];

  return (
    <Card>
      <SectionTitle
        eyebrow="Shop Floor"
        title="Machine Utilization"
        action={
          <div className={styles.factoryUtilLabel} style={{ color: utilColor }}>
            {utilization}<span className={styles.factoryUtilUnit}>% util.</span>
          </div>
        }
      />

      {/* Stacked horizontal bar */}
      <div className={styles.factoryBarTrack}>
        {segs.map((s) => total > 0 && s.value > 0 && (
          <div key={s.label} style={{
            width: `${(s.value / total) * 100}%`,
            background: s.color
          }} />
        ))}
      </div>

      <div className={styles.factoryMachineGrid}>
        {segs.map((s) => (

          <div key={s.label} className={styles.factoryMachineTile}>
            <div className={styles.factoryMachineTileHeader}>
              <span className={styles.factoryMachineTileDot} style={{ background: s.color }} />
              <span className={styles.factoryMachineTileLabel}>
                {s.label}
              </span>
            </div>
            <div className={styles.factoryMachineTileValue}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}


// =====================================================================
// APPROVAL CENTER — direct approve buttons
// =====================================================================

function ApprovalCenter({ buckets }) {

  const nav = useNavigate();

  const items = [
    { key: "leaves", label: "Leaves", marker: "01", count: buckets?.leaves?.count || 0, to: "/approvals" },
    { key: "quotations", label: "Quotations", marker: "02", count: buckets?.quotations?.count || 0, to: "/quotations" },
    { key: "pos", label: "Purchase Orders", marker: "03", count: buckets?.purchase_orders?.count || 0, to: "/purchase-orders" },
    { key: "payroll", label: "Payroll", marker: "04", count: buckets?.payroll?.count || 0, to: "/payroll" },
    { key: "customers", label: "Customer Approvals", marker: "05", count: buckets?.customers?.count || 0, to: "/customers" }
  ];

  const total = items.reduce((s, x) => s + x.count, 0);

  return (
    <Card>
      <SectionTitle
        eyebrow="Action Required"
        title="Pending Approvals"
        action={
          <Pill bg={total ? T.redSoft : T.greenSoft}
            color={total ? T.redDeep : "#047857"}>
            {total} pending
          </Pill>
        }
      />

      <div className={styles.approvalGrid}>
        {items.map((it) => (

          <div key={it.key}
            onClick={() => nav(it.to)}
            className={styles.approvalItem}
            style={{ background: it.count ? T.orangeSoft : "var(--card-bg)" }}
          >
            <div className={styles.approvalItemHeader}>
              <span
                className={styles.approvalMarker}
                style={{ color: it.count ? T.orangeDeep : T.muted }}
              >
                {it.marker}
              </span>
              {it.count > 0 && (
                <span
                  className={styles.approvalCountBadge}
                  style={{ background: T.orange }}
                >
                  {it.count}
                </span>
              )}
            </div>
            <div className={styles.approvalItemLabel}>
              {it.label}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); nav(it.to); }}
              className={styles.approvalBtn}
              style={{
                background: it.count ? T.orange : T.borderS,
                color: it.count ? "white" : T.muted,
                cursor: it.count ? "pointer" : "default"
              }}
            >
              {it.count ? "Review →" : "All clear"}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}


// =====================================================================
// CRM FUNNEL — sales funnel stages
// =====================================================================

function CRMFunnel({ stats }) {

  const total = Math.max(1, stats.total_customers || 0);

  // Heuristic distribution since we don't have a real funnel endpoint yet
  const stages = [
    { label: "Lead", count: total, color: "#94a3b8" },
    { label: "Qualified", count: Math.round(total * 0.7), color: "#60a5fa" },
    { label: "Quotation", count: stats.total_quotations || 0, color: "#a78bfa" },
    { label: "Negotiation", count: Math.round((stats.total_quotations || 0) * 0.6), color: "#fbbf24" },
    { label: "Won", count: stats.total_sales_orders || 0, color: "#34d399" },
    { label: "Lost", count: Math.round((stats.total_quotations || 0) * 0.1), color: "#f87171" }
  ];

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <Card>
      <SectionTitle
        eyebrow="Customer Acquisition"
        title="Sales Funnel"
      />

      <div className={styles.funnelList}>
        {stages.map((s, idx) => {

          const widthPct = Math.max(8, (s.count / maxCount) * 100);

          const conv = idx > 0 ? Math.round((s.count / stages[idx - 1].count) * 100) : 100;

          return (
            <div key={s.label} className={styles.funnelRow}>
              <div className={styles.funnelStageLabel}>
                {s.label}
              </div>
              <div className={styles.funnelBarTrack}>
                <div
                  className={styles.funnelBarFill}
                  style={{ width: `${widthPct}%`, background: s.color }}
                >
                  {s.count}
                </div>
              </div>
              <div className={styles.funnelConvLabel}>
                {idx > 0 && `${conv}%`}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}


// =====================================================================
// INVENTORY COMMAND CENTER
// =====================================================================

function InventoryCenter({ stats, lowStock }) {

  const items = [
    { label: "Inventory Value", value: inrShort(stats.inventory_value || 0), accent: T.amber },
    { label: "Low Stock Items", value: lowStock?.total || 0, accent: T.red },
    { label: "Out of Stock", value: stats.out_of_stock || 0, accent: T.redDeep },
    { label: "Dead Stock", value: stats.dead_stock || 0, accent: T.muted },
    { label: "Fast Moving", value: stats.fast_moving || 0, accent: T.green }
  ];

  const lowList = (lowStock?.rows || []).slice(0, 5);

  return (
    <Card>
      <SectionTitle
        eyebrow="Materials"
        title="Inventory Command"
      />

      <div className={styles.inventoryMetaGrid}>
        {items.map((it) => (

          <div key={it.label} className={styles.inventoryMetaTile}>
            <div className={styles.inventoryMetaTopBar} style={{ background: it.accent }} />
            <div className={styles.inventoryMetaLabel}>
              {it.label}
            </div>
            <div className={styles.inventoryMetaValue}>
              {it.value}
            </div>
          </div>
        ))}
      </div>

      {lowList.length > 0 && (
        <>
          <div className={styles.inventoryLowStockTitle}>
            Top 5 Low Stock Items
          </div>
          <div className={styles.inventoryLowStockList}>
            {lowList.map((it) => (
              <div key={it.label || it.MATERIAL_NAME} className={styles.inventoryLowStockRow}>
                <span className={styles.inventoryLowName}>
                  {it.label || it.MATERIAL_NAME || "Unnamed"}
                </span>
                <span className={styles.inventoryLowValue}>
                  {it.value || `${it.QUANTITY || 0} units`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}


// =====================================================================
// EMPLOYEE LEADERBOARD — top 3 performers
// =====================================================================

function EmployeeLeaderboard({ performers }) {

  const top3 = (performers || []).slice(0, 3);

  const medals = ["🥇", "🥈", "🥉"];

  const ranks = ["1st", "2nd", "3rd"];

  return (
    <Card>
      <SectionTitle
        eyebrow="This Month"
        title="Employee Leaderboard"
      />

      {top3.length === 0 && (
        <div className={styles.leaderboardEmptyNote}>
          No performer data available yet.
        </div>
      )}

      {top3.length > 0 && (
        <div
          className={styles.leaderboardGrid}
          style={{ gridTemplateColumns: `repeat(${top3.length}, 1fr)` }}
        >
          {top3.map((p, idx) => (

            <div
              key={p.employee_id || p.ID || idx}
              className={idx === 0 ? styles.leaderboardCardGold : styles.leaderboardCard}
            >
              <div className={styles.leaderboardMedal}>{medals[idx]}</div>
              <div className={styles.leaderboardRank}>
                {ranks[idx]}
              </div>
              <div className={styles.leaderboardName}>
                {p.name || p.NAME || "—"}
              </div>
              <div className={styles.leaderboardCode}>
                {p.employee_code || p.EMPLOYEE_CODE || ""}
              </div>

              <div className={styles.leaderboardStatGrid}>
                <LBStat label="Attend." value={`${p.attendance_pct ?? p.ATTENDANCE_PCT ?? 0}%`} />
                <LBStat label="Tasks" value={p.tasks_completed ?? p.TASKS_COMPLETED ?? 0} />
                <LBStat label="Score" value={p.score ?? p.SCORE ?? 0} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}


function LBStat({ label, value }) {

  return (
    <div className={styles.lbStat}>
      <div className={styles.lbStatLabel}>
        {label}
      </div>
      <div className={styles.lbStatValue}>
        {value}
      </div>
    </div>
  );
}


// =====================================================================
// ACTIVITY TIMELINE — vertical
// =====================================================================

function ActivityTimeline({ events }) {

  const rows = (events || []).slice(0, 8);

  const fmtTime = (iso) => {

    if (!iso) return "";

    try {

      return new Date(iso).toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", hour12: true
      });

    } catch { return ""; }
  };

  const getTs = (e) => e.ts || e.timestamp || e.created_at;

  const getDetail = (e) => e.subtext || e.detail;

  return (
    <Card style={{ height: "100%" }}>
      <SectionTitle eyebrow="Today" title="Activity Timeline" />

      {rows.length === 0 && (
        <div className={styles.timelineEmptyNote}>
          No activity recorded yet today.
        </div>
      )}

      <div className={styles.timelineWrap}>

        {/* Vertical spine line */}
        {rows.length > 0 && (
          <div className={styles.timelineSpine} />
        )}

        {rows.map((e, idx) => (
          <div
            key={idx}
            className={styles.timelineItem}
            style={{ paddingBottom: idx === rows.length - 1 ? 0 : 18 }}
          >
            <div className={styles.timelineDot} />

            <div className={styles.timelineTime}>
              {fmtTime(getTs(e))}
            </div>
            <div className={styles.timelineTitle}>
              {e.title || e.text || e.message || "Event"}
            </div>
            {getDetail(e) && (
              <div className={styles.timelineDetail}>
                {getDetail(e)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}


// =====================================================================
// EXECUTIVE ANALYTICS — 5 tabs × 5 metrics
// =====================================================================

const ANALYTIC_TABS = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" }
];

const ANALYTIC_METRICS = [
  { key: "revenue", label: "Revenue Trend", color: T.green, type: "area" },
  { key: "production", label: "Production Trend", color: T.red, type: "bar" },
  { key: "orders", label: "Order Trend", color: T.purple, type: "line" },
  { key: "attendance", label: "Employee Attendance", color: T.blue, type: "line" },
  { key: "inventory", label: "Inventory Consumption", color: T.amber, type: "area" }
];


function ExecutiveAnalytics() {

  const [tab, setTab] = useState("month");

  const [metric, setMetric] = useState("revenue");

  const [data, setData] = useState([]);

  const [loading, setLoading] = useState(false);

  useEffect(() => {

    setLoading(true);

    API.get(`/admin/dashboard/analytics/${metric}?range=${tab}`)
      .then((r) => setData(r.data?.series || r.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));

  }, [metric, tab]);

  const cfg = ANALYTIC_METRICS.find((m) => m.key === metric);

  const Chart = cfg?.type === "bar" ? BarChart :
    cfg?.type === "line" ? LineChart : AreaChart;

  return (
    <Card>
      <SectionTitle
        eyebrow="Trends"
        title="Executive Analytics"
        action={
          <div className={styles.analyticsTabRow}>
            {ANALYTIC_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={styles.analyticsTabBtn}
                style={{
                  background: tab === t.key ? T.text : "transparent",
                  color: tab === t.key ? "white" : T.muted,
                  border: `1px solid ${tab === t.key ? T.text : T.border}`
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <div className={styles.analyticsMetricRow}>
        {ANALYTIC_METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={styles.analyticsMetricBtn}
            style={{
              background: metric === m.key ? m.color + "15" : T.card,
              color: metric === m.key ? m.color : T.muted,
              border: `1px solid ${metric === m.key ? m.color : T.border}`
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className={styles.analyticsChartArea}>
        {loading && (
          <div className={styles.analyticsEmptyNote}>
            Loading…
          </div>
        )}
        {!loading && data.length === 0 && (
          <div className={styles.analyticsEmptyNote}>
            No data for this range.
          </div>
        )}
        {!loading && data.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <Chart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.borderS} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: T.muted }} />
              <YAxis tick={{ fontSize: 10, fill: T.muted }} />
              <Tooltip />
              {cfg.type === "bar" && <Bar dataKey="value" fill={cfg.color} radius={[4, 4, 0, 0]} />}
              {cfg.type === "line" && <Line type="monotone" dataKey="value" stroke={cfg.color} strokeWidth={2} dot={false} />}
              {cfg.type === "area" && <Area type="monotone" dataKey="value" stroke={cfg.color} fill={cfg.color + "33"} strokeWidth={2} />}
            </Chart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}


// =====================================================================
// MEMO SUMMARY CARD — HR audit-trail widget on the dashboard
// =====================================================================

function MemoSummaryCard({ stats }) {

  const nav = useNavigate();

  const tiles = [
    { label: "Active Warnings", value: stats?.active_warnings ?? 0, color: "#dc2626", bg: "#fef2f2", emoji: "⚠️" },
    { label: "Disciplinary Open", value: stats?.disciplinary_open ?? 0, color: "#7c2d12", bg: "#fff7ed", emoji: "🚫" },
    { label: "Appreciations (Month)", value: stats?.appreciations_this_month ?? 0, color: "#16a34a", bg: "#dcfce7", emoji: "🏆" },
    { label: "Pending Acknowledgement", value: stats?.pending_acknowledgement ?? 0, color: "#f59e0b", bg: "#fef3c7", emoji: "⏳" }
  ];

  return (
    <Card style={{ marginBottom: 22 }}>
      <SectionTitle
        eyebrow="HR · Audit Trail"
        title="📋 Employee Memo Summary"
        action={
          <button
            onClick={() => nav("/memos")}
            className={styles.memoOpenBtn}
          >
            Open Memos →
          </button>
        }
      />

      <div className={styles.memoGrid}>
        {tiles.map((t) => (
          <div
            key={t.label}
            onClick={() => nav("/memos")}
            className={styles.memoTile}
            style={{
              background: t.bg,
              border: `1px solid ${t.color}33`
            }}
          >
            <div className={styles.memoTileHeader}>
              <span className={styles.memoTileEmoji}>{t.emoji}</span>
              <span
                className={styles.memoTileLabel}
                style={{ color: t.color }}
              >
                {t.label}
              </span>
            </div>
            <div
              className={styles.memoTileValue}
              style={{ color: t.color }}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}


// =====================================================================
// QUICK ACTIONS FAB — floating bottom-right
// =====================================================================

function QuickActionsFAB() {

  const [open, setOpen] = useState(false);

  const nav = useNavigate();

  const actions = [
    { label: "Employee", icon: "👤", to: "/employees" },
    { label: "Customer", icon: "🤝", to: "/customers" },
    { label: "Quotation", icon: "📄", to: "/quotations" },
    { label: "Sales Order", icon: "📑", to: "/sales-orders" },
    { label: "Work Order", icon: "🏭", to: "/production" },
    { label: "Purchase Order", icon: "🛒", to: "/purchase-orders" },
    { label: "Payroll Run", icon: "💰", to: "/payroll" },
    { label: "Inventory Item", icon: "📦", to: "/inventory" }
  ];

  return (
    <>
      {open && (
        <div className={styles.fabOverlay} onClick={() => setOpen(false)} />
      )}

      {open && (
        <div className={styles.fabMenu}>
          <div className={styles.fabMenuTitle}>
            Quick Actions
          </div>
          <div className={styles.fabActionGrid}>
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={() => { setOpen(false); nav(a.to); }}
                className={styles.fabActionBtn}
                onMouseEnter={(e) => e.currentTarget.style.background = T.redSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = ""}
              >
                <span className={styles.fabActionIcon}>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        title="Quick actions"
        className={styles.fabBtn}
      >
        {open ? "×" : "+"}
      </button>
    </>
  );
}


// =====================================================================
// MAIN PAGE
// =====================================================================

export default function EnterpriseCommandCenter() {

  const [stats, setStats] = useState({});

  const [health, setHealth] = useState(null);

  const [factory, setFactory] = useState(null);

  const [insights, setInsights] = useState([]);

  const [flow, setFlow] = useState(null);

  const [activity, setActivity] = useState([]);

  const [performers, setPerformers] = useState([]);

  const [buckets, setBuckets] = useState({});

  const [lowStock, setLowStock] = useState({ total: 0, rows: [] });

  const [memoStats, setMemoStats] = useState({});

  useEffect(() => {

    // Load everything in parallel; missing endpoints fail gracefully
    const safe = (p, fallback) => p.then((r) => r.data).catch(() => fallback);

    Promise.all([
      safe(API.get("/admin/dashboard-stats"), {}),
      safe(API.get("/admin/dashboard/health-score"), null),
      safe(API.get("/admin/dashboard/factory-status"), null),
      safe(API.get("/admin/dashboard/insights"), []),
      safe(API.get("/admin/dashboard/production-flow"), null),
      safe(API.get("/admin/dashboard/activity-feed"), []),
      safe(API.get("/admin/dashboard/top-performers"), []),
      safe(API.get("/admin/approvals/pending"), {}),
      safe(API.get("/inventory?status=LOW_STOCK&limit=5"), []),
      safe(API.get("/memos/stats"), {})
    ]).then(([s, h, f, ins, fl, act, perf, buck, lowStk, memos]) => {

      setStats(s || {});

      // Normalise health-score: backend uses {overall, scores: {key: {value, note}}}
      if (h && h.overall != null && h.scores) {

        const subs = Object.entries(h.scores).map(([k, v]) => ({
          key: k,
          label: k.charAt(0).toUpperCase() + k.slice(1),
          score: v?.value ?? 0,
          note: v?.note ?? ""
        }));

        setHealth({ overall_score: h.overall, label: h.label, sub_scores: subs });

      } else {

        setHealth(h);
      }

      setFactory(f);

      setInsights(Array.isArray(ins) ? ins : (ins?.insights || []));

      setFlow(fl);

      setActivity(Array.isArray(act) ? act : (act?.items || act?.events || []));

      // Top performers: backend returns { categories: [...] }
      const perfRows = Array.isArray(perf)
        ? perf
        : (perf?.categories || perf?.rows || []);

      setPerformers(perfRows.map((p) => ({
        name: p.name || p.NAME,
        employee_code: p.code || p.EMPLOYEE_CODE,
        score: p.score ?? 0,
        attendance_pct: p.attendance_pct ?? p.ATTENDANCE_PCT ?? "—",
        tasks_completed: p.tasks_completed ?? p.TASKS_COMPLETED ?? "—",
        badge: p.badge
      })));

      // Approvals: buckets are ARRAYS — convert to { count } for the UI
      const rawBuckets = buck?.buckets || {};

      const formatted = {};

      Object.entries(rawBuckets).forEach(([k, v]) => {

        formatted[k] = { count: Array.isArray(v) ? v.length : (v?.count || 0) };
      });

      setBuckets(formatted);

      const lowRows = Array.isArray(lowStk) ? lowStk : (lowStk?.rows || []);

      setLowStock({
        total: lowRows.length,
        rows: lowRows.map((r) => ({
          MATERIAL_NAME: r.MATERIAL_NAME || r.label,
          QUANTITY: r.QUANTITY || r.value
        }))
      });

      setMemoStats(memos || {});
    });

  }, []);

  // factory_health label for hero
  const factoryHealthLabel = useMemo(() => {

    const s = Math.round(health?.overall_score || 0);

    if (!s) return "—";

    return `${s}%`;
  }, [health]);

  const heroStats = {
    user_name: "System Administrator",
    factory_health: factoryHealthLabel,
    pending_approvals: Object.values(buckets || {})
      .reduce((sum, b) => sum + (b?.count || 0), 0),
    active_wos: factory?.active_wos || stats.active_wos || 0,
    monthly_revenue: stats.monthly_revenue || 0
  };

  return (
    <div className={styles.pageShell}>

      <HeroBar stats={heroStats} />

      <ExecKPIRow stats={stats} />

      {/* <AIPriorityCenter insights={insights} /> — temporarily hidden */}

      <BusinessHealthGrid stats={stats} factory={factory} />

      {/* Health gauge + Production pipeline side-by-side */}
      <div className={`${styles.twoColGrid} ${styles.twoColGrid12}`}>
        <HealthGauge health={health} />
        <FactoryFloor factory={factory} />
      </div>

      {/* Approval + CRM funnel side-by-side */}
      <div className={`${styles.twoColGrid} ${styles.twoColGrid12x1}`}>
        <ApprovalCenter buckets={buckets} />
        <CRMFunnel stats={stats} />
      </div>

      <div className={styles.singleColSection}>
        <InventoryCenter stats={stats} lowStock={lowStock} />
      </div>

      {/* Sections below temporarily hidden to keep the dashboard focused on
          the day-one essentials. Restore by uncommenting:
            <ProductionPipeline flow={flow} />
            <MemoSummaryCard stats={memoStats} />
            <EmployeeLeaderboard performers={performers} />
            <ExecutiveAnalytics />
       */}

      <QuickActionsFAB />
    </div>
  );
}
