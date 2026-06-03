import { useEffect, useMemo, useState } from "react";

import { Link } from "react-router-dom";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend
} from "recharts";

import API from "../services/api";

import { formatISTTime } from "../utils/time";


// =================================================================
// BVC24 Modern Dashboard
//
// Animated hero, gradient KPI cards with count-up, live activity
// feed, production + quality pulse, and a recharts area + donut
// pair. Auto-refreshes every 10 seconds. Single-file component —
// no external CSS dependency.
// =================================================================


// ---- Animations injected once -----------------------------------

const GLOBAL_KEYFRAMES = `
@keyframes bvcFadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes bvcPulse {
  0%   { box-shadow: 0 0 0 0 rgba(99,102,241,0.45); }
  70%  { box-shadow: 0 0 0 14px rgba(99,102,241,0); }
  100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
}
@keyframes bvcShimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
@keyframes bvcGradientShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes bvcRipple {
  0%   { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; }
}
@keyframes bvcSpinSlow {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.bvc-card {
  animation: bvcFadeUp 0.5s ease-out both;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.bvc-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 40px rgba(15,23,42,0.18);
}
.bvc-live-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #10b981; display: inline-block;
  animation: bvcPulse 1.6s ease-out infinite;
  margin-right: 6px; vertical-align: middle;
}
.bvc-skeleton {
  background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%);
  background-size: 800px 100%;
  animation: bvcShimmer 1.4s linear infinite;
  border-radius: 6px;
}
`;


// ---- Color palettes ---------------------------------------------

const KPI_PALETTES = [
  {
    grad: "linear-gradient(135deg, #C8102E 0%, #E63946 50%, #F4B324 100%)",
    ring: "rgba(99,102,241,0.35)"
  },
  {
    grad: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
    ring: "rgba(14,165,233,0.35)"
  },
  {
    grad: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    ring: "rgba(16,185,129,0.35)"
  },
  {
    grad: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
    ring: "rgba(245,158,11,0.35)"
  },
  {
    grad: "linear-gradient(135deg, #ec4899 0%, #be185d 100%)",
    ring: "rgba(236,72,153,0.35)"
  },
  {
    grad: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
    ring: "rgba(99,102,241,0.35)"
  }
];

const DONUT_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"
];


// ---- Count-up hook (smooth number transition) -------------------

function useCountUp(target, durationMs = 700) {

  const [value, setValue] = useState(0);

  useEffect(() => {

    if (target == null) return;

    const from = value;

    const to = Number(target) || 0;

    if (from === to) return;

    const start = performance.now();

    let raf;

    const step = (now) => {

      const t = Math.min(1, (now - start) / durationMs);

      const eased = 1 - Math.pow(1 - t, 3);   // easeOutCubic

      setValue(Math.round(from + (to - from) * eased));

      if (t < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);

  }, [target, durationMs]);

  return value;
}


// ---- Hero header ------------------------------------------------

function greetingFor(hour) {

  if (hour < 12) return "Good morning";

  if (hour < 17) return "Good afternoon";

  return "Good evening";
}


function Hero({ summary }) {

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {

    const id = setInterval(() => setNow(new Date()), 1000);

    return () => clearInterval(id);

  }, []);

  const greeting = greetingFor(now.getHours());

  const time = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

  const date = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  const username = (
    localStorage.getItem("username")
    || "Administrator"
  );

  return (

    <div
      style={{
        position: "relative",
        borderRadius: 20,
        padding: "28px 32px",
        marginBottom: 24,
        color: "white",
        overflow: "hidden",
        background:
          "linear-gradient(120deg, #1A0508 0%, #4A0E18 35%, #8B0B1F 65%, #C8102E 100%)",
        backgroundSize: "300% 300%",
        animation: "bvcGradientShift 18s ease-in-out infinite",
        boxShadow: "0 24px 60px rgba(76,29,149,0.45)"
      }}
    >

      {/* Decorative orbs */}
      <div
        style={{
          position: "absolute",
          width: 260,
          height: 260,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          top: -100,
          right: -60,
          pointerEvents: "none",
          filter: "blur(0.5px)"
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 140,
          height: 140,
          borderRadius: "50%",
          background: "rgba(236,72,153,0.18)",
          bottom: -50,
          left: 200,
          pointerEvents: "none"
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap"
        }}
      >

        <div style={{ flex: 1, minWidth: 280 }}>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              opacity: 0.85,
              marginBottom: 8
            }}
          >
            BVC24 · AI Smart Manufacturing
          </div>

          <h1
            style={{
              fontSize: 32,
              fontWeight: 900,
              margin: 0,
              lineHeight: 1.15,
              letterSpacing: -0.5,
              color: "#ffffff",
              textShadow: "0 2px 12px rgba(0,0,0,0.25)"
            }}
          >
            Real-Time Analytics Powered ERP
          </h1>

          <div
            style={{
              fontSize: 16,
              opacity: 0.92,
              marginTop: 10,
              maxWidth: 600,
              fontWeight: 500,
              lineHeight: 1.5
            }}
          >
            Your AI command center for smart manufacturing —
            live intelligence from gate scan to dispatch.
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 16,
              flexWrap: "wrap"
            }}
          >

            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(16,185,129,0.18)",
                border: "1px solid rgba(16,185,129,0.35)",
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "#a7f3d0"
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#10b981",
                  display: "inline-block",
                  boxShadow: "0 0 8px #10b981"
                }}
              />
              All Systems Operational
            </span>

            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.92)"
              }}
            >
              🤖 AI Allocator Online
            </span>

            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.92)"
              }}
            >
              👆 Biometric Gate Active
            </span>
          </div>
        </div>

        {/* Clock card */}
        <div
          style={{
            background: "rgba(255,255,255,0.12)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.18)",
            padding: "16px 22px",
            borderRadius: 16,
            textAlign: "right",
            minWidth: 200
          }}
        >

          <div
            style={{
              fontSize: 34,
              fontWeight: 800,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: 0.5
            }}
          >
            {time}
          </div>

          <div
            style={{
              fontSize: 12,
              opacity: 0.85,
              marginTop: 2,
              letterSpacing: 0.8
            }}
          >
            {date}
          </div>

          <div
            style={{
              fontSize: 10,
              opacity: 0.7,
              marginTop: 6,
              letterSpacing: 1.4,
              textTransform: "uppercase"
            }}
          >
            <span className="bvc-live-dot" />
            Live · Asia/Kolkata
          </div>
        </div>
      </div>
    </div>
  );
}


// ---- KPI card with gradient + count-up --------------------------

function KPI({ icon, label, value, sub, palette, delay }) {

  const animatedValue = useCountUp(value);

  return (

    <div
      className="bvc-card"
      style={{
        position: "relative",
        background: palette.grad,
        color: "white",
        padding: "22px 22px",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: `0 16px 36px ${palette.ring}`,
        animationDelay: `${delay}ms`
      }}
    >

      {/* Icon bubble */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "rgba(255,255,255,0.18)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22
        }}
      >
        {icon}
      </div>

      {/* Faded background ring */}
      <div
        style={{
          position: "absolute",
          width: 160,
          height: 160,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          bottom: -70,
          left: -70,
          pointerEvents: "none"
        }}
      />

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          opacity: 0.9
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 36,
          fontWeight: 800,
          letterSpacing: -1,
          marginTop: 4,
          lineHeight: 1.1
        }}
      >
        {value == null ? (
          <span className="bvc-skeleton" style={{ display: "inline-block", width: 90, height: 36 }} />
        ) : animatedValue}
      </div>

      {sub && (

        <div
          style={{
            fontSize: 12,
            opacity: 0.85,
            marginTop: 6
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}


// ---- Live activity feed -----------------------------------------

function ActivityFeed({ items, loading }) {

  return (

    <div
      className="bvc-card"
      style={{
        background: "white",
        borderRadius: 18,
        padding: "20px 22px",
        boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
        animationDelay: "300ms",
        height: "100%"
      }}
    >

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14
        }}
      >

        <div>

          <div
            style={{
              fontSize: 11,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              fontWeight: 700,
              color: "#64748b"
            }}
          >
            Live Activity
          </div>

          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#0f172a",
              marginTop: 2
            }}
          >
            Recent Biometric Scans
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: "#10b981",
            fontWeight: 600
          }}
        >
          <span className="bvc-live-dot" />
          live
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

        {loading && [1, 2, 3].map((i) => (
          <div
            key={i}
            className="bvc-skeleton"
            style={{ height: 48, borderRadius: 10 }}
          />
        ))}

        {!loading && items.length === 0 && (

          <div
            style={{
              color: "#94a3b8",
              padding: 20,
              textAlign: "center",
              fontSize: 13
            }}
          >
            No scans yet today.
          </div>
        )}

        {items.slice(0, 6).map((evt, idx) => {

          const ok = evt.RESULT === "SUCCESS";

          return (

            <div
              key={evt.ID}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: ok ? "#f0fdf4" : "#fef2f2",
                border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
                animation: `bvcFadeUp 0.4s ease-out both`,
                animationDelay: `${idx * 60}ms`
              }}
            >

              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: ok
                    ? "linear-gradient(135deg,#10b981,#059669)"
                    : "linear-gradient(135deg,#ef4444,#b91c1c)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  flexShrink: 0
                }}
              >
                {(evt.EMPLOYEE_NAME || "?").charAt(0).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#0f172a",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {evt.EMPLOYEE_NAME || `Unknown FP ${evt.FINGERPRINT_ID}`}
                </div>

                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {evt.EMPLOYEE_CODE || "—"}
                  {" · "}
                  {evt.DEVICE_ID}
                </div>
              </div>

              <div
                style={{
                  textAlign: "right",
                  fontSize: 11,
                  color: ok ? "#047857" : "#b91c1c",
                  fontWeight: 700
                }}
              >
                <div style={{ fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
                  {formatISTTime(evt.EVENT_TIME)}
                </div>
                <div style={{ marginTop: 2 }}>{evt.RESULT}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ---- Section card wrapper ---------------------------------------

function SectionCard({ title, subtitle, accent, children, delay = 0 }) {

  return (

    <div
      className="bvc-card"
      style={{
        background: "white",
        borderRadius: 18,
        padding: "20px 22px",
        boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
        animationDelay: `${delay}ms`,
        position: "relative",
        overflow: "hidden"
      }}
    >

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent
        }}
      />

      <div
        style={{
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          fontWeight: 700,
          color: "#64748b"
        }}
      >
        {subtitle}
      </div>

      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 2,
          marginBottom: 14
        }}
      >
        {title}
      </div>

      {children}
    </div>
  );
}


// ---- Department / project distribution donut --------------------

function DistributionDonut({ data, title }) {

  const total = data.reduce((s, d) => s + (d.value || 0), 0);

  return (

    <div style={{ height: 260, position: "relative" }}>

      <ResponsiveContainer>

        <PieChart>

          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={62}
            outerRadius={92}
            paddingAngle={3}
            stroke="none"
            isAnimationActive
            animationDuration={900}
          >
            {data.map((_, idx) => (
              <Cell key={idx} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
            ))}
          </Pie>

          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              fontSize: 12
            }}
          />

        </PieChart>
      </ResponsiveContainer>

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          pointerEvents: "none"
        }}
      >
        <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>
          {title}
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a" }}>
          {total}
        </div>
      </div>
    </div>
  );
}


// ---- Production pulse area chart --------------------------------

function ProductionPulse({ stats }) {

  const data = useMemo(() => {

    const counts = stats?.work_orders_by_status || {};

    return [
      { name: "Planned", value: counts.PLANNED || 0 },
      { name: "In Progress", value: counts.IN_PROGRESS || 0 },
      { name: "On Hold", value: counts.ON_HOLD || 0 },
      { name: "Done", value: counts.DONE || 0 }
    ];

  }, [stats]);

  return (

    <div style={{ height: 240 }}>

      <ResponsiveContainer>

        <AreaChart data={data}>

          <defs>
            <linearGradient id="bvcProdFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.08} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#f1f5f9" vertical={false} />

          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />

          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />

          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              fontSize: 12
            }}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke="#6366f1"
            strokeWidth={3}
            fill="url(#bvcProdFill)"
            isAnimationActive
            animationDuration={1000}
          />

        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}


// ---- Quick action grid ------------------------------------------

const QUICK_ACTIONS = [
  { to: "/biometric", icon: "👆", label: "Gate Kiosk", grad: "linear-gradient(135deg,#4A0E18,#1A0508)" },
  { to: "/production", icon: "🏭", label: "Production", grad: "linear-gradient(135deg,#C8102E,#8B0B1F)" },
  { to: "/quality", icon: "✅", label: "Quality", grad: "linear-gradient(135deg,#10b981,#059669)" },
  { to: "/suppliers", icon: "🏢", label: "Suppliers", grad: "linear-gradient(135deg,#F4B324,#C8102E)" },
  { to: "/leave-management", icon: "🌴", label: "Leave", grad: "linear-gradient(135deg,#C8102E,#8B0B1F)" },
  { to: "/md-review", icon: "📊", label: "MD Review", grad: "linear-gradient(135deg,#C8102E,#8B0B1F)" }
];


function QuickActions() {

  return (

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 10
      }}
    >

      {QUICK_ACTIONS.map((a, idx) => (

        <Link
          key={a.to}
          to={a.to}
          className="bvc-card"
          style={{
            background: a.grad,
            color: "white",
            padding: "16px 14px",
            borderRadius: 12,
            textDecoration: "none",
            textAlign: "center",
            animationDelay: `${idx * 70}ms`,
            boxShadow: "0 6px 18px rgba(15,23,42,0.12)"
          }}
        >

          <div style={{ fontSize: 22 }}>{a.icon}</div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              marginTop: 4
            }}
          >
            {a.label}
          </div>
        </Link>
      ))}
    </div>
  );
}


// =================================================================
// Main component
// =================================================================

function DashboardHome() {

  const [boardData, setBoardData] = useState(null);

  const [prodData, setProdData] = useState(null);

  const [qualityData, setQualityData] = useState(null);

  const [leaveData, setLeaveData] = useState(null);

  const [recent, setRecent] = useState([]);

  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {

    try {

      const [boardRes, prodRes, qualityRes, leaveRes, eventsRes] =
        await Promise.all([
          API.get("/attendance/live-board").catch(() => ({ data: null })),
          API.get("/production/dashboard?vendor_id=1").catch(() => ({ data: null })),
          API.get("/quality/dashboard?vendor_id=1").catch(() => ({ data: null })),
          API.get("/leave/dashboard?vendor_id=1").catch(() => ({ data: null })),
          API.get("/biometric/events?limit=8").catch(() => ({ data: [] }))
        ]);

      setBoardData(boardRes.data);

      setProdData(prodRes.data);

      setQualityData(qualityRes.data);

      setLeaveData(leaveRes.data);

      setRecent(eventsRes.data || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

    const id = setInterval(fetchAll, 10 * 1000);

    return () => clearInterval(id);

  }, []);

  // Build summary stats for hero subtitle
  const summary = useMemo(() => {

    const totalTasksDone = (boardData?.employees || []).reduce(
      (s, e) => s + (e.TASKS_COMPLETED_TODAY || 0),
      0
    );

    return {
      in_office: boardData?.summary?.in_office,
      tasks_completed_today: totalTasksDone,
      open_ncrs: qualityData?.open_ncrs ?? 0
    };

  }, [boardData, qualityData]);

  // Department distribution donut data
  const deptData = useMemo(() => {

    const grouped = {};

    (boardData?.employees || []).forEach((e) => {

      const k = e.DEPARTMENT || "Unassigned";

      grouped[k] = (grouped[k] || 0) + 1;
    });

    return Object.entries(grouped).map(([name, value]) => ({
      name,
      value
    }));

  }, [boardData]);

  // Production data shaped for area chart
  const prodChartData = useMemo(
    () => ({
      work_orders_by_status: prodData?.by_status || {}
    }),
    [prodData]
  );

  return (

    <div style={{ padding: 20, background: "#f1f5f9", minHeight: "100%" }}>

      <style>{GLOBAL_KEYFRAMES}</style>

      <Hero summary={summary} />

      {/* KPI ROW */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 22
        }}
      >

        <KPI
          icon="👥"
          label="In Office Now"
          value={boardData?.summary?.in_office}
          sub={`of ${boardData?.summary?.total_active ?? 0} active`}
          palette={KPI_PALETTES[0]}
          delay={50}
        />

        <KPI
          icon="✓"
          label="Tasks Done Today"
          value={summary.tasks_completed_today}
          sub="auto-counted by AI"
          palette={KPI_PALETTES[1]}
          delay={120}
        />

        <KPI
          icon="🏭"
          label="Units In Pipeline"
          value={prodData?.total_units_in_progress}
          sub={`${prodData?.total_work_orders ?? 0} work orders`}
          palette={KPI_PALETTES[2]}
          delay={190}
        />

        <KPI
          icon="🔍"
          label="QC Pass Rate"
          value={Math.round(qualityData?.pass_rate_pct ?? 0)}
          sub={`${qualityData?.open_ncrs ?? 0} open NCRs`}
          palette={KPI_PALETTES[3]}
          delay={260}
        />

        <KPI
          icon="🌴"
          label="On Leave Today"
          value={leaveData?.on_leave_today}
          sub={`${leaveData?.pending ?? 0} pending requests`}
          palette={KPI_PALETTES[4]}
          delay={330}
        />

        <KPI
          icon="📋"
          label="Checked Out"
          value={boardData?.summary?.checked_out}
          sub="done for the day"
          palette={KPI_PALETTES[5]}
          delay={400}
        />
      </div>

      {/* TWO COLUMN GRID */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 18,
          marginBottom: 22
        }}
      >

        <SectionCard
          subtitle="Production"
          title="Work Orders by Status"
          accent="linear-gradient(90deg,#C8102E,#F4B324)"
          delay={250}
        >
          <ProductionPulse stats={prodChartData} />
        </SectionCard>

        <ActivityFeed items={recent} loading={loading} />
      </div>

      {/* THREE COLUMN GRID */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 18,
          marginBottom: 22
        }}
      >

        <SectionCard
          subtitle="Workforce"
          title="Department Mix"
          accent="linear-gradient(90deg,#C8102E,#8B0B1F)"
          delay={400}
        >
          {deptData.length === 0 ? (
            <div style={{ color: "#94a3b8", padding: 30, textAlign: "center" }}>
              Run seed to populate.
            </div>
          ) : (
            <DistributionDonut data={deptData} title="People" />
          )}
        </SectionCard>

        <SectionCard
          subtitle="Quality"
          title="Inspections Today"
          accent="linear-gradient(90deg,#10b981,#059669)"
          delay={470}
        >

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10
            }}
          >

            {[
              ["PASS", qualityData?.by_status?.PASS ?? 0, "#10b981", "#f0fdf4"],
              ["FAIL", qualityData?.by_status?.FAIL ?? 0, "#ef4444", "#fef2f2"],
              ["PENDING", qualityData?.by_status?.PENDING ?? 0, "#f59e0b", "#fffbeb"],
              ["REWORK", qualityData?.by_status?.REWORK ?? 0, "#f97316", "#fff7ed"]
            ].map(([k, v, fg, bg]) => (

              <div
                key={k}
                style={{
                  background: bg,
                  borderRadius: 10,
                  padding: 14,
                  textAlign: "center"
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                    color: fg
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: "#0f172a",
                    marginTop: 4
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: "#f8fafc",
              borderRadius: 10,
              fontSize: 12,
              color: "#475569",
              textAlign: "center"
            }}
          >
            {qualityData?.critical_open_ncrs > 0 ? (
              <span style={{ color: "#b91c1c", fontWeight: 700 }}>
                ⚠ {qualityData.critical_open_ncrs} CRITICAL NCR(s) open
              </span>
            ) : (
              <span style={{ color: "#047857", fontWeight: 600 }}>
                ✓ No critical NCRs open
              </span>
            )}
          </div>
        </SectionCard>

        <SectionCard
          subtitle="Shortcuts"
          title="Quick Actions"
          accent="linear-gradient(90deg,#F4B324,#C8102E)"
          delay={540}
        >
          <QuickActions />
        </SectionCard>
      </div>

      {/* FOOTER */}
      <div
        style={{
          textAlign: "center",
          color: "#94a3b8",
          fontSize: 12,
          marginTop: 8
        }}
      >
        <span className="bvc-live-dot" />
        Auto-refreshing every 10 seconds · BVC24 AI Smart Manufacturing ERP
      </div>
    </div>
  );
}


export default DashboardHome;
