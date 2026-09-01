import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import Pagination from "../components/Pagination";
import ManualPurchaseOrderModal from "../components/inventory/ManualPurchaseOrderModal";
import { formatDateTime } from "../utils/formatDateTime";

import styles from "./Inventory.module.css";


// ===================================================================
// Inventory — redesigned page (BVC24 red theme).
//
// Live stock view of products. Updates automatically when GRNs are
// finalized in the Purchase Orders module, or when stock is
// received/adjusted/consumed anywhere else — this page just reflects
// the current inventory state via /inventory/full (ProductMaster ->
// InventoryStock, no more location-scoped InventoryItem dimension).
// ===================================================================


const STATUS_THEME = {
  OUT_OF_STOCK: { bg: "#fee2e2", fg: "#991b1b", color: "#ef4444", icon: "🛑", label: "Out of stock" },
  LOW_STOCK: { bg: "#fef3c7", fg: "#854d0e", color: "#f59e0b", icon: "⚠️", label: "Low stock" },
  IN_STOCK: { bg: "#dcfce7", fg: "#166534", color: "#10b981", icon: "✅", label: "In stock" },
  OVERSTOCK: { bg: "#ede9fe", fg: "#5b21b6", color: "#8b5cf6", icon: "📈", label: "Overstock" }
};


const CATEGORY_THEME = {
  "Sheet Metal": { bg: "#f1f5f9", fg: "#475569", icon: "🪙" },
  "Refrigeration": { bg: "#dbeafe", fg: "#1e40af", icon: "🧊" },
  "Electronics": { bg: "#e0e7ff", fg: "#4338ca", icon: "🔌" },
  "Display": { bg: "#fae8ff", fg: "#86198f", icon: "🖥️" },
  "Motors": { bg: "#fff7ed", fg: "#9a3412", icon: "⚙️" },
  "Payment": { bg: "#ecfeff", fg: "#155e75", icon: "💳" },
  "Glass": { bg: "#f0fdf4", fg: "#166534", icon: "🪟" },
  "Wires": { bg: "#fef3c7", fg: "#854d0e", icon: "🔌" },
  "Hardware": { bg: "#fef2f2", fg: "#dc2626", icon: "🔩" },
  "Insulation": { bg: "#f8fafc", fg: "#475569", icon: "🧱" },
  "Plumbing": { bg: "#e0f2fe", fg: "#0c4a6e", icon: "🚰" },
  "Heating": { bg: "#fef2f2", fg: "#991b1b", icon: "🔥" },
  "Power": { bg: "#fef9c3", fg: "#713f12", icon: "⚡" },
  "Packaging": { bg: "#fef3c7", fg: "#92400e", icon: "📦" },
  "Uncategorized": { bg: "#f1f5f9", fg: "#64748b", icon: "🧰" },
  "Other": { bg: "#f1f5f9", fg: "#64748b", icon: "🧰" }
};


// Movement types that increase stock vs decrease it — used by the
// detail drawer's movement list to sign the quantity correctly.
// ADJUSTMENT is neither: QTY is an absolute value, not a delta.
const ADDITIVE_MOVEMENT_TYPES = ["STOCK_IN", "TRANSFER_IN", "RETURN", "OPENING_STOCK"];

const MOVEMENT_TYPE_LABELS = {
  STOCK_IN: "Stock In", STOCK_OUT: "Stock Out", ADJUSTMENT: "Adjustment",
  TRANSFER_IN: "Transfer In", TRANSFER_OUT: "Transfer Out",
  RETURN: "Return", WRITE_OFF: "Write Off", OPENING_STOCK: "Opening Stock"
};

function movementTypeLabel(type) {
  return MOVEMENT_TYPE_LABELS[type] || (type ? type.replace(/_/g, " ") : "Movement");
}


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}


function compactNum(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  const num = Number(n);

  if (Math.abs(num) >= 10000000) return "₹" + (num / 10000000).toFixed(2) + " Cr";

  if (Math.abs(num) >= 100000) return "₹" + (num / 100000).toFixed(2) + " L";

  if (Math.abs(num) >= 1000) return "₹" + (num / 1000).toFixed(1) + " K";

  return "₹" + num.toFixed(0);
}


// =================================================================
// KPI tile
// =================================================================
function StatTile({ label, value, sub, color, icon }) {

  return (
    <div className={styles.statTile} style={{ borderTopColor: color }}>
      <div className={styles.statTileBgIcon}>{icon}</div>
      <div className={styles.statTileLabel}>{label}</div>
      <div className={styles.statTileValue}>{value}</div>
      {sub && <div className={styles.statTileSub}>{sub}</div>}
    </div>
  );
}


// =================================================================
// Product card
// =================================================================
function MaterialCard({ item, onOpen, onAdjust }) {

  const statusTheme = STATUS_THEME[item.STATUS] || STATUS_THEME.IN_STOCK;

  const catTheme = CATEGORY_THEME[item.CATEGORY_NAME] || CATEGORY_THEME.Other;

  const belowMin = item.STATUS === "LOW_STOCK" || item.STATUS === "OUT_OF_STOCK";

  const scale = item.MAX_QTY && item.MAX_QTY > 0 ? item.MAX_QTY : 20;

  const fillPct = Math.min(100, Math.max(2, Math.round((item.CURRENT_QTY / scale) * 100)));

  return (
    <div
      className={styles.materialCard}
      onClick={() => onOpen(item)}
    >
      {/* status stripe — flat color instead of gradient */}
      <div
        className={styles.cardStatusStripe}
        style={{ background: statusTheme.color }}
      />

      <div className={styles.cardHeader}>
        <div className={styles.cardTitleArea}>
          <div className={styles.cardMaterialName}>
            {item.PRODUCT_NAME}
          </div>
          <span
            className={styles.categoryChip}
            style={{ background: catTheme.bg, color: catTheme.fg }}
          >
            <span>{catTheme.icon}</span>
            {item.CATEGORY_NAME}
          </span>
        </div>

        <div className={styles.cardBadges}>
          <span
            className={styles.statusBadge}
            style={{ background: statusTheme.bg, color: statusTheme.fg }}
          >
            {statusTheme.icon} {statusTheme.label}
          </span>
          {belowMin && (
            <span
              className={styles.reorderChip}
              title={`Stock ${item.CURRENT_QTY} is at or below reorder threshold ${item.MIN_QTY}`}
            >
              🔔 Reorder alert
            </span>
          )}
        </div>
      </div>

      <div className={styles.quantityArea}>
        <div className={styles.quantityRow}>
          <div className={styles.quantityValue}>{item.CURRENT_QTY}</div>
          <div className={styles.quantityUnit}>{item.UNIT || "units"} in stock</div>
        </div>

        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${fillPct}%`, background: statusTheme.color }}
          />
        </div>

        {item.MIN_QTY > 0 && (
          <div className={`${styles.reorderNote} ${belowMin ? styles.reorderNoteAlert : styles.reorderNoteNormal}`}>
            Reorder at: <strong>{item.MIN_QTY}</strong>
          </div>
        )}

        <div className={styles.maxCapNote}>
          Max cap: <strong>{item.MAX_QTY != null ? item.MAX_QTY : "No cap"}</strong>
        </div>
      </div>

      <div className={styles.cardPriceGrid}>
        <div>
          <div className={styles.priceLabel}>Unit cost</div>
          <div className={styles.priceValue}>{inr(item.UNIT_COST)}</div>
        </div>
        <div className={styles.priceValueRight}>
          <div className={styles.priceLabel}>Total value</div>
          <div className={`${styles.priceValue} ${styles.totalValue}`}>{inr(item.TOTAL_VALUE)}</div>
        </div>
      </div>

      {(item.PREFERRED_SUPPLIER || item.LAST_MOVEMENT_AT) && (
        <div className={styles.cardMeta}>
          {item.PREFERRED_SUPPLIER && (
            <span className={styles.supplierLabel} title="Preferred supplier">
              🚚 {item.PREFERRED_SUPPLIER.COMPANY_NAME}
            </span>
          )}
          {item.LAST_MOVEMENT_AT && (
            <span title="Last stock movement">
              📅 {formatDateTime(item.LAST_MOVEMENT_AT)}
            </span>
          )}
        </div>
      )}

      <button
        className={styles.adjustBtn}
        onClick={(e) => { e.stopPropagation(); onAdjust(item); }}
      >
        ⚖️ Adjust stock
      </button>
    </div>
  );
}


// =================================================================
// Adjust modal
// =================================================================
function AdjustModal({ item, onClose, onSaved }) {

  const [qty, setQty] = useState(item.CURRENT_QTY);

  const [reason, setReason] = useState("");

  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  // Min/Max Qty thresholds — admin can set these from the same modal.
  // Blank means "leave unchanged" (the backend only updates a threshold
  // when its key is present in the request body).
  const [minQty, setMinQty] = useState(
    item.MIN_QTY != null ? String(item.MIN_QTY) : ""
  );
  const [maxQty, setMaxQty] = useState(
    item.MAX_QTY != null ? String(item.MAX_QTY) : ""
  );

  const delta = Number(qty) - Number(item.CURRENT_QTY);
  const qtyChanged = Number(qty) !== Number(item.CURRENT_QTY);

  const initialMin = Number(item.MIN_QTY || 0);
  const initialMax = item.MAX_QTY != null ? Number(item.MAX_QTY) : null;
  const minChanged = minQty !== "" && Number(minQty) !== initialMin;
  const maxChanged = maxQty !== "" && Number(maxQty) !== initialMax;

  const save = async () => {

    if (qtyChanged && !reason.trim()) {

      alert("Please pick a reason for the quantity change.");

      return;
    }

    if (!qtyChanged && !minChanged && !maxChanged) {

      onClose?.();
      return;
    }

    setSaving(true);

    try {

      // Two independent endpoints — issue both, surface either error.
      if (qtyChanged) {
        await API.post(`/inventory/${item.ID}/adjust`, {
          QUANTITY: Number(qty),
          REASON: reason,
          NOTES: notes || null
        });
      }

      if (minChanged || maxChanged) {
        const payload = {};
        if (minChanged) payload.MIN_QTY = Number(minQty);
        if (maxChanged) payload.MAX_QTY = Number(maxQty);
        await API.patch(`/inventory/${item.ID}/min-stock`, payload);
      }

      onSaved?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to save changes");

    } finally {

      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalTitle}>⚖️ Adjust stock</div>
        <div className={styles.modalSubtitle}>{item.PRODUCT_NAME}</div>

        <div className={styles.modalQtyGrid}>
          <div>
            <div className={styles.modalFieldLabel}>Current</div>
            <div className={styles.modalCurrentQty}>{item.CURRENT_QTY}</div>
          </div>
          <div>
            <div className={styles.modalFieldLabel}>New</div>
            <input
              type="number"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={styles.modalInput}
            />
          </div>
        </div>

        {delta !== 0 && !isNaN(delta) && (
          <div
            className={styles.deltaBadge}
            style={{
              background: delta > 0 ? "#dcfce7" : "#fef3c7",
              color: delta > 0 ? "#166534" : "#854d0e"
            }}
          >
            {delta > 0 ? `+${delta} units added` : `${delta} units removed`}
          </div>
        )}

        <div className={styles.modalFieldGroup}>
          <div className={styles.modalFieldLabel}>Reason *</div>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={styles.modalSelect}
          >
            <option value="">— pick a reason —</option>
            <option value="Opening stock">Opening stock</option>
            <option value="Cycle count correction">Cycle count correction</option>
            <option value="Damaged / write-off">Damaged / write-off</option>
            <option value="Theft / shrinkage">Theft / shrinkage</option>
            <option value="Returned to supplier">Returned to supplier</option>
            <option value="Found / unallocated stock">Found / unallocated stock</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className={styles.modalFieldGroup}>
          <div className={styles.modalFieldLabel}>Notes (optional)</div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={styles.modalTextarea}
            placeholder="Any extra context for the audit log..."
          />
        </div>

        {/* Min/Max Qty thresholds — independent of the quantity change
            above. Leaving a field blank leaves that threshold unchanged. */}
        <div className={styles.reorderBox}>
          <div className={styles.reorderBoxTitle}>
            🔔 Stock thresholds
          </div>
          <div className={styles.reorderBoxRow}>
            <span className={styles.reorderBoxText}>
              Min Qty (reorder at)
            </span>
            <input
              type="number"
              min="0"
              step="any"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
              placeholder="blank = unchanged"
              className={styles.reorderInput}
            />
          </div>
          <div className={styles.reorderBoxRow} style={{ marginTop: 8 }}>
            <span className={styles.reorderBoxText}>
              Max Qty (cap)
            </span>
            <input
              type="number"
              min="0"
              step="any"
              value={maxQty}
              onChange={(e) => setMaxQty(e.target.value)}
              placeholder="blank = unchanged"
              className={styles.reorderInput}
            />
          </div>
          <div className={styles.reorderBoxNote}>
            Current: Min <strong>{item.MIN_QTY ?? 0}</strong> · Max{" "}
            <strong>{item.MAX_QTY != null ? item.MAX_QTY : "No cap"}</strong>
            {(minChanged || maxChanged) && <> · will update on save</>}
          </div>
        </div>

        <div className={styles.modalActions}>
          <button
            className={styles.modalCancelBtn}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className={styles.modalSaveBtn}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "💾 Save adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}


// =================================================================
// Detail drawer (right slide)
// =================================================================
function DetailDrawer({ item, onClose }) {

  const [movements, setMovements] = useState(null);

  useEffect(() => {

    if (!item) return;

    setMovements(null);

    API.get(`/inventory/${item.ID}/movements`)
      .then((r) => setMovements(r.data?.movements || []))
      .catch(() => setMovements([]));

  }, [item]);

  if (!item) return null;

  const catTheme = CATEGORY_THEME[item.CATEGORY_NAME] || CATEGORY_THEME.Other;

  const statusTheme = STATUS_THEME[item.STATUS] || STATUS_THEME.IN_STOCK;

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div
        className={styles.drawerPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.drawerHeader}>
          <button
            className={styles.drawerCloseBtn}
            onClick={onClose}
          >×</button>

          <div className={styles.drawerEyebrow}>
            INVENTORY · PRODUCT DETAIL
          </div>
          <h2 className={styles.drawerTitle}>
            {item.PRODUCT_NAME}
          </h2>
          <div className={styles.drawerBadges}>
            <span className={styles.drawerCatChip}>
              {catTheme.icon} {item.CATEGORY_NAME}
            </span>
            <span
              className={styles.drawerStatusChip}
              style={{ background: statusTheme.bg, color: statusTheme.fg }}
            >
              {statusTheme.icon} {statusTheme.label}
            </span>
          </div>
        </div>

        <div className={styles.drawerBody}>
          <div className={styles.summaryBoxGrid}>
            <SummaryBox label="In Stock" value={item.CURRENT_QTY} color="var(--text-primary, #0f172a)" />
            <SummaryBox label="Unit Cost" value={inr(item.UNIT_COST)} color="var(--text-secondary, #475569)" small />
            <SummaryBox label="Total Value" value={inr(item.TOTAL_VALUE)} color="#047857" small />
          </div>

          <div className={styles.thresholdRow}>
            Min Qty: <strong>{item.MIN_QTY ?? 0}</strong> · Max Qty:{" "}
            <strong>{item.MAX_QTY != null ? item.MAX_QTY : "No cap"}</strong>
          </div>

          {item.PREFERRED_SUPPLIER && (
            <Section title="🚚 Preferred Supplier">
              <div className={styles.supplierBlock}>
                <div className={styles.supplierName}>
                  {item.PREFERRED_SUPPLIER.COMPANY_NAME}
                </div>
                <div className={styles.supplierMeta}>
                  Code: {item.PREFERRED_SUPPLIER.SUPPLIER_CODE}
                  {item.PREFERRED_SUPPLIER.CATEGORY && ` · ${item.PREFERRED_SUPPLIER.CATEGORY}`}
                </div>
              </div>
            </Section>
          )}

          <Section title="📥 Recent Stock Movements">
            {movements === null && (
              <div className={styles.movementsLoading}>Loading…</div>
            )}
            {movements?.length === 0 && (
              <div className={styles.movementsEmpty}>
                No stock movements yet. Stock changes (receipts,
                adjustments, consumption, etc.) appear here as they happen.
              </div>
            )}
            {(movements?.length || 0) > 0 && (
              <div className={styles.movementList}>
                {movements.map((m) => {

                  const isAdjustment = m.MOVEMENT_TYPE === "ADJUSTMENT";
                  const additive = ADDITIVE_MOVEMENT_TYPES.includes(m.MOVEMENT_TYPE);

                  return (
                    <div key={m.ID} className={styles.movementRow}>
                      <div>
                        <div className={styles.movementGRN}>{movementTypeLabel(m.MOVEMENT_TYPE)}</div>
                        <div className={styles.movementMeta}>
                          {formatDateTime(m.CREATED_AT)}
                          {m.REASON && ` · ${m.REASON}`}
                          {m.PERFORMED_BY_NAME && ` · by ${m.PERFORMED_BY_NAME}`}
                        </div>
                      </div>
                      <div className={styles.movementRight}>
                        {isAdjustment ? (
                          <div className={styles.movementQtyNeutral}>
                            {m.QTY_BEFORE} → {m.QTY_AFTER}
                          </div>
                        ) : (
                          <div className={additive ? styles.movementQty : styles.movementQtyNegative}>
                            {additive ? "+" : "-"}{m.QTY}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}


function SummaryBox({ label, value, color, small }) {

  return (
    <div className={styles.summaryBox}>
      <div className={styles.summaryBoxLabel}>{label}</div>
      <div
        className={styles.summaryBoxValue}
        style={{ fontSize: small ? 15 : 22, color }}
      >
        {value}
      </div>
    </div>
  );
}


function Section({ title, children }) {

  return (
    <div className={styles.sectionWrapper}>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}


// =================================================================
// Main page
// =================================================================
function Inventory() {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [categoryFilter, setCategoryFilter] = useState("");

  const [statusFilter, setStatusFilter] = useState("");

  const [openItem, setOpenItem] = useState(null);

  const [adjustItem, setAdjustItem] = useState(null);

  const [poModalOpen, setPoModalOpen] = useState(false);

  const load = () => {

    setLoading(true);

    API.get("/inventory/full?vendor_id=1")
      .then((r) => setData(r.data))
      .catch(() => setData({ summary: {}, items: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {

    if (!data?.items) return [];

    const s = search.trim().toLowerCase();

    return data.items.filter((it) => {

      if (categoryFilter && it.CATEGORY_NAME !== categoryFilter) return false;

      if (statusFilter && it.STATUS !== statusFilter) return false;

      if (s) {

        const hay = (
          it.PRODUCT_NAME + " " +
          (it.PREFERRED_SUPPLIER?.COMPANY_NAME || "") + " " +
          (it.CATEGORY_NAME || "")
        ).toLowerCase();

        if (!hay.includes(s)) return false;
      }

      return true;
    });

  }, [data, search, categoryFilter, statusFilter]);

  const summary = data?.summary || {};

  const allCategories = Object.keys(summary.categories || {}).sort();

  useEffect(() => { setPage(1); }, [search]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const stockByProduct = useMemo(() => {
    const map = {};
    for (const item of data?.items || []) map[item.PRODUCT_ID] = item;
    return map;
  }, [data]);

  return (
    <div className={styles.pageWrapper}>

      {/* HERO */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>Warehouse</div>
          <h1 className={styles.heroTitle}>Inventory</h1>
        </div>
      </div>

      {/* KPIs */}
      <div className={styles.kpiGrid}>
        <StatTile
          label="Total Products"
          value={summary.total_products ?? "—"}
          sub={`${summary.in_stock_count ?? 0} in stock`}
          color="#ef4444"
          icon="📦"
        />
        <StatTile
          label="Total Stock Value"
          value={compactNum(summary.total_value)}
          sub="across all products"
          color="#10b981"
          icon="💰"
        />
        <StatTile
          label="Low Stock"
          value={summary.low_stock_count ?? 0}
          sub="at or below min qty"
          color="#f59e0b"
          icon="⚠️"
        />
        <StatTile
          label="Out of Stock"
          value={summary.out_of_stock_count ?? 0}
          sub="zero units left"
          color="#ef4444"
          icon="🛑"
        />
        <StatTile
          label="Overstock"
          value={summary.overstock_count ?? 0}
          sub="above max qty"
          color="#8b5cf6"
          icon="📈"
        />
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <input
          type="text"
          placeholder="🔍 Search products, suppliers, categories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.filterSearch}
        />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">All categories</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {(CATEGORY_THEME[c]?.icon || "•")} {c} ({summary.categories[c]})
            </option>
          ))}
        </select>

        <div className={styles.statusBtns}>
          {["", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "OVERSTOCK"].map((s) => {

            const theme = s ? STATUS_THEME[s] : null;

            const active = statusFilter === s;

            const label = s ? theme.label : "All status";

            return (
              <button
                key={s || "ALL"}
                onClick={() => setStatusFilter(s)}
                className={`${styles.statusBtn} ${active ? styles.statusBtnActive : ""}`}
              >
                {s ? `${theme.icon} ${label}` : label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setPoModalOpen(true)}
          title="Create a manual Purchase Order"
          className={styles.createPoBtn}
        >
          🧾 Create Purchase Order
        </button>

        <button
          onClick={load}
          title="Refresh"
          className={styles.refreshBtn}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Grid */}
      {loading && (
        <div className={styles.loadingState}>
          Loading inventory…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          📭 No products match your filters.
          {(!data?.items?.length) && (
            <div className={styles.emptyStateSub}>
              No products are being tracked in inventory yet. Add a stock
              row for a product from the Inventory Items page to start
              tracking it here.
            </div>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (

        <>
          <div className={styles.cardGrid}>
            {pagedItems.map((item) => (
              <MaterialCard
                key={item.ID}
                item={item}
                onOpen={setOpenItem}
                onAdjust={setAdjustItem}
              />
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </>

      )}

      {openItem && (
        <DetailDrawer item={openItem} onClose={() => setOpenItem(null)} />
      )}
      {adjustItem && (
        <AdjustModal
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onSaved={() => { setAdjustItem(null); load(); }}
        />
      )}

      <ManualPurchaseOrderModal
        open={poModalOpen}
        onClose={() => setPoModalOpen(false)}
        onCreated={load}
        stockByProduct={stockByProduct}
      />

    </div>
  );
}


export default Inventory;
