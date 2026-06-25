import { useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./Machines.module.css";

const STATUS_OPTIONS = ["RUNNING", "IDLE", "DOWN", "MAINTENANCE"];

const STATUS_THEMES = {
  RUNNING: {
    bg: "#d1fae5",
    fg: "#065f46",
    border: "#10b981",
    glow: "rgba(16, 185, 129, 0.35)",
    icon: "🟢",
    label: "Running"
  },
  IDLE: {
    bg: "#e0e7ff",
    fg: "#3730a3",
    border: "#6366f1",
    glow: "rgba(99, 102, 241, 0.3)",
    icon: "⏸",
    label: "Idle"
  },
  DOWN: {
    bg: "#fee2e2",
    fg: "#991b1b",
    border: "#ef4444",
    glow: "rgba(239, 68, 68, 0.35)",
    icon: "⛔",
    label: "Down"
  },
  MAINTENANCE: {
    bg: "#fef3c7",
    fg: "#92400e",
    border: "#f59e0b",
    glow: "rgba(245, 158, 11, 0.3)",
    icon: "🛠",
    label: "Maintenance"
  },
  MIXED: {
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
      className={styles.statusPill}
      style={{ background: theme.bg, color: theme.fg }}
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

const STATUS_PRECEDENCE = ["DOWN", "MAINTENANCE", "IDLE", "RUNNING"];

function aggregateStatus(units) {

  if (!units.length) return "IDLE";

  const set = new Set(units.map((u) => u.STATUS));

  if (set.size === 1) return units[0].STATUS;

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

    <div className={styles.statusBreakdownRow}>
      {STATUS_OPTIONS.filter((s) => counts[s] > 0).map((s) => {

        const t = STATUS_THEMES[s];

        return (

          <span
            key={s}
            className={styles.statusBreakdownChip}
            style={{ background: t.bg, color: t.fg }}
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

  const lastUpdated = group.units.reduce((max, u) => {

    if (!u.LAST_UPDATED) return max;

    return !max || u.LAST_UPDATED > max ? u.LAST_UPDATED : max;

  }, null);

  const head = group.units[0];

  return (

    <div
      className={styles.groupCard}
      style={{ boxShadow: `0 12px 30px ${theme.glow}` }}
    >
      <div
        className={styles.cardStrip}
        style={{ background: theme.border }}
      />

      <div className={styles.cardHead}>
        <div className={styles.cardHeadLeft}>
          <div className={styles.woNumber}>
            {head.WO_NUMBER || head.SERIAL_NO || `MACHINE-${head.ID}`}
          </div>
          <div className={styles.modelName}>
            {head.MODEL_NAME || head.MACHINE_NAME}
          </div>
        </div>
        <StatusPill status={isMixed ? "MIXED" : aggregate} />
      </div>

      <div className={styles.badgeRow}>
        <span className={styles.badgeUnits}>
          × {group.units.length} unit{group.units.length > 1 ? "s" : ""}
        </span>
        {head.MODEL_CATEGORY && (
          <span className={styles.badgeCategory}>{head.MODEL_CATEGORY}</span>
        )}
        {head.MODEL_CODE && (
          <span className={styles.badgeCode}>{head.MODEL_CODE}</span>
        )}
      </div>

      {isMixed && <StatusBreakdown units={group.units} />}

      {head.CUSTOMER_NAME && (
        <div className={styles.customerRow}>🤝 {head.CUSTOMER_NAME}</div>
      )}

      <div className={styles.lastUpdated}>
        Last updated: {fmtTime(lastUpdated)}
      </div>

      {/* Batch status buttons */}
      <div className={styles.statusBtnGrid}>
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
              className={styles.cardStatusBtn}
              style={{
                border: allMatch ? "none" : `1px solid ${t.border}33`,
                background: allMatch ? t.border : isPending ? "var(--slate-400)" : "var(--card-bg)",
                color: allMatch ? "white" : t.fg,
                cursor: allMatch ? "default" : "pointer"
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
        className={styles.historyBtn}
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

    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerInfo}>
            <div className={styles.drawerWONum}>
              {head?.WO_NUMBER || head?.SERIAL_NO || "—"}
            </div>
            <div className={styles.drawerModelName}>
              {head?.MODEL_NAME || head?.MACHINE_NAME}
            </div>
            <div className={styles.drawerUnitCount}>
              {units.length} unit{units.length > 1 ? "s" : ""} in this batch
            </div>
          </div>
          <button onClick={onClose} className={styles.closeBtn}>×</button>
        </div>

        {units.length > 1 && (
          <div className={styles.unitChipList}>
            {units.map((u) => (
              <div key={u.ID} className={styles.unitChip}>
                <span className={styles.unitChipNum}>#{u.UNIT_NUMBER}</span>
                <StatusPill status={u.STATUS} />
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className={styles.drawerLoadingText}>Loading…</div>
        )}

        {!loading && logs.length === 0 && (
          <div className={styles.drawerEmptyText}>No history yet.</div>
        )}

        {!loading && logs.map((log) => {

          const theme =
            STATUS_THEMES[log.STATUS] || STATUS_THEMES.IDLE;

          return (

            <div key={log.ID} className={styles.logEntry}>
              <div
                className={styles.logBar}
                style={{ background: theme.border }}
              />
              <div className={styles.logBody}>
                <div className={styles.logMeta}>
                  <div className={styles.logLeft}>
                    <StatusPill status={log.STATUS} />
                    {log.UNIT_NUMBER && (
                      <span className={styles.logUnitBadge}>
                        Unit #{log.UNIT_NUMBER}
                      </span>
                    )}
                  </div>
                  <span className={styles.logTimestamp}>
                    {fmtTime(log.TIMESTAMP)}
                  </span>
                </div>
                {log.NOTE && (
                  <div className={styles.logNote}>{log.NOTE}</div>
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

  void updateStatus;

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

    const out = [...byKey.values()];

    out.forEach((g) => {

      g.units.sort(
        (a, b) => (a.UNIT_NUMBER || 0) - (b.UNIT_NUMBER || 0)
      );
    });

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

    <div className={styles.page}>

      {/* Hero header */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>Operations</div>
          <h1 className={styles.heroTitle}>Machines</h1>
        </div>

        <button
          onClick={runSync}
          disabled={syncing}
          className={styles.syncBtn}
        >
          {syncing ? "Syncing…" : "Sync from Work Orders"}
        </button>
      </div>

      {/* Stat tiles */}
      <div className={styles.tilesGrid}>
        {[
          { label: "Total",       value: machines.length,    border: "#475569", glow: "rgba(100,116,139,0.25)", fg: "var(--text-primary)" },
          { label: "Running",     value: counts.RUNNING,     ...STATUS_THEMES.RUNNING },
          { label: "Idle",        value: counts.IDLE,        ...STATUS_THEMES.IDLE },
          { label: "Down",        value: counts.DOWN,        ...STATUS_THEMES.DOWN },
          { label: "Maintenance", value: counts.MAINTENANCE, ...STATUS_THEMES.MAINTENANCE }
        ].map((tile) => (
          <div
            key={tile.label}
            className={styles.tile}
            style={{ boxShadow: `0 6px 20px ${tile.glow}` }}
          >
            <div
              className={styles.tileStrip}
              style={{ background: tile.border }}
            />
            <div className={styles.tileLabel}>{tile.label}</div>
            <div
              className={styles.tileValue}
              style={{ color: tile.fg }}
            >
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={styles.filtersBar}>
        <input
          type="text"
          placeholder="🔍 Search by serial, model, WO, customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.searchInput}
        />

        <div className={styles.statusFilters}>
          {["ALL", ...STATUS_OPTIONS].map((s) => {

            const active = statusFilter === s;

            const theme = STATUS_THEMES[s];

            return (

              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`${styles.statusBtn}${active ? ` ${styles.statusBtnActive}` : ""}`}
                style={active && theme ? { background: theme.border, borderColor: theme.border } : undefined}
              >
                {s === "ALL" ? "All" : theme?.label || s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cards grid */}
      {loading && (
        <div className={styles.loadingText}>Loading machines…</div>
      )}

      {!loading && filteredGroups.length === 0 && (
        <div className={styles.emptyBox}>
          <div className={styles.emptyIcon}>🏭</div>
          <div className={styles.emptyTitle}>
            {groups.length === 0
              ? "No machines registered yet."
              : "No machines match the current filter."}
          </div>
          {groups.length === 0 && (
            <div className={styles.emptySubtext}>
              Create a Work Order in Production & BOM — each unit
              auto-appears here after sync.
            </div>
          )}
        </div>
      )}

      {!loading && filteredGroups.length > 0 && (
        <div className={styles.cardsGrid}>
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
