import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, SearchBar, EmptyState, Loader,
  PMButton, PMConfirmModal, PMSelect,
} from "../components/pm";
import { designationService } from "../services/designationService";
import { departmentService } from "../services/departmentService";
import { useToast } from "../hooks/useToast";
import RoleIcon from "../assets/Icons/roleIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import styles from "./DepartmentManagement.module.css";

const EMPTY_FORM = { TITLE: "", DEPARTMENT_ID: "", BASE_SALARY: "", DESCRIPTION: "", STATUS: "ACTIVE" };

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

export default function DesignationManagement() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [confirmModal, setConfirmModal] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [desRes, deptRes] = await Promise.all([
        designationService.getAll(),
        departmentService.getAll(),
      ]);
      setRows(desRes.data || []);
      setDepartments(deptRes.data || []);
    } catch {
      toast.showError("Failed to load designations");
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

  const deptOptions = useMemo(
    () => departments.map((d) => ({ value: String(d.ID), label: d.NAME })),
    [departments]
  );

  const filtered = useMemo(() => {
    let data = rows;
    if (deptFilter) data = data.filter((r) => String(r.DEPARTMENT_ID) === String(deptFilter));
    if (search.trim()) {
      const t = search.toLowerCase();
      data = data.filter((r) => r.TITLE?.toLowerCase().includes(t));
    }
    return data;
  }, [rows, search, deptFilter]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Designations" },
    { value: filtered.length, label: "Showing" },
  ], [rows.length, filtered.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setModal("add");
  }, []);

  const openEdit = useCallback((row) => {
    setForm({
      TITLE: row.TITLE || "",
      DEPARTMENT_ID: String(row.DEPARTMENT_ID || ""),
      BASE_SALARY: row.BASE_SALARY ?? "",
      DESCRIPTION: row.DESCRIPTION || "",
      STATUS: row.STATUS || "ACTIVE",
    });
    setSelected(row);
    setModal("edit");
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelected(null);
  }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.TITLE.trim() || !form.DEPARTMENT_ID) {
      toast.showWarning("Designation Name and Department are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        DEPARTMENT_ID: Number(form.DEPARTMENT_ID),
        BASE_SALARY: form.BASE_SALARY === "" ? 0 : Number(form.BASE_SALARY),
      };
      if (modal === "add") {
        await designationService.create(payload);
        toast.showSuccess("Designation created");
      } else {
        await designationService.update(selected.ID, payload);
        toast.showSuccess("Designation updated");
      }
      closeModal();
      load();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, closeModal, load, toast]);

  const handleDelete = useCallback((row) => {
    setConfirmModal({
      title: "Delete Designation",
      description: `Delete designation "${row.TITLE}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await designationService.remove(row.ID);
          toast.showSuccess("Designation deleted");
          load();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [load, toast]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={RoleIcon}
        iconAlt="Designations"
        title="Designation Management"
        subtitle="Job titles within each department — separate from RBAC access roles"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <PMButton variant="primary" onClick={openAdd}>Add Designation</PMButton>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by title…"
          />
          <div style={{ minWidth: 220 }}>
            <PMSelect
              options={deptOptions}
              value={deptFilter}
              onChange={(v) => { setDeptFilter(v); setPage(1); }}
              placeholder="All departments"
              allowClear
              clearLabel="All departments"
            />
          </div>
          <span className={styles.count}>{filtered.length} designation{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Department</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={RoleIcon}
                      iconAlt="Designations"
                      title={search ? "No designations match your search" : "No designations yet"}
                      description={!search ? "Click '+ Add Designation' to get started." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.TITLE}</td>
                    <td className={styles.descCell}>{r.DEPARTMENT_NAME || <span className={styles.muted}>—</span>}</td>
                    <td><span className={styles.codeBadge}>{r.STATUS || "ACTIVE"}</span></td>
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

      <PMModal
        open={!!modal}
        onClose={closeModal}
        title={modal === "add" ? "Add Designation" : "Edit Designation"}
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Designation" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Designation Name <span className={styles.req}>*</span></label>
            <input className={styles.input} value={form.TITLE} onChange={(e) => handleFormChange("TITLE", e.target.value)} placeholder="e.g. Sales Executive" />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Department <span className={styles.req}>*</span></label>
            <PMSelect
              options={deptOptions}
              value={form.DEPARTMENT_ID}
              onChange={(v) => handleFormChange("DEPARTMENT_ID", v)}
              placeholder="Select department"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Base Salary</label>
            <input className={styles.input} type="number" value={form.BASE_SALARY} onChange={(e) => handleFormChange("BASE_SALARY", e.target.value)} placeholder="0" />
          </div>
          {modal === "edit" && (
            <div className={styles.formGroup}>
              <label>Status</label>
              <PMSelect options={STATUS_OPTIONS} value={form.STATUS} onChange={(v) => handleFormChange("STATUS", v)} />
            </div>
          )}
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Description</label>
            <textarea className={styles.textarea} value={form.DESCRIPTION} onChange={(e) => handleFormChange("DESCRIPTION", e.target.value)} rows={3} />
          </div>
        </div>
      </PMModal>

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
