import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";


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

    <span style={{
      display: "inline-flex",
      gap: 2,
      alignItems: "center",
      fontSize: size,
      lineHeight: 1
    }}>
      {stars.map((s, i) => (
        <span
          key={i}
          style={{
            color: s === "empty" ? "#cbd5e1" : color,
            fontSize: size,
            position: "relative",
            display: "inline-block",
            width: size,
            height: size
          }}
        >
          {s === "half" ? (
            <>
              <span style={{ position: "absolute", inset: 0, color: "#cbd5e1" }}>
                ★
              </span>
              <span style={{
                position: "absolute",
                inset: 0,
                color,
                width: "50%",
                overflow: "hidden"
              }}>
                ★
              </span>
            </>
          ) : "★"}
        </span>
      ))}
      <span style={{
        marginLeft: 6,
        fontSize: size * 0.7,
        fontWeight: 700,
        color: "#475569"
      }}>
        {value.toFixed(1)}
      </span>
    </span>
  );
}


// =====================================================================
// Avatar — same pattern as Employees page
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


function avatarGradient(name) {

  const palette = [
    "linear-gradient(135deg, #C8102E, #8B0B1F)",
    "linear-gradient(135deg, #C8102E, #8B0B1F)",
    "linear-gradient(135deg, #10b981, #047857)",
    "linear-gradient(135deg, #F4B324, #8B0B1F)",
    "linear-gradient(135deg, #06b6d4, #0e7490)",
    "linear-gradient(135deg, #C8102E, #8B0B1F)"
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
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          border: "2px solid white",
          boxShadow: "0 4px 12px rgba(15,23,42,0.18)"
        }}
      />
    );
  }

  return (

    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: avatarGradient(score?.EMPLOYEE_NAME),
      color: "white",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      fontSize: size * 0.38,
      flexShrink: 0
    }}>
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

    <div style={{
      background: "white",
      borderRadius: 16,
      padding: 18,
      boxShadow: "0 10px 30px rgba(15,23,42,0.07)",
      animation: "perfFadeIn 0.4s ease-out both",
      position: "relative",
      overflow: "hidden"
    }}>
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        background: avatarGradient(score.EMPLOYEE_NAME)
      }} />

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
        <Avatar score={score} size={50} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
            {score.EMPLOYEE_NAME}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
            {score.EMPLOYEE_CODE}
          </div>
        </div>
        <span style={{
          fontSize: 9,
          padding: "3px 8px",
          borderRadius: 999,
          fontWeight: 800,
          background: tierTheme.bg,
          color: tierTheme.fg,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          flexShrink: 0,
          alignSelf: "flex-start"
        }}>
          {tierTheme.label}
        </span>
      </div>

      <div style={{
        background: "linear-gradient(135deg, #fef9c3, #fef3c7)",
        padding: "10px 14px",
        borderRadius: 10,
        marginBottom: 10,
        border: "1px solid #fde68a",
        textAlign: "center"
      }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: "#92400e", letterSpacing: 1.3, textTransform: "uppercase" }}>
          Overall
        </div>
        <div style={{ marginTop: 2 }}>
          <StarRow value={score.OVERALL_STARS} size={22} />
        </div>
      </div>

      <DimRow label="🕒 Attendance" stars={score.ATTENDANCE_STARS} weight="25%" />
      <DimRow label="✓ Task Completion" stars={score.TASK_STARS} weight="30%" />
      <DimRow label="⚡ Productivity" stars={score.PRODUCTIVITY_STARS} weight="25%" />
      <DimRow label="📈 Consistency" stars={score.CONSISTENCY_STARS} weight="20%" />

      <div style={{
        marginTop: 12,
        paddingTop: 10,
        borderTop: "1px dashed #e2e8f0",
        fontSize: 11,
        color: "#64748b",
        display: "flex",
        flexWrap: "wrap",
        gap: 10
      }}>
        <span>📅 {score.DAYS_PRESENT}/{score.WORKING_DAYS} days</span>
        <span>✓ {score.TASKS_ON_TIME}/{score.TASKS_ASSIGNED} tasks</span>
        <span>⏱ {score.ESTIMATED_HOURS}h est · {score.ACTUAL_HOURS}h actual</span>
      </div>

      <div style={{
        display: "flex",
        gap: 6,
        marginTop: 12,
        flexWrap: "wrap"
      }}>
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
        <div style={{
          marginTop: 10,
          fontSize: 11,
          color: "#475569",
          background: "#f8fafc",
          padding: 8,
          borderRadius: 6,
          fontStyle: "italic"
        }}>
          💬 {score.MD_REMARKS}
        </div>
      )}
    </div>
  );
}


function DimRow({ label, stars, weight }) {

  return (

    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "5px 0",
      fontSize: 12
    }}>
      <span style={{ color: "#475569", fontWeight: 600, flex: 1 }}>
        {label}
        <span style={{ color: "#94a3b8", fontWeight: 500, marginLeft: 6, fontSize: 10 }}>
          ({weight})
        </span>
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
        background: active
          ? `linear-gradient(135deg, ${color}, ${color}cc)`
          : "white",
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
  // Set after fetch — what the API actually returned

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

    <div style={{ padding: 26, background: "#f1f5f9", minHeight: "100%" }}>

      <style>{`
        @keyframes perfFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes perfHeroShift {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
      `}</style>

      {/* Hero */}
      <div style={{
        background: "linear-gradient(120deg, #1A0508 0%, #4A0E18 35%, #8B0B1F 65%, #C8102E 100%)",
        backgroundSize: "300% 300%",
        animation: "perfHeroShift 18s ease-in-out infinite",
        color: "white",
        padding: "28px 32px",
        borderRadius: 20,
        marginBottom: 22,
        boxShadow: "0 24px 60px rgba(99,102,241,0.4)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2.5, opacity: 0.85, fontWeight: 800, textTransform: "uppercase" }}>
            BVC24 · Star Performance Rating
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 900,
            margin: "6px 0 6px",
            lineHeight: 1.15,
            color: "white"
          }}>
            ⭐ Who's earning their stars this month?
          </h1>
          <div style={{ fontSize: 13, opacity: 0.92, maxWidth: 620 }}>
            Auto-computed from attendance, task completion, productivity,
            and consistency. Recommend top performers for promotions,
            increments, and rewards — one click each.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <select
            value={period.month}
            onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}
            style={pickerStyle()}
          >
            {MONTH_NAMES.map((n, i) => (
              <option key={i + 1} value={i + 1}>{n}</option>
            ))}
          </select>
          <select
            value={period.year}
            onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
            style={pickerStyle()}
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => fetchScores(period.year, period.month)}
            style={{
              background: "rgba(255,255,255,0.2)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.3)",
              padding: "9px 16px",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer"
            }}
          >
            🔍 Load
          </button>
          <button
            onClick={compute}
            disabled={computing}
            style={{
              background: "white",
              color: "#4338ca",
              border: "none",
              padding: "9px 20px",
              borderRadius: 10,
              fontWeight: 800,
              fontSize: 13,
              cursor: computing ? "default" : "pointer",
              boxShadow: "0 8px 20px rgba(0,0,0,0.2)"
            }}
          >
            {computing ? "Computing…" : "⚡ Compute Stars"}
          </button>
        </div>
      </div>

      {/* Stats tiles */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: 14,
        marginBottom: 20
      }}>
        <Tile label="Period" value={periodLabel} color="#6366f1" />
        <Tile label="Avg Stars" value={stats.overallAvg} color="#f59e0b" stars />
        <Tile label="🏆 Top" value={stats.top} sub="(4.5+)" color="#10b981" />
        <Tile label="💪 Strong" value={stats.strong} sub="(3.5+)" color="#3b82f6" />
        <Tile label="⚠️ At Risk" value={stats.risk} sub="(below 2.5)" color="#ef4444" />
      </div>

      {/* Search */}
      <div style={{
        background: "white",
        padding: 14,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 18
      }}>
        <input
          type="text"
          placeholder="🔍 Search by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13,
            boxSizing: "border-box"
          }}
        />
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          Loading scores…
        </div>
      )}

      {!loading && scores.length === 0 && (
        <div style={{
          padding: 50,
          textAlign: "center",
          color: "#475569",
          background: "white",
          borderRadius: 14,
          border: "1px dashed #cbd5e1"
        }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>⭐</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            No scores for {MONTH_NAMES[period.month - 1]} {period.year}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
            Click <strong>⚡ Compute Stars</strong> to generate this month's scores
            from the live attendance, task, and productivity data.
          </div>
        </div>
      )}

      {!loading && filteredScores.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: 18
        }}>
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


function pickerStyle() {

  return {
    background: "rgba(255,255,255,0.2)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.3)",
    padding: "9px 14px",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer"
  };
}


function Tile({ label, value, sub, color, stars }) {

  return (

    <div style={{
      background: "white",
      padding: "16px 20px",
      borderRadius: 14,
      boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
      borderTop: `3px solid ${color}`
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 1.5,
        color: "#64748b",
        textTransform: "uppercase"
      }}>
        {label}
      </div>
      {stars ? (
        <div style={{ marginTop: 6 }}>
          <StarRow value={Number(value) || 0} size={20} />
        </div>
      ) : (
        <div style={{
          fontSize: 26,
          fontWeight: 900,
          color: "#0f172a",
          marginTop: 4
        }}>
          {value}
        </div>
      )}
      {sub && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


export default StarPerformance;
