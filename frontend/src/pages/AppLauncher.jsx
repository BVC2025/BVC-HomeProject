// =====================================================================
// AppLauncher — Odoo-style home screen.
//
// Post-login landing page. Renders every module as a coloured tile.
// Clicking a tile navigates to that module's existing route — no
// existing module / DB is touched.
// =====================================================================

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_GOLD = "#F4B324";


// Module groups + their tiles. Add / remove / reorder freely — every
// entry just needs a `path` that matches a registered route + a label
// + an icon (single letter or 1-2 chars).
const GROUPS = [
  {
    label: "Organization & HR",
    color: "#C8102E",
    tiles: [
      { path: "/",                  label: "Dashboard",        icon: "D" },
      { path: "/employees",         label: "Employees",        icon: "E" },
      { path: "/approvals",         label: "Approvals",        icon: "A" },
      { path: "/rbac",              label: "RBAC",             icon: "R" },
      { path: "/memos",             label: "Memos",            icon: "M" },
      { path: "/attendance",        label: "Attendance",       icon: "At" },
      { path: "/leave-management",  label: "Leave",            icon: "L" },
      { path: "/payroll",           label: "Payroll",          icon: "Pa" },
      { path: "/star-performance",  label: "Star Performance", icon: "★" },
      { path: "/allowances",        label: "Allowances",       icon: "$" },
      { path: "/recruitment",       label: "Recruitment",      icon: "R" },
    ],
  },
  {
    label: "CRM & Sales",
    color: "#B47900",
    tiles: [
      { path: "/customers",         label: "Customers",        icon: "C" },
      { path: "/quotations",        label: "Quotations",       icon: "Q" },
      { path: "/sales-orders",      label: "Sales Orders",     icon: "SO" },
    ],
  },
  {
    label: "Project & Manufacturing",
    color: "#7c3aed",
    tiles: [
      { path: "/projects",          label: "Projects",         icon: "P" },
      { path: "/machines",          label: "Machines",         icon: "Mc" },
      { path: "/work-centers",      label: "Work Centers",     icon: "WC" },
      { path: "/production",        label: "Production & BOM", icon: "Pr" },
      { path: "/quality",           label: "Quality",          icon: "QC" },
    ],
  },
  {
    label: "Purchase & Inventory",
    color: "#0891b2",
    tiles: [
      { path: "/suppliers",         label: "Suppliers",        icon: "S" },
      { path: "/purchase",          label: "BOM Map",          icon: "BM" },
      { path: "/purchase-orders",   label: "Purchase Orders",  icon: "PO" },
      { path: "/inventory",         label: "Inventory",        icon: "Iv" },
    ],
  },
  {
    label: "Reports & Analytics",
    color: "#1d4ed8",
    tiles: [
      { path: "/reports",           label: "Reports",          icon: "Rp" },
    ],
  },
  {
    label: "System",
    color: "#475569",
    tiles: [
      { path: "/company-settings",  label: "Company Settings", icon: "Co" },
      { path: "/holidays",          label: "Holidays",         icon: "Ho" },
      { path: "/geofence",          label: "Geofence",         icon: "Ge" },
      { path: "/settings",          label: "Settings",         icon: "St" },
    ],
  },
];


export default function AppLauncher() {

  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const username =
    localStorage.getItem("username") || "there";

  // Flatten all tiles into a search index — when the user types
  // anything, we filter and show a single grid of matching tiles
  // (ignoring groups).
  const allTiles = useMemo(() =>
    GROUPS.flatMap((g) =>
      g.tiles.map((t) => ({ ...t, _group: g.label, _color: g.color }))
    ),
    []
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? allTiles.filter((t) =>
        t.label.toLowerCase().includes(q) ||
        t._group.toLowerCase().includes(q)
      )
    : null;

  return (
    <div style={{
      padding: "26px 28px 60px",
      background: "linear-gradient(180deg, #fafbfc 0%, #f1f5f9 100%)",
      minHeight: "calc(100vh - 80px)",
    }}>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
        borderRadius: 16,
        padding: "22px 28px",
        color: "white",
        marginBottom: 24,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16,
        boxShadow: "0 12px 32px rgba(139,11,31,0.20)",
      }}>
        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 2,
            color: BVC_GOLD,
            textTransform: "uppercase",
          }}>
            BVC24 &middot; Bharath Vending Corporation
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 4, letterSpacing: -0.5 }}>
            Welcome back, {username}
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            Choose an app to get started, or search below.
          </div>
        </div>

        <div style={{ position: "relative", width: 280, maxWidth: "100%" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps..."
            style={{
              width: "100%",
              padding: "12px 14px 12px 40px",
              borderRadius: 10,
              border: "none",
              background: "rgba(255,255,255,0.15)",
              color: "white",
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <span style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "rgba(255,255,255,0.7)",
            pointerEvents: "none",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
        </div>
      </div>

      {/* Filtered single grid (when searching) */}
      {filtered !== null && (
        <>
          <GroupHeader label={`${filtered.length} result${filtered.length === 1 ? "" : "s"} for "${query}"`} color="#0f172a" />
          {filtered.length === 0 ? (
            <div style={{
              padding: 40,
              textAlign: "center",
              color: "#94a3b8",
              background: "white",
              borderRadius: 14,
              border: "1px dashed #cbd5e1",
              fontSize: 14,
            }}>
              No apps match "{query}". Try a different search term.
            </div>
          ) : (
            <TileGrid tiles={filtered} onOpen={(p) => navigate(p)} />
          )}
        </>
      )}

      {/* Grouped grids (when not searching) */}
      {filtered === null && GROUPS.map((g) => (
        <div key={g.label} style={{ marginBottom: 28 }}>
          <GroupHeader label={g.label} color={g.color} />
          <TileGrid
            tiles={g.tiles.map((t) => ({ ...t, _color: g.color }))}
            onOpen={(p) => navigate(p)}
          />
        </div>
      ))}
    </div>
  );
}


// =====================================================================

function GroupHeader({ label, color }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    }}>
      <div style={{
        width: 4,
        height: 22,
        borderRadius: 2,
        background: color,
      }} />
      <div style={{
        fontSize: 13,
        fontWeight: 800,
        letterSpacing: 1.2,
        color: "#0f172a",
        textTransform: "uppercase",
      }}>
        {label}
      </div>
    </div>
  );
}


function TileGrid({ tiles, onOpen }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
      gap: 14,
    }}>
      {tiles.map((t) => (
        <Tile key={t.path} tile={t} onOpen={onOpen} />
      ))}
    </div>
  );
}


function Tile({ tile, onOpen }) {
  return (
    <button
      onClick={() => onOpen(tile.path)}
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: "20px 14px",
        cursor: "pointer",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        height: 132,
        boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = "0 14px 32px rgba(15,23,42,0.12)";
        e.currentTarget.style.borderColor = tile._color;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,23,42,0.04)";
        e.currentTarget.style.borderColor = "#e2e8f0";
      }}
    >
      <div style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        background: `linear-gradient(135deg, ${tile._color}, ${darken(tile._color)})`,
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        fontWeight: 800,
        letterSpacing: -0.5,
        boxShadow: `0 8px 20px ${tile._color}44`,
      }}>
        {tile.icon}
      </div>
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: "#0f172a",
        letterSpacing: -0.005 + "em",
      }}>
        {tile.label}
      </div>
    </button>
  );
}


// Crude HEX-darken — drops every channel by ~25%.
function darken(hex) {
  if (!hex || hex[0] !== "#") return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - 40);
  const g = Math.max(0, ((n >> 8)  & 0xff) - 40);
  const b = Math.max(0, ( n        & 0xff) - 40);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
