import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, SearchBar, EmptyState, Loader,
  PMButton, PMConfirmModal, PMSelect,
} from "../components/pm";
import { branchService } from "../services/branchService";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import DepartmentIcon from "../assets/Icons/departmentIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import styles from "./DepartmentManagement.module.css";

const EMPTY_FORM = {
  NAME: "", BRANCH_CODE: "", ADDRESS: "", CITY: "", STATE: "",
  COUNTRY: "India", PINCODE: "", PHONE: "", EMAIL: "", STATUS: "ACTIVE",
};

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

export default function BranchManagement() {
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
  const [confirmModal, setConfirmModal] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await branchService.getAll();
      setRows(res.data || []);
    } catch {
      toast.showError("Failed to load branches");
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
        (r.BRANCH_CODE || "").toLowerCase().includes(t) ||
        (r.CITY || "").toLowerCase().includes(t)
    );
  }, [rows, search]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Branches" },
    { value: rows.filter((r) => r.STATUS === "ACTIVE").length, label: "Active" },
    { value: filtered.length, label: "Showing" },
  ], [rows, filtered.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setModal("add");
  }, []);

  const openEdit = useCallback((row) => {
    setForm({
      NAME: row.NAME || "",
      BRANCH_CODE: row.BRANCH_CODE || "",
      ADDRESS: row.ADDRESS || "",
      CITY: row.CITY || "",
      STATE: row.STATE || "",
      COUNTRY: row.COUNTRY || "India",
      PINCODE: row.PINCODE || "",
      PHONE: row.PHONE || "",
      EMAIL: row.EMAIL || "",
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
    if (!form.NAME.trim() || !form.BRANCH_CODE.trim()) {
      toast.showWarning("Branch Name and Branch Code are required");
      return;
    }
    setSaving(true);
    try {
      if (modal === "add") {
        await branchService.create(form);
        toast.showSuccess("Branch created");
      } else {
        await branchService.update(selected.ID, form);
        toast.showSuccess("Branch updated");
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
      title: "Delete Branch",
      description: `Delete branch "${row.NAME}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await branchService.remove(row.ID);
          toast.showSuccess("Branch deleted");
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
        icon={DepartmentIcon}
        iconAlt="Branches"
        title="Branches / Locations"
        subtitle="Manage office locations employees and users can be assigned to"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <PMButton variant="primary" onClick={openAdd}>Add Branch</PMButton>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name, code or city…"
          />
          <span className={styles.count}>{filtered.length} branch{filtered.length !== 1 ? "es" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Code</th>
                <th>City</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={DepartmentIcon}
                      iconAlt="Branches"
                      title={search ? "No branches match your search" : "No branches yet"}
                      description={!search ? "Click '+ Add Branch' to get started." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.NAME}</td>
                    <td><span className={styles.codeBadge}>{r.BRANCH_CODE}</span></td>
                    <td className={styles.descCell}>{r.CITY || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{r.PHONE || <span className={styles.muted}>—</span>}</td>
                    <td>
                      <span className={styles.codeBadge}>{r.STATUS || "ACTIVE"}</span>
                    </td>
                    <td className={styles.dateCell}>{formatDateTime(r.CREATED_AT)}</td>
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
        title={modal === "add" ? "Add Branch" : "Edit Branch"}
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Branch" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Branch Name <span className={styles.req}>*</span></label>
            <input className={styles.input} value={form.NAME} onChange={(e) => handleFormChange("NAME", e.target.value)} placeholder="e.g. BVC Coimbatore" />
          </div>
          <div className={styles.formGroup}>
            <label>Branch Code <span className={styles.req}>*</span></label>
            <input className={styles.input} value={form.BRANCH_CODE} onChange={(e) => handleFormChange("BRANCH_CODE", e.target.value.toUpperCase())} placeholder="e.g. CBE" maxLength={20} />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Address</label>
            <textarea className={styles.textarea} value={form.ADDRESS} onChange={(e) => handleFormChange("ADDRESS", e.target.value)} rows={2} />
          </div>
          <div className={styles.formGroup}>
            <label>City</label>
            <input className={styles.input} value={form.CITY} onChange={(e) => handleFormChange("CITY", e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label>State</label>
            <input className={styles.input} value={form.STATE} onChange={(e) => handleFormChange("STATE", e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label>Country</label>
            <input className={styles.input} value={form.COUNTRY} onChange={(e) => handleFormChange("COUNTRY", e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label>Pincode</label>
            <input className={styles.input} value={form.PINCODE} onChange={(e) => handleFormChange("PINCODE", e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label>Phone</label>
            <input className={styles.input} value={form.PHONE} onChange={(e) => handleFormChange("PHONE", e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label>Email</label>
            <input className={styles.input} type="email" value={form.EMAIL} onChange={(e) => handleFormChange("EMAIL", e.target.value)} />
          </div>
          {modal === "edit" && (
            <div className={styles.formGroup}>
              <label>Status</label>
              <PMSelect options={STATUS_OPTIONS} value={form.STATUS} onChange={(v) => handleFormChange("STATUS", v)} />
            </div>
          )}
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
