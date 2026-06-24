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
  bg:        "#f6f7fa",
  card:      "#ffffff",
  border:    "#e6e8ee",
  borderS:   "#eef1f5",
  text:      "#0f172a",
  text2:     "#334155",
  muted:     "#64748b",
  muted2:    "#94a3b8",

  // Primary — BVC24 red
  red:       "#C8102E",
  redDeep:   "#8B0B1F",
  redDark:   "#5a0712",
  redSoft:   "#fee2e2",

  // Gold accent (subtle highlights on red surfaces)
  gold:      "#D4A017",
  goldSoft:  "#fef3c7",

  // Neutral accent for data tiles
  slate:     "#1f2937",
  slateSoft: "#e5e7eb",

  green:     "#10b981",
  greenSoft: "#dcfce7",

  amber:     "#f59e0b",
  amberSoft: "#fef3c7",

  blue:      "#2563eb",
  blueSoft:  "#dbeafe",

  purple:    "#6366f1",
  purpleSoft:"#ede9fe",

  // Dark hero accents (unused now but kept for parity)
  ink:       "#0b1220",
  ink2:      "#111827",
  inkBorder: "#1f2937",

  // Legacy aliases (kept to avoid touching every accent reference).
  orange:    "#C8102E",
  orangeDeep:"#8B0B1F",
  orangeSoft:"#fee2e2",
  navy:      "#1f2937",
  navy2:     "#374151",
  navyDeep:  "#0f172a",
  navySoft:  "#e5e7eb"
};

const FONT_HEAD = "'Inter','system-ui','-apple-system',sans-serif";

const FONT_BODY = "'Inter','system-ui','-apple-system',sans-serif";


// =====================================================================
// Reusable atoms
// =====================================================================

function Card({ children, style = {}, padding = 22 }) {

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: 16,
      padding,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      ...style
    }}>
      {children}
    </div>
  );
}


function SectionTitle({ eyebrow, title, action }) {

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      marginBottom: 14,
      gap: 12
    }}>
      <div>
        {eyebrow && (
          <div style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.6,
            color: T.muted,
            textTransform: "uppercase",
            marginBottom: 4,
            fontFamily: FONT_BODY
          }}>
            {eyebrow}
          </div>
        )}
        <div style={{
          fontSize: 18,
          fontWeight: 800,
          color: T.text,
          letterSpacing: -0.2,
          fontFamily: FONT_HEAD
        }}>
          {title}
        </div>
      </div>
      {action}
    </div>
  );
}


function Pill({ children, color = T.muted, bg = T.borderS }) {

  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      background: bg,
      color
    }}>
      {children}
    </span>
  );
}


// money formatter
function inrShort(n) {

  const v = Number(n || 0);

  if (Math.abs(v) >= 10000000) return `₹${(v/10000000).toFixed(2)} Cr`;

  if (Math.abs(v) >= 100000)   return `₹${(v/100000).toFixed(2)} L`;

  if (Math.abs(v) >= 1000)     return `₹${(v/1000).toFixed(1)}K`;

  return `₹${v.toLocaleString("en-IN")}`;
}


function pct(n, total) {

  if (!total) return 0;

  return Math.round((Number(n||0) / Number(total||1)) * 100);
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
    { label: "Revenue · MTD",      value: inrShort(stats.monthly_revenue || 0) },
    { label: "Approvals Pending",  value: stats.pending_approvals ?? "—" },
    { label: "Factory Health",     value: stats.factory_health || "—" }
  ];

  return (

    <div style={{
      // BVC24 brand red — matches bvc24.com navbar
      background: "linear-gradient(135deg, #C8102E 0%, #A60F26 35%, #8B0B1F 70%, #5a0712 100%)",
      borderRadius: 18,
      padding: "26px 32px",
      color: "white",
      marginBottom: 22,
      position: "relative",
      overflow: "hidden",
      boxShadow: "0 10px 30px rgba(139,11,31,0.30)"
    }}>

      {/* Subtle gold highlight sweep, top-right */}
      <div style={{
        position: "absolute",
        top: -60, right: -40,
        width: 280, height: 280,
        background: "radial-gradient(circle, rgba(253,224,71,0.16) 0%, transparent 65%)",
        pointerEvents: "none"
      }} />

      {/* Depth wash, bottom */}
      <div style={{
        position: "absolute",
        bottom: 0, left: 0, right: 0,
        height: "55%",
        background: "linear-gradient(to top, rgba(0,0,0,0.20) 0%, transparent 100%)",
        pointerEvents: "none"
      }} />

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 28, flexWrap: "wrap" }}>

        {/* Left — logo lockup + welcome */}
        <div style={{ flex: "1 1 320px", display: "flex", alignItems: "center", gap: 18 }}>

          <div style={{
            width: 62, height: 62, borderRadius: 14,
            background: "#ffffff",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 6px 18px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.18)",
            padding: 7,
            flexShrink: 0
          }}>
            <img
              src="/bharath-logo.png"
              alt="Bharath Vending Corporation"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>

          <div>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2.4,
              color: "#fde047",
              textTransform: "uppercase",
              fontFamily: FONT_BODY
            }}>
              Bharath Vending Corporation
            </div>
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              marginTop: 2,
              letterSpacing: -0.3,
              color: "#ffffff",
              fontFamily: FONT_HEAD
            }}>
              Welcome, {stats.user_name || "System Administrator"}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, color: "#ffe4e6" }}>
              {dateStr} · <span style={{ color: "#fde047", fontWeight: 600 }}>{timeStr}</span>
            </div>
          </div>
        </div>

        {/* Right — three headline stats only */}
        <div style={{
          display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "flex-end"
        }}>
          {items.map((it, idx) => (

            <div key={it.label} style={{
              minWidth: 120,
              paddingLeft: idx === 0 ? 0 : 18,
              borderLeft: idx === 0 ? "none" : "1px solid rgba(255,255,255,0.18)"
            }}>
              <div style={{
                fontSize: 9, opacity: 0.85, letterSpacing: 1.4, textTransform: "uppercase",
                fontWeight: 600, fontFamily: FONT_BODY, color: "#fecdd3"
              }}>
                {it.label}
              </div>
              <div style={{
                fontSize: 20, fontWeight: 700, color: "#ffffff", marginTop: 4, fontFamily: FONT_HEAD,
                letterSpacing: -0.3
              }}>
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
// EXECUTIVE KPI ROW — 4 large tiles (icon + value + sparkline)
// =====================================================================

// Mini area sparkline drawn as inline SVG (no extra deps).
function Sparkline({ color, data }) {

  const series = data && data.length ? data : [4, 6, 5, 8, 7, 9, 6, 10, 8, 11];

  const w  = 90;

  const h  = 36;

  const max = Math.max(...series, 1);

  const min = Math.min(...series, 0);

  const range = (max - min) || 1;

  const step = w / (series.length - 1);

  const pts = series.map((v, i) => {

    const x = i * step;

    const y = h - ((v - min) / range) * (h - 4) - 2;

    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const gradId = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${pts} ${w},${h}`}
        fill={`url(#${gradId})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}


// Inline SVG icon set — kept tiny and emoji-free per brand guideline.
function KpiIcon({ name, color }) {

  const common = {
    width: 22, height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  if (name === "rupee") {
    return (
      <svg {...common}>
        <path d="M6 4h12M6 8h12M9 4c4 0 5 2.5 5 5s-1 4.5-5 4.5H6l8 7" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  if (name === "bag") {
    return (
      <svg {...common}>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    );
  }

  if (name === "factory") {
    return (
      <svg {...common}>
        <path d="M2 20h20" />
        <path d="M4 20V8l5 4V8l5 4V8l5 4v8" />
        <path d="M9 20v-4M14 20v-4" />
      </svg>
    );
  }

  return null;
}


function ExecKPI({ label, value, accent, iconName, trend, onClick }) {

  return (
    <div
      onClick={onClick}
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        padding: "18px 20px",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.15s, box-shadow 0.15s",
        display: "flex",
        alignItems: "center",
        gap: 14
      }}
      onMouseEnter={(e) => {
        if (!onClick) return;
        e.currentTarget.style.boxShadow = "0 10px 26px rgba(11,36,71,0.10)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        if (!onClick) return;
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Left — circular tinted icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 22,
        background: accent + "1a",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0
      }}>
        <KpiIcon name={iconName} color={accent} />
      </div>

      {/* Middle — label + big value */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.2,
          color: T.muted,
          textTransform: "uppercase",
          fontFamily: FONT_BODY,
          marginBottom: 4
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 26,
          fontWeight: 800,
          color: T.text,
          letterSpacing: -0.5,
          fontFamily: FONT_HEAD,
          lineHeight: 1
        }}>
          {value}
        </div>
      </div>

      {/* Right — mini sparkline */}
      <Sparkline color={accent} data={trend} />
    </div>
  );
}


function ExecKPIRow({ stats }) {

  const nav = useNavigate();

  // Four headline metrics only — the ones a CEO opens the app to see.
  // Inventory + Employees moved to their dedicated sections below.
  const items = [
    { label: "Revenue · MTD",   value: inrShort(stats.monthly_revenue || 0), accent: T.red,    iconName: "rupee",   trend: stats.revenue_trend,    to: "/sales-orders" },
    { label: "Customers",       value: stats.total_customers ?? 0,           accent: T.amber,  iconName: "users",   trend: stats.customers_trend,  to: "/customers" },
    { label: "Active Orders",   value: stats.total_sales_orders ?? 0,        accent: T.blue,   iconName: "bag",     trend: stats.orders_trend,     to: "/sales-orders" },
    { label: "Production WOs",  value: stats.active_wos ?? 0,                accent: T.purple, iconName: "factory", trend: stats.production_trend, to: "/production" }
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 16,
      marginBottom: 22
    }}>
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
  IMPORTANT:{ dot: "#ea580c", bg: "#fff7ed", border: "#fed7aa", label: "🟠 Important" },
  ATTENTION:{ dot: "#ca8a04", bg: "#fefce8", border: "#fde68a", label: "🟡 Attention" },
  OPPORTUNITY:{ dot:"#16a34a", bg: "#f0fdf4", border: "#bbf7d0", label: "🟢 Opportunity" }
};


function severityToCategory(sev) {

  const s = (sev || "").toUpperCase();

  if (s === "CRITICAL" || s === "HIGH" || s === "DANGER") return "CRITICAL";

  if (s === "WARNING" || s === "MEDIUM")                   return "IMPORTANT";

  if (s === "INFO" || s === "LOW")                          return "ATTENTION";

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

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12
      }}>
        {order.map((cat) => {

          const theme = PRIORITY_THEMES[cat];

          const list = grouped[cat] || [];

          return (
            <div key={cat} style={{
              background: theme.bg,
              border: `1px solid ${theme.border}`,
              borderRadius: 12,
              padding: 14,
              minHeight: 200
            }}>
              <div style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.5,
                marginBottom: 8,
                color: theme.dot,
                textTransform: "uppercase",
                fontFamily: FONT_BODY
              }}>
                {theme.label}
              </div>

              {list.length === 0 && (
                <div style={{
                  fontSize: 11,
                  color: T.muted,
                  padding: "30px 4px",
                  textAlign: "center",
                  opacity: 0.7
                }}>
                  No items
                </div>
              )}

              {list.slice(0, 3).map((i, idx) => (

                <div key={idx} style={{
                  background: T.card,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 8
                }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: T.text,
                    marginBottom: 4,
                    fontFamily: FONT_HEAD,
                    lineHeight: 1.3
                  }}>
                    {i.title || "—"}
                  </div>
                  {i.detail && (
                    <div style={{
                      fontSize: 11,
                      color: T.muted,
                      lineHeight: 1.5,
                      marginBottom: 8
                    }}>
                      {i.detail}
                    </div>
                  )}
                  {i.cta_url && (
                    <button
                      onClick={() => nav(i.cta_url)}
                      style={{
                        background: "transparent",
                        border: `1px solid ${theme.dot}55`,
                        color: theme.dot,
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.3,
                        cursor: "pointer",
                        fontFamily: FONT_BODY
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

// Tiny chart-bar SVG used as the stat marker icon inside Business Health.
function StatBars({ color }) {

  return (
    <svg width="14" height="14" viewBox="0 0 24 24"
         fill="none" stroke={color} strokeWidth="2.4"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}


// Machine-state badge icons — play / pause / gear / warning.
function MachineIcon({ name, color }) {

  const common = {
    width: 14, height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  if (name === "play") {
    return (
      <svg {...common}>
        <polygon points="6 4 20 12 6 20 6 4" fill={color} />
      </svg>
    );
  }

  if (name === "pause") {
    return (
      <svg {...common}>
        <rect x="6"  y="4" width="4" height="16" fill={color} />
        <rect x="14" y="4" width="4" height="16" fill={color} />
      </svg>
    );
  }

  if (name === "gear") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.6.59 1.29.6 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" />
      </svg>
    );
  }

  if (name === "warning") {
    return (
      <svg {...common}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }

  return null;
}


function HealthQuad({ title, marker, accent, items }) {

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: 14,
      padding: 20,
      position: "relative",
      overflow: "hidden"
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, height: 3, width: 56, background: accent
      }} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.4,
          fontFamily: FONT_HEAD
        }}>
          {marker}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: -0.2, fontFamily: FONT_HEAD
        }}>
          {title}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12
      }}>
        {items.map((it) => (

          <div key={it.label}>
            <div style={{
              fontSize: 10, color: T.muted, letterSpacing: 0.8, fontWeight: 700,
              textTransform: "uppercase", fontFamily: FONT_BODY
            }}>
              {it.label}
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              marginTop: 4
            }}>
              <span style={{
                width: 26, height: 26, borderRadius: 7,
                background: accent + "1a",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0
              }}>
                <StatBars color={accent} />
              </span>
              <span style={{
                fontSize: 22, fontWeight: 800, color: T.text,
                letterSpacing: -0.3, fontFamily: FONT_HEAD, lineHeight: 1
              }}>
                {it.value ?? "—"}
              </span>
            </div>
            {it.sub && (
              <div style={{ fontSize: 11, color: T.muted, marginTop: 4, marginLeft: 34 }}>
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

  const sales_total    = stats.total_sales_orders || 0;

  const sales_won      = Math.round(sales_total * 0.65);

  const sales_pending  = sales_total - sales_won;

  const conversion     = sales_total ? Math.round((sales_won / sales_total) * 100) : 0;

  const machines       = factory?.machines || {};

  const procurement = {
    open_pos:    stats.purchase_orders || 0,
    received:    stats.po_received || Math.round((stats.purchase_orders || 0) * 0.6),
    delayed:     stats.po_delayed  || Math.round((stats.purchase_orders || 0) * 0.15)
  };

  return (
    <div style={{ marginBottom: 22 }}>
      <SectionTitle eyebrow="CEO Snapshot" title="Business Health" />

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14
      }}>
        <HealthQuad
          title="Sales" marker="01" accent={T.red}
          items={[
            { label: "Target",     value: inrShort(stats.sales_target || 1500000) },
            { label: "Achieved",   value: inrShort(stats.monthly_revenue || 0) },
            { label: "Pending",    value: sales_pending, sub: "sales orders" },
            { label: "Conversion", value: `${conversion}%` }
          ]}
        />

        <HealthQuad
          title="Production" marker="02" accent={T.amber}
          items={[
            { label: "In Production", value: machines.in_production ?? (stats.active_wos || 0) },
            { label: "Completed",     value: machines.completed ?? 0 },
            { label: "Delayed",       value: machines.delayed ?? 0 },
            { label: "On Hold",       value: machines.on_hold ?? 0 }
          ]}
        />

        <HealthQuad
          title="Procurement" marker="03" accent={T.green}
          items={[
            { label: "Open POs",        value: procurement.open_pos },
            { label: "Received",        value: procurement.received },
            { label: "Delayed Supplies",value: procurement.delayed },
            { label: "Suppliers",       value: stats.total_suppliers || "—" }
          ]}
        />

        <HealthQuad
          title="HR" marker="04" accent={T.blue}
          items={[
            { label: "Employees", value: stats.total_employees || 0 },
            { label: "Present",   value: stats.employees_present_today || 0 },
            { label: "Absent",    value: Math.max(0, (stats.total_employees||0) - (stats.employees_present_today||0)) },
            { label: "On Leave",  value: stats.leave_requests_pending || 0 }
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

  const score    = Math.max(0, Math.min(100, Math.round(health?.overall_score || 0)));

  const color    = score >= 80 ? T.green : score >= 60 ? T.amber : T.red;

  const label    = score >= 80 ? "Excellent" : score >= 60 ? "Healthy" : "Needs Attention";

  // Semi-arc SVG path  (180° from -90° to 90°)
  const r  = 90;

  const cx = 130;

  const cy = 110;

  const startAng = Math.PI;     // 180°

  const endAng   = 2 * Math.PI; // 360° (or 0)

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

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24, alignItems: "center" }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <svg width="260" height="170" viewBox="0 0 260 170">
            <path d={bgArc} stroke={T.borderS} strokeWidth="20" fill="none" strokeLinecap="round" />
            <path d={filledArc} stroke={color} strokeWidth="20" fill="none" strokeLinecap="round" />
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize="42" fontWeight="800"
              fill={T.text} fontFamily={FONT_HEAD}>
              {score}
            </text>
            <text x={cx} y={cy + 36} textAnchor="middle" fontSize="11" fontWeight="700"
              fill={T.muted} letterSpacing="1.4" fontFamily={FONT_BODY}>
              OUT OF 100
            </text>
          </svg>

          <div style={{
            marginTop: 4,
            padding: "4px 14px",
            borderRadius: 999,
            background: color + "18",
            color,
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            fontFamily: FONT_BODY
          }}>
            {label}
          </div>
        </div>

        <div>
          {subs.length === 0 && (
            <div style={{ color: T.muted, fontSize: 13 }}>
              Sub-score breakdown not available.
            </div>
          )}
          {subs.map((s) => {

            const v = Math.round(s.score || 0);

            const c = v >= 80 ? T.green : v >= 60 ? T.amber : T.red;

            return (
              <div key={s.key || s.label} style={{ marginBottom: 12 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", marginBottom: 4
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text2, fontFamily: FONT_BODY }}>
                    {s.label || s.key}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: c, fontFamily: FONT_HEAD }}>
                    {v}
                  </span>
                </div>
                <div style={{
                  height: 8,
                  background: T.borderS,
                  borderRadius: 999,
                  overflow: "hidden"
                }}>
                  <div style={{
                    height: "100%",
                    width: `${v}%`,
                    background: c,
                    transition: "width 0.6s ease"
                  }} />
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
    { key: "quotation",  label: "Quotation",  count: 0, value: 0, conversion: null },
    { key: "sales_order",label: "Sales Order",count: 0, value: 0, conversion: null },
    { key: "project",    label: "Project",    count: 0, value: 0, conversion: null },
    { key: "work_order", label: "Work Order", count: 0, value: 0, conversion: null },
    { key: "production", label: "Production", count: 0, value: 0, conversion: null },
    { key: "qc",         label: "QC",         count: 0, value: 0, conversion: null },
    { key: "dispatch",   label: "Dispatch",   count: 0, value: 0, conversion: null },
    { key: "completed",  label: "Completed",  count: 0, value: 0, conversion: null }
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
            <div key={s.key} style={{
              display: "flex", flexDirection: "column", alignItems: "center", position: "relative"
            }}>

              {/* Connector arrow */}
              {!isLast && (
                <div style={{
                  position: "absolute",
                  right: -8,
                  top: 32,
                  fontSize: 16,
                  color: T.muted2,
                  zIndex: 1
                }}>
                  ›
                </div>
              )}

              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: `linear-gradient(135deg, ${T.red}, ${T.redDeep})`,
                color: "white",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 800, marginBottom: 8,
                boxShadow: "0 4px 10px rgba(200,16,46,0.25)",
                fontFamily: FONT_HEAD
              }}>
                {s.count ?? 0}
              </div>

              <div style={{
                fontSize: 10, fontWeight: 800, color: T.text, textAlign: "center",
                letterSpacing: 0.4, textTransform: "uppercase", fontFamily: FONT_BODY
              }}>
                {s.label}
              </div>

              <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                {inrShort(s.value || 0)}
              </div>

              {(s.conversion_pct ?? s.conversion) != null && (
                <div style={{
                  fontSize: 9, color: T.green, marginTop: 2, fontWeight: 700,
                  background: T.greenSoft, padding: "1px 6px", borderRadius: 4
                }}>
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

  const running     = m.running || m.in_production || 0;

  const idle        = m.idle    || 0;

  const maintenance = m.maintenance || 0;

  const breakdown   = m.breakdown || 0;

  const total       = running + idle + maintenance + breakdown;

  const utilization = total ? Math.round((running / total) * 100) : 0;

  const segs = [
    { label: "Running",     value: running,     color: T.green, iconName: "play"    },
    { label: "Idle",        value: idle,        color: T.amber, iconName: "pause"   },
    { label: "Maintenance", value: maintenance, color: T.blue,  iconName: "gear"    },
    { label: "Breakdown",   value: breakdown,   color: T.red,   iconName: "warning" }
  ];

  return (
    <Card>
      <SectionTitle
        eyebrow="Shop Floor"
        title="Machine Utilization"
        action={
          <div style={{
            fontSize: 24, fontWeight: 800,
            color: utilization >= 80 ? T.green : utilization >= 50 ? T.amber : T.red,
            fontFamily: FONT_HEAD
          }}>
            {utilization}<span style={{ fontSize: 12, color: T.muted, marginLeft: 4 }}>% util.</span>
          </div>
        }
      />

      {/* Stacked horizontal bar */}
      <div style={{
        height: 14,
        borderRadius: 999,
        background: T.borderS,
        display: "flex",
        overflow: "hidden",
        marginBottom: 14
      }}>
        {segs.map((s) => total > 0 && s.value > 0 && (
          <div key={s.label} style={{
            width: `${(s.value/total)*100}%`,
            background: s.color
          }} />
        ))}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10
      }}>
        {segs.map((s) => (

          <div key={s.label} style={{
            border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px",
            display: "flex", alignItems: "center", gap: 10
          }}>
            <span style={{
              width: 30, height: 30, borderRadius: 15,
              background: s.color + "1a",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0
            }}>
              <MachineIcon name={s.iconName} color={s.color} />
            </span>
            <div>
              <div style={{
                fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: 0.8,
                textTransform: "uppercase", fontFamily: FONT_BODY
              }}>
                {s.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.text, fontFamily: FONT_HEAD, lineHeight: 1.1 }}>
                {s.value}
              </div>
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
    { key: "leaves",     label: "Leaves",            marker: "01", count: buckets?.leaves?.count || 0, to: "/approvals" },
    { key: "quotations", label: "Quotations",        marker: "02", count: buckets?.quotations?.count || 0, to: "/quotations" },
    { key: "pos",        label: "Purchase Orders",   marker: "03", count: buckets?.purchase_orders?.count || 0, to: "/purchase-orders" },
    { key: "payroll",    label: "Payroll",           marker: "04", count: buckets?.payroll?.count || 0, to: "/payroll" },
    { key: "customers",  label: "Customer Approvals",marker: "05", count: buckets?.customers?.count || 0, to: "/customers" }
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

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10
      }}>
        {items.map((it) => (

          <div key={it.key}
            onClick={() => nav(it.to)}
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 14,
              cursor: "pointer",
              transition: "all 0.15s",
              background: it.count ? T.orangeSoft : T.card
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = T.orange}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = T.border}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8
            }}>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                color: it.count ? T.orangeDeep : T.muted,
                letterSpacing: 0.6,
                fontFamily: FONT_HEAD
              }}>
                {it.marker}
              </span>
              {it.count > 0 && (
                <span style={{
                  background: T.orange, color: "white",
                  padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                  fontFamily: FONT_HEAD
                }}>
                  {it.count}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 12, fontWeight: 700, color: T.text2, marginBottom: 6, fontFamily: FONT_BODY
            }}>
              {it.label}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); nav(it.to); }}
              style={{
                background: it.count ? T.orange : T.borderS,
                color: it.count ? "white" : T.muted,
                border: "none",
                padding: "6px 10px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.4,
                cursor: it.count ? "pointer" : "default",
                width: "100%",
                fontFamily: FONT_BODY,
                textTransform: "uppercase"
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
    { label: "Lead",        count: total,                         color: "#94a3b8" },
    { label: "Qualified",   count: Math.round(total * 0.7),        color: "#60a5fa" },
    { label: "Quotation",   count: stats.total_quotations || 0,    color: "#a78bfa" },
    { label: "Negotiation", count: Math.round((stats.total_quotations || 0) * 0.6), color: "#fbbf24" },
    { label: "Won",         count: stats.total_sales_orders || 0,  color: "#34d399" },
    { label: "Lost",        count: Math.round((stats.total_quotations || 0) * 0.1), color: "#f87171" }
  ];

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <Card>
      <SectionTitle
        eyebrow="Customer Acquisition"
        title="Sales Funnel"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {stages.map((s, idx) => {

          const widthPct = Math.max(8, (s.count / maxCount) * 100);

          const conv = idx > 0 ? Math.round((s.count / stages[idx-1].count) * 100) : 100;

          return (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 100,
                fontSize: 11,
                fontWeight: 800,
                color: T.text2,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                fontFamily: FONT_BODY
              }}>
                {s.label}
              </div>
              <div style={{ flex: 1, position: "relative", height: 26 }}>
                <div style={{
                  height: "100%",
                  width: `${widthPct}%`,
                  background: s.color,
                  borderRadius: 6,
                  display: "flex", alignItems: "center", paddingLeft: 12,
                  color: "white", fontWeight: 800, fontSize: 12,
                  fontFamily: FONT_HEAD,
                  transition: "width 0.6s ease"
                }}>
                  {s.count}
                </div>
              </div>
              <div style={{
                width: 60,
                fontSize: 11,
                color: T.muted,
                textAlign: "right",
                fontWeight: 700,
                fontFamily: FONT_BODY
              }}>
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
    { label: "Low Stock Items", value: lowStock?.total || 0,                accent: T.red },
    { label: "Out of Stock",    value: stats.out_of_stock || 0,             accent: T.redDeep },
    { label: "Dead Stock",      value: stats.dead_stock || 0,               accent: T.muted },
    { label: "Fast Moving",     value: stats.fast_moving || 0,              accent: T.green }
  ];

  const lowList = (lowStock?.rows || []).slice(0, 5);

  return (
    <Card>
      <SectionTitle
        eyebrow="Materials"
        title="Inventory Command"
      />

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10,
        marginBottom: 16
      }}>
        {items.map((it) => (

          <div key={it.label} style={{
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: 12,
            position: "relative"
          }}>
            <div style={{
              position: "absolute", top: 0, left: 0, height: 2, width: "30%", background: it.accent
            }} />
            <div style={{
              fontSize: 9, fontWeight: 800, color: T.muted, letterSpacing: 0.8,
              textTransform: "uppercase", fontFamily: FONT_BODY
            }}>
              {it.label}
            </div>
            <div style={{
              fontSize: 22, fontWeight: 800, color: T.text, marginTop: 4,
              letterSpacing: -0.3, fontFamily: FONT_HEAD
            }}>
              {it.value}
            </div>
          </div>
        ))}
      </div>

      {lowList.length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
            color: T.muted, textTransform: "uppercase",
            marginBottom: 8, fontFamily: FONT_BODY
          }}>
            Top 5 Low Stock Items
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {lowList.map((it) => (
              <div key={it.label || it.MATERIAL_NAME} style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: "8px 12px",
                background: T.borderS, borderRadius: 6
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.text2, fontFamily: FONT_BODY }}>
                  {it.label || it.MATERIAL_NAME || "Unnamed"}
                </span>
                <span style={{ fontSize: 12, color: T.red, fontWeight: 800, fontFamily: FONT_HEAD }}>
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

  const ranks  = ["1st", "2nd", "3rd"];

  return (
    <Card>
      <SectionTitle
        eyebrow="This Month"
        title="Employee Leaderboard"
      />

      {top3.length === 0 && (
        <div style={{ padding: 28, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No performer data available yet.
        </div>
      )}

      {top3.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${top3.length}, 1fr)`,
          gap: 12
        }}>
          {top3.map((p, idx) => (

            <div key={p.employee_id || p.ID || idx} style={{
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 16,
              textAlign: "center",
              background: idx === 0
                ? "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)"
                : T.card
            }}>
              <div style={{ fontSize: 30, marginBottom: 4 }}>{medals[idx]}</div>
              <div style={{
                fontSize: 9, fontWeight: 800, color: T.muted, letterSpacing: 1,
                textTransform: "uppercase", fontFamily: FONT_BODY
              }}>
                {ranks[idx]}
              </div>
              <div style={{
                fontSize: 14, fontWeight: 800, color: T.text, margin: "6px 0 2px",
                fontFamily: FONT_HEAD
              }}>
                {p.name || p.NAME || "—"}
              </div>
              <div style={{ fontSize: 10, color: T.muted, marginBottom: 10 }}>
                {p.employee_code || p.EMPLOYEE_CODE || ""}
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8
              }}>
                <LBStat label="Attend." value={`${p.attendance_pct ?? p.ATTENDANCE_PCT ?? 0}%`} />
                <LBStat label="Tasks"   value={p.tasks_completed ?? p.TASKS_COMPLETED ?? 0} />
                <LBStat label="Score"   value={p.score ?? p.SCORE ?? 0} />
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
    <div style={{
      background: T.borderS, padding: "6px 4px", borderRadius: 6
    }}>
      <div style={{
        fontSize: 8, fontWeight: 800, color: T.muted, letterSpacing: 0.5,
        textTransform: "uppercase", fontFamily: FONT_BODY
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 800, color: T.text, marginTop: 1, fontFamily: FONT_HEAD
      }}>
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
        <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No activity recorded yet today.
        </div>
      )}

      <div style={{ position: "relative", paddingLeft: 22 }}>

        {/* Vertical spine line */}
        {rows.length > 0 && (
          <div style={{
            position: "absolute", left: 8, top: 8, bottom: 8,
            width: 2, background: T.borderS
          }} />
        )}

        {rows.map((e, idx) => (
          <div key={idx} style={{
            position: "relative",
            paddingBottom: idx === rows.length - 1 ? 0 : 18
          }}>
            <div style={{
              position: "absolute",
              left: -22, top: 4,
              width: 14, height: 14, borderRadius: "50%",
              background: T.card,
              border: `3px solid ${T.red}`,
              boxShadow: "0 0 0 3px white"
            }} />

            <div style={{ fontSize: 10, color: T.muted, letterSpacing: 0.4, fontFamily: FONT_BODY }}>
              {fmtTime(getTs(e))}
            </div>
            <div style={{
              fontSize: 13, fontWeight: 700, color: T.text, marginTop: 2, fontFamily: FONT_HEAD
            }}>
              {e.title || e.text || e.message || "Event"}
            </div>
            {getDetail(e) && (
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
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
  { key: "today",   label: "Today" },
  { key: "week",    label: "Week" },
  { key: "month",   label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year",    label: "Year" }
];

const ANALYTIC_METRICS = [
  { key: "revenue",     label: "Revenue Trend",     color: T.green,  type: "area" },
  { key: "production",  label: "Production Trend",  color: T.red,    type: "bar"  },
  { key: "orders",      label: "Order Trend",       color: T.purple, type: "line" },
  { key: "attendance",  label: "Employee Attendance",color:T.blue,   type: "line" },
  { key: "inventory",   label: "Inventory Consumption", color: T.amber, type: "area" }
];


function ExecutiveAnalytics() {

  const [tab,    setTab]    = useState("month");

  const [metric, setMetric] = useState("revenue");

  const [data,   setData]   = useState([]);

  const [loading, setLoading] = useState(false);

  useEffect(() => {

    setLoading(true);

    API.get(`/admin/dashboard/analytics/${metric}?range=${tab}`)
      .then((r) => setData(r.data?.series || r.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));

  }, [metric, tab]);

  const cfg = ANALYTIC_METRICS.find((m) => m.key === metric);

  const Chart = cfg?.type === "bar"  ? BarChart  :
                cfg?.type === "line" ? LineChart : AreaChart;

  return (
    <Card>
      <SectionTitle
        eyebrow="Trends"
        title="Executive Analytics"
        action={
          <div style={{ display: "flex", gap: 4 }}>
            {ANALYTIC_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  background: tab === t.key ? T.text : "transparent",
                  color:      tab === t.key ? "white" : T.muted,
                  border:    `1px solid ${tab === t.key ? T.text : T.border}`,
                  padding: "5px 12px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                  letterSpacing: 0.3,
                  fontFamily: FONT_BODY
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <div style={{
        display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14
      }}>
        {ANALYTIC_METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            style={{
              background: metric === m.key ? m.color + "15" : T.card,
              color:      metric === m.key ? m.color : T.muted,
              border:    `1px solid ${metric === m.key ? m.color : T.border}`,
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: 0.2,
              fontFamily: FONT_BODY
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ width: "100%", height: 280 }}>
        {loading && (
          <div style={{
            padding: 40, textAlign: "center", color: T.muted, fontSize: 13
          }}>
            Loading…
          </div>
        )}
        {!loading && data.length === 0 && (
          <div style={{
            padding: 40, textAlign: "center", color: T.muted, fontSize: 13
          }}>
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
              {cfg.type === "bar"  && <Bar  dataKey="value" fill={cfg.color} radius={[4,4,0,0]} />}
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
    { label: "Active Warnings",        value: stats?.active_warnings ?? 0,        color: "#dc2626", bg: "#fef2f2", emoji: "⚠️" },
    { label: "Disciplinary Open",      value: stats?.disciplinary_open ?? 0,      color: "#7c2d12", bg: "#fff7ed", emoji: "🚫" },
    { label: "Appreciations (Month)",  value: stats?.appreciations_this_month ?? 0,color:"#16a34a", bg: "#dcfce7", emoji: "🏆" },
    { label: "Pending Acknowledgement",value: stats?.pending_acknowledgement ?? 0,color: "#f59e0b", bg: "#fef3c7", emoji: "⏳" }
  ];

  return (
    <Card style={{ marginBottom: 22 }}>
      <SectionTitle
        eyebrow="HR · Audit Trail"
        title="📋 Employee Memo Summary"
        action={
          <button
            onClick={() => nav("/memos")}
            style={{
              background: "white",
              border: `1px solid ${T.border}`,
              color: T.text2,
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              letterSpacing: 0.3,
              fontFamily: FONT_BODY
            }}
          >
            Open Memos →
          </button>
        }
      />

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10
      }}>
        {tiles.map((t) => (
          <div key={t.label}
            onClick={() => nav("/memos")}
            style={{
              background: t.bg,
              border: `1px solid ${t.color}33`,
              borderRadius: 10,
              padding: 14,
              cursor: "pointer",
              transition: "all 0.15s"
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
          >
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6
            }}>
              <span style={{ fontSize: 16 }}>{t.emoji}</span>
              <span style={{
                fontSize: 9, fontWeight: 800, color: t.color, letterSpacing: 0.6,
                textTransform: "uppercase", textAlign: "right", lineHeight: 1.2,
                fontFamily: FONT_BODY
              }}>
                {t.label}
              </span>
            </div>
            <div style={{
              fontSize: 28, fontWeight: 800, color: t.color, letterSpacing: -0.5,
              fontFamily: FONT_HEAD, lineHeight: 1
            }}>
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
    { label: "Employee",      icon: "👤", to: "/employees" },
    { label: "Customer",      icon: "🤝", to: "/customers" },
    { label: "Quotation",     icon: "📄", to: "/quotations" },
    { label: "Sales Order",   icon: "📑", to: "/sales-orders" },
    { label: "Work Order",    icon: "🏭", to: "/production" },
    { label: "Purchase Order",icon: "🛒", to: "/purchase-orders" },
    { label: "Payroll Run",   icon: "💰", to: "/payroll" },
    { label: "Inventory Item",icon: "📦", to: "/inventory" }
  ];

  return (
    <>
      {open && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)",
          zIndex: 990
        }} onClick={() => setOpen(false)} />
      )}

      {open && (
        <div style={{
          position: "fixed", bottom: 96, right: 28,
          width: 280, zIndex: 991,
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: 16, padding: 14,
          boxShadow: "0 20px 50px rgba(15,23,42,0.18)"
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: T.muted, letterSpacing: 1.2,
            textTransform: "uppercase", marginBottom: 10, fontFamily: FONT_BODY
          }}>
            Quick Actions
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6
          }}>
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={() => { setOpen(false); nav(a.to); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 12px", borderRadius: 8,
                  background: T.borderS, border: "none",
                  cursor: "pointer", fontSize: 12, fontWeight: 700,
                  color: T.text, textAlign: "left",
                  fontFamily: FONT_BODY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = T.redSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = T.borderS}
              >
                <span style={{ fontSize: 14 }}>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        title="Quick actions"
        style={{
          position: "fixed", bottom: 28, right: 28,
          width: 56, height: 56, borderRadius: "50%",
          background: `linear-gradient(135deg, ${T.red}, ${T.redDeep})`,
          color: "white", border: "none",
          fontSize: 22, cursor: "pointer", zIndex: 992,
          boxShadow: "0 10px 30px rgba(200,16,46,0.40)",
          fontWeight: 800
        }}
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

  const [stats,      setStats]      = useState({});

  const [health,     setHealth]     = useState(null);

  const [factory,    setFactory]    = useState(null);

  const [insights,   setInsights]   = useState([]);

  const [flow,       setFlow]       = useState(null);

  const [activity,   setActivity]   = useState([]);

  const [performers, setPerformers] = useState([]);

  const [buckets,    setBuckets]    = useState({});

  const [lowStock,   setLowStock]   = useState({ total: 0, rows: [] });

  const [memoStats,  setMemoStats]  = useState({});

  useEffect(() => {

    // Load everything in parallel; missing endpoints fail gracefully
    const safe = (p, fallback) => p.then((r) => r.data).catch(() => fallback);

    Promise.all([
      safe(API.get("/admin/dashboard-stats"),            {}),
      safe(API.get("/admin/dashboard/health-score"),     null),
      safe(API.get("/admin/dashboard/factory-status"),   null),
      safe(API.get("/admin/dashboard/insights"),         []),
      safe(API.get("/admin/dashboard/production-flow"),  null),
      safe(API.get("/admin/dashboard/activity-feed"),    []),
      safe(API.get("/admin/dashboard/top-performers"),   []),
      safe(API.get("/admin/approvals/pending"),          {}),
      safe(API.get("/inventory?status=LOW_STOCK&limit=5"),[]),
      safe(API.get("/memos/stats"),                      {})
    ]).then(([s, h, f, ins, fl, act, perf, buck, lowStk, memos]) => {

      setStats(s || {});

      // Normalise health-score: backend uses {overall, scores: {key: {value, note}}}
      if (h && h.overall != null && h.scores) {

        const subs = Object.entries(h.scores).map(([k, v]) => ({
          key: k,
          label: k.charAt(0).toUpperCase() + k.slice(1),
          score: v?.value ?? 0,
          note:  v?.note  ?? ""
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
        name:            p.name || p.NAME,
        employee_code:   p.code || p.EMPLOYEE_CODE,
        score:           p.score ?? 0,
        attendance_pct:  p.attendance_pct ?? p.ATTENDANCE_PCT ?? "—",
        tasks_completed: p.tasks_completed ?? p.TASKS_COMPLETED ?? "—",
        badge:           p.badge
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
          QUANTITY:      r.QUANTITY      || r.value
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
    user_name:         "System Administrator",
    factory_health:    factoryHealthLabel,
    pending_approvals: Object.values(buckets || {})
                              .reduce((sum, b) => sum + (b?.count || 0), 0),
    active_wos:        factory?.active_wos || stats.active_wos || 0,
    monthly_revenue:   stats.monthly_revenue || 0
  };

  return (
    <div style={{
      background: T.bg,
      minHeight: "100vh",
      padding: "20px 28px 80px",
      fontFamily: FONT_BODY,
      color: T.text
    }}>

      <HeroBar stats={heroStats} />

      <ExecKPIRow stats={stats} />

      {/* <AIPriorityCenter insights={insights} /> — temporarily hidden */}

      <BusinessHealthGrid stats={stats} factory={factory} />

      {/* Health gauge + Production pipeline side-by-side */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
        marginBottom: 22
      }}>
        <HealthGauge health={health} />
        <FactoryFloor factory={factory} />
      </div>

      {/* Approval + CRM funnel side-by-side */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.2fr 1fr",
        gap: 14,
        marginBottom: 22
      }}>
        <ApprovalCenter buckets={buckets} />
        <CRMFunnel stats={stats} />
      </div>

      <div style={{ marginBottom: 22 }}>
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
