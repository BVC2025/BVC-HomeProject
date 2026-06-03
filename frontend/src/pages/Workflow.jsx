import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";


// ===================================================================
// Workflow — visual end-to-end map of BVC24's connected modules.
//
// Every node represents a sidebar module. The arrows show how data
// FLOWS between them in real life:
//
//   Customers + Suppliers  → Projects + Machine Models
//                          → Work Orders + BOM
//                          → Production Stages
//                          → Biometric Scan → Attendance
//                          → AI Allocation → Tasks
//                          → Quality Inspection → NCRs
//                          → MD Performance + Leave
//
// Each node shows a LIVE count from /connect/workflow/snapshot.
// Click any node to navigate to the corresponding module — so the
// page doubles as a connectivity table of contents.
// ===================================================================


const NODE_DEFINITIONS = [
  // [id, row, col, label, sub-label, gradient, target route, count-key]
  {
    id: "customers", row: 0, col: 0,
    label: "Customers",
    grad: "linear-gradient(135deg,#06b6d4,#0ea5e9)",
    to: "/customers",
    countKey: ["people", "customers"],
    description: "Who buys our machines"
  },
  {
    id: "suppliers", row: 0, col: 2,
    label: "Suppliers",
    grad: "linear-gradient(135deg,#C8102E,#8B0B1F)",
    to: "/suppliers",
    countKey: ["people", "suppliers_active"],
    description: "Where we buy parts"
  },
  {
    id: "employees", row: 0, col: 4,
    label: "Employees",
    grad: "linear-gradient(135deg,#6366f1,#8b5cf6)",
    to: "/employees",
    countKey: ["people", "employees_active"],
    description: "Who builds the machines"
  },

  {
    id: "projects", row: 1, col: 0,
    label: "Projects",
    grad: "linear-gradient(135deg,#C8102E,#8B0B1F)",
    to: "/projects",
    countKey: ["sales", "projects_active"],
    description: "Customer orders → work plans"
  },
  {
    id: "models", row: 1, col: 2,
    label: "Machine Models + BOM",
    grad: "linear-gradient(135deg,#C8102E,#8B0B1F)",
    to: "/production",
    countKey: ["products", "machine_models"],
    description: "What we make, parts required"
  },
  {
    id: "leave", row: 1, col: 4,
    label: "Leave",
    grad: "linear-gradient(135deg,#10b981,#059669)",
    to: "/leave-management",
    countKey: ["leave", "pending_md_approval"],
    countLabel: "pending MD",
    description: "Apply, MD escalation rule"
  },

  {
    id: "biometric", row: 2, col: 0,
    label: "Biometric Gate",
    grad: "linear-gradient(135deg,#4A0E18,#1A0508)",
    to: "/biometric",
    countKey: ["biometric", "scans_today"],
    countLabel: "scans today",
    description: "Fingerprint check-in/out"
  },
  {
    id: "workorders", row: 2, col: 2,
    label: "Work Orders",
    grad: "linear-gradient(135deg,#F4B324,#C8102E)",
    to: "/production",
    countKey: ["production", "work_orders_in_progress"],
    countLabel: "in progress",
    description: "Build N machines for X order"
  },
  {
    id: "attendance", row: 2, col: 4,
    label: "Attendance",
    grad: "linear-gradient(135deg,#0ea5e9,#3b82f6)",
    to: "/attendance",
    countKey: ["biometric", "in_office_now"],
    countLabel: "in office now",
    description: "Check-in/out, worked hours"
  },

  {
    id: "tasks", row: 3, col: 0,
    label: "AI Task Allocation",
    grad: "linear-gradient(135deg,#8b5cf6,#ec4899)",
    to: "/employees",
    countKey: ["tasks", "tasks_in_progress"],
    countLabel: "in progress",
    description: "Skill-matched daily tasks"
  },
  {
    id: "stages", row: 3, col: 2,
    label: "Process Stages (Gantt)",
    grad: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
    to: "/production",
    countKey: ["production", "stages_done_today"],
    countLabel: "stages done today",
    description: "Design → Wiring → Assembly..."
  },
  {
    id: "inventory", row: 3, col: 4,
    label: "Inventory",
    grad: "linear-gradient(135deg,#64748b,#475569)",
    to: "/inventory",
    countKey: ["inventory", "low_stock"],
    countLabel: "low stock",
    description: "Raw material levels"
  },

  {
    id: "quality", row: 4, col: 0,
    label: "Quality Control",
    grad: "linear-gradient(135deg,#10b981,#059669)",
    to: "/quality",
    countKey: ["quality", "inspections_total"],
    countLabel: "inspections",
    description: "Pre-dispatch checklists"
  },
  {
    id: "ncrs", row: 4, col: 2,
    label: "NCRs",
    grad: "linear-gradient(135deg,#ef4444,#b91c1c)",
    to: "/quality",
    countKey: ["quality", "open_ncrs"],
    countLabel: "open",
    description: "Defects + corrective action"
  },
  {
    id: "performance", row: 4, col: 4,
    label: "MD Performance Review",
    grad: "linear-gradient(135deg,#C8102E,#8B0B1F)",
    to: "/md-review",
    countKey: ["people", "employees_active"],
    countLabel: "scored",
    description: "Auto-suggested increment %"
  }
];


// Arrows: [from-id, to-id, label]
const FLOWS = [
  ["customers", "projects", "places order"],
  ["projects", "workorders", "spawns"],
  ["models", "workorders", "model + BOM"],
  ["suppliers", "models", "parts source"],
  ["suppliers", "workorders", "supplies parts"],
  ["employees", "biometric", "scan in"],
  ["biometric", "attendance", "logs"],
  ["biometric", "tasks", "triggers allocation"],
  ["employees", "tasks", "skill match"],
  ["workorders", "stages", "10 stages each"],
  ["tasks", "stages", "stages = tasks"],
  ["employees", "stages", "marks ✓/✗"],
  ["stages", "quality", "QC gate"],
  ["quality", "ncrs", "FAIL → auto-NCR"],
  ["models", "inventory", "BOM consumes"],
  ["tasks", "performance", "scored monthly"],
  ["employees", "leave", "applies"],
  ["leave", "performance", "affects attendance"],
  ["attendance", "performance", "on-time tasks"],
  ["quality", "workorders", "PASS gates DONE"]
];


// Lay out positions: grid columns 0..4 → x px positions
const COL_X = [40, 240, 460, 680, 880];

const ROW_Y = [40, 180, 320, 460, 600];

const NODE_W = 200;

const NODE_H = 100;


function getCount(snapshot, keyPath) {

  if (!snapshot || !keyPath) return null;

  let v = snapshot;

  for (const k of keyPath) {

    if (v == null) return null;

    v = v[k];
  }

  return v;
}


function Node({ node, snapshot, onClick }) {

  const x = COL_X[node.col];

  const y = ROW_Y[node.row];

  const count = getCount(snapshot, node.countKey);

  return (

    <div
      onClick={() => onClick(node)}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: NODE_W,
        height: NODE_H,
        background: node.grad,
        color: "white",
        borderRadius: 14,
        padding: "12px 14px",
        cursor: "pointer",
        boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
        transition: "transform 0.2s, box-shadow 0.2s",
        animation: "bvcWfNodeIn 0.5s ease-out both"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 14px 32px rgba(15,23,42,0.28)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(15,23,42,0.18)";
      }}
    >

      <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2 }}>
        {node.label}
      </div>

      {count != null && (
        <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>
            {count}
          </span>
          {node.countLabel && (
            <span style={{
              fontSize: 10,
              opacity: 0.9,
              marginLeft: 4,
              letterSpacing: 0.5,
              textTransform: "uppercase"
            }}>
              {node.countLabel}
            </span>
          )}
        </div>
      )}

      <div style={{
        fontSize: 10,
        opacity: 0.85,
        marginTop: count != null ? 2 : 8,
        lineHeight: 1.3
      }}>
        {node.description}
      </div>
    </div>
  );
}


function Arrow({ from, to, label, key }) {

  const x1 = COL_X[from.col] + NODE_W / 2;

  const y1 = ROW_Y[from.row] + NODE_H / 2;

  const x2 = COL_X[to.col] + NODE_W / 2;

  const y2 = ROW_Y[to.row] + NODE_H / 2;

  // Make the line stop at the node edge so the head sits cleanly
  const dx = x2 - x1;

  const dy = y2 - y1;

  const len = Math.sqrt(dx * dx + dy * dy);

  const nx = dx / len;

  const ny = dy / len;

  const inset = 60;   // pull the endpoints inside each node

  const sx = x1 + nx * inset;

  const sy = y1 + ny * inset;

  const ex = x2 - nx * inset;

  const ey = y2 - ny * inset;

  const midX = (sx + ex) / 2;

  const midY = (sy + ey) / 2;

  return (

    <g>
      <line
        x1={sx} y1={sy} x2={ex} y2={ey}
        stroke="rgba(99,102,241,0.35)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        markerEnd="url(#arrowHead)"
      />
      {label && (
        <g transform={`translate(${midX},${midY})`}>
          <rect
            x="-50" y="-9" width="100" height="18" rx="9"
            fill="white"
            stroke="rgba(99,102,241,0.25)"
          />
          <text
            x="0" y="3.5"
            textAnchor="middle"
            fontSize="9"
            fontWeight="600"
            fill="#6366f1"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}


function StoryBlock({ snapshot }) {

  // Show 4 narrative cards explaining the flow in plain English
  const totalScans = snapshot?.biometric?.scans_today ?? 0;

  const inOffice = snapshot?.biometric?.in_office_now ?? 0;

  const tasksToday = snapshot?.tasks?.tasks_completed_today ?? 0;

  const units = snapshot?.production?.units_in_pipeline ?? 0;

  const openNcrs = snapshot?.quality?.open_ncrs ?? 0;

  const pendingLeave = snapshot?.leave?.pending_md_approval ?? 0;

  const cards = [
    {
      icon: "👆", title: "Gate-driven workforce",
      body: `${totalScans} biometric scans today · ${inOffice} employees currently on the floor. Each scan triggers AI task allocation by skill match.`,
      color: "#1e3a8a"
    },
    {
      icon: "🏭", title: "Production live",
      body: `${units} machine units in pipeline across ${snapshot?.production?.work_orders_in_progress ?? 0} active work orders. ${snapshot?.production?.stages_done_today ?? 0} stages completed today.`,
      color: "#f59e0b"
    },
    {
      icon: "✅", title: "Quality gating",
      body: `${snapshot?.quality?.inspections_total ?? 0} inspections recorded · ${openNcrs} open NCRs. Work Orders cannot move to DONE without a PASS inspection.`,
      color: "#10b981"
    },
    {
      icon: "📈", title: "MD oversight",
      body: `${pendingLeave} leave requests waiting MD approval · ${tasksToday} tasks completed today are flowing into the performance review for next month's increments.`,
      color: "#7c3aed"
    }
  ];

  return (

    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 12,
      marginBottom: 22
    }}>
      {cards.map((c, i) => (
        <div key={i} style={{
          padding: 14,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
          borderLeft: `4px solid ${c.color}`
        }}>
          <div style={{ fontSize: 18, marginBottom: 4 }}>{c.icon} <strong style={{ fontSize: 14 }}>{c.title}</strong></div>
          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.55 }}>
            {c.body}
          </div>
        </div>
      ))}
    </div>
  );
}


function Workflow() {

  const [snapshot, setSnapshot] = useState(null);

  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  const fetchSnap = async () => {

    try {

      const res = await API.get("/connect/workflow/snapshot");

      setSnapshot(res.data);

    } catch (e) {

      // non-fatal
    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchSnap();

    const id = setInterval(fetchSnap, 10 * 1000);

    return () => clearInterval(id);

  }, []);

  const handleNodeClick = (node) => {

    if (node.to) navigate(node.to);
  };

  // Build a lookup so arrows can find node positions
  const nodeById = Object.fromEntries(NODE_DEFINITIONS.map((n) => [n.id, n]));

  // SVG bounds — fits all positions plus padding
  const svgW = COL_X[COL_X.length - 1] + NODE_W + 40;

  const svgH = ROW_Y[ROW_Y.length - 1] + NODE_H + 40;

  return (

    <div style={{
      padding: 24,
      background: "#f1f5f9",
      minHeight: "100%"
    }}>

      <style>{`
        @keyframes bvcWfNodeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bvcWfArrowDash {
          to { stroke-dashoffset: -200; }
        }
      `}</style>

      <div style={{ marginBottom: 18 }}>
        <h1 style={{
          fontSize: 26,
          fontWeight: 800,
          color: "#0f172a",
          margin: 0
        }}>
          BVC24 Connectivity Map
        </h1>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
          Every module, connected. Click any node to dive into its page.
          The arrows show how data flows between them in real time.
        </div>
      </div>

      <StoryBlock snapshot={snapshot} />

      <div style={{
        background: "white",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
        overflow: "auto"
      }}>

        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.4,
          color: "#94a3b8",
          textTransform: "uppercase",
          marginBottom: 8
        }}>
          End-to-end data flow {loading && "— loading…"}
        </div>

        <div style={{
          position: "relative",
          width: svgW,
          height: svgH,
          margin: "0 auto"
        }}>

          {/* SVG arrows layer */}
          <svg
            width={svgW}
            height={svgH}
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
          >
            <defs>
              <marker
                id="arrowHead"
                viewBox="0 0 10 10"
                refX="8" refY="5"
                markerWidth="6" markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(99,102,241,0.5)" />
              </marker>
            </defs>

            {FLOWS.map(([fromId, toId, label], i) => {
              const from = nodeById[fromId];
              const to = nodeById[toId];
              if (!from || !to) return null;
              return (
                <Arrow key={i} from={from} to={to} label={label} />
              );
            })}
          </svg>

          {/* Nodes layer */}
          {NODE_DEFINITIONS.map((n) => (
            <Node
              key={n.id}
              node={n}
              snapshot={snapshot}
              onClick={handleNodeClick}
            />
          ))}
        </div>

        <div style={{
          marginTop: 16,
          padding: 12,
          background: "#f8fafc",
          borderRadius: 8,
          fontSize: 12,
          color: "#64748b",
          textAlign: "center"
        }}>
          🔄 Auto-refreshing every 10 seconds. Counts come from
          <code style={{
            background: "#e0e7ff",
            color: "#4338ca",
            padding: "2px 6px",
            borderRadius: 4,
            margin: "0 4px"
          }}>GET /connect/workflow/snapshot</code>
        </div>
      </div>
    </div>
  );
}


export default Workflow;
