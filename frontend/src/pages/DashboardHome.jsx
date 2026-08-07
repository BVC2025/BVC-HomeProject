import { useEffect, useMemo, useState } from "react";

import { Link } from "react-router-dom";

import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import API from "../services/api";
import { formatISTTime } from "../utils/time";
import styles from "./DashboardHome.module.css";


// =================================================================
// BVC24 Modern Dashboard
//
// Animated hero, KPI cards with count-up, live activity feed,
// production + quality pulse, recharts area + donut. Auto-refreshes
// every 10 seconds.
// =================================================================


// ---- Color palettes ---------------------------------------------

const KPI_PALETTES = [
  { grad: "#ef4444", ring: "rgba(239,68,68,0.18)" },
  { grad: "#3b82f6", ring: "rgba(59,130,246,0.18)" },
  { grad: "#10b981", ring: "rgba(16,185,129,0.18)" },
  { grad: "#f59e0b", ring: "rgba(245,158,11,0.18)" },
  { grad: "#6366f1", ring: "rgba(99,102,241,0.18)" },
  { grad: "#0ea5e9", ring: "rgba(14,165,233,0.18)" }
];

const DONUT_COLORS = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#6366f1", "#0ea5e9"
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
      const eased = 1 - Math.pow(1 - t, 3);
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

void greetingFor;


function Hero() {

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  const date = now.toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  });

  return (
    <div className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.heroLeft}>
          <div className={styles.heroEyebrow}>BVC24 · AI Smart Manufacturing</div>
          <h1 className={styles.heroTitle}>Real-Time Analytics Powered ERP</h1>
          <div className={styles.heroSub}>
            Your AI command center for smart manufacturing —
            live intelligence from gate scan to dispatch.
          </div>
          <div className={styles.heroBadgeRow}>
            <span className={styles.heroBadge}>
              <span className={styles.heroBadgeDot} />
              All Systems Operational
            </span>
            <span className={styles.heroBadgeMuted}>🤖 AI Allocator Online</span>
            <span className={styles.heroBadgeMuted}>👆 Biometric Gate Active</span>
          </div>
        </div>

        <div className={styles.heroClock}>
          <div className={styles.heroClockTime}>{time}</div>
          <div className={styles.heroClockDate}>{date}</div>
          <div className={styles.heroClockLive}>
            <span className={styles.bvcLiveDot} />
            Live · Asia/Kolkata
          </div>
        </div>
      </div>
    </div>
  );
}


// ---- KPI card with count-up --------------------------

function KPI({ icon, label, value, sub, palette, delay }) {

  const animatedValue = useCountUp(value);

  return (
    <div
      className={styles.kpiCard}
      style={{
        borderTop: `3px solid ${palette.grad}`,
        animationDelay: `${delay}ms`
      }}
    >
      <div className={styles.kpiIconBubble} style={{ background: palette.ring }}>
        {icon}
      </div>

      <div className={styles.kpiLabel}>{label}</div>

      <div className={styles.kpiValue} style={{ color: palette.grad }}>
        {value == null ? (
          <span className={styles.bvcSkeletonInline} />
        ) : animatedValue}
      </div>

      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </div>
  );
}


// ---- Live activity feed -----------------------------------------

function ActivityFeed({ items, loading }) {

  return (
    <div className={styles.activityCard} style={{ animationDelay: "300ms" }}>
      <div className={styles.activityHeader}>
        <div>
          <div className={styles.kpiLabel}>Live Activity</div>
          <div className={styles.sectionTitleNoMb}>
            Recent Biometric Scans
          </div>
        </div>
        <div className={styles.activityLiveLabel}>
          <span className={styles.bvcLiveDot} />
          live
        </div>
      </div>

      <div className={styles.activityList}>
        {loading && [1, 2, 3].map((i) => (
          <div key={i} className={styles.activitySkeleton} />
        ))}

        {!loading && items.length === 0 && (
          <div className={styles.activityEmpty}>
            No scans yet today.
          </div>
        )}

        {items.slice(0, 6).map((evt, idx) => {
          const ok = evt.RESULT === "SUCCESS";
          return (
            <div
              key={evt.ID}
              className={ok ? styles.activityRow : styles.activityRowFail}
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <div className={ok ? styles.activityAvatar : styles.activityAvatarFail}>
                {(evt.EMPLOYEE_NAME || "?").charAt(0).toUpperCase()}
              </div>
              <div className={styles.activityInfo}>
                <div className={styles.activityName}>
                  {evt.EMPLOYEE_NAME || `Unknown FP ${evt.FINGERPRINT_ID}`}
                </div>
                <div className={styles.activityMeta}>
                  {evt.EMPLOYEE_CODE || "—"} · {evt.DEVICE_ID}
                </div>
              </div>
              <div className={ok ? styles.activityTime : styles.activityTimeFail}>
                <div className={styles.activityTimestamp}>
                  {formatISTTime(evt.EVENT_TIME)}
                </div>
                <div className={styles.activityResult}>{evt.RESULT}</div>
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
    <div className={styles.sectionCard} style={{ animationDelay: `${delay}ms` }}>
      <div className={styles.sectionAccentBar} style={{ background: accent }} />
      <div className={styles.sectionSubtitle}>{subtitle}</div>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}


// ---- Department / project distribution donut --------------------

function DistributionDonut({ data, title }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  return (
    <div className={styles.donutWrap}>
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
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className={styles.donutCenter}>
        <div className={styles.donutLabel}>{title}</div>
        <div className={styles.donutTotal}>{total}</div>
      </div>
    </div>
  );
}


// ---- Production pulse area chart --------------------------------

function ProductionPulse({ stats }) {

  const data = useMemo(() => {
    const counts = stats?.work_orders_by_status || {};
    return [
      { name: "Planned",     value: counts.PLANNED     || 0 },
      { name: "In Progress", value: counts.IN_PROGRESS || 0 },
      { name: "On Hold",     value: counts.ON_HOLD     || 0 },
      { name: "Done",        value: counts.DONE        || 0 }
    ];
  }, [stats]);

  return (
    <div className={styles.areaWrap}>
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="bvcProdFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#6366f1" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
          <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} fill="url(#bvcProdFill)" isAnimationActive animationDuration={1000} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}


// ---- Quick action grid ------------------------------------------

const QUICK_ACTIONS = [
  { to: "/biometric",        icon: "👆", label: "Gate Kiosk",  color: "#ef4444" },
  { to: "/production",       icon: "🏭", label: "Production", color: "#ef4444" },
  { to: "/quality",          icon: "✅", label: "Quality",    color: "#10b981" },
  { to: "/suppliers",        icon: "🏢", label: "Suppliers",  color: "#f59e0b" },
  { to: "/leave-management", icon: "🌴", label: "Leave",      color: "#ef4444" },
  { to: "/md-review",        icon: "📊", label: "MD Review",  color: "#ef4444" }
];


function QuickActions() {
  return (
    <div className={styles.quickGrid}>
      {QUICK_ACTIONS.map((a, idx) => (
        <Link
          key={a.to}
          to={a.to}
          className={styles.quickLink}
          style={{
            background: a.color,
            animationDelay: `${idx * 70}ms`
          }}
        >
          <div className={styles.quickIcon}>{a.icon}</div>
          <div className={styles.quickLabel}>{a.label}</div>
        </Link>
      ))}
    </div>
  );
}


// =================================================================
// Main component
// =================================================================

function DashboardHome() {

  const [boardData, setBoardData]     = useState(null);
  const [prodData, setProdData]       = useState(null);
  const [qualityData, setQualityData] = useState(null);
  const [leaveData, setLeaveData]     = useState(null);
  const [recent, setRecent]           = useState([]);
  const [loading, setLoading]         = useState(true);

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

  const summary = useMemo(() => {
    const totalTasksDone = (boardData?.employees || []).reduce(
      (s, e) => s + (e.TASKS_COMPLETED_TODAY || 0), 0
    );
    return {
      in_office: boardData?.summary?.in_office,
      tasks_completed_today: totalTasksDone,
      open_ncrs: qualityData?.open_ncrs ?? 0
    };
  }, [boardData, qualityData]);

  const deptData = useMemo(() => {
    const grouped = {};
    (boardData?.employees || []).forEach((e) => {
      const k = e.DEPARTMENT || "Unassigned";
      grouped[k] = (grouped[k] || 0) + 1;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [boardData]);

  const prodChartData = useMemo(
    () => ({ work_orders_by_status: prodData?.by_status || {} }),
    [prodData]
  );

  void summary;

  return (
    <div className={styles.page}>

      <Hero />

      {/* KPI ROW */}
      <div className={styles.kpiGrid}>
        <KPI icon="👥" label="In Office Now"     value={boardData?.summary?.in_office}            sub={`of ${boardData?.summary?.total_active ?? 0} active`} palette={KPI_PALETTES[0]} delay={50}  />
        <KPI icon="✓"  label="Tasks Done Today"  value={summary.tasks_completed_today}             sub="auto-counted by AI"                                    palette={KPI_PALETTES[1]} delay={120} />
        <KPI icon="🏭" label="Units In Pipeline" value={prodData?.total_units_in_progress}         sub={`${prodData?.total_work_orders ?? 0} work orders`}      palette={KPI_PALETTES[2]} delay={190} />
        <KPI icon="🔍" label="QC Pass Rate"      value={Math.round(qualityData?.pass_rate_pct ?? 0)} sub={`${qualityData?.open_ncrs ?? 0} open NCRs`}           palette={KPI_PALETTES[3]} delay={260} />
        <KPI icon="🌴" label="On Leave Today"    value={leaveData?.on_leave_today}                 sub={`${leaveData?.pending ?? 0} pending requests`}          palette={KPI_PALETTES[4]} delay={330} />
        <KPI icon="📋" label="Checked Out"       value={boardData?.summary?.checked_out}           sub="done for the day"                                       palette={KPI_PALETTES[5]} delay={400} />
      </div>

      {/* TWO COLUMN GRID */}
      <div className={styles.col2x1}>
        <SectionCard subtitle="Production" title="Work Orders by Status" accent="#ef4444" delay={250}>
          <ProductionPulse stats={prodChartData} />
        </SectionCard>
        <ActivityFeed items={recent} loading={loading} />
      </div>

      {/* THREE COLUMN GRID */}
      <div className={styles.col3}>

        <SectionCard subtitle="Workforce" title="Department Mix" accent="#ef4444" delay={400}>
          {deptData.length === 0 ? (
            <div className={styles.deptEmpty}>
              Run seed to populate.
            </div>
          ) : (
            <DistributionDonut data={deptData} title="People" />
          )}
        </SectionCard>

        <SectionCard subtitle="Quality" title="Inspections Today" accent="#10b981" delay={470}>
          <div className={styles.qualityGrid}>
            {[
              ["PASS",    qualityData?.by_status?.PASS    ?? 0, styles.qualityTilePass],
              ["FAIL",    qualityData?.by_status?.FAIL    ?? 0, styles.qualityTileFail],
              ["PENDING", qualityData?.by_status?.PENDING ?? 0, styles.qualityTilePending],
              ["REWORK",  qualityData?.by_status?.REWORK  ?? 0, styles.qualityTileRework]
            ].map(([k, v, tileClass]) => (
              <div key={k} className={tileClass}>
                <div className={styles.qualityTileKey}>{k}</div>
                <div className={styles.qualityTileVal}>{v}</div>
              </div>
            ))}
          </div>
          <div className={styles.qualityFooter}>
            {qualityData?.critical_open_ncrs > 0 ? (
              <span className={styles.qualityFooterDanger}>
                ⚠ {qualityData.critical_open_ncrs} CRITICAL NCR(s) open
              </span>
            ) : (
              <span className={styles.qualityFooterOk}>
                ✓ No critical NCRs open
              </span>
            )}
          </div>
        </SectionCard>

        <SectionCard subtitle="Shortcuts" title="Quick Actions" accent="#f59e0b" delay={540}>
          <QuickActions />
        </SectionCard>
      </div>

      <div className={styles.footerNote}>
        <span className={styles.bvcLiveDot} />
        Auto-refreshing every 10 seconds · BVC24 AI Smart Manufacturing ERP
      </div>
    </div>
  );
}


export default DashboardHome;
