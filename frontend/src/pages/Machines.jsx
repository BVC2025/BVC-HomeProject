import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

const STATUS_OPTIONS = ["RUNNING", "IDLE", "DOWN", "MAINTENANCE"];

const STATUS_THEMES = {
  RUNNING: {
    grad: "linear-gradient(135deg, #10b981, #047857)",
    bg: "#d1fae5",
    fg: "#065f46",
    border: "#10b981",
    glow: "rgba(16, 185, 129, 0.35)",
    icon: "🟢",
    label: "Running"
  },
  IDLE: {
    grad: "linear-gradient(135deg, #C8102E, #8B0B1F)",
    bg: "#e0e7ff",
    fg: "#3730a3",
    border: "#6366f1",
    glow: "rgba(99, 102, 241, 0.3)",
    icon: "⏸",
    label: "Idle"
  },
  DOWN: {
    grad: "linear-gradient(135deg, #ef4444, #b91c1c)",
    bg: "#fee2e2",
    fg: "#991b1b",
    border: "#ef4444",
    glow: "rgba(239, 68, 68, 0.35)",
    icon: "⛔",
    label: "Down"
  },
  MAINTENANCE: {
    grad: "linear-gradient(135deg, #F4B324, #8B0B1F)",
    bg: "#fef3c7",
    fg: "#92400e",
    border: "#f59e0b",
    glow: "rgba(245, 158, 11, 0.3)",
    icon: "🛠",
    label: "Maintenance"
  },
  MIXED: {
    grad: "linear-gradient(135deg, #8b5cf6, #6366f1)",
    bg: "#ede9fe",
    fg: "#5b21b6",
    border: "#8b5cf6",
    glow: "rgba(139, 92, 246, 0.3)",
    icon: "🔀",
    label: "Mixed"
  }
};


function StatusPill({ status }) {

  const theme = STATUS_THEMES[status] || STATUS_THEMES.IDLE;

  return (

    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.4,
        background: theme.bg,
        color: theme.fg,
        textTransform: "uppercase"
      }}
    >
      <span aria-hidden="true">{theme.icon}</span>
      {theme.label}
    </span>
  );
}


function fmtTime(iso) {

  if (!iso) return "—";

  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}


// =================================================================
// WO-grouped card — one per Work Order, with N units inside
// =================================================================

// Status precedence — most concerning first. If any unit is DOWN
// the card surfaces DOWN; if any is MAINTENANCE it surfaces that;
// only when every unit matches do we get a "clean" status.
const STATUS_PRECEDENCE = ["DOWN", "MAINTENANCE", "IDLE", "RUNNING"];

function aggregateStatus(units) {

  if (!units.length) return "IDLE";

  const set = new Set(units.map((u) => u.STATUS));

  if (set.size === 1) return units[0].STATUS;

  // Mixed — return the most concerning one present
  for (const s of STATUS_PRECEDENCE) {

    if (set.has(s)) return s;
  }

  return "IDLE";
}


function StatusBreakdown({ units }) {

  const counts = STATUS_OPTIONS.reduce((acc, s) => {

    acc[s] = units.filter((u) => u.STATUS === s).length;

    return acc;

  }, {});

  return (

    <div
      style={{
        display: "flex",
        gap: 8,
        marginBottom: 10,
        flexWrap: "wrap"
      }}
    >
      {STATUS_OPTIONS.filter((s) => counts[s] > 0).map((s) => {

        const t = STATUS_THEMES[s];

        return (

          <span
            key={s}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 800,
              background: t.bg,
              color: t.fg
            }}
          >
            {t.icon} {counts[s]} {t.label}
          </span>
        );
      })}
    </div>
  );
}


function WOGroupCard({ group, onBatchStatus, onOpenLogs }) {

  const aggregate = aggregateStatus(group.units);

  const theme = STATUS_THEMES[aggregate] || STATUS_THEMES.IDLE;

  const isMixed = new Set(group.units.map((u) => u.STATUS)).size > 1;

  const [pendingStatus, setPendingStatus] = useState(null);

  const handleClick = async (next) => {

    setPendingStatus(next);

    try {

      await onBatchStatus(group.units, next);

    } finally {

      setPendingStatus(null);
    }
  };

  // Last updated = newest timestamp across units
  const lastUpdated = group.units.reduce((max, u) => {

    if (!u.LAST_UPDATED) return max;

    return !max || u.LAST_UPDATED > max ? u.LAST_UPDATED : max;

  }, null);

  // Use the first unit as the "representative" for model info
  const head = group.units[0];

  return (

    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: 18,
        boxShadow: `0 12px 30px ${theme.glow}`,
        position: "relative",
        overflow: "hidden",
        border: "1px solid #e2e8f0",
        animation: "machFadeIn 0.4s ease-out both"
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          background: theme.grad
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 10
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "#64748b",
              letterSpacing: 1.5,
              fontFamily: "ui-monospace, monospace"
            }}
          >
            {head.WO_NUMBER || head.SERIAL_NO || `MACHINE-${head.ID}`}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#0f172a",
              marginTop: 4,
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {head.MODEL_NAME || head.MACHINE_NAME}
          </div>
        </div>
        <StatusPill status={isMixed ? "MIXED" : aggregate} />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 10
        }}
      >
        <span
          style={{
            fontSize: 11,
            padding: "3px 12px",
            background: "linear-gradient(135deg, #f3e8ff, #fae8ff)",
            color: "#6d28d9",
            borderRadius: 999,
            fontWeight: 800,
            border: "1px solid #ddd6fe"
          }}
        >
          × {group.units.length} unit{group.units.length > 1 ? "s" : ""}
        </span>
        {head.MODEL_CATEGORY && (
          <span
            style={{
              fontSize: 10,
              padding: "3px 10px",
              background: "#eff6ff",
              color: "#1e40af",
              borderRadius: 999,
              fontWeight: 700,
              textTransform: "capitalize"
            }}
          >
            {head.MODEL_CATEGORY}
          </span>
        )}
        {head.MODEL_CODE && (
          <span
            style={{
              fontSize: 10,
              padding: "3px 10px",
              background: "#ecfdf5",
              color: "#065f46",
              borderRadius: 999,
              fontWeight: 700,
              fontFamily: "ui-monospace, monospace"
            }}
          >
            {head.MODEL_CODE}
          </span>
        )}
      </div>

      {isMixed && <StatusBreakdown units={group.units} />}

      {head.CUSTOMER_NAME && (
        <div
          style={{
            fontSize: 11,
            color: "#64748b",
            background: "#f8fafc",
            padding: "7px 10px",
            borderRadius: 8,
            marginBottom: 10
          }}
        >
          🤝 {head.CUSTOMER_NAME}
        </div>
      )}

      <div
        style={{
          fontSize: 10,
          color: "#94a3b8",
          marginBottom: 10
        }}
      >
        Last updated: {fmtTime(lastUpdated)}
      </div>

      {/* Batch status buttons — flips every unit in this WO */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          marginBottom: 10
        }}
      >
        {STATUS_OPTIONS.map((s) => {

          const t = STATUS_THEMES[s];

          const allMatch = !isMixed && aggregate === s;

          const isPending = pendingStatus === s;

          return (

            <button
              key={s}
              onClick={() => handleClick(s)}
              disabled={allMatch || isPending}
              title={`Set all ${group.units.length} units to ${t.label}`}
              style={{
                padding: "7px 0",
                border: allMatch
                  ? "none"
                  : `1px solid ${t.border}33`,
                background: allMatch
                  ? t.grad
                  : isPending
                    ? "#cbd5e1"
                    : "white",
                color: allMatch ? "white" : t.fg,
                borderRadius: 7,
                fontSize: 10,
                fontWeight: 800,
                cursor: allMatch ? "default" : "pointer",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                transition: "all 0.15s"
              }}
            >
              {isPending
                ? "…"
                : `${t.icon} ${s.charAt(0) + s.slice(1).toLowerCase()}`}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => onOpenLogs(group)}
        style={{
          width: "100%",
          background: "white",
          border: "1px solid #e2e8f0",
          color: "#475569",
          padding: "7px 0",
          borderRadius: 7,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer"
        }}
      >
        📜 View status history & units
      </button>
    </div>
  );
}


// =================================================================
// Logs drawer
// =================================================================

function LogsDrawer({ group, onClose }) {

  const [logs, setLogs] = useState([]);

  const [loading, setLoading] = useState(true);

  const units = group?.units || [];

  const head = units[0];

  useEffect(() => {

    if (!units.length) return;

    setLoading(true);

    Promise.all(
      units.map((u) =>
        API.get(`/machine-logs/${u.ID}`)
          .then((r) => (r.data || []).map((log) => ({
            ...log,
            UNIT_NUMBER: u.UNIT_NUMBER,
            SERIAL_NO: u.SERIAL_NO
          })))
          .catch(() => [])
      )
    )
      .then((perUnit) => {

        const all = perUnit.flat();

        // Newest first across all units
        all.sort(
          (a, b) =>
            new Date(b.TIMESTAMP) - new Date(a.TIMESTAMP)
        );

        setLogs(all);
      })
      .finally(() => setLoading(false));

  }, [group?.key]);

  if (!group) return null;

  return (

    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 950,
        display: "flex",
        justifyContent: "flex-end"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "92%",
          background: "white",
          padding: 24,
          overflow: "auto",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.3)"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 14
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "#64748b",
                letterSpacing: 1.5,
                fontFamily: "ui-monospace, monospace"
              }}
            >
              {head?.WO_NUMBER || head?.SERIAL_NO || "—"}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "#0f172a",
                marginTop: 4
              }}
            >
              {head?.MODEL_NAME || head?.MACHINE_NAME}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#64748b",
                marginTop: 4
              }}
            >
              {units.length} unit{units.length > 1 ? "s" : ""} in this batch
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "#f1f5f9",
              padding: "4px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 18
            }}
          >
            ×
          </button>
        </div>

        {units.length > 1 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 16,
              padding: 10,
              background: "#f8fafc",
              borderRadius: 8
            }}
          >
            {units.map((u) => (
              <div
                key={u.ID}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  background: "white",
                  borderRadius: 6,
                  fontSize: 11,
                  border: "1px solid #e2e8f0"
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    color: "#475569"
                  }}
                >
                  #{u.UNIT_NUMBER}
                </span>
                <StatusPill status={u.STATUS} />
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div style={{ color: "#94a3b8" }}>Loading…</div>
        )}

        {!loading && logs.length === 0 && (
          <div style={{ color: "#94a3b8", padding: 20 }}>
            No history yet.
          </div>
        )}

        {!loading && logs.map((log) => {

          const theme =
            STATUS_THEMES[log.STATUS] || STATUS_THEMES.IDLE;

          return (

            <div
              key={log.ID}
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 14,
                paddingBottom: 14,
                borderBottom: "1px solid #f1f5f9"
              }}
            >
              <div
                style={{
                  width: 4,
                  background: theme.grad,
                  borderRadius: 2,
                  flexShrink: 0
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8
                    }}
                  >
                    <StatusPill status={log.STATUS} />
                    {log.UNIT_NUMBER && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: "#6d28d9",
                          background: "#f3e8ff",
                          padding: "2px 8px",
                          borderRadius: 999
                        }}
                      >
                        Unit #{log.UNIT_NUMBER}
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      fontFamily: "ui-monospace, monospace"
                    }}
                  >
                    {fmtTime(log.TIMESTAMP)}
                  </span>
                </div>
                {log.NOTE && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#475569",
                      marginTop: 6,
                      lineHeight: 1.5
                    }}
                  >
                    {log.NOTE}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// =================================================================
// Main page
// =================================================================

function Machines() {

  const [machines, setMachines] = useState([]);

  const [loading, setLoading] = useState(true);

  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("ALL");

  const [logsGroup, setLogsGroup] = useState(null);

  const fetchMachines = async () => {

    try {

      const res = await API.get("/machines");

      setMachines(res.data || []);

    } catch (err) {

      console.log(err);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchMachines();

    const interval = setInterval(fetchMachines, 30000);

    return () => clearInterval(interval);

  }, []);

  const runSync = async () => {

    setSyncing(true);

    try {

      const res = await API.post("/machines/sync");

      const created = res.data?.created ?? 0;

      if (created > 0) {

        await fetchMachines();
      }

      alert(res.data?.message || "Sync done");

    } catch (err) {

      alert(err?.response?.data?.detail || "Sync failed");

    } finally {

      setSyncing(false);
    }
  };

  const updateStatus = async (machineId, newStatus) => {

    try {

      await API.put(`/machine-status/${machineId}`, {
        STATUS: newStatus,
        NOTE: `Status changed to ${newStatus}`
      });

      await fetchMachines();

    } catch (err) {

      alert(err?.response?.data?.detail || "Update failed");
    }
  };

  // Flip every unit in a WO group to the same status with parallel PUTs.
  // Units already at the target status are skipped to keep the log
  // clean (no spurious "changed to X" rows for things already at X).
  const batchUpdateStatus = async (units, newStatus) => {

    const targets = units.filter((u) => u.STATUS !== newStatus);

    if (targets.length === 0) return;

    try {

      await Promise.all(
        targets.map((u) =>
          API.put(`/machine-status/${u.ID}`, {
            STATUS: newStatus,
            NOTE: `Batch status change to ${newStatus} (${targets.length} unit(s))`
          })
        )
      );

      await fetchMachines();

    } catch (err) {

      alert(err?.response?.data?.detail || "Batch update failed");
    }
  };

  const counts = useMemo(() => {

    const out = { RUNNING: 0, IDLE: 0, DOWN: 0, MAINTENANCE: 0 };

    machines.forEach((m) => {

      if (out[m.STATUS] !== undefined) out[m.STATUS] += 1;
    });

    return out;

  }, [machines]);

  // Group machines by WO. Manually-created machines (no WO) become
  // their own single-unit "group" so they still show as cards.
  const groups = useMemo(() => {

    const byKey = new Map();

    machines.forEach((m) => {

      const key = m.WORK_ORDER_ID
        ? `wo-${m.WORK_ORDER_ID}`
        : `manual-${m.ID}`;

      if (!byKey.has(key)) {

        byKey.set(key, { key, units: [] });
      }

      byKey.get(key).units.push(m);
    });

    // Sort units inside each group by UNIT_NUMBER ascending
    const out = [...byKey.values()];

    out.forEach((g) => {

      g.units.sort(
        (a, b) => (a.UNIT_NUMBER || 0) - (b.UNIT_NUMBER || 0)
      );
    });

    // Sort groups by newest machine first
    out.sort((a, b) => {

      const ai = Math.max(...a.units.map((u) => u.ID));

      const bi = Math.max(...b.units.map((u) => u.ID));

      return bi - ai;
    });

    return out;

  }, [machines]);

  const filteredGroups = useMemo(() => {

    const q = search.trim().toLowerCase();

    return groups.filter((g) => {

      if (statusFilter !== "ALL") {

        const groupStatuses = new Set(g.units.map((u) => u.STATUS));

        if (!groupStatuses.has(statusFilter)) return false;
      }

      if (!q) return true;

      // Search across any unit's fields in the group
      return g.units.some((m) => {

        const hay = [
          m.SERIAL_NO,
          m.MACHINE_NAME,
          m.MODEL_NAME,
          m.MODEL_CODE,
          m.WO_NUMBER,
          m.CUSTOMER_NAME,
          m.LOCATION
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return hay.includes(q);
      });
    });

  }, [groups, search, statusFilter]);

  return (

    <div style={{ padding: 0 }}>

      <style>{`
        @keyframes machFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes machHeroShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {/* Hero header */}
      <div
        style={{
          background:
            "linear-gradient(135deg, #0e7490, #C8102E, #F4B324)",
          backgroundSize: "200% 200%",
          animation: "machHeroShift 18s ease infinite",
          color: "white",
          borderRadius: 20,
          padding: "28px 32px",
          marginBottom: 22,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16
        }}
      >
        <div style={{ flex: 1, minWidth: 280 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 2,
              textTransform: "uppercase",
              opacity: 0.85,
              fontWeight: 700
            }}
          >
            BVC24 · Machine Monitoring
          </div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 900,
              margin: "6px 0 8px",
              lineHeight: 1.15
            }}
          >
            Every built unit, live status — all in one board.
          </h1>
          <div style={{ fontSize: 13, opacity: 0.9, maxWidth: 620 }}>
            Each unit of every active work order auto-registers here.
            Flip status to <strong>Running / Idle / Down /
            Maintenance</strong> from the card — Down or Maintenance
            also fires a notification.
          </div>
        </div>
        <button
          onClick={runSync}
          disabled={syncing}
          style={{
            background: "rgba(255,255,255,0.95)",
            color: "#0f172a",
            border: "none",
            padding: "12px 22px",
            borderRadius: 12,
            fontWeight: 800,
            fontSize: 13,
            cursor: syncing ? "default" : "pointer",
            boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
            whiteSpace: "nowrap"
          }}
        >
          {syncing ? "Syncing…" : "🔄 Sync from Work Orders"}
        </button>
      </div>

      {/* Stat tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 14,
          marginBottom: 20
        }}
      >
        {[
          { label: "Total", value: machines.length, theme: { grad: "linear-gradient(135deg, #64748b, #334155)", glow: "rgba(100,116,139,0.25)", fg: "#0f172a" } },
          { label: "Running", value: counts.RUNNING, theme: STATUS_THEMES.RUNNING },
          { label: "Idle", value: counts.IDLE, theme: STATUS_THEMES.IDLE },
          { label: "Down", value: counts.DOWN, theme: STATUS_THEMES.DOWN },
          { label: "Maintenance", value: counts.MAINTENANCE, theme: STATUS_THEMES.MAINTENANCE }
        ].map((tile) => (
          <div
            key={tile.label}
            style={{
              background: "white",
              borderRadius: 14,
              padding: 18,
              boxShadow: `0 6px 20px ${tile.theme.glow}`,
              position: "relative",
              overflow: "hidden",
              border: "1px solid #e2e8f0"
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: tile.theme.grad
              }}
            />
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 1.5,
                color: "#64748b",
                textTransform: "uppercase"
              }}
            >
              {tile.label}
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 900,
                color: tile.theme.fg || "#0f172a",
                marginTop: 4,
                fontFamily: "ui-monospace, monospace"
              }}
            >
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div
        style={{
          background: "white",
          padding: 16,
          borderRadius: 14,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
          marginBottom: 16,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center"
        }}
      >
        <input
          type="text"
          placeholder="🔍 Search by serial, model, WO, customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 240,
            padding: "9px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 13,
            outline: "none"
          }}
        />

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["ALL", ...STATUS_OPTIONS].map((s) => {

            const active = statusFilter === s;

            const theme = STATUS_THEMES[s];

            return (

              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: "7px 14px",
                  border: active
                    ? "none"
                    : "1px solid #cbd5e1",
                  background: active
                    ? (theme?.grad || "linear-gradient(135deg, #475569, #334155)")
                    : "white",
                  color: active ? "white" : "#475569",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                  letterSpacing: 0.5,
                  textTransform: "uppercase"
                }}
              >
                {s === "ALL" ? "All" : theme?.label || s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cards grid */}
      {loading && (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "#94a3b8"
          }}
        >
          Loading machines…
        </div>
      )}

      {!loading && filteredGroups.length === 0 && (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "#475569",
            background: "white",
            borderRadius: 14,
            border: "1px dashed #cbd5e1"
          }}
        >
          <div style={{ fontSize: 30, marginBottom: 8 }}>🏭</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {groups.length === 0
              ? "No machines registered yet."
              : "No machines match the current filter."}
          </div>
          {groups.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "#94a3b8",
                marginTop: 6
              }}
            >
              Create a Work Order in Production & BOM — each unit
              auto-appears here after sync.
            </div>
          )}
        </div>
      )}

      {!loading && filteredGroups.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill, minmax(310px, 1fr))",
            gap: 16
          }}
        >
          {filteredGroups.map((g) => (
            <WOGroupCard
              key={g.key}
              group={g}
              onBatchStatus={batchUpdateStatus}
              onOpenLogs={setLogsGroup}
            />
          ))}
        </div>
      )}

      {logsGroup && (
        <LogsDrawer
          group={logsGroup}
          onClose={() => setLogsGroup(null)}
        />
      )}
    </div>
  );
}

export default Machines;
