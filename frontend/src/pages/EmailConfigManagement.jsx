import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { emailConfigService } from "../services/emailConfigService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import { formatDateTime } from "../utils/formatDateTime";
import EmailIcon from "../assets/Icons/mailIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./EmailConfigManagement.module.css";

const EMPTY_FORM = {
  SMTP_HOST: "",
  SMTP_PORT: 587,
  SMTP_USERNAME: "",
  SMTP_PASSWORD: "",
  FROM_NAME: "",
  FROM_EMAIL: "",
  BCC_NAME: "",
  BCC_EMAIL: "",
  IS_ACTIVE: false,
};

export default function EmailConfigManagement() {
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
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

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
  } = useCustomFields("email_config");
  const cfValuesMap = useTableCfValues("email_config", rows);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await emailConfigService.getAll();
      setRows(res.data || []);
    } catch {
      toast.showError("Failed to load email configurations");
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
    let data = rows;
    if (search.trim()) {
      const t = search.toLowerCase();
      data = data.filter(
        (r) =>
          (r.SMTP_HOST || "").toLowerCase().includes(t) ||
          (r.FROM_EMAIL || "").toLowerCase().includes(t) ||
          (r.FROM_NAME || "").toLowerCase().includes(t)
      );
    }
    if (filterFrom || filterTo) {
      const from = filterFrom ? new Date(filterFrom) : null;
      const to = filterTo ? new Date(filterTo) : null;
      data = data.filter((r) => {
        if (!r.CREATED_AT) return false;
        const d = new Date(r.CREATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return data;
  }, [rows, search, filterFrom, filterTo]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Configurations" },
    { value: rows.filter((r) => r.IS_ACTIVE).length, label: "Active" },
    { value: filtered.length, label: "Showing" },
  ], [rows, filtered.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setShowPassword(false);
    setModal("add");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback((row) => {
    setForm({
      SMTP_HOST: row.SMTP_HOST || "",
      SMTP_PORT: row.SMTP_PORT || 587,
      SMTP_USERNAME: row.SMTP_USERNAME || "",
      SMTP_PASSWORD: "",
      FROM_NAME: row.FROM_NAME || "",
      FROM_EMAIL: row.FROM_EMAIL || "",
      BCC_NAME: row.BCC_NAME || "",
      BCC_EMAIL: row.BCC_EMAIL || "",
      IS_ACTIVE: row.IS_ACTIVE || false,
    });
    setSelected(row);
    setShowPassword(false);
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
    if (!form.SMTP_HOST.trim()) { toast.showWarning("SMTP Host is required"); return; }
    if (!form.SMTP_USERNAME.trim()) { toast.showWarning("SMTP Username is required"); return; }
    if (modal === "add" && !form.SMTP_PASSWORD.trim()) { toast.showWarning("SMTP Password is required"); return; }
    if (!form.FROM_NAME.trim()) { toast.showWarning("From Name is required"); return; }
    if (!form.FROM_EMAIL.trim()) { toast.showWarning("From Email is required"); return; }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        SMTP_PORT: Number(form.SMTP_PORT) || 587,
        SMTP_PASSWORD: form.SMTP_PASSWORD.trim() || null,
      };
      if (modal === "add") {
        const res = await emailConfigService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Email configuration created");
      } else {
        await emailConfigService.update(selected.ID, payload);
        await saveCfValues(selected.ID);
        toast.showSuccess("Email configuration updated");
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
      title: "Delete Email Configuration",
      description: `Delete configuration for "${row.FROM_EMAIL}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await emailConfigService.remove(row.ID);
          toast.showSuccess("Email configuration deleted");
          load();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [load, toast]);

  const handleToggleActive = useCallback(async (row) => {
    setTogglingId(row.ID);
    try {
      if (row.IS_ACTIVE) {
        await emailConfigService.deactivate(row.ID);
        toast.showSuccess("Configuration deactivated");
      } else {
        await emailConfigService.activate(row.ID);
        toast.showSuccess("Configuration activated");
      }
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to update status");
    } finally {
      setTogglingId(null);
    }
  }, [load, toast]);

  const downloadTemplate = useCallback(async () => {
    try {
      const headers = [
        "SMTP Host", "SMTP Port", "SMTP Username", "SMTP Password",
        "From Name", "From Email", "BCC Name", "BCC Email", "Is Active",
        ...cfFields.map((f) => f.FIELD_NAME),
      ];
      await dlTemplate("Email Configs", headers, "email_config_template");
    } catch {
      toast.showError("Failed to download template");
    }
  }, [cfFields, toast]);

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
      const res = await emailConfigService.bulkUpload(fd);
      setUploadResult(res.data);
      load(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [load, toast]);

  const handleExport = useCallback(() => {
    const data = filtered.map((r, i) => {
      const row = {
        "S.No": i + 1,
        "SMTP Host": r.SMTP_HOST,
        "SMTP Port": r.SMTP_PORT,
        "SMTP Username": r.SMTP_USERNAME,
        "From Name": r.FROM_NAME,
        "From Email": r.FROM_EMAIL,
        "BCC Name": r.BCC_NAME || "",
        "BCC Email": r.BCC_EMAIL || "",
        "Is Active": r.IS_ACTIVE ? "Yes" : "No",
        "Created": r.CREATED_AT ? new Date(r.CREATED_AT).toLocaleDateString() : "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(r.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "email_configurations");
  }, [filtered, cfFields, cfValuesMap]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={EmailIcon}
        iconAlt="Email Configurations"
        title="Email Configuration Management"
        subtitle="Manage vendor SMTP email configurations"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={downloadTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={filtered.length === 0} />
            <PMButton variant="primary" onClick={openAdd}>Add Config</PMButton>
          </>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by host, from email, or name…"
          />
          <div className={styles.dateFilters}>
            <label className={styles.dateLabel}>From</label>
            <input
              type="datetime-local"
              className={styles.dateInput}
              value={filterFrom}
              onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
            />
            <label className={styles.dateLabel}>To</label>
            <input
              type="datetime-local"
              className={styles.dateInput}
              value={filterTo}
              onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
            />
            {(filterFrom || filterTo) && (
              <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>
            )}
          </div>
          <span className={styles.count}>{filtered.length} config{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>SMTP Host</th>
                <th>Port</th>
                <th>From Name</th>
                <th>From Email</th>
                <th>BCC Email</th>
                <th>Status</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8 + cfFields.length}><Loader /></td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8 + cfFields.length}>
                    <EmptyState
                      icon={EmailIcon}
                      iconAlt="Email Configurations"
                      title={search ? "No configurations match your search" : "No email configurations yet"}
                      description={!search ? "Click '+ Add Config' to get started." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.SMTP_HOST}</td>
                    <td><span className={styles.codeBadge}>{r.SMTP_PORT}</span></td>
                    <td>{r.FROM_NAME}</td>
                    <td className={styles.descCell}>{r.FROM_EMAIL}</td>
                    <td className={styles.descCell}>{r.BCC_EMAIL || <span className={styles.muted}>—</span>}</td>
                    <td>
                      {r.IS_ACTIVE
                        ? <span className={styles.activePill}>Active</span>
                        : <span className={styles.inactivePill}>Inactive</span>}
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
                        <button
                          className={r.IS_ACTIVE ? styles.toggleBtnActive : styles.toggleBtn}
                          onClick={() => handleToggleActive(r)}
                          disabled={togglingId === r.ID}
                          title={r.IS_ACTIVE ? "Deactivate" : "Activate"}
                        >
                          {togglingId === r.ID ? "…" : r.IS_ACTIVE ? "Deactivate" : "Activate"}
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
        title={modal === "add" ? "Add Email Configuration" : "Edit Email Configuration"}
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Configuration" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>SMTP Host <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.SMTP_HOST}
              onChange={(e) => handleFormChange("SMTP_HOST", e.target.value)}
              placeholder="e.g. smtp.gmail.com"
            />
          </div>
          <div className={styles.formGroup}>
            <label>SMTP Port <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              type="number"
              value={form.SMTP_PORT}
              onChange={(e) => handleFormChange("SMTP_PORT", e.target.value)}
              placeholder="587"
              min={1}
              max={65535}
            />
          </div>
          <div className={styles.formGroup}>
            <label>SMTP Username <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.SMTP_USERNAME}
              onChange={(e) => handleFormChange("SMTP_USERNAME", e.target.value)}
              placeholder="e.g. user@gmail.com"
              autoComplete="off"
            />
          </div>
          <div className={styles.formGroup}>
            <label>
              SMTP Password {modal === "add" && <span className={styles.req}>*</span>}
              {modal === "edit" && <span className={styles.hint}> (blank = keep existing)</span>}
            </label>
            <div className={styles.passwordWrap}>
              <input
                className={styles.inputPassword}
                type={showPassword ? "text" : "password"}
                value={form.SMTP_PASSWORD}
                onChange={(e) => handleFormChange("SMTP_PASSWORD", e.target.value)}
                placeholder={modal === "edit" ? "●●●●●●●●" : "Enter password"}
                autoComplete="new-password"
              />
              <button
                type="button"
                className={styles.showPasswordBtn}
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>From Name <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.FROM_NAME}
              onChange={(e) => handleFormChange("FROM_NAME", e.target.value)}
              placeholder="e.g. BVC Support"
            />
          </div>
          <div className={styles.formGroup}>
            <label>From Email <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              type="email"
              value={form.FROM_EMAIL}
              onChange={(e) => handleFormChange("FROM_EMAIL", e.target.value)}
              placeholder="e.g. support@bvc.com"
            />
          </div>
          <div className={styles.formGroup}>
            <label>BCC Name</label>
            <input
              className={styles.input}
              value={form.BCC_NAME}
              onChange={(e) => handleFormChange("BCC_NAME", e.target.value)}
              placeholder="Optional BCC name"
            />
          </div>
          <div className={styles.formGroup}>
            <label>BCC Email</label>
            <input
              className={styles.input}
              type="email"
              value={form.BCC_EMAIL}
              onChange={(e) => handleFormChange("BCC_EMAIL", e.target.value)}
              placeholder="Optional BCC email"
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={form.IS_ACTIVE}
                onChange={(e) => handleFormChange("IS_ACTIVE", e.target.checked)}
              />
              Set as active configuration
              <span className={styles.checkboxHint}>(activating this will deactivate all other configurations)</span>
            </label>
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
        title="Bulk Upload Email Configurations"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Email Configs"</strong> and columns:{" "}
          <strong>SMTP Host</strong>, <strong>SMTP Port</strong>, <strong>SMTP Username</strong>,{" "}
          <strong>SMTP Password</strong>, <strong>From Name</strong>, <strong>From Email</strong>
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Existing records (matched by From Email) are updated; new ones are inserted.
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
        tableName="email_config"
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
