import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { categoryService } from "../services/categoryService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel } from "../utils/exportExcel";
import CategoryIcon from "../assets/Icons/categoriesIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import styles from "./ProjectCategoryManagement.module.css";

const EMPTY_FORM = { NAME: "", DESCRIPTION: "" };

export default function ProjectCategoryManagement() {
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cfOpen, setCfOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);
  const { fields: cfFields, cfValues, handleCfChange, loadValues: loadCfValues, resetValues: resetCfValues, validateCf, saveCfValues, refreshFields } = useCustomFields("project_category");
  const cfValuesMap = useTableCfValues("project_category", cats);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await categoryService.getAll();
      setCats(res.data || []);
    } catch {
      toast.showError("Failed to load categories");
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
    if (!search.trim()) return cats;
    const t = search.toLowerCase();
    return cats.filter(
      (c) =>
        c.NAME?.toLowerCase().includes(t) ||
        (c.DESCRIPTION || "").toLowerCase().includes(t)
    );
  }, [cats, search]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: cats.length, label: "Total Categories" },
    { value: filtered.length, label: "Showing" },
  ], [cats.length, filtered.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setModal("add");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback((cat) => {
    setForm({ NAME: cat.NAME, DESCRIPTION: cat.DESCRIPTION || "" });
    setSelected(cat);
    setModal("edit");
    loadCfValues(cat.ID);
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
    const missingCf = validateCf();
    if (missingCf) { toast.showWarning(`"${missingCf}" is required`); return; }
    setSaving(true);
    try {
      if (modal === "add") {
        const res = await categoryService.create(form);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Category created");
      } else {
        await categoryService.update(selected.ID, form);
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

  const handleDelete = useCallback((cat) => {
    setConfirmModal({
      title: "Delete Category",
      description: `Delete category "${cat.NAME}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await categoryService.remove(cat.ID);
          toast.showSuccess("Category deleted");
          load();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [load, toast]);

  const handleExport = useCallback(() => {
    const data = filtered.map((c, i) => {
      const row = {
        "S.No": i + 1,
        Name: c.NAME,
        Description: c.DESCRIPTION || "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(c.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "project_categories");
  }, [filtered, cfFields, cfValuesMap]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={CategoryIcon}
        iconAlt="Categories"
        title="Project Category Management"
        subtitle="Organize projects by categories for better classification"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
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
            placeholder="Search categories…"
          />
          <span className={styles.count}>{filtered.length} categor{filtered.length !== 1 ? "ies" : "y"}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Description</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4 + cfFields.length}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={4 + cfFields.length}>
                    <EmptyState
                      icon={CategoryIcon}
                      iconAlt="Categories"
                      title={search ? "No categories match your search" : "No categories yet"}
                      description={!search ? "Click '+ Add Category' to get started." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((c, i) => (
                  <tr key={c.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{c.NAME}</td>
                    <td className={styles.descCell}>{c.DESCRIPTION || <span className={styles.muted}>—</span>}</td>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(c.ID)]?.[f.ID];
                      return <td key={f.ID} className={styles.descCell}>{val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}</td>;
                    })}
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} onClick={() => openEdit(c)} title="Edit">
                          <img src={EditIcon} alt="Edit" />
                        </button>
                        <button className={styles.iconBtnDanger} onClick={() => handleDelete(c)} title="Delete">
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
        title={modal === "add" ? "Add Category" : "Edit Category"}
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
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Category Name <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.NAME}
              onChange={(e) => handleFormChange("NAME", e.target.value)}
              placeholder="e.g. Civil Works"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Description</label>
            <textarea
              className={styles.textarea}
              value={form.DESCRIPTION}
              onChange={(e) => handleFormChange("DESCRIPTION", e.target.value)}
              placeholder="Optional description"
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

      {/* Custom Fields Modal */}
      <CustomFieldsModal
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        tableName="project_category"
      />

      {/* Delete Confirmation */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => {})}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
