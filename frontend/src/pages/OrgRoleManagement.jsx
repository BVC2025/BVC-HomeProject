import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMSelect, PMConfirmModal,
} from "../components/pm";
import { roleService } from "../services/roleService";
import { departmentService } from "../services/departmentService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import RoleIcon from "../assets/Icons/roleIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import styles from "./OrgRoleManagement.module.css";

const EMPTY_FORM = { ROLE_NAME: "", DEPARTMENT_ID: "", DESCRIPTION: "" };

export default function OrgRoleManagement() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState(null);
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
  const [bulkSheets, setBulkSheets] = useState([]);
  const [bulkSheet, setBulkSheet] = useState("");
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileRef = useRef();

  const toast = useToast();
  const fetchedRef = useRef(false);
  const { fields: cfFields, cfValues, handleCfChange, loadValues: loadCfValues, resetValues: resetCfValues, validateCf, saveCfValues, refreshFields } = useCustomFields("role");
  const cfValuesMap = useTableCfValues("role", rows);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [rolesRes, deptsRes] = await Promise.all([
        roleService.getAll(),
        departmentService.getAll(),
      ]);
      setRows(rolesRes.data || []);
      setDepartments(deptsRes.data || []);
    } catch {
      toast.showError("Failed to load data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadAll();
  }, [loadAll]);

  const handleRefresh = useCallback(() => loadAll(true), [loadAll]);

  const deptMap = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.ID, d.NAME])),
    [departments]
  );

  const filtered = useMemo(() => {
    let data = rows;
    if (filterDept) data = data.filter((r) => String(r.DEPARTMENT_ID) === String(filterDept));
    if (search.trim()) {
      const t = search.toLowerCase();
      data = data.filter(
        (r) =>
          r.NAME?.toLowerCase().includes(t) ||
          (r.DESCRIPTION || "").toLowerCase().includes(t)
      );
    }
    return data;
  }, [rows, search, filterDept]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Roles" },
    { value: rows.filter((r) => r.DEPARTMENT_ID).length, label: "With Department" },
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
      ROLE_NAME: row.NAME,
      DEPARTMENT_ID: row.DEPARTMENT_ID || "",
      DESCRIPTION: row.DESCRIPTION || "",
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
    if (!form.ROLE_NAME.trim()) {
      toast.showWarning("Role name is required");
      return;
    }
    const missingCf = validateCf();
    if (missingCf) { toast.showWarning(`"${missingCf}" is required`); return; }
    setSaving(true);
    try {
      const payload = {
        ROLE_NAME: form.ROLE_NAME.trim(),
        DEPARTMENT_ID: form.DEPARTMENT_ID || null,
        DESCRIPTION: form.DESCRIPTION,
      };
      if (modal === "add") {
        const res = await roleService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Role created");
      } else {
        await roleService.update(selected.ID, payload);
        await saveCfValues(selected.ID);
        toast.showSuccess("Role updated");
      }
      closeModal();
      loadAll();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, closeModal, loadAll, toast, validateCf, saveCfValues]);

  const handleDelete = useCallback((row) => {
    setConfirmModal({
      title: "Delete Role",
      description: `Delete role "${row.NAME}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await roleService.remove(row.ID);
          toast.showSuccess("Role deleted");
          loadAll();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [loadAll, toast]);

  const downloadTemplate = useCallback(async () => {
    try {
      await dlTemplate("Roles", ["Role Name", "Department Name", "Description"], "roles");
    } catch {
      toast.showError("Failed to download template");
    }
  }, []);

  const openBulk = useCallback(() => {
    setBulkFile(null);
    setBulkSheets([]);
    setBulkSheet("");
    setBulkModal(true);
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setBulkFile(f);
    setBulkSheets([]);
    setBulkSheet("");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await roleService.bulkUpload(fd);
      if (res.data.requires_sheet_selection) {
        setBulkSheets(res.data.sheets);
      } else {
        toast.showSuccess(`${res.data.created} created, ${res.data.skipped} skipped`);
        setBulkModal(false);
        loadAll();
      }
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Parse failed");
    }
  }, [loadAll, toast]);

  const handleSheetSelect = useCallback(async () => {
    if (!bulkFile || !bulkSheet) return;
    setBulkUploading(true);
    const fd = new FormData();
    fd.append("file", bulkFile);
    try {
      const res = await roleService.bulkUpload(fd, bulkSheet);
      toast.showSuccess(`${res.data.created} created, ${res.data.skipped} skipped`);
      setBulkModal(false);
      loadAll();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [bulkFile, bulkSheet, loadAll, toast]);

  const handleExport = useCallback(() => {
    const data = filtered.map((r, i) => {
      const row = {
        "S.No": i + 1,
        "Role Name": r.NAME,
        Department: deptMap[r.DEPARTMENT_ID] || "",
        Description: r.DESCRIPTION || "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(r.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "org_roles");
  }, [filtered, deptMap, cfFields, cfValuesMap]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  const handleDeptFilter = useCallback((v) => {
    setFilterDept(v);
    setPage(1);
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={RoleIcon}
        iconAlt="Roles"
        title="Role Management"
        subtitle="Define job roles and link them to departments"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={downloadTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={filtered.length === 0} />
            <PMButton variant="primary" onClick={openAdd}>Add Role</PMButton>
          </>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by role name…"
          />
          <div className={styles.deptFilter}>
            <PMSelect
              options={departments}
              value={filterDept ?? ""}
              onChange={(v) => handleDeptFilter(v || null)}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="All Departments"
            />
          </div>
          <span className={styles.count}>{filtered.length} role{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Role Name</th>
                <th>Department</th>
                <th>Description</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5 + cfFields.length}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={5 + cfFields.length}>
                    <EmptyState
                      icon={RoleIcon}
                      iconAlt="Roles"
                      title={search || filterDept ? "No roles match your filters" : "No roles yet"}
                      description={!search && !filterDept ? "Click '+ Add Role' to get started." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.NAME}</td>
                    <td>
                      {r.DEPARTMENT_ID
                        ? <span className={styles.deptBadge}>{deptMap[r.DEPARTMENT_ID] || r.DEPARTMENT_ID}</span>
                        : <span className={styles.muted}>—</span>}
                    </td>
                    <td className={styles.descCell}>{r.DESCRIPTION || <span className={styles.muted}>—</span>}</td>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(r.ID)]?.[f.ID];
                      return <td key={f.ID} className={styles.descCell}>{val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}</td>;
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
        title={modal === "add" ? "Add Role" : "Edit Role"}
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Role" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Role Name <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.ROLE_NAME}
              onChange={(e) => handleFormChange("ROLE_NAME", e.target.value)}
              placeholder="e.g. PLC Engineer"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Department</label>
            <PMSelect
              options={departments}
              value={form.DEPARTMENT_ID}
              onChange={(val) => handleFormChange("DEPARTMENT_ID", val)}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="— None —"
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

      {/* Bulk Upload Modal */}
      <PMModal
        open={bulkModal}
        onClose={() => setBulkModal(false)}
        title="Bulk Upload Roles"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with columns: <strong>ROLE_NAME</strong>, <strong>DEPARTMENT_NAME</strong>, <strong>DESCRIPTION</strong>.
        </p>
        <div className={styles.dropzone} onClick={() => fileRef.current.click()}>
          <span className={styles.dropIcon}>📂</span>
          <span>{bulkFile ? bulkFile.name : "Click to browse or drop Excel (.xlsx)"}</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        {bulkSheets.length > 0 && (
          <div className={styles.sheetPicker}>
            <label className={styles.formLabel}>Select Sheet</label>
            <PMSelect
              options={bulkSheets}
              value={bulkSheet}
              onChange={setBulkSheet}
              allowClear
              clearLabel="— choose sheet —"
            />
            <PMButton
              variant="primary"
              onClick={handleSheetSelect}
              disabled={!bulkSheet || bulkUploading}
              style={{ marginTop: 10 }}
            >
              {bulkUploading ? "Uploading…" : "Import Sheet"}
            </PMButton>
          </div>
        )}
      </PMModal>

      {/* Custom Fields Modal */}
      <CustomFieldsModal
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        tableName="role"
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
