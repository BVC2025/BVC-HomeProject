// =====================================================================
// Admin Dashboard — BVC24 Manufacturing ERP
// =====================================================================
// 12 KPI tiles + cinematic effects:
//   - Staggered fade-up entrance (each tile 60ms after the previous)
//   - Count-up animation on every value (1.2s ease-out)
//   - Hover lift + glow + scale on each card
//   - Auto-refresh every 30 seconds
//   - Production Status tile is a mini donut (PLANNED vs IN_PROGRESS vs DONE)
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";
import styles from "./AdminDashboard.module.css";


// --- Tile config ------------------------------------------------------

const TILES = [
  { key: "total_customers",         label: "Total Customers",          icon: "👥", gradient: "#ef4444", accent: "#fef2f2", format: "int",        href: "/customers"      },
  { key: "total_quotations",        label: "Total Quotations",         icon: "📋", gradient: "#3b82f6", accent: "#eff6ff", format: "int",        href: "/quotations"     },
  { key: "total_sales_orders",      label: "Total Sales Orders",       icon: "🛒", gradient: "#10b981", accent: "#f0fdf4", format: "int",        href: "/sales-orders"   },
  { key: "active_projects",         label: "Active Projects",          icon: "🏗️", gradient: "#f59e0b", accent: "#fffbeb", format: "int",        href: "/projects"       },
  { key: "purchase_orders",         label: "Purchase Orders",          icon: "📦", gradient: "#6366f1", accent: "#f5f3ff", format: "int",        href: "/purchase-orders"},
  { key: "inventory_value",         label: "Inventory Value",          icon: "🏷️", gradient: "#0ea5e9", accent: "#f0f9ff", format: "money",      href: "/inventory"      },
  { key: "employees_present_today", label: "Employees Present Today",  icon: "🟢", gradient: "#22c55e", accent: "#f0fdf4", format: "int",        href: "/attendance"     },
  { key: "leave_requests_pending",  label: "Leave Requests Pending",   icon: "📅", gradient: "#f97316", accent: "#fff7ed", format: "int",        href: "/leave"          },
  { key: "production_status",       label: "Production Status",        icon: "🏭", gradient: "#ec4899", accent: "#fdf2f8", format: "production", href: "/production"     },
  { key: "monthly_revenue",         label: "Monthly Revenue",          icon: "💰", gradient: "#16a34a", accent: "#f0fdf4", format: "money",      href: "/sales-orders"   },
  { key: "pending_payments",        label: "Pending Payments",         icon: "💳", gradient: "#dc2626", accent: "#fef2f2", format: "money",      href: "/sales-orders"   },
  { key: "ai_notifications",        label: "AI Notifications",         icon: "🔔", gradient: "#f59e0b", accent: "#fffbeb", format: "int",        href: "#"               },
];


// --- Number formatting ------------------------------------------------

function formatInt(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString("en-IN");
}

function formatMoney(n) {
  if (n == null) return "₹0";
  const v = Number(n);
  if (Math.abs(v) >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(2)} L`;
  if (Math.abs(v) >= 1_000)       return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}


// --- Count-up hook ----------------------------------------------------

function useCountUp(value, duration = 1200) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef  = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) { setDisplay(to); return; }
    const start = performance.now();
    const tick = (t) => {
      const elapsed  = t - start;
      const progress = Math.min(1, elapsed / duration);
      const eased    = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return display;
}


// --- Production mini donut --------------------------------------------

function ProductionDonut({ data, tileColor }) {
  const planned = data?.PLANNED    || 0;
  const inProg  = data?.IN_PROGRESS || 0;
  const done    = data?.DONE        || 0;
  const total   = Math.max(1, planned + inProg + done);
  const r = 28;
  const c = 2 * Math.PI * r;

  const segments = [
    { v: planned, color: "#e2e8f0" },
    { v: inProg,  color: tileColor || "#3b82f6" },
    { v: done,    color: "#f59e0b" },
  ];

  let acc = 0;
  return (
    <div className={styles.donutWrap}>
      <svg width={80} height={80}>
        <circle cx={40} cy={40} r={r} stroke="#f1f5f9" strokeWidth={10} fill="none" />
        {segments.map((s, i) => {
          const len = (s.v / total) * c;
          const seg = (
            <circle
              key={i}
              cx={40} cy={40} r={r}
              stroke={s.color}
              strokeWidth={10}
              fill="none"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-acc}
              strokeLinecap="round"
              className={styles.donutSegment}
            />
          );
          acc += len;
          return seg;
        })}
      </svg>
      <div className={styles.donutCenter}>
        <div className={styles.donutTotal}>
          {planned + inProg + done}
        </div>
        <div className={styles.donutLabel}>
          WO
        </div>
      </div>
    </div>
  );
}


// --- Single tile ------------------------------------------------------

function CinematicTile({ tile, value, index, onClick }) {
  const numeric = useMemo(() => {
    if (tile.format === "production") return value?.TOTAL_ACTIVE || 0;
    return Number(value) || 0;
  }, [tile.format, value]);

  const animated = useCountUp(numeric, 1200);

  const displayText = useMemo(() => {
    if (tile.format === "money")      return formatMoney(animated);
    if (tile.format === "production") return formatInt(Math.round(animated));
    return formatInt(Math.round(animated));
  }, [tile.format, animated]);

  return (
    <div
      onClick={() => onClick(tile)}
      className={styles.tile}
      style={{
        "--tile-delay": `${index * 0.06}s`,
        "--tile-glow": `0 8px 24px rgba(0,0,0,0.10), 0 0 0 1px ${tile.gradient}33`,
        borderTop: `3px solid ${tile.gradient}`,
        cursor: tile.href === "#" ? "default" : "pointer",
      }}
    >
      <div className={styles.tileLabel}>{tile.label}</div>

      <div className={styles.tileValueRow}>
        <div>
          {tile.format === "production" ? (
            <div>
              <div className={styles.tileValueProd} style={{ color: tile.gradient }}>
                {displayText}
                <span className={styles.tileActiveLabel}>
                  active
                </span>
              </div>
              <div className={styles.tileProdSub}>
                <span>● Planned {value?.PLANNED || 0}</span>
                <span>● In-Progress {value?.IN_PROGRESS || 0}</span>
                <span className={styles.tileDoneLabel}>● Done {value?.DONE || 0}</span>
              </div>
            </div>
          ) : (
            <div className={styles.tileValue} style={{ color: tile.gradient }}>
              {displayText}
            </div>
          )}
        </div>

        {tile.format === "production" ? (
          <ProductionDonut data={value} tileColor={tile.gradient} />
        ) : (
          <div
            className={styles.tileIcon}
            style={{
              background: tile.accent,
              border: `1px solid ${tile.gradient}22`,
            }}
          >
            {tile.icon}
          </div>
        )}
      </div>

      <div className={styles.tileProgressTrack}>
        <div
          className={styles.tileProgressBar}
          style={{ background: tile.gradient }}
        />
      </div>
    </div>
  );
}


// --- Main component ---------------------------------------------------

export default function AdminDashboard() {
  const [stats, setStats] = useState({});
  const [error, setError] = useState("");
  const [lastFetch, setLastFetch] = useState(null);

  const username = (() => {
    try { return localStorage.getItem("username") || "Administrator"; }
    catch { return "Administrator"; }
  })();

  const fetchStats = async () => {
    try {
      const res = await API.get("/admin/dashboard-stats");
      setStats(res.data || {});
      setError("");
      setLastFetch(new Date());
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load dashboard.");
    }
  };

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const onTileClick = (tile) => {
    if (tile.href && tile.href !== "#") window.location.href = tile.href;
  };

  return (
    <div className={styles.page}>

      {/* Hero */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>BVC24 · Admin Command Center</div>
          <div className={styles.heroTitle}>Welcome back, {username}</div>
          <div className={styles.heroSub}>
            Live snapshot of customers, sales, production and finance —
            auto-refreshing every 30 seconds.
          </div>
        </div>
        <div className={styles.heroRight}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            LIVE
          </div>
          <div className={styles.heroBadgeTime}>
            {lastFetch ? `Updated ${lastFetch.toLocaleTimeString()}` : "Loading…"}
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>⚠ {error}</div>
      )}

      {/* 12-tile cinematic grid */}
      <div className={styles.tilesGrid}>
        {TILES.map((tile, i) => (
          <CinematicTile
            key={tile.key}
            tile={tile}
            value={stats[tile.key]}
            index={i}
            onClick={onTileClick}
          />
        ))}
      </div>

      <div className={styles.footerHint}>
        Click any tile to jump into the module · Data sourced from
        customer, quotation, sales_order, project, purchase_order,
        inventory, attendance, leave_request, work_order, notification
      </div>
    </div>
  );
}
