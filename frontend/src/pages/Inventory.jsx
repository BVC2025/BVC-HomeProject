import { useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./Inventory.module.css";


// ===================================================================
// Inventory — redesigned page (BVC24 red theme).
//
// Live stock view of raw materials. Updates automatically when GRNs
// are finalized in the Purchase Orders module — this page just
// reflects the current inventory state via /inventory/full.
// ===================================================================


const STATUS_THEME = {
  OUT: { bg: "#fee2e2", fg: "#991b1b", color: "#ef4444", icon: "🛑", label: "Out of stock" },
  LOW: { bg: "#fef3c7", fg: "#854d0e", color: "#f59e0b", icon: "⚠️", label: "Low stock" },
  OK:  { bg: "#dcfce7", fg: "#166534", color: "#10b981", icon: "✅", label: "In stock" }
};


const CATEGORY_THEME = {
  "Sheet Metal":   { bg: "#f1f5f9", fg: "#475569", icon: "🪙" },
  "Refrigeration": { bg: "#dbeafe", fg: "#1e40af", icon: "🧊" },
  "Electronics":   { bg: "#e0e7ff", fg: "#4338ca", icon: "🔌" },
  "Display":       { bg: "#fae8ff", fg: "#86198f", icon: "🖥️" },
  "Motors":        { bg: "#fff7ed", fg: "#9a3412", icon: "⚙️" },
  "Payment":       { bg: "#ecfeff", fg: "#155e75", icon: "💳" },
  "Glass":         { bg: "#f0fdf4", fg: "#166534", icon: "🪟" },
  "Wires":         { bg: "#fef3c7", fg: "#854d0e", icon: "🔌" },
  "Hardware":      { bg: "#fef2f2", fg: "#dc2626", icon: "🔩" },
  "Insulation":    { bg: "#f8fafc", fg: "#475569", icon: "🧱" },
  "Plumbing":      { bg: "#e0f2fe", fg: "#0c4a6e", icon: "🚰" },
  "Heating":       { bg: "#fef2f2", fg: "#991b1b", icon: "🔥" },
  "Power":         { bg: "#fef9c3", fg: "#713f12", icon: "⚡" },
  "Packaging":     { bg: "#fef3c7", fg: "#92400e", icon: "📦" },
  "Other":         { bg: "#f1f5f9", fg: "#64748b", icon: "🧰" }
};


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
// Material card
// =================================================================
function MaterialCard({ item, onOpen, onAdjust }) {

  const statusTheme = STATUS_THEME[item.STOCK_STATUS] || STATUS_THEME.OK;

  const catTheme = CATEGORY_THEME[item.CATEGORY] || CATEGORY_THEME.Other;

  const fillPct = Math.min(100, Math.max(2, Math.round((item.QUANTITY / 20) * 100)));

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
            {item.MATERIAL_NAME}
          </div>
          <span
            className={styles.categoryChip}
            style={{ background: catTheme.bg, color: catTheme.fg }}
          >
            <span>{catTheme.icon}</span>
            {item.CATEGORY}
          </span>
        </div>

        <div className={styles.cardBadges}>
          <span
            className={styles.statusBadge}
            style={{ background: statusTheme.bg, color: statusTheme.fg }}
          >
            {statusTheme.icon} {statusTheme.label}
          </span>
          {item.BELOW_MIN && (
            <span
              className={styles.reorderChip}
              title={`Stock ${item.QUANTITY} is at or below reorder threshold ${item.MIN_STOCK}`}
            >
              🔔 Reorder alert
            </span>
          )}
        </div>
      </div>

      <div className={styles.quantityArea}>
        <div className={styles.quantityRow}>
          <div className={styles.quantityValue}>{item.QUANTITY}</div>
          <div className={styles.quantityUnit}>in stock</div>
        </div>

        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${fillPct}%`, background: statusTheme.color }}
          />
        </div>

        {item.MIN_STOCK > 0 && (
          <div className={`${styles.reorderNote} ${item.BELOW_MIN ? styles.reorderNoteAlert : styles.reorderNoteNormal}`}>
            Reorder at: <strong>{item.MIN_STOCK}</strong>
          </div>
        )}
      </div>

      <div className={styles.cardPriceGrid}>
        <div>
          <div className={styles.priceLabel}>Unit price</div>
          <div className={styles.priceValue}>{inr(item.UNIT_PRICE)}</div>
        </div>
        <div className={styles.priceValueRight}>
          <div className={styles.priceLabel}>Total value</div>
          <div className={`${styles.priceValue} ${styles.totalValue}`}>{inr(item.TOTAL_VALUE)}</div>
        </div>
      </div>

      {(item.SUPPLIER || item.LAST_RECEIVED) && (
        <div className={styles.cardMeta}>
          {item.SUPPLIER && (
            <span className={styles.supplierLabel} title="Preferred supplier">
              🚚 {item.SUPPLIER.COMPANY_NAME}
            </span>
          )}
          {item.LAST_RECEIVED && (
            <span title="Last received">
              📅 {item.LAST_RECEIVED}
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

  const [qty, setQty] = useState(item.QUANTITY);

  const [reason, setReason] = useState("");

  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  // Reorder-alert threshold — admin can set this from the same modal.
  // Empty string means "leave unchanged"; 0 means "disable alerting".
  const [minStock, setMinStock] = useState(
    item.MIN_STOCK != null ? String(item.MIN_STOCK) : ""
  );

  const delta = Number(qty) - item.QUANTITY;
  const initialMin = Number(item.MIN_STOCK || 0);
  const targetMin  = minStock === "" ? initialMin : Number(minStock) || 0;
  const minChanged = targetMin !== initialMin;
  const qtyChanged = Number(qty) !== Number(item.QUANTITY);

  const save = async () => {

    if (qtyChanged && !reason.trim()) {

      alert("Please pick a reason for the quantity change.");

      return;
    }

    if (!qtyChanged && !minChanged) {

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

      if (minChanged) {
        await API.patch(`/inventory/${item.ID}/min-stock`, {
          MIN_STOCK: targetMin
        });
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
        <div className={styles.modalSubtitle}>{item.MATERIAL_NAME}</div>

        <div className={styles.modalQtyGrid}>
          <div>
            <div className={styles.modalFieldLabel}>Current</div>
            <div className={styles.modalCurrentQty}>{item.QUANTITY}</div>
          </div>
          <div>
            <div className={styles.modalFieldLabel}>New</div>
            <input
              type="number"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={styles.modalInput}
            />
          </div>
        </div>

        {delta !== 0 && (
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

        {/* Reorder threshold — independent of the quantity change above.
            Setting it to 0 (or leaving blank when it was 0) disables
            alerting for this row. */}
        <div className={styles.reorderBox}>
          <div className={styles.reorderBoxTitle}>
            🔔 Reorder alert
          </div>
          <div className={styles.reorderBoxRow}>
            <span className={styles.reorderBoxText}>
              Notify when stock falls at or below
            </span>
            <input
              type="number"
              min="0"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              placeholder="0 = off"
              className={styles.reorderInput}
            />
            <span className={styles.reorderBoxText}>units</span>
          </div>
          <div className={styles.reorderBoxNote}>
            Current threshold: <strong>{initialMin || "off"}</strong>
            {minChanged && <> · will change to <strong>{targetMin || "off"}</strong></>}
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

  const catTheme = CATEGORY_THEME[item.CATEGORY] || CATEGORY_THEME.Other;

  const statusTheme = STATUS_THEME[item.STOCK_STATUS] || STATUS_THEME.OK;

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
            INVENTORY · MATERIAL DETAIL
          </div>
          <h2 className={styles.drawerTitle}>
            {item.MATERIAL_NAME}
          </h2>
          <div className={styles.drawerBadges}>
            <span className={styles.drawerCatChip}>
              {catTheme.icon} {item.CATEGORY}
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
            <SummaryBox label="In Stock" value={item.QUANTITY} color="var(--text-primary, #0f172a)" />
            <SummaryBox label="Unit Price" value={inr(item.UNIT_PRICE)} color="var(--text-secondary, #475569)" small />
            <SummaryBox label="Total Value" value={inr(item.TOTAL_VALUE)} color="#047857" small />
          </div>

          {item.SUPPLIER && (
            <Section title="🚚 Preferred Supplier">
              <div className={styles.supplierBlock}>
                <div className={styles.supplierName}>
                  {item.SUPPLIER.COMPANY_NAME}
                </div>
                <div className={styles.supplierMeta}>
                  Code: {item.SUPPLIER.SUPPLIER_CODE}
                  {item.SUPPLIER.CATEGORY && ` · ${item.SUPPLIER.CATEGORY}`}
                </div>
              </div>
            </Section>
          )}

          {(item.USED_IN_PRODUCTS?.length || 0) > 0 && (
            <Section title="🏭 Used in Products">
              <div className={styles.productChips}>
                {item.USED_IN_PRODUCTS.map((p) => (
                  <span key={p.ID} className={styles.productChip}>
                    {p.MODEL_CODE}
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Section title="📥 Recent Stock Movements (from GRN)">
            {movements === null && (
              <div className={styles.movementsLoading}>Loading…</div>
            )}
            {movements?.length === 0 && (
              <div className={styles.movementsEmpty}>
                No goods receipts yet. Stock changes appear here once
                a Purchase Order's GRN is finalized.
              </div>
            )}
            {(movements?.length || 0) > 0 && (
              <div className={styles.movementList}>
                {movements.map((m, i) => (
                  <div key={i} className={styles.movementRow}>
                    <div>
                      <div className={styles.movementGRN}>{m.GRN_NUMBER}</div>
                      <div className={styles.movementMeta}>
                        Received {m.RECEIVED_DATE} · {inr(m.UNIT_PRICE)} / unit
                      </div>
                    </div>
                    <div className={styles.movementRight}>
                      <div className={styles.movementQty}>+{m.QUANTITY_RECEIVED}</div>
                      {m.QUANTITY_REJECTED > 0 && (
                        <div className={styles.movementRejected}>
                          {m.QUANTITY_REJECTED} rejected
                        </div>
                      )}
                    </div>
                  </div>
                ))}
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

  const [categoryFilter, setCategoryFilter] = useState("");

  const [statusFilter, setStatusFilter] = useState("");

  const [openItem, setOpenItem] = useState(null);

  const [adjustItem, setAdjustItem] = useState(null);

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

      if (categoryFilter && it.CATEGORY !== categoryFilter) return false;

      if (statusFilter && it.STOCK_STATUS !== statusFilter) return false;

      if (s) {

        const hay = (
          it.MATERIAL_NAME + " " +
          (it.SUPPLIER?.COMPANY_NAME || "") + " " +
          (it.CATEGORY || "")
        ).toLowerCase();

        if (!hay.includes(s)) return false;
      }

      return true;
    });

  }, [data, search, categoryFilter, statusFilter]);

  const summary = data?.summary || {};

  const allCategories = Object.keys(summary.categories || {}).sort();

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
          label="Total Materials"
          value={summary.total_materials ?? "—"}
          sub={`${summary.in_stock_count ?? 0} in stock`}
          color="#ef4444"
          icon="📦"
        />
        <StatTile
          label="Total Stock Value"
          value={compactNum(summary.total_value)}
          sub="across all materials"
          color="#10b981"
          icon="💰"
        />
        <StatTile
          label="Low Stock"
          value={summary.low_stock_count ?? 0}
          sub={`≤ ${summary.low_threshold ?? 5} units`}
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
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <input
          type="text"
          placeholder="🔍 Search materials, suppliers, categories..."
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
          {["", "OK", "LOW", "OUT"].map((s) => {

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
          📭 No materials match your filters.
          {(!data?.items?.length) && (
            <div className={styles.emptyStateSub}>
              Hit <b>Suppliers → 🔄 Reset &amp; Seed Demo Data</b> to load
              the 47 starter materials.
            </div>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={styles.cardGrid}>
          {filtered.map((item) => (
            <MaterialCard
              key={item.ID}
              item={item}
              onOpen={setOpenItem}
              onAdjust={setAdjustItem}
            />
          ))}
        </div>
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

    </div>
  );
}


export default Inventory;
