import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal, PMSelect,
} from "../components/pm";
import { inventoryItemService } from "../services/inventoryItemService";
import { productMasterService } from "../services/productMasterService";
import { inventoryCategoryService } from "../services/inventoryCategoryService";
import { supplierManagementService } from "../services/supplierManagementService";
import { customerMasterService } from "../services/customerMasterService";
import { projectService } from "../services/projectService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import { formatDateTime } from "../utils/formatDateTime";
import { BatchDetailModal } from "../components/inventory/BatchDetailModal";
import { MovementDetailModal } from "../components/inventory/MovementDetailModal";
import InventoryIcon from "../assets/Icons/inventoryIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import DetailsIcon from "../assets/Icons/detailsIcon.webp";
import styles from "./InventoryItemsPage.module.css";
import { validateForm, clearFieldError, ITEM_RULES, BATCH_RULES, BATCH_EDIT_RULES } from "../utils/formValidation";

// Custom Field values for this page's rows are stored under table name
// "inventory_stock" — matching the backend's own _cf_fields_for_table()
// calls in inventory_items.py (InventoryStock is what these rows are;
// the old InventoryItem table this used to be keyed to no longer exists).
const CF_TABLE = "inventory_stock";

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

const BATCH_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "CONSUMED", label: "Consumed" },
  { value: "EXPIRED", label: "Expired" },
  { value: "RETURNED", label: "Returned" },
];

// InventoryStock now sits directly on ProductMaster — one row per
// product, holding only Min/Max Qty thresholds (LOCATION/BATCH_TRACKING/
// REORDER_QTY/SAFETY_STOCK/MAX_STOCK all belonged to the removed
// InventoryItem table and no longer exist anywhere).
const ITEM_EMPTY_FORM = { PRODUCT_ID: "", MIN_QTY: 0, MAX_QTY: "" };

const STOCK_OP_EMPTY = { QTY: "", REASON: "", BATCH_ID: "" };

// A manual batch now requires a Product (not an InventoryItem) plus at
// least one of a DC / Invoice file upload (enforced by the backend).
// CATEGORY_ID is filter-only — never sent to the backend (ProductMaster
// already owns the Category relationship, see D3). BATCH_NUMBER is no
// longer part of the form — it's generated server-side on save.
const BATCH_EMPTY_FORM = {
  CATEGORY_ID: "", PRODUCT_ID: "", SUPPLIER_ID: "",
  RECEIVED_DATE: "", MANUFACTURING_DATE: "", EXPIRY_DATE: "", IS_NO_EXPIRY: false,
  QTY_RECEIVED: 0, UNIT_COST: "",
};

const BATCH_FILES_EMPTY = { DC_FILE: null, INVOICE_FILE: null };

const BATCH_EDIT_EMPTY_FORM = {
  STATUS: "ACTIVE", QTY_REMAINING: 0, SUPPLIER_ID: "",
  EXPIRY_DATE: "", IS_NO_EXPIRY: false, NOTES: "",
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

  // Shared product picker (Items + Batches "Add" forms)
  const [products, setProducts] = useState([]);

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
  const [itemErrors, setItemErrors] = useState({});
  const [itemSaving, setItemSaving] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();
  const [confirmModal, setConfirmModal] = useState(null);
  const [itemFilterFrom, setItemFilterFrom] = useState("");
  const [itemFilterTo, setItemFilterTo] = useState("");
  const [itemCategoryFilter, setItemCategoryFilter] = useState("");
  const [itemProductFilter, setItemProductFilter] = useState("");
  const [itemSupplierFilter, setItemSupplierFilter] = useState("");

  // Stock operation
  const [stockModal, setStockModal] = useState(null); // { type, item }
  const [stockForm, setStockForm] = useState(STOCK_OP_EMPTY);
  const [stockSaving, setStockSaving] = useState(false);

  // Movements
  const [movements, setMovements] = useState([]);
  const [movLoading, setMovLoading] = useState(false);
  const [movSearch, setMovSearch] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("");
  const [movCategoryFilter, setMovCategoryFilter] = useState("");
  const [movProductFilter, setMovProductFilter] = useState("");
  const [movCustomerFilter, setMovCustomerFilter] = useState("");
  const [movProjectFilter, setMovProjectFilter] = useState("");
  const [movFilterFrom, setMovFilterFrom] = useState("");
  const [movFilterTo, setMovFilterTo] = useState("");
  const [movPage, setMovPage] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [movementDetailModal, setMovementDetailModal] = useState(null);

  // Batches
  const [batches, setBatches] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [showExpiringSoon, setShowExpiringSoon] = useState(false);
  const [batchPage, setBatchPage] = useState(1);
  const [batchModal, setBatchModal] = useState(null); // null | "add" | "edit"
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchForm, setBatchForm] = useState(BATCH_EMPTY_FORM);
  const [batchEditForm, setBatchEditForm] = useState(BATCH_EDIT_EMPTY_FORM);
  const [batchFiles, setBatchFiles] = useState(BATCH_FILES_EMPTY);
  const [batchErrors, setBatchErrors] = useState({});
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchCategories, setBatchCategories] = useState([]);
  const [batchProductSuppliers, setBatchProductSuppliers] = useState([]);
  const [batchAllSuppliers, setBatchAllSuppliers] = useState([]);
  const [batchSupplierLoading, setBatchSupplierLoading] = useState(false);
  const [batchDetailModal, setBatchDetailModal] = useState(null);
  const [batchCategoryFilter, setBatchCategoryFilter] = useState("");
  const [batchProductFilter, setBatchProductFilter] = useState("");
  const [batchSupplierFilter, setBatchSupplierFilter] = useState("");
  const dcFileRef = useRef();
  const invoiceFileRef = useRef();

  // Vendor-wide, unconditional ACTIVE supplier list — shared by the
  // Items/Batches list filters (Movements has no Supplier filter — not
  // requested). Distinct from batchAllSuppliers above, which is the
  // Add/Edit Batch modal's product-scoped fallback list.
  const [filterSuppliers, setFilterSuppliers] = useState([]);

  const toast = useToast();
  const fetchedRef = useRef({});

  const {
    fields: cfFields, cfValues, handleCfChange,
    loadValues: loadCfValues, resetValues: resetCfValues,
    validateCf, saveCfValues, refreshFields,
  } = useCustomFields(CF_TABLE);
  const cfValuesMap = useTableCfValues(CF_TABLE, items);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  // ── Product picker (Items "Add"/"Edit" + Batches "Add") ─────────────────
  useEffect(() => {
    productMasterService.getAll({ page_size: 5000 }).then((res) => {
      const d = res.data;
      setProducts(Array.isArray(d) ? d : (d?.items || []));
    }).catch(() => { /* picker just stays empty */ });
  }, []);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.ID, label: `${p.PRODUCT_CODE} — ${p.PRODUCT_NAME}` })),
    [products]
  );

  // ── Category picker (Batches "Add" — filter-only, see D3) ───────────────
  useEffect(() => {
    inventoryCategoryService.getAll().then((res) => {
      const d = res.data;
      setBatchCategories((Array.isArray(d) ? d : (d?.items || [])).filter((c) => c.IS_ACTIVE !== false));
    }).catch(() => { /* picker just stays empty */ });
  }, []);

  const categoryOptions = useMemo(
    () => batchCategories.map((c) => ({ value: c.ID, label: c.NAME })),
    [batchCategories]
  );

  // Category filters the Product picker only — never sent to the backend
  // and never stored on InventoryBatch (ProductMaster.CATEGORY_ID is the
  // single source of truth for that relationship).
  const batchProductOptions = useMemo(() => {
    const list = batchForm.CATEGORY_ID
      ? products.filter((p) => p.CATEGORY_ID === batchForm.CATEGORY_ID)
      : products;
    return list.map((p) => ({ value: p.ID, label: `${p.PRODUCT_CODE} — ${p.PRODUCT_NAME}` }));
  }, [products, batchForm.CATEGORY_ID]);

  // Supplier options shown in the Add/Edit Batch modal — the product-
  // specific list (preferred-first), falling back to every active
  // supplier if the product has no supplier-product link yet (D4).
  const batchSupplierOptions = useMemo(() => {
    const source = batchProductSuppliers.length > 0 ? batchProductSuppliers : batchAllSuppliers;
    return source.map((s) => ({
      value: s.SUPPLIER_ID,
      label: s.SUPPLIER_CODE ? `${s.COMPANY_NAME} (${s.SUPPLIER_CODE})` : s.COMPANY_NAME,
    }));
  }, [batchProductSuppliers, batchAllSuppliers]);

  // ── Supplier picker for the Items/Batches LIST filters (not the
  // Add/Edit Batch modal's own product-scoped suppliers above) —
  // vendor-wide, unconditional, ACTIVE-only per the requirement. ────────
  useEffect(() => {
    supplierManagementService.getAll().then((res) => {
      const d = res.data;
      setFilterSuppliers((Array.isArray(d) ? d : []).filter((s) => s.STATUS === "ACTIVE"));
    }).catch(() => { /* picker just stays empty */ });
  }, []);

  const filterSupplierOptions = useMemo(
    () => filterSuppliers.map((s) => ({ value: s.ID, label: s.COMPANY_NAME || s.SUPPLIER_CODE })),
    [filterSuppliers]
  );

  // Category→Product cascades for the Items/Batches/Movements LIST
  // filters — same filter-only pattern as batchProductOptions above,
  // each keyed off its own tab's filter state.
  const itemFilterProductOptions = useMemo(() => {
    const list = itemCategoryFilter ? products.filter((p) => p.CATEGORY_ID === itemCategoryFilter) : products;
    return list.map((p) => ({ value: p.ID, label: `${p.PRODUCT_CODE} — ${p.PRODUCT_NAME}` }));
  }, [products, itemCategoryFilter]);

  const batchFilterProductOptions = useMemo(() => {
    const list = batchCategoryFilter ? products.filter((p) => p.CATEGORY_ID === batchCategoryFilter) : products;
    return list.map((p) => ({ value: p.ID, label: `${p.PRODUCT_CODE} — ${p.PRODUCT_NAME}` }));
  }, [products, batchCategoryFilter]);

  const movFilterProductOptions = useMemo(() => {
    const list = movCategoryFilter ? products.filter((p) => p.CATEGORY_ID === movCategoryFilter) : products;
    return list.map((p) => ({ value: p.ID, label: `${p.PRODUCT_CODE} — ${p.PRODUCT_NAME}` }));
  }, [products, movCategoryFilter]);

  // ── Loaders ────────────────────────────────────────────────────────────
  const loadItems = useCallback(async (silent = false) => {
    if (!silent) setItemsLoading(true); else setItemsRefreshing(true);
    try {
      const params = { page_size: 5000 };
      if (itemCategoryFilter) params.category_id = itemCategoryFilter;
      if (itemProductFilter) params.product_id = itemProductFilter;
      if (itemSupplierFilter) params.supplier_id = itemSupplierFilter;
      const res = await inventoryItemService.getAll(params);
      const d = res.data;
      setItems(Array.isArray(d) ? d : (d?.items || []));
    } catch {
      toast.showError("Failed to load inventory items");
    } finally {
      setItemsLoading(false);
      setItemsRefreshing(false);
    }
  }, [itemCategoryFilter, itemProductFilter, itemSupplierFilter]);

  const loadMovements = useCallback(async () => {
    setMovLoading(true);
    try {
      const params = { page_size: 5000 };
      if (movTypeFilter) params.movement_type = movTypeFilter;
      if (movCategoryFilter) params.category_id = movCategoryFilter;
      if (movProductFilter) params.product_id = movProductFilter;
      if (movCustomerFilter) params.customer_id = movCustomerFilter;
      if (movProjectFilter) params.project_id = movProjectFilter;
      if (movFilterFrom) params.from_date = movFilterFrom;
      if (movFilterTo) params.to_date = movFilterTo;
      const res = await inventoryItemService.getMovements(params);
      const d = res.data;
      setMovements(Array.isArray(d) ? d : (d?.items || []));
    } catch {
      toast.showError("Failed to load movements");
    } finally {
      setMovLoading(false);
    }
  }, [movTypeFilter, movCategoryFilter, movProductFilter, movCustomerFilter, movProjectFilter, movFilterFrom, movFilterTo]);

  const loadBatches = useCallback(async () => {
    setBatchLoading(true);
    try {
      if (showExpiringSoon) {
        const res = await inventoryItemService.getExpiringBatches(30);
        setBatches(Array.isArray(res.data) ? res.data : (res.data?.items || []));
        return;
      }
      const params = { page_size: 5000 };
      if (batchCategoryFilter) params.category_id = batchCategoryFilter;
      if (batchProductFilter) params.product_id = batchProductFilter;
      if (batchSupplierFilter) params.supplier_id = batchSupplierFilter;
      const res = await inventoryItemService.getBatches(params);
      const d = res.data;
      setBatches(Array.isArray(d) ? d : (d?.items || []));
    } catch {
      toast.showError("Failed to load batches");
    } finally {
      setBatchLoading(false);
    }
  }, [showExpiringSoon, batchCategoryFilter, batchProductFilter, batchSupplierFilter]);

  useEffect(() => {
    if (activeTab === "items" && !fetchedRef.current.items) {
      fetchedRef.current.items = true;
      loadItems();
    }
    if (activeTab === "movements" && !fetchedRef.current.movements) {
      fetchedRef.current.movements = true;
      loadMovements();
      customerMasterService.getAll().then((res) => {
        setCustomers(res.data?.rows || res.data || []);
      }).catch(() => {});
      projectService.getAll().then((res) => {
        setProjects(res.data || []);
      }).catch(() => {});
    }
    if (activeTab === "batches" && !fetchedRef.current.batches) {
      fetchedRef.current.batches = true;
      loadBatches();
    }
  }, [activeTab, loadItems, loadMovements, loadBatches]);

  // Re-fetch movements (server-side filtered) whenever a movement filter
  // changes, while the tab is active — mirrors the showExpiringSoon ->
  // loadBatches effect below.
  useEffect(() => {
    if (activeTab === "movements") {
      setMovPage(1);
      loadMovements();
    }
  }, [movTypeFilter, movCategoryFilter, movProductFilter, movCustomerFilter, movProjectFilter, movFilterFrom, movFilterTo]);

  useEffect(() => {
    if (activeTab === "batches") {
      fetchedRef.current.batches = false;
      loadBatches();
    }
  }, [showExpiringSoon, batchCategoryFilter, batchProductFilter, batchSupplierFilter]);

  // Re-fetch items (server-side filtered) whenever the Category/Product/
  // Supplier filter changes, while the tab is active — mirrors the
  // Movements/Batches re-fetch effects above. itemSearch/filterStatus/
  // date-range stay client-side, exactly as before.
  useEffect(() => {
    if (activeTab === "items") {
      setItemPage(1);
      loadItems();
    }
  }, [itemCategoryFilter, itemProductFilter, itemSupplierFilter]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.ID, label: c.COMPANY_NAME ? `${c.NAME} — ${c.COMPANY_NAME}` : c.NAME })),
    [customers]
  );
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.ID, label: p.NAME })),
    [projects]
  );

  const handleRefresh = useCallback(() => {
    if (activeTab === "items") { fetchedRef.current.items = false; loadItems(true); }
    if (activeTab === "movements") { loadMovements(); }
    if (activeTab === "batches") { fetchedRef.current.batches = false; loadBatches(); }
  }, [activeTab, loadItems, loadMovements, loadBatches]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const lowStockItems = useMemo(() => items.filter((i) => i.STATUS === "LOW_STOCK"), [items]);
  const outOfStockItems = useMemo(() => items.filter((i) => i.STATUS === "OUT_OF_STOCK"), [items]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (filterStatus) list = list.filter((i) => i.STATUS === filterStatus);
    if (itemSearch.trim()) {
      const t = itemSearch.toLowerCase();
      list = list.filter(
        (i) =>
          (i.PRODUCT_NAME || "").toLowerCase().includes(t) ||
          (i.PRODUCT_CODE || "").toLowerCase().includes(t)
      );
    }
    if (itemFilterFrom || itemFilterTo) {
      const from = itemFilterFrom ? new Date(itemFilterFrom) : null;
      const to = itemFilterTo ? new Date(itemFilterTo) : null;
      list = list.filter((i) => {
        if (!i.UPDATED_AT) return false;
        const d = new Date(i.UPDATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return list;
  }, [items, itemSearch, filterStatus, itemFilterFrom, itemFilterTo]);

  const itemsPaginated = useMemo(
    () => itemPageSize === 0 ? filteredItems : filteredItems.slice((itemPage - 1) * itemPageSize, itemPage * itemPageSize),
    [filteredItems, itemPage, itemPageSize]
  );

  const filteredMovements = useMemo(() => {
    let list = movements;
    if (movSearch.trim()) {
      const t = movSearch.toLowerCase();
      list = list.filter(
        (m) =>
          (m.PRODUCT_NAME || "").toLowerCase().includes(t) ||
          (m.PRODUCT_CODE || "").toLowerCase().includes(t) ||
          (m.REFERENCE_TYPE || "").toLowerCase().includes(t) ||
          (m.reference_detail?.label || "").toLowerCase().includes(t)
      );
    }
    return list;
  }, [movements, movSearch]);

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
    { value: items.filter((i) => i.STATUS === "IN_STOCK").length, label: "In Stock" },
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
      MIN_QTY: item.MIN_QTY ?? 0,
      MAX_QTY: item.MAX_QTY != null ? item.MAX_QTY : "",
    });
    setSelectedItem(item);
    setModal("edit");
    loadCfValues(item.ID);
  }, [loadCfValues]);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelectedItem(null);
    setItemErrors({});
  }, []);

  const handleItemFormChange = useCallback((field, val) => {
    setItemForm((prev) => ({ ...prev, [field]: val }));
    clearFieldError(setItemErrors, field);
  }, []);

  const handleBatchFormChange = useCallback((field, val) => {
    setBatchForm((prev) => ({ ...prev, [field]: val }));
    clearFieldError(setBatchErrors, field);
  }, []);

  // Changing Category resets Product (and therefore Supplier + the
  // Unit Cost suggestion tied to it, since Supplier auto-suggest depends
  // on the selected Product) — mirrors the reset-on-parent-change pattern
  // already used in SupplierProductModal.jsx.
  const handleBatchCategoryChange = useCallback((categoryId) => {
    setBatchForm((prev) => ({ ...prev, CATEGORY_ID: categoryId, PRODUCT_ID: "", SUPPLIER_ID: "", UNIT_COST: "" }));
    setBatchProductSuppliers([]);
    clearFieldError(setBatchErrors, "PRODUCT_ID");
  }, []);

  // Fetches suppliers for the chosen product and auto-selects the top
  // result (preferred-first, then cheapest) into Supplier — still
  // user-changeable afterwards. Falls back to every active supplier if
  // this product has no supplier-product link yet (D4). Also suggests
  // Unit Cost from that supplier's SupplierProduct.UNIT_PRICE (already
  // returned by this same endpoint) — left empty if the fallback
  // (no-price) supplier list is what's used instead.
  const handleBatchProductChange = useCallback(async (productId) => {
    setBatchForm((prev) => ({ ...prev, PRODUCT_ID: productId, SUPPLIER_ID: "", UNIT_COST: "" }));
    clearFieldError(setBatchErrors, "PRODUCT_ID");
    setBatchProductSuppliers([]);
    if (!productId) return;
    setBatchSupplierLoading(true);
    try {
      const res = await inventoryItemService.getProductSuppliers(productId);
      const list = res.data || [];
      setBatchProductSuppliers(list);
      let fallback = [];
      if (list.length === 0) {
        const allRes = await inventoryItemService.getAllSuppliers();
        fallback = allRes.data || [];
        setBatchAllSuppliers(fallback);
      }
      const top = list[0] || fallback[0];
      if (top) setBatchForm((prev) => ({ ...prev, SUPPLIER_ID: top.SUPPLIER_ID, UNIT_COST: top.UNIT_PRICE ?? "" }));
    } catch {
      /* Supplier auto-suggest is best-effort — the field just stays empty */
    } finally {
      setBatchSupplierLoading(false);
    }
  }, []);

  // Manually re-picking a Supplier explicitly re-triggers the Unit Cost
  // suggestion (an intentional overwrite, per the requirement's own
  // carve-out) — looks up the matching SupplierProduct price across
  // whichever list is currently in play, clearing Unit Cost if that
  // supplier has no price mapping (Scenario B: leave it empty for manual
  // entry) rather than leaving a stale price from a different supplier.
  const handleBatchSupplierChange = useCallback((supplierId) => {
    const match = [...batchProductSuppliers, ...batchAllSuppliers].find((s) => s.SUPPLIER_ID === supplierId);
    setBatchForm((prev) => ({ ...prev, SUPPLIER_ID: supplierId, UNIT_COST: match?.UNIT_PRICE ?? "" }));
    clearFieldError(setBatchErrors, "SUPPLIER_ID");
  }, [batchProductSuppliers, batchAllSuppliers]);

  const handleSaveItem = useCallback(async () => {
    const { isValid: itemValid, errors: itemValidErrors } = validateForm(ITEM_RULES, itemForm);
    if (!itemValid) {
      setItemErrors(itemValidErrors);
      return;
    }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setItemSaving(true);
    try {
      const payload = { MIN_QTY: itemForm.MIN_QTY === "" ? 0 : Number(itemForm.MIN_QTY) };
      if (itemForm.MAX_QTY !== "" && itemForm.MAX_QTY !== null && itemForm.MAX_QTY !== undefined) {
        payload.MAX_QTY = Number(itemForm.MAX_QTY);
      }
      if (modal === "add") {
        const res = await inventoryItemService.create({ ...payload, PRODUCT_ID: itemForm.PRODUCT_ID });
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Inventory item added");
      } else {
        await inventoryItemService.update(selectedItem.ID, payload);
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
      description: `Delete "${item.PRODUCT_NAME || item.ID}" from inventory? This cannot be undone.`,
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
        PRODUCT_ID: item.PRODUCT_ID,
        QTY: parseFloat(stockForm.QTY),
        REASON: stockForm.REASON || undefined,
        BATCH_ID: stockForm.BATCH_ID || undefined,
      };
      if (type === "in") await inventoryItemService.stockIn(payload);
      else if (type === "out") await inventoryItemService.stockOut(payload);
      else if (type === "adjust") await inventoryItemService.stockAdjust(payload);
      toast.showSuccess(`Stock ${type === "in" ? "added" : type === "out" ? "removed" : "adjusted"} successfully`);
      setStockModal(null);
      fetchedRef.current.items = false;
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
        "Product Code": item.PRODUCT_CODE || "",
        "Product Name": item.PRODUCT_NAME || "",
        Unit: item.UNIT || "",
        "Current Qty": item.CURRENT_QTY ?? 0,
        "Min Qty": item.MIN_QTY ?? 0,
        "Max Qty": item.MAX_QTY ?? "",
        Status: item.STATUS || "",
        "Updated At": item.UPDATED_AT || "",
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
      "Product Code", "Min Qty", "Max Qty",
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
  const openAddBatch = useCallback(() => {
    setBatchForm(BATCH_EMPTY_FORM);
    setBatchFiles(BATCH_FILES_EMPTY);
    setBatchProductSuppliers([]);
    setBatchAllSuppliers([]);
    setSelectedBatch(null);
    setBatchModal("add");
    setBatchErrors({});
  }, []);

  const openEditBatch = useCallback(async (b) => {
    setBatchEditForm({
      STATUS: b.STATUS || "ACTIVE",
      QTY_REMAINING: b.QTY_REMAINING ?? 0,
      SUPPLIER_ID: b.SUPPLIER_ID || "",
      EXPIRY_DATE: b.EXPIRY_DATE || "",
      IS_NO_EXPIRY: !!b.IS_NO_EXPIRY,
      NOTES: b.NOTES || "",
    });
    setSelectedBatch(b);
    setBatchModal("edit");
    setBatchErrors({});
    setBatchProductSuppliers([]);
    setBatchAllSuppliers([]);
    if (b.PRODUCT_ID) {
      setBatchSupplierLoading(true);
      try {
        const res = await inventoryItemService.getProductSuppliers(b.PRODUCT_ID);
        const list = res.data || [];
        setBatchProductSuppliers(list);
        if (list.length === 0) {
          const allRes = await inventoryItemService.getAllSuppliers();
          setBatchAllSuppliers(allRes.data || []);
        }
      } catch {
        /* Supplier picker just falls back to empty */
      } finally {
        setBatchSupplierLoading(false);
      }
    }
  }, []);

  const openBatchDetails = useCallback(async (b) => {
    setBatchDetailModal({ loading: true });
    try {
      const res = await inventoryItemService.getBatchDetails(b.ID);
      setBatchDetailModal(res.data);
    } catch {
      setBatchDetailModal(null);
      toast.showError("Failed to load batch details");
    }
  }, [toast]);

  const openMovementDetails = useCallback(async (m) => {
    setMovementDetailModal({ loading: true });
    try {
      const res = await inventoryItemService.getMovementDetails(m.ID);
      setMovementDetailModal(res.data);
    } catch {
      setMovementDetailModal(null);
      toast.showError("Failed to load movement details");
    }
  }, [toast]);

  const handleSaveBatch = useCallback(async () => {
    if (batchModal === "add") {
      const { isValid, errors } = validateForm(BATCH_RULES, { ...batchForm, ...batchFiles });
      if (!isValid) { setBatchErrors(errors); return; }
      setBatchSaving(true);
      try {
        const res = await inventoryItemService.createBatch(
          {
            product_id: batchForm.PRODUCT_ID,
            supplier_id: batchForm.SUPPLIER_ID || undefined,
            received_date: batchForm.RECEIVED_DATE || undefined,
            manufacturing_date: batchForm.MANUFACTURING_DATE || undefined,
            expiry_date: batchForm.IS_NO_EXPIRY ? undefined : (batchForm.EXPIRY_DATE || undefined),
            is_no_expiry: batchForm.IS_NO_EXPIRY,
            qty_received: parseFloat(batchForm.QTY_RECEIVED) || 0,
            unit_cost: batchForm.UNIT_COST === "" ? undefined : parseFloat(batchForm.UNIT_COST),
          },
          batchFiles.DC_FILE,
          batchFiles.INVOICE_FILE
        );
        toast.showSuccess(`Batch created — Batch Number ${res.data?.BATCH_NUMBER || ""}`);
        setBatchModal(null);
        fetchedRef.current.batches = false;
        loadBatches();
      } catch (e) {
        toast.showError(e?.response?.data?.detail || "Save failed");
      } finally {
        setBatchSaving(false);
      }
    } else {
      const { isValid, errors } = validateForm(BATCH_EDIT_RULES, batchEditForm);
      if (!isValid) { setBatchErrors(errors); return; }
      setBatchSaving(true);
      try {
        await inventoryItemService.updateBatch(selectedBatch.ID, {
          STATUS: batchEditForm.STATUS,
          QTY_REMAINING: parseFloat(batchEditForm.QTY_REMAINING) || 0,
          SUPPLIER_ID: batchEditForm.SUPPLIER_ID || null,
          IS_NO_EXPIRY: batchEditForm.IS_NO_EXPIRY,
          EXPIRY_DATE: batchEditForm.IS_NO_EXPIRY ? null : (batchEditForm.EXPIRY_DATE || null),
          NOTES: batchEditForm.NOTES || undefined,
        });
        toast.showSuccess("Batch updated");
        setBatchModal(null);
        fetchedRef.current.batches = false;
        loadBatches();
      } catch (e) {
        toast.showError(e?.response?.data?.detail || "Save failed");
      } finally {
        setBatchSaving(false);
      }
    }
  }, [batchForm, batchFiles, batchEditForm, batchModal, selectedBatch, loadBatches, toast]);

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
            <PMButton variant="primary" onClick={openAddBatch}>Add Batch</PMButton>
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
              placeholder="Search by product name or code…"
            />
            <div className={styles.filterSelect}>
              <PMSelect
                value={itemCategoryFilter}
                onChange={(v) => { setItemCategoryFilter(v); setItemProductFilter(""); }}
                options={categoryOptions}
                allowClear
                clearLabel="All Categories"
                placeholder="All Categories"
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={itemProductFilter}
                onChange={setItemProductFilter}
                options={itemFilterProductOptions}
                allowClear
                clearLabel="All Products"
                placeholder="All Products"
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={itemSupplierFilter}
                onChange={setItemSupplierFilter}
                options={filterSupplierOptions}
                allowClear
                clearLabel="All Suppliers"
                placeholder="All Suppliers"
              />
            </div>
            {(itemCategoryFilter || itemProductFilter || itemSupplierFilter) && (
              <button className={styles.clearFilter} onClick={() => { setItemCategoryFilter(""); setItemProductFilter(""); setItemSupplierFilter(""); }}>✕ Clear</button>
            )}
            <div className={styles.filterSelect}>
              <PMSelect
                value={filterStatus}
                onChange={(v) => { setFilterStatus(v); setItemPage(1); }}
                options={STATUS_OPTIONS}
                placeholder="All Statuses"
              />
            </div>
            {filterStatus && (
              <button className={styles.clearFilter} onClick={() => setFilterStatus("")}>✕ Clear</button>
            )}
            <div className={styles.dateFilters}>
              <label className={styles.dateLabel}>Updated From</label>
              <input type="datetime-local" className={styles.dateInput} value={itemFilterFrom} onChange={(e) => { setItemFilterFrom(e.target.value); setItemPage(1); }} />
              <label className={styles.dateLabel}>To</label>
              <input type="datetime-local" className={styles.dateInput} value={itemFilterTo} onChange={(e) => { setItemFilterTo(e.target.value); setItemPage(1); }} />
              {(itemFilterFrom || itemFilterTo) && <button className={styles.clearFilter} onClick={() => { setItemFilterFrom(""); setItemFilterTo(""); }}>✕</button>}
            </div>
            <span className={styles.count}>{filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>Current Qty</th>
                  <th>Min Qty</th>
                  <th>Max Qty</th>
                  <th>Status</th>
                  <th>Updated At</th>
                  {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {itemsLoading ? (
                  <tr><td colSpan={8 + cfFields.length}><Loader /></td></tr>
                ) : itemsPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={8 + cfFields.length}>
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
                    const status = item.STATUS || "IN_STOCK";
                    return (
                      <tr key={item.ID}>
                        <td className={styles.idx}>{(itemPage - 1) * itemPageSize + i + 1}</td>
                        <td className={styles.productCell}>
                          <span className={styles.productName}>{item.PRODUCT_NAME || <span className={styles.muted}>—</span>}</span>
                          {item.PRODUCT_CODE && <span className={styles.productCode}>{item.PRODUCT_CODE}</span>}
                        </td>
                        <td className={styles.numCell}>{item.CURRENT_QTY != null ? item.CURRENT_QTY.toLocaleString() : "—"}</td>
                        <td className={styles.numCell}>{item.MIN_QTY ?? "—"}</td>
                        <td className={styles.numCell}>{item.MAX_QTY != null ? item.MAX_QTY : <span className={styles.muted}>No cap</span>}</td>
                        <td>
                          <span className={`${styles.statusBadge} ${statusClass(status)}`}>
                            {status.replace("_", " ")}
                          </span>
                        </td>
                        <td>{formatDateTime(item.UPDATED_AT)}</td>
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
            <div className={styles.filterSelect}>
              <PMSelect
                value={movTypeFilter}
                onChange={(v) => setMovTypeFilter(v)}
                options={[{ value: "", label: "All Types" }, ...MOVEMENT_TYPES]}
                placeholder="All Types"
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={movCategoryFilter}
                onChange={(v) => { setMovCategoryFilter(v); setMovProductFilter(""); }}
                options={categoryOptions}
                allowClear
                clearLabel="All Categories"
                placeholder="All Categories"
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={movProductFilter}
                onChange={(v) => setMovProductFilter(v)}
                options={movFilterProductOptions}
                allowClear
                clearLabel="All Products"
                placeholder="All Products"
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={movCustomerFilter}
                onChange={(v) => setMovCustomerFilter(v)}
                options={customerOptions}
                allowClear
                clearLabel="All Customers"
                placeholder="All Customers"
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={movProjectFilter}
                onChange={(v) => setMovProjectFilter(v)}
                options={projectOptions}
                allowClear
                clearLabel="All Projects"
                placeholder="All Projects"
              />
            </div>
            <div className={styles.dateFilters}>
              <label className={styles.dateLabel}>From</label>
              <input type="date" className={styles.dateInput} value={movFilterFrom} onChange={(e) => setMovFilterFrom(e.target.value)} />
              <label className={styles.dateLabel}>To</label>
              <input type="date" className={styles.dateInput} value={movFilterTo} onChange={(e) => setMovFilterTo(e.target.value)} />
              {(movFilterFrom || movFilterTo) && <button className={styles.clearFilter} onClick={() => { setMovFilterFrom(""); setMovFilterTo(""); }}>✕</button>}
            </div>
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
                  <th>Diff</th>
                  <th>Reference</th>
                  <th>Performed By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {movLoading ? (
                  <tr><td colSpan={11}><Loader /></td></tr>
                ) : movPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={11}>
                      <EmptyState icon={InventoryIcon} iconAlt="Movements" title="No movements found" />
                    </td>
                  </tr>
                ) : (
                  movPaginated.map((m, i) => (
                    <tr key={m.ID}>
                      <td className={styles.idx}>{(movPage - 1) * 25 + i + 1}</td>
                      <td className={styles.dateCell}>{m.CREATED_AT ? new Date(m.CREATED_AT).toLocaleString() : "—"}</td>
                      <td className={styles.productCell}>
                        <span className={styles.productName}>{m.PRODUCT_NAME || m.PRODUCT_ID}</span>
                        {m.PRODUCT_CODE && <span className={styles.productCode}>{m.PRODUCT_CODE}</span>}
                      </td>
                      <td>
                        <span className={`${styles.movType} ${movTypeClass(m.MOVEMENT_TYPE)}`}>
                          {m.MOVEMENT_TYPE?.replace("_", " ")}
                        </span>
                      </td>
                      <td className={styles.numCell}>{m.QTY != null ? m.QTY.toLocaleString() : "—"}</td>
                      <td className={styles.numCell}>{m.QTY_BEFORE != null ? m.QTY_BEFORE.toLocaleString() : "—"}</td>
                      <td className={styles.numCell}>{m.QTY_AFTER != null ? m.QTY_AFTER.toLocaleString() : "—"}</td>
                      <td className={styles.numCell}>
                        {m.DIFFERENCE != null ? (m.DIFFERENCE > 0 ? `+${m.DIFFERENCE}` : m.DIFFERENCE) : "—"}
                      </td>
                      <td className={styles.descCell} title={m.reference_detail?.label || m.REFERENCE_ID || ""}>
                        {m.reference_detail?.label || m.REFERENCE_TYPE || <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.descCell}>{m.PERFORMED_BY_NAME || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <button className={styles.iconBtn} onClick={() => openMovementDetails(m)} title="View Details">
                          <img src={DetailsIcon} alt="Details" />
                        </button>
                      </td>
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
            <div className={styles.filterSelect}>
              <PMSelect
                value={batchCategoryFilter}
                onChange={(v) => { setBatchCategoryFilter(v); setBatchProductFilter(""); }}
                options={categoryOptions}
                allowClear
                clearLabel="All Categories"
                placeholder="All Categories"
                disabled={showExpiringSoon}
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={batchProductFilter}
                onChange={setBatchProductFilter}
                options={batchFilterProductOptions}
                allowClear
                clearLabel="All Products"
                placeholder="All Products"
                disabled={showExpiringSoon}
              />
            </div>
            <div className={styles.filterSelect}>
              <PMSelect
                value={batchSupplierFilter}
                onChange={setBatchSupplierFilter}
                options={filterSupplierOptions}
                allowClear
                clearLabel="All Suppliers"
                placeholder="All Suppliers"
                disabled={showExpiringSoon}
              />
            </div>
            {(batchCategoryFilter || batchProductFilter || batchSupplierFilter) && (
              <button className={styles.clearFilter} onClick={() => { setBatchCategoryFilter(""); setBatchProductFilter(""); setBatchSupplierFilter(""); }}>✕ Clear</button>
            )}
            <span className={styles.count}>{batches.length} batch{batches.length !== 1 ? "es" : ""}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>Batch No.</th>
                  <th>Qty Remaining</th>
                  <th>Unit Cost</th>
                  <th>Received</th>
                  <th>MFG Date</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batchLoading ? (
                  <tr><td colSpan={10}><Loader /></td></tr>
                ) : batchPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState icon={InventoryIcon} iconAlt="Batches" title="No batches found" description="Add a batch to start tracking inventory lots." />
                    </td>
                  </tr>
                ) : (
                  batchPaginated.map((b, i) => {
                    const expClass = b.IS_NO_EXPIRY ? "" : isExpired(b.EXPIRY_DATE) ? styles.expiryExpired : isExpiringSoon(b.EXPIRY_DATE) ? styles.expirySoon : "";
                    return (
                      <tr key={b.ID}>
                        <td className={styles.idx}>{(batchPage - 1) * 25 + i + 1}</td>
                        <td className={styles.productCell}>
                          <span className={styles.productName}>{b.PRODUCT_NAME || b.PRODUCT_ID}</span>
                          {b.PRODUCT_CODE && <span className={styles.productCode}>{b.PRODUCT_CODE}</span>}
                        </td>
                        <td className={styles.monoCell}>{b.BATCH_NUMBER}</td>
                        <td className={styles.numCell}>{b.QTY_REMAINING?.toLocaleString() ?? "—"}</td>
                        <td className={styles.numCell}>{b.UNIT_COST != null ? `₹${Number(b.UNIT_COST).toLocaleString()}` : "—"}</td>
                        <td className={styles.dateCell}>{b.RECEIVED_DATE ? new Date(b.RECEIVED_DATE).toLocaleDateString() : "—"}</td>
                        <td className={styles.dateCell}>{b.MANUFACTURING_DATE ? new Date(b.MANUFACTURING_DATE).toLocaleDateString() : "—"}</td>
                        <td className={`${styles.dateCell} ${expClass}`}>
                          {b.IS_NO_EXPIRY ? (
                            <span className={styles.muted}>No Expiry</span>
                          ) : (
                            <>
                              {b.EXPIRY_DATE ? new Date(b.EXPIRY_DATE).toLocaleDateString() : "—"}
                              {isExpired(b.EXPIRY_DATE) && <span className={styles.expiredTag}> Expired</span>}
                              {!isExpired(b.EXPIRY_DATE) && isExpiringSoon(b.EXPIRY_DATE) && <span className={styles.soonTag}> !</span>}
                            </>
                          )}
                        </td>
                        <td>
                          <span className={styles.statusBadge}>{b.STATUS}</span>
                        </td>
                        <td>
                          <button className={styles.iconBtn} onClick={() => openBatchDetails(b)} title="View Details">
                            <img src={DetailsIcon} alt="Details" />
                          </button>
                          <button className={styles.iconBtn} onClick={() => openEditBatch(b)} title="Edit">
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
            <label>Product <span className={styles.req}>*</span></label>
            <PMSelect
              options={productOptions}
              value={itemForm.PRODUCT_ID}
              onChange={(v) => handleItemFormChange("PRODUCT_ID", v)}
              placeholder="Select a product…"
              disabled={modal === "edit"}
            />
            {modal === "edit" && <span className={styles.fieldHint}>Product cannot be changed after the stock row is created.</span>}
            {itemErrors.PRODUCT_ID && <span className={styles.fieldError}>{itemErrors.PRODUCT_ID}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Min Qty (reorder at)</label>
            <input className={`${styles.input}${itemErrors.MIN_QTY ? " " + styles.inputError : ""}`} type="number" min={0} step="any" value={itemForm.MIN_QTY} onChange={(e) => handleItemFormChange("MIN_QTY", e.target.value === "" ? "" : parseFloat(e.target.value))} />
            {itemErrors.MIN_QTY && <span className={styles.fieldError}>{itemErrors.MIN_QTY}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Max Qty (cap)</label>
            <input className={`${styles.input}${itemErrors.MAX_QTY ? " " + styles.inputError : ""}`} type="number" min={0} step="any" value={itemForm.MAX_QTY} onChange={(e) => handleItemFormChange("MAX_QTY", e.target.value === "" ? "" : parseFloat(e.target.value))} placeholder="blank = no cap" />
            {itemErrors.MAX_QTY && <span className={styles.fieldError}>{itemErrors.MAX_QTY}</span>}
            {itemErrors._QTY_RANGE && <span className={styles.fieldError}>{itemErrors._QTY_RANGE}</span>}
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
              <span className={styles.stockItemName}>{stockModal.item.PRODUCT_NAME}</span>
              <span className={styles.stockItemCurrent}>
                Current: {stockModal.item.CURRENT_QTY ?? 0}
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

      {/* ── Add Batch Modal ── */}
      <PMModal
        open={batchModal === "add"}
        onClose={() => { setBatchModal(null); setBatchErrors({}); }}
        title="Add Batch"
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => { setBatchModal(null); setBatchErrors({}); }}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSaveBatch} disabled={batchSaving}>
              {batchSaving ? "Saving…" : "Create Batch"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Category</label>
            <PMSelect
              options={categoryOptions}
              value={batchForm.CATEGORY_ID}
              onChange={handleBatchCategoryChange}
              placeholder="All categories…"
            />
            <span className={styles.fieldHint}>Filters the Product list below — not stored on the batch.</span>
          </div>
          <div className={styles.formGroup}>
            <label>Product <span className={styles.req}>*</span></label>
            <PMSelect
              options={batchProductOptions}
              value={batchForm.PRODUCT_ID}
              onChange={handleBatchProductChange}
              placeholder="Select a product…"
            />
            {batchErrors.PRODUCT_ID && <span className={styles.fieldError}>{batchErrors.PRODUCT_ID}</span>}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Supplier</label>
            <PMSelect
              options={batchSupplierOptions}
              value={batchForm.SUPPLIER_ID}
              onChange={handleBatchSupplierChange}
              placeholder={batchSupplierLoading ? "Loading suppliers…" : "Select a supplier…"}
              disabled={!batchForm.PRODUCT_ID}
            />
            <span className={styles.fieldHint}>
              {batchProductSuppliers.length > 0
                ? "Auto-suggested from this product's linked suppliers — you can change it."
                : "No supplier is linked to this product yet — showing every active supplier."}
            </span>
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Batch Number</label>
            <input className={styles.input} value="Generated automatically on save" disabled />
          </div>
          <div className={styles.formGroup}>
            <label>Received Date</label>
            <input className={styles.input} type="date" value={batchForm.RECEIVED_DATE} onChange={(e) => handleBatchFormChange("RECEIVED_DATE", e.target.value)} />
            <span className={styles.fieldHint}>Defaults to today if left blank.</span>
          </div>
          <div className={styles.formGroup}>
            <label>MFG Date</label>
            <input className={`${styles.input}${batchErrors.MANUFACTURING_DATE ? " " + styles.inputError : ""}`} type="date" value={batchForm.MANUFACTURING_DATE} onChange={(e) => handleBatchFormChange("MANUFACTURING_DATE", e.target.value)} />
            {batchErrors.MANUFACTURING_DATE && <span className={styles.fieldError}>{batchErrors.MANUFACTURING_DATE}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Expiry Date</label>
            <input
              className={`${styles.input}${batchErrors.EXPIRY_DATE ? " " + styles.inputError : ""}`}
              type="date"
              value={batchForm.EXPIRY_DATE}
              disabled={batchForm.IS_NO_EXPIRY}
              onChange={(e) => handleBatchFormChange("EXPIRY_DATE", e.target.value)}
            />
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={batchForm.IS_NO_EXPIRY}
                onChange={(e) => setBatchForm((p) => ({ ...p, IS_NO_EXPIRY: e.target.checked, EXPIRY_DATE: e.target.checked ? "" : p.EXPIRY_DATE }))}
              />
              This product does not expire
            </label>
            {batchErrors.EXPIRY_DATE && <span className={styles.fieldError}>{batchErrors.EXPIRY_DATE}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Qty Received <span className={styles.req}>*</span></label>
            <input className={`${styles.input}${batchErrors.QTY_RECEIVED ? " " + styles.inputError : ""}`} type="number" min={0} value={batchForm.QTY_RECEIVED} onChange={(e) => handleBatchFormChange("QTY_RECEIVED", parseFloat(e.target.value) || 0)} />
            {batchErrors.QTY_RECEIVED && <span className={styles.fieldError}>{batchErrors.QTY_RECEIVED}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Unit Cost (₹)</label>
            <input className={`${styles.input}${batchErrors.UNIT_COST ? " " + styles.inputError : ""}`} type="number" min={0} step={0.01} value={batchForm.UNIT_COST} onChange={(e) => handleBatchFormChange("UNIT_COST", e.target.value === "" ? "" : parseFloat(e.target.value) || 0)} placeholder="Auto-suggested from supplier price" />
            {batchErrors.UNIT_COST && <span className={styles.fieldError}>{batchErrors.UNIT_COST}</span>}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Delivery Challan</label>
            <div className={styles.dropzone} onClick={() => dcFileRef.current?.click()}>
              <span>{batchFiles.DC_FILE ? batchFiles.DC_FILE.name : "Click to select a file (PDF, image, or Word doc)"}</span>
            </div>
            <input
              ref={dcFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              style={{ display: "none" }}
              onChange={(e) => { setBatchFiles((p) => ({ ...p, DC_FILE: e.target.files?.[0] || null })); clearFieldError(setBatchErrors, "_FILE_REQUIRED"); }}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Invoice</label>
            <div className={styles.dropzone} onClick={() => invoiceFileRef.current?.click()}>
              <span>{batchFiles.INVOICE_FILE ? batchFiles.INVOICE_FILE.name : "Click to select a file (PDF, image, or Word doc)"}</span>
            </div>
            <input
              ref={invoiceFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              style={{ display: "none" }}
              onChange={(e) => { setBatchFiles((p) => ({ ...p, INVOICE_FILE: e.target.files?.[0] || null })); clearFieldError(setBatchErrors, "_FILE_REQUIRED"); }}
            />
            <span className={styles.fieldHint}>At least one of Delivery Challan / Invoice is required to create a batch.</span>
            {batchErrors._FILE_REQUIRED && <span className={styles.fieldError}>{batchErrors._FILE_REQUIRED}</span>}
          </div>
        </div>
      </PMModal>

      {/* ── Edit Batch Modal — STATUS/QTY_REMAINING/SUPPLIER_ID/
          EXPIRY_DATE/IS_NO_EXPIRY/NOTES are the fields editable
          server-side (BatchUpdate schema) ── */}
      <PMModal
        open={batchModal === "edit"}
        onClose={() => { setBatchModal(null); setBatchErrors({}); }}
        title="Edit Batch"
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => { setBatchModal(null); setBatchErrors({}); }}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSaveBatch} disabled={batchSaving}>
              {batchSaving ? "Saving…" : "Save"}
            </PMButton>
          </>
        }
      >
        {selectedBatch && (
          <div className={styles.formStack}>
            <div className={styles.stockItemInfo}>
              <span className={styles.stockItemName}>{selectedBatch.PRODUCT_NAME}</span>
              <span className={styles.stockItemCurrent}>Batch {selectedBatch.BATCH_NUMBER}</span>
            </div>
            <div className={styles.formGroup}>
              <label>Status</label>
              <PMSelect
                options={BATCH_STATUS_OPTIONS}
                value={batchEditForm.STATUS}
                onChange={(v) => setBatchEditForm((p) => ({ ...p, STATUS: v }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label>Supplier</label>
              <PMSelect
                options={batchSupplierOptions}
                value={batchEditForm.SUPPLIER_ID}
                onChange={(v) => setBatchEditForm((p) => ({ ...p, SUPPLIER_ID: v }))}
                placeholder={batchSupplierLoading ? "Loading suppliers…" : "Select a supplier…"}
              />
              <span className={styles.fieldHint}>Change this if the wrong supplier was picked at creation.</span>
            </div>
            <div className={styles.formGroup}>
              <label>Expiry Date</label>
              <input
                className={`${styles.input}${batchErrors.EXPIRY_DATE ? " " + styles.inputError : ""}`}
                type="date"
                value={batchEditForm.EXPIRY_DATE}
                disabled={batchEditForm.IS_NO_EXPIRY}
                onChange={(e) => setBatchEditForm((p) => ({ ...p, EXPIRY_DATE: e.target.value }))}
              />
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={batchEditForm.IS_NO_EXPIRY}
                  onChange={(e) => setBatchEditForm((p) => ({ ...p, IS_NO_EXPIRY: e.target.checked, EXPIRY_DATE: e.target.checked ? "" : p.EXPIRY_DATE }))}
                />
                This product does not expire
              </label>
              {batchErrors.EXPIRY_DATE && <span className={styles.fieldError}>{batchErrors.EXPIRY_DATE}</span>}
            </div>
            <div className={styles.formGroup}>
              <label>Qty Remaining</label>
              <input className={`${styles.input}${batchErrors.QTY_REMAINING ? " " + styles.inputError : ""}`} type="number" min={0} step="any" value={batchEditForm.QTY_REMAINING} onChange={(e) => setBatchEditForm((p) => ({ ...p, QTY_REMAINING: e.target.value }))} />
              {batchErrors.QTY_REMAINING && <span className={styles.fieldError}>{batchErrors.QTY_REMAINING}</span>}
            </div>
            <div className={styles.formGroup}>
              <label>Notes</label>
              <textarea className={styles.textarea} rows={2} value={batchEditForm.NOTES} onChange={(e) => setBatchEditForm((p) => ({ ...p, NOTES: e.target.value }))} />
            </div>
          </div>
        )}
      </PMModal>

      {/* ── Batch Details Modal ── */}
      <BatchDetailModal
        open={!!batchDetailModal}
        onClose={() => setBatchDetailModal(null)}
        data={batchDetailModal?.loading ? null : batchDetailModal}
      />

      {/* ── Movement Details Modal (Stock In / Stock Out) ── */}
      <MovementDetailModal
        open={!!movementDetailModal}
        onClose={() => setMovementDetailModal(null)}
        data={movementDetailModal?.loading ? null : movementDetailModal}
      />

      {/* ── Bulk Upload Modal ── */}
      <PMModal open={bulkModal} onClose={() => setBulkModal(false)} title="Bulk Upload Inventory Items" size="sm">
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet <strong>"InventoryItems"</strong>. Required column: <strong>Product Code</strong>. Optional: Min Qty, Max Qty{cfFields.length > 0 ? ", and custom field columns" : ""}.
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
      <CustomFieldsModal open={cfOpen} onClose={() => setCfOpen(false)} tableName={CF_TABLE} />

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
