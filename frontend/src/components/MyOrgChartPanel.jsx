// =====================================================================
// MyOrgChartPanel — Employee Self-Service -> Organization Chart.
// ---------------------------------------------------------------------
// Renders the whole company's reporting hierarchy as a top-down tree.
// The current employee's own node is highlighted in BVC red so they
// can find themselves at a glance. Each node shows:
//
//   [photo or initial]  Name           BVC008
//                       Designation · Department
//
// Children are drawn beneath their parent, connected by pure CSS
// vertical + horizontal rules (no external tree library, no d3, no
// heavy graph engine).
//
// Backend: GET /org/chart — see routes/org_chart.py
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";


const BVC_RED = "#dc2626";


function resolvePhoto(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
  return url;
}


function initialsOf(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last  = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}


export default function MyOrgChartPanel() {

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  // Manages expand/collapse per node so the user can drill down into
  // a big org without scrolling through everyone. Default: all
  // top-level roots expanded, plus every ancestor of the current
  // employee expanded so 'you are here' is visible on first load.
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await API.get("/org/chart");
      setData(res.data || null);
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't load the organization chart.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);


  // Once we have data, seed expand-state so:
  //   • every root is open
  //   • every ancestor of the "me" node is open (so I can see myself)
  useEffect(() => {
    if (!data?.roots) return;
    const next = {};
    const walkForMe = (node, ancestors) => {
      if (node.is_me) {
        for (const a of ancestors) next[a] = true;
        next[node.id] = true;
        return true;
      }
      for (const c of node.children || []) {
        if (walkForMe(c, [...ancestors, node.id])) return true;
      }
      return false;
    };
    for (const r of data.roots) {
      next[r.id] = true;
      walkForMe(r, []);
    }
    setExpanded(next);
  }, [data]);


  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));


  const totals = useMemo(() => {
    if (!data) return { total: 0, roots: 0 };
    return { total: data.total_employees || 0, roots: data.root_count || 0 };
  }, [data]);


  // =============================================================
  // Render
  // =============================================================

  return (
    <div style={styles.wrap}>

      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Employee Self-Service</div>
          <h1 style={styles.h1}>Organization Chart</h1>
          <p style={styles.sub}>
            Who reports to whom, top to bottom. Your seat is highlighted in red.
          </p>
        </div>
        {data && (
          <div style={styles.summary}>
            <div style={styles.summaryValue}>{totals.total}</div>
            <div style={styles.summaryLabel}>active employees</div>
          </div>
        )}
      </div>

      <div style={styles.card}>

        {loading && (
          <div style={styles.muted}>Building the tree…</div>
        )}

        {!loading && error && (
          <div style={styles.error}>{error}</div>
        )}

        {!loading && !error && data && data.roots?.length === 0 && (
          <div style={styles.empty}>
            No hierarchy configured yet. Once HR sets each employee's
            reporting manager, the tree will appear here.
          </div>
        )}

        {!loading && !error && data && data.roots?.length > 0 && (
          <div style={styles.treeScroll}>
            <ul style={styles.treeRoot}>
              {data.roots.map((r) => (
                <OrgNode
                  key={r.id}
                  node={r}
                  expanded={expanded}
                  onToggle={toggle}
                  depth={0}
                />
              ))}
            </ul>
          </div>
        )}

      </div>

      {/* Legend */}
      {!loading && !error && data && data.roots?.length > 0 && (
        <div style={styles.legendRow}>
          <span style={styles.legendChip}>
            <span style={{ ...styles.legendDot, background: BVC_RED }} />
            You
          </span>
          <span style={styles.legendChip}>
            <span style={{ ...styles.legendDot, background: "#e2e8f0" }} />
            Everyone else
          </span>
          <span style={styles.legendChip}>
            Tap the arrow to collapse or expand a branch.
          </span>
        </div>
      )}

      {/* Tree connector styles — kept scoped in a <style> block so we
          don't need a whole CSS module for this one panel. */}
      <style>{`
        .bvc-org-branch {
          list-style: none;
          margin: 0;
          padding: 0 0 0 22px;
          position: relative;
        }
        .bvc-org-branch::before {
          content: "";
          position: absolute;
          left: 11px;
          top: 0;
          bottom: 22px;
          width: 2px;
          background: #e2e8f0;
        }
        .bvc-org-item {
          position: relative;
          padding: 6px 0 6px 18px;
        }
        .bvc-org-item::before {
          content: "";
          position: absolute;
          left: -11px;
          top: 26px;
          width: 24px;
          height: 2px;
          background: #e2e8f0;
        }
        .bvc-org-item:last-child::after {
          content: "";
          position: absolute;
          left: -11px;
          top: 26px;
          bottom: 0;
          width: 2px;
          background: #ffffff;
        }

        :global(html[data-theme="dark"]) .bvc-org-branch::before,
        :global(html[data-theme="dark"]) .bvc-org-item::before {
          background: rgba(255, 255, 255, 0.10);
        }
      `}</style>
    </div>
  );
}


// =====================================================================
// Recursive node renderer
// =====================================================================

function OrgNode({ node, expanded, onToggle, depth }) {

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isOpen      = expanded[node.id] ?? false;
  const photo       = resolvePhoto(node.photo_url);

  return (
    <li className="bvc-org-item">
      <div
        style={{
          ...styles.card_node,
          ...(node.is_me ? styles.card_node_me : null),
        }}
      >
        {/* Expand / collapse handle */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            style={styles.toggleBtn}
            aria-label={isOpen ? "Collapse team" : "Expand team"}
            title={isOpen ? "Collapse team" : "Expand team"}
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}
              aria-hidden="true"
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        ) : (
          <span style={styles.toggleSpacer} />
        )}

        {/* Avatar */}
        <span style={{
          ...styles.avatar,
          background: node.is_me ? BVC_RED : "#e2e8f0",
          color: node.is_me ? "#ffffff" : "#334155",
        }}>
          {photo ? (
            <img
              src={photo}
              alt={node.name}
              style={styles.avatarImg}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : initialsOf(node.name)}
        </span>

        {/* Text */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={styles.nameRow}>
            <span style={{
              ...styles.name,
              color: node.is_me ? "#ffffff" : "#0f172a",
            }}>
              {node.name}
            </span>
            {node.code && (
              <span style={{
                ...styles.codePill,
                background: node.is_me ? "rgba(255,255,255,0.22)" : "#f1f5f9",
                color: node.is_me ? "#ffffff" : "#475569",
              }}>
                {node.code}
              </span>
            )}
            {node.is_me && (
              <span style={styles.mePill}>You</span>
            )}
          </div>
          <div style={{
            ...styles.meta,
            color: node.is_me ? "rgba(255,255,255,0.85)" : "#64748b",
          }}>
            {node.designation || "—"}
            {node.department && (
              <>
                <span style={styles.dot}>·</span>
                {node.department}
              </>
            )}
            {hasChildren && (
              <>
                <span style={styles.dot}>·</span>
                <span style={{ fontWeight: 700 }}>
                  {node.children.length} direct report{node.children.length === 1 ? "" : "s"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {hasChildren && isOpen && (
        <ul className="bvc-org-branch">
          {node.children.map((c) => (
            <OrgNode
              key={c.id}
              node={c}
              expanded={expanded}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}


const styles = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#0f172a",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  eyebrow: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4,
    color: BVC_RED, textTransform: "uppercase", marginBottom: 4,
  },
  h1: { fontSize: 22, fontWeight: 800, letterSpacing: -0.3, margin: 0 },
  sub: { fontSize: 13, color: "#64748b", marginTop: 6, maxWidth: 620 },
  summary: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "10px 18px",
    textAlign: "center",
  },
  summaryValue: {
    fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1,
  },
  summaryLabel: {
    fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
    color: "#94a3b8", textTransform: "uppercase", marginTop: 4,
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 20,
    minHeight: 120,
  },
  muted: { color: "#94a3b8", fontSize: 13, padding: 12 },
  error: {
    padding: "10px 14px",
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
  },
  empty: {
    padding: 22, color: "#64748b", fontSize: 13, textAlign: "center",
    background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 8,
  },
  treeScroll: {
    overflowX: "auto",
  },
  treeRoot: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: "100%",
  },

  card_node: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    minWidth: 260,
    transition: "background 0.12s ease, border-color 0.12s ease",
  },
  card_node_me: {
    background: BVC_RED,
    borderColor: BVC_RED,
    boxShadow: "0 8px 22px rgba(220,38,38,0.22)",
  },
  toggleBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22, height: 22,
    background: "transparent",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    borderRadius: 4,
    padding: 0,
    flexShrink: 0,
  },
  toggleSpacer: { display: "inline-block", width: 22, height: 22, flexShrink: 0 },
  avatar: {
    width: 36, height: 36, borderRadius: 999,
    display: "inline-flex",
    alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 700, letterSpacing: 0.4,
    flexShrink: 0, overflow: "hidden",
  },
  avatarImg: {
    width: "100%", height: "100%", objectFit: "cover",
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  name: { fontSize: 14, fontWeight: 700, letterSpacing: -0.1 },
  codePill: {
    display: "inline-block",
    padding: "1px 8px",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: 0.4,
  },
  mePill: {
    display: "inline-block",
    padding: "1px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    background: "#ffffff",
    color: BVC_RED,
  },
  meta: {
    fontSize: 12,
    marginTop: 2,
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    lineHeight: 1.35,
  },
  dot: { color: "#cbd5e1" },

  legendRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
    padding: "0 4px",
  },
  legendChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    color: "#64748b",
    fontWeight: 500,
  },
  legendDot: {
    width: 10, height: 10, borderRadius: 999, display: "inline-block",
  },
};
