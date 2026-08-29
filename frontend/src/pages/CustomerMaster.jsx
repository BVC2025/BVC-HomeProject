import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { customerMasterService } from "../services/customerMasterService";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import { formatDateTime } from "../utils/formatDateTime";
import { validateForm, clearFieldError, CUSTOMER_MASTER_RULES } from "../utils/formValidation";
import CustomerIcon from "../assets/Icons/employee.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./CustomerMaster.module.css";

const CF_TABLE = "customer_master";

const EMPTY_FORM = {
  NAME: "", COMPANY_NAME: "", PHONE_NUMBER: "", EMAIL: "", ADDRESS: "", GST_NUMBER: "",
  CITY: "", STATE: "", PINCODE: "", COUNTRY_ISO: "",
};

export default function CustomerMaster() {
  const { hasPermission } = useAuth();
  const canExport = hasPermission("customer.master.export");

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null); // null | "add" | "edit"
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cfOpen, setCfOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Bulk upload
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef();

  const toast = useToast();
  const fetchedRef = useRef(false);
  const {
    fields: cfFields, cfValues, handleCfChange,
    loadValues: loadCfValues, resetValues: resetCfValues,
    validateCf, saveCfValues, refreshFields,
  } = useCustomFields(CF_TABLE);
  const cfValuesMap = useTableCfValues(CF_TABLE, customers);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await customerMasterService.getAll();
      setCustomers(res.data || []);
    } catch {
      toast.showError("Failed to load customers");
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
    let data = customers;
    if (search.trim()) {
      const t = search.toLowerCase();
      data = data.filter(
        (c) =>
          c.NAME?.toLowerCase().includes(t) ||
          (c.COMPANY_NAME || "").toLowerCase().includes(t) ||
          (c.PHONE_NUMBER || "").toLowerCase().includes(t) ||
          (c.EMAIL || "").toLowerCase().includes(t) ||
          (c.GST_NUMBER || "").toLowerCase().includes(t)
      );
    }
    if (filterFrom || filterTo) {
      const from = filterFrom ? new Date(filterFrom) : null;
      const to = filterTo ? new Date(filterTo) : null;
      data = data.filter((c) => {
        if (!c.CREATED_AT) return false;
        const d = new Date(c.CREATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return data;
  }, [customers, search, filterFrom, filterTo]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: customers.length, label: "Total Customers" },
    { value: customers.filter((c) => c.GST_NUMBER).length, label: "With GST" },
    { value: filtered.length, label: "Showing" },
  ], [customers, filtered.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setErrors({});
    setModal("add");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback((c) => {
    setForm({
      NAME: c.NAME || "",
      COMPANY_NAME: c.COMPANY_NAME || "",
      PHONE_NUMBER: c.PHONE_NUMBER || "",
      EMAIL: c.EMAIL || "",
      ADDRESS: c.ADDRESS || "",
      GST_NUMBER: c.GST_NUMBER || "",
      CITY: c.CITY || "",
      STATE: c.STATE || "",
      PINCODE: c.PINCODE || "",
      COUNTRY_ISO: c.COUNTRY_ISO || "",
    });
    setSelected(c);
    setErrors({});
    setModal("edit");
    loadCfValues(c.ID);
  }, [loadCfValues]);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelected(null);
    setErrors({});
  }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    clearFieldError(setErrors, field);
  }, []);

  const handleSave = useCallback(async () => {
    const { isValid, errors: formErrors } = validateForm(CUSTOMER_MASTER_RULES, form);
    if (!isValid) {
      setErrors(formErrors);
      toast.showWarning("Please fix the highlighted fields");
      return;
    }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }

    setSaving(true);
    try {
      const payload = {
        NAME: form.NAME.trim(),
        COMPANY_NAME: form.COMPANY_NAME.trim() || null,
        PHONE_NUMBER: form.PHONE_NUMBER.trim(),
        EMAIL: form.EMAIL.trim(),
        ADDRESS: form.ADDRESS.trim(),
        GST_NUMBER: form.GST_NUMBER.trim() || null,
        CITY: form.CITY.trim() || null,
        STATE: form.STATE.trim() || null,
        PINCODE: form.PINCODE.trim() || null,
        COUNTRY_ISO: form.COUNTRY_ISO.trim() || null,
      };
      if (modal === "add") {
        const res = await customerMasterService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Customer created");
      } else {
        await customerMasterService.update(selected.ID, payload);
        await saveCfValues(selected.ID);
        toast.showSuccess("Customer updated");
      }
      closeModal();
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, closeModal, load, toast, validateCf, saveCfValues]);

  const handleDelete = useCallback((c) => {
    setConfirmModal({
      title: "Delete Customer",
      description: `Delete "${c.COMPANY_NAME || c.NAME}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await customerMasterService.remove(c.ID);
          toast.showSuccess("Customer deleted");
          load(true);
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
        "Name": c.NAME,
        "Company Name": c.COMPANY_NAME || "",
        "Phone Number": c.PHONE_NUMBER || "",
        "Email": c.EMAIL || "",
        "Address": c.ADDRESS || "",
        "GST Number": c.GST_NUMBER || "",
        "City": c.CITY || "",
        "State": c.STATE || "",
        "Pincode": c.PINCODE || "",
        "Country ISO": c.COUNTRY_ISO || "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(c.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    setExporting(true);
    try {
      exportToExcel(data, "customer_master");
    } finally {
      setExporting(false);
    }
  }, [filtered, cfFields, cfValuesMap]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const headers = ["Name", "Company Name", "Phone Number", "Email", "Address", "GST Number", "City", "State", "Pincode", "Country ISO", ...cfFields.map((f) => f.FIELD_NAME)];
      await dlTemplate("Customers", headers, "customer_master_template");
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
      const res = await customerMasterService.bulkUpload(fd);
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
        icon={CustomerIcon}
        iconAlt="Customer Master"
        title="Customer Master"
        subtitle="Core customer records — configure extra fields via Custom Fields"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={handleDownloadTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            {canExport && (
              <ExportButton onClick={handleExport} disabled={exporting || filtered.length === 0} />
            )}
            <PMButton variant="primary" onClick={openAdd}>Add Customer</PMButton>
          </>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name, company, phone, email, GST…"
          />
          <div className={styles.dateFilters}>
            <label className={styles.dateLabel}>From</label>
            <input type="datetime-local" className={styles.dateInput} value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }} />
            <label className={styles.dateLabel}>To</label>
            <input type="datetime-local" className={styles.dateInput} value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }} />
            {(filterFrom || filterTo) && <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>}
          </div>
          <span className={styles.count}>{filtered.length} customer{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Company</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Address</th>
                <th>City</th>
                <th>State</th>
                <th>Pincode</th>
                <th>Country</th>
                <th>GST</th>
                <th>Created Date</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13 + cfFields.length}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={13 + cfFields.length}>
                    <EmptyState
                      icon={CustomerIcon}
                      iconAlt="Customer Master"
                      title={search ? "No customers match your search" : "No customers yet"}
                      description={!search ? "Click '+ Add Customer' to get started." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((c, i) => (
                  <tr key={c.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{c.NAME}</td>
                    <td className={styles.descCell}>{c.COMPANY_NAME || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.PHONE_NUMBER || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.EMAIL || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.ADDRESS || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.CITY || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.STATE || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.PINCODE || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.COUNTRY_ISO || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.descCell}>{c.GST_NUMBER || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.dateCell}>{formatDateTime(c.CREATED_AT)}</td>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(c.ID)]?.[f.ID];
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
        title={modal === "add" ? "Add Customer" : "Edit Customer"}
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Customer" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Name <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input}${errors.NAME ? " " + styles.inputError : ""}`}
              value={form.NAME}
              onChange={(e) => handleFormChange("NAME", e.target.value)}
              placeholder="e.g. Suresh Iyer"
            />
            {errors.NAME && <span className={styles.fieldError}>{errors.NAME}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Company Name</label>
            <input
              className={styles.input}
              value={form.COMPANY_NAME}
              onChange={(e) => handleFormChange("COMPANY_NAME", e.target.value)}
              placeholder="Optional — formal/legal entity name"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Phone Number <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input}${errors.PHONE_NUMBER ? " " + styles.inputError : ""}`}
              value={form.PHONE_NUMBER}
              onChange={(e) => handleFormChange("PHONE_NUMBER", e.target.value)}
            />
            {errors.PHONE_NUMBER && <span className={styles.fieldError}>{errors.PHONE_NUMBER}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Email <span className={styles.req}>*</span></label>
            <input
              type="email"
              className={`${styles.input}${errors.EMAIL ? " " + styles.inputError : ""}`}
              value={form.EMAIL}
              onChange={(e) => handleFormChange("EMAIL", e.target.value)}
            />
            {errors.EMAIL && <span className={styles.fieldError}>{errors.EMAIL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Address <span className={styles.req}>*</span></label>
            <textarea
              className={`${styles.textarea}${errors.ADDRESS ? " " + styles.inputError : ""}`}
              value={form.ADDRESS}
              onChange={(e) => handleFormChange("ADDRESS", e.target.value)}
              rows={3}
            />
            {errors.ADDRESS && <span className={styles.fieldError}>{errors.ADDRESS}</span>}
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>City</label>
              <input
                className={styles.input}
                value={form.CITY}
                onChange={(e) => handleFormChange("CITY", e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label>State</label>
              <input
                className={styles.input}
                value={form.STATE}
                onChange={(e) => handleFormChange("STATE", e.target.value)}
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Pincode</label>
              <input
                className={`${styles.input}${errors.PINCODE ? " " + styles.inputError : ""}`}
                value={form.PINCODE}
                onChange={(e) => handleFormChange("PINCODE", e.target.value)}
              />
              {errors.PINCODE && <span className={styles.fieldError}>{errors.PINCODE}</span>}
            </div>
            <div className={styles.formGroup}>
              <label>Country ISO</label>
              <input
                className={styles.input}
                value={form.COUNTRY_ISO}
                onChange={(e) => handleFormChange("COUNTRY_ISO", e.target.value)}
                placeholder="e.g. IN"
              />
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>GST Number</label>
            <input
              className={`${styles.input}${errors.GST_NUMBER ? " " + styles.inputError : ""}`}
              value={form.GST_NUMBER}
              onChange={(e) => handleFormChange("GST_NUMBER", e.target.value.toUpperCase())}
              placeholder="e.g. 22AAAAA0000A1Z5"
            />
            {errors.GST_NUMBER && <span className={styles.fieldError}>{errors.GST_NUMBER}</span>}
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
        title="Bulk Upload Customers"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Customers"</strong> and columns:{" "}
          <strong>Name</strong>, <strong>Phone Number</strong>, <strong>Email</strong>, <strong>Address</strong>
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Every valid row becomes a new customer — there's no matching/updating by name.
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
                <span className={styles.statValue}>{uploadResult.errors?.length ?? 0}</span>
                <span className={styles.statLabel}>Errors</span>
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

      {/* Custom Fields Modal */}
      <CustomFieldsModal
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        tableName={CF_TABLE}
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
