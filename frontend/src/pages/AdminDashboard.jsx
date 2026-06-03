// =====================================================================
// Admin Dashboard — BVC24 Manufacturing ERP
// =====================================================================
// 12 KPI tiles + cinematic effects:
//   - Staggered fade-up entrance (each tile 60ms after the previous)
//   - Count-up animation on every value (1.2s ease-out)
//   - Hover lift + glow + scale on each card
//   - Conic-gradient shimmer that sweeps across icon ring
//   - Auto-refresh every 30 seconds with subtle pulse on changed values
//   - Production Status tile is a mini donut (PLANNED vs IN_PROGRESS vs DONE)
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";


// --- Palette ----------------------------------------------------------

const BVC_RED   = "#C8102E";
const BVC_DARK  = "#8B0B1F";
const BVC_DEEP  = "#4A0E18";
const BVC_BLACK = "#1A0508";
const BVC_GOLD  = "#F4B324";


// --- Tile config ------------------------------------------------------

const TILES = [
  {
    key: "total_customers",
    label: "Total Customers",
    icon: "👥",
    gradient: "linear-gradient(135deg,#C8102E,#8B0B1F)",
    accent: "#FECACA",
    format: "int",
    href: "/customers",
  },
  {
    key: "total_quotations",
    label: "Total Quotations",
    icon: "📋",
    gradient: "linear-gradient(135deg,#0EA5E9,#0369A1)",
    accent: "#BAE6FD",
    format: "int",
    href: "/quotations",
  },
  {
    key: "total_sales_orders",
    label: "Total Sales Orders",
    icon: "🛒",
    gradient: "linear-gradient(135deg,#10B981,#065F46)",
    accent: "#A7F3D0",
    format: "int",
    href: "/sales-orders",
  },
  {
    key: "active_projects",
    label: "Active Projects",
    icon: "🏗️",
    gradient: "linear-gradient(135deg,#F59E0B,#B45309)",
    accent: "#FDE68A",
    format: "int",
    href: "/projects",
  },
  {
    key: "purchase_orders",
    label: "Purchase Orders",
    icon: "📦",
    gradient: "linear-gradient(135deg,#6366F1,#3730A3)",
    accent: "#C7D2FE",
    format: "int",
    href: "/purchase-orders",
  },
  {
    key: "inventory_value",
    label: "Inventory Value",
    icon: "🏷️",
    gradient: "linear-gradient(135deg,#14B8A6,#0F766E)",
    accent: "#99F6E4",
    format: "money",
    href: "/inventory",
  },
  {
    key: "employees_present_today",
    label: "Employees Present Today",
    icon: "🟢",
    gradient: "linear-gradient(135deg,#22C55E,#15803D)",
    accent: "#BBF7D0",
    format: "int",
    href: "/attendance",
  },
  {
    key: "leave_requests_pending",
    label: "Leave Requests Pending",
    icon: "📅",
    gradient: "linear-gradient(135deg,#F97316,#9A3412)",
    accent: "#FED7AA",
    format: "int",
    href: "/leave",
  },
  {
    key: "production_status",
    label: "Production Status",
    icon: "🏭",
    gradient: "linear-gradient(135deg,#EC4899,#9D174D)",
    accent: "#FBCFE8",
    format: "production",
    href: "/production",
  },
  {
    key: "monthly_revenue",
    label: "Monthly Revenue",
    icon: "💰",
    gradient: "linear-gradient(135deg,#84CC16,#3F6212)",
    accent: "#D9F99D",
    format: "money",
    href: "/sales-orders",
  },
  {
    key: "pending_payments",
    label: "Pending Payments",
    icon: "💳",
    gradient: "linear-gradient(135deg,#EF4444,#7F1D1D)",
    accent: "#FCA5A5",
    format: "money",
    href: "/sales-orders",
  },
  {
    key: "ai_notifications",
    label: "AI Notifications",
    icon: "🔔",
    gradient: `linear-gradient(135deg,${BVC_GOLD},#B7791F)`,
    accent: "#FEF08A",
    format: "int",
    href: "#",
  },
];


// --- Number formatting ------------------------------------------------

function formatInt(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString("en-IN");
}

function formatMoney(n) {
  if (n == null) return "₹0";
  const v = Number(n);
  if (Math.abs(v) >= 1_00_00_000)
    return `₹${(v / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1_00_000)
    return `₹${(v / 1_00_000).toFixed(2)} L`;
  if (Math.abs(v) >= 1_000)
    return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}


// --- Count-up hook ----------------------------------------------------

function useCountUp(value, duration = 1200) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = performance.now();
    const tick = (t) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return display;
}


// --- Production mini donut --------------------------------------------

function ProductionDonut({ data }) {
  // data is { PLANNED, IN_PROGRESS, ON_HOLD, DONE, CANCELLED, TOTAL_ACTIVE }
  const planned = data?.PLANNED || 0;
  const inProg = data?.IN_PROGRESS || 0;
  const done = data?.DONE || 0;
  const total = Math.max(1, planned + inProg + done);

  const r = 28;
  const c = 2 * Math.PI * r;

  // segments — accumulate offsets
  const segments = [
    { v: planned, color: "rgba(255,255,255,0.40)" },
    { v: inProg, color: "rgba(255,255,255,0.85)" },
    { v: done, color: BVC_GOLD },
  ];

  let acc = 0;
  return (
    <div style={{ position: "relative", width: 80, height: 80 }}>
      <svg width={80} height={80}>
        <circle
          cx={40}
          cy={40}
          r={r}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={10}
          fill="none"
        />
        {segments.map((s, i) => {
          const len = (s.v / total) * c;
          const seg = (
            <circle
              key={i}
              cx={40}
              cy={40}
              r={r}
              stroke={s.color}
              strokeWidth={10}
              fill="none"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-acc}
              strokeLinecap="round"
              style={{
                transition: "stroke-dasharray 0.8s ease, stroke-dashoffset 0.8s ease",
              }}
            />
          );
          acc += len;
          return seg;
        })}
      </svg>
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
      }}>
        <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1 }}>
          {planned + inProg + done}
        </div>
        <div style={{ fontSize: 8, letterSpacing: 1.5, opacity: 0.85, marginTop: 1 }}>
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
    if (tile.format === "money") return formatMoney(animated);
    if (tile.format === "production") return formatInt(Math.round(animated));
    return formatInt(Math.round(animated));
  }, [tile.format, animated]);

  const [hover, setHover] = useState(false);

  return (
    <div
      onClick={() => onClick(tile)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        overflow: "hidden",
        background: tile.gradient,
        borderRadius: 18,
        padding: "20px 22px",
        cursor: tile.href === "#" ? "default" : "pointer",
        boxShadow: hover
          ? `0 18px 48px rgba(0,0,0,0.30), 0 0 0 2px ${tile.accent}`
          : "0 6px 20px rgba(0,0,0,0.15)",
        transform: hover ? "translateY(-6px) scale(1.02)" : "translateY(0) scale(1)",
        transition: "transform 0.32s cubic-bezier(.22,.61,.36,1), box-shadow 0.32s",
        // Cinematic stagger-in: each tile animates from below
        animation: `tile-in 0.7s cubic-bezier(.22,.61,.36,1) ${index * 0.06}s both`,
      }}
    >
      {/* Decorative shimmer ring behind the icon */}
      <div style={{
        position: "absolute",
        top: -30,
        right: -30,
        width: 140,
        height: 140,
        borderRadius: "50%",
        background:
          "conic-gradient(from 0deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02), rgba(255,255,255,0.18))",
        filter: "blur(3px)",
        opacity: hover ? 0.9 : 0.55,
        transition: "opacity 0.4s",
        animation: "tile-spin 12s linear infinite",
      }} />

      {/* Label */}
      <div style={{
        position: "relative",
        zIndex: 2,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 1.6,
        color: tile.accent,
        textTransform: "uppercase",
        opacity: 0.95,
      }}>
        {tile.label}
      </div>

      {/* Value + Icon row */}
      <div style={{
        position: "relative",
        zIndex: 2,
        marginTop: 10,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
      }}>
        <div>
          {tile.format === "production" ? (
            <div>
              <div style={{
                fontSize: 30,
                fontWeight: 900,
                color: "white",
                lineHeight: 1,
                fontFamily: "ui-monospace, monospace",
                textShadow: "0 2px 12px rgba(0,0,0,0.20)",
              }}>
                {displayText}
                <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 6, opacity: 0.8 }}>
                  active
                </span>
              </div>
              <div style={{
                marginTop: 8,
                display: "flex",
                gap: 10,
                fontSize: 10,
                fontWeight: 700,
                color: "white",
                opacity: 0.95,
              }}>
                <span>● Planned {value?.PLANNED || 0}</span>
                <span>● In-Progress {value?.IN_PROGRESS || 0}</span>
                <span style={{ color: BVC_GOLD }}>● Done {value?.DONE || 0}</span>
              </div>
            </div>
          ) : (
            <div style={{
              fontSize: 34,
              fontWeight: 900,
              color: "white",
              lineHeight: 1,
              fontFamily: "ui-monospace, monospace",
              textShadow: "0 2px 12px rgba(0,0,0,0.20)",
            }}>
              {displayText}
            </div>
          )}
        </div>

        {/* Icon */}
        {tile.format === "production" ? (
          <ProductionDonut data={value} />
        ) : (
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "rgba(255,255,255,0.18)",
            border: "1px solid rgba(255,255,255,0.30)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            backdropFilter: "blur(8px)",
            boxShadow: hover ? "0 0 24px rgba(255,255,255,0.30) inset" : "none",
            transition: "box-shadow 0.32s, transform 0.32s",
            transform: hover ? "rotate(-6deg) scale(1.08)" : "rotate(0) scale(1)",
          }}>
            {tile.icon}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{
        position: "relative",
        zIndex: 2,
        marginTop: 14,
        height: 3,
        borderRadius: 999,
        background: "rgba(255,255,255,0.15)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: hover ? "100%" : "40%",
          background: tile.accent,
          transition: "width 0.55s cubic-bezier(.22,.61,.36,1)",
          borderRadius: 999,
        }} />
      </div>
    </div>
  );
}


// --- Main component ---------------------------------------------------

export default function AdminDashboard() {
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const onTileClick = (tile) => {
    if (tile.href && tile.href !== "#") {
      window.location.href = tile.href;
    }
  };

  return (
    <div style={{
      padding: 28,
      background: `linear-gradient(160deg, #F8F4F5 0%, #FFFFFF 60%)`,
      minHeight: "calc(100vh - 80px)",
    }}>

      {/* Inline keyframes — kept here so the file is self-contained */}
      <style>{`
        @keyframes tile-in {
          0%   { opacity: 0; transform: translateY(28px) scale(0.96); filter: blur(8px); }
          60%  { opacity: 1; filter: blur(0); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes tile-spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes hero-shine {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes hero-glow {
          0%, 100% { box-shadow: 0 8px 32px rgba(200,16,46,0.35), 0 0 0 1px rgba(244,179,36,0.20) inset; }
          50%      { box-shadow: 0 12px 44px rgba(200,16,46,0.55), 0 0 0 2px rgba(244,179,36,0.45) inset; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>

      {/* Hero bar */}
      <div style={{
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(135deg, ${BVC_BLACK} 0%, ${BVC_DEEP} 40%, ${BVC_DARK} 70%, ${BVC_RED} 100%)`,
        borderRadius: 20,
        padding: "26px 32px",
        marginBottom: 26,
        animation: "hero-glow 4.5s ease-in-out infinite",
      }}>
        {/* Sweeping shine overlay */}
        <div style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0) 70%)",
          backgroundSize: "200% 100%",
          animation: "hero-shine 6s ease-in-out infinite",
          pointerEvents: "none",
        }} />
        <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 2,
              color: BVC_GOLD,
              textTransform: "uppercase",
              opacity: 0.92,
            }}>
              BVC24 · Admin Command Center
            </div>
            <div style={{
              fontSize: 28,
              fontWeight: 900,
              color: "white",
              marginTop: 4,
              letterSpacing: 0.3,
              textShadow: "0 2px 18px rgba(0,0,0,0.30)",
            }}>
              Welcome back, {username}
            </div>
            <div style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.85)",
              marginTop: 4,
            }}>
              Live snapshot of customers, sales, production and finance —
              auto-refreshing every 30 seconds.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.25)",
              color: "white",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              backdropFilter: "blur(6px)",
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#22c55e",
                animation: "pulse-dot 1.5s ease-in-out infinite",
                boxShadow: "0 0 12px #22c55e",
              }} />
              LIVE
            </div>
            <div style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.6)",
              marginTop: 8,
              fontFamily: "ui-monospace,monospace",
            }}>
              {lastFetch ? `Updated ${lastFetch.toLocaleTimeString()}` : "Loading…"}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 16,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* 12-tile cinematic grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 18,
      }}>
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

      {/* Footer hint */}
      <div style={{
        marginTop: 24,
        fontSize: 11,
        color: "#94a3b8",
        textAlign: "center",
      }}>
        Click any tile to jump into the module · Data sourced from
        customer, quotation, sales_order, project, purchase_order,
        inventory, attendance, leave_request, work_order, notification
      </div>
    </div>
  );
}
