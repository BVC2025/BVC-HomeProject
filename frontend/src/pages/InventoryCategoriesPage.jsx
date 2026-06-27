import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { inventoryCategoryService } from "../services/inventoryCategoryService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import CategoryIcon from "../assets/Icons/inventoryCategorizationIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./InventoryCategoriesPage.module.css";

const EMPTY_FORM = { NAME: "", CODE: "", DESCRIPTION: "", SORT_ORDER: 0 };

export default function InventoryCategoriesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cfOpen, setCfOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

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
  } = useCustomFields("inventory_category");
  const cfValuesMap = useTableCfValues("inventory_category", rows);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await inventoryCategoryService.getAll();
      setRows(res.data || []);
    } catch {
      toast.showError("Failed to load inventory categories");
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
    if (!search.trim()) return rows;
    const t = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.NAME?.toLowerCase().includes(t) ||
        (r.CODE || "").toLowerCase().includes(t) ||
        (r.DESCRIPTION || "").toLowerCase().includes(t)
    );
  }, [rows, search]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Categories" },
    { value: rows.filter((r) => r.IS_ACTIVE).length, label: "Active" },
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
      NAME: row.NAME,
      CODE: row.CODE || "",
      DESCRIPTION: row.DESCRIPTION || "",
      SORT_ORDER: row.SORT_ORDER ?? 0,
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
    if (!form.NAME.trim()) {
      toast.showWarning("Category name is required");
      return;
    }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setSaving(true);
    try {
      if (modal === "add") {
        const res = await inventoryCategoryService.create(form);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Category created");
      } else {
        await inventoryCategoryService.update(selected.ID, form);
        await saveCfValues(selected.ID);
        toast.showSuccess("Category updated");
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
      title: "Delete Category",
      description: `Delete category "${row.NAME}"? This cannot be undone. Categories with products cannot be deleted.`,
      onConfirm: async () => {
        try {
          await inventoryCategoryService.remove(row.ID);
          toast.showSuccess("Category deleted");
          load();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [load, toast]);

  const handleExport = useCallback(() => {
    const data = filtered.map((r, i) => {
      const row = {
        "S.No": i + 1,
        Name: r.NAME,
        Code: r.CODE || "",
        Description: r.DESCRIPTION || "",
        "Sort Order": r.SORT_ORDER ?? 0,
        Active: r.IS_ACTIVE ? "Yes" : "No",
        "Product Count": r.PRODUCT_COUNT ?? 0,
        Created: r.CREATED_AT ? new Date(r.CREATED_AT).toLocaleDateString() : "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(r.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "inventory_categories");
  }, [filtered, cfFields, cfValuesMap]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const headers = ["Name", "Code", "Description", "Sort Order", ...cfFields.map((f) => f.FIELD_NAME)];
      await dlTemplate("Inventory Categories", headers, "inventory_categories_template");
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
      const res = await inventoryCategoryService.bulkUpload(fd);
      setUploadResult(res.data);
      load(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [load, toast]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={CategoryIcon}
        iconAlt="Inventory Categories"
        title="Inventory Categories"
        subtitle="Organize products by categories for better classification and filtering"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={handleDownloadTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={filtered.length === 0} />
            <PMButton variant="primary" onClick={openAdd}>Add Category</PMButton>
          </>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name, code, or description…"
          />
          <span className={styles.count}>{filtered.length} categor{filtered.length !== 1 ? "ies" : "y"}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Code</th>
                <th>Description</th>
                <th>Sort Order</th>
                <th>Products</th>
                <th>Status</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8 + cfFields.length}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8 + cfFields.length}>
                    <EmptyState
                      icon={CategoryIcon}
                      iconAlt="Inventory Categories"
                      title={search ? "No categories match your search" : "No inventory categories yet"}
                      description={!search ? "Click '+ Add Category' to get started." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.NAME}</td>
                    <td>
                      {r.CODE
                        ? <span className={styles.codeBadge}>{r.CODE}</span>
                        : <span className={styles.muted}>—</span>}
                    </td>
                    <td className={styles.descCell}>{r.DESCRIPTION || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.centerCell}>{r.SORT_ORDER ?? 0}</td>
                    <td className={styles.centerCell}>{r.PRODUCT_COUNT ?? 0}</td>
                    <td>
                      <span className={r.IS_ACTIVE ? styles.badgeActive : styles.badgeInactive}>
                        {r.IS_ACTIVE ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(r.ID)]?.[f.ID];
                      return (
                        <td key={f.ID} className={styles.descCell}>
                          {val == null || val === ""
                            ? <span className={styles.muted}>—</span>
                            : Array.isArray(val) ? val.join(", ") : String(val)}
                        </td>
                      );
                    })}
                    <td>
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

      {/* Add / Edit Modal */}
      <PMModal
        open={!!modal}
        onClose={closeModal}
        title={modal === "add" ? "Add Inventory Category" : "Edit Inventory Category"}
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Category" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Category Name <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.NAME}
              onChange={(e) => handleFormChange("NAME", e.target.value)}
              placeholder="e.g. Raw Materials"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Category Code</label>
            <input
              className={styles.input}
              value={form.CODE}
              onChange={(e) => handleFormChange("CODE", e.target.value.toUpperCase())}
              placeholder="e.g. RAW-MAT"
              maxLength={30}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Description</label>
            <textarea
              className={styles.textarea}
              value={form.DESCRIPTION}
              onChange={(e) => handleFormChange("DESCRIPTION", e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Sort Order</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={form.SORT_ORDER}
              onChange={(e) => handleFormChange("SORT_ORDER", parseInt(e.target.value, 10) || 0)}
              placeholder="0"
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
        title="Bulk Upload Inventory Categories"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Inventory Categories"</strong> and columns:{" "}
          <strong>Name</strong>, <strong>Code</strong>, <strong>Description</strong>, <strong>Sort Order</strong>
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Existing records (matched by name) are updated; new ones are inserted.
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
        tableName="inventory_category"
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
