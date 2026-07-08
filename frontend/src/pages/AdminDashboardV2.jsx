// =====================================================================
// AI-POWERED ERP MISSION CONTROL — Phase 1 Foundation
// =====================================================================
// P1 scope:
//   - ThemeProvider (light / dark / auto, persisted in localStorage)
//   - Design tokens via CSS variables
//   - Animated mesh-gradient hero with particles + light sweep
//   - 4 live status pills (ERP, AI, revenue today, presence today)
//   - Premium 12-tile KPI grid (count-up + stagger + hover lift + glow)
//   - Floating theme toggle (top-right)
//   - Skeleton loaders + error isolation
//   - Auto-refresh every 30 seconds
//   - Responsive: 4-col → 2-col → 1-col
//
// Phases 2-8 (health score, factory, flow, insights, approvals embed,
// timeline, performers, analytics, voice, FABs) will hang off this
// foundation without changes to the tokens or theme system.
// =====================================================================

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import API from "../services/api";
import styles from "./AdminDashboardV2.module.css";


// =====================================================================
// THEME — context + provider + hook
// =====================================================================

const ThemeContext = createContext({ theme: "light", setTheme: () => {} });

const useTheme = () => useContext(ThemeContext);

function resolveTheme(pref) {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  // auto
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

function ThemeProvider({ children }) {

  const [pref, setPref] = useState(() => {
    try { return localStorage.getItem("bvc24_theme") || "light"; }
    catch { return "light"; }
  });

  const theme = resolveTheme(pref);

  useEffect(() => {
    document.documentElement.setAttribute("data-bvc-theme", theme);
    return () => {
      // Don't reset on unmount — keeps theme stable when navigating away
    };
  }, [theme]);

  const setTheme = useCallback((next) => {
    setPref(next);
    try { localStorage.setItem("bvc24_theme", next); }
    catch { /* storage blocked */ }
  }, []);

  const value = useMemo(() => ({ theme, pref, setTheme }), [theme, pref, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      <DesignTokens />
      {children}
    </ThemeContext.Provider>
  );
}


// =====================================================================
// DESIGN TOKENS — injected once as a <style> tag
// =====================================================================

function DesignTokens() {
  return (
    <style>{`
      :root {
        /* Brand */
        --c-primary:   #B3001B;
        --c-primary-2: #D90429;
        --c-accent-warn: #F59E0B;
        --c-accent-ok:   #10B981;
        --c-accent-info: #3B82F6;
        --c-accent-purple: #8B5CF6;

        /* Surfaces — light */
        --c-bg:         #F8FAFC;
        --c-bg-2:       #EEF2F7;
        --c-surface:    #FFFFFF;
        --c-surface-2:  #F1F5F9;
        --c-surface-3:  #E2E8F0;
        --c-border:     #E2E8F0;
        --c-border-2:   #CBD5E1;
        --c-text:       #0F172A;
        --c-text-muted: #64748B;
        --c-text-subtle:#94A3B8;

        /* Glass */
        --glass-bg:     rgba(255,255,255,0.65);
        --glass-border: rgba(255,255,255,0.55);
        --glass-blur:   blur(20px);

        /* Mesh gradient stops */
        --mesh-1: rgba(217, 4, 41, 0.30);
        --mesh-2: rgba(245, 158, 11, 0.18);
        --mesh-3: rgba(59, 130, 246, 0.18);
        --mesh-4: rgba(139, 92, 246, 0.16);

        /* Shadows */
        --shadow-1: 0 2px 8px rgba(15,23,42,0.06);
        --shadow-2: 0 8px 24px rgba(15,23,42,0.10);
        --shadow-3: 0 20px 48px rgba(15,23,42,0.16);
        --shadow-glow: 0 0 40px rgba(179,0,27,0.30);

        /* Radii */
        --r-md: 12px;
        --r-lg: 18px;
        --r-xl: 28px;

        /* Motion */
        --ease-out: cubic-bezier(.22,.61,.36,1);

        /* Typography */
        --font-display: "Inter", "Segoe UI", system-ui, sans-serif;
        --font-mono: "JetBrains Mono", ui-monospace, monospace;
      }

      [data-bvc-theme="dark"] {
        --c-bg:         #0B1220;
        --c-bg-2:       #0F172A;
        --c-surface:    #111827;
        --c-surface-2:  #1F2937;
        --c-surface-3:  #374151;
        --c-border:     #2A3346;
        --c-border-2:   #475569;
        --c-text:       #F1F5F9;
        --c-text-muted: #94A3B8;
        --c-text-subtle:#64748B;

        --glass-bg:     rgba(17, 24, 39, 0.55);
        --glass-border: rgba(148, 163, 184, 0.18);

        --mesh-1: rgba(217, 4, 41, 0.32);
        --mesh-2: rgba(245, 158, 11, 0.16);
        --mesh-3: rgba(59, 130, 246, 0.22);
        --mesh-4: rgba(139, 92, 246, 0.20);

        --shadow-1: 0 2px 8px rgba(0,0,0,0.30);
        --shadow-2: 0 8px 24px rgba(0,0,0,0.40);
        --shadow-3: 0 20px 48px rgba(0,0,0,0.50);
        --shadow-glow: 0 0 50px rgba(217,4,41,0.45);
      }

      /* Smooth theme switch */
      :root, [data-bvc-theme="dark"] {
        transition:
          background-color 0.32s var(--ease-out),
          color 0.32s var(--ease-out);
      }
      .bvc-themed * {
        transition: background-color 0.32s var(--ease-out),
                    color 0.32s var(--ease-out),
                    border-color 0.32s var(--ease-out),
                    box-shadow 0.32s var(--ease-out);
      }

      /* Animations */
      @keyframes bvc-mesh-drift {
        0%   { transform: translate(0, 0) scale(1); }
        33%  { transform: translate(2%, -2%) scale(1.05); }
        66%  { transform: translate(-2%, 2%) scale(0.98); }
        100% { transform: translate(0, 0) scale(1); }
      }
      @keyframes bvc-light-sweep {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
      }
      @keyframes bvc-pulse-dot {
        0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 var(--c-accent-ok); }
        50%      { opacity: 0.6; transform: scale(0.85); box-shadow: 0 0 14px 2px var(--c-accent-ok); }
      }
      @keyframes bvc-tile-in {
        0%   { opacity: 0; transform: translateY(24px) scale(0.96); filter: blur(8px); }
        60%  { opacity: 1; filter: blur(0); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes bvc-icon-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes bvc-skeleton {
        0%   { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }

      /* FAB-specific animations (P5) */
      @keyframes bvc-fab-ring {
        0%, 100% { box-shadow: 0 0 0 0 rgba(217,4,41,0.50), 0 12px 32px rgba(217,4,41,0.40); }
        50%      { box-shadow: 0 0 0 12px rgba(217,4,41,0.0),  0 12px 32px rgba(217,4,41,0.40); }
      }
      @keyframes bvc-fab-orbit {
        0%   { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes bvc-mic-pulse {
        0%, 100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(217,4,41,0.60); }
        50%      { transform: scale(1.08); box-shadow: 0 0 0 12px rgba(217,4,41,0.0); }
      }
      @keyframes bvc-panel-up {
        from { opacity: 0; transform: translateY(20px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes bvc-quickaction-pop {
        0%   { opacity: 0; transform: translateX(-12px) scale(0.86); }
        100% { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes bvc-msg-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes bvc-typing {
        0%, 80%, 100% { transform: scale(0.7); opacity: 0.45; }
        40%           { transform: scale(1);   opacity: 1; }
      }
    `}</style>
  );
}


// =====================================================================
// PARTICLES — lightweight canvas, ~30 drifting dots
// =====================================================================

function HeroParticles() {

  const canvasRef = useRef(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, width * dpr);
      canvas.height = Math.max(1, height * dpr);
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const COUNT = 28;
    const particles = Array.from({ length: COUNT }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00018,
      vy: (Math.random() - 0.5) * 0.00018,
      r: 0.6 + Math.random() * 1.6,
      a: 0.18 + Math.random() * 0.45,
      hue: i % 3,        // 0=red, 1=gold, 2=blue
    }));

    const colorForHue = (h) => {
      if (h === 1) return "245, 158, 11";    // gold
      if (h === 2) return "59, 130, 246";    // blue
      return "217, 4, 41";                    // red
    };

    const tick = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorForHue(p.hue)}, ${p.a})`;
        ctx.shadowColor = `rgba(${colorForHue(p.hue)}, 0.65)`;
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [theme]);

  return (
    <canvas ref={canvasRef} className={styles.heroCanvas} />
  );
}


// =====================================================================
// HERO COMMAND CENTER
// =====================================================================

function useNowClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatMoney(n) {
  if (n == null) return "₹0";
  const v = Number(n);
  if (Math.abs(v) >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(2)} L`;
  if (Math.abs(v) >= 1_000)       return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function HeroCommandCenter({ stats, loading }) {

  const username = (() => {
    try { return localStorage.getItem("username") || "Managing Director"; }
    catch { return "Managing Director"; }
  })();

  const [company, setCompany] = useState({ LEGAL_NAME: "BVC24", SHORT_NAME: "BVC24" });
  useEffect(() => {
    API.get("/settings/company")
      .then((r) => setCompany(r.data || company))
      .catch(() => { /* keep defaults */ });
    // eslint-disable-next-line
  }, []);

  const now = useNowClock();

  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  return (
    <section className={styles.hero}>

      {/* Mesh drift overlay */}
      <div className={styles.heroMeshOverlay} />

      {/* Light sweep */}
      <div className={styles.heroLightSweep} />

      {/* Particles */}
      <HeroParticles />

      {/* Content */}
      <div className={styles.heroContent}>
        {/* Left — welcome + company + datetime */}
        <div>
          <div className={styles.heroEyebrow}>
            BVC24 · AI MISSION CONTROL
          </div>
          <h1 className={styles.heroTitle}>
            Welcome back, {username}
          </h1>
          <div className={styles.heroCompany}>
            {company.LEGAL_NAME || "BVC24"}
          </div>
          <div className={styles.heroClock}>
            <div>
              <div className={styles.clockLabel}>Date</div>
              <div className={styles.clockDate}>{dateStr}</div>
            </div>
            <div>
              <div className={styles.clockLabel}>Time</div>
              <div className={styles.clockTime}>
                {timeStr} <span className={styles.clockIST}>IST</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right — 4 status pills */}
        <div className={styles.heroPillGrid}>
          <StatusPill
            label="ERP Status"
            value="ONLINE"
            tone="ok"
            icon="🟢"
            loading={false}
          />
          <StatusPill
            label="AI Engine"
            value="ACTIVE"
            tone="info"
            icon="🧠"
            loading={false}
          />
          <StatusPill
            label="Revenue Today"
            value={loading ? "···" : formatMoney(stats?.monthly_revenue || 0)}
            tone="warn"
            icon="💰"
            loading={loading}
            mono
          />
          <StatusPill
            label="Live Now"
            value={
              loading
                ? "···"
                : `${stats?.employees_present_today ?? 0} present · ${
                    stats?.production_status?.TOTAL_ACTIVE ?? 0
                  } prod`
            }
            tone="primary"
            icon="⚡"
            loading={loading}
          />
        </div>
      </div>
    </section>
  );
}

function StatusPill({ label, value, tone, icon, loading, mono }) {
  const toneColors = {
    ok:      { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.35)", text: "var(--c-accent-ok)" },
    info:    { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.35)", text: "var(--c-accent-info)" },
    warn:    { bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.35)", text: "var(--c-accent-warn)" },
    primary: { bg: "rgba(217,4,41,0.12)",   border: "rgba(217,4,41,0.35)",   text: "var(--c-primary-2)" },
  };
  const t = toneColors[tone] || toneColors.info;
  return (
    <div className={styles.statusPill} style={{ border: `1px solid ${t.border}` }}>
      <div
        className={styles.statusPillIconBox}
        style={{ background: t.bg }}
      >
        {icon}
      </div>
      <div className={styles.statusPillText}>
        <div className={styles.statusPillLabel}>{label}</div>
        <div
          className={styles.statusPillValue}
          style={{
            color: t.text,
            fontFamily: mono ? "var(--font-mono)" : "var(--font-display)",
          }}
        >
          {tone === "ok" && <span className={styles.pulseDot} />}
          {loading ? <Skeleton width={70} /> : value}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// KPI GRID — 12 premium tiles
// =====================================================================

const KPI_DEFS = [
  { key: "monthly_revenue",         label: "Revenue (Month)",       icon: "💰", tone: "primary", format: "money", href: "/sales-orders" },
  { key: "total_sales_orders",      label: "Sales Orders",          icon: "🛒", tone: "ok",      format: "int",   href: "/sales-orders" },
  { key: "total_quotations",        label: "Quotations",            icon: "📋", tone: "info",    format: "int",   href: "/quotations" },
  { key: "total_customers",         label: "Customers",             icon: "👥", tone: "purple",  format: "int",   href: "/customers" },
  { key: "active_projects",         label: "Active Projects",       icon: "🏗️", tone: "warn",    format: "int",   href: "/projects" },
  { key: "production_active",       label: "Production Running",    icon: "🏭", tone: "primary", format: "int",   href: "/production" },
  { key: "inventory_value",         label: "Inventory Value",       icon: "🏷️", tone: "ok",      format: "money", href: "/inventory" },
  { key: "purchase_orders",         label: "Purchase Orders",       icon: "📦", tone: "info",    format: "int",   href: "/purchase-orders" },
  { key: "pending_payments",        label: "Pending Payments",      icon: "💳", tone: "warn",    format: "money", href: "/sales-orders" },
  { key: "employees_present_today", label: "Employees Present",     icon: "🟢", tone: "ok",      format: "int",   href: "/attendance" },
  { key: "leave_requests_pending",  label: "Leave Requests",        icon: "🌴", tone: "purple",  format: "int",   href: "/approvals" },
  { key: "ai_notifications",        label: "AI Notifications",      icon: "🔔", tone: "primary", format: "int",   href: "#" },
];

const TONE_GRADIENTS = {
  primary: "#D90429",
  ok:      "#10B981",
  info:    "#3B82F6",
  warn:    "#F59E0B",
  purple:  "#8B5CF6",
};

function useCountUp(value, duration = 1200) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) { setDisplay(to); return; }
    const start = performance.now();
    const tick = (t) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);
  return display;
}

function formatKPI(format, n) {
  if (format === "money") return formatMoney(n);
  return (Number(n) || 0).toLocaleString("en-IN");
}

function KPICard({ def, value, series, index, loading }) {

  const animated = useCountUp(Number(value) || 0);
  const text = loading ? "—" : formatKPI(def.format, animated);

  // Trend % vs the average of the rest of the series
  const trend = useMemo(() => {
    if (!series || series.length < 2) return null;
    const last = Number(series[series.length - 1] || 0);
    const prev = Number(series[series.length - 2] || 0);
    if (prev === 0 && last === 0) return null;
    if (prev === 0) return { dir: "up", pct: 100 };
    const change = ((last - prev) / Math.abs(prev)) * 100;
    if (Math.abs(change) < 0.5) return { dir: "flat", pct: 0 };
    return { dir: change > 0 ? "up" : "down", pct: Math.abs(change) };
  }, [series]);

  const onClick = () => {
    if (def.href && def.href !== "#") {
      window.location.href = def.href;
    }
  };

  return (
    <div
      onClick={onClick}
      className={`${styles.kpiCard} ${def.href === "#" ? styles.kpiCardDefault : styles.kpiCardClickable}`}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Subtle gradient bar at top — per-tone, data-driven */}
      <div
        className={styles.kpiTopBar}
        style={{ background: TONE_GRADIENTS[def.tone] || TONE_GRADIENTS.primary }}
      />

      {/* Hover glow tint — CSS handles opacity/visibility */}
      <div className={styles.kpiGlowTint} />

      <div className={styles.kpiHeader}>
        <div className={styles.kpiLabel}>{def.label}</div>
        <div
          className={styles.kpiIconBox}
          style={{ background: TONE_GRADIENTS[def.tone] || TONE_GRADIENTS.primary }}
        >
          {def.icon}
        </div>
      </div>

      <div className={styles.kpiValueRow}>
        <div className={styles.kpiValue}>
          {loading ? <Skeleton width={120} height={28} /> : text}
        </div>
        {trend && !loading && (
          <TrendBadge dir={trend.dir} pct={trend.pct} />
        )}
      </div>

      {/* Real sparkline driven by 7-day series */}
      <div className={styles.kpiSparkWrap}>
        <Sparkline series={series} tone={def.tone} />
      </div>

      {/* Bottom strip */}
      <div className={styles.kpiStripTrack}>
        <div
          className={styles.kpiStripFill}
          style={{ background: TONE_GRADIENTS[def.tone] || TONE_GRADIENTS.primary }}
        />
      </div>
    </div>
  );
}

function toneRGB(tone, alpha) {
  const map = {
    primary: `rgba(217,4,41,${alpha})`,
    ok:      `rgba(16,185,129,${alpha})`,
    info:    `rgba(59,130,246,${alpha})`,
    warn:    `rgba(245,158,11,${alpha})`,
    purple:  `rgba(139,92,246,${alpha})`,
  };
  return map[tone] || map.primary;
}

function Sparkline({ series, tone, animated }) {

  // All derived values computed in a single useMemo so the hook
  // order is stable regardless of whether the series is empty.
  const shape = useMemo(() => {
    const valid = Array.isArray(series) && series.length > 0
      && series.some((v) => Number(v) !== 0);
    if (!valid) return null;

    const points = series.map((v) => Number(v) || 0);
    const w = 140;
    const h = 32;
    const stepX = w / Math.max(1, points.length - 1);
    const max = Math.max(...points);
    const min = Math.min(...points);
    const span = max - min || 1;
    const yAt = (i) => h - ((points[i] - min) / span) * (h - 6) - 3;

    let line = `M0,${yAt(0)}`;
    for (let i = 1; i < points.length; i++) {
      const x  = i * stepX;
      const y  = yAt(i);
      const px = (i - 1) * stepX;
      const py = yAt(i - 1);
      const cpX = (px + x) / 2;
      line += ` Q${cpX},${py} ${cpX + 0.001},${(py + y) / 2}`;
      line += ` T${x},${y}`;
    }
    const fill = `${line} L${w},${h} L0,${h} Z`;
    const lastX = (points.length - 1) * stepX;
    const lastY = yAt(points.length - 1);
    return { line, fill, lastX, lastY };
  }, [series]);

  // Empty / flat — render a faint dashed baseline
  if (!shape) {
    return (
      <svg width="100%" height="32" viewBox="0 0 140 32" preserveAspectRatio="none"
           style={{ display: "block" }}>
        <line x1="0" y1="22" x2="140" y2="22"
              stroke="var(--c-border)" strokeWidth="1" strokeDasharray="3 4" />
      </svg>
    );
  }

  return (
    <svg width="100%" height="32" viewBox="0 0 140 32" preserveAspectRatio="none"
         style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`spark-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={toneRGB(tone, 0.32)} />
          <stop offset="100%" stopColor={toneRGB(tone, 0)} />
        </linearGradient>
      </defs>
      <path d={shape.fill} fill={`url(#spark-fill-${tone})`} />
      <path
        d={shape.line}
        stroke={toneRGB(tone, 1)}
        strokeWidth={animated ? 2.2 : 1.6}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: "stroke-width 0.28s var(--ease-out)" }}
      />
      <circle cx={shape.lastX} cy={shape.lastY} r={animated ? 3.4 : 2.4}
              fill={toneRGB(tone, 1)}
              style={{ transition: "r 0.28s var(--ease-out)" }} />
      <circle cx={shape.lastX} cy={shape.lastY} r="6"
              fill={toneRGB(tone, 0.25)} />
    </svg>
  );
}

function TrendBadge({ dir, pct }) {
  const map = {
    up:   { cls: styles.trendUp,   arrow: "▲" },
    down: { cls: styles.trendDown, arrow: "▼" },
    flat: { cls: styles.trendFlat, arrow: "–" },
  };
  const s = map[dir] || map.flat;
  return (
    <span className={`${styles.trendBadge} ${s.cls}`}>
      <span>{s.arrow}</span>
      <span>{pct.toFixed(0)}%</span>
    </span>
  );
}


// =====================================================================
// SKELETON loader
// =====================================================================

function Skeleton({ width = 80, height = 14 }) {
  return (
    <span
      className={styles.skeleton}
      style={{ width, height }}
    />
  );
}


// =====================================================================
// THEME TOGGLE — floating button, top-right
// =====================================================================

function ThemeToggle() {
  const { pref, setTheme, theme } = useTheme();
  const next = pref === "dark" ? "light" : pref === "light" ? "auto" : "dark";
  const label = pref === "dark" ? "Dark" : pref === "light" ? "Light" : "Auto";
  const icon  = pref === "dark" ? "🌙" : pref === "light" ? "☀️" : "🌓";
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Theme: ${label} — click to cycle (current visible: ${theme})`}
      className={styles.themeToggleBtn}
    >
      <span className={styles.themeToggleIcon}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}


// =====================================================================
// MAIN PAGE
// =====================================================================

function AdminDashboardV2Inner() {

  const [stats, setStats]             = useState({});
  const [sparklines, setSparklines]   = useState({});
  const [health, setHealth]           = useState(null);
  const [factory, setFactory]         = useState(null);
  const [flow, setFlow]               = useState(null);
  const [insights, setInsights]       = useState([]);
  const [activity, setActivity]       = useState([]);
  const [approvals, setApprovals]     = useState(null);
  const [performers, setPerformers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [s, sp, hs, fs, pf, ins, act, app, tp] = await Promise.all([
        API.get("/admin/dashboard-stats"),
        API.get("/admin/dashboard/sparklines").catch(() => ({ data: {} })),
        API.get("/admin/dashboard/health-score").catch(() => ({ data: null })),
        API.get("/admin/dashboard/factory-status").catch(() => ({ data: null })),
        API.get("/admin/dashboard/production-flow").catch(() => ({ data: null })),
        API.get("/admin/dashboard/insights").catch(() => ({ data: { insights: [] } })),
        API.get("/admin/dashboard/activity-feed?limit=14").catch(() => ({ data: { items: [] } })),
        API.get("/admin/approvals/pending").catch(() => ({ data: null })),
        API.get("/admin/dashboard/top-performers").catch(() => ({ data: { categories: [] } })),
      ]);
      const d = s.data || {};
      d.production_active = d.production_status?.TOTAL_ACTIVE ?? 0;
      setStats(d);
      setSparklines(sp.data || {});
      setHealth(hs.data);
      setFactory(fs.data);
      setFlow(pf.data);
      setInsights(ins.data?.insights || []);
      setActivity(act.data?.items || []);
      setApprovals(app.data || null);
      setPerformers(tp.data?.categories || []);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30 * 1000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return (
    <div className={`bvc-themed ${styles.page}`}>
      {/* Floating theme toggle */}
      <div className={styles.themeToggleAnchor}>
        <ThemeToggle />
      </div>

      {/* Hero */}
      <HeroCommandCenter stats={stats} loading={loading} />

      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>⚠ {error}</div>
      )}

      {/* KPI grid */}
      <section className={styles.kpiGrid}>
        {KPI_DEFS.map((def, i) => (
          <KPICard
            key={def.key}
            def={def}
            value={stats[def.key]}
            series={sparklines[def.key]}
            index={i}
            loading={loading}
          />
        ))}
      </section>

      {/* Health Score + Factory Control — 2-column row */}
      <section className={styles.twoColRow}>
        <HealthScorePanel data={health} />
        <FactoryControlPanel data={factory} />
      </section>

      {/* Production Flow — full width */}
      <section className={styles.fullWidthSection}>
        <ProductionFlowPanel data={flow} />
      </section>

      {/* AI Insights + Approval Center — 2-col */}
      <section className={styles.insightsApprovalRow}>
        <AIInsightEngine insights={insights} />
        <ApprovalEmbed approvals={approvals} />
      </section>

      {/* Activity timeline — full width */}
      <section className={styles.fullWidthSection}>
        <ActivityTimeline items={activity} />
      </section>

      {/* Top Performers — full width */}
      <section className={styles.fullWidthSection}>
        <TopPerformersPanel performers={performers} />
      </section>

      {/* Enterprise Analytics — full width tabbed chart */}
      <section className={styles.fullWidthSection}>
        <EnterpriseAnalytics />
      </section>

      {/* Placeholder for phases P5-P8 */}
      <section className={styles.comingSoon}>
        🚧 Phases 6–8 land here: Notification Drawer · polish ·
        error boundaries · print stylesheet · handover.
      </section>
    </div>
  );
}


// =====================================================================
// TOP PERFORMERS — 5 spotlight cards
// =====================================================================

function TopPerformersPanel({ performers }) {

  return (
    <PanelCard
      eyebrow="Hall of Fame"
      title="Top Performers"
      icon="🏆"
      right={(
        <div className={styles.performerCountLabel}>
          {performers.length} spotlight{performers.length === 1 ? "" : "s"}
        </div>
      )}
    >
      {performers.length === 0 ? (
        <div className={styles.performerEmptyMsg}>
          No performance data captured yet — top performers will appear
          once attendance, sales, and production activity is recorded
          this month.
        </div>
      ) : (
        <div className={styles.performerGrid}>
          {performers.map((p, i) => (
            <PerformerCard key={i} p={p} index={i} />
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function PerformerCard({ p, index }) {

  const tone = p.badge_color || "info";

  // Build a public photo URL if relative
  const photoSrc = p.photo_url
    ? (p.photo_url.startsWith("http")
        ? p.photo_url
        : `${API.defaults.baseURL || ""}${p.photo_url}`)
    : null;

  return (
    <div
      className={styles.performerCard}
      style={{
        border: `1px solid ${toneRGB(tone, 0.32)}`,
        animationDelay: `${index * 0.07}s`,
      }}
    >
      {/* Gradient halo behind avatar */}
      <div
        className={styles.performerHalo}
        style={{ background: `radial-gradient(circle, ${toneRGB(tone, 0.20)}, transparent 70%)` }}
      />

      {/* Avatar */}
      <div className={styles.performerAvatarWrap}>
        <div
          className={styles.performerAvatar}
          style={{
            background: photoSrc ? "var(--c-surface-2)" : toneRGB(tone, 0.85),
            boxShadow: `0 8px 24px ${toneRGB(tone, 0.40)}`,
          }}
        >
          {photoSrc ? (
            <img
              src={photoSrc}
              alt={p.name}
              className={styles.performerAvatarImg}
              onError={(e) => {
                e.currentTarget.style.display = "none";
                if (e.currentTarget.nextSibling) {
                  e.currentTarget.nextSibling.style.display = "flex";
                }
              }}
            />
          ) : null}
          {photoSrc ? (
            <span className={styles.performerAvatarFallback}>
              {p.initial}
            </span>
          ) : (
            <span>{p.initial}</span>
          )}

          {/* Crown / medal overlay for first card (EoM) */}
          {index === 0 && (
            <div className={styles.performerCrown}>
              👑
            </div>
          )}
        </div>
      </div>

      {/* Badge pill */}
      <div className={styles.performerBadgeRow}>
        <span
          className={styles.performerBadge}
          style={{
            background: toneRGB(tone, 0.16),
            color: toneRGB(tone, 1),
            border: `1px solid ${toneRGB(tone, 0.30)}`,
          }}
        >
          {p.badge}
        </span>
      </div>

      {/* Name */}
      <div className={styles.performerName}>
        {p.name}
      </div>

      {/* Designation / department */}
      {p.designation && (
        <div className={styles.performerDesig}>
          {p.designation}
        </div>
      )}

      {/* Score / subtitle */}
      <div className={styles.performerScore}>
        <div className={styles.performerScoreVal} style={{ color: toneRGB(tone, 1) }}>
          {p.score ? p.score : "—"}
        </div>
        <div className={styles.performerScoreSub}>
          {p.subtitle || p.score_label}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// ENTERPRISE ANALYTICS — tabbed Recharts panel
// =====================================================================

const ANALYTICS_TABS = [
  { key: "revenue",    label: "Revenue Trend",    icon: "💰", tone: "primary", format: "money", chart: "area" },
  { key: "sales",      label: "Sales Growth",     icon: "🛒", tone: "ok",      format: "int",   chart: "bar"  },
  { key: "production", label: "Production",       icon: "🏭", tone: "warn",    format: "int",   chart: "area" },
  { key: "customers",  label: "Customer Growth",  icon: "👥", tone: "purple",  format: "int",   chart: "line" },
  { key: "inventory",  label: "Consumption",      icon: "📦", tone: "info",    format: "int",   chart: "bar"  },
];

const ANALYTICS_RANGES = [
  { key: "3m",  label: "3M"  },
  { key: "6m",  label: "6M"  },
  { key: "12m", label: "12M" },
  { key: "24m", label: "24M" },
];

function EnterpriseAnalytics() {

  const [active, setActive] = useState("revenue");
  const [range, setRange]   = useState("6m");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  const tab = ANALYTICS_TABS.find((t) => t.key === active) || ANALYTICS_TABS[0];
  const { theme } = useTheme();

  useEffect(() => {
    setLoading(true);
    API.get(`/admin/dashboard/analytics/${active}?range=${range}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [active, range]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.labels.map((lbl, i) => ({
      label: lbl,
      value: data.series[i],
    }));
  }, [data]);

  const trend = data?.trend;
  const total = data?.total || 0;
  const stroke = toneRGB(tab.tone, 1);
  const fill   = toneRGB(tab.tone, 0.18);
  const isDark = theme === "dark";

  return (
    <PanelCard
      eyebrow="Enterprise Analytics"
      title="Performance over time"
      icon="📊"
      right={(
        <div className={styles.analyticsRangeBtns}>
          {ANALYTICS_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`${styles.analyticsRangeBtn}${range === r.key ? ` ${styles.analyticsRangeBtnActive}` : ""}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    >
      {/* Tab strip */}
      <div className={styles.analyticsTabStrip}>
        {ANALYTICS_TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`${styles.analyticsTab}${isActive ? ` ${styles.analyticsTabActive}` : ""}`}
              style={{
                color: isActive ? toneRGB(t.tone, 1) : undefined,
                borderBottomColor: isActive ? toneRGB(t.tone, 1) : undefined,
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Header — total + trend */}
      <div className={styles.analyticsTotals}>
        <div>
          <div className={styles.analyticsTotalLabel}>
            {range.toUpperCase()} total
          </div>
          <div className={styles.analyticsTotalVal} style={{ color: toneRGB(tab.tone, 1) }}>
            {tab.format === "money" ? formatMoney(total) : Number(total).toLocaleString("en-IN")}
          </div>
        </div>
        {trend && (
          <TrendBadge dir={trend.direction} pct={trend.pct} />
        )}
      </div>

      {/* Chart */}
      <div className={styles.analyticsChartWrap}>
        {loading && (
          <div className={styles.analyticsLoading}>Loading…</div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {tab.chart === "bar" ? (
            <BarChart data={chartData} margin={{ top: 10, right: 14, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={isDark ? "#1F2937" : "#E2E8F0"} strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#64748B", fontSize: 11 }}
                     axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: isDark ? "#94A3B8" : "#64748B", fontSize: 11 }}
                     axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: toneRGB(tab.tone, 0.08) }}
                contentStyle={{
                  background: isDark ? "#111827" : "white",
                  border: `1px solid ${toneRGB(tab.tone, 0.30)}`,
                  borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.20)",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: isDark ? "#F1F5F9" : "#0F172A",
                }}
                formatter={(v) => [
                  tab.format === "money"
                    ? formatMoney(v)
                    : Number(v).toLocaleString("en-IN"),
                  tab.label,
                ]}
              />
              <Bar dataKey="value" fill={stroke} radius={[6, 6, 0, 0]} />
            </BarChart>
          ) : tab.chart === "line" ? (
            <LineChart data={chartData} margin={{ top: 10, right: 14, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={isDark ? "#1F2937" : "#E2E8F0"} strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#64748B", fontSize: 11 }}
                     axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: isDark ? "#94A3B8" : "#64748B", fontSize: 11 }}
                     axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: isDark ? "#111827" : "white",
                  border: `1px solid ${toneRGB(tab.tone, 0.30)}`,
                  borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.20)",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: isDark ? "#F1F5F9" : "#0F172A",
                }}
                formatter={(v) => [
                  Number(v).toLocaleString("en-IN"),
                  tab.label,
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={2.5}
                dot={{ fill: stroke, r: 3 }}
                activeDot={{ r: 6, fill: stroke }}
              />
            </LineChart>
          ) : (
            <AreaChart data={chartData} margin={{ top: 10, right: 14, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id={`area-${tab.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={fill} stopOpacity={1} />
                  <stop offset="100%" stopColor={fill} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={isDark ? "#1F2937" : "#E2E8F0"} strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#64748B", fontSize: 11 }}
                     axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: isDark ? "#94A3B8" : "#64748B", fontSize: 11 }}
                     axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: isDark ? "#111827" : "white",
                  border: `1px solid ${toneRGB(tab.tone, 0.30)}`,
                  borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.20)",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: isDark ? "#F1F5F9" : "#0F172A",
                }}
                formatter={(v) => [
                  tab.format === "money"
                    ? formatMoney(v)
                    : Number(v).toLocaleString("en-IN"),
                  tab.label,
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={2.2}
                fill={`url(#area-${tab.key})`}
                animationDuration={800}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </PanelCard>
  );
}


// =====================================================================
// AI INSIGHT ENGINE — severity-coloured cards w/ action chips
// =====================================================================

const SEVERITY_STYLES = {
  critical: {
    bg: "rgba(217,4,41,0.06)",
    border: "rgba(217,4,41,0.35)",
    color: "var(--c-primary-2)",
    label: "Critical",
  },
  warning: {
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.40)",
    color: "var(--c-accent-warn)",
    label: "Warning",
  },
  info: {
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.40)",
    color: "var(--c-accent-info)",
    label: "Info",
  },
  success: {
    bg: "rgba(16,185,129,0.08)",
    border: "rgba(16,185,129,0.40)",
    color: "var(--c-accent-ok)",
    label: "On Track",
  },
};

function AIInsightEngine({ insights }) {
  return (
    <PanelCard
      eyebrow="AI Insight Engine"
      title="What needs your attention"
      icon="🤖"
      right={(
        <div className={styles.livePill}>
          <span className={styles.liveDot} />
          LIVE
        </div>
      )}
    >
      {insights.length === 0 ? (
        <div className={styles.insightEmptyMsg}>
          No insights yet — data is still loading.
        </div>
      ) : (
        <div className={styles.insightList}>
          {insights.map((insight, i) => (
            <InsightCard key={i} insight={insight} index={i} />
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function InsightCard({ insight, index }) {
  const s = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info;
  return (
    <div
      className={styles.insightCard}
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        animationDelay: `${index * 0.07}s`,
      }}
    >
      <div className={styles.insightCardInner}>
        <div className={styles.insightIconBox} style={{ border: `1px solid ${s.border}` }}>
          {insight.icon}
        </div>
        <div className={styles.insightBody}>
          <div className={styles.insightBadgeRow}>
            <span className={styles.insightBadge} style={{ background: s.color }}>
              {s.label}
            </span>
          </div>
          <div className={styles.insightTitle}>
            {insight.title}
          </div>
          {insight.body && (
            <div className={styles.insightDesc}>
              {insight.body}
            </div>
          )}
          <div className={styles.insightActions}>
            <div className={styles.insightSuggestion} style={{ color: s.color }}>
              💡 {insight.suggestion}
            </div>
            {insight.action_url && insight.action_url !== "#" && (
              <a
                href={insight.action_url}
                className={styles.insightActionLink}
                style={{ background: s.color }}
              >
                {insight.action_label || "Open"} →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// APPROVAL CENTER EMBED — compact wrapper for /admin/approvals/pending
// =====================================================================

const APPROVAL_BUCKETS = [
  { key: "leaves",            label: "Leaves",        icon: "🌴", color: "info" },
  { key: "permissions",       label: "Permissions",   icon: "⏱",  color: "warn" },
  { key: "quotations",        label: "Quotations",    icon: "📋", color: "ok" },
  { key: "purchase_orders",   label: "POs (draft)",   icon: "📦", color: "info" },
  { key: "supplier_payments", label: "Supplier Pay",  icon: "💳", color: "primary" },
  { key: "discount_requests", label: "Discounts",     icon: "🏷️", color: "purple" },
];

function ApprovalEmbed({ approvals }) {

  const total = approvals?.total_pending ?? 0;
  const buckets = approvals?.buckets || {};

  return (
    <PanelCard
      eyebrow="Approval Command Center"
      title={`${total} waiting on you`}
      icon="✅"
      right={(
        <a href="/approvals" className={styles.approvalOpenBtn}>
          Open ↗
        </a>
      )}
    >
      {total === 0 ? (
        <div className={styles.approvalEmpty}>
          <div className={styles.approvalEmptyIcon}>✨</div>
          <div className={styles.approvalEmptyTitle}>All caught up</div>
          <div className={styles.approvalEmptyBody}>Nothing waiting on your sign-off right now.</div>
        </div>
      ) : (
        <div className={styles.approvalList}>
          {APPROVAL_BUCKETS.map((b) => {
            const count = (buckets[b.key] || []).length;
            if (count === 0) return null;
            return (
              <a
                key={b.key}
                href="/approvals"
                className={styles.approvalRow}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = toneRGB(b.color, 0.50);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "";
                }}
              >
                <div className={styles.approvalRowLeft}>
                  <span
                    className={styles.approvalIconSpan}
                    style={{
                      background: toneRGB(b.color, 0.14),
                      border: `1px solid ${toneRGB(b.color, 0.30)}`,
                    }}
                  >
                    {b.icon}
                  </span>
                  {b.label}
                </div>
                <div className={styles.approvalRowCount} style={{ color: toneRGB(b.color, 1) }}>
                  {count}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}


// =====================================================================
// ACTIVITY TIMELINE — live cross-module feed
// =====================================================================

function formatRelative(ts) {
  if (!ts) return "";
  const t = new Date(ts).getTime();
  const now = Date.now();
  const diff = (now - t) / 1000; // seconds
  if (diff < 60)        return `${Math.max(1, Math.floor(diff))}s ago`;
  if (diff < 3600)      return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff/3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff/86400)}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function ActivityTimeline({ items }) {

  return (
    <PanelCard
      eyebrow="Activity Timeline"
      title="Today across BVC24"
      icon="📡"
      right={(
        <div className={styles.activityCountLabel}>
          {items.length} events
        </div>
      )}
    >
      {items.length === 0 ? (
        <div className={styles.activityEmptyMsg}>
          No activity yet — events will appear here as they happen.
        </div>
      ) : (
        <div className={styles.timelineGrid}>
          {items.slice(0, 14).map((item, i) => (
            <TimelineRow key={`${item.kind}-${item.ts}-${i}`} item={item} index={i} />
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function TimelineRow({ item, index }) {
  const color = item.color || "info";
  return (
    <a
      href={item.href || "#"}
      className={styles.timelineRow}
      style={{ animationDelay: `${index * 0.03}s` }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = toneRGB(color, 0.45);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "";
      }}
    >
      <div
        className={styles.timelineIconBox}
        style={{
          background: toneRGB(color, 0.16),
          border: `1px solid ${toneRGB(color, 0.30)}`,
        }}
      >
        {item.icon}
      </div>
      <div className={styles.timelineRowBody}>
        <div className={styles.timelineText}>
          {item.text}
        </div>
        <div className={styles.timelineMeta}>
          {item.subtext && (
            <span className={styles.timelineSubtext}>{item.subtext}</span>
          )}
          <span className={styles.timelineTs}>
            {formatRelative(item.ts)}
          </span>
        </div>
      </div>
    </a>
  );
}


// =====================================================================
// HEALTH SCORE PANEL — Circular SVG + 5 sub-bars + recommended actions
// =====================================================================

function HealthScorePanel({ data }) {

  const overall = data?.overall ?? 0;
  const animated = useCountUp(overall, 1500);

  const label = data?.label || "Loading…";
  const scores = data?.scores || {};
  const actions = data?.actions || [];

  // Score → tone
  const scoreColor = (v) => {
    if (v >= 85) return "var(--c-accent-ok)";
    if (v >= 65) return "var(--c-accent-info)";
    if (v >= 45) return "var(--c-accent-warn)";
    return "var(--c-primary-2)";
  };

  // Circular progress geometry
  const R = 76, STROKE = 14;
  const C = 2 * Math.PI * R;
  const offset = C - (overall / 100) * C;

  const subBars = [
    { key: "sales",      label: "Sales",      icon: "💰" },
    { key: "production", label: "Production", icon: "🏭" },
    { key: "inventory",  label: "Inventory",  icon: "📦" },
    { key: "hr",         label: "HR",         icon: "👥" },
    { key: "finance",    label: "Finance",    icon: "💳" },
  ];

  return (
    <PanelCard
      eyebrow="AI Business Health"
      title="Overall Score"
      icon="🧠"
    >
      <div className={styles.healthGrid}>
        {/* Circular score */}
        <div className={styles.healthCircleWrap}>
          <svg width="192" height="192" viewBox="0 0 192 192">
            <circle
              cx="96" cy="96" r={R}
              fill="none"
              stroke="var(--c-surface-2)"
              strokeWidth={STROKE}
            />
            <circle
              cx="96" cy="96" r={R}
              fill="none"
              stroke={scoreColor(overall)}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={offset}
              transform="rotate(-90 96 96)"
              style={{
                transition: "stroke-dashoffset 1.5s var(--ease-out), stroke 0.6s var(--ease-out)",
                filter: `drop-shadow(0 0 12px ${scoreColor(overall)}88)`,
              }}
            />
          </svg>
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--c-text)",
          }}>
            <div style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 2,
              color: "var(--c-text-muted)",
              textTransform: "uppercase",
            }}>
              Score
            </div>
            <div style={{
              fontSize: 48,
              fontWeight: 900,
              fontFamily: "var(--font-mono)",
              color: scoreColor(overall),
              lineHeight: 1,
            }}>
              {Math.round(animated)}
            </div>
            <div style={{
              fontSize: 11,
              color: "var(--c-text-muted)",
              fontWeight: 700,
              marginTop: 2,
            }}>
              / 100
            </div>
          </div>
        </div>

        {/* 5 sub-bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 800,
            color: scoreColor(overall),
          }}>
            {label}
          </div>
          {subBars.map((s) => {
            const v = scores[s.key]?.value ?? 0;
            return (
              <div key={s.key}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--c-text-muted)",
                  marginBottom: 3,
                }}>
                  <span>{s.icon} {s.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: scoreColor(v) }}>
                    {v}
                  </span>
                </div>
                <div style={{
                  height: 6,
                  borderRadius: 999,
                  background: "var(--c-surface-2)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${v}%`,
                    background: scoreColor(v),
                    borderRadius: 999,
                    transition: "width 1.4s var(--ease-out), background 0.6s var(--ease-out)",
                    boxShadow: `0 0 10px ${scoreColor(v)}66`,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recommended actions */}
      {actions.length > 0 && (
        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px dashed var(--c-border)",
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.5,
            color: "var(--c-text-muted)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}>
            🤖 AI Suggested Focus
          </div>
          {actions.map((a, i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              background: "var(--c-surface-2)",
              borderRadius: 10,
              marginBottom: i < actions.length - 1 ? 6 : 0,
              border: `1px solid var(--c-border)`,
            }}>
              <div style={{
                fontSize: 16,
                fontWeight: 900,
                fontFamily: "var(--font-mono)",
                color: scoreColor(a.score),
                minWidth: 36,
                textAlign: "center",
              }}>
                {a.score}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 800, color: "var(--c-text)",
                }}>
                  {a.area}
                </div>
                <div style={{
                  fontSize: 11, color: "var(--c-text-muted)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {a.note}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}


// =====================================================================
// FACTORY CONTROL PANEL — gauges + machine status + WO breakdown
// =====================================================================

function FactoryControlPanel({ data }) {

  const machines = data?.machines || {};
  const wo       = data?.work_orders || {};
  const projects = data?.projects || {};
  const efficiency = data?.efficiency_pct ?? 0;

  const animEff = useCountUp(efficiency, 1200);

  const effColor = efficiency >= 75
    ? "var(--c-accent-ok)"
    : efficiency >= 50
    ? "var(--c-accent-warn)"
    : "var(--c-primary-2)";

  // SVG gauge geometry — 180° arc
  const GR = 70, GS = 14;
  const startA = Math.PI;
  const endA = 0;
  const polar = (r, a) => [96 + r * Math.cos(a), 96 + r * Math.sin(a)];
  const [sx, sy] = polar(GR, startA);
  const [ex, ey] = polar(GR, endA);
  const bgPath = `M${sx},${sy} A${GR},${GR} 0 0,1 ${ex},${ey}`;
  const fillAngle = startA + (endA - startA) * (efficiency / 100);
  const [fx, fy] = polar(GR, fillAngle);
  const fillPath = `M${sx},${sy} A${GR},${GR} 0 0,1 ${fx},${fy}`;

  return (
    <PanelCard
      eyebrow="Live Factory Control"
      title="Shop Floor Status"
      icon="🏭"
    >
      <div style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 24,
        alignItems: "center",
      }}>
        {/* Efficiency gauge */}
        <div style={{ position: "relative", width: 192, height: 130 }}>
          <svg width="192" height="130" viewBox="0 0 192 130">
            <path d={bgPath} stroke="var(--c-surface-2)" strokeWidth={GS}
                  fill="none" strokeLinecap="round" />
            <path d={fillPath} stroke={effColor} strokeWidth={GS}
                  fill="none" strokeLinecap="round"
                  style={{
                    transition: "all 1.2s var(--ease-out)",
                    filter: `drop-shadow(0 0 12px ${effColor}aa)`,
                  }} />
          </svg>
          <div style={{
            position: "absolute",
            top: 24,
            left: 0,
            right: 0,
            textAlign: "center",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 1.6,
              color: "var(--c-text-muted)", textTransform: "uppercase",
            }}>
              Efficiency
            </div>
            <div style={{
              fontSize: 36, fontWeight: 900,
              fontFamily: "var(--font-mono)",
              color: effColor,
              lineHeight: 1, marginTop: 4,
            }}>
              {Math.round(animEff)}<span style={{ fontSize: 18 }}>%</span>
            </div>
          </div>
        </div>

        {/* Machine + project tiles */}
        <div style={{ display: "grid", gap: 8 }}>
          <MachineRow icon="🟢" label="Work Orders running" value={machines.running || 0} tone="ok" />
          <MachineRow icon="🟡" label="Work Orders idle"    value={machines.idle || 0}    tone="warn" />
          <MachineRow icon="🔴" label="Work Orders on hold" value={machines.maintenance || 0} tone="primary" />
          <div style={{ height: 1, background: "var(--c-border)", margin: "4px 0" }} />
          <MachineRow icon="🏗️" label="Projects active"     value={projects.active || 0}     tone="info" />
          <MachineRow icon="⚠️" label="Projects delayed"    value={projects.delayed || 0}    tone={projects.delayed ? "primary" : "ok"} />
          <MachineRow icon="✅" label="Projects completed"  value={projects.completed || 0}  tone="ok" />
        </div>
      </div>
    </PanelCard>
  );
}

function MachineRow({ icon, label, value, tone }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 12px",
      background: "var(--c-surface-2)",
      border: "1px solid var(--c-border)",
      borderRadius: 10,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        fontSize: 12, fontWeight: 700, color: "var(--c-text)",
      }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        {label}
      </div>
      <div style={{
        fontSize: 18, fontWeight: 900,
        fontFamily: "var(--font-mono)",
        color: toneRGB(tone, 1),
      }}>
        {value}
      </div>
    </div>
  );
}


// =====================================================================
// PRODUCTION FLOW PANEL — animated pipeline w/ counts + conversion %
// =====================================================================

function ProductionFlowPanel({ data }) {

  const stages = data?.stages || [];
  const totalInPipeline = data?.total_in_pipeline || 0;
  const completedTotal = data?.completed_total || 0;

  return (
    <PanelCard
      eyebrow="Live Production Flow"
      title="Pipeline · Quotation → Completed"
      icon="🔄"
      right={(
        <div style={{
          display: "flex", gap: 14, alignItems: "center",
          fontSize: 11, color: "var(--c-text-muted)",
        }}>
          <div>
            <span style={{ color: "var(--c-text)", fontWeight: 800,
                           fontFamily: "var(--font-mono)" }}>
              {totalInPipeline}
            </span> in pipeline
          </div>
          <div>
            <span style={{ color: "var(--c-accent-ok)", fontWeight: 800,
                           fontFamily: "var(--font-mono)" }}>
              {completedTotal}
            </span> completed
          </div>
        </div>
      )}
    >
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
        gap: 0,
        position: "relative",
        marginTop: 10,
      }}>
        {stages.map((s, i) => {
          const isLast = i === stages.length - 1;
          const isCompleted = i === stages.length - 1;
          return (
            <div key={s.label} style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "10px 6px 4px",
            }}>
              {/* Connecting line to next stage */}
              {!isLast && (
                <div style={{
                  position: "absolute",
                  top: 30, left: "50%", right: "-50%",
                  height: 2,
                  background: "var(--c-primary)",
                  zIndex: 0,
                  opacity: 0.55,
                }} />
              )}

              {/* Stage node */}
              <div style={{
                position: "relative",
                zIndex: 2,
                width: 60, height: 60,
                borderRadius: "50%",
                background: isCompleted
                  ? "#10B981"
                  : "var(--c-surface)",
                border: `2px solid ${
                  isCompleted ? "transparent" : "var(--c-primary-2)"
                }`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isCompleted
                  ? "0 0 24px rgba(16,185,129,0.45)"
                  : "0 4px 12px rgba(217,4,41,0.18)",
              }}>
                <div style={{ fontSize: 20, lineHeight: 1 }}>{s.icon}</div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 900,
                  fontFamily: "var(--font-mono)",
                  color: isCompleted ? "white" : "var(--c-primary-2)",
                  marginTop: -2,
                }}>
                  {s.count}
                </div>
              </div>

              {/* Stage label */}
              <div style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.6,
                color: "var(--c-text)",
                marginTop: 10,
                textTransform: "uppercase",
                textAlign: "center",
              }}>
                {s.label}
              </div>

              {/* Conversion % to next */}
              {!isLast && s.conversion_pct != null && (
                <div style={{
                  position: "absolute",
                  top: 12, left: "75%",
                  zIndex: 3,
                  padding: "2px 6px",
                  borderRadius: 999,
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-border)",
                  fontSize: 9,
                  fontWeight: 800,
                  fontFamily: "var(--font-mono)",
                  color: s.conversion_pct >= 70
                    ? "var(--c-accent-ok)"
                    : s.conversion_pct >= 40
                    ? "var(--c-accent-warn)"
                    : "var(--c-primary-2)",
                  whiteSpace: "nowrap",
                }}>
                  {s.conversion_pct}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}


// =====================================================================
// Shared PanelCard — used by Health / Factory / Flow / future panels
// =====================================================================

function PanelCard({ eyebrow, title, icon, right, children }) {
  return (
    <div style={{
      position: "relative",
      background: "var(--c-surface)",
      border: "1px solid var(--c-border)",
      borderRadius: "var(--r-lg)",
      padding: "20px 22px",
      boxShadow: "var(--shadow-1)",
      overflow: "hidden",
    }}>
      {/* Top accent line */}
      <div style={{
        position: "absolute",
        top: 0, left: 0, right: 0,
        height: 2,
        background: "var(--c-primary)",
        opacity: 0.55,
      }} />

      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {icon && (
            <div style={{
              width: 36, height: 36,
              borderRadius: 10,
              background: "var(--c-primary)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16,
              color: "white",
              boxShadow: "0 6px 16px rgba(217,4,41,0.25)",
            }}>
              {icon}
            </div>
          )}
          <div>
            <div style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1.6,
              color: "var(--c-text-muted)",
              textTransform: "uppercase",
            }}>
              {eyebrow}
            </div>
            <div style={{
              fontSize: 16,
              fontWeight: 900,
              color: "var(--c-text)",
              marginTop: 1,
            }}>
              {title}
            </div>
          </div>
        </div>
        {right}
      </div>

      {children}
    </div>
  );
}


// =====================================================================
// AI VOICE ASSISTANT FAB (Phase 5)
// =====================================================================

const AI_EXAMPLE_CHIPS = [
  "Show pending quotations",
  "Which project is delayed?",
  "How much inventory is low stock?",
  "Who is absent today?",
  "Monthly revenue",
  "Production status",
];

function AIAssistantFAB({ openSignal }) {

  const [open, setOpen]               = useState(false);
  const [input, setInput]             = useState("");
  const [busy, setBusy]               = useState(false);
  const [listening, setListening]     = useState(false);
  const [messages, setMessages]       = useState([
    {
      role: "assistant",
      text:
        "Hi — I'm the BVC24 AI assistant. Ask me anything about live data: " +
        "pending quotations, delayed projects, who's absent, monthly revenue, " +
        "production status, and more.",
      time: new Date(),
    },
  ]);
  const scrollRef = useRef(null);
  const recogRef  = useRef(null);
  const inputRef  = useRef(null);

  // Open the panel when a global shortcut fires (Cmd/Ctrl+K)
  useEffect(() => {
    if (openSignal > 0) {
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [openSignal]);

  // ESC closes the panel
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  // Auto-scroll to latest
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const ask = async (query) => {
    const q = (query || input || "").trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q, time: new Date() }]);
    setInput("");
    setBusy(true);
    try {
      const r = await API.post("/admin/ai/ask", { query: q });
      const d = r.data || {};
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: d.answer || "(no answer)",
          data: d.data,
          intent: d.intent,
          via: d.matched_via,
          suggestions: d.suggestions || [],
          time: new Date(),
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: e?.response?.data?.detail || "Sorry, that query failed.",
          time: new Date(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // ---- Voice input via Web Speech API --------------------------------
  const speechSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }, []);

  const startListening = () => {
    if (!speechSupported || listening) return;
    const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Recog();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-IN";
    rec.maxAlternatives = 1;
    recogRef.current = rec;

    let finalTranscript = "";

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalTranscript += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput(finalTranscript || interim);
    };

    rec.onend = () => {
      setListening(false);
      const text = (finalTranscript || "").trim();
      if (text) {
        setInput(text);
        // Auto-send after a short delay
        setTimeout(() => ask(text), 250);
      }
    };

    rec.onerror = () => setListening(false);

    setListening(true);
    rec.start();
  };

  const stopListening = () => {
    try { recogRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  };

  const onSubmit = (e) => {
    e?.preventDefault?.();
    ask(input);
  };

  return (
    <>
      {/* FAB button (always rendered) */}
      <button
        onClick={() => setOpen((x) => !x)}
        title="AI Assistant — Ctrl+K"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 58, height: 58,
          borderRadius: "50%",
          border: "none",
          background: open
            ? "#1F2937"
            : "var(--c-primary)",
          color: "white",
          fontSize: 26,
          cursor: "pointer",
          zIndex: 9998,
          animation: open ? "none" : "bvc-fab-ring 2.4s ease-in-out infinite",
        }}
      >
        {open ? "✕" : "🤖"}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed",
          bottom: 96,
          right: 24,
          width: 400,
          maxWidth: "calc(100vw - 48px)",
          maxHeight: "calc(100vh - 140px)",
          background: "var(--c-surface)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--r-xl)",
          boxShadow: "var(--shadow-3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 9997,
          animation: "bvc-panel-up 0.28s var(--ease-out)",
        }}>

          {/* Header */}
          <div style={{
            position: "relative",
            overflow: "hidden",
            background: "#991b1b",
            color: "white",
            padding: "14px 18px",
          }}>
            <div style={{
              position: "absolute", inset: 0,
              background: "transparent",
              backgroundSize: "200% 100%",
              animation: "bvc-light-sweep 7s ease-in-out infinite",
              pointerEvents: "none",
            }} />
            <div style={{
              position: "relative", zIndex: 2,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: `radial-gradient(circle at 30% 30%, var(--c-accent-warn), #B7791F)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20,
                boxShadow: "0 0 18px rgba(244,179,36,0.50)",
              }}>
                🤖
              </div>
              <div>
                <div style={{
                  fontSize: 10, letterSpacing: 1.5, fontWeight: 800,
                  color: "var(--c-accent-warn)", textTransform: "uppercase",
                }}>
                  BVC24 AI Assistant
                </div>
                <div style={{ fontSize: 14, fontWeight: 900, marginTop: 1 }}>
                  Ask anything about live data
                </div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 16,
              background: "var(--c-bg)",
              minHeight: 200,
            }}
          >
            {messages.map((m, i) => (
              <FabBubble
                key={i}
                role={m.role}
                text={m.text}
                data={m.data}
                suggestions={m.suggestions}
                via={m.via}
                time={m.time}
                onSuggestion={ask}
              />
            ))}
            {busy && (
              <div style={{
                display: "flex", gap: 6, padding: "6px 12px",
                color: "var(--c-text-muted)",
              }}>
                {[0, 1, 2].map((d) => (
                  <span key={d} style={{
                    display: "inline-block",
                    width: 8, height: 8, borderRadius: "50%",
                    background: "var(--c-primary-2)",
                    animation: `bvc-typing 1.2s infinite ${d * 0.2}s`,
                  }} />
                ))}
              </div>
            )}

            {/* Example chips when conversation is fresh */}
            {messages.length === 1 && !busy && (
              <div style={{
                marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6,
              }}>
                {AI_EXAMPLE_CHIPS.map((q) => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    style={{
                      fontSize: 11, fontWeight: 700,
                      padding: "6px 12px",
                      background: "var(--c-surface-2)",
                      color: "var(--c-text)",
                      border: "1px solid var(--c-border)",
                      borderRadius: 999,
                      cursor: "pointer",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={onSubmit}
            style={{
              padding: 12,
              borderTop: "1px solid var(--c-border)",
              background: "var(--c-surface)",
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening…" : "Type or click 🎙 to speak…"}
              disabled={busy}
              style={{
                flex: 1,
                padding: "10px 14px",
                border: "1.5px solid var(--c-border)",
                borderRadius: 999,
                fontSize: 13,
                outline: "none",
                background: "var(--c-surface)",
                color: "var(--c-text)",
              }}
              onFocus={(e) => { e.target.style.borderColor = "var(--c-primary-2)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--c-border)"; }}
            />

            {speechSupported && (
              <button
                type="button"
                onClick={listening ? stopListening : startListening}
                title={listening ? "Stop listening" : "Speak"}
                style={{
                  width: 38, height: 38, borderRadius: "50%",
                  border: "none",
                  background: listening
                    ? "var(--c-primary)"
                    : "var(--c-surface-2)",
                  color: listening ? "white" : "var(--c-text-muted)",
                  fontSize: 16,
                  cursor: "pointer",
                  animation: listening ? "bvc-mic-pulse 1.2s ease-in-out infinite" : "none",
                  flexShrink: 0,
                }}
              >
                🎙
              </button>
            )}

            <button
              type="submit"
              disabled={busy || !input.trim()}
              style={{
                padding: "10px 16px",
                background: busy || !input.trim()
                  ? "var(--c-surface-3)"
                  : "var(--c-primary)",
                color: "white",
                border: "none",
                borderRadius: 999,
                fontWeight: 800,
                fontSize: 12,
                cursor: busy || !input.trim() ? "not-allowed" : "pointer",
                boxShadow: busy || !input.trim() ? "none" : "0 4px 12px rgba(217,4,41,0.30)",
                flexShrink: 0,
              }}
            >
              {busy ? "…" : "Ask"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function FabBubble({ role, text, data, suggestions, via, time, onSuggestion }) {
  const isUser = role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 8,
      animation: "bvc-msg-in 0.25s var(--ease-out)",
    }}>
      <div style={{
        maxWidth: "82%",
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 4,
      }}>
        <div style={{
          padding: "8px 12px",
          background: isUser
            ? "var(--c-primary)"
            : "var(--c-surface)",
          color: isUser ? "white" : "var(--c-text)",
          borderRadius: isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
          fontSize: 12.5,
          lineHeight: 1.45,
          border: isUser ? "none" : "1px solid var(--c-border)",
          whiteSpace: "pre-wrap",
        }}>
          {renderInlineBold(text)}
        </div>

        {data?.kind === "table" && data.rows?.length > 0 && (
          <div style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: 8,
            maxWidth: "100%",
            overflow: "hidden",
          }}>
            {data.rows.slice(0, 6).map((r, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                padding: "5px 10px",
                borderBottom: i < Math.min(5, data.rows.length - 1)
                  ? "1px solid var(--c-border)"
                  : "none",
                fontSize: 11,
              }}>
                <span style={{
                  color: "var(--c-text)", fontWeight: 700,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: 200,
                }}>
                  {r.label}
                </span>
                <span style={{
                  color: "var(--c-primary-2)",
                  fontWeight: 800, fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                }}>
                  {r.value}
                </span>
              </div>
            ))}
            {data.rows.length > 6 && (
              <div style={{
                padding: "4px 10px",
                fontSize: 10, color: "var(--c-text-muted)",
                fontStyle: "italic", textAlign: "center",
              }}>
                +{data.rows.length - 6} more
              </div>
            )}
          </div>
        )}

        {data?.kind === "number" && (
          <div style={{
            padding: "8px 12px",
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: 8,
          }}>
            <div style={{
              fontSize: 18, fontWeight: 900,
              color: "var(--c-primary-2)", fontFamily: "var(--font-mono)",
            }}>
              {data.value}
            </div>
            {data.subtitle && (
              <div style={{ fontSize: 10, color: "var(--c-text-muted)", marginTop: 1 }}>
                {data.subtitle}
              </div>
            )}
          </div>
        )}

        {suggestions && suggestions.length > 0 && !isUser && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {suggestions.slice(0, 3).map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                style={{
                  fontSize: 10, fontWeight: 700,
                  padding: "3px 9px",
                  background: "var(--c-surface-2)",
                  color: "var(--c-text-muted)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                ↪ {s}
              </button>
            ))}
          </div>
        )}

        <div style={{
          fontSize: 9, color: "var(--c-text-subtle)",
          fontFamily: "var(--font-mono)",
        }}>
          {time?.toLocaleTimeString?.([], { hour: "2-digit", minute: "2-digit" })}
          {via && (
            <span style={{
              marginLeft: 6,
              padding: "0 5px", borderRadius: 999,
              background: via === "gemini" ? "rgba(244,179,36,0.18)" : "rgba(59,130,246,0.18)",
              color: via === "gemini" ? "var(--c-accent-warn)" : "var(--c-accent-info)",
              fontWeight: 700,
            }}>
              {via}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function renderInlineBold(text) {
  if (!text) return text;
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}


// =====================================================================
// QUICK ACTIONS FAB (Phase 5)
// =====================================================================

const QUICK_ACTIONS = [
  { icon: "👥", label: "Customer",       href: "/customers",       tone: "purple" },
  { icon: "📋", label: "Quotation",      href: "/quotations",      tone: "info"   },
  { icon: "🛒", label: "Sales Order",    href: "/sales-orders",    tone: "ok"     },
  { icon: "🏗️", label: "Project",        href: "/projects",        tone: "warn"   },
  { icon: "📦", label: "Purchase Order", href: "/purchase-orders", tone: "info"   },
  { icon: "👤", label: "Employee",       href: "/employees",       tone: "purple" },
  { icon: "💰", label: "Payroll",        href: "/payroll",         tone: "ok"     },
];

function QuickActionsFAB({ onLaunchAI }) {

  const [open, setOpen] = useState(false);

  // Click outside closes
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{
      position: "fixed",
      bottom: 24,
      left: 24,
      zIndex: 9998,
    }}>
      {/* Action menu */}
      {open && (
        <div style={{
          position: "absolute",
          bottom: 70,
          left: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          background: "var(--c-surface)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-3)",
          minWidth: 220,
          animation: "bvc-panel-up 0.22s var(--ease-out)",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
            color: "var(--c-text-muted)", textTransform: "uppercase",
            paddingBottom: 6,
            borderBottom: "1px dashed var(--c-border)",
          }}>
            ⚡ Quick Actions
          </div>

          {QUICK_ACTIONS.map((a, i) => (
            <a
              key={a.label}
              href={a.href}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 10,
                textDecoration: "none",
                color: "var(--c-text)",
                animation: `bvc-quickaction-pop 0.22s var(--ease-out) ${i * 0.04}s both`,
                transition: "all 0.15s var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--c-surface-2)";
                e.currentTarget.style.borderColor = toneRGB(a.tone, 0.30);
                e.currentTarget.style.transform = "translateX(2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.transform = "translateX(0)";
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: toneRGB(a.tone, 0.14),
                border: `1px solid ${toneRGB(a.tone, 0.30)}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, flexShrink: 0,
              }}>
                {a.icon}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                + {a.label}
              </span>
            </a>
          ))}

          {/* Launch AI */}
          <div style={{ height: 1, background: "var(--c-border)", margin: "2px 0" }} />
          <button
            onClick={() => { setOpen(false); onLaunchAI?.(); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px",
              background: "rgba(244,179,36,0.08)",
              border: `1px solid ${toneRGB("warn", 0.40)}`,
              borderRadius: 10,
              cursor: "pointer",
              color: "var(--c-text)",
              animation: `bvc-quickaction-pop 0.22s var(--ease-out) ${QUICK_ACTIONS.length * 0.04}s both`,
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `radial-gradient(circle at 30% 30%, var(--c-accent-warn), #B7791F)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, color: "white", flexShrink: 0,
              boxShadow: "0 0 12px rgba(244,179,36,0.40)",
            }}>
              🤖
            </div>
            <span style={{
              fontSize: 12, fontWeight: 800, color: "var(--c-accent-warn)",
            }}>
              Launch AI Assistant
            </span>
          </button>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen((x) => !x)}
        title="Quick Actions"
        style={{
          width: 58, height: 58,
          borderRadius: "50%",
          border: "none",
          background: open
            ? "#1F2937"
            : "var(--c-accent-info)",
          color: "white",
          fontSize: 22,
          cursor: "pointer",
          boxShadow: "0 12px 32px rgba(59,130,246,0.40)",
          transition: "transform 0.2s var(--ease-out)",
          transform: open ? "rotate(45deg)" : "rotate(0deg)",
        }}
      >
        {open ? "✕" : "⚡"}
      </button>
    </div>
  );
}


// =====================================================================
// EXPORT — outer ThemeProvider + global Cmd/Ctrl+K shortcut
// =====================================================================

export default function AdminDashboardV2() {

  // Signal for opening the AI FAB from anywhere (Cmd+K or Quick Actions menu)
  const [aiOpenSignal, setAiOpenSignal] = useState(0);
  const launchAI = useCallback(() => setAiOpenSignal((n) => n + 1), []);

  // Global Cmd/Ctrl + K → open AI assistant
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        launchAI();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [launchAI]);

  return (
    <ThemeProvider>
      <AdminDashboardV2Inner />
      <AIAssistantFAB openSignal={aiOpenSignal} />
      <QuickActionsFAB onLaunchAI={launchAI} />
    </ThemeProvider>
  );
}
