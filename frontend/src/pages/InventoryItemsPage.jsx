import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal, PMSelect,
} from "../components/pm";
import { inventoryItemService } from "../services/inventoryItemService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import InventoryIcon from "../assets/Icons/inventoryIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./InventoryItemsPage.module.css";

const MOVEMENT_TYPES = [
  { value: "STOCK_IN", label: "Stock In" },
  { value: "STOCK_OUT", label: "Stock Out" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "TRANSFER_IN", label: "Transfer In" },
  { value: "TRANSFER_OUT", label: "Transfer Out" },
  { value: "RETURN", label: "Return" },
  { value: "WRITE_OFF", label: "Write Off" },
  { value: "OPENING_STOCK", label: "Opening Stock" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "IN_STOCK", label: "In Stock" },
  { value: "LOW_STOCK", label: "Low Stock" },
  { value: "OUT_OF_STOCK", label: "Out of Stock" },
  { value: "OVERSTOCK", label: "Overstock" },
];

const ITEM_EMPTY_FORM = {
  PRODUCT_ID: "", LOCATION: "", BATCH_TRACKING: false,
  REORDER_LEVEL: 0, REORDER_QTY: 0, SAFETY_STOCK: 0, MAX_STOCK: 0,
};

const STOCK_OP_EMPTY = { QTY: "", REASON: "", BATCH_ID: "" };

const BATCH_EMPTY_FORM = {
  INVENTORY_ITEM_ID: "", BATCH_NUMBER: "", LOT_NUMBER: "",
  MFG_DATE: "", EXPIRY_DATE: "", QTY_RECEIVED: 0, UNIT_COST: 0,
};

const TABS = [
  { key: "items", label: "Items" },
  { key: "movements", label: "Movements" },
  { key: "batches", label: "Batches" },
];

function statusClass(status) {
  switch (status) {
    case "IN_STOCK": return styles.statusInStock;
    case "LOW_STOCK": return styles.statusLowStock;
    case "OUT_OF_STOCK": return styles.statusOutOfStock;
    case "OVERSTOCK": return styles.statusOverstock;
    default: return styles.statusInStock;
  }
}

function movTypeClass(type) {
  if (["STOCK_IN", "TRANSFER_IN", "RETURN", "OPENING_STOCK"].includes(type)) return styles.typeIn;
  if (["STOCK_OUT", "TRANSFER_OUT", "WRITE_OFF"].includes(type)) return styles.typeOut;
  return styles.typeAdj;
}

function isExpiringSoon(expiry, days = 30) {
  if (!expiry) return false;
  const diff = (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

function isExpired(expiry) {
  if (!expiry) return false;
  return new Date(expiry) < new Date();
}

export default function InventoryItemsPage() {
  const [activeTab, setActiveTab] = useState("items");

  // Items
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsRefreshing, setItemsRefreshing] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [itemPageSize, setItemPageSize] = useState(25);
  const [modal, setModal] = useState(null); // null | "add" | "edit"
  const [selectedItem, setSelectedItem] = useState(null);
  const [itemForm, setItemForm] = useState(ITEM_EMPTY_FORM);
  const [itemSaving, setItemSaving] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();
  const [confirmModal, setConfirmModal] = useState(null);

  // Stock operation
  const [stockModal, setStockModal] = useState(null); // { type, item }
  const [stockForm, setStockForm] = useState(STOCK_OP_EMPTY);
  const [stockSaving, setStockSaving] = useState(false);

  // Movements
  const [movements, setMovements] = useState([]);
  const [movLoading, setMovLoading] = useState(false);
  const [movSearch, setMovSearch] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("");
  const [movPage, setMovPage] = useState(1);

  // Batches
  const [batches, setBatches] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [showExpiringSoon, setShowExpiringSoon] = useState(false);
  const [batchPage, setBatchPage] = useState(1);
  const [batchModal, setBatchModal] = useState(null); // null | "add" | "edit"
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchForm, setBatchForm] = useState(BATCH_EMPTY_FORM);
  const [batchSaving, setBatchSaving] = useState(false);

  const toast = useToast();
  const fetchedRef = useRef({});

  const {
    fields: cfFields, cfValues, handleCfChange,
    loadValues: loadCfValues, resetValues: resetCfValues,
    validateCf, saveCfValues, refreshFields,
  } = useCustomFields("inventory_item");
  const cfValuesMap = useTableCfValues("inventory_item", items);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  // ── Loaders ────────────────────────────────────────────────────────────
  const loadItems = useCallback(async (silent = false) => {
    if (!silent) setItemsLoading(true); else setItemsRefreshing(true);
    try {
      const res = await inventoryItemService.getAll();
      setItems(res.data || []);
    } catch {
      toast.showError("Failed to load inventory items");
    } finally {
      setItemsLoading(false);
      setItemsRefreshing(false);
    }
  }, []);

  const loadMovements = useCallback(async () => {
    setMovLoading(true);
    try {
      const res = await inventoryItemService.getMovements();
      setMovements(res.data || []);
    } catch {
      toast.showError("Failed to load movements");
    } finally {
      setMovLoading(false);
    }
  }, []);

  const loadBatches = useCallback(async () => {
    setBatchLoading(true);
    try {
      const res = showExpiringSoon
        ? await inventoryItemService.getExpiringBatches(30)
        : await inventoryItemService.getBatches();
      setBatches(res.data || []);
    } catch {
      toast.showError("Failed to load batches");
    } finally {
      setBatchLoading(false);
    }
  }, [showExpiringSoon]);

  useEffect(() => {
    if (activeTab === "items" && !fetchedRef.current.items) {
      fetchedRef.current.items = true;
      loadItems();
    }
    if (activeTab === "movements" && !fetchedRef.current.movements) {
      fetchedRef.current.movements = true;
      loadMovements();
    }
    if (activeTab === "batches" && !fetchedRef.current.batches) {
      fetchedRef.current.batches = true;
      loadBatches();
    }
  }, [activeTab, loadItems, loadMovements, loadBatches]);

  useEffect(() => {
    if (activeTab === "batches") {
      fetchedRef.current.batches = false;
      loadBatches();
    }
  }, [showExpiringSoon]);

  const handleRefresh = useCallback(() => {
    if (activeTab === "items") { fetchedRef.current.items = false; loadItems(true); }
    if (activeTab === "movements") { fetchedRef.current.movements = false; loadMovements(); }
    if (activeTab === "batches") { fetchedRef.current.batches = false; loadBatches(); }
  }, [activeTab, loadItems, loadMovements, loadBatches]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const lowStockItems = useMemo(() => items.filter((i) => i.stock?.STATUS === "LOW_STOCK" || i.STATUS === "LOW_STOCK"), [items]);
  const outOfStockItems = useMemo(() => items.filter((i) => i.stock?.STATUS === "OUT_OF_STOCK" || i.STATUS === "OUT_OF_STOCK"), [items]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (filterStatus) list = list.filter((i) => (i.stock?.STATUS || i.STATUS) === filterStatus);
    if (itemSearch.trim()) {
      const t = itemSearch.toLowerCase();
      list = list.filter(
        (i) =>
          (i.product?.PRODUCT_NAME || "").toLowerCase().includes(t) ||
          (i.product?.PRODUCT_CODE || "").toLowerCase().includes(t) ||
          (i.LOCATION || "").toLowerCase().includes(t)
      );
    }
    return list;
  }, [items, itemSearch, filterStatus]);

  const itemsPaginated = useMemo(
    () => itemPageSize === 0 ? filteredItems : filteredItems.slice((itemPage - 1) * itemPageSize, itemPage * itemPageSize),
    [filteredItems, itemPage, itemPageSize]
  );

  const filteredMovements = useMemo(() => {
    let list = movements;
    if (movTypeFilter) list = list.filter((m) => m.MOVEMENT_TYPE === movTypeFilter);
    if (movSearch.trim()) {
      const t = movSearch.toLowerCase();
      list = list.filter(
        (m) =>
          (m.item?.product?.PRODUCT_NAME || "").toLowerCase().includes(t) ||
          (m.REFERENCE_TYPE || "").toLowerCase().includes(t)
      );
    }
    return list;
  }, [movements, movTypeFilter, movSearch]);

  const movPaginated = useMemo(
    () => filteredMovements.slice((movPage - 1) * 25, movPage * 25),
    [filteredMovements, movPage]
  );

  const batchPaginated = useMemo(
    () => batches.slice((batchPage - 1) * 25, batchPage * 25),
    [batches, batchPage]
  );

  const itemStats = useMemo(() => [
    { value: items.length, label: "Total Items" },
    { value: items.filter((i) => (i.stock?.STATUS || i.STATUS) === "IN_STOCK").length, label: "In Stock" },
    { value: lowStockItems.length, label: "Low Stock" },
    { value: outOfStockItems.length, label: "Out of Stock" },
  ], [items, lowStockItems, outOfStockItems]);

  // ── Items CRUD ─────────────────────────────────────────────────────────
  const openAdd = useCallback(() => {
    setItemForm(ITEM_EMPTY_FORM);
    setSelectedItem(null);
    setModal("add");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback((item) => {
    setItemForm({
      PRODUCT_ID: item.PRODUCT_ID || "",
      LOCATION: item.LOCATION || "",
      BATCH_TRACKING: item.BATCH_TRACKING || false,
      REORDER_LEVEL: item.REORDER_LEVEL ?? 0,
      REORDER_QTY: item.REORDER_QTY ?? 0,
      SAFETY_STOCK: item.SAFETY_STOCK ?? 0,
      MAX_STOCK: item.MAX_STOCK ?? 0,
    });
    setSelectedItem(item);
    setModal("edit");
    loadCfValues(item.ID);
  }, [loadCfValues]);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelectedItem(null);
  }, []);

  const handleSaveItem = useCallback(async () => {
    if (!itemForm.PRODUCT_ID) { toast.showWarning("Product is required"); return; }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setItemSaving(true);
    try {
      if (modal === "add") {
        const res = await inventoryItemService.create(itemForm);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Inventory item added");
      } else {
        await inventoryItemService.update(selectedItem.ID, itemForm);
        await saveCfValues(selectedItem.ID);
        toast.showSuccess("Item updated");
      }
      closeModal();
      loadItems(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setItemSaving(false);
    }
  }, [itemForm, modal, selectedItem, closeModal, loadItems, toast, validateCf, saveCfValues]);

  const handleDeleteItem = useCallback((item) => {
    setConfirmModal({
      title: "Delete Inventory Item",
      description: `Delete "${item.product?.PRODUCT_NAME || item.ID}" from inventory? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await inventoryItemService.remove(item.ID);
          toast.showSuccess("Item deleted");
          loadItems(true);
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [loadItems, toast]);

  // ── Stock Operations ───────────────────────────────────────────────────
  const openStockOp = useCallback((type, item) => {
    setStockForm(STOCK_OP_EMPTY);
    setStockModal({ type, item });
  }, []);

  const handleStockOp = useCallback(async () => {
    const { type, item } = stockModal;
    if (!stockForm.QTY || parseFloat(stockForm.QTY) <= 0) {
      toast.showWarning("Quantity must be greater than 0");
      return;
    }
    setStockSaving(true);
    try {
      const payload = {
        INVENTORY_ITEM_ID: item.ID,
        QTY: parseFloat(stockForm.QTY),
        REASON: stockForm.REASON,
        BATCH_ID: stockForm.BATCH_ID || undefined,
      };
      if (type === "in") await inventoryItemService.stockIn(payload);
      else if (type === "out") await inventoryItemService.stockOut(payload);
      else if (type === "adjust") await inventoryItemService.stockAdjust({ ...payload, ADJUSTMENT_QTY: parseFloat(stockForm.QTY) });
      toast.showSuccess(`Stock ${type === "in" ? "added" : type === "out" ? "removed" : "adjusted"} successfully`);
      setStockModal(null);
      fetchedRef.current.items = false;
      fetchedRef.current.movements = false;
      loadItems(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Stock operation failed");
    } finally {
      setStockSaving(false);
    }
  }, [stockModal, stockForm, loadItems, toast]);

  // ── Export/Template ────────────────────────────────────────────────────
  const handleExportItems = useCallback(() => {
    const data = filteredItems.map((item, i) => {
      const row = {
        "S.No": i + 1,
        "Product Code": item.product?.PRODUCT_CODE || "",
        "Product Name": item.product?.PRODUCT_NAME || "",
        Location: item.LOCATION || "",
        "Current Qty": item.stock?.CURRENT_QTY ?? 0,
        "Available Qty": item.stock?.AVAILABLE_QTY ?? 0,
        "Unit Cost": item.stock?.UNIT_COST ?? 0,
        "Reorder Level": item.REORDER_LEVEL ?? 0,
        Status: item.stock?.STATUS || item.STATUS || "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(item.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "inventory_items");
  }, [filteredItems, cfFields, cfValuesMap]);

  const handleExportMovements = useCallback(async () => {
    try {
      const res = await inventoryItemService.exportMovements();
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = "inventory_movements.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.showError("Export failed");
    }
  }, [toast]);

  const handleDownloadTemplate = useCallback(async () => {
    const headers = [
      "Product Code", "Location", "Reorder Level", "Reorder Qty", "Safety Stock", "Max Stock",
      ...cfFields.map((f) => f.FIELD_NAME),
    ];
    await dlTemplate("InventoryItems", headers, "inventory_items_template");
  }, [cfFields]);

  const handleFileChange = useCallback(async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = "";
    setBulkFile(f);
    setUploadResult(null);
    const fd = new FormData();
    fd.append("file", f);
    setBulkUploading(true);
    try {
      const res = await inventoryItemService.bulkUpload(fd);
      setUploadResult(res.data);
      loadItems(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [loadItems, toast]);

  // ── Batches ────────────────────────────────────────────────────────────
  const handleSaveBatch = useCallback(async () => {
    if (!batchForm.INVENTORY_ITEM_ID || !batchForm.BATCH_NUMBER) {
      toast.showWarning("Item and batch number are required");
      return;
    }
    setBatchSaving(true);
    try {
      if (batchModal === "add") {
        await inventoryItemService.createBatch(batchForm);
        toast.showSuccess("Batch created");
      } else {
        await inventoryItemService.updateBatch(selectedBatch.ID, batchForm);
        toast.showSuccess("Batch updated");
      }
      setBatchModal(null);
      fetchedRef.current.batches = false;
      loadBatches();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setBatchSaving(false);
    }
  }, [batchForm, batchModal, selectedBatch, loadBatches, toast]);

  const isRefreshing = (
    (activeTab === "items" && itemsRefreshing) ||
    (activeTab === "movements" && movLoading) ||
    (activeTab === "batches" && batchLoading)
  );

  return (
    <div className={styles.page}>
      <PageHeader
        icon={InventoryIcon}
        iconAlt="Inventory Items"
        title="Inventory Items"
        subtitle="Manage stock levels, movements, and batch tracking"
        onRefresh={handleRefresh}
        refreshing={isRefreshing}
        actions={
          activeTab === "items" ? (
            <>
              <PMButton variant="ghost" onClick={handleDownloadTemplate}>Template</PMButton>
              <PMButton variant="outline" onClick={() => setBulkModal(true)}>Bulk Upload</PMButton>
              <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
              <ExportButton onClick={handleExportItems} disabled={filteredItems.length === 0} />
              <PMButton variant="primary" onClick={openAdd}>Add Item</PMButton>
            </>
          ) : activeTab === "movements" ? (
            <ExportButton onClick={handleExportMovements} label="Export Movements" />
          ) : activeTab === "batches" ? (
            <PMButton variant="primary" onClick={() => { setBatchForm(BATCH_EMPTY_FORM); setSelectedBatch(null); setBatchModal("add"); }}>Add Batch</PMButton>
          ) : null
        }
      />

      <StatsRow stats={itemStats} />

      {/* Low-stock alert banner */}
      {(lowStockItems.length > 0 || outOfStockItems.length > 0) && (
        <div className={styles.alertBanner}>
          <span className={styles.alertIcon}>⚠</span>
          <span className={styles.alertText}>
            Stock Alert:
            {outOfStockItems.length > 0 && (
              <button className={`${styles.alertChip} ${styles.alertChipRed}`} onClick={() => { setFilterStatus("OUT_OF_STOCK"); setActiveTab("items"); }}>
                {outOfStockItems.length} Out of Stock
              </button>
            )}
            {lowStockItems.length > 0 && (
              <button className={`${styles.alertChip} ${styles.alertChipAmber}`} onClick={() => { setFilterStatus("LOW_STOCK"); setActiveTab("items"); }}>
                {lowStockItems.length} Low Stock
              </button>
            )}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Items Tab ── */}
      {activeTab === "items" && (
        <div className={styles.tableSection}>
          <div className={styles.toolbar}>
            <SearchBar
              value={itemSearch}
              onChange={(v) => { setItemSearch(v); setItemPage(1); }}
              placeholder="Search by product name, code, location…"
            />
            <PMSelect
              value={filterStatus}
              onChange={(v) => { setFilterStatus(v); setItemPage(1); }}
              options={STATUS_OPTIONS}
              placeholder="All Statuses"
            />
            {filterStatus && (
              <button className={styles.clearFilter} onClick={() => setFilterStatus("")}>✕ Clear</button>
            )}
            <span className={styles.count}>{filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>Location</th>
                  <th>Current Qty</th>
                  <th>Available</th>
                  <th>Unit Cost</th>
                  <th>Reorder Lvl</th>
                  <th>Status</th>
                  {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {itemsLoading ? (
                  <tr><td colSpan={9 + cfFields.length}><Loader /></td></tr>
                ) : itemsPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={9 + cfFields.length}>
                      <EmptyState
                        icon={InventoryIcon}
                        iconAlt="Inventory"
                        title={itemSearch || filterStatus ? "No items match your filters" : "No inventory items yet"}
                        description={!itemSearch && !filterStatus ? "Add items to start tracking stock levels." : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  itemsPaginated.map((item, i) => {
                    const stock = item.stock || {};
                    const status = stock.STATUS || item.STATUS || "IN_STOCK";
                    return (
                      <tr key={item.ID}>
                        <td className={styles.idx}>{(itemPage - 1) * itemPageSize + i + 1}</td>
                        <td className={styles.productCell}>
                          <span className={styles.productName}>{item.product?.PRODUCT_NAME || <span className={styles.muted}>—</span>}</span>
                          {item.product?.PRODUCT_CODE && <span className={styles.productCode}>{item.product.PRODUCT_CODE}</span>}
                        </td>
                        <td className={styles.descCell}>{item.LOCATION || <span className={styles.muted}>—</span>}</td>
                        <td className={styles.numCell}>{stock.CURRENT_QTY != null ? stock.CURRENT_QTY.toLocaleString() : "—"}</td>
                        <td className={styles.numCell}>{stock.AVAILABLE_QTY != null ? stock.AVAILABLE_QTY.toLocaleString() : "—"}</td>
                        <td className={styles.numCell}>{stock.UNIT_COST != null ? `₹${Number(stock.UNIT_COST).toLocaleString()}` : "—"}</td>
                        <td className={styles.numCell}>{item.REORDER_LEVEL ?? "—"}</td>
                        <td>
                          <span className={`${styles.statusBadge} ${statusClass(status)}`}>
                            {status.replace("_", " ")}
                          </span>
                        </td>
                        {cfFields.map((f) => {
                          const val = cfValuesMap[String(item.ID)]?.[f.ID];
                          return (
                            <td key={f.ID} className={styles.descCell}>
                              {val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}
                            </td>
                          );
                        })}
                        <td>
                          <div className={styles.rowActions}>
                            <button className={styles.stockBtn} onClick={() => openStockOp("in", item)} title="Stock In">+In</button>
                            <button className={styles.stockBtnOut} onClick={() => openStockOp("out", item)} title="Stock Out">-Out</button>
                            <button className={styles.stockBtnAdj} onClick={() => openStockOp("adjust", item)} title="Adjust">Adj</button>
                            <button className={styles.iconBtn} onClick={() => openEdit(item)} title="Edit">
                              <img src={EditIcon} alt="Edit" />
                            </button>
                            <button className={styles.iconBtnDanger} onClick={() => handleDeleteItem(item)} title="Delete">
                              <img src={DeleteIcon} alt="Delete" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={filteredItems.length}
            page={itemPage}
            pageSize={itemPageSize}
            onPageChange={setItemPage}
            onPageSizeChange={(n) => { setItemPageSize(n); setItemPage(1); }}
          />
        </div>
      )}

      {/* ── Movements Tab ── */}
      {activeTab === "movements" && (
        <div className={styles.tableSection}>
          <div className={styles.toolbar}>
            <SearchBar
              value={movSearch}
              onChange={(v) => { setMovSearch(v); setMovPage(1); }}
              placeholder="Search by product or reference…"
            />
            <PMSelect
              value={movTypeFilter}
              onChange={(v) => { setMovTypeFilter(v); setMovPage(1); }}
              options={[{ value: "", label: "All Types" }, ...MOVEMENT_TYPES]}
              placeholder="All Types"
            />
            <span className={styles.count}>{filteredMovements.length} movement{filteredMovements.length !== 1 ? "s" : ""}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Reference</th>
                  <th>Performed By</th>
                </tr>
              </thead>
              <tbody>
                {movLoading ? (
                  <tr><td colSpan={9}><Loader /></td></tr>
                ) : movPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState icon={InventoryIcon} iconAlt="Movements" title="No movements found" />
                    </td>
                  </tr>
                ) : (
                  movPaginated.map((m, i) => (
                    <tr key={m.ID}>
                      <td className={styles.idx}>{(movPage - 1) * 25 + i + 1}</td>
                      <td className={styles.dateCell}>{m.CREATED_AT ? new Date(m.CREATED_AT).toLocaleString() : "—"}</td>
                      <td className={styles.productCell}>
                        <span className={styles.productName}>{m.item?.product?.PRODUCT_NAME || m.INVENTORY_ITEM_ID}</span>
                      </td>
                      <td>
                        <span className={`${styles.movType} ${movTypeClass(m.MOVEMENT_TYPE)}`}>
                          {m.MOVEMENT_TYPE?.replace("_", " ")}
                        </span>
                      </td>
                      <td className={styles.numCell}>{m.QTY != null ? m.QTY.toLocaleString() : "—"}</td>
                      <td className={styles.numCell}>{m.QTY_BEFORE != null ? m.QTY_BEFORE.toLocaleString() : "—"}</td>
                      <td className={styles.numCell}>{m.QTY_AFTER != null ? m.QTY_AFTER.toLocaleString() : "—"}</td>
                      <td className={styles.descCell}>{m.REFERENCE_TYPE ? `${m.REFERENCE_TYPE}` : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.descCell}>{m.performed_by?.NAME || <span className={styles.muted}>—</span>}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={filteredMovements.length}
            page={movPage}
            pageSize={25}
            onPageChange={setMovPage}
            onPageSizeChange={() => { }}
          />
        </div>
      )}

      {/* ── Batches Tab ── */}
      {activeTab === "batches" && (
        <div className={styles.tableSection}>
          <div className={styles.toolbar}>
            <button
              className={`${styles.toggleBtn} ${showExpiringSoon ? styles.toggleBtnActive : ""}`}
              onClick={() => setShowExpiringSoon((v) => !v)}
            >
              {showExpiringSoon ? "✓ " : ""}Expiring Soon (30 days)
            </button>
            <span className={styles.count}>{batches.length} batch{batches.length !== 1 ? "es" : ""}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>Batch No.</th>
                  <th>Lot No.</th>
                  <th>Qty Remaining</th>
                  <th>Unit Cost</th>
                  <th>MFG Date</th>
                  <th>Expiry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batchLoading ? (
                  <tr><td colSpan={9}><Loader /></td></tr>
                ) : batchPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState icon={InventoryIcon} iconAlt="Batches" title="No batches found" description="Add a batch to start tracking inventory lots." />
                    </td>
                  </tr>
                ) : (
                  batchPaginated.map((b, i) => {
                    const expClass = isExpired(b.EXPIRY_DATE) ? styles.expiryExpired : isExpiringSoon(b.EXPIRY_DATE) ? styles.expirySoon : "";
                    return (
                      <tr key={b.ID}>
                        <td className={styles.idx}>{(batchPage - 1) * 25 + i + 1}</td>
                        <td className={styles.productCell}>
                          <span className={styles.productName}>{b.item?.product?.PRODUCT_NAME || b.INVENTORY_ITEM_ID}</span>
                        </td>
                        <td className={styles.monoCell}>{b.BATCH_NUMBER}</td>
                        <td className={styles.monoCell}>{b.LOT_NUMBER || <span className={styles.muted}>—</span>}</td>
                        <td className={styles.numCell}>{b.QTY_REMAINING?.toLocaleString() ?? "—"}</td>
                        <td className={styles.numCell}>{b.UNIT_COST != null ? `₹${Number(b.UNIT_COST).toLocaleString()}` : "—"}</td>
                        <td className={styles.dateCell}>{b.MFG_DATE ? new Date(b.MFG_DATE).toLocaleDateString() : "—"}</td>
                        <td className={`${styles.dateCell} ${expClass}`}>
                          {b.EXPIRY_DATE ? new Date(b.EXPIRY_DATE).toLocaleDateString() : "—"}
                          {isExpired(b.EXPIRY_DATE) && <span className={styles.expiredTag}> Expired</span>}
                          {!isExpired(b.EXPIRY_DATE) && isExpiringSoon(b.EXPIRY_DATE) && <span className={styles.soonTag}> !</span>}
                        </td>
                        <td>
                          <button className={styles.iconBtn} onClick={() => {
                            setBatchForm({ INVENTORY_ITEM_ID: b.INVENTORY_ITEM_ID, BATCH_NUMBER: b.BATCH_NUMBER, LOT_NUMBER: b.LOT_NUMBER || "", MFG_DATE: b.MFG_DATE?.split("T")[0] || "", EXPIRY_DATE: b.EXPIRY_DATE?.split("T")[0] || "", QTY_RECEIVED: b.QTY_RECEIVED ?? 0, UNIT_COST: b.UNIT_COST ?? 0 });
                            setSelectedBatch(b);
                            setBatchModal("edit");
                          }} title="Edit">
                            <img src={EditIcon} alt="Edit" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={batches.length}
            page={batchPage}
            pageSize={25}
            onPageChange={setBatchPage}
            onPageSizeChange={() => { }}
          />
        </div>
      )}

      {/* ── Add/Edit Item Modal ── */}
      <PMModal
        open={!!modal}
        onClose={closeModal}
        title={modal === "add" ? "Add Inventory Item" : "Edit Inventory Item"}
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSaveItem} disabled={itemSaving}>
              {itemSaving ? "Saving…" : modal === "add" ? "Create Item" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Product ID <span className={styles.req}>*</span></label>
            <input className={styles.input} value={itemForm.PRODUCT_ID} onChange={(e) => setItemForm((p) => ({ ...p, PRODUCT_ID: e.target.value }))} placeholder="Product ID (UUID)" />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Location</label>
            <input className={styles.input} value={itemForm.LOCATION} onChange={(e) => setItemForm((p) => ({ ...p, LOCATION: e.target.value }))} placeholder="e.g. Warehouse A, Shelf 3B" />
          </div>
          <div className={styles.formGroup}>
            <label>Reorder Level</label>
            <input className={styles.input} type="number" min={0} value={itemForm.REORDER_LEVEL} onChange={(e) => setItemForm((p) => ({ ...p, REORDER_LEVEL: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div className={styles.formGroup}>
            <label>Reorder Qty</label>
            <input className={styles.input} type="number" min={0} value={itemForm.REORDER_QTY} onChange={(e) => setItemForm((p) => ({ ...p, REORDER_QTY: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div className={styles.formGroup}>
            <label>Safety Stock</label>
            <input className={styles.input} type="number" min={0} value={itemForm.SAFETY_STOCK} onChange={(e) => setItemForm((p) => ({ ...p, SAFETY_STOCK: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div className={styles.formGroup}>
            <label>Max Stock</label>
            <input className={styles.input} type="number" min={0} value={itemForm.MAX_STOCK} onChange={(e) => setItemForm((p) => ({ ...p, MAX_STOCK: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div className={styles.formGroup}>
            <label>Batch Tracking</label>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={itemForm.BATCH_TRACKING} onChange={(e) => setItemForm((p) => ({ ...p, BATCH_TRACKING: e.target.checked }))} />
              Enable batch/lot tracking
            </label>
          </div>
        </div>
        <CustomFieldsSection fields={cfFields} values={cfValues} onChange={handleCfChange} />
      </PMModal>

      {/* ── Stock Operation Modal ── */}
      <PMModal
        open={!!stockModal}
        onClose={() => setStockModal(null)}
        title={
          stockModal?.type === "in" ? "Stock In" :
            stockModal?.type === "out" ? "Stock Out" : "Stock Adjustment"
        }
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setStockModal(null)}>Cancel</PMButton>
            <PMButton
              variant={stockModal?.type === "out" ? "danger" : "primary"}
              onClick={handleStockOp}
              disabled={stockSaving}
            >
              {stockSaving ? "Processing…" : stockModal?.type === "in" ? "Add Stock" : stockModal?.type === "out" ? "Remove Stock" : "Adjust"}
            </PMButton>
          </>
        }
      >
        {stockModal && (
          <div className={styles.formStack}>
            <div className={styles.stockItemInfo}>
              <span className={styles.stockItemName}>{stockModal.item.product?.PRODUCT_NAME}</span>
              <span className={styles.stockItemCurrent}>
                Current: {stockModal.item.stock?.CURRENT_QTY ?? 0} | Available: {stockModal.item.stock?.AVAILABLE_QTY ?? 0}
              </span>
            </div>
            <div className={styles.formGroup}>
              <label>Quantity <span className={styles.req}>*</span></label>
              <input
                className={styles.input}
                type="number"
                min={0.01}
                step={0.01}
                value={stockForm.QTY}
                onChange={(e) => setStockForm((p) => ({ ...p, QTY: e.target.value }))}
                placeholder={stockModal.type === "adjust" ? "New absolute quantity" : "Enter quantity"}
                autoFocus
              />
              {stockModal.type === "adjust" && <span className={styles.fieldHint}>Enter the new total quantity (not the change amount)</span>}
            </div>
            <div className={styles.formGroup}>
              <label>Reason</label>
              <textarea
                className={styles.textarea}
                value={stockForm.REASON}
                onChange={(e) => setStockForm((p) => ({ ...p, REASON: e.target.value }))}
                placeholder="Optional reason for this movement"
                rows={2}
              />
            </div>
          </div>
        )}
      </PMModal>

      {/* ── Add/Edit Batch Modal ── */}
      <PMModal
        open={!!batchModal}
        onClose={() => setBatchModal(null)}
        title={batchModal === "add" ? "Add Batch" : "Edit Batch"}
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setBatchModal(null)}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSaveBatch} disabled={batchSaving}>
              {batchSaving ? "Saving…" : batchModal === "add" ? "Create Batch" : "Save"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          {batchModal === "add" && (
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <label>Inventory Item ID <span className={styles.req}>*</span></label>
              <input className={styles.input} value={batchForm.INVENTORY_ITEM_ID} onChange={(e) => setBatchForm((p) => ({ ...p, INVENTORY_ITEM_ID: e.target.value }))} placeholder="Item ID" />
            </div>
          )}
          <div className={styles.formGroup}>
            <label>Batch Number <span className={styles.req}>*</span></label>
            <input className={styles.input} value={batchForm.BATCH_NUMBER} onChange={(e) => setBatchForm((p) => ({ ...p, BATCH_NUMBER: e.target.value }))} placeholder="BATCH-001" />
          </div>
          <div className={styles.formGroup}>
            <label>Lot Number</label>
            <input className={styles.input} value={batchForm.LOT_NUMBER} onChange={(e) => setBatchForm((p) => ({ ...p, LOT_NUMBER: e.target.value }))} placeholder="LOT-001" />
          </div>
          <div className={styles.formGroup}>
            <label>MFG Date</label>
            <input className={styles.input} type="date" value={batchForm.MFG_DATE} onChange={(e) => setBatchForm((p) => ({ ...p, MFG_DATE: e.target.value }))} />
          </div>
          <div className={styles.formGroup}>
            <label>Expiry Date</label>
            <input className={styles.input} type="date" value={batchForm.EXPIRY_DATE} onChange={(e) => setBatchForm((p) => ({ ...p, EXPIRY_DATE: e.target.value }))} />
          </div>
          <div className={styles.formGroup}>
            <label>Qty Received</label>
            <input className={styles.input} type="number" min={0} value={batchForm.QTY_RECEIVED} onChange={(e) => setBatchForm((p) => ({ ...p, QTY_RECEIVED: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div className={styles.formGroup}>
            <label>Unit Cost (₹)</label>
            <input className={styles.input} type="number" min={0} step={0.01} value={batchForm.UNIT_COST} onChange={(e) => setBatchForm((p) => ({ ...p, UNIT_COST: parseFloat(e.target.value) || 0 }))} />
          </div>
        </div>
      </PMModal>

      {/* ── Bulk Upload Modal ── */}
      <PMModal open={bulkModal} onClose={() => setBulkModal(false)} title="Bulk Upload Inventory Items" size="sm">
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet <strong>"InventoryItems"</strong>. Required columns: <strong>Product Code</strong>, <strong>Location</strong>. Optional: Reorder Level, Reorder Qty, Safety Stock, Max Stock{cfFields.length > 0 ? ", and custom field columns" : ""}.
        </p>
        <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
          <span className={styles.dropIconWrap}><img src={UploadIcon} alt="Upload" /></span>
          <span>{bulkFile ? bulkFile.name : "Click to browse or drop Excel (.xlsx)"}</span>
          {bulkUploading && <span>Uploading…</span>}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFileChange} />
        {uploadResult && (
          <div className={styles.uploadResult}>
            <div className={styles.resultStats}>
              <div className={styles.resultStat}><span className={styles.statValue}>{uploadResult.inserted ?? 0}</span><span className={styles.statLabel}>Inserted</span></div>
              <div className={styles.resultStat}><span className={styles.statValue}>{uploadResult.updated ?? 0}</span><span className={styles.statLabel}>Updated</span></div>
              <div className={styles.resultStat}><span className={styles.statValue}>{uploadResult.skipped ?? 0}</span><span className={styles.statLabel}>Skipped</span></div>
            </div>
            {uploadResult.errors?.length > 0 && (
              <div className={styles.errorSection}>
                <p className={styles.errorSectionTitle}>Errors ({uploadResult.errors.length})</p>
                <ul className={styles.errorList}>
                  {uploadResult.errors.map((e, i) => (
                    <li key={i} className={styles.errorItem}>
                      <span className={styles.errorRowNum}>Row {e.row}</span>
                      {e.field && <span className={styles.errorField}>{e.field}</span>}
                      <span className={styles.errorMsg}>{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </PMModal>

      {/* Custom Fields Modal */}
      <CustomFieldsModal open={cfOpen} onClose={() => setCfOpen(false)} tableName="inventory_item" />

      {/* Confirm Modal */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => { })}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </div>
  );
}
