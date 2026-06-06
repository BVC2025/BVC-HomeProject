import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";

import EntityDrawer from "../components/EntityDrawer";

import { bomIconTileStyle } from "../utils/bomIcons";


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
      style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        borderTop: `3px solid ${color}`
      }}
    >

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: "#64748b",
          textTransform: "uppercase"
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 6
        }}
      >
        {value}
      </div>

      {sub && (

        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            marginTop: 2
          }}
        >
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
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: t.bg,
        color: t.fg
      }}
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

  if (loading) return <div style={{ color: "#94a3b8" }}>Loading…</div>;

  if (!data) return <div style={{ color: "#b91c1c" }}>Could not load dashboard.</div>;

  return (

    <div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 24
        }}
      >

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

      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#475569",
            textTransform: "uppercase",
            marginBottom: 12
          }}
        >
          Top Active Models (units in pipeline)
        </div>

        {(!data.top_active_models || data.top_active_models.length === 0) && (

          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            No active work orders. Create one in the Work Orders tab.
          </div>
        )}

        {data.top_active_models?.map((m) => (

          <div
            key={m.MODEL_ID}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid #f1f5f9"
            }}
          >

            <div style={{ flex: 1 }}>

              <div style={{ fontWeight: 600, color: "#0f172a" }}>
                {m.MODEL_NAME}
              </div>

              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {m.MODEL_CODE}
              </div>
            </div>

            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1e40af"
              }}
            >
              {m.units}
            </div>

            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                marginLeft: 6
              }}
            >
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
// file picker to upload/replace the line's image.
function BomEditableRow({ item, onUploaded }) {

  const [uploading, setUploading] = useState(false);

  const [error, setError] = useState("");

  const fileInputId = `bom-img-${item.ID}`;

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

    <tr style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "middle" }}>

      {/* Preview cell */}
      <td style={{
        padding: 6,
        borderRight: "1px solid #f1f5f9",
        textAlign: "center"
      }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.MATERIAL_NAME}
            style={{
              width: 76,
              height: 76,
              objectFit: "contain",
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: 10
            }}
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
      <td style={{
        padding: 6,
        borderRight: "1px solid #f1f5f9",
        textAlign: "center",
        fontFamily: "ui-monospace, monospace",
        fontWeight: 700,
        fontSize: 14,
        color: "#475569"
      }}>
        {item.ITEM_NO ?? "—"}
      </td>

      {/* Part Number + meta */}
      <td style={{
        padding: 8,
        borderRight: "1px solid #f1f5f9"
      }}>
        <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>
          {item.MATERIAL_NAME}
        </div>
        <div style={{
          display: "flex",
          gap: 6,
          marginTop: 4,
          flexWrap: "wrap",
          alignItems: "center"
        }}>
          <span style={{
            fontSize: 10,
            padding: "1px 8px",
            borderRadius: 999,
            fontWeight: 700,
            background: isPurchase ? "#dbeafe" : "#ede9fe",
            color: isPurchase ? "#1e40af" : "#6d28d9"
          }}>
            {isPurchase ? "PURCHASE" : "PROCESS"}
          </span>
          {isPurchase && item.PREFERRED_SUPPLIER_NAME && (
            <span style={{ fontSize: 10, color: "#64748b" }}>
              🏢 {item.PREFERRED_SUPPLIER_NAME}
            </span>
          )}
          {isPurchase && !item.PREFERRED_SUPPLIER_NAME && (
            <span style={{ fontSize: 10, color: "#b91c1c" }}>
              No supplier set
            </span>
          )}
          {!isPurchase && (
            <span style={{ fontSize: 10, color: "#64748b" }}>
              Stage: {item.PROCESS_STAGE_NAME || "—"}
            </span>
          )}
        </div>
      </td>

      {/* Qty */}
      <td style={{
        padding: 6,
        textAlign: "center",
        borderRight: "1px solid #f1f5f9",
        fontWeight: 800,
        fontSize: 14,
        color: "#0f172a"
      }}>
        {item.QUANTITY}
        <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 500 }}>
          {item.UNIT}
        </div>
      </td>

      {/* Upload control */}
      <td style={{ padding: 6, textAlign: "center" }}>
        <input
          id={fileInputId}
          type="file"
          accept="image/*"
          onChange={handleFile}
          style={{ display: "none" }}
        />
        <label
          htmlFor={fileInputId}
          style={{
            display: "inline-block",
            padding: "6px 10px",
            border: "1px solid #c7d2fe",
            background: uploading ? "#cbd5e1" : "#eef2ff",
            color: uploading ? "#94a3b8" : "#4338ca",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            cursor: uploading ? "default" : "pointer",
            pointerEvents: uploading ? "none" : "auto"
          }}
        >
          {uploading ? "Uploading…" : imageUrl ? "🔄 Replace" : "📷 Upload"}
        </label>
        {error && (
          <div style={{ fontSize: 10, color: "#b91c1c", marginTop: 4 }}>
            {error}
          </div>
        )}
      </td>

    </tr>
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 900
      }}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "100%",
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
            marginBottom: 18
          }}
        >

          <div>

            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#0f172a"
              }}
            >
              {m?.MODEL_NAME || "Loading…"}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#64748b",
                marginTop: 2,
                fontFamily: "ui-monospace, monospace"
              }}
            >
              {m?.MODEL_CODE}
              {m?.CATEGORY && (
                <span style={{ marginLeft: 8 }}>
                  · {m.CATEGORY}
                </span>
              )}
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

        {m?.DESCRIPTION && (

          <div
            style={{
              fontSize: 13,
              color: "#475569",
              marginBottom: 14,
              padding: 10,
              background: "#f8fafc",
              borderRadius: 8
            }}
          >
            {m.DESCRIPTION}
          </div>
        )}

        {m && (

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 20
            }}
          >
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

        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#475569",
            textTransform: "uppercase",
            marginBottom: 8
          }}
        >
          Bill of Materials
        </div>

        {loading && <div style={{ color: "#94a3b8" }}>Loading BOM…</div>}

        {!loading && bom.length === 0 && (

          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            No BOM items yet.
          </div>
        )}

        {bom.length > 0 && (

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              border: "1px solid #cbd5e1"
            }}
          >
            <thead>
              <tr
                style={{
                  background: "#f1f5f9",
                  color: "#475569",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.5
                }}
              >
                <th style={{ padding: 8, borderBottom: "1px solid #cbd5e1", width: 90, textAlign: "center" }}>
                  Document Preview
                </th>
                <th style={{ padding: 8, borderBottom: "1px solid #cbd5e1", width: 70, textAlign: "center" }}>
                  Item No.
                </th>
                <th style={{ padding: 8, borderBottom: "1px solid #cbd5e1", textAlign: "left" }}>
                  Part Number
                </th>
                <th style={{ padding: 8, borderBottom: "1px solid #cbd5e1", width: 70, textAlign: "center" }}>
                  Qty.
                </th>
                <th style={{ padding: 8, borderBottom: "1px solid #cbd5e1", width: 130, textAlign: "center" }}>
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
                />
              ))}
            </tbody>
          </table>
        )}

        {data?.stages?.length > 0 && (

          <div style={{ marginTop: 28 }}>

            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1,
                color: "#475569",
                textTransform: "uppercase",
                marginBottom: 8
              }}
            >
              Process Stages ({data.stages.length})
            </div>

            {data.stages.map((s) => (

              <div
                key={s.ID}
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid #f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  gap: 12
                }}
              >

                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#eff6ff",
                    color: "#1e40af",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 12,
                    fontFamily: "ui-monospace, monospace"
                  }}
                >
                  {s.SEQUENCE}
                </div>

                <div style={{ flex: 1 }}>

                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#0f172a"
                    }}
                  >
                    {s.STAGE_NAME}
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748b",
                      marginTop: 2
                    }}
                  >
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 980,
        padding: 20
      }}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: "100%",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(15,23,42,0.4)"
        }}
      >

        {/* Sticky header — BVC red gradient (destructive style) */}
        <div
          style={{
            flexShrink: 0,
            background:
              "linear-gradient(120deg, #1A0508 0%, #4A0E18 30%, #8B0B1F 70%, #C8102E 100%)",
            color: "white",
            padding: "20px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start"
          }}
        >

          <div>

            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                opacity: 0.85
              }}
            >
              Destructive Admin Action
            </div>

            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                marginTop: 4,
                letterSpacing: -0.3
              }}
            >
              ♻ Reset & Reseed All BOMs
            </div>

            <div
              style={{
                fontSize: 12,
                opacity: 0.9,
                marginTop: 4,
                maxWidth: 560
              }}
            >
              Wipes every BOM row for vendor #{vendorId} and reseeds
              category-aware components per machine type. Existing PO
              lines stay intact — their BOM link is just nulled out.
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={phase === "running"}
            style={{
              border: "none",
              background: "rgba(255,255,255,0.18)",
              color: "white",
              padding: "4px 12px",
              borderRadius: 8,
              cursor: phase === "running" ? "not-allowed" : "pointer",
              fontSize: 20,
              fontWeight: 700
            }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: 24,
            background: "#f8fafc"
          }}
        >

          {/* ---- LOADING (dry-run in flight) ---- */}
          {phase === "loading" && (

            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#64748b",
                fontSize: 14
              }}
            >
              🔎 Loading dry-run preview…
            </div>
          )}

          {/* ---- ERROR ---- */}
          {phase === "error" && (

            <div
              style={{
                padding: 18,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 12,
                color: "#991b1b",
                fontSize: 13,
                lineHeight: 1.6
              }}
            >

              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                Something went wrong
              </div>

              <div>{error}</div>
            </div>
          )}

          {/* ---- STEP 1: DRY-RUN PREVIEW ---- */}
          {(phase === "preview" || phase === "running") && preview && (

            <>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 18
                }}
              >

                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 12,
                    padding: 14
                  }}
                >

                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      color: "#991b1b",
                      textTransform: "uppercase"
                    }}
                  >
                    Will Wipe
                  </div>

                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 800,
                      color: "#7f1d1d",
                      marginTop: 4
                    }}
                  >
                    {wipeWouldDelete}
                  </div>

                  <div
                    style={{ fontSize: 11, color: "#991b1b" }}
                  >
                    BOM rows across {models.length} model(s)
                  </div>
                </div>

                <div
                  style={{
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                    borderRadius: 12,
                    padding: 14
                  }}
                >

                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      color: "#065f46",
                      textTransform: "uppercase"
                    }}
                  >
                    Will Seed
                  </div>

                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 800,
                      color: "#064e3b",
                      marginTop: 4
                    }}
                  >
                    {totalSeedLines}
                  </div>

                  <div
                    style={{ fontSize: 11, color: "#065f46" }}
                  >
                    new BOM rows across {previewSeedEntries.length}{" "}
                    model(s)
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "#475569",
                  marginBottom: 8
                }}
              >
                Per-product breakdown
              </div>

              <div
                style={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  overflow: "hidden"
                }}
              >

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13
                  }}
                >

                  <thead>

                    <tr
                      style={{
                        background: "#f1f5f9",
                        color: "#475569",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.8
                      }}
                    >
                      <th
                        style={{ padding: 10, textAlign: "left" }}
                      >
                        Product
                      </th>
                      <th
                        style={{ padding: 10, textAlign: "left" }}
                      >
                        Machine Type
                      </th>
                      <th
                        style={{
                          padding: 10,
                          textAlign: "right",
                          width: 110
                        }}
                      >
                        BOM Lines
                      </th>
                    </tr>
                  </thead>

                  <tbody>

                    {previewSeedEntries.length === 0 && (

                      <tr>
                        <td
                          colSpan="3"
                          style={{
                            padding: 24,
                            textAlign: "center",
                            color: "#94a3b8"
                          }}
                        >
                          No products to reseed.
                        </td>
                      </tr>
                    )}

                    {previewSeedEntries.map(([pid, info]) => (

                      <tr
                        key={pid}
                        style={{
                          borderTop: "1px solid #f1f5f9"
                        }}
                      >

                        <td
                          style={{
                            padding: 10,
                            fontWeight: 600,
                            color: "#0f172a"
                          }}
                        >
                          {info.product_name || `Model #${pid}`}
                        </td>

                        <td style={{ padding: 10 }}>

                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 10px",
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 700,
                              background: "#eef2ff",
                              color: "#4338ca",
                              textTransform: "uppercase",
                              letterSpacing: 0.6
                            }}
                          >
                            {info.machine_type || "generic"}
                          </span>
                        </td>

                        <td
                          style={{
                            padding: 10,
                            textAlign: "right",
                            fontWeight: 700,
                            color: "#0f172a"
                          }}
                        >
                          {info.bom_lines_seeded ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "#92400e",
                  lineHeight: 1.6
                }}
              >
                ⚠ This action is irreversible. Existing BOM rows for
                this vendor will be deleted and replaced with fresh
                category-aware components. Past PO/GRN data survives —
                their BOM line link is just nulled out.
              </div>
            </>
          )}

          {/* ---- STEP 3: SUCCESS ---- */}
          {phase === "success" && result && (

            <div
              style={{
                padding: 22,
                background: "#ecfdf5",
                border: "1px solid #a7f3d0",
                borderRadius: 14,
                color: "#064e3b"
              }}
            >

              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  marginBottom: 6
                }}
              >
                ✅ BOM reset &amp; reseed complete
              </div>

              <div style={{ fontSize: 13, marginBottom: 14 }}>
                {result.message ||
                  "Wiped and reseeded successfully."}
                {" "}This window closes automatically in 5 seconds.
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                  marginBottom: 16
                }}
              >

                <div
                  style={{
                    background: "white",
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #d1fae5"
                  }}
                >

                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#065f46",
                      letterSpacing: 0.8,
                      textTransform: "uppercase"
                    }}
                  >
                    BOM rows deleted
                  </div>

                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: "#0f172a",
                      marginTop: 2
                    }}
                  >
                    {result.wipe_summary?.bom_items_deleted ?? 0}
                  </div>
                </div>

                <div
                  style={{
                    background: "white",
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #d1fae5"
                  }}
                >

                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#065f46",
                      letterSpacing: 0.8,
                      textTransform: "uppercase"
                    }}
                  >
                    PO lines nulled
                  </div>

                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: "#0f172a",
                      marginTop: 2
                    }}
                  >
                    {result.wipe_summary?.po_lines_nulled ?? 0}
                  </div>
                </div>

                <div
                  style={{
                    background: "white",
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #d1fae5"
                  }}
                >

                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#065f46",
                      letterSpacing: 0.8,
                      textTransform: "uppercase"
                    }}
                  >
                    Rows seeded
                  </div>

                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: "#0f172a",
                      marginTop: 2
                    }}
                  >
                    {resultSeededTotal}
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "#065f46",
                  marginBottom: 6
                }}
              >
                Per-product result
              </div>

              <div
                style={{
                  background: "white",
                  border: "1px solid #d1fae5",
                  borderRadius: 10,
                  maxHeight: 220,
                  overflowY: "auto"
                }}
              >

                {resultSeedEntries.map(([pid, info]) => (

                  <div
                    key={pid}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      borderBottom: "1px solid #ecfdf5",
                      fontSize: 12
                    }}
                  >

                    <div style={{ color: "#0f172a", fontWeight: 600 }}>
                      {info.product_name || `Model #${pid}`}{" "}

                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          color: "#4338ca",
                          textTransform: "uppercase",
                          fontWeight: 700,
                          letterSpacing: 0.5
                        }}
                      >
                        [{info.machine_type || "generic"}]
                      </span>
                    </div>

                    <div
                      style={{
                        fontWeight: 700,
                        color: "#065f46"
                      }}
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

          <div
            style={{
              flexShrink: 0,
              padding: "14px 24px",
              background: "white",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              gap: 10,
              justifyContent: "flex-end"
            }}
          >

            <button
              onClick={onClose}
              disabled={phase === "running"}
              style={{
                border: "1px solid #e2e8f0",
                background: "white",
                color: "#475569",
                padding: "10px 18px",
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                cursor: phase === "running" ? "not-allowed" : "pointer"
              }}
            >
              Cancel
            </button>

            {phase === "preview" && (

              <button
                onClick={confirmReset}
                disabled={previewSeedEntries.length === 0}
                style={{
                  border: "none",
                  background:
                    previewSeedEntries.length === 0
                      ? "#94a3b8"
                      : "linear-gradient(120deg, #f59e0b 0%, #C8102E 100%)",
                  color: "white",
                  padding: "10px 22px",
                  borderRadius: 10,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor:
                    previewSeedEntries.length === 0
                      ? "not-allowed"
                      : "pointer",
                  boxShadow: "0 8px 20px rgba(200,16,46,0.25)",
                  letterSpacing: 0.4
                }}
              >
                ♻ Confirm reset &amp; reseed
              </button>
            )}

            {phase === "running" && (

              <button
                disabled
                style={{
                  border: "none",
                  background: "#94a3b8",
                  color: "white",
                  padding: "10px 22px",
                  borderRadius: 10,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "not-allowed"
                }}
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 980,
        padding: 20
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: "100%",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(15,23,42,0.4)"
        }}
      >

        {/* Sticky header */}
        <div style={{
          flexShrink: 0,
          background: "linear-gradient(120deg, #1e1b4b 0%, #312e81 35%, #6366f1 75%, #8B0B1F 100%)",
          color: "white",
          padding: "20px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start"
        }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 2,
              textTransform: "uppercase", opacity: 0.85
            }}>
              Destructive Admin Action
            </div>
            <div style={{
              fontSize: 22, fontWeight: 800, marginTop: 4, letterSpacing: -0.3
            }}>
              🏭 Reset Manufacturing Stages (40)
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
              Replaces every product's stages with the canonical
              40-step flow: Design → BOM → Procurement → Fabrication
              → Wiring → Software → Testing → Dispatch → Installation
              → Handover.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none", color: "white",
              width: 32, height: 32, borderRadius: 8,
              cursor: "pointer", fontSize: 18, fontWeight: 700
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: "auto", padding: 22
        }}>

          {phase === "loading" && (
            <div style={{ color: "#94a3b8", textAlign: "center", padding: 30 }}>
              🔎 Loading dry-run preview…
            </div>
          )}

          {phase === "error" && (
            <div style={{
              padding: 16, background: "#fef2f2",
              border: "1px solid #fecaca", borderRadius: 10,
              color: "#991b1b", fontSize: 13
            }}>
              ⚠ {error}
            </div>
          )}

          {phase === "preview" && preview && (
            <>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginBottom: 16
              }}>
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

              <div style={{
                background: "#eef2ff",
                border: "1px solid #c7d2fe",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12,
                color: "#3730a3",
                marginBottom: 14
              }}>
                ⏱️ Estimated duration per build:
                <b> {preview.estimated_days_per_build || "—"} working days</b>
                {" "}(roughly {Math.ceil((preview.estimated_days_per_build || 0) / 5)} weeks
                at 5-day weeks).
              </div>

              <div style={{
                background: "#fefce8",
                border: "1px solid #fde68a",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12,
                color: "#854d0e",
                marginBottom: 14
              }}>
                <b>FK-safe wipe</b>: stages currently in use by Work
                Order progress rows get soft-disabled (IS_ACTIVE=0),
                NOT deleted — your existing in-progress Gantt charts
                stay intact. Only new work orders pick up the 40-stage
                flow.
              </div>

              {(preview.per_product || []).length > 0 && (
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  overflow: "hidden"
                }}>
                  <table style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12
                  }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={th()}>Product</th>
                        <th style={th()}>Category</th>
                        <th style={{ ...th(), textAlign: "right" }}>Stages to seed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.per_product.map((p) => (
                        <tr key={p.product_model_id} style={{
                          borderTop: "1px solid #f1f5f9"
                        }}>
                          <td style={td()}>
                            <div style={{ fontWeight: 700 }}>{p.model_name}</div>
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>
                              {p.model_code}
                            </div>
                          </td>
                          <td style={td()}>
                            <span style={{
                              fontSize: 10, fontWeight: 700,
                              padding: "2px 8px", borderRadius: 999,
                              background: "#eef2ff", color: "#3730a3"
                            }}>
                              {p.category || "generic"}
                            </span>
                          </td>
                          <td style={{ ...td(), textAlign: "right", fontWeight: 800, color: "#0f172a" }}>
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
            <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                ⚙ Reseeding stages…
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
                Hold tight, this usually takes a couple of seconds.
              </div>
            </div>
          )}

          {phase === "success" && result && (
            <div style={{
              background: "linear-gradient(135deg, #f0fdf4, #dcfce7)",
              border: "2px solid #16a34a",
              borderRadius: 14,
              padding: 18
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800,
                letterSpacing: 1.4, color: "#14532d",
                marginBottom: 8
              }}>
                ✅ STAGES RESET COMPLETE
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                <SummaryTile label="Wiped" value={result.wiped_count || 0} color="#ef4444" />
                <SummaryTile label="Soft-disabled" value={result.soft_disabled_count || 0} color="#f59e0b" />
                <SummaryTile label="Seeded" value={result.seeded_count || 0} color="#16a34a" />
              </div>
              <div style={{ fontSize: 12, color: "#166534" }}>
                {result.message}
              </div>
              <div style={{
                marginTop: 10,
                fontSize: 11,
                color: "#475569"
              }}>
                Auto-closing in 5 seconds…
              </div>
            </div>
          )}

        </div>

        {/* Sticky footer */}
        {(phase === "preview" || phase === "error") && (
          <div style={{
            flexShrink: 0,
            padding: "14px 22px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            background: "#f8fafc"
          }}>
            <button
              onClick={onClose}
              style={{
                padding: "10px 18px",
                background: "white",
                color: "#475569",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer"
              }}
            >
              Cancel
            </button>
            {phase === "preview" && (
              <button
                onClick={confirmReset}
                style={{
                  padding: "10px 22px",
                  background: "linear-gradient(120deg, #6366f1 0%, #8B0B1F 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                  boxShadow: "0 6px 18px rgba(99,102,241,0.35)"
                }}
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
    <div style={{
      background: "white",
      border: `1px solid ${color}33`,
      borderRadius: 10,
      padding: "10px 12px",
      borderTop: `3px solid ${color}`
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.8,
        color: "#64748b",
        textTransform: "uppercase"
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 900,
        color,
        marginTop: 4
      }}>
        {value}
      </div>
    </div>
  );
}


function th() {
  return {
    padding: "8px 10px",
    textAlign: "left",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 0.8,
    color: "#475569",
    textTransform: "uppercase"
  };
}


function td() {
  return {
    padding: "8px 10px",
    color: "#0f172a"
  };
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

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            flexWrap: "wrap"
          }}
        >

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "#94a3b8"
            }}
          >
            Admin
          </div>

          <button
            onClick={() => setShowResetModal(true)}
            disabled={loading || models.length === 0}
            title="Wipe every BOM row for this vendor and reseed category-aware components per machine type"
            style={{
              border: "none",
              background:
                loading || models.length === 0
                  ? "#cbd5e1"
                  : "linear-gradient(120deg, #f59e0b 0%, #C8102E 100%)",
              color: "white",
              padding: "10px 18px",
              borderRadius: 10,
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: 0.5,
              cursor:
                loading || models.length === 0
                  ? "not-allowed"
                  : "pointer",
              boxShadow:
                loading || models.length === 0
                  ? "none"
                  : "0 8px 20px rgba(200,16,46,0.25)"
            }}
          >
            ♻ Reset &amp; Reseed All BOMs
          </button>

          <button
            onClick={() => setShowStageResetModal(true)}
            disabled={loading || models.length === 0}
            title="Replace the manufacturing-stages flow for every product with the canonical 40-stage catalogue (Design → Procurement → Fabrication → Wiring → Software → Testing → Dispatch → Installation → Handover)"
            style={{
              border: "none",
              background:
                loading || models.length === 0
                  ? "#cbd5e1"
                  : "linear-gradient(120deg, #6366f1 0%, #8B0B1F 100%)",
              color: "white",
              padding: "10px 18px",
              borderRadius: 10,
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: 0.5,
              cursor:
                loading || models.length === 0
                  ? "not-allowed"
                  : "pointer",
              boxShadow:
                loading || models.length === 0
                  ? "none"
                  : "0 8px 20px rgba(99,102,241,0.25)"
            }}
          >
            🏭 Reset &amp; Reseed Stages (40)
          </button>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16
        }}
      >

        {loading && (
          <div style={{ color: "#94a3b8" }}>Loading models…</div>
        )}

        {!loading && models.length === 0 && (

          <div
            style={{
              gridColumn: "1 / -1",
              padding: 40,
              textAlign: "center",
              color: "#94a3b8",
              background: "white",
              borderRadius: 12
            }}
          >
            No product models yet. Run <code>/demo/seed-bvc24</code>
            {" "}to seed BVC24's catalog.
          </div>
        )}

        {models.map((m) => (

          <div
            key={m.ID}
            onClick={() => setSelectedId(m.ID)}
            style={{
              background: "white",
              padding: 18,
              borderRadius: 12,
              boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
              cursor: "pointer",
              transition: "transform 0.15s",
              borderLeft:
                m.STATUS === "ACTIVE"
                  ? "4px solid #22c55e"
                  : "4px solid #94a3b8"
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.transform = "translateY(-2px)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.transform = "translateY(0)")
            }
          >

            <div
              style={{
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                color: "#64748b",
                marginBottom: 4
              }}
            >
              {m.MODEL_CODE}
            </div>

            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#0f172a"
              }}
            >
              {m.MODEL_NAME}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#475569",
                marginTop: 4
              }}
            >
              {m.CATEGORY || "uncategorized"}
              {" · "}
              {m.ESTIMATED_BUILD_DAYS}d build
            </div>

            {m.DESCRIPTION && (

              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  marginTop: 8,
                  lineHeight: 1.5
                }}
              >
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

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr 180px",
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid #f1f5f9",
        alignItems: "center"
      }}
    >

      {/* Stage label column */}
      <div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8
          }}
        >

          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: `${typeColor}22`,
              color: typeColor,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "ui-monospace, monospace",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            {bar.sequence}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>

            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a"
              }}
            >
              {bar.stage_name}
            </div>

            <div
              style={{
                fontSize: 10,
                color: typeColor,
                fontWeight: 600,
                marginTop: 2
              }}
            >
              {bar.stage_type} · {bar.estimated_hours}h
              {" · "}
              <span style={{ color: "#0f172a" }}>
                ⏱ {bar.days_allocated ?? "—"} day
                {Number(bar.days_allocated) === 1 ? "" : "s"}
              </span>
              {bar.actual_hours != null && (
                <span style={{ color: "#475569" }}>
                  {" "}/ actual {bar.actual_hours}h
                </span>
              )}
            </div>

            {/* Assignee chip — visible for every stage */}
            <div
              style={{
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11
              }}
            >
              {bar.assignee_name ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: 10,
                    border: "1px solid #bfdbfe"
                  }}
                >
                  👤 {bar.assignee_name}
                  {bar.assignee_code && (
                    <span
                      style={{
                        opacity: 0.7,
                        fontWeight: 500
                      }}
                    >
                      ({bar.assignee_code})
                    </span>
                  )}
                </span>
              ) : (
                <span
                  style={{
                    color: "#94a3b8",
                    fontSize: 10,
                    fontStyle: "italic"
                  }}
                >
                  unassigned
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Gantt bar column — aligned to the Day-1→Day-30 header */}
      <div
        style={{
          position: "relative",
          height: 42,
          background: "#f8fafc",
          borderRadius: 6,
          overflow: "hidden"
        }}
      >

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
                  ? "1px solid #f1f5f9"
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
              color: "#475569",
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
      <div
        style={{
          display: "flex",
          gap: 4,
          justifyContent: "flex-end"
        }}
      >

        <span
          style={{
            display: "inline-block",
            padding: "3px 8px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            background: theme.bg,
            color: theme.fg
          }}
        >
          {bar.status?.replaceAll("_", " ")}
        </span>

        <div
          style={{
            display: "flex",
            gap: 2,
            marginLeft: 6
          }}
        >

          {bar.status === "PENDING" && (

            <button
              disabled={updating}
              onClick={() =>
                onUpdate(bar.stage_id, "IN_PROGRESS")
              }
              title="Start"
              style={{
                border: "none",
                background: "#f59e0b",
                color: "white",
                width: 26,
                height: 26,
                borderRadius: 5,
                cursor: updating ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 12
              }}
            >
              ▶
            </button>
          )}

          {bar.status !== "DONE" && bar.status !== "FAILED" && (

            <button
              disabled={updating}
              onClick={() => onUpdate(bar.stage_id, "DONE")}
              title="Mark done"
              style={{
                border: "none",
                background: "#22c55e",
                color: "white",
                width: 26,
                height: 26,
                borderRadius: 5,
                cursor: updating ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 14
              }}
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
              style={{
                border: "none",
                background: "#ef4444",
                color: "white",
                width: 26,
                height: 26,
                borderRadius: 5,
                cursor: updating ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 14
              }}
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
      style={{
        position: "relative",
        height: headerHeight,
        background: "#f8fafc",
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid #e2e8f0"
      }}
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
                  ? "1px solid #e2e8f0"
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
                color: d.is_sunday ? "#991b1b" : "#0f172a",
                lineHeight: 1
              }}
            >
              {d.day_number}
            </div>

            {showDate && (

              <div
                style={{
                  fontSize: mode === "compact" ? 8 : 9,
                  color: d.is_sunday ? "#991b1b" : "#475569",
                  fontWeight: 700,
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  // In compact mode allow the label to spill into the
                  // adjacent (blank) cells — common Gantt-chart pattern.
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
                color: d.is_sunday ? "#991b1b" : "#94a3b8",
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 950
      }}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "98vw",
          maxWidth: "100%",
          height: "100vh",
          background: "white",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.3)"
        }}
      >

        {/* ---- Sticky header (always visible while body scrolls) ---- */}
        <div
          style={{
            flexShrink: 0,
            padding: "20px 24px",
            borderBottom: "1px solid #e2e8f0",
            background: "white",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start"
          }}
        >

          <div>

            <div
              style={{
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                color: "#64748b",
                letterSpacing: 1
              }}
            >
              {wo.WO_NUMBER}
            </div>

            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#0f172a",
                marginTop: 2
              }}
            >
              {wo.PRODUCT_MODEL_NAME}
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#64748b",
                marginTop: 2
              }}
            >
              {wo.QUANTITY} units · {wo.PRODUCT_MODEL_CODE}
              {wo.NOTES && ` · ${wo.NOTES}`}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>

            {data && (
              <button
                onClick={resyncStages}
                disabled={resyncing || loading}
                title="Wipe this WO's stage rows and re-spawn against the current active stage template (40 stages). Refuses if any stage is started."
                style={{
                  border: "none",
                  background: resyncing
                    ? "#94a3b8"
                    : "linear-gradient(135deg,#4f46e5,#C8102E)",
                  color: "white",
                  padding: "10px 16px",
                  borderRadius: 8,
                  cursor: resyncing ? "wait" : "pointer",
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: 0.3,
                  boxShadow: "0 4px 14px rgba(200,16,46,0.30)"
                }}
              >
                {resyncing
                  ? "Resyncing…"
                  : `♻ Resync to 40-stage flow (currently ${data.total_stages || 0})`}
              </button>
            )}

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
        </div>

        {/* ---- Scrollable body ---- */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: 24
          }}
        >

        {loading && (
          <div style={{ color: "#94a3b8" }}>Loading timeline…</div>
        )}

        {data && (

          <>

            {/* Summary tiles */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
                marginBottom: 20
              }}
            >

              <div
                style={{
                  padding: 12,
                  background: "#eff6ff",
                  borderRadius: 8
                }}
              >

                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#1e40af",
                    textTransform: "uppercase",
                    letterSpacing: 0.8
                  }}
                >
                  Progress
                </div>

                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#0f172a",
                    marginTop: 2
                  }}
                >
                  {progressPct}%
                </div>

                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {data.completed_count} / {data.total_stages} done
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  background: "#f0fdf4",
                  borderRadius: 8
                }}
              >

                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#166534",
                    textTransform: "uppercase",
                    letterSpacing: 0.8
                  }}
                >
                  Planned
                </div>

                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#0f172a",
                    marginTop: 2
                  }}
                >
                  {Math.round(
                    (data.total_planned_hours || 0) / 8
                  )} days
                </div>

                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {data.total_stages || 0} stages ·{" "}
                  {data.total_planned_hours || 0}h total · Sundays off
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  background: "#fefce8",
                  borderRadius: 8
                }}
              >

                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#854d0e",
                    textTransform: "uppercase",
                    letterSpacing: 0.8
                  }}
                >
                  Actual So Far
                </div>

                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#0f172a",
                    marginTop: 2
                  }}
                >
                  {data.total_actual_hours}h
                </div>

                <div style={{ fontSize: 11, color: "#64748b" }}>
                  measured from completed stages
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  background: data.failed_count > 0 ? "#fef2f2" : "#f1f5f9",
                  borderRadius: 8
                }}
              >

                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color:
                      data.failed_count > 0 ? "#b91c1c" : "#475569",
                    textTransform: "uppercase",
                    letterSpacing: 0.8
                  }}
                >
                  Failed Stages (✗)
                </div>

                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color:
                      data.failed_count > 0 ? "#b91c1c" : "#0f172a",
                    marginTop: 2
                  }}
                >
                  {data.failed_count}
                </div>

                <div style={{ fontSize: 11, color: "#64748b" }}>
                  need rework
                </div>
              </div>
            </div>

            {/* Legend */}
            <div
              style={{
                display: "flex",
                gap: 16,
                fontSize: 11,
                color: "#64748b",
                marginBottom: 10,
                alignItems: "center",
                flexWrap: "wrap"
              }}
            >

              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: 18,
                    height: 8,
                    background: "#cbd5e133",
                    border: "1px dashed #94a3b8",
                    borderRadius: 3,
                    marginRight: 4,
                    verticalAlign: "middle"
                  }}
                />
                Planned
              </span>

              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: 18,
                    height: 10,
                    background: "#22c55e",
                    borderRadius: 3,
                    marginRight: 4,
                    verticalAlign: "middle"
                  }}
                />
                Done
              </span>

              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: 18,
                    height: 10,
                    background: "#f59e0b",
                    borderRadius: 3,
                    marginRight: 4,
                    verticalAlign: "middle"
                  }}
                />
                In Progress
              </span>

              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: 18,
                    height: 10,
                    background: "#ef4444",
                    borderRadius: 3,
                    marginRight: 4,
                    verticalAlign: "middle"
                  }}
                />
                Failed (✗)
              </span>
            </div>

            {/* Gantt rows — sized to fit all 30 day cells on screen
                without horizontal scroll. Stage label + action
                columns are tightened to leave maximum room for the
                timeline. */}
            <div
              style={{
                background: "white",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "8px 12px"
              }}
            >

              {/* ---- Month pagination toolbar ---- */}
              {monthBuckets.length > 0 && (

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 10,
                    padding: "8px 12px",
                    background: "#f8fafc",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0"
                  }}
                >

                  <button
                    onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
                    disabled={safeMonthIdx === 0}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "1px solid #cbd5e1",
                      background: safeMonthIdx === 0 ? "#f1f5f9" : "white",
                      cursor: safeMonthIdx === 0 ? "not-allowed" : "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                      color: safeMonthIdx === 0 ? "#94a3b8" : "#0f172a"
                    }}
                  >
                    ‹ Prev
                  </button>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flex: 1,
                      justifyContent: "center"
                    }}
                  >

                    <div style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#0f172a",
                      letterSpacing: 0.3
                    }}>
                      {activeMonth?.label}
                    </div>

                    <div style={{
                      fontSize: 11,
                      color: "#64748b",
                      padding: "3px 10px",
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 99,
                      fontWeight: 700
                    }}>
                      {visibleTimeline.length} days · day {windowStart}–{windowEnd}
                      &nbsp;·&nbsp; {windowedBars.length} stage(s)
                    </div>

                    {/* Pill nav — quick jump to any month */}
                    <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>

                      {monthBuckets.map((m, i) => (

                        <button
                          key={m.key}
                          onClick={() => setMonthIdx(i)}
                          title={m.label}
                          style={{
                            width: 26,
                            height: 26,
                            border: "1px solid",
                            borderColor: i === safeMonthIdx ? "#6366f1" : "#e2e8f0",
                            background: i === safeMonthIdx ? "#6366f1" : "white",
                            color: i === safeMonthIdx ? "white" : "#475569",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontWeight: 700,
                            fontSize: 11
                          }}
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
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "1px solid #cbd5e1",
                      background:
                        safeMonthIdx >= monthBuckets.length - 1
                          ? "#f1f5f9"
                          : "white",
                      cursor:
                        safeMonthIdx >= monthBuckets.length - 1
                          ? "not-allowed"
                          : "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                      color:
                        safeMonthIdx >= monthBuckets.length - 1
                          ? "#94a3b8"
                          : "#0f172a"
                    }}
                  >
                    Next ›
                  </button>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "240px 1fr 180px",
                  gap: 10,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: "#94a3b8",
                  paddingBottom: 6,
                  borderBottom: "1px solid #f1f5f9",
                  alignItems: "end"
                }}
              >
                <div>Stage</div>
                <TimelineHeader timeline={visibleTimeline} />
                <div style={{ textAlign: "right" }}>Status / Action</div>
              </div>

              {windowedBars.length === 0 && (

                <div style={{
                  padding: "30px 12px",
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: 13
                }}>
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

  if (!next) return <span style={{ color: "#94a3b8" }}>—</span>;

  return (

    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>

      <button
        onClick={advance}
        style={{
          border: "none",
          background: "#1e40af",
          color: "white",
          padding: "5px 10px",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600
        }}
      >
        → {next.replaceAll("_", " ")}
      </button>

      {wo.STATUS === "IN_PROGRESS" && (

        <button
          onClick={hold}
          style={{
            border: "1px solid #e2e8f0",
            background: "white",
            padding: "5px 10px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 11,
            color: "#475569"
          }}
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
      style={{
        border: "1px solid #fecaca",
        background: busy ? "#f1f5f9" : "#fef2f2",
        color: busy ? "#94a3b8" : "#b91c1c",
        padding: "5px 10px",
        borderRadius: 6,
        cursor: busy ? "default" : "pointer",
        fontSize: 11,
        fontWeight: 600
      }}
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
      style={{
        background: "white",
        padding: 14,
        borderRadius: 10,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "flex-end",
        marginBottom: 16
      }}
    >

      <div style={{ flex: 2, minWidth: 200 }}>

        <label
          style={{
            fontSize: 11,
            color: "#64748b",
            display: "block",
            marginBottom: 4
          }}
        >
          Model
        </label>

        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13
          }}
        >
          <option value="">Pick a model…</option>
          {models.map((m) => (
            <option key={m.ID} value={m.ID}>
              {m.MODEL_CODE} — {m.MODEL_NAME}
            </option>
          ))}
        </select>
      </div>

      <div style={{ width: 90 }}>

        <label
          style={{
            fontSize: 11,
            color: "#64748b",
            display: "block",
            marginBottom: 4
          }}
        >
          Quantity
        </label>

        <input
          type="number"
          min="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13
          }}
        />
      </div>

      <div style={{ flex: 2, minWidth: 180 }}>

        <label
          style={{
            fontSize: 11,
            color: "#64748b",
            display: "block",
            marginBottom: 4
          }}
        >
          Notes
        </label>

        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Chennai metro batch"
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13
          }}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        style={{
          border: "none",
          background: submitting ? "#94a3b8" : "#1e40af",
          color: "white",
          padding: "9px 18px",
          borderRadius: 6,
          fontWeight: 600,
          cursor: submitting ? "not-allowed" : "pointer",
          fontSize: 13
        }}
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

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap"
        }}
      >

        {["", "PLANNED", "IN_PROGRESS", "ON_HOLD", "DONE", "CANCELLED"].map(
          (s) => (

            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              style={{
                border: "1px solid #e2e8f0",
                background:
                  statusFilter === s ? "#1e40af" : "white",
                color: statusFilter === s ? "white" : "#475569",
                padding: "6px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600
              }}
            >
              {s ? s.replaceAll("_", " ") : "All"}
            </button>
          )
        )}
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

        <div style={{ overflow: "auto" }}>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13
            }}
          >

            <thead>

              <tr
                style={{
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 11,
                  letterSpacing: 0.8,
                  textTransform: "uppercase"
                }}
              >
                <th style={{ textAlign: "left", padding: 12 }}>WO #</th>
                <th style={{ textAlign: "left", padding: 12 }}>Model</th>
                <th style={{ textAlign: "right", padding: 12 }}>Qty</th>
                <th style={{ textAlign: "left", padding: 12 }}>Status</th>
                <th style={{ textAlign: "left", padding: 12 }}>Notes</th>
                <th style={{ textAlign: "left", padding: 12 }}>Created</th>
                <th style={{ textAlign: "right", padding: 12 }}>Action</th>
              </tr>
            </thead>

            <tbody>

              {loading && (

                <tr>
                  <td
                    colSpan="7"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && wos.length === 0 && (

                <tr>
                  <td
                    colSpan="7"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    No work orders. Create one above.
                  </td>
                </tr>
              )}

              {wos.map((wo) => (

                <tr
                  key={wo.ID}
                  style={{ borderBottom: "1px solid #f1f5f9" }}
                >

                  <td
                    style={{
                      padding: 12,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12
                    }}
                  >
                    <button
                      onClick={() => setDrawerWO(wo.ID)}
                      title="Open 360° view"
                      style={{
                        border: "none",
                        background: "none",
                        color: "#1e40af",
                        cursor: "pointer",
                        padding: 0,
                        textDecoration: "underline",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                        fontWeight: 600
                      }}
                    >
                      {wo.WO_NUMBER}
                    </button>
                  </td>

                  <td style={{ padding: 12 }}>

                    <div
                      style={{ fontWeight: 600, color: "#0f172a" }}
                    >
                      {wo.PRODUCT_MODEL_NAME || "—"}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color: "#94a3b8",
                        fontFamily: "ui-monospace, monospace"
                      }}
                    >
                      {wo.PRODUCT_MODEL_CODE}
                    </div>
                  </td>

                  <td
                    style={{
                      padding: 12,
                      textAlign: "right",
                      fontWeight: 700,
                      fontSize: 15
                    }}
                  >
                    {wo.QUANTITY}
                  </td>

                  <td style={{ padding: 12 }}>
                    <StatusBadge status={wo.STATUS} />
                  </td>

                  <td
                    style={{
                      padding: 12,
                      color: "#475569",
                      maxWidth: 280
                    }}
                  >
                    {wo.NOTES || "—"}
                  </td>

                  <td
                    style={{
                      padding: 12,
                      color: "#94a3b8",
                      fontSize: 12
                    }}
                  >
                    {wo.CREATED_AT?.slice(0, 10)}
                  </td>

                  <td style={{ padding: 12, textAlign: "right" }}>

                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        justifyContent: "flex-end",
                        alignItems: "center"
                      }}
                    >

                      <button
                        onClick={() => setGanttWO(wo)}
                        title="View Gantt timeline"
                        style={{
                          border: "1px solid #c7d2fe",
                          background: "#eef2ff",
                          color: "#4338ca",
                          padding: "5px 10px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 600
                        }}
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

    <div
      style={{
        padding: 24,
        background: "#f1f5f9",
        minHeight: "100%"
      }}
    >

      <div style={{ marginBottom: 20 }}>

        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: "#0f172a",
            margin: 0
          }}
        >
          Production & BOM
        </h1>

        <div
          style={{
            fontSize: 13,
            color: "#64748b",
            marginTop: 4
          }}
        >
          Vending machine catalog · Bill of materials · Work order
          tracking
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "1px solid #e2e8f0"
        }}
      >

        {[
          { key: "dashboard", label: "Dashboard" },
          { key: "models", label: "Machine Models" },
          { key: "work-orders", label: "Work Orders" }
        ].map((t) => (

          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              border: "none",
              background: "transparent",
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              color: tab === t.key ? "#1e40af" : "#64748b",
              cursor: "pointer",
              borderBottom:
                tab === t.key
                  ? "3px solid #1e40af"
                  : "3px solid transparent",
              marginBottom: -1
            }}
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
