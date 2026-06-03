/* eslint-disable react-refresh/only-export-components */
// Shared chart styling primitives used by Admin + Employee dashboards.

// Modern, high-contrast palette tuned to look good against white cards.
export const PALETTE = [
  "#2563eb", // blue
  "#16a34a", // green
  "#d97706", // amber
  "#dc2626", // red
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d"  // lime
];

export const TASK_STATUS_COLORS = {
  PENDING: "#d97706",
  IN_PROGRESS: "#2563eb",
  COMPLETED: "#16a34a",
  ON_HOLD: "#9333ea"
};

export const ATTENDANCE_COLORS = {
  PRESENT: "#16a34a",
  LATE: "#d97706",
  ABSENT: "#dc2626"
};


// Gradient defs for bar charts. Drop <ChartGradients /> inside a
// recharts <defs> block, then reference url(#grad-blue) etc.
export function ChartGradients() {

  return (
    <>
      {PALETTE.map((color, i) => (
        <linearGradient
          key={i}
          id={`grad-${i}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <stop offset="100%" stopColor={color} stopOpacity={0.55} />
        </linearGradient>
      ))}
    </>
  );
}


// Custom tooltip used across all charts — gives a uniform look.
export function ChartTooltip({ active, payload, label, valueFmt }) {

  if (!active || !payload || payload.length === 0) return null;

  return (

    <div
      style={{
        background: "rgba(15, 23, 42, 0.94)",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        pointerEvents: "none"
      }}
    >
      {label && (
        <div
          style={{
            fontWeight: 600,
            marginBottom: 4,
            opacity: 0.9
          }}
        >
          {label}
        </div>
      )}
      {payload.map((p, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: p.color || p.fill
            }}
          />
          <span style={{ opacity: 0.8 }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>
            {valueFmt ? valueFmt(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}


// Center text for a donut chart — shows total + caption underneath.
export function DonutCenter({
  viewBox,
  total,
  caption
}) {

  const { cx, cy } = viewBox || {};

  return (

    <g>
      <text
        x={cx}
        y={cy - 6}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: 28,
          fontWeight: 700,
          fill: "#0f172a"
        }}
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 18}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: 11,
          fill: "#64748b",
          letterSpacing: 0.5,
          textTransform: "uppercase"
        }}
      >
        {caption}
      </text>
    </g>
  );
}


// Slice label that includes percentage — used inside <Pie label={...}>
export function renderPercentLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent
}) {

  if (percent < 0.05) return null;  // hide tiny slivers

  const RADIAN = Math.PI / 180;

  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;

  const x = cx + radius * Math.cos(-midAngle * RADIAN);

  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (

    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      style={{
        fontSize: 12,
        fontWeight: 700,
        textShadow: "0 1px 2px rgba(0,0,0,0.4)"
      }}
    >
      {(percent * 100).toFixed(0)}%
    </text>
  );
}


// Sums up a data array for donut center totals.
export function sumValues(data) {

  if (!Array.isArray(data)) return 0;

  return data.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
}
