import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";
import styles from "./StarPerformance.module.css";


const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];


// =====================================================================
// Star rendering — half-star aware
// =====================================================================

function StarRow({ value, size = 18, color = "#f59e0b" }) {

  const stars = [];

  for (let i = 1; i <= 5; i++) {

    if (value >= i) {

      stars.push("full");

    } else if (value >= i - 0.5) {

      stars.push("half");

    } else {

      stars.push("empty");
    }
  }

  return (

    <span className={styles.starRowWrap} style={{ fontSize: size }}>
      {stars.map((s, i) => (
        <span
          key={i}
          style={{
            color: s === "empty" ? "var(--border-strong)" : color,
            fontSize: size,
            position: "relative",
            display: "inline-block",
            width: size,
            height: size
          }}
        >
          {s === "half" ? (
            <>
              <span className={styles.halfStarBase}>
                ★
              </span>
              <span className={styles.halfStarFill} style={{ color }}>
                ★
              </span>
            </>
          ) : "★"}
        </span>
      ))}
      <span className={styles.starValue} style={{ fontSize: size * 0.7 }}>
        {value.toFixed(1)}
      </span>
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

  const palette = [
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#06b6d4",
    "#6366f1",
    "#ec4899"
  ];

  let h = 0;

  const t = (name || "").toString();

  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;

  return palette[h % palette.length];
}


function Avatar({ score, size = 50 }) {

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


// =====================================================================
// Per-employee score card
// =====================================================================

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

  const tier = score.OVERALL_STARS >= 4.5 ? "TOP"
    : score.OVERALL_STARS >= 3.5 ? "STRONG"
    : score.OVERALL_STARS >= 2.5 ? "AVERAGE"
    : "AT_RISK";

  const tierTheme = {
    TOP:      { bg: "#dcfce7", fg: "#065f46", label: "🏆 Top Performer" },
    STRONG:   { bg: "#dbeafe", fg: "#1e40af", label: "💪 Strong" },
    AVERAGE:  { bg: "#fef3c7", fg: "#92400e", label: "⚖️ Average" },
    AT_RISK:  { bg: "#fee2e2", fg: "#991b1b", label: "⚠️ At Risk" }
  }[tier];

  return (

    <div className={styles.scoreCard}>
      <div
        className={styles.cardStrip}
        style={{ background: avatarColor(score.EMPLOYEE_NAME) }}
      />

      <div className={styles.empRow}>
        <Avatar score={score} size={50} />
        <div className={styles.empInfo}>
          <div className={styles.empName}>{score.EMPLOYEE_NAME}</div>
          <div className={styles.empCode}>{score.EMPLOYEE_CODE}</div>
        </div>
        <span
          className={styles.tierBadge}
          style={{ background: tierTheme.bg, color: tierTheme.fg }}
        >
          {tierTheme.label}
        </span>
      </div>

      <div className={styles.overallBox}>
        <div className={styles.overallLabel}>Overall</div>
        <div className={styles.overallStars}>
          <StarRow value={score.OVERALL_STARS} size={22} />
        </div>
      </div>

      <DimRow label="Task"       stars={score.TASK_STARS}       weight="25%" />
      <DimRow label="Attendance" stars={score.ATTENDANCE_STARS} weight="25%" />
      <DimRow label="Leave"      stars={score.LEAVE_STARS}      weight="25%" />
      <DimRow label="Permission" stars={score.PERMISSION_STARS} weight="25%" />

      <div className={styles.statsRow}>
        <span>{score.DAYS_PRESENT}/{score.WORKING_DAYS} days</span>
        <span>{score.TASKS_COMPLETED}/{score.TASKS_ASSIGNED} tasks</span>
        <span>{Number(score.LEAVE_DAYS_TAKEN || 0).toFixed(1)} unpaid leave</span>
        <span>{Number(score.PERMISSION_HOURS_TAKEN || 0).toFixed(1)}h permission</span>
      </div>

      <div className={styles.actionRow}>
        <ActionBtn
          active={score.RECOMMENDED_FOR_PROMOTION}
          icon="🎯"
          label="Promote"
          color="#6366f1"
          onClick={() => flip("PROMOTION")}
          disabled={busy}
        />
        <ActionBtn
          active={score.RECOMMENDED_FOR_INCREMENT}
          icon="💰"
          label="Increment"
          color="#10b981"
          onClick={() => flip("INCREMENT")}
          disabled={busy}
        />
        <ActionBtn
          active={score.REWARDED}
          icon="🏆"
          label="Reward"
          color="#f59e0b"
          onClick={() => flip("REWARDED")}
          disabled={busy}
        />
      </div>

      {score.MD_REMARKS && (
        <div className={styles.remarksBox}>
          💬 {score.MD_REMARKS}
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
      <StarRow value={stars} size={14} />
    </div>
  );
}


function ActionBtn({ active, icon, label, color, onClick, disabled }) {

  return (

    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "7px 10px",
        border: active ? "none" : `1px solid ${color}33`,
        background: active ? color : "transparent",
        color: active ? "white" : color,
        borderRadius: 7,
        fontSize: 10,
        fontWeight: 800,
        cursor: disabled ? "default" : "pointer",
        letterSpacing: 0.3,
        textTransform: "uppercase"
      }}
    >
      {icon} {label}
    </button>
  );
}


// =====================================================================
// Main page
// =====================================================================

function StarPerformance() {

  const today = new Date();

  const [scores, setScores] = useState([]);

  const [period, setPeriod] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1
  });

  const [actualPeriod, setActualPeriod] = useState(null);

  const [loading, setLoading] = useState(true);

  const [computing, setComputing] = useState(false);

  const [search, setSearch] = useState("");

  const fetchScores = (yr, mo) => {

    setLoading(true);

    const url = (yr && mo)
      ? `/performance/stars?vendor_id=1&year=${yr}&month=${mo}`
      : "/performance/stars?vendor_id=1";

    API.get(url)
      .then((r) => {

        setScores(r.data?.scores || []);

        if (r.data?.year && r.data?.month) {

          setActualPeriod({ year: r.data.year, month: r.data.month });
        }
      })
      .catch(() => setScores([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    fetchScores(period.year, period.month);

  }, []);

  const compute = async () => {

    setComputing(true);

    try {

      const res = await API.post("/performance/stars/compute", {
        VENDOR_ID: 1,
        YEAR: period.year,
        MONTH: period.month
      });

      alert(res.data?.message || "Computed");

      fetchScores(period.year, period.month);

    } catch (err) {

      alert(err?.response?.data?.detail || "Compute failed");

    } finally {

      setComputing(false);
    }
  };

  const filteredScores = useMemo(() => {

    const q = search.trim().toLowerCase();

    if (!q) return scores;

    return scores.filter((s) =>
      [s.EMPLOYEE_NAME, s.EMPLOYEE_CODE]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
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
    : "—";

  const yearOptions = useMemo(() => {

    const yr = today.getFullYear();

    return [yr - 2, yr - 1, yr, yr + 1];

  }, []);

  return (

    <div className={styles.page}>

      {/* Hero */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>Performance</div>
          <h1 className={styles.heroTitle}>Star Performance</h1>
        </div>

        <div className={styles.heroActions}>
          <select
            value={period.month}
            onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}
            className={styles.picker}
          >
            {MONTH_NAMES.map((n, i) => (
              <option key={i + 1} value={i + 1}>{n}</option>
            ))}
          </select>
          <select
            value={period.year}
            onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
            className={styles.picker}
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => fetchScores(period.year, period.month)}
            className={styles.loadBtn}
          >
            Load
          </button>
          <button
            onClick={compute}
            disabled={computing}
            className={styles.computeBtn}
          >
            {computing ? "Computing…" : "Compute Stars"}
          </button>
        </div>
      </div>

      {/* Stats tiles */}
      <div className={styles.tilesGrid}>
        <Tile label="Period"    value={periodLabel}       color="#6366f1" />
        <Tile label="Avg Stars" value={stats.overallAvg}  color="#f59e0b" stars />
        <Tile label="🏆 Top"   value={stats.top}          sub="(4.5+)"         color="#10b981" />
        <Tile label="💪 Strong" value={stats.strong}      sub="(3.5+)"         color="#3b82f6" />
        <Tile label="⚠️ At Risk" value={stats.risk}       sub="(below 2.5)"    color="#ef4444" />
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <input
          type="text"
          placeholder="🔍 Search by name or code..."
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
          <div className={styles.emptyBoxTitle}>
            No scores for {MONTH_NAMES[period.month - 1]} {period.year}
          </div>
          <div className={styles.emptyBoxSub}>
            Click <strong>Compute Stars</strong> to generate this month's scores
            from the live attendance, task, and productivity data.
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


function Tile({ label, value, sub, color, stars }) {

  return (

    <div className={styles.tile} style={{ "--tile-color": color }}>
      <div className={styles.tileLabel}>{label}</div>
      {stars ? (
        <div className={styles.tileStars}>
          <StarRow value={Number(value) || 0} size={20} />
        </div>
      ) : (
        <div className={styles.tileValue}>{value}</div>
      )}
      {sub && <div className={styles.tileSub}>{sub}</div>}
    </div>
  );
}


export default StarPerformance;
