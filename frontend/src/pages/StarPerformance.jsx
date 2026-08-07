/*
 * StarPerformance
 * ---------------
 * MD-facing monthly view of every employee's performance score,
 * computed live from the attendance + task + leave tables.
 *
 * The page auto-loads and auto-refreshes — no manual "Compute" button.
 * Backend GET /performance/stars now runs the compute on the fly when
 * the month has no data or when the current-month cache is > 30 min
 * old. Past months lock once computed.
 *
 * All icons are inline SVGs — no emojis anywhere (per BVC style).
 */

import { useEffect, useMemo, useState } from "react";
import API, { API_BASE_URL } from "../services/api";
import styles from "./StarPerformance.module.css";


const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];


// ============================================================
// Inline SVG icon set — professional, monochrome, size-friendly
// ============================================================

const Icon = ({ name, size = 16, style }) => {
  const paths = {
    trophy: (
      <>
        <path d="M6 9a5 5 0 0 0 10 0V4H6z" />
        <path d="M18 5h2a2 2 0 0 1 2 2v2a4 4 0 0 1-4 4" />
        <path d="M6 5H4a2 2 0 0 0-2 2v2a4 4 0 0 0 4 4" />
        <path d="M11 13v3M8 20h8M10 20l1-4h2l1 4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    alert: (
      <>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />,
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
    trending: (
      <>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </>
    ),
    dollar: (
      <>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </>
    ),
    gift: (
      <>
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect x="2" y="7" width="20" height="5" />
        <line x1="12" y1="22" x2="12" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
      </>
    ),
    quote: (
      <>
        <path d="M3 21c3 0 7-1 7-8V5c0-1.3-1-2-2-2H4c-1 0-2 .7-2 2v6c0 1.3.7 2 2 2h3" />
        <path d="M15 21c3 0 7-1 7-8V5c0-1.3-1-2-2-2h-4c-1 0-2 .7-2 2v6c0 1.3.7 2 2 2h3" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
};


// ============================================================
// Star row — half-star aware
// ============================================================

function StarRow({ value, size = 18, color = "#f59e0b", showNumber = true }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (value >= i) stars.push("full");
    else if (value >= i - 0.5) stars.push("half");
    else stars.push("empty");
  }

  return (
    <span className={styles.starRowWrap} style={{ fontSize: size }}>
      {stars.map((s, i) => (
        <span
          key={i}
          className={styles.starGlyph}
          style={{
            width: size,
            height: size,
            position: "relative",
            display: "inline-block",
            color: s === "empty" ? "#e2e8f0" : color,
          }}
        >
          {s === "half" ? (
            <>
              <span className={styles.halfStarBase}>★</span>
              <span className={styles.halfStarFill} style={{ color }}>★</span>
            </>
          ) : "★"}
        </span>
      ))}

      {showNumber && (
        <span className={styles.starValue} style={{ fontSize: size * 0.7 }}>
          {value.toFixed(1)}
        </span>
      )}
    </span>
  );
}


// =====================================================================
// Avatar — flat color per name (no gradients)
// =====================================================================

function initials(name) {
  return (name || "")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}


function avatarColor(name) {
  const palette = ["#ef4444", "#10b981", "#f59e0b", "#06b6d4", "#6366f1", "#ec4899"];
  let h = 0;
  const t = (name || "").toString();
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}


function Avatar({ score, size = 48 }) {
  const url = score?.PHOTO_URL ? `${API_BASE_URL}${score.PHOTO_URL}` : null;
  if (url) {
    return (
      <img
        src={url}
        alt={score.EMPLOYEE_NAME}
        className={styles.avatarImg}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={styles.avatarInitials}
      style={{
        width: size,
        height: size,
        background: avatarColor(score?.EMPLOYEE_NAME),
        fontSize: size * 0.38
      }}
    >
      {initials(score?.EMPLOYEE_NAME)}
    </div>
  );
}


// ============================================================
// Tier — with SVG icon (no emoji)
// ============================================================

const TIER_MAP = {
  TOP: { label: "Top Performer", bg: "#dcfce7", fg: "#065f46", icon: "trophy" },
  STRONG: { label: "Strong", bg: "#dbeafe", fg: "#1e40af", icon: "shield" },
  AVERAGE: { label: "Average", bg: "#fef3c7", fg: "#92400e", icon: "trending" },
  AT_RISK: { label: "At Risk", bg: "#fee2e2", fg: "#991b1b", icon: "alert" },
};

function tierOf(stars) {
  if (stars >= 4.5) return "TOP";
  if (stars >= 3.5) return "STRONG";
  if (stars >= 2.5) return "AVERAGE";
  return "AT_RISK";
}


// ============================================================
// Per-employee score card
// ============================================================

function ScoreCard({ score, onAction }) {
  const [busy, setBusy] = useState(false);

  const flip = async (field) => {
    setBusy(true);
    try {
      const body = {};
      body[field] = !score[
        field === "PROMOTION" ? "RECOMMENDED_FOR_PROMOTION"
          : field === "INCREMENT" ? "RECOMMENDED_FOR_INCREMENT"
            : "REWARDED"
      ];
      await API.patch(`/performance/stars/${score.ID}/action`, body);
      onAction?.();
    } finally {
      setBusy(false);
    }
  };

  const tier = tierOf(score.OVERALL_STARS);
  const tierTheme = TIER_MAP[tier];

  return (
    <div className={styles.scoreCard}>
      <div
        className={styles.cardStrip}
        style={{ background: avatarColor(score.EMPLOYEE_NAME) }}
      />

      <div className={styles.empRow}>
        <Avatar score={score} size={48} />
        <div className={styles.empInfo}>
          <div className={styles.empName}>{score.EMPLOYEE_NAME}</div>
          <div className={styles.empCode}>{score.EMPLOYEE_CODE}</div>
        </div>
        <span
          className={styles.tierBadge}
          style={{ background: tierTheme.bg, color: tierTheme.fg }}
        >
          <Icon name={tierTheme.icon} size={12} />
          {tierTheme.label}
        </span>
      </div>

      <div className={styles.overallBox}>
        <div className={styles.overallLabel}>Overall Score</div>
        <div className={styles.overallStars}>
          <StarRow value={score.OVERALL_STARS} size={22} />
        </div>
      </div>

      <DimRow label="Task" stars={score.TASK_STARS} weight="25%" />
      <DimRow label="Attendance" stars={score.ATTENDANCE_STARS} weight="25%" />
      <DimRow label="Leave" stars={score.LEAVE_STARS} weight="25%" />
      <DimRow label="Permission" stars={score.PERMISSION_STARS} weight="25%" />

      <div className={styles.statsRow}>
        <StatChip icon="calendar" text={`${score.DAYS_PRESENT}/${score.WORKING_DAYS} days`} />
        <StatChip icon="star" text={`${score.TASKS_COMPLETED}/${score.TASKS_ASSIGNED} tasks`} />
        <StatChip text={`${Number(score.LEAVE_DAYS_TAKEN || 0).toFixed(1)} unpaid`} />
        <StatChip text={`${Number(score.PERMISSION_HOURS_TAKEN || 0).toFixed(1)}h perm`} />
      </div>

      <div className={styles.actionRow}>
        <ActionBtn
          active={score.RECOMMENDED_FOR_PROMOTION}
          icon="trending"
          label="Promote"
          color="#6366f1"
          onClick={() => flip("PROMOTION")}
          disabled={busy}
        />
        <ActionBtn
          active={score.RECOMMENDED_FOR_INCREMENT}
          icon="dollar"
          label="Increment"
          color="#10b981"
          onClick={() => flip("INCREMENT")}
          disabled={busy}
        />
        <ActionBtn
          active={score.REWARDED}
          icon="gift"
          label="Reward"
          color="#f59e0b"
          onClick={() => flip("REWARDED")}
          disabled={busy}
        />
      </div>

      {score.MD_REMARKS && (
        <div className={styles.remarksBox}>
          <Icon name="quote" size={12} />
          <span>{score.MD_REMARKS}</span>
        </div>
      )}
    </div>
  );
}


function DimRow({ label, stars, weight }) {
  return (
    <div className={styles.dimRow}>
      <span className={styles.dimLabel}>
        {label}
        <span className={styles.dimWeight}>({weight})</span>
      </span>
      <StarRow value={stars} size={13} />
    </div>
  );
}


function StatChip({ icon, text }) {
  return (
    <span className={styles.statChip}>
      {icon && <Icon name={icon} size={11} />}
      {text}
    </span>
  );
}


function ActionBtn({ active, icon, label, color, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={styles.actionBtn}
      style={{
        flex: 1,
        padding: "7px 10px",
        border: active ? "none" : `1px solid ${color}33`,
        background: active ? color : "transparent",
        color: active ? "white" : color,
      }}
    >
      <Icon name={icon} size={11} />
      {label}
    </button>
  );
}


// ============================================================
// Tile — summary card
// ============================================================

function Tile({ label, value, sub, color, icon, stars }) {
  return (
    <div className={styles.tile} style={{ "--tile-color": color }}>
      <div className={styles.tileHead}>
        {icon && (
          <span className={styles.tileIconBox} style={{ background: `${color}18`, color }}>
            <Icon name={icon} size={14} />
          </span>
        )}
        <div className={styles.tileLabel}>{label}</div>
      </div>
      {stars ? (
        <div className={styles.tileStars}>
          <StarRow value={Number(value) || 0} size={18} />
        </div>
      ) : (
        <div className={styles.tileValue}>{value}</div>
      )}
      {sub && <div className={styles.tileSub}>{sub}</div>}
    </div>
  );
}


// ============================================================
// Main page
// ============================================================

function StarPerformance() {
  const today = new Date();

  const [scores, setScores] = useState([]);
  const [period, setPeriod] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [actualPeriod, setActualPeriod] = useState(null);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [autoComputed, setAutoComputed] = useState(false);

  const fetchScores = (yr, mo) => {
    setLoading(true);
    const url = (yr && mo)
      ? `/performance/stars?vendor_id=1&year=${yr}&month=${mo}`
      : "/performance/stars?vendor_id=1";
    API.get(url)
      .then((r) => {
        setScores(r.data?.scores || []);
        setAutoComputed(!!r.data?.auto_computed);
        if (r.data?.year && r.data?.month) {
          setActualPeriod({ year: r.data.year, month: r.data.month });
        }
      })
      .catch(() => setScores([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchScores(period.year, period.month);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredScores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scores;
    return scores.filter((s) =>
      [s.EMPLOYEE_NAME, s.EMPLOYEE_CODE]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [scores, search]);

  const stats = useMemo(() => {
    const total = scores.length;
    const top = scores.filter((s) => s.OVERALL_STARS >= 4.5).length;
    const strong = scores.filter((s) => s.OVERALL_STARS >= 3.5 && s.OVERALL_STARS < 4.5).length;
    const avg = scores.filter((s) => s.OVERALL_STARS >= 2.5 && s.OVERALL_STARS < 3.5).length;
    const risk = scores.filter((s) => s.OVERALL_STARS < 2.5).length;
    const overallAvg = total
      ? (scores.reduce((s, x) => s + x.OVERALL_STARS, 0) / total).toFixed(2)
      : 0;
    return { total, top, strong, avg, risk, overallAvg };
  }, [scores]);

  const periodLabel = actualPeriod
    ? `${MONTH_NAMES[actualPeriod.month - 1]} ${actualPeriod.year}`
    : `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  const yearOptions = useMemo(() => {
    const yr = today.getFullYear();
    return [yr - 2, yr - 1, yr, yr + 1];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.page}>

      {/* Hero */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>Performance</div>
          <h1 className={styles.heroTitle}>Star Performance</h1>

          <div className={styles.heroSub}>
            Auto-computed from live attendance, tasks, leaves and permissions.
            {autoComputed && (
              <span className={styles.freshBadge}>
                <span className={styles.freshDot} />
                Fresh
              </span>
            )}
          </div>
        </div>

        <div className={styles.heroActions}>
          <select
            value={period.month}
            onChange={(e) => {
              const m = Number(e.target.value);
              setPeriod((p) => ({ ...p, month: m }));
              fetchScores(period.year, m);
            }}
            className={styles.picker}
          >
            {MONTH_NAMES.map((n, i) => (
              <option key={i + 1} value={i + 1}>{n}</option>
            ))}
          </select>
          <select
            value={period.year}
            onChange={(e) => {
              const y = Number(e.target.value);
              setPeriod((p) => ({ ...p, year: y }));
              fetchScores(y, period.month);
            }}
            className={styles.picker}
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Stat tiles */}
      <div className={styles.tilesGrid}>
        <Tile label="Period" value={periodLabel} color="#6366f1" icon="calendar" />
        <Tile label="Avg Stars" value={stats.overallAvg} color="#f59e0b" icon="star" stars />
        <Tile label="Top" value={stats.top} color="#10b981" icon="trophy" sub="(4.5+)" />
        <Tile label="Strong" value={stats.strong} color="#3b82f6" icon="shield" sub="(3.5+)" />
        <Tile label="At Risk" value={stats.risk} color="#ef4444" icon="alert" sub="(below 2.5)" />
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <span className={styles.searchIcon}>
          <Icon name="search" size={14} />
        </span>
        <input
          type="text"
          placeholder="Search by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      {loading && (
        <div className={styles.loadingText}>Loading scores…</div>
      )}

      {!loading && scores.length === 0 && (
        <div className={styles.emptyBox}>
          <div className={styles.emptyIcon}>
            <Icon name="users" size={28} />
          </div>
          <div className={styles.emptyBoxTitle}>
            No scores for {periodLabel}
          </div>
          <div className={styles.emptyBoxSub}>
            No employees have attendance or task data for this month yet.
            Once check-ins begin, scores appear here automatically.
          </div>
        </div>
      )}

      {!loading && filteredScores.length > 0 && (
        <div className={styles.cardsGrid}>
          {filteredScores.map((s) => (
            <ScoreCard
              key={s.ID}
              score={s}
              onAction={() => fetchScores(period.year, period.month)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default StarPerformance;
