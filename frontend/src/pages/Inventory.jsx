import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import {
  PageHeader, StatsRow, PMModal, PMButton, PMSelect, SearchBar, EmptyState, Loader,
} from "../components/pm";
import TablePagination from "../components/TablePagination";
import ManualPurchaseOrderModal from "../components/inventory/ManualPurchaseOrderModal";
import { formatDateTime } from "../utils/formatDateTime";
import { inventoryCategoryService } from "../services/inventoryCategoryService";
import { productMasterService } from "../services/productMasterService";
import { supplierManagementService } from "../services/supplierManagementService";
import InventoryIcon from "../assets/Icons/inventoryIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DetailsIcon from "../assets/Icons/detailsIcon.webp";

import styles from "./InventoryItemsPage.module.css";
// Sectioned-detail-view classes (status pill header, label/value grid,
// creator-card) — the same shared look already used by LeadDetailModal.jsx
// and BatchDetailModal.jsx, reused here for Product Details for visual
// consistency across every "detail modal" in the app.
import detailStyles from "./ManualLeadManagement.module.css";

// ===================================================================
// Inventory — live stock view of products (ProductMaster -> InventoryStock).
// Restyled onto the same `pm` component system used by Lead Management /
// Product Management / Customer Management / Inventory Items — no backend
// changes: GET /inventory/full already returns everything this page needs.
// ===================================================================

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "IN_STOCK", label: "In Stock" },
  { value: "LOW_STOCK", label: "Low Stock" },
  { value: "OUT_OF_STOCK", label: "Out of Stock" },
  { value: "OVERSTOCK", label: "Overstock" },
];

const STATUS_LABELS = {
  IN_STOCK: "In Stock", LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock", OVERSTOCK: "Overstock",
};

function statusClass(status) {
  switch (status) {
    case "IN_STOCK": return styles.statusInStock;
    case "LOW_STOCK": return styles.statusLowStock;
    case "OUT_OF_STOCK": return styles.statusOutOfStock;
    case "OVERSTOCK": return styles.statusOverstock;
    default: return styles.statusInStock;
  }
}

// Movement types that increase stock vs decrease it — signs the quantity
// correctly in the Product Details movement list. ADJUSTMENT is neither:
// QTY is an absolute value, not a delta.
const ADDITIVE_MOVEMENT_TYPES = ["STOCK_IN", "TRANSFER_IN", "RETURN", "OPENING_STOCK"];

const MOVEMENT_TYPE_LABELS = {
  STOCK_IN: "Stock In", STOCK_OUT: "Stock Out", ADJUSTMENT: "Adjustment",
  TRANSFER_IN: "Transfer In", TRANSFER_OUT: "Transfer Out",
  RETURN: "Return", WRITE_OFF: "Write Off", OPENING_STOCK: "Opening Stock",
};

function movementTypeLabel(type) {
  return MOVEMENT_TYPE_LABELS[type] || (type ? type.replace(/_/g, " ") : "Movement");
}

function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function compactCurrency(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const num = Number(n);
  if (Math.abs(num) >= 10000000) return "₹" + (num / 10000000).toFixed(2) + " Cr";
  if (Math.abs(num) >= 100000) return "₹" + (num / 100000).toFixed(2) + " L";
  if (Math.abs(num) >= 1000) return "₹" + (num / 1000).toFixed(1) + " K";
  return "₹" + num.toFixed(0);
}

const REASON_OPTIONS = [
  { value: "", label: "— pick a reason —" },
  { value: "Opening stock", label: "Opening stock" },
  { value: "Cycle count correction", label: "Cycle count correction" },
  { value: "Damaged / write-off", label: "Damaged / write-off" },
  { value: "Theft / shrinkage", label: "Theft / shrinkage" },
  { value: "Returned to supplier", label: "Returned to supplier" },
  { value: "Found / unallocated stock", label: "Found / unallocated stock" },
  { value: "Other", label: "Other" },
];

// =================================================================
// Adjust Stock modal — quantity adjustment + Min/Max threshold edit,
// same two independent-endpoint save behavior as before.
// =================================================================
function AdjustStockModal({ item, onClose, onSaved }) {
  const [qty, setQty] = useState(item.CURRENT_QTY);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [minQty, setMinQty] = useState(item.MIN_QTY != null ? String(item.MIN_QTY) : "");
  const [maxQty, setMaxQty] = useState(item.MAX_QTY != null ? String(item.MAX_QTY) : "");

  const delta = Number(qty) - Number(item.CURRENT_QTY);
  const qtyChanged = Number(qty) !== Number(item.CURRENT_QTY);

  const initialMin = Number(item.MIN_QTY || 0);
  const initialMax = item.MAX_QTY != null ? Number(item.MAX_QTY) : null;
  const minChanged = minQty !== "" && Number(minQty) !== initialMin;
  const maxChanged = maxQty !== "" && Number(maxQty) !== initialMax;

  const save = async () => {
    setError("");
    if (qtyChanged && !reason.trim()) {
      setError("Please pick a reason for the quantity change.");
      return;
    }
    if (!qtyChanged && !minChanged && !maxChanged) {
      onClose?.();
      return;
    }
    setSaving(true);
    try {
      if (qtyChanged) {
        await API.post(`/inventory/${item.ID}/adjust`, {
          QUANTITY: Number(qty), REASON: reason, NOTES: notes || null,
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
      setError(err?.response?.data?.detail || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PMModal
      open
      onClose={onClose}
      title="Adjust Stock"
      size="sm"
      footer={
        <>
          <PMButton variant="outline" onClick={onClose} disabled={saving}>Cancel</PMButton>
          <PMButton variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Adjustment"}
          </PMButton>
        </>
      }
    >
      <div className={styles.formStack}>
        <div className={styles.stockItemInfo}>
          <span className={styles.stockItemName}>{item.PRODUCT_NAME}</span>
          <span className={styles.stockItemCurrent}>Current: {item.CURRENT_QTY} {item.UNIT || "units"}</span>
        </div>

        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>New Quantity</label>
            <input className={styles.input} type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label>&nbsp;</label>
            {delta !== 0 && !isNaN(delta) && (
              <span className={delta > 0 ? styles.statusInStock : styles.statusLowStock} style={{ display: "inline-block", padding: "6px 12px", borderRadius: "var(--radius-full)" }}>
                {delta > 0 ? `+${delta} added` : `${delta} removed`}
              </span>
            )}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Reason {qtyChanged && <span className={styles.req}>*</span>}</label>
            <PMSelect options={REASON_OPTIONS} value={reason} onChange={setReason} placeholder="— pick a reason —" />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Notes</label>
            <textarea className={styles.textarea} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra context for the audit log…" />
          </div>
          <div className={styles.formGroup}>
            <label>Min Qty (reorder at)</label>
            <input className={styles.input} type="number" min={0} step="any" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="blank = unchanged" />
          </div>
          <div className={styles.formGroup}>
            <label>Max Qty (cap)</label>
            <input className={styles.input} type="number" min={0} step="any" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} placeholder="blank = unchanged" />
          </div>
        </div>
        {error && <span className={styles.fieldError}>{error}</span>}
      </div>
    </PMModal>
  );
}

// =================================================================
// Product Details modal — mirrors LeadDetailModal.jsx / BatchDetailModal.jsx's
// status-pill header + sectioned label/value grid layout.
// =================================================================
function ProductDetailsModal({ item, onClose }) {
  const [movements, setMovements] = useState(null);

  useEffect(() => {
    if (!item) return;
    setMovements(null);
    API.get(`/inventory/${item.ID}/movements`)
      .then((r) => setMovements(r.data?.movements || []))
      .catch(() => setMovements([]));
  }, [item]);

  return (
    <PMModal open={!!item} onClose={onClose} title="Product Details" size="md" footer={<PMButton variant="outline" onClick={onClose}>Close</PMButton>}>
      {item && (
        <div className={detailStyles.leadDetailBody}>
          <div className={detailStyles.leadDetailHeader}>
            <div className={detailStyles.leadDetailCompany}>
              <span className={detailStyles.leadDetailCompanyIcon}>
                <img src={InventoryIcon} alt="Product" />
              </span>
              <div>
                <div className={detailStyles.leadDetailCompanyName}>{item.PRODUCT_NAME}</div>
                <span className={styles.statusBadge + " " + statusClass(item.STATUS)}>
                  {STATUS_LABELS[item.STATUS] || item.STATUS || "—"}
                </span>
                <span className={detailStyles.codeBadge}>{item.CATEGORY_NAME || "Uncategorized"}</span>
              </div>
            </div>
          </div>

          <div className={detailStyles.leadDetailSection}>
            <div className={detailStyles.leadDetailSectionTitle}>Stock Summary</div>
            <div className={detailStyles.leadDetailGrid}>
              <div className={detailStyles.leadDetailField}>
                <span className={detailStyles.leadDetailFieldLabel}>Current Qty</span>
                <span className={detailStyles.leadDetailFieldValue}>{item.CURRENT_QTY} {item.UNIT || ""}</span>
              </div>
              <div className={detailStyles.leadDetailField}>
                <span className={detailStyles.leadDetailFieldLabel}>Min Qty / Max Qty</span>
                <span className={detailStyles.leadDetailFieldValue}>
                  {item.MIN_QTY ?? 0} / {item.MAX_QTY != null ? item.MAX_QTY : "No cap"}
                </span>
              </div>
              <div className={detailStyles.leadDetailField}>
                <span className={detailStyles.leadDetailFieldLabel}>Unit Cost</span>
                <span className={detailStyles.leadDetailFieldValue}>{inr(item.UNIT_COST)}</span>
              </div>
              <div className={detailStyles.leadDetailField}>
                <span className={detailStyles.leadDetailFieldLabel}>Total Value</span>
                <span className={detailStyles.leadDetailFieldValue}>{inr(item.TOTAL_VALUE)}</span>
              </div>
            </div>
          </div>

          {item.PREFERRED_SUPPLIER && (
            <div className={detailStyles.leadDetailSection}>
              <div className={detailStyles.leadDetailSectionTitle}>Preferred Supplier</div>
              <div className={detailStyles.leadDetailGrid}>
                <div className={detailStyles.leadDetailField}>
                  <span className={detailStyles.leadDetailFieldLabel}>Company Name</span>
                  <span className={detailStyles.leadDetailFieldValue}>{item.PREFERRED_SUPPLIER.COMPANY_NAME}</span>
                </div>
                <div className={detailStyles.leadDetailField}>
                  <span className={detailStyles.leadDetailFieldLabel}>Supplier Code</span>
                  <span className={detailStyles.leadDetailFieldValue}>
                    {[item.PREFERRED_SUPPLIER.SUPPLIER_CODE, item.PREFERRED_SUPPLIER.CATEGORY].filter(Boolean).join(" · ") || "—"}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className={detailStyles.leadDetailSection}>
            <div className={detailStyles.leadDetailSectionTitle}>Recent Stock Movements</div>
            {movements === null ? (
              <div className={detailStyles.leadDetailNotes}>Loading…</div>
            ) : movements.length === 0 ? (
              <div className={detailStyles.leadDetailNotes}>
                No stock movements yet. Stock changes (receipts, adjustments, consumption, etc.) appear here as they happen.
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Reason</th>
                      <th>Performed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => {
                      const isAdjustment = m.MOVEMENT_TYPE === "ADJUSTMENT";
                      const additive = ADDITIVE_MOVEMENT_TYPES.includes(m.MOVEMENT_TYPE);
                      return (
                        <tr key={m.ID}>
                          <td className={styles.dateCell}>{formatDateTime(m.CREATED_AT)}</td>
                          <td>{movementTypeLabel(m.MOVEMENT_TYPE)}</td>
                          <td className={styles.numCell}>
                            {isAdjustment ? `${m.QTY_BEFORE} → ${m.QTY_AFTER}` : `${additive ? "+" : "-"}${m.QTY}`}
                          </td>
                          <td className={styles.descCell}>{m.REASON || <span className={styles.muted}>—</span>}</td>
                          <td className={styles.descCell}>{m.PERFORMED_BY_NAME || <span className={styles.muted}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </PMModal>
  );
}

// =================================================================
// Main page
// =================================================================
function Inventory() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Category is ID-based (not name-based) for consistency with every
  // other Category filter in the app (Items/Batches/Movements tabs) —
  // the dropdown still displays the category's name, only the underlying
  // filter value changed.
  const [categoryFilter, setCategoryFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openItem, setOpenItem] = useState(null);
  const [adjustItem, setAdjustItem] = useState(null);
  const [poModalOpen, setPoModalOpen] = useState(false);

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  useEffect(() => {
    inventoryCategoryService.getAll().then((res) => {
      const d = res.data;
      setCategories((Array.isArray(d) ? d : (d?.items || [])).filter((c) => c.IS_ACTIVE !== false));
    }).catch(() => {});
    productMasterService.getAll({ page_size: 5000 }).then((res) => {
      const d = res.data;
      setProducts(Array.isArray(d) ? d : (d?.items || []));
    }).catch(() => {});
    supplierManagementService.getAll().then((res) => {
      setSuppliers((Array.isArray(res.data) ? res.data : []).filter((s) => s.STATUS === "ACTIVE"));
    }).catch(() => {});
  }, []);

  const categoryOptions = useMemo(
    () => [{ value: "", label: "All Categories" }, ...categories.map((c) => ({ value: c.ID, label: c.NAME }))],
    [categories]
  );
  const productFilterOptions = useMemo(() => {
    const list = categoryFilter ? products.filter((p) => p.CATEGORY_ID === categoryFilter) : products;
    return list.map((p) => ({ value: p.ID, label: `${p.PRODUCT_CODE} — ${p.PRODUCT_NAME}` }));
  }, [products, categoryFilter]);
  const supplierFilterOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.ID, label: s.COMPANY_NAME || s.SUPPLIER_CODE })),
    [suppliers]
  );

  const load = (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    const params = { vendor_id: 1 };
    if (categoryFilter) params.category_id = categoryFilter;
    if (productFilter) params.product_id = productFilter;
    if (supplierFilter) params.supplier_id = supplierFilter;
    API.get("/inventory/full", { params })
      .then((r) => setData(r.data))
      .catch(() => setData({ summary: {}, items: [] }))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); }, []);
  // Re-fetch (server-side filtered) whenever Category/Product/Supplier
  // changes — mirrors the same pattern InventoryItemsPage.jsx uses for
  // its Items/Batches/Movements filters.
  useEffect(() => { load(); setPage(1); }, [categoryFilter, productFilter, supplierFilter]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const summary = useMemo(() => data?.summary || {}, [data]);

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    const s = search.trim().toLowerCase();
    return data.items.filter((it) => {
      if (statusFilter && it.STATUS !== statusFilter) return false;
      if (s) {
        const hay = (it.PRODUCT_NAME + " " + (it.PREFERRED_SUPPLIER?.COMPANY_NAME || "") + " " + (it.CATEGORY_NAME || "")).toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const stockByProduct = useMemo(() => {
    const map = {};
    for (const item of data?.items || []) map[item.PRODUCT_ID] = item;
    return map;
  }, [data]);

  const stats = useMemo(() => [
    { value: summary.total_products ?? 0, label: "Total Products" },
    { value: compactCurrency(summary.total_value), label: "Total Stock Value" },
    { value: summary.low_stock_count ?? 0, label: "Low Stock", onClick: () => setStatusFilter("LOW_STOCK") },
    { value: summary.out_of_stock_count ?? 0, label: "Out of Stock", onClick: () => setStatusFilter("OUT_OF_STOCK") },
    { value: summary.overstock_count ?? 0, label: "Overstock", onClick: () => setStatusFilter("OVERSTOCK") },
  ], [summary]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={InventoryIcon}
        iconAlt="Inventory"
        title="Inventory"
        subtitle="Live stock levels across every tracked product"
        onRefresh={() => load(true)}
        refreshing={refreshing}
        actions={<PMButton variant="primary" onClick={() => setPoModalOpen(true)}>Create Purchase Order</PMButton>}
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar value={search} onChange={setSearch} placeholder="Search products, suppliers, categories…" />
          <div className={styles.filterSelect}>
            <PMSelect value={categoryFilter} onChange={(v) => { setCategoryFilter(v); setProductFilter(""); }} options={categoryOptions} placeholder="All Categories" />
          </div>
          <div className={styles.filterSelect}>
            <PMSelect value={productFilter} onChange={setProductFilter} options={productFilterOptions} allowClear clearLabel="All Products" placeholder="All Products" />
          </div>
          <div className={styles.filterSelect}>
            <PMSelect value={supplierFilter} onChange={setSupplierFilter} options={supplierFilterOptions} allowClear clearLabel="All Suppliers" placeholder="All Suppliers" />
          </div>
          <div className={styles.filterSelect}>
            <PMSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} placeholder="All Statuses" />
          </div>
          {(categoryFilter || productFilter || supplierFilter || statusFilter) && (
            <button className={styles.clearFilter} onClick={() => { setCategoryFilter(""); setProductFilter(""); setSupplierFilter(""); setStatusFilter(""); }}>✕ Clear</button>
          )}
          <span className={styles.count}>{filtered.length} product{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Category</th>
                <th>Qty (Current / Min / Max)</th>
                <th>Unit Cost</th>
                <th>Total Value</th>
                <th>Status</th>
                <th>Preferred Supplier</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><Loader /></td></tr>
              ) : pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={InventoryIcon}
                      iconAlt="Inventory"
                      title={search || categoryFilter || productFilter || supplierFilter || statusFilter ? "No products match your filters" : "No products tracked yet"}
                      description={!data?.items?.length ? "Add a stock row for a product from the Inventory Items page to start tracking it here." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                pagedItems.map((item, i) => (
                  <tr key={item.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.productCell}>
                      <span className={styles.productName}>{item.PRODUCT_NAME}</span>
                      {item.PRODUCT_CODE && <span className={styles.productCode}>{item.PRODUCT_CODE}</span>}
                    </td>
                    <td>{item.CATEGORY_NAME || <span className={styles.muted}>Uncategorized</span>}</td>
                    <td className={styles.numCell}>
                      {item.CURRENT_QTY} / {item.MIN_QTY ?? 0} / {item.MAX_QTY != null ? item.MAX_QTY : "—"}
                    </td>
                    <td className={styles.numCell}>{inr(item.UNIT_COST)}</td>
                    <td className={styles.numCell}>{inr(item.TOTAL_VALUE)}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${statusClass(item.STATUS)}`}>
                        {STATUS_LABELS[item.STATUS] || item.STATUS}
                      </span>
                    </td>
                    <td className={styles.descCell}>
                      {item.PREFERRED_SUPPLIER?.COMPANY_NAME || <span className={styles.muted}>—</span>}
                    </td>
                    <td>
                      <button className={styles.iconBtn} onClick={() => setOpenItem(item)} title="View Details">
                        <img src={DetailsIcon} alt="Details" />
                      </button>
                      <button className={styles.iconBtn} onClick={() => setAdjustItem(item)} title="Adjust Stock">
                        <img src={EditIcon} alt="Adjust" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>

      <ProductDetailsModal item={openItem} onClose={() => setOpenItem(null)} />

      {adjustItem && (
        <AdjustStockModal
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onSaved={() => { setAdjustItem(null); load(true); }}
        />
      )}

      <ManualPurchaseOrderModal
        open={poModalOpen}
        onClose={() => setPoModalOpen(false)}
        onCreated={() => load(true)}
        stockByProduct={stockByProduct}
      />
    </div>
  );
}

export default Inventory;
