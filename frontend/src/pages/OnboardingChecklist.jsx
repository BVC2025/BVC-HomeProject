// =====================================================================
// OnboardingChecklist — post-joining operational onboarding.
//
// Left:  Active joiner list with progress %.
// Right: Selected joiner's checklist + tabs for Assets / Training / Kit.
// =====================================================================

import { useEffect, useMemo, useState, useCallback } from "react";
import API from "../services/api";

const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BORDER   = "#e2e8f0";
const TEXT     = "#0f172a";
const MUTED    = "#64748b";

const CATEGORY_COLOR = {
  DOC:      "#0284c7",
  DEPT:     "#7c3aed",
  ROLE:     "#7c3aed",
  ASSET:    "#0891b2",
  TRAINING: "#d97706",
  KIT:      "#16a34a",
  OTHER:    "#64748b",
};


export default function OnboardingChecklist() {

  const [overview, setOverview]   = useState([]);
  const [selected, setSelected]   = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [assets, setAssets]       = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [kit, setKit]             = useState([]);
  const [tab, setTab]             = useState("checklist");
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [search, setSearch]       = useState("");
  const [onlyOpen, setOnlyOpen]   = useState(false);

  const [assetMasters, setAssetMasters]         = useState([]);
  const [trainingPrograms, setTrainingPrograms] = useState([]);
  const [kitItems, setKitItems]                 = useState([]);
  const [cataloguesOpen, setCataloguesOpen]     = useState(false);

  // ---------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------
  const loadOverview = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await API.get("/hr-onboarding/overview",
        { params: { only_in_progress: onlyOpen } });
      setOverview(data || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, [onlyOpen]);

  const loadMasters = useCallback(async () => {
    try {
      const [a, t, k] = await Promise.all([
        API.get("/hr-onboarding/masters/assets"),
        API.get("/hr-onboarding/masters/trainings"),
        API.get("/hr-onboarding/masters/kit"),
      ]);
      setAssetMasters(a.data || []);
      setTrainingPrograms(t.data || []);
      setKitItems(k.data || []);
    } catch { /* non-fatal */ }
  }, []);

  const loadEmployee = useCallback(async (empId) => {
    if (!empId) return;
    setSelected(empId);
    try {
      const [cl, a, t, k] = await Promise.all([
        API.get(`/hr-onboarding/employees/${empId}/checklist`),
        API.get(`/hr-onboarding/employees/${empId}/assets`),
        API.get(`/hr-onboarding/employees/${empId}/trainings`),
        API.get(`/hr-onboarding/employees/${empId}/kit`),
      ]);
      setChecklist(cl.data);
      setAssets(a.data || []);
      setTrainings(t.data || []);
      setKit(k.data || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load employee");
    }
  }, []);

  useEffect(() => { loadOverview(); loadMasters(); }, [loadOverview, loadMasters]);

  // Auto-select the first joiner if none selected
  useEffect(() => {
    if (!selected && overview.length > 0) loadEmployee(overview[0].employee_id);
  }, [overview, selected, loadEmployee]);

  // ---------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------
  const setItemStatus = async (item, status) => {
    try {
      await API.patch(
        `/hr-onboarding/employees/${selected}/checklist/${item.id}`,
        { status }
      );
      await loadEmployee(selected);
      await loadOverview();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to update");
    }
  };

  const allocateAsset = async (asset_master_id, serial_number) => {
    try {
      await API.post(`/hr-onboarding/employees/${selected}/assets`,
        { asset_master_id, serial_number });
      await loadEmployee(selected);
      await loadOverview();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to allocate");
    }
  };

  const returnAsset = async (alloc_id) => {
    if (!window.confirm("Mark this asset as returned?")) return;
    try {
      await API.post(`/hr-onboarding/employees/${selected}/assets/${alloc_id}/return`);
      await loadEmployee(selected);
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const assignTraining = async (training_program_id) => {
    try {
      await API.post(`/hr-onboarding/employees/${selected}/trainings`,
        { training_program_id });
      await loadEmployee(selected);
      await loadOverview();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to assign");
    }
  };

  const completeTraining = async (tid) => {
    try {
      await API.post(`/hr-onboarding/employees/${selected}/trainings/${tid}/complete`);
      await loadEmployee(selected);
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const issueKit = async (welcome_kit_item_id) => {
    try {
      await API.post(`/hr-onboarding/employees/${selected}/kit`,
        { welcome_kit_item_id });
      await loadEmployee(selected);
      await loadOverview();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed");
    }
  };

  const seedDefaultKit = async () => {
    try {
      await API.post(`/hr-onboarding/employees/${selected}/kit/seed-defaults`);
      await loadEmployee(selected);
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed");
    }
  };

  // ---------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------
  const filteredOverview = useMemo(() => {
    if (!search.trim()) return overview;
    const q = search.toLowerCase();
    return overview.filter((r) =>
      (r.employee_name || "").toLowerCase().includes(q) ||
      (r.employee_code || "").toLowerCase().includes(q) ||
      (r.department    || "").toLowerCase().includes(q)
    );
  }, [overview, search]);

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  return (
    <div style={{ padding: 18, color: TEXT }}>

      <PageHero onManageCatalogues={() => setCataloguesOpen(true)} />

      <SummaryTiles overview={overview} />

      {cataloguesOpen && (
        <CataloguesModal
          assets={assetMasters}
          trainings={trainingPrograms}
          kit={kitItems}
          onClose={() => setCataloguesOpen(false)}
          onChanged={loadMasters}
        />
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: 16,
        alignItems: "flex-start",
        marginTop: 14,
      }}>

        {/* ============== LEFT: joiner list ============== */}
        <div style={{
          background: "white", border: `1px solid ${BORDER}`,
          borderRadius: 12, padding: 12,
          maxHeight: "calc(100dvh - 280px)", overflowY: "auto",
        }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search joiner..."
              style={{
                flex: 1, padding: "8px 10px",
                border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13,
              }}
            />
            <button
              onClick={() => setOnlyOpen((v) => !v)}
              title={onlyOpen ? "Show all" : "Show only in-progress"}
              style={{
                padding: "8px 10px",
                background: onlyOpen ? BVC_RED : "white",
                color: onlyOpen ? "white" : MUTED,
                border: `1px solid ${onlyOpen ? BVC_RED : BORDER}`,
                borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}
            >
              {onlyOpen ? "ONLY OPEN" : "ALL"}
            </button>
          </div>

          {loading && <Empty msg="Loading…" />}
          {error && <Empty msg={error} kind="error" />}
          {!loading && filteredOverview.length === 0 && (
            <Empty msg="No employees found." />
          )}

          {filteredOverview.map((r) => (
            <JoinerCard
              key={r.employee_id}
              row={r}
              active={r.employee_id === selected}
              onClick={() => loadEmployee(r.employee_id)}
            />
          ))}
        </div>

        {/* ============== RIGHT: detail ============== */}
        <div>
          {!checklist && (
            <div style={{
              background: "white", border: `1px solid ${BORDER}`,
              borderRadius: 12, padding: 28, textAlign: "center", color: MUTED,
            }}>
              Select a joiner on the left.
            </div>
          )}

          {checklist && (
            <>
              <JoinerHeader summary={checklist} />

              <TabBar
                tab={tab} setTab={setTab}
                counts={{
                  checklist: `${checklist.done_items}/${checklist.total_items}`,
                  assets:    assets.length,
                  trainings: trainings.length,
                  kit:       kit.length,
                }}
              />

              {tab === "checklist" && (
                <ChecklistPanel
                  items={checklist.items}
                  onMark={(item, status) => setItemStatus(item, status)}
                />
              )}

              {tab === "assets" && (
                <AssetsPanel
                  rows={assets}
                  masters={assetMasters}
                  onAllocate={allocateAsset}
                  onReturn={returnAsset}
                />
              )}

              {tab === "trainings" && (
                <TrainingsPanel
                  rows={trainings}
                  programs={trainingPrograms}
                  onAssign={assignTraining}
                  onComplete={completeTraining}
                />
              )}

              {tab === "kit" && (
                <KitPanel
                  rows={kit}
                  items={kitItems}
                  onIssue={issueKit}
                  onSeed={seedDefaultKit}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Sub-components
// =====================================================================

function PageHero({ onManageCatalogues }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${BVC_RED} 0%, ${BVC_DARK} 100%)`,
      color: "white", padding: "20px 24px", borderRadius: 14,
      marginBottom: 14, boxShadow: "0 4px 14px rgba(139,11,31,0.18)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexWrap: "wrap", gap: 14,
    }}>
      <div>
        <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
          HR · NEW JOINERS
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
          Onboarding Checklist
        </div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
          Documents · Assets · Training · Welcome Kit · Department & Role
        </div>
      </div>
      <button
        onClick={onManageCatalogues}
        style={{
          background: "white", color: BVC_DARK, border: "none",
          padding: "10px 18px", borderRadius: 8,
          fontSize: 12, fontWeight: 800, letterSpacing: 0.6,
          textTransform: "uppercase", cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}
      >
        + Manage Catalogues
      </button>
    </div>
  );
}


function SummaryTiles({ overview }) {
  const total      = overview.length;
  const complete   = overview.filter((r) => r.status === "COMPLETE").length;
  const inProgress = overview.filter((r) => r.status === "IN_PROGRESS").length;
  const notStarted = overview.filter((r) => r.status === "NOT_STARTED").length;
  const avg        = total
    ? Math.round(overview.reduce((s, r) => s + r.completion_pct, 0) / total)
    : 0;
  const tiles = [
    { label: "Active joiners",  value: total,      accent: "#0f172a" },
    { label: "Complete",        value: complete,   accent: "#16a34a" },
    { label: "In progress",     value: inProgress, accent: "#d97706" },
    { label: "Not started",     value: notStarted, accent: "#94a3b8" },
    { label: "Avg completion",  value: `${avg}%`,  accent: BVC_RED },
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10,
    }}>
      {tiles.map((t) => (
        <div key={t.label} style={{
          background: "white", border: `1px solid ${BORDER}`,
          borderLeft: `4px solid ${t.accent}`,
          borderRadius: 10, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 10, letterSpacing: 1.2, color: MUTED, fontWeight: 700 }}>
            {t.label.toUpperCase()}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: TEXT }}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}


function JoinerCard({ row, active, onClick }) {
  const pct = row.completion_pct;
  const statusColor =
    row.status === "COMPLETE"    ? "#16a34a" :
    row.status === "NOT_STARTED" ? "#94a3b8" : "#d97706";
  return (
    <div onClick={onClick} style={{
      padding: 10, borderRadius: 10, cursor: "pointer", marginBottom: 6,
      border: `1px solid ${active ? BVC_RED : "#f1f5f9"}`,
      background: active ? "#fef2f4" : "white",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 800, color: TEXT,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {row.employee_name}
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>
            {row.employee_code}{row.department ? ` · ${row.department}` : ""}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 800, color: statusColor,
          padding: "2px 8px", borderRadius: 999,
          background: statusColor + "1a",
        }}>
          {pct}%
        </span>
      </div>
      <ProgressBar pct={pct} />
    </div>
  );
}


function JoinerHeader({ summary }) {
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`, borderRadius: 12,
      padding: "14px 18px", marginBottom: 10,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexWrap: "wrap", gap: 12,
    }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>
          {summary.employee_name}
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          {summary.employee_code}
          {summary.department  && ` · ${summary.department}`}
          {summary.designation && ` · ${summary.designation}`}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: BVC_RED }}>
          {summary.completion_pct}%
        </div>
        <div style={{ fontSize: 11, color: MUTED }}>
          {summary.done_items} of {summary.total_items} complete
        </div>
      </div>
    </div>
  );
}


function TabBar({ tab, setTab, counts }) {
  const tabs = [
    { key: "checklist", label: "Checklist", badge: counts.checklist },
    { key: "assets",    label: "Assets",    badge: counts.assets },
    { key: "trainings", label: "Training",  badge: counts.trainings },
    { key: "kit",       label: "Welcome Kit", badge: counts.kit },
  ];
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`,
      borderRadius: 12, padding: 6, marginBottom: 10,
      display: "flex", gap: 4, overflowX: "auto",
    }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => setTab(t.key)}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "none",
            background: t.key === tab ? BVC_RED : "transparent",
            color: t.key === tab ? "white" : MUTED,
            fontSize: 12, fontWeight: 700, letterSpacing: 0.6,
            textTransform: "uppercase", cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t.label}
          {t.badge != null && t.badge !== 0 && (
            <span style={{
              marginLeft: 8, fontSize: 10,
              padding: "1px 7px", borderRadius: 999,
              background: t.key === tab ? "rgba(255,255,255,0.25)" : "#f1f5f9",
              color: t.key === tab ? "white" : MUTED,
            }}>{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}


function ChecklistPanel({ items, onMark }) {
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, padding: 8 }}>
      {items.map((it) => {
        const cat = CATEGORY_COLOR[it.category] || "#64748b";
        const done = it.status === "DONE";
        const skipped = it.status === "SKIPPED";
        return (
          <div key={it.id} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 12px", borderBottom: `1px solid #f8fafc`,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14,
              background: cat + "1a", color: cat,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 800, flexShrink: 0,
            }}>{it.category[0]}</div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: TEXT,
                textDecoration: skipped ? "line-through" : "none",
                opacity: skipped ? 0.6 : 1,
              }}>
                {it.label}
              </div>
              <div style={{ fontSize: 11, color: MUTED }}>
                {done ? `Completed ${it.completed_date || ""}` :
                 skipped ? "Skipped" : "Pending"}
              </div>
            </div>

            <div style={{ display: "flex", gap: 4 }}>
              {!done && (
                <button onClick={() => onMark(it, "DONE")} style={btnPill("#16a34a")}>
                  Mark done
                </button>
              )}
              {done && (
                <button onClick={() => onMark(it, "PENDING")} style={btnPill("#94a3b8", true)}>
                  Reopen
                </button>
              )}
              {!skipped && !done && (
                <button onClick={() => onMark(it, "SKIPPED")} style={btnPill("#64748b", true)}>
                  Skip
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function AssetsPanel({ rows, masters, onAllocate, onReturn }) {
  const [assetId, setAssetId] = useState("");
  const [serial,  setSerial]  = useState("");
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)}
          style={selectStyle}>
          <option value="">— Select asset —</option>
          {masters.filter((m) => m.is_active).map((m) => (
            <option key={m.id} value={m.id}>{m.category} · {m.name}</option>
          ))}
        </select>
        <input
          value={serial} onChange={(e) => setSerial(e.target.value)}
          placeholder="Serial / asset tag (optional)"
          style={inputStyle}
        />
        <button
          disabled={!assetId}
          onClick={() => { onAllocate(Number(assetId), serial); setAssetId(""); setSerial(""); }}
          style={btnPrimary(!assetId)}
        >
          Allocate
        </button>
      </div>
      {rows.length === 0 && <Empty msg="No assets allocated yet." />}
      {rows.map((r) => (
        <Row key={r.id}
          title={`${r.asset_category} · ${r.asset_name}`}
          sub={r.serial_number ? `Serial: ${r.serial_number}` : ""}
          date={r.issued_date}
          status={r.status}
          action={r.status === "ISSUED" && (
            <button onClick={() => onReturn(r.id)} style={btnPill("#dc2626", true)}>
              Return
            </button>
          )}
        />
      ))}
    </div>
  );
}


function TrainingsPanel({ rows, programs, onAssign, onComplete }) {
  const [progId, setProgId] = useState("");
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={progId} onChange={(e) => setProgId(e.target.value)}
          style={selectStyle}>
          <option value="">— Select training —</option>
          {programs.filter((p) => p.is_active).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.is_mandatory ? " · MANDATORY" : ""}
            </option>
          ))}
        </select>
        <button
          disabled={!progId}
          onClick={() => { onAssign(Number(progId)); setProgId(""); }}
          style={btnPrimary(!progId)}
        >
          Assign
        </button>
      </div>
      {rows.length === 0 && <Empty msg="No training assigned yet." />}
      {rows.map((r) => (
        <Row key={r.id}
          title={r.training_name}
          sub={r.due_date ? `Due ${r.due_date}` : ""}
          date={r.completed_date || r.assigned_date}
          status={r.status}
          action={r.status !== "COMPLETED" && (
            <button onClick={() => onComplete(r.id)} style={btnPill("#16a34a")}>
              Mark complete
            </button>
          )}
        />
      ))}
    </div>
  );
}


function KitPanel({ rows, items, onIssue, onSeed }) {
  const [itemId, setItemId] = useState("");
  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`,
                  borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}
          style={selectStyle}>
          <option value="">— Select kit item —</option>
          {items.filter((m) => m.is_active).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button
          disabled={!itemId}
          onClick={() => { onIssue(Number(itemId)); setItemId(""); }}
          style={btnPrimary(!itemId)}
        >
          Issue
        </button>
        <button onClick={onSeed} style={btnSecondary}>
          + Default kit
        </button>
      </div>
      {rows.length === 0 && <Empty msg="No kit items tracked yet. Click + Default kit." />}
      {rows.map((r) => (
        <Row key={r.id}
          title={r.item_name}
          sub=""
          date={r.issued_date}
          status={r.status}
        />
      ))}
    </div>
  );
}


// ---------------------------------------------------------------------
// Catalogues modal — HR-only master-data management
// ---------------------------------------------------------------------

function CataloguesModal({ assets, trainings, kit, onClose, onChanged }) {
  const [tab, setTab] = useState("assets");

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
      backdropFilter: "blur(2px)", zIndex: 2000,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "white", borderRadius: 16, width: "100%", maxWidth: 720,
        maxHeight: "90dvh", display: "flex", flexDirection: "column",
        overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", padding: "14px 18px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>
              HR · MASTER DATA
            </div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>
              Manage Onboarding Catalogues
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.18)", color: "white",
            border: "none", padding: "6px 12px", borderRadius: 6,
            fontSize: 13, fontWeight: 800, cursor: "pointer",
          }}>×  Close</button>
        </div>

        {/* Tabs */}
        <div style={{
          background: "white", padding: 6, borderBottom: `1px solid ${BORDER}`,
          display: "flex", gap: 4,
        }}>
          {[
            { key: "assets",    label: "Assets",      count: assets.length },
            { key: "trainings", label: "Trainings",   count: trainings.length },
            { key: "kit",       label: "Welcome Kit", count: kit.length },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                padding: "8px 14px", borderRadius: 8, border: "none",
                background: t.key === tab ? BVC_RED : "transparent",
                color: t.key === tab ? "white" : MUTED,
                fontSize: 12, fontWeight: 700, letterSpacing: 0.6,
                textTransform: "uppercase", cursor: "pointer",
              }}
            >
              {t.label}
              <span style={{
                marginLeft: 8, fontSize: 10,
                padding: "1px 7px", borderRadius: 999,
                background: t.key === tab ? "rgba(255,255,255,0.25)" : "#f1f5f9",
                color: t.key === tab ? "white" : MUTED,
              }}>{t.count}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {tab === "assets"    && <AssetsCatalogue    rows={assets}    onChanged={onChanged} />}
          {tab === "trainings" && <TrainingsCatalogue rows={trainings} onChanged={onChanged} />}
          {tab === "kit"       && <KitCatalogue       rows={kit}       onChanged={onChanged} />}
        </div>
      </div>
    </div>
  );
}


function AssetsCatalogue({ rows, onChanged }) {
  const [name, setName]         = useState("");
  const [category, setCategory] = useState("LAPTOP");
  const [busy, setBusy]         = useState(false);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await API.post("/hr-onboarding/masters/assets",
        { name: name.trim(), category, description: null, is_active: true });
      setName("");
      await onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to add");
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Deactivate this asset type?")) return;
    try {
      await API.delete(`/hr-onboarding/masters/assets/${id}`);
      await onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div>
      <div style={catFormStyle}>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Asset name (e.g. Dell Latitude laptop)"
          style={{ ...inputStyle, flex: "2 1 200px" }}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          style={selectStyle}>
          {["LAPTOP", "PHONE", "ID_CARD", "LOCKER", "TOOL", "VEHICLE", "OTHER"]
            .map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={add} disabled={!name.trim() || busy} style={btnPrimary(!name.trim() || busy)}>
          {busy ? "Adding…" : "+ Add"}
        </button>
      </div>
      {rows.length === 0 && <Empty msg="No asset types yet. Add one above." />}
      {rows.map((r) => (
        <CatalogueRow key={r.id}
          primary={r.name}
          secondary={`${r.category}${r.description ? " · " + r.description : ""}`}
          inactive={!r.is_active}
          onDelete={() => remove(r.id)}
        />
      ))}
    </div>
  );
}


function TrainingsCatalogue({ rows, onChanged }) {
  const [name, setName]         = useState("");
  const [days, setDays]         = useState(1);
  const [mandatory, setMandatory] = useState(false);
  const [busy, setBusy]         = useState(false);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await API.post("/hr-onboarding/masters/trainings", {
        name: name.trim(), description: null,
        duration_days: Number(days) || 1,
        is_mandatory: mandatory, is_active: true,
      });
      setName(""); setDays(1); setMandatory(false);
      await onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to add");
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Deactivate this training program?")) return;
    try {
      await API.delete(`/hr-onboarding/masters/trainings/${id}`);
      await onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div>
      <div style={catFormStyle}>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Training name (e.g. Day-1 Induction)"
          style={{ ...inputStyle, flex: "2 1 200px" }}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <input type="number" min="1" value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="Days"
          style={{ ...inputStyle, flex: "0 0 80px" }} />
        <label style={{ display: "inline-flex", alignItems: "center",
                        gap: 6, fontSize: 12, color: MUTED, padding: "0 8px" }}>
          <input type="checkbox" checked={mandatory}
            onChange={(e) => setMandatory(e.target.checked)} />
          Mandatory
        </label>
        <button onClick={add} disabled={!name.trim() || busy} style={btnPrimary(!name.trim() || busy)}>
          {busy ? "Adding…" : "+ Add"}
        </button>
      </div>
      {rows.length === 0 && <Empty msg="No training programs yet. Add one above." />}
      {rows.map((r) => (
        <CatalogueRow key={r.id}
          primary={r.name}
          secondary={`${r.duration_days} day(s)${r.is_mandatory ? " · MANDATORY" : ""}`}
          inactive={!r.is_active}
          onDelete={() => remove(r.id)}
        />
      ))}
    </div>
  );
}


function KitCatalogue({ rows, onChanged }) {
  const [name, setName]   = useState("");
  const [isDef, setIsDef] = useState(true);
  const [busy, setBusy]   = useState(false);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await API.post("/hr-onboarding/masters/kit", {
        name: name.trim(), description: null,
        is_default: isDef, is_active: true,
      });
      setName(""); setIsDef(true);
      await onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to add");
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Deactivate this kit item?")) return;
    try {
      await API.delete(`/hr-onboarding/masters/kit/${id}`);
      await onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div>
      <div style={catFormStyle}>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Item name (e.g. BVC24 T-shirt)"
          style={{ ...inputStyle, flex: "2 1 200px" }}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <label style={{ display: "inline-flex", alignItems: "center",
                        gap: 6, fontSize: 12, color: MUTED, padding: "0 8px" }}>
          <input type="checkbox" checked={isDef}
            onChange={(e) => setIsDef(e.target.checked)} />
          Default kit
        </label>
        <button onClick={add} disabled={!name.trim() || busy} style={btnPrimary(!name.trim() || busy)}>
          {busy ? "Adding…" : "+ Add"}
        </button>
      </div>
      {rows.length === 0 && <Empty msg="No kit items yet. Add one above." />}
      {rows.map((r) => (
        <CatalogueRow key={r.id}
          primary={r.name}
          secondary={r.is_default ? "Default · auto-added to every joiner" : "Optional"}
          inactive={!r.is_active}
          onDelete={() => remove(r.id)}
        />
      ))}
    </div>
  );
}


function CatalogueRow({ primary, secondary, inactive, onDelete }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", borderBottom: "1px solid #f8fafc",
      opacity: inactive ? 0.45 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: TEXT,
          textDecoration: inactive ? "line-through" : "none",
        }}>{primary}</div>
        <div style={{ fontSize: 11, color: MUTED }}>{secondary}</div>
      </div>
      {inactive
        ? <span style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>INACTIVE</span>
        : <button onClick={onDelete} style={btnPill("#dc2626", true)}>Deactivate</button>}
    </div>
  );
}

const catFormStyle = {
  display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap",
  background: "#fafbfc", border: `1px solid ${BORDER}`,
  borderRadius: 10, padding: 10,
};


// ---------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------

function ProgressBar({ pct }) {
  return (
    <div style={{
      height: 6, background: "#f1f5f9", borderRadius: 999, marginTop: 8,
      overflow: "hidden",
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, pct))}%`,
        height: "100%",
        background: pct >= 100 ? "#16a34a" : BVC_RED,
        transition: "width 0.25s",
      }} />
    </div>
  );
}

function Row({ title, sub, date, status, action }) {
  const color = STATUS_COLOR[status] || "#64748b";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 8px", borderBottom: "1px solid #f8fafc",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: MUTED }}>{sub}</div>}
        {date && <div style={{ fontSize: 11, color: MUTED }}>{date}</div>}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 800, padding: "2px 8px",
        background: color + "1a", color, borderRadius: 999,
      }}>{status}</span>
      {action}
    </div>
  );
}

function Empty({ msg, kind }) {
  return (
    <div style={{
      padding: 18, textAlign: "center", color: kind === "error" ? "#991b1b" : MUTED,
      fontSize: 13, fontStyle: "italic",
    }}>{msg}</div>
  );
}


const STATUS_COLOR = {
  PENDING:    "#d97706",
  ISSUED:     "#0891b2",
  RETURNED:   "#16a34a",
  ASSIGNED:   "#0284c7",
  IN_PROGRESS:"#d97706",
  COMPLETED:  "#16a34a",
  SKIPPED:    "#64748b",
  DECLINED:   "#dc2626",
  LOST:       "#dc2626",
  DAMAGED:    "#dc2626",
};

const inputStyle = {
  flex: "1 1 200px", padding: "8px 10px",
  border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13,
};
const selectStyle = {
  flex: "1 1 200px", padding: "8px 10px",
  border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13,
  background: "white",
};
function btnPrimary(disabled) {
  return {
    padding: "8px 16px",
    background: disabled ? "#cbd5e1" : BVC_RED,
    color: "white", border: "none", borderRadius: 8,
    fontSize: 12, fontWeight: 800, letterSpacing: 0.5,
    cursor: disabled ? "default" : "pointer",
  };
}
const btnSecondary = {
  padding: "8px 12px", background: "white", color: BVC_RED,
  border: `1px solid ${BVC_RED}`, borderRadius: 8,
  fontSize: 12, fontWeight: 700, cursor: "pointer",
};
function btnPill(color, ghost) {
  return {
    padding: "5px 10px",
    background: ghost ? "white" : color,
    color: ghost ? color : "white",
    border: `1px solid ${color}`,
    borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
  };
}
