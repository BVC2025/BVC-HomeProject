import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal, PMSelect,
} from "../components/pm";
import { productMasterService } from "../services/productMasterService";
import { inventoryCategoryService } from "../services/inventoryCategoryService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import ProductMasterIcon from "../assets/Icons/productMasterIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./ProductMasterPage.module.css";

const EMPTY_FORM = {
  PRODUCT_CODE: "", PRODUCT_NAME: "", CATEGORY_ID: "",
  DEPARTMENT_ID: "", HSN_CODE: "", UNIT: "PCS",
  DESCRIPTION: "", STATUS: "ACTIVE",
};

const UNIT_OPTIONS = [
  { value: "PCS", label: "PCS — Pieces" },
  { value: "KG", label: "KG — Kilograms" },
  { value: "LTR", label: "LTR — Litres" },
  { value: "MTR", label: "MTR — Metres" },
  { value: "BOX", label: "BOX — Boxes" },
  { value: "SET", label: "SET — Sets" },
  { value: "ROLL", label: "ROLL — Rolls" },
  { value: "PAIR", label: "PAIR — Pairs" },
  { value: "NOS", label: "NOS — Numbers" },
  { value: "TON", label: "TON — Tonnes" },
  { value: "SQM", label: "SQM — Sq. Metres" },
  { value: "CUM", label: "CUM — Cu. Metres" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "DISCONTINUED", label: "Discontinued" },
];

export default function ProductMasterPage() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [modal, setModal] = useState(null); // null | "add" | "edit"
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cfOpen, setCfOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

  // Detail drawer
  const [drawerProduct, setDrawerProduct] = useState(null); // product row
  const [drawerSuppliers, setDrawerSuppliers] = useState([]);
  const [drawerRec, setDrawerRec] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Price modal (inside drawer)
  const [priceModal, setPriceModal] = useState(null); // { supplierId, supplierName, currentPrice }
  const [priceForm, setPriceForm] = useState({ UNIT_PRICE: "", AVAILABLE_QTY: "", LEAD_TIME_DAYS: "", CHANGE_REASON: "" });
  const [priceSaving, setPriceSaving] = useState(false);

  // Bulk upload
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();

  const toast = useToast();
  const fetchedRef = useRef(false);
  const {
    fields: cfFields, cfValues, handleCfChange,
    loadValues: loadCfValues, resetValues: resetCfValues,
    validateCf, saveCfValues, refreshFields,
  } = useCustomFields("product_master");
  const cfValuesMap = useTableCfValues("product_master", rows);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [prodRes, catRes] = await Promise.all([
        productMasterService.getAll(),
        inventoryCategoryService.getAll(),
      ]);
      setRows(prodRes.data || []);
      setCategories(catRes.data || []);
    } catch {
      toast.showError("Failed to load products");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [load]);

  const handleRefresh = useCallback(() => load(true), [load]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.PRODUCT_NAME?.toLowerCase().includes(t) ||
          r.PRODUCT_CODE?.toLowerCase().includes(t) ||
          (r.HSN_CODE || "").toLowerCase().includes(t) ||
          (r.DESCRIPTION || "").toLowerCase().includes(t)
      );
    }
    if (filterCategory) list = list.filter((r) => r.CATEGORY_ID === filterCategory);
    if (filterStatus) list = list.filter((r) => r.STATUS === filterStatus);
    return list;
  }, [rows, search, filterCategory, filterStatus]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Products" },
    { value: rows.filter((r) => r.STATUS === "ACTIVE").length, label: "Active" },
    { value: rows.filter((r) => r.STATUS === "INACTIVE").length, label: "Inactive" },
    { value: filtered.length, label: "Showing" },
  ], [rows, filtered.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setModal("add");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback((row) => {
    setForm({
      PRODUCT_CODE: row.PRODUCT_CODE || "",
      PRODUCT_NAME: row.PRODUCT_NAME || "",
      CATEGORY_ID: row.CATEGORY_ID || "",
      DEPARTMENT_ID: row.DEPARTMENT_ID ? String(row.DEPARTMENT_ID) : "",
      HSN_CODE: row.HSN_CODE || "",
      UNIT: row.UNIT || "PCS",
      DESCRIPTION: row.DESCRIPTION || "",
      STATUS: row.STATUS || "ACTIVE",
    });
    setSelected(row);
    setModal("edit");
    loadCfValues(row.ID);
  }, [loadCfValues]);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelected(null);
  }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.PRODUCT_CODE.trim() || !form.PRODUCT_NAME.trim()) {
      toast.showWarning("Product Code and Name are required");
      return;
    }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        CATEGORY_ID: form.CATEGORY_ID || null,
        DEPARTMENT_ID: form.DEPARTMENT_ID ? parseInt(form.DEPARTMENT_ID, 10) : null,
      };
      if (modal === "add") {
        const res = await productMasterService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Product created");
      } else {
        await productMasterService.update(selected.ID, payload);
        await saveCfValues(selected.ID);
        toast.showSuccess("Product updated");
      }
      closeModal();
      load();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, closeModal, load, toast, validateCf, saveCfValues]);

  const handleDelete = useCallback((row) => {
    setConfirmModal({
      title: "Delete Product",
      description: `Delete product "${row.PRODUCT_NAME}"? This cannot be undone. Products with active supplier links cannot be deleted.`,
      onConfirm: async () => {
        try {
          await productMasterService.remove(row.ID);
          toast.showSuccess("Product deleted");
          load();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [load, toast]);

  // Detail Drawer
  const openDrawer = useCallback(async (row) => {
    setDrawerProduct(row);
    setDrawerSuppliers([]);
    setDrawerRec(null);
    setDrawerLoading(true);
    try {
      const [suppRes, recRes] = await Promise.all([
        productMasterService.getSuppliers(row.ID),
        productMasterService.getRecommendation(row.ID).catch(() => ({ data: null })),
      ]);
      setDrawerSuppliers(suppRes.data || []);
      setDrawerRec(recRes.data);
    } catch {
      toast.showError("Failed to load product details");
    } finally {
      setDrawerLoading(false);
    }
  }, [toast]);

  const closeDrawer = useCallback(() => {
    setDrawerProduct(null);
    setDrawerSuppliers([]);
    setDrawerRec(null);
    setPriceModal(null);
  }, []);

  const openPriceModal = useCallback((sp) => {
    setPriceForm({
      UNIT_PRICE: sp.UNIT_PRICE ?? "",
      AVAILABLE_QTY: sp.AVAILABLE_QTY ?? "",
      LEAD_TIME_DAYS: sp.LEAD_TIME_DAYS ?? "",
      CHANGE_REASON: "",
    });
    setPriceModal(sp);
  }, []);

  const handleSavePrice = useCallback(async () => {
    if (!priceForm.UNIT_PRICE || isNaN(Number(priceForm.UNIT_PRICE))) {
      toast.showWarning("Unit price is required and must be a number");
      return;
    }
    setPriceSaving(true);
    try {
      await productMasterService.setSupplierPrice(drawerProduct.ID, priceModal.SUPPLIER_ID, {
        UNIT_PRICE: parseFloat(priceForm.UNIT_PRICE),
        AVAILABLE_QTY: priceForm.AVAILABLE_QTY ? parseFloat(priceForm.AVAILABLE_QTY) : null,
        LEAD_TIME_DAYS: priceForm.LEAD_TIME_DAYS ? parseInt(priceForm.LEAD_TIME_DAYS, 10) : null,
        CHANGE_REASON: priceForm.CHANGE_REASON || null,
      });
      toast.showSuccess("Price updated");
      setPriceModal(null);
      // Refresh drawer data
      const [suppRes, recRes] = await Promise.all([
        productMasterService.getSuppliers(drawerProduct.ID),
        productMasterService.getRecommendation(drawerProduct.ID).catch(() => ({ data: null })),
      ]);
      setDrawerSuppliers(suppRes.data || []);
      setDrawerRec(recRes.data);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Price update failed");
    } finally {
      setPriceSaving(false);
    }
  }, [priceForm, priceModal, drawerProduct, toast]);

  const handleExport = useCallback(() => {
    const data = filtered.map((r, i) => {
      const row = {
        "S.No": i + 1,
        "Product Code": r.PRODUCT_CODE,
        "Product Name": r.PRODUCT_NAME,
        Category: r.CATEGORY_NAME || "",
        Unit: r.UNIT || "",
        "HSN Code": r.HSN_CODE || "",
        Status: r.STATUS || "",
        Description: r.DESCRIPTION || "",
        "Created At": r.CREATED_AT ? new Date(r.CREATED_AT).toLocaleDateString() : "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(r.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "product_master");
  }, [filtered, cfFields, cfValuesMap]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const headers = [
        "Product Code", "Product Name", "Category Name", "Unit", "HSN Code", "Description", "Status",
        ...cfFields.map((f) => f.FIELD_NAME),
      ];
      await dlTemplate("Products", headers, "product_master_template");
    } catch {
      toast.showError("Failed to download template");
    }
  }, [cfFields, toast]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  const openBulk = useCallback(() => {
    setBulkFile(null);
    setUploadResult(null);
    setBulkModal(true);
  }, []);

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
      const res = await productMasterService.bulkUpload(fd);
      setUploadResult(res.data);
      load(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [load, toast]);

  const categoryOptions = useMemo(() => [
    { value: "", label: "All Categories" },
    ...categories.map((c) => ({ value: c.ID, label: c.NAME })),
  ], [categories]);

  const statusChipClass = (status) => {
    if (status === "ACTIVE") return styles.statusActive;
    if (status === "DISCONTINUED") return styles.statusDiscontinued;
    return styles.statusInactive;
  };

  return (
    <div className={styles.page}>
      <PageHeader
        icon={ProductMasterIcon}
        iconAlt="Product Master"
        title="Product Master"
        subtitle="Manage the product catalogue used across procurement, inventory, and BOM"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={handleDownloadTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={filtered.length === 0} />
            <PMButton variant="primary" onClick={openAdd}>Add Product</PMButton>
          </>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        {/* Filters */}
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name, code, HSN…"
          />
          <div className={styles.filters}>
            <PMSelect
              value={filterCategory}
              onChange={(v) => { setFilterCategory(v); setPage(1); }}
              options={categoryOptions}
              placeholder="All Categories"
            />
            <PMSelect
              value={filterStatus}
              onChange={(v) => { setFilterStatus(v); setPage(1); }}
              options={[{ value: "", label: "All Statuses" }, ...STATUS_OPTIONS]}
              placeholder="All Statuses"
            />
          </div>
          <span className={styles.count}>{filtered.length} product{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Code</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>HSN</th>
                <th>Status</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9 + cfFields.length}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9 + cfFields.length}>
                    <EmptyState
                      icon={ProductMasterIcon}
                      iconAlt="Products"
                      title={search || filterCategory || filterStatus ? "No products match your filters" : "No products yet"}
                      description={!search && !filterCategory && !filterStatus ? "Click '+ Add Product' to build your product catalogue." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID} className={styles.clickableRow} onClick={() => openDrawer(r)}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td><span className={styles.codeBadge}>{r.PRODUCT_CODE}</span></td>
                    <td className={styles.nameCell}>{r.PRODUCT_NAME}</td>
                    <td className={styles.descCell}>{r.CATEGORY_NAME || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.unitCell}>{r.UNIT || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.codeCell}>{r.HSN_CODE || <span className={styles.muted}>—</span>}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${statusChipClass(r.STATUS)}`}>
                        {r.STATUS || "—"}
                      </span>
                    </td>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(r.ID)]?.[f.ID];
                      return (
                        <td key={f.ID} className={styles.descCell}>
                          {val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}
                        </td>
                      );
                    })}
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} onClick={() => openEdit(r)} title="Edit">
                          <img src={EditIcon} alt="Edit" />
                        </button>
                        <button className={styles.iconBtnDanger} onClick={() => handleDelete(r)} title="Delete">
                          <img src={DeleteIcon} alt="Delete" />
                        </button>
                      </div>
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

      {/* Detail Drawer */}
      {drawerProduct && (
        <div className={styles.drawerOverlay} onClick={closeDrawer}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div>
                <span className={styles.codeBadge}>{drawerProduct.PRODUCT_CODE}</span>
                <h3 className={styles.drawerTitle}>{drawerProduct.PRODUCT_NAME}</h3>
                <span className={`${styles.statusBadge} ${statusChipClass(drawerProduct.STATUS)}`}>
                  {drawerProduct.STATUS}
                </span>
              </div>
              <button className={styles.drawerClose} onClick={closeDrawer}>✕</button>
            </div>

            <div className={styles.drawerMeta}>
              {drawerProduct.CATEGORY_NAME && <span>Category: <strong>{drawerProduct.CATEGORY_NAME}</strong></span>}
              {drawerProduct.UNIT && <span>Unit: <strong>{drawerProduct.UNIT}</strong></span>}
              {drawerProduct.HSN_CODE && <span>HSN: <strong>{drawerProduct.HSN_CODE}</strong></span>}
            </div>

            {drawerLoading ? (
              <Loader />
            ) : (
              <>
                {/* Recommendation */}
                {drawerRec && (
                  <div className={styles.recBanner}>
                    <span className={styles.recLabel}>Recommended Supplier</span>
                    <span className={styles.recValue}>
                      Supplier #{drawerRec.RECOMMENDED_SUPPLIER_ID} — ₹{Number(drawerRec.RECOMMENDED_PRICE).toLocaleString()}
                    </span>
                    {drawerRec.RECOMMENDATION_REASON && (
                      <span className={styles.recReason}>{drawerRec.RECOMMENDATION_REASON}</span>
                    )}
                  </div>
                )}

                {/* Supplier Pricing */}
                <div className={styles.drawerSection}>
                  <h4 className={styles.drawerSectionTitle}>Supplier Pricing ({drawerSuppliers.length})</h4>
                  {drawerSuppliers.length === 0 ? (
                    <p className={styles.drawerEmpty}>No supplier prices set yet.</p>
                  ) : (
                    <div className={styles.supplierTable}>
                      <table className={styles.innerTable}>
                        <thead>
                          <tr>
                            <th>Rank</th>
                            <th>Supplier</th>
                            <th>Unit Price</th>
                            <th>MOQ</th>
                            <th>Lead Days</th>
                            <th>Avail. Qty</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {drawerSuppliers.map((sp, idx) => (
                            <tr key={sp.SUPPLIER_PRODUCT_ID || idx}>
                              <td>
                                <span className={idx === 0 ? styles.rank1 : styles.rankN}>
                                  #{sp.RANK ?? idx + 1}
                                </span>
                              </td>
                              <td className={styles.nameCell}>
                                {sp.SUPPLIER_NAME || `Supplier #${sp.SUPPLIER_ID}`}
                                {sp.IS_PREFERRED && <span className={styles.preferredBadge}>Preferred</span>}
                              </td>
                              <td className={styles.priceCell}>
                                ₹{Number(sp.UNIT_PRICE).toLocaleString()}
                              </td>
                              <td>{sp.MOQ ?? "—"}</td>
                              <td>{sp.LEAD_TIME_DAYS ?? "—"}</td>
                              <td>{sp.AVAILABLE_QTY ?? "—"}</td>
                              <td>
                                <button
                                  className={styles.setPriceBtn}
                                  onClick={() => openPriceModal(sp)}
                                >
                                  Update Price
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Set Price Modal */}
      <PMModal
        open={!!priceModal}
        onClose={() => setPriceModal(null)}
        title="Update Supplier Price"
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setPriceModal(null)}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSavePrice} disabled={priceSaving}>
              {priceSaving ? "Saving…" : "Update Price"}
            </PMButton>
          </>
        }
      >
        {priceModal && (
          <div className={styles.formGrid}>
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <label>Supplier</label>
              <p className={styles.infoText}>{priceModal.SUPPLIER_NAME || `Supplier #${priceModal.SUPPLIER_ID}`}</p>
            </div>
            <div className={styles.formGroup}>
              <label>Unit Price (₹) <span className={styles.req}>*</span></label>
              <input
                className={styles.input}
                type="number"
                min={0}
                step={0.01}
                value={priceForm.UNIT_PRICE}
                onChange={(e) => setPriceForm((p) => ({ ...p, UNIT_PRICE: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className={styles.formGroup}>
              <label>Available Qty</label>
              <input
                className={styles.input}
                type="number"
                min={0}
                value={priceForm.AVAILABLE_QTY}
                onChange={(e) => setPriceForm((p) => ({ ...p, AVAILABLE_QTY: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className={styles.formGroup}>
              <label>Lead Time (days)</label>
              <input
                className={styles.input}
                type="number"
                min={0}
                value={priceForm.LEAD_TIME_DAYS}
                onChange={(e) => setPriceForm((p) => ({ ...p, LEAD_TIME_DAYS: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <label>Change Reason</label>
              <input
                className={styles.input}
                value={priceForm.CHANGE_REASON}
                onChange={(e) => setPriceForm((p) => ({ ...p, CHANGE_REASON: e.target.value }))}
                placeholder="Optional reason for this price change"
              />
            </div>
          </div>
        )}
      </PMModal>

      {/* Add / Edit Modal */}
      <PMModal
        open={!!modal}
        onClose={closeModal}
        title={modal === "add" ? "Add Product" : "Edit Product"}
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Product" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Product Code <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.PRODUCT_CODE}
              onChange={(e) => handleFormChange("PRODUCT_CODE", e.target.value.toUpperCase())}
              placeholder="e.g. BOLT-M6-SS"
              maxLength={50}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Product Name <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.PRODUCT_NAME}
              onChange={(e) => handleFormChange("PRODUCT_NAME", e.target.value)}
              placeholder="e.g. SS Bolt M6×25"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Category</label>
            <PMSelect
              value={form.CATEGORY_ID}
              onChange={(v) => handleFormChange("CATEGORY_ID", v)}
              options={[{ value: "", label: "Select Category" }, ...categories.map((c) => ({ value: c.ID, label: c.NAME }))]}
              placeholder="Select Category"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Unit</label>
            <PMSelect
              value={form.UNIT}
              onChange={(v) => handleFormChange("UNIT", v)}
              options={UNIT_OPTIONS}
              placeholder="Select Unit"
            />
          </div>
          <div className={styles.formGroup}>
            <label>HSN Code</label>
            <input
              className={styles.input}
              value={form.HSN_CODE}
              onChange={(e) => handleFormChange("HSN_CODE", e.target.value)}
              placeholder="e.g. 7318"
              maxLength={20}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Status</label>
            <PMSelect
              value={form.STATUS}
              onChange={(v) => handleFormChange("STATUS", v)}
              options={STATUS_OPTIONS}
              placeholder="Select Status"
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Description</label>
            <textarea
              className={styles.textarea}
              value={form.DESCRIPTION}
              onChange={(e) => handleFormChange("DESCRIPTION", e.target.value)}
              placeholder="Optional product description or specifications"
              rows={3}
            />
          </div>
        </div>
        <CustomFieldsSection
          fields={cfFields}
          values={cfValues}
          onChange={handleCfChange}
        />
      </PMModal>

      {/* Bulk Upload Modal */}
      <PMModal
        open={bulkModal}
        onClose={() => setBulkModal(false)}
        title="Bulk Upload Products"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Products"</strong> and columns:{" "}
          <strong>Product Code</strong>, <strong>Product Name</strong>, <strong>Category Name</strong>,{" "}
          <strong>Unit</strong>, <strong>HSN Code</strong>
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Existing records (matched by product code) are updated; new ones are inserted.
        </p>
        <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
          <span className={styles.dropIconWrap}><img src={UploadIcon} alt="Upload" /></span>
          <span>{bulkFile ? bulkFile.name : "Click to browse or drop Excel (.xlsx)"}</span>
          {bulkUploading && <span>Uploading…</span>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        {uploadResult && (
          <div className={styles.uploadResult}>
            <div className={styles.resultStats}>
              <div className={styles.resultStat}>
                <span className={styles.statValue}>{uploadResult.inserted ?? 0}</span>
                <span className={styles.statLabel}>Inserted</span>
              </div>
              <div className={styles.resultStat}>
                <span className={styles.statValue}>{uploadResult.updated ?? 0}</span>
                <span className={styles.statLabel}>Updated</span>
              </div>
              <div className={styles.resultStat}>
                <span className={styles.statValue}>{uploadResult.skipped ?? 0}</span>
                <span className={styles.statLabel}>Skipped</span>
              </div>
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

      {/* Custom Fields Config Modal */}
      <CustomFieldsModal
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        tableName="product_master"
      />

      {/* Delete Confirmation */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => { })}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
