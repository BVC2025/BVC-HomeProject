import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";

import EntityDrawer from "../components/EntityDrawer";

import { bomIconTileStyle } from "../utils/bomIcons";

import styles from "./Production.module.css";


const STATUS_COLORS = {
  PLANNED: { bg: "#dbeafe", fg: "#1e40af" },
  IN_PROGRESS: { bg: "#fef3c7", fg: "#854d0e" },
  ON_HOLD: { bg: "#f1f5f9", fg: "#475569" },
  DONE: { bg: "#dcfce7", fg: "#166534" },
  CANCELLED: { bg: "#fee2e2", fg: "#b91c1c" }
};


// ----------------------------------------------------------------
// Stat tile
// ----------------------------------------------------------------

function Tile({ label, value, sub, color }) {

  return (

    <div
      className={styles.tile}
      style={{ borderTop: `3px solid ${color}` }}
    >

      <div className={styles.tileLabel}>
        {label}
      </div>

      <div className={styles.tileValue}>
        {value}
      </div>

      {sub && (
        <div className={styles.tileSub}>
          {sub}
        </div>
      )}
    </div>
  );
}


function StatusBadge({ status }) {

  const t = STATUS_COLORS[status] || STATUS_COLORS.PLANNED;

  return (

    <span
      className={styles.statusBadge}
      style={{ background: t.bg, color: t.fg }}
    >
      {status?.replaceAll("_", " ")}
    </span>
  );
}


// ----------------------------------------------------------------
// Dashboard tab
// ----------------------------------------------------------------

function DashboardTab() {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const fetchDashboard = async () => {

    setLoading(true);

    try {

      const res = await API.get("/production/dashboard", {
        params: { vendor_id: 1 }
      });

      setData(res.data);

    } catch (e) {

      setData(null);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchDashboard();

  }, []);

  if (loading) return <div className={styles.loadingText}>Loading…</div>;

  if (!data) return <div className={styles.errorText}>Could not load dashboard.</div>;

  return (

    <div>

      <div className={styles.dashTileGrid}>

        <Tile
          label="Total Work Orders"
          value={data.total_work_orders}
          color="#1e40af"
        />

        <Tile
          label="Units In Progress"
          value={data.total_units_in_progress}
          sub="across all WOs"
          color="#f59e0b"
        />

        <Tile
          label="Planned"
          value={data.by_status?.PLANNED ?? 0}
          color="#3b82f6"
        />

        <Tile
          label="Done"
          value={data.by_status?.DONE ?? 0}
          color="#22c55e"
        />
      </div>

      <div className={styles.card}>

        <div className={styles.sectionLabel}>
          Top Active Models (units in pipeline)
        </div>

        {(!data.top_active_models || data.top_active_models.length === 0) && (

          <div className={styles.emptyText}>
            No active work orders. Create one in the Work Orders tab.
          </div>
        )}

        {data.top_active_models?.map((m) => (

          <div
            key={m.MODEL_ID}
            className={styles.modelRow}
          >

            <div className={styles.flex1}>

              <div className={styles.modelRowName}>
                {m.MODEL_NAME}
              </div>

              <div className={styles.modelRowCode}>
                {m.MODEL_CODE}
              </div>
            </div>

            <div className={styles.modelRowUnits}>
              {m.units}
            </div>

            <div className={styles.modelRowUnitsLabel}>
              units
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Models tab
// ----------------------------------------------------------------

// Single BOM row in the Production page model drawer. Renders the
// Excel-style layout (preview | item no | part name | qty) plus a
// file picker to upload/replace the line's image. Also supports
// inline edit of QUANTITY/UNIT and a delete action.
function BomEditableRow({ item, onUploaded, onChanged }) {

  const [uploading, setUploading] = useState(false);

  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);

  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const [draft, setDraft] = useState({
    MATERIAL_NAME: item.MATERIAL_NAME || "",
    QUANTITY: item.QUANTITY ?? 1,
    UNIT: item.UNIT || "pcs",
  });

  const fileInputId = `bom-img-${item.ID}`;

  const saveEdit = async () => {
    if (!draft.MATERIAL_NAME.trim()) {
      setError("Material name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await API.patch(`/production/bom/${item.ID}`, {
        QUANTITY: Number(draft.QUANTITY) || 0,
        UNIT: draft.UNIT || "pcs",
      });
      // MATERIAL_NAME edit isn't supported by the PATCH schema
      // (it's intentionally read-only post-create — change material
      // by deleting and adding a new line).
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const removeLine = async () => {
    if (!window.confirm(`Delete BOM line "${item.MATERIAL_NAME}"?`)) return;
    setDeleting(true);
    try {
      await API.delete(`/production/bom/${item.ID}`);
      onChanged?.();
    } catch (err) {
      alert(err?.response?.data?.detail || "Delete failed");
      setDeleting(false);
    }
  };

  const isPurchase = (item.ITEM_TYPE || "PURCHASE") === "PURCHASE";

  const imageUrl = item.IMAGE_URL
    ? `${API_BASE_URL}${item.IMAGE_URL}`
    : null;

  const handleFile = async (e) => {

    const file = e.target.files?.[0];

    if (!file) return;

    setUploading(true);

    setError("");

    try {

      const fd = new FormData();

      fd.append("file", file);

      await API.post(
        `/production/bom/${item.ID}/upload-image`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      onUploaded?.();

    } catch (err) {

      setError(err?.response?.data?.detail || "Upload failed");

    } finally {

      setUploading(false);

      e.target.value = "";
    }
  };

  return (

    <tr className={styles.bomRow}>

      {/* Preview cell */}
      <td className={styles.bomCellPreview}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.MATERIAL_NAME}
            className={styles.bomPreviewImg}
          />
        ) : (() => {

          const tile = bomIconTileStyle(item.MATERIAL_NAME, 76);

          return (

            <div
              style={tile.container}
              title={tile.label}
            >
              {tile.icon}
            </div>
          );
        })()}
      </td>

      {/* Item No */}
      <td className={styles.bomCellItemNo}>
        {item.ITEM_NO ?? "—"}
      </td>

      {/* Part Number + meta */}
      <td className={styles.bomCellPart}>
        <div className={styles.bomPartName}>
          {item.MATERIAL_NAME}
        </div>
        <div className={styles.bomPartMeta}>
          <span className={isPurchase ? styles.bomBadgePurchase : styles.bomBadgeProcess}>
            {isPurchase ? "PURCHASE" : "PROCESS"}
          </span>
          {isPurchase && item.PREFERRED_SUPPLIER_NAME && (
            <span className={styles.bomMetaText}>
              🏢 {item.PREFERRED_SUPPLIER_NAME}
            </span>
          )}
          {isPurchase && !item.PREFERRED_SUPPLIER_NAME && (
            <span className={styles.bomMetaNoSupplier}>
              No supplier set
            </span>
          )}
          {!isPurchase && (
            <span className={styles.bomMetaText}>
              Stage: {item.PROCESS_STAGE_NAME || "—"}
            </span>
          )}
        </div>
      </td>

      {/* Qty */}
      <td className={styles.bomCellQty}>
        {item.QUANTITY}
        <div className={styles.bomQtyUnit}>
          {item.UNIT}
        </div>
      </td>

      {/* Upload control */}
      <td className={styles.bomCellUpload}>
        <input
          id={fileInputId}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className={styles.hiddenInput}
        />
        <label
          htmlFor={fileInputId}
          className={styles.bomUploadLabel}
          style={{
            background: uploading ? "#cbd5e1" : "#eef2ff",
            color: uploading ? "#94a3b8" : "#4338ca",
            cursor: uploading ? "default" : "pointer",
            pointerEvents: uploading ? "none" : "auto"
          }}
        >
          {uploading ? "Uploading…" : imageUrl ? "🔄 Replace" : "📷 Upload"}
        </label>
        {error && (
          <div className={styles.bomUploadError}>
            {error}
          </div>
        )}
      </td>

    </tr>
  );
}


// Inline form for adding a new BOM line. Sits above the table.
function BomAddForm({ modelId, onAdded }) {

  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    MATERIAL_NAME: "",
    QUANTITY: 1,
    UNIT: "pcs",
    NOTES: "",
  });

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  const reset = () => {
    setForm({ MATERIAL_NAME: "", QUANTITY: 1, UNIT: "pcs", NOTES: "" });
    setError("");
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.MATERIAL_NAME.trim()) {
      setError("Material name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await API.post(`/production/models/${modelId}/bom`, {
        MATERIAL_NAME: form.MATERIAL_NAME.trim(),
        QUANTITY: Number(form.QUANTITY) || 1,
        UNIT: form.UNIT.trim() || "pcs",
        NOTES: form.NOTES.trim() || null,
      });
      reset();
      setOpen(false);
      onAdded?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Add failed");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div style={{ marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: "7px 14px",
            background: "#0f172a",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          + Add line
        </button>
      </div>
    );
  }

  const inputStyle = {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <form
      onSubmit={submit}
      style={{
        marginBottom: 12,
        padding: 12,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
      }}
    >
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        color: "#475569",
        textTransform: "uppercase",
        marginBottom: 8,
      }}>
        New BOM line
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "2fr 70px 70px",
        gap: 8,
        marginBottom: 8,
      }}>
        <input
          autoFocus
          type="text"
          value={form.MATERIAL_NAME}
          onChange={(e) => setForm({ ...form, MATERIAL_NAME: e.target.value })}
          placeholder="Material name (e.g. SMPS 24V 10A)"
          style={inputStyle}
        />
        <input
          type="number"
          min="0"
          step="0.5"
          value={form.QUANTITY}
          onChange={(e) => setForm({ ...form, QUANTITY: e.target.value })}
          placeholder="Qty"
          style={inputStyle}
        />
        <input
          type="text"
          value={form.UNIT}
          onChange={(e) => setForm({ ...form, UNIT: e.target.value })}
          placeholder="pcs / m / kg"
          style={inputStyle}
        />
      </div>

      <input
        type="text"
        value={form.NOTES}
        onChange={(e) => setForm({ ...form, NOTES: e.target.value })}
        placeholder="Notes (optional)"
        style={{ ...inputStyle, marginBottom: 8 }}
      />

      {error && (
        <div style={{
          padding: "6px 10px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 6,
          fontSize: 12,
          marginBottom: 8,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false); }}
          style={{
            padding: "7px 14px",
            background: "white",
            color: "#475569",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "7px 16px",
            background: saving ? "#94a3b8" : "#0f172a",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 12,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Adding…" : "Add line"}
        </button>
      </div>
    </form>
  );
}


function ModelDetailDrawer({ modelId, onClose, refetchSignal = 0 }) {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const refetch = () => {

    if (!modelId) return;

    setLoading(true);

    API.get(`/production/models/${modelId}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    refetch();

  }, [modelId, refetchSignal]);

  if (!modelId) return null;

  const m = data?.model;

  const bom = data?.bom || [];

  return (

    <div
      className={styles.drawerOverlay}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.drawerPanel}
      >

        <div className={styles.drawerHeader}>

          <div>

            <div className={styles.drawerTitle}>
              {m?.MODEL_NAME || "Loading…"}
            </div>

            <div className={styles.drawerMeta}>
              {m?.MODEL_CODE}
              {m?.CATEGORY && (
                <span className={styles.drawerMetaCategory}>
                  · {m.CATEGORY}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className={styles.drawerCloseBtn}
          >
            ×
          </button>
        </div>

        {m?.DESCRIPTION && (

          <div className={styles.drawerDesc}>
            {m.DESCRIPTION}
          </div>
        )}

        {m && (

          <div className={styles.drawerTileGrid}>
            <Tile
              label="Est. Build Days"
              value={m.ESTIMATED_BUILD_DAYS}
              color="#3b82f6"
            />
            <Tile
              label="BOM Items"
              value={data?.bom_item_count ?? 0}
              color="#7c3aed"
            />
          </div>
        )}

        <div className={styles.sectionLabel}>
          Bill of Materials
        </div>

        {loading && <div className={styles.loadingText}>Loading BOM…</div>}

        {!loading && bom.length === 0 && (

          <div className={styles.emptyText}>
            No BOM items yet.
          </div>
        )}

        {bom.length > 0 && (

          <table className={styles.bomTable}>
            <thead className={styles.bomThead}>
              <tr>
                <th className={styles.bomTh} style={{ width: 90 }}>
                  Document Preview
                </th>
                <th className={styles.bomTh} style={{ width: 70 }}>
                  Item No.
                </th>
                <th className={styles.bomThLeft}>
                  Part Number
                </th>
                <th className={styles.bomTh} style={{ width: 70 }}>
                  Qty.
                </th>
                <th className={styles.bomTh} style={{ width: 130 }}>
                  Image
                </th>
              </tr>
            </thead>
            <tbody>
              {bom.map((b) => (
                <BomEditableRow
                  key={b.ID}
                  item={b}
                  onUploaded={refetch}
                  onChanged={refetch}
                />
              ))}
            </tbody>
          </table>
        )}

        {data?.stages?.length > 0 && (

          <div className={styles.stageListWrapper}>

            <div className={styles.sectionLabel}>
              Process Stages ({data.stages.length})
            </div>

            {data.stages.map((s) => (

              <div
                key={s.ID}
                className={styles.stageRow}
              >

                <div className={styles.stageSeqBubble}>
                  {s.SEQUENCE}
                </div>

                <div className={styles.flex1}>

                  <div className={styles.stageName}>
                    {s.STAGE_NAME}
                  </div>

                  <div className={styles.stageMeta}>
                    {s.STAGE_TYPE} · {s.ESTIMATED_HOURS}h
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// BOM Reset & Reseed modal — admin-only destructive action.
// Two-step UX:
//   Step 1: DRY-RUN preview — POST /production/bom/reset-and-seed
//           with DRY_RUN: true. Shows per-product machine type +
//           seed count, plus the wipe count.
//   Step 2: Confirm — POST the same payload with DRY_RUN: false.
//   Step 3: Green success card; auto-close after 5s; parent
//           refetches models + any open drawer's BOM.
// ----------------------------------------------------------------
function BomResetModal({ models, vendorId = 1, onClose, onSuccess }) {

  // Phase: "preview" → "confirming" → "running" → "success" | "error"
  const [phase, setPhase] = useState("loading");

  const [preview, setPreview] = useState(null);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  // Build the products_to_seed payload from the full model list.
  // Always auto-detect machine type from each model's CATEGORY.
  const buildPayload = (dryRun) => ({
    vendor_id: vendorId,
    products_to_seed: models.map((m) => ({
      product_model_id: m.ID,
      auto_detect_category: true
    })),
    dry_run: dryRun
  });

  // Step 1: load dry-run preview on mount
  useEffect(() => {

    let cancelled = false;

    const loadPreview = async () => {

      try {

        const res = await API.post(
          "/production/bom/reset-and-seed",
          buildPayload(true)
        );

        if (cancelled) return;

        setPreview(res.data);

        setPhase("preview");

      } catch (e) {

        if (cancelled) return;

        setError(
          e?.response?.data?.detail ||
          "Failed to load dry-run preview. Backend endpoint may not be available."
        );

        setPhase("error");
      }
    };

    if (models.length === 0) {

      setError("No product models found for this vendor.");

      setPhase("error");

    } else {

      loadPreview();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: confirm — fire the real wipe + seed
  const confirmReset = async () => {

    setPhase("running");

    setError("");

    try {

      const res = await API.post(
        "/production/bom/reset-and-seed",
        buildPayload(false)
      );

      setResult(res.data);

      setPhase("success");

      // Auto-close after 5s, refetching parent state
      setTimeout(() => {

        onSuccess?.();

        onClose?.();

      }, 5000);

    } catch (e) {

      setError(e?.response?.data?.detail || "Reset & reseed failed.");

      setPhase("error");
    }
  };

  // ---- Rendering helpers ----
  const seedSummary = preview?.seed_summary || {};

  const previewSeedEntries = Object.entries(seedSummary);

  const totalSeedLines = previewSeedEntries.reduce(
    (acc, [, info]) => acc + (info?.bom_lines_seeded || 0),
    0
  );

  const wipeWouldDelete =
    preview?.wipe_summary?.bom_items_would_delete ??
    preview?.wipe_summary?.bom_items_deleted ??
    0;

  const resultSeedEntries = Object.entries(result?.seed_summary || {});

  const resultSeededTotal = resultSeedEntries.reduce(
    (acc, [, info]) => acc + (info?.bom_lines_seeded || 0),
    0
  );

  return (

    <div
      className={styles.modalOverlay}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.modalShell}
      >

        {/* Sticky header — flat BVC red (gradient removed per spec) */}
        <div className={styles.bomModalHeader}>

          <div>

            <div className={styles.modalHeaderLabel}>
              Destructive Admin Action
            </div>

            <div className={styles.modalHeaderTitle}>
              ♻ Reset & Reseed All BOMs
            </div>

            <div className={styles.modalHeaderDesc}>
              Wipes every BOM row for vendor #{vendorId} and reseeds
              category-aware components per machine type. Existing PO
              lines stay intact — their BOM link is just nulled out.
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={phase === "running"}
            className={styles.modalCloseBtn}
            style={{ cursor: phase === "running" ? "not-allowed" : "pointer" }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className={styles.modalBody}>

          {/* ---- LOADING (dry-run in flight) ---- */}
          {phase === "loading" && (
            <div className={styles.modalLoading}>
              🔎 Loading dry-run preview…
            </div>
          )}

          {/* ---- ERROR ---- */}
          {phase === "error" && (

            <div className={styles.modalErrorBox}>
              <div className={styles.modalErrorTitle}>
                Something went wrong
              </div>
              <div>{error}</div>
            </div>
          )}

          {/* ---- STEP 1: DRY-RUN PREVIEW ---- */}
          {(phase === "preview" || phase === "running") && preview && (

            <>

              <div className={styles.previewGrid}>

                <div className={styles.previewCardWipe}>
                  <div className={styles.previewWipeLabel}>Will Wipe</div>
                  <div className={styles.previewWipeValue}>{wipeWouldDelete}</div>
                  <div className={styles.previewWipeSub}>
                    BOM rows across {models.length} model(s)
                  </div>
                </div>

                <div className={styles.previewCardSeed}>
                  <div className={styles.previewSeedLabel}>Will Seed</div>
                  <div className={styles.previewSeedValue}>{totalSeedLines}</div>
                  <div className={styles.previewSeedSub}>
                    new BOM rows across {previewSeedEntries.length}{" "}
                    model(s)
                  </div>
                </div>
              </div>

              <div className={styles.sectionLabel}>
                Per-product breakdown
              </div>

              <div className={styles.breakdownWrapper}>

                <table className={styles.breakdownTable}>

                  <thead className={styles.breakdownThead}>

                    <tr>
                      <th className={styles.breakdownTh}>
                        Product
                      </th>
                      <th className={styles.breakdownTh}>
                        Machine Type
                      </th>
                      <th className={styles.breakdownThRight}>
                        BOM Lines
                      </th>
                    </tr>
                  </thead>

                  <tbody>

                    {previewSeedEntries.length === 0 && (

                      <tr>
                        <td
                          colSpan="3"
                          className={styles.tableEmptyCellCenter}
                        >
                          No products to reseed.
                        </td>
                      </tr>
                    )}

                    {previewSeedEntries.map(([pid, info]) => (

                      <tr
                        key={pid}
                        className={styles.breakdownTr}
                      >

                        <td className={styles.breakdownTdProduct}>
                          {info.product_name || `Model #${pid}`}
                        </td>

                        <td className={styles.breakdownTdMachine}>
                          <span className={styles.machineTypeBadge}>
                            {info.machine_type || "generic"}
                          </span>
                        </td>

                        <td className={styles.breakdownTdCount}>
                          {info.bom_lines_seeded ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.warningNotice}>
                ⚠ This action is irreversible. Existing BOM rows for
                this vendor will be deleted and replaced with fresh
                category-aware components. Past PO/GRN data survives —
                their BOM line link is just nulled out.
              </div>
            </>
          )}

          {/* ---- STEP 3: SUCCESS ---- */}
          {phase === "success" && result && (

            <div className={styles.successCard}>

              <div className={styles.successCardTitle}>
                ✅ BOM reset &amp; reseed complete
              </div>

              <div className={styles.successCardMsg}>
                {result.message ||
                  "Wiped and reseeded successfully."}
                {" "}This window closes automatically in 5 seconds.
              </div>

              <div className={styles.successStatGrid}>

                <div className={styles.successStatCard}>
                  <div className={styles.successStatLabel}>BOM rows deleted</div>
                  <div className={styles.successStatValue}>
                    {result.wipe_summary?.bom_items_deleted ?? 0}
                  </div>
                </div>

                <div className={styles.successStatCard}>
                  <div className={styles.successStatLabel}>PO lines nulled</div>
                  <div className={styles.successStatValue}>
                    {result.wipe_summary?.po_lines_nulled ?? 0}
                  </div>
                </div>

                <div className={styles.successStatCard}>
                  <div className={styles.successStatLabel}>Rows seeded</div>
                  <div className={styles.successStatValue}>
                    {resultSeededTotal}
                  </div>
                </div>
              </div>

              <div className={`${styles.successStatLabel} ${styles.successStatLabelSpaced}`}>
                Per-product result
              </div>

              <div className={styles.successResultScroll}>

                {resultSeedEntries.map(([pid, info]) => (

                  <div
                    key={pid}
                    className={styles.successResultRow}
                  >

                    <div className={styles.successResultName}>
                      {info.product_name || `Model #${pid}`}{" "}
                      <span className={styles.successResultMachineType}>
                        [{info.machine_type || "generic"}]
                      </span>
                    </div>

                    <div className={styles.successResultCount}
                    >
                      {info.bom_lines_seeded ?? 0} rows
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer — action buttons */}
        {(phase === "preview" || phase === "running" || phase === "error") && (

          <div className={styles.modalFooter}>

            <button
              onClick={onClose}
              disabled={phase === "running"}
              className={styles.btnCancel}
              style={{ cursor: phase === "running" ? "not-allowed" : "pointer" }}
            >
              Cancel
            </button>

            {phase === "preview" && (

              <button
                onClick={confirmReset}
                disabled={previewSeedEntries.length === 0}
                className={
                  previewSeedEntries.length === 0
                    ? styles.btnDisabled
                    : styles.btnConfirmBom
                }
              >
                ♻ Confirm reset &amp; reseed
              </button>
            )}

            {phase === "running" && (

              <button
                disabled
                className={styles.btnDisabled}
              >
                Running…
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// StageResetModal — replaces the manufacturing-stages flow for
// every product under the vendor with the canonical 40-stage
// catalogue (Design → Procurement → Fabrication → Wiring →
// Software → Testing → Dispatch → Installation → Handover).
// Mirrors BomResetModal's 3-phase pattern: preview → confirm →
// success.
// ----------------------------------------------------------------

function StageResetModal({ models, vendorId = 1, onClose, onSuccess }) {

  const [phase, setPhase] = useState("loading");
  // loading → preview → running → success | error

  const [preview, setPreview] = useState(null);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  const payload = (dryRun) => ({
    VENDOR_ID: vendorId,
    DRY_RUN: dryRun
  });

  // Step 1: dry-run preview on mount
  useEffect(() => {

    let cancelled = false;

    const loadPreview = async () => {

      try {

        const res = await API.post(
          "/production/stages/reset-and-seed",
          payload(true)
        );

        if (cancelled) return;

        setPreview(res.data);

        setPhase("preview");

      } catch (e) {

        if (cancelled) return;

        setError(
          e?.response?.data?.detail ||
          "Failed to load dry-run preview. Backend endpoint may not be available."
        );

        setPhase("error");
      }
    };

    if (!models || models.length === 0) {

      setError("No product models found for this vendor.");

      setPhase("error");

    } else {

      loadPreview();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmReset = async () => {

    setPhase("running");

    setError("");

    try {

      const res = await API.post(
        "/production/stages/reset-and-seed",
        payload(false)
      );

      setResult(res.data);

      setPhase("success");

      setTimeout(() => {

        onSuccess?.();

        onClose?.();

      }, 5000);

    } catch (e) {

      setError(e?.response?.data?.detail || "Stage reset & reseed failed.");

      setPhase("error");
    }
  };

  return (

    <div
      className={styles.modalOverlay}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.modalShell}
      >

        {/* Sticky header — flat indigo (gradient removed per spec) */}
        <div className={styles.stageModalHeader}>
          <div>
            <div className={styles.modalHeaderLabel}>
              Destructive Admin Action
            </div>
            <div className={styles.modalHeaderTitle}>
              🏭 Reset Manufacturing Stages (40)
            </div>
            <div className={styles.modalHeaderDesc}>
              Replaces every product's stages with the canonical
              40-step flow: Design → BOM → Procurement → Fabrication
              → Wiring → Software → Testing → Dispatch → Installation
              → Handover.
            </div>
          </div>
          <button
            onClick={onClose}
            className={styles.modalCloseBtnSquare}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBodyPlain}>

          {phase === "loading" && (
            <div className={styles.modalLoading}>
              🔎 Loading dry-run preview…
            </div>
          )}

          {phase === "error" && (
            <div className={styles.modalErrorBox}>
              ⚠ {error}
            </div>
          )}

          {phase === "preview" && preview && (
            <>
              <div className={`${styles.successStatGrid} ${styles.successStatGridSpaced}`}>
                <SummaryTile
                  label="Existing stages"
                  value={preview.existing_stages || 0}
                  color="#ef4444"
                />
                <SummaryTile
                  label="Will seed / product"
                  value={preview.would_seed_per_product || 0}
                  color="#6366f1"
                />
                <SummaryTile
                  label="Total to seed"
                  value={preview.total_to_seed || 0}
                  color="#16a34a"
                />
              </div>

              <div className={styles.infoBarIndigo}>
                ⏱️ Estimated duration per build:
                <b> {preview.estimated_days_per_build || "—"} working days</b>
                {" "}(roughly {Math.ceil((preview.estimated_days_per_build || 0) / 5)} weeks
                at 5-day weeks).
              </div>

              <div className={styles.infoBarAmber}>
                <b>FK-safe wipe</b>: stages currently in use by Work
                Order progress rows get soft-disabled (IS_ACTIVE=0),
                NOT deleted — your existing in-progress Gantt charts
                stay intact. Only new work orders pick up the 40-stage
                flow.
              </div>

              {(preview.per_product || []).length > 0 && (
                <div className={styles.breakdownWrapper}>
                  <table className={styles.breakdownTable}>
                    <thead className={styles.breakdownThead}>
                      <tr>
                        <th className={styles.breakdownTh}>Product</th>
                        <th className={styles.breakdownTh}>Category</th>
                        <th className={styles.breakdownThRight}>Stages to seed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.per_product.map((p) => (
                        <tr key={p.product_model_id} className={styles.breakdownTr}>
                          <td className={styles.breakdownTdProduct}>
                            <div className={styles.breakdownProductName}>{p.model_name}</div>
                            <div className={styles.woProductCode}>
                              {p.model_code}
                            </div>
                          </td>
                          <td className={styles.breakdownTdMachine}>
                            <span className={styles.machineTypeBadge}>
                              {p.category || "generic"}
                            </span>
                          </td>
                          <td className={`${styles.breakdownTdCount} ${styles.breakdownTdCountRight}`}>
                            {p.stages_to_seed}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {phase === "running" && (
            <div className={styles.runningBox}>
              <div className={styles.runningTitle}>
                ⚙ Reseeding stages…
              </div>
              <div className={styles.runningSub}>
                Hold tight, this usually takes a couple of seconds.
              </div>
            </div>
          )}

          {phase === "success" && result && (
            <div className={styles.stageSuccessCard}>
              <div className={styles.stageSuccessLabel}>
                ✅ STAGES RESET COMPLETE
              </div>
              <div className={`${styles.successStatGrid} ${styles.successStatGridSpacedSm}`}>
                <SummaryTile label="Wiped" value={result.wiped_count || 0} color="#ef4444" />
                <SummaryTile label="Soft-disabled" value={result.soft_disabled_count || 0} color="#f59e0b" />
                <SummaryTile label="Seeded" value={result.seeded_count || 0} color="#16a34a" />
              </div>
              <div className={styles.stageSuccessMsg}>
                {result.message}
              </div>
              <div className={styles.stageSuccessAutoClose}>
                Auto-closing in 5 seconds…
              </div>
            </div>
          )}

        </div>

        {/* Sticky footer */}
        {(phase === "preview" || phase === "error") && (
          <div className={styles.modalFooterAlt}>
            <button
              onClick={onClose}
              className={styles.btnCancelAlt}
            >
              Cancel
            </button>
            {phase === "preview" && (
              <button
                onClick={confirmReset}
                className={styles.btnConfirmStage}
              >
                🏭 Confirm reset &amp; reseed
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}


// Shared small helpers used by both reset modals
function SummaryTile({ label, value, color }) {

  return (
    <div
      className={styles.summaryTile}
      style={{
        border: `1px solid ${color}33`,
        borderTop: `3px solid ${color}`
      }}
    >
      <div className={styles.summaryTileLabel}>
        {label}
      </div>
      <div
        className={styles.summaryTileValue}
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}


function ModelsTab() {

  const [models, setModels] = useState([]);

  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState(null);

  const [showResetModal, setShowResetModal] = useState(false);

  const [showStageResetModal, setShowStageResetModal] = useState(false);

  // Bump to force the open ModelDetailDrawer to refetch its BOM.
  const [drawerRefetchSignal, setDrawerRefetchSignal] = useState(0);

  // Admin gate — matches the pattern used elsewhere in the app
  // (localStorage "role" === "admin" set by Login.jsx admin-login).
  const isAdmin = (localStorage.getItem("role") || "admin") === "admin";

  const fetchModels = async () => {

    setLoading(true);

    try {

      const res = await API.get("/production/models", {
        params: { vendor_id: 1 }
      });

      setModels(res.data || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchModels();

  }, []);

  const handleResetSuccess = () => {

    // Refresh model list AND signal any open drawer to refetch BOM.
    fetchModels();

    setDrawerRefetchSignal((n) => n + 1);
  };

  return (

    <div>

      {/* ---- Admin actions bar (admin-only) ---- */}
      {isAdmin && (

        <div className={styles.adminBar}>

          <div className={styles.adminLabel}>Admin</div>

          <button
            onClick={() => setShowResetModal(true)}
            disabled={loading || models.length === 0}
            title="Wipe every BOM row for this vendor and reseed category-aware components per machine type"
            className={
              loading || models.length === 0
                ? styles.btnAdminBomDisabled
                : styles.btnAdminBom
            }
          >
            ♻ Reset &amp; Reseed All BOMs
          </button>

          <button
            onClick={() => setShowStageResetModal(true)}
            disabled={loading || models.length === 0}
            title="Replace the manufacturing-stages flow for every product with the canonical 40-stage catalogue (Design → Procurement → Fabrication → Wiring → Software → Testing → Dispatch → Installation → Handover)"
            className={
              loading || models.length === 0
                ? styles.btnAdminStageDisabled
                : styles.btnAdminStage
            }
          >
            🏭 Reset &amp; Reseed Stages (40)
          </button>
        </div>
      )}

      <div className={styles.modelsGrid}>

        {loading && (
          <div className={styles.loadingText}>Loading models…</div>
        )}

        {!loading && models.length === 0 && (
          <div className={styles.modelsEmpty}>
            No product models yet. Run <code>/demo/seed-bvc24</code>
            {" "}to seed BVC24's catalog.
          </div>
        )}

        {models.map((m) => (

          <div
            key={m.ID}
            onClick={() => setSelectedId(m.ID)}
            className={styles.modelCard}
            style={{
              borderLeft:
                m.STATUS === "ACTIVE"
                  ? "4px solid #22c55e"
                  : "4px solid #94a3b8"
            }}
          >

            <div className={styles.modelCardCode}>
              {m.MODEL_CODE}
            </div>

            <div className={styles.modelCardName}>
              {m.MODEL_NAME}
            </div>

            <div className={styles.modelCardCategory}>
              {m.CATEGORY || "uncategorized"}
              {" · "}
              {m.ESTIMATED_BUILD_DAYS}d build
            </div>

            {m.DESCRIPTION && (
              <div className={styles.modelCardDesc}>
                {m.DESCRIPTION.length > 80
                  ? m.DESCRIPTION.slice(0, 80) + "…"
                  : m.DESCRIPTION}
              </div>
            )}
          </div>
        ))}
      </div>

      {selectedId && (
        <ModelDetailDrawer
          modelId={selectedId}
          onClose={() => setSelectedId(null)}
          refetchSignal={drawerRefetchSignal}
        />
      )}

      {showResetModal && (
        <BomResetModal
          models={models}
          vendorId={1}
          onClose={() => setShowResetModal(false)}
          onSuccess={handleResetSuccess}
        />
      )}

      {showStageResetModal && (
        <StageResetModal
          models={models}
          vendorId={1}
          onClose={() => setShowStageResetModal(false)}
          onSuccess={handleResetSuccess}
        />
      )}
    </div>
  );
}


// ----------------------------------------------------------------
// Work Orders tab
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Work Order Gantt drawer — timeline + ✓/✗ stage updates
// ----------------------------------------------------------------

const STAGE_STATUS_COLORS = {
  PENDING: { bg: "#e2e8f0", fg: "#475569", bar: "#cbd5e1" },
  IN_PROGRESS: { bg: "#fef3c7", fg: "#854d0e", bar: "#f59e0b" },
  DONE: { bg: "#dcfce7", fg: "#166534", bar: "#22c55e" },
  FAILED: { bg: "#fee2e2", fg: "#b91c1c", bar: "#ef4444" },
  SKIPPED: { bg: "#f1f5f9", fg: "#64748b", bar: "#94a3b8" }
};


const STAGE_TYPE_COLORS = {
  DESIGN: "#8b5cf6",
  MECHANICAL: "#3b82f6",
  ELECTRICAL: "#06b6d4",
  WIRING: "#0ea5e9",
  FABRICATION: "#f59e0b",
  ASSEMBLY: "#10b981",
  TESTING: "#ec4899",
  QC: "#ef4444",
  PACKAGING: "#64748b",
  OTHER: "#94a3b8"
};


function ganttDateLabel(iso) {

  if (!iso) return "—";

  const d = new Date(iso);

  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short"
  }) + " " + d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}


function ganttShortDate(iso) {

  if (!iso) return "—";

  const d = new Date(iso);

  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short"
  });
}


function GanttRow({
  bar,
  timeline = [],
  timelineDays = 30,
  onUpdate,
  updating
}) {

  // Each Day cell = (100 / timelineDays)%
  const cellWidth = 100 / timelineDays;

  // Planned occupies its day_number slot (1-indexed) and spans
  // days_allocated cells (so a 5-day stage stretches across 5 cells).
  const planLeft = Math.max(0, (bar.day_number - 1) * cellWidth);

  const planWidth = Math.max(1, bar.days_allocated || 1) * cellWidth;

  // Actual bar — only if data exists; placed on its actual day_number
  const hasActual = !!bar.actual_start;

  let actualLeft = null;

  let actualWidth = null;

  if (hasActual && timeline.length) {

    const baseDateStr = timeline[0].date;

    const baseDay = new Date(baseDateStr + "T00:00:00");

    const startDay = new Date(
      bar.actual_start.slice(0, 10) + "T00:00:00"
    );

    const dayOffset = Math.max(
      0,
      Math.round((startDay - baseDay) / 86400000)
    );

    actualLeft = dayOffset * cellWidth;

    if (bar.actual_end) {

      const endDay = new Date(
        bar.actual_end.slice(0, 10) + "T00:00:00"
      );

      const spanDays = Math.max(
        1,
        Math.round((endDay - startDay) / 86400000) + 1
      );

      actualWidth = spanDays * cellWidth;

    } else {

      actualWidth = cellWidth;
    }
  }

  const theme = STAGE_STATUS_COLORS[bar.status] || STAGE_STATUS_COLORS.PENDING;

  const typeColor = STAGE_TYPE_COLORS[bar.stage_type] || "#94a3b8";

  return (

    <div className={styles.ganttRow}>

      {/* Stage label column */}
      <div>

        <div className={styles.ganttRowLabel}>

          <div
            className={styles.ganttSeqBubble}
            style={{
              background: `${typeColor}22`,
              color: typeColor
            }}
          >
            {bar.sequence}
          </div>

          <div className={styles.ganttStageInfo}>

            <div className={styles.ganttStageName}>
              {bar.stage_name}
            </div>

            <div
              className={styles.ganttStageMeta}
              style={{ color: typeColor }}
            >
              {bar.stage_type} · {bar.estimated_hours}h
              {" · "}
              <span className={styles.ganttStageMetaPrimary}>
                ⏱ {bar.days_allocated ?? "—"} day
                {Number(bar.days_allocated) === 1 ? "" : "s"}
              </span>
              {bar.actual_hours != null && (
                <span className={styles.ganttStageMetaSecondary}>
                  {" "}/ actual {bar.actual_hours}h
                </span>
              )}
            </div>

            {/* Assignee chip — visible for every stage */}
            <div className={styles.ganttAssigneeRow}>
              {bar.assignee_name ? (
                <span className={styles.ganttAssigneeChip}>
                  👤 {bar.assignee_name}
                  {bar.assignee_code && (
                    <span className={styles.ganttAssigneeCode}>
                      ({bar.assignee_code})
                    </span>
                  )}
                </span>
              ) : (
                <span className={styles.ganttUnassigned}>
                  unassigned
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Gantt bar column — aligned to the Day-1→Day-30 header */}
      <div className={styles.ganttTrack}>

        {/* Sunday-leave shading + day grid lines */}
        {timeline.map((d, idx) => (

          <div
            key={d.day_number}
            style={{
              position: "absolute",
              left: `${idx * cellWidth}%`,
              width: `${cellWidth}%`,
              top: 0,
              bottom: 0,
              background: d.is_sunday ? "#fee2e220" : "transparent",
              borderRight:
                idx < timeline.length - 1
                  ? "1px solid var(--border-light)"
                  : "none"
            }}
          />
        ))}

        {/* Planned bar — spans days_allocated day cells */}
        <div
          title={
            `Planned: ${ganttShortDate(bar.planned_start_date)} → ` +
            `${ganttShortDate(bar.planned_end_date)} ` +
            `(${bar.days_allocated} day${bar.days_allocated === 1 ? "" : "s"}, ` +
            `${bar.estimated_hours}h)`
          }
          style={{
            position: "absolute",
            left: `${planLeft}%`,
            width: `${planWidth}%`,
            top: 5,
            bottom: 5,
            background: `${typeColor}33`,
            border: `1.5px solid ${typeColor}`,
            borderRadius: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: typeColor,
            fontWeight: 800,
            lineHeight: 1.15,
            padding: "0 4px",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: 0.3,
              lineHeight: 1,
              whiteSpace: "nowrap"
            }}
          >
            {bar.days_allocated > 1
              ? `${bar.day_number}–${bar.day_number + bar.days_allocated - 1}`
              : bar.day_number}
          </div>
          <div
            style={{
              fontSize: 9,
              color: "var(--text-secondary)",
              fontWeight: 700,
              marginTop: 3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%"
            }}
          >
            {bar.days_allocated > 1
              ? `${ganttShortDate(bar.planned_start_date)} → ${ganttShortDate(bar.planned_end_date)}`
              : ganttShortDate(bar.planned_start_date)}
          </div>
        </div>

        {/* Actual bar overlay (solid) */}
        {hasActual && (

          <div
            title={`Actual: ${ganttDateLabel(bar.actual_start)} → ${bar.actual_end ? ganttDateLabel(bar.actual_end) : "ongoing"}`}
            style={{
              position: "absolute",
              left: `${actualLeft}%`,
              width: `${actualWidth}%`,
              top: 2,
              bottom: 2,
              background: theme.bar,
              borderRadius: 5,
              opacity: 0.85
            }}
          />
        )}
      </div>

      {/* Action column */}
      <div className={styles.ganttActions}>

        <span
          className={styles.ganttStatusBadge}
          style={{ background: theme.bg, color: theme.fg }}
        >
          {bar.status?.replaceAll("_", " ")}
        </span>

        <div className={styles.ganttActionBtns}>

          {bar.status === "PENDING" && (

            <button
              disabled={updating}
              onClick={() =>
                onUpdate(bar.stage_id, "IN_PROGRESS")
              }
              title="Start"
              className={styles.ganttBtnStart}
              style={{ cursor: updating ? "not-allowed" : "pointer" }}
            >
              ▶
            </button>
          )}

          {bar.status !== "DONE" && bar.status !== "FAILED" && (

            <button
              disabled={updating}
              onClick={() => onUpdate(bar.stage_id, "DONE")}
              title="Mark done"
              className={styles.ganttBtnDone}
              style={{ cursor: updating ? "not-allowed" : "pointer" }}
            >
              ✓
            </button>
          )}

          {bar.status !== "FAILED" && bar.status !== "DONE" && (

            <button
              disabled={updating}
              onClick={() => {

                const note = prompt(
                  "Reason for failing this stage?",
                  ""
                );

                if (note === null) return;

                onUpdate(bar.stage_id, "FAILED", note);
              }}
              title="Mark failed"
              className={styles.ganttBtnFail}
              style={{ cursor: updating ? "not-allowed" : "pointer" }}
            >
              ✗
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Day 1 → Day 30 calendar header for the Gantt chart
// ----------------------------------------------------------------

function TimelineHeader({ timeline }) {

  if (!timeline.length) return <div />;

  const cellWidth = 100 / timeline.length;

  // ---- Adaptive layout based on how cramped the cells are ---------
  // full   ≥ 3.0% per cell (≤33 days)  → show day#, full date, 3-letter weekday
  // medium ≥ 1.5% per cell (≤66 days)  → show day#, full date, single-char weekday
  // compact <1.5% per cell (>66 days)  → show day#, single-char weekday;
  //                                       month labels only on the 1st of each month
  let mode = "full";

  if (cellWidth < 1.5) mode = "compact";

  else if (cellWidth < 3) mode = "medium";

  const headerHeight = mode === "compact" ? 46 : 54;

  // Pre-compute the day-of-month label visibility for compact mode.
  // We show a date label whenever it's the 1st of the month or
  // every 7 days (whichever comes first) so the user can still
  // anchor by week and by month change.
  const showDateLabel = (d, idx) => {

    if (mode !== "compact") return true;

    const dt = new Date(d.date + "T00:00:00");

    if (dt.getDate() === 1) return true;        // 1st of month — always

    if (idx % 7 === 0) return true;             // weekly anchor

    return false;
  };

  return (

    <div
      className={styles.timelineHeader}
      style={{ height: headerHeight }}
    >
      {timeline.map((d, idx) => {

        const dt = new Date(d.date + "T00:00:00");

        const dayNum = dt.getDate();

        const monthShort = dt.toLocaleDateString("en-IN", { month: "short" });

        const weekdayChar = (d.weekday || "")[0] || "";

        const weekdayText =
          mode === "full" ? (d.weekday || "").toUpperCase() : weekdayChar;

        const showDate = showDateLabel(d, idx);

        // Highlight the 1st of each month with a stronger top border
        // so the user can spot month changes at a glance.
        const isMonthStart = dt.getDate() === 1;

        return (

          <div
            key={d.day_number}
            style={{
              position: "absolute",
              left: `${idx * cellWidth}%`,
              width: `${cellWidth}%`,
              top: 0,
              bottom: 0,
              borderRight:
                idx < timeline.length - 1
                  ? "1px solid var(--border)"
                  : "none",
              borderLeft: isMonthStart && idx > 0
                ? "2px solid #6366f1"
                : "none",
              background: d.is_sunday ? "#fee2e2" : "transparent",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "3px 0",
              overflow: "hidden"
            }}
            title={`Day ${d.day_number} — ${dt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}`}
          >

            <div
              style={{
                fontSize: mode === "compact" ? 10 : 12,
                fontWeight: 800,
                color: d.is_sunday ? "#991b1b" : "var(--text-primary)",
                lineHeight: 1
              }}
            >
              {d.day_number}
            </div>

            {showDate && (

              <div
                style={{
                  fontSize: mode === "compact" ? 8 : 9,
                  color: d.is_sunday ? "#991b1b" : "var(--text-secondary)",
                  fontWeight: 700,
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: mode === "compact" ? "visible" : "hidden",
                  pointerEvents: "none"
                }}
              >
                {mode === "compact" && isMonthStart
                  ? monthShort
                  : `${dayNum}${mode === "full" ? " " + monthShort : ""}`}
              </div>
            )}

            <div
              style={{
                fontSize: mode === "full" ? 8 : 9,
                color: d.is_sunday ? "#991b1b" : "var(--text-muted)",
                fontWeight: 700,
                marginTop: 2,
                textTransform: "uppercase",
                letterSpacing: mode === "full" ? 0.4 : 0,
                lineHeight: 1
              }}
            >
              {weekdayText}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function WOGanttDrawer({ wo, onClose }) {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [updating, setUpdating] = useState(false);

  const [resyncing, setResyncing] = useState(false);

  // Pagination — page through the full timeline one calendar month at a time
  // so the Gantt header stays readable even for 100-day projects.
  const [monthIdx, setMonthIdx] = useState(0);

  // Reset to first month whenever we switch to a different WO
  useEffect(() => { setMonthIdx(0); }, [wo?.ID]);

  const fetchGantt = () => {

    setLoading(true);

    API.get(`/process/wo/${wo.ID}/gantt`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const resyncStages = async () => {

    const totalNow = data?.total_stages || 0;

    const confirm1 = window.confirm(
      `Resync ${wo.WO_NUMBER} to the current stage template?\n\n` +
      `This will REMOVE the ${totalNow} existing stage row(s) and ` +
      `seed fresh rows from the active template (40 stages).\n\n` +
      `Only allowed if no stage has been started yet.`
    );

    if (!confirm1) return;

    setResyncing(true);

    try {

      const r = await API.post(`/process/wo/${wo.ID}/resync-stages`);

      alert(r.data?.message || "Resynced successfully");

      fetchGantt();

    } catch (e) {

      const detail = e?.response?.data?.detail || "";

      if (e?.response?.status === 409) {

        const force = window.confirm(
          `${detail}\n\n` +
          `Force resync anyway? (This will ERASE actual start/end ` +
          `times already recorded — usually you should create a NEW ` +
          `work order instead.)`
        );

        if (force) {

          try {

            const r2 = await API.post(
              `/process/wo/${wo.ID}/resync-stages?force=true`
            );

            alert(r2.data?.message || "Force-resynced");

            fetchGantt();

          } catch (e2) {

            alert(e2?.response?.data?.detail || "Force resync failed");
          }
        }

      } else {

        alert(detail || "Resync failed");
      }

    } finally {

      setResyncing(false);
    }
  };

  useEffect(() => {

    if (wo) fetchGantt();

  }, [wo?.ID]);

  const updateStage = async (stage_id, status, notes) => {

    setUpdating(true);

    try {

      await API.patch(
        `/process/wo/${wo.ID}/stages/${stage_id}`,
        { STATUS: status, NOTES: notes }
      );

      fetchGantt();

    } catch (e) {

      alert(e?.response?.data?.detail || "Update failed");

    } finally {

      setUpdating(false);
    }
  };

  if (!wo) return null;

  const bars = data?.stages || [];

  const progressPct = data?.total_stages
    ? Math.round((data.completed_count / data.total_stages) * 100)
    : 0;

  // ---- Month-bucket the full timeline so the Gantt can paginate ----
  const monthBuckets = (() => {

    const buckets = [];

    let current = null;

    (data?.timeline || []).forEach((d) => {

      const dt = new Date(d.date + "T00:00:00");

      const key = `${dt.getFullYear()}-${dt.getMonth()}`;

      if (!current || current.key !== key) {

        current = {
          key,
          label: dt.toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric"
          }),
          days: []
        };

        buckets.push(current);
      }

      current.days.push(d);
    });

    return buckets;
  })();

  const safeMonthIdx = Math.min(
    monthIdx,
    Math.max(0, monthBuckets.length - 1)
  );

  const activeMonth = monthBuckets[safeMonthIdx];

  const visibleTimeline = activeMonth?.days || [];

  const windowStart = visibleTimeline[0]?.day_number || 1;

  const windowEnd =
    visibleTimeline[visibleTimeline.length - 1]?.day_number || 0;

  // Reproject each bar so its day_number is relative to the visible window.
  // Stages that are entirely outside this month are filtered out so the
  // Gantt rows match what the user can actually see in the bars.
  const windowedBars = bars

    .map((bar) => {

      const barEnd = bar.day_number + (bar.days_allocated || 1) - 1;

      // Skip if entirely outside the visible window
      if (barEnd < windowStart || bar.day_number > windowEnd) return null;

      // Clamp to window edges so long bars don't visually overflow
      const clampedStart = Math.max(bar.day_number, windowStart);

      const clampedEnd = Math.min(barEnd, windowEnd);

      return {
        ...bar,
        // Re-base into window coordinates (1-indexed within the window)
        day_number: clampedStart - windowStart + 1,
        days_allocated: clampedEnd - clampedStart + 1,
        _clippedLeft: bar.day_number < windowStart,
        _clippedRight: barEnd > windowEnd
      };
    })

    .filter(Boolean);

  return (

    <div
      className={styles.ganttOverlay}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.ganttPanel}
      >

        {/* ---- Sticky header (always visible while body scrolls) ---- */}
        <div className={styles.ganttPanelHeader}>

          <div>

            <div className={styles.ganttWoNumber}>
              {wo.WO_NUMBER}
            </div>

            <div className={styles.ganttWoTitle}>
              {wo.PRODUCT_MODEL_NAME}
            </div>

            <div className={styles.ganttWoMeta}>
              {wo.QUANTITY} units · {wo.PRODUCT_MODEL_CODE}
              {wo.NOTES && ` · ${wo.NOTES}`}
            </div>
          </div>

          <div className={styles.ganttHeaderActions}>

            {data && (
              <button
                onClick={resyncStages}
                disabled={resyncing || loading}
                title="Wipe this WO's stage rows and re-spawn against the current active stage template (40 stages). Refuses if any stage is started."
                className={resyncing ? styles.btnResyncBusy : styles.btnResync}
              >
                {resyncing
                  ? "Resyncing…"
                  : `♻ Resync to 40-stage flow (currently ${data.total_stages || 0})`}
              </button>
            )}

            <button
              onClick={onClose}
              className={styles.ganttCloseBtn}
            >
              ×
            </button>
          </div>
        </div>

        {/* ---- Scrollable body ---- */}
        <div className={styles.ganttBody}>

          {loading && (
            <div className={styles.loadingText}>Loading timeline…</div>
          )}

          {data && (

            <>

              {/* Summary tiles */}
              <div className={styles.ganttSummaryGrid}>

                <div className={`${styles.ganttStatTile} ${styles.ganttStatTileBlue}`}>
                  <div className={`${styles.ganttStatLabel} ${styles.ganttStatLabelBlue}`}>
                    Progress
                  </div>
                  <div className={styles.ganttStatValue}>
                    {progressPct}%
                  </div>
                  <div className={styles.ganttStatSub}>
                    {data.completed_count} / {data.total_stages} done
                  </div>
                </div>

                <div className={`${styles.ganttStatTile} ${styles.ganttStatTileGreen}`}>
                  <div className={`${styles.ganttStatLabel} ${styles.ganttStatLabelGreen}`}>
                    Planned
                  </div>
                  <div className={styles.ganttStatValue}>
                    {Math.round((data.total_planned_hours || 0) / 8)} days
                  </div>
                  <div className={styles.ganttStatSub}>
                    {data.total_stages || 0} stages ·{" "}
                    {data.total_planned_hours || 0}h total · Sundays off
                  </div>
                </div>

                <div className={`${styles.ganttStatTile} ${styles.ganttStatTileAmber}`}>
                  <div className={`${styles.ganttStatLabel} ${styles.ganttStatLabelAmber}`}>
                    Actual So Far
                  </div>
                  <div className={styles.ganttStatValue}>
                    {data.total_actual_hours}h
                  </div>
                  <div className={styles.ganttStatSub}>
                    measured from completed stages
                  </div>
                </div>

                <div
                  className={`${styles.ganttStatTile} ${data.failed_count > 0 ? styles.ganttStatTileRed : styles.ganttStatTileNeutral}`}
                >
                  <div
                    className={`${styles.ganttStatLabel} ${data.failed_count > 0 ? styles.ganttStatLabelRed : ""}`}
                  >
                    Failed Stages (✗)
                  </div>
                  <div
                    className={`${styles.ganttStatValue} ${data.failed_count > 0 ? styles.ganttStatValueRed : ""}`}
                  >
                    {data.failed_count}
                  </div>
                  <div className={styles.ganttStatSub}>
                    need rework
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className={styles.ganttLegend}>

                <span>
                  <span className={`${styles.ganttLegendSwatch} ${styles.ganttLegendSwatchPlanned}`} />
                  Planned
                </span>

                <span>
                  <span className={`${styles.ganttLegendSwatchActual} ${styles.ganttLegendSwatchDone}`} />
                  Done
                </span>

                <span>
                  <span className={`${styles.ganttLegendSwatchActual} ${styles.ganttLegendSwatchInProgress}`} />
                  In Progress
                </span>

                <span>
                  <span className={`${styles.ganttLegendSwatchActual} ${styles.ganttLegendSwatchFailed}`} />
                  Failed (✗)
                </span>
              </div>

              {/* Gantt rows */}
              <div className={styles.ganttBox}>

                {/* ---- Month pagination toolbar ---- */}
                {monthBuckets.length > 0 && (

                  <div className={styles.monthPaginator}>

                    <button
                      onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
                      disabled={safeMonthIdx === 0}
                      className={
                        safeMonthIdx === 0
                          ? `${styles.monthNavPrevBtn} ${styles.monthNavPrevBtnDisabled}`
                          : styles.monthNavPrevBtn
                      }
                    >
                      ‹ Prev
                    </button>

                    <div className={styles.monthPaginatorCenter}>

                      <div className={styles.monthLabel}>
                        {activeMonth?.label}
                      </div>

                      <div className={styles.monthRangePill}>
                        {visibleTimeline.length} days · day {windowStart}–{windowEnd}
                        &nbsp;·&nbsp; {windowedBars.length} stage(s)
                      </div>

                      {/* Pill nav — quick jump to any month */}
                      <div className={styles.monthNavPills}>

                        {monthBuckets.map((m, i) => (

                          <button
                            key={m.key}
                            onClick={() => setMonthIdx(i)}
                            title={m.label}
                            className={
                              i === safeMonthIdx
                                ? `${styles.monthNavPillBtn} ${styles.monthNavPillBtnActive}`
                                : styles.monthNavPillBtn
                            }
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        setMonthIdx((i) =>
                          Math.min(monthBuckets.length - 1, i + 1)
                        )
                      }
                      disabled={safeMonthIdx >= monthBuckets.length - 1}
                      className={
                        safeMonthIdx >= monthBuckets.length - 1
                          ? `${styles.monthNavPrevBtn} ${styles.monthNavPrevBtnDisabled}`
                          : styles.monthNavPrevBtn
                      }
                    >
                      Next ›
                    </button>
                  </div>
                )}

                <div className={styles.ganttColHeader}>
                  <div>Stage</div>
                  <TimelineHeader timeline={visibleTimeline} />
                  <div className={styles.ganttColHeaderRight}>Status / Action</div>
                </div>

                {windowedBars.length === 0 && (

                  <div className={styles.ganttEmptyMonth}>
                    No stages scheduled for {activeMonth?.label}.
                    Use the Prev / Next buttons to find this month's stages.
                  </div>
                )}

                {windowedBars.map((bar) => (

                  <GanttRow
                    key={bar.stage_id}
                    bar={bar}
                    timeline={visibleTimeline}
                    timelineDays={visibleTimeline.length || 30}
                    onUpdate={updateStage}
                    updating={updating}
                  />
                ))}
              </div>
            </>
          )}

        </div>
        {/* ---- end scrollable body ---- */}
      </div>
    </div>
  );
}


function StatusButtons({ wo, onUpdated }) {

  const next = {
    PLANNED: "IN_PROGRESS",
    IN_PROGRESS: "DONE",
    ON_HOLD: "IN_PROGRESS",
    DONE: null,
    CANCELLED: null
  }[wo.STATUS];

  const advance = async () => {

    if (!next) return;

    try {

      await API.patch(`/production/work-orders/${wo.ID}/status`, {
        STATUS: next
      });

      onUpdated?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed to update");
    }
  };

  const hold = async () => {

    try {

      await API.patch(`/production/work-orders/${wo.ID}/status`, {
        STATUS: "ON_HOLD"
      });

      onUpdated?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");
    }
  };

  if (!next) return <span className={styles.loadingText}>—</span>;

  return (

    <div className={styles.flexEnd}>

      <button
        onClick={advance}
        className={styles.btnAdvance}
      >
        → {next.replaceAll("_", " ")}
      </button>

      {wo.STATUS === "IN_PROGRESS" && (

        <button
          onClick={hold}
          className={styles.btnHold}
        >
          Hold
        </button>
      )}
    </div>
  );
}


function DeleteWOButton({ wo, onDeleted }) {

  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {

    const ok = window.confirm(
      `Delete ${wo.WO_NUMBER}?\n\n` +
      `This removes the work order and all its stage progress. ` +
      `QC inspections (if any) will block deletion. NCRs will be detached.`
    );

    if (!ok) return;

    setBusy(true);

    try {

      await API.delete(`/production/work-orders/${wo.ID}`);

      onDeleted?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Delete failed");

    } finally {

      setBusy(false);
    }
  };

  return (

    <button
      onClick={handleDelete}
      disabled={busy}
      title="Delete this work order"
      className={busy ? styles.btnDeleteWoBusy : styles.btnDeleteWo}
    >
      {busy ? "…" : "🗑 Delete"}
    </button>
  );
}


function NewWorkOrderForm({ models, onCreated }) {

  const [modelId, setModelId] = useState("");

  const [quantity, setQuantity] = useState(1);

  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {

    e.preventDefault();

    if (!modelId) {

      alert("Pick a model");

      return;
    }

    setSubmitting(true);

    try {

      await API.post("/production/work-orders", {
        PRODUCT_MODEL_ID: parseInt(modelId),
        QUANTITY: parseInt(quantity) || 1,
        NOTES: notes,
        VENDOR_ID: 1
      });

      setModelId("");

      setQuantity(1);

      setNotes("");

      onCreated?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to create WO");

    } finally {

      setSubmitting(false);
    }
  };

  return (

    <form
      onSubmit={submit}
      className={styles.newWoForm}
    >

      <div className={styles.newWoFieldModel}>

        <label className={styles.formFieldLabel}>
          Model
        </label>

        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className={styles.formInput}
        >
          <option value="">Pick a model…</option>
          {models.map((m) => (
            <option key={m.ID} value={m.ID}>
              {m.MODEL_CODE} — {m.MODEL_NAME}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.newWoFieldQty}>

        <label className={styles.formFieldLabel}>
          Quantity
        </label>

        <input
          type="number"
          min="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className={styles.formInput}
        />
      </div>

      <div className={styles.newWoFieldNotes}>

        <label className={styles.formFieldLabel}>
          Notes
        </label>

        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Chennai metro batch"
          className={styles.formInput}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className={submitting ? styles.btnCreateWoDisabled : styles.btnCreateWo}
      >
        {submitting ? "Creating…" : "+ Create WO"}
      </button>
    </form>
  );
}


function WorkOrdersTab() {

  const [wos, setWOs] = useState([]);

  const [models, setModels] = useState([]);

  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("");

  const [ganttWO, setGanttWO] = useState(null);

  const [drawerWO, setDrawerWO] = useState(null);

  const fetchAll = async () => {

    setLoading(true);

    try {

      const [woRes, mRes] = await Promise.all([
        API.get("/production/work-orders", {
          params: {
            vendor_id: 1,
            ...(statusFilter ? { status: statusFilter } : {})
          }
        }),
        API.get("/production/models", { params: { vendor_id: 1 } })
      ]);

      setWOs(woRes.data || []);

      setModels(mRes.data || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

  }, [statusFilter]);

  return (

    <div>

      <NewWorkOrderForm
        models={models}
        onCreated={fetchAll}
      />

      <div className={styles.filterBar}>

        {["", "PLANNED", "IN_PROGRESS", "ON_HOLD", "DONE", "CANCELLED"].map(
          (s) => (

            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              className={
                statusFilter === s
                  ? `${styles.filterBtn} ${styles.filterBtnActive}`
                  : styles.filterBtn
              }
            >
              {s ? s.replaceAll("_", " ") : "All"}
            </button>
          )
        )}
      </div>

      <div className={styles.woTableCard}>

        <div className={styles.tableScrollWrap}>

          <table className={styles.woTable}>

            <thead className={styles.woTableHead}>

              <tr>
                <th className={styles.woTh}>WO #</th>
                <th className={styles.woTh}>Model</th>
                <th className={styles.woThRight}>Qty</th>
                <th className={styles.woTh}>Status</th>
                <th className={styles.woTh}>Notes</th>
                <th className={styles.woTh}>Created</th>
                <th className={styles.woThRight}>Action</th>
              </tr>
            </thead>

            <tbody>

              {loading && (

                <tr>
                  <td colSpan="7" className={styles.tableEmptyCellCenter}>
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && wos.length === 0 && (

                <tr>
                  <td colSpan="7" className={styles.tableEmptyCellCenter}>
                    No work orders. Create one above.
                  </td>
                </tr>
              )}

              {wos.map((wo) => (

                <tr
                  key={wo.ID}
                  className={styles.woTr}
                >

                  <td className={styles.woTdMono}>
                    <button
                      onClick={() => setDrawerWO(wo.ID)}
                      title="Open 360° view"
                      className={styles.woLinkBtn}
                    >
                      {wo.WO_NUMBER}
                    </button>
                  </td>

                  <td className={styles.woTd}>

                    <div className={styles.woProductName}>
                      {wo.PRODUCT_MODEL_NAME || "—"}
                    </div>

                    <div className={styles.woProductCode}>
                      {wo.PRODUCT_MODEL_CODE}
                    </div>
                  </td>

                  <td className={styles.woTdRight}>
                    {wo.QUANTITY}
                  </td>

                  <td className={styles.woTd}>
                    <StatusBadge status={wo.STATUS} />
                  </td>

                  <td className={styles.woTdMuted}>
                    {wo.NOTES || "—"}
                  </td>

                  <td className={styles.woTdDate}>
                    {wo.CREATED_AT?.slice(0, 10)}
                  </td>

                  <td className={styles.woTdActions}>

                    <div className={styles.woActionsRow}>

                      <button
                        onClick={() => setGanttWO(wo)}
                        title="View Gantt timeline"
                        className={styles.btnTimeline}
                      >
                        📊 Timeline
                      </button>

                      <StatusButtons wo={wo} onUpdated={fetchAll} />

                      <DeleteWOButton wo={wo} onDeleted={fetchAll} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ganttWO && (

        <WOGanttDrawer
          wo={ganttWO}
          onClose={() => {

            setGanttWO(null);

            fetchAll();
          }}
        />
      )}

      <EntityDrawer
        open={drawerWO != null}
        type="work-order"
        id={drawerWO}
        onClose={() => setDrawerWO(null)}
      />
    </div>
  );
}


// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------

function Production() {

  const [tab, setTab] = useState("dashboard");

  return (

    <div className={styles.page}>

      <div className={styles.pageHeaderBlock}>

        <h1 className={styles.pageTitle}>
          Production & BOM
        </h1>

        <div className={styles.pageSubtitle}>
          Vending machine catalog · Bill of materials · Work order
          tracking
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabBar}>

        {[
          { key: "dashboard", label: "Dashboard" },
          { key: "models", label: "Machine Models" },
          { key: "work-orders", label: "Work Orders" }
        ].map((t) => (

          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? `${styles.tabBtn} ${styles.tabBtnActive}`
                : styles.tabBtn
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab />}

      {tab === "models" && <ModelsTab />}

      {tab === "work-orders" && <WorkOrdersTab />}
    </div>
  );
}


export default Production;
