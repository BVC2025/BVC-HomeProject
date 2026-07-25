import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal, PMSelect,
} from "../components/pm";
import { projectPricingService } from "../services/projectPricingService";
import { projectService } from "../services/projectService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import PricingIcon from "../assets/Icons/bomIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./ProjectPricingPage.module.css";

const EMPTY_FORM = {
  PROJECT_ID: "",
  CURRENCY: "INR",
  ORIGINAL_PRICE: "",
  MINIMUM_NEGOTIATION_PRICE: "",
  NEGOTIATION_PERCENT: "",
  PACKING_CHARGE: "0",
  TRANSPORTATION_CHARGE: "0",
  INSTALLATION_CHARGE: "0",
  SERVICE_CHARGE: "0",
  ADDITIONAL_CHARGES: "0",
  TAX_AMOUNT: "0",
  DISCOUNT_AMOUNT: "0",
  REMARKS: "",
  IS_ACTIVE: true,
};

const num = (v) => {
  const n = Number(v);
  return v === "" || v == null || Number.isNaN(n) ? 0 : n;
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const fmtMoney = (v) =>
  v == null ? "" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProjectPricingPage() {
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterProjectId, setFilterProjectId] = useState("");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cfOpen, setCfOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  // Bulk upload
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();

  const toast = useToast();
  const fetchedRef = useRef(false);
  const { fields: cfFields, cfValues, handleCfChange, loadValues: loadCfValues, resetValues: resetCfValues, validateCf, saveCfValues, refreshFields } = useCustomFields("project_pricing");
  const cfValuesMap = useTableCfValues("project_pricing", items);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [pricingRes, projectsRes] = await Promise.all([
        projectPricingService.getAll(),
        projectService.getAll(),
      ]);
      setItems(pricingRes.data || []);
      setProjects(projectsRes.data || []);
    } catch {
      toast.showError("Failed to load project pricing");
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
    let data = items;
    if (filterProjectId) {
      data = data.filter((p) => p.PROJECT_ID === filterProjectId);
    }
    if (activeFilter) {
      const want = activeFilter === "active";
      data = data.filter((p) => !!p.IS_ACTIVE === want);
    }
    if (filterFrom || filterTo) {
      const from = filterFrom ? new Date(filterFrom) : null;
      const to = filterTo ? new Date(filterTo) : null;
      data = data.filter((p) => {
        if (!p.CREATED_AT) return false;
        const d = new Date(p.CREATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return data;
  }, [items, filterProjectId, activeFilter, filterFrom, filterTo]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: items.length, label: "Total Pricing Records" },
    { value: items.filter((p) => p.IS_ACTIVE).length, label: "Active" },
    { value: filtered.length, label: "Showing" },
  ], [items, filtered.length]);

  // Projects that don't already have a pricing row — only these are offered
  // when adding new pricing, since PROJECT_ID is unique (1:1).
  const availableProjects = useMemo(() => {
    const priced = new Set(items.map((p) => p.PROJECT_ID));
    return projects.filter((p) => !priced.has(p.ID));
  }, [items, projects]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setModal("add");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback((row) => {
    setForm({
      PROJECT_ID: row.PROJECT_ID,
      CURRENCY: row.CURRENCY || "INR",
      ORIGINAL_PRICE: row.ORIGINAL_PRICE ?? "",
      MINIMUM_NEGOTIATION_PRICE: row.MINIMUM_NEGOTIATION_PRICE ?? "",
      NEGOTIATION_PERCENT: row.NEGOTIATION_PERCENT ?? "",
      PACKING_CHARGE: row.PACKING_CHARGE ?? 0,
      TRANSPORTATION_CHARGE: row.TRANSPORTATION_CHARGE ?? 0,
      INSTALLATION_CHARGE: row.INSTALLATION_CHARGE ?? 0,
      SERVICE_CHARGE: row.SERVICE_CHARGE ?? 0,
      ADDITIONAL_CHARGES: row.ADDITIONAL_CHARGES ?? 0,
      TAX_AMOUNT: row.TAX_AMOUNT ?? 0,
      DISCOUNT_AMOUNT: row.DISCOUNT_AMOUNT ?? 0,
      REMARKS: row.REMARKS || "",
      IS_ACTIVE: !!row.IS_ACTIVE,
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

  const finalPricePreview = useMemo(() => (
    num(form.ORIGINAL_PRICE) + num(form.PACKING_CHARGE) + num(form.TRANSPORTATION_CHARGE)
    + num(form.INSTALLATION_CHARGE) + num(form.SERVICE_CHARGE) + num(form.ADDITIONAL_CHARGES)
    + num(form.TAX_AMOUNT) - num(form.DISCOUNT_AMOUNT)
  ), [form]);

  const handleSave = useCallback(async () => {
    if (!form.PROJECT_ID) {
      toast.showWarning("Project is required");
      return;
    }
    if (form.ORIGINAL_PRICE === "" || num(form.ORIGINAL_PRICE) < 0) {
      toast.showWarning("Original Price is required");
      return;
    }
    const minNeg = form.MINIMUM_NEGOTIATION_PRICE === "" ? null : num(form.MINIMUM_NEGOTIATION_PRICE);
    if (minNeg != null && minNeg > num(form.ORIGINAL_PRICE)) {
      toast.showWarning("Minimum Negotiation Price cannot exceed Original Price");
      return;
    }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }

    const payload = {
      PROJECT_ID: form.PROJECT_ID,
      CURRENCY: form.CURRENCY || "INR",
      ORIGINAL_PRICE: num(form.ORIGINAL_PRICE),
      MINIMUM_NEGOTIATION_PRICE: minNeg,
      NEGOTIATION_PERCENT: form.NEGOTIATION_PERCENT === "" ? null : num(form.NEGOTIATION_PERCENT),
      PACKING_CHARGE: num(form.PACKING_CHARGE),
      TRANSPORTATION_CHARGE: num(form.TRANSPORTATION_CHARGE),
      INSTALLATION_CHARGE: num(form.INSTALLATION_CHARGE),
      SERVICE_CHARGE: num(form.SERVICE_CHARGE),
      ADDITIONAL_CHARGES: num(form.ADDITIONAL_CHARGES),
      TAX_AMOUNT: num(form.TAX_AMOUNT),
      DISCOUNT_AMOUNT: num(form.DISCOUNT_AMOUNT),
      REMARKS: form.REMARKS || null,
      IS_ACTIVE: form.IS_ACTIVE,
    };

    setSaving(true);
    try {
      if (modal === "add") {
        const res = await projectPricingService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Pricing created");
      } else {
        await projectPricingService.update(selected.ID, payload);
        await saveCfValues(selected.ID);
        toast.showSuccess("Pricing updated");
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
      title: "Delete Pricing",
      description: `Delete pricing for "${row.PROJECT_NAME}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await projectPricingService.remove(row.ID);
          toast.showSuccess("Pricing deleted");
          load();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [load, toast]);

  const handleExport = useCallback(() => {
    const data = filtered.map((p, i) => {
      const row = {
        "S.No": i + 1,
        "Project Name": p.PROJECT_NAME,
        Currency: p.CURRENCY,
        "Original Price": p.ORIGINAL_PRICE,
        "Minimum Negotiation Price": p.MINIMUM_NEGOTIATION_PRICE ?? "",
        "Negotiation Percentage": p.NEGOTIATION_PERCENT ?? "",
        "Packing Charge": p.PACKING_CHARGE,
        "Transportation Charge": p.TRANSPORTATION_CHARGE,
        "Installation Charge": p.INSTALLATION_CHARGE,
        "Service Charge": p.SERVICE_CHARGE,
        "Additional Charges": p.ADDITIONAL_CHARGES,
        "Tax Amount": p.TAX_AMOUNT,
        "Discount Amount": p.DISCOUNT_AMOUNT,
        "Final Price": p.FINAL_PRICE,
        Remarks: p.REMARKS || "",
        Active: p.IS_ACTIVE ? "Yes" : "No",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(p.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "project_pricing");
  }, [filtered, cfFields, cfValuesMap]);

  const handleProjectFilterChange = useCallback((v) => {
    setFilterProjectId(v || "");
    setPage(1);
  }, []);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const headers = [
        "Project Name", "Currency", "Original Price", "Minimum Negotiation Price", "Negotiation Percentage",
        "Packing Charge", "Transportation Charge", "Installation Charge", "Service Charge",
        "Additional Charges", "Tax Amount", "Discount Amount", "Remarks",
        ...cfFields.map((f) => f.FIELD_NAME),
      ];
      await dlTemplate("Pricing", headers, "project_pricing_template");
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
      const res = await projectPricingService.bulkUpload(fd);
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
        icon={PricingIcon}
        iconAlt="Project Pricing"
        title="Project Pricing Management"
        subtitle="Configure standard pricing, charges, and negotiation limits per project"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={handleDownloadTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={filtered.length === 0} />
            <PMButton variant="primary" onClick={openAdd}>Add Pricing</PMButton>
          </>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <div className={styles.catFilter}>
            <PMSelect
              options={projects}
              value={filterProjectId}
              onChange={handleProjectFilterChange}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="All Projects"
              placeholder="Search project…"
            />
          </div>
          <div className={styles.dateFilters}>
            <PMSelect
              options={STATUS_OPTIONS}
              value={activeFilter}
              onChange={(v) => { setActiveFilter(v || ""); setPage(1); }}
              allowClear
              clearLabel="All Status"
              style={{ minWidth: 150 }}
            />
            <label className={styles.dateLabel}>From</label>
            <input type="datetime-local" className={styles.dateInput} value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }} />
            <label className={styles.dateLabel}>To</label>
            <input type="datetime-local" className={styles.dateInput} value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }} />
            {(filterFrom || filterTo) && <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>}
          </div>
          <span className={styles.count}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Project</th>
                <th>Currency</th>
                <th>Original Price</th>
                <th>Min. Negotiation Price</th>
                <th>Final Price</th>
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
                      icon={PricingIcon}
                      iconAlt="Project Pricing"
                      title={filterProjectId ? "No pricing records match this project" : "No pricing records yet"}
                      description={!filterProjectId ? "Click '+ Add Pricing' to configure a project's price." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((p, i) => (
                  <tr key={p.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{p.PROJECT_NAME}</td>
                    <td>{p.CURRENCY}</td>
                    <td>{fmtMoney(p.ORIGINAL_PRICE)}</td>
                    <td>{p.MINIMUM_NEGOTIATION_PRICE == null ? <span className={styles.muted}>—</span> : fmtMoney(p.MINIMUM_NEGOTIATION_PRICE)}</td>
                    <td className={styles.nameCell}>{fmtMoney(p.FINAL_PRICE)}</td>
                    <td>
                      <span className={p.IS_ACTIVE ? styles.badgeActive : styles.badgeInactive}>
                        {p.IS_ACTIVE ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(p.ID)]?.[f.ID];
                      return <td key={f.ID} className={styles.descCell}>{val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}</td>;
                    })}
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} onClick={() => openEdit(p)} title="Edit">
                          <img src={EditIcon} alt="Edit" />
                        </button>
                        <button className={styles.iconBtnDanger} onClick={() => handleDelete(p)} title="Delete">
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
        title={modal === "add" ? "Add Pricing" : "Edit Pricing"}
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Pricing" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Project <span className={styles.req}>*</span></label>
            <PMSelect
              options={modal === "edit" ? projects : availableProjects}
              value={form.PROJECT_ID}
              onChange={(v) => handleFormChange("PROJECT_ID", v)}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="— Select project —"
              disabled={modal === "edit"}
              showSearch={false}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Currency</label>
              <input
                className={styles.input}
                value={form.CURRENCY}
                onChange={(e) => handleFormChange("CURRENCY", e.target.value.toUpperCase())}
                placeholder="INR"
                maxLength={5}
              />
            </div>
            <div className={styles.formGroup}>
              <label>Original Price <span className={styles.req}>*</span></label>
              <input
                type="number"
                className={styles.input}
                value={form.ORIGINAL_PRICE}
                onChange={(e) => handleFormChange("ORIGINAL_PRICE", e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Minimum Negotiation Price (Last Price)</label>
              <input
                type="number"
                className={styles.input}
                value={form.MINIMUM_NEGOTIATION_PRICE}
                onChange={(e) => handleFormChange("MINIMUM_NEGOTIATION_PRICE", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className={styles.formGroup}>
              <label>Negotiation Percentage (per round)</label>
              <input
                type="number"
                className={styles.input}
                value={form.NEGOTIATION_PERCENT}
                onChange={(e) => handleFormChange("NEGOTIATION_PERCENT", e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label>Packing Charge</label>
              <input type="number" className={styles.input} value={form.PACKING_CHARGE} onChange={(e) => handleFormChange("PACKING_CHARGE", e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Transportation Charge</label>
              <input type="number" className={styles.input} value={form.TRANSPORTATION_CHARGE} onChange={(e) => handleFormChange("TRANSPORTATION_CHARGE", e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Installation Charge</label>
              <input type="number" className={styles.input} value={form.INSTALLATION_CHARGE} onChange={(e) => handleFormChange("INSTALLATION_CHARGE", e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Service Charge</label>
              <input type="number" className={styles.input} value={form.SERVICE_CHARGE} onChange={(e) => handleFormChange("SERVICE_CHARGE", e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Additional Charges</label>
              <input type="number" className={styles.input} value={form.ADDITIONAL_CHARGES} onChange={(e) => handleFormChange("ADDITIONAL_CHARGES", e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Tax Amount</label>
              <input type="number" className={styles.input} value={form.TAX_AMOUNT} onChange={(e) => handleFormChange("TAX_AMOUNT", e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Discount Amount</label>
              <input type="number" className={styles.input} value={form.DISCOUNT_AMOUNT} onChange={(e) => handleFormChange("DISCOUNT_AMOUNT", e.target.value)} />
            </div>
          </div>

          <div className={styles.finalPriceBox}>
            <span>Final Price (auto-calculated)</span>
            <strong>{form.CURRENCY || "INR"} {fmtMoney(finalPricePreview)}</strong>
          </div>

          <div className={styles.formGroup}>
            <label>Remarks</label>
            <textarea
              className={styles.textarea}
              value={form.REMARKS}
              onChange={(e) => handleFormChange("REMARKS", e.target.value)}
              placeholder="Optional notes"
              rows={3}
            />
          </div>

          {modal === "edit" && (
            <div className={styles.formGroup}>
              <label>Status</label>
              <PMSelect
                options={STATUS_OPTIONS}
                value={form.IS_ACTIVE ? "active" : "inactive"}
                onChange={(v) => handleFormChange("IS_ACTIVE", v === "active")}
              />
            </div>
          )}
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
        title="Bulk Upload Pricing"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Pricing"</strong> and columns:{" "}
          <strong>Project Name</strong>, <strong>Currency</strong>, <strong>Original Price</strong>,{" "}
          <strong>Minimum Negotiation Price</strong>, <strong>Negotiation Percentage</strong>, and the charge/tax/discount columns
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Existing records (matched by project) are updated; new ones are inserted.
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

      {/* Custom Fields Modal */}
      <CustomFieldsModal
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        tableName="project_pricing"
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
