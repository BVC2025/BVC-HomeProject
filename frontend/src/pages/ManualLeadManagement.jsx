import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader, PMButton, PMSelect, PMConfirmModal,
  DateTimeRangeFilter, EMPTY_RANGE, toIsoRange,
} from "../components/pm";
import { leadService } from "../services/leadService";
import { LeadDetailModal } from "../components/lead/LeadDetailModal";

import LeadAIAssistantPanel from "../components/lead/LeadAIAssistantPanel";

import { departmentService } from "../services/departmentService";
import { roleService } from "../services/roleService";
import { employeeService } from "../services/employeeService";
import { customFieldService } from "../services/customFieldService";
import { projectService } from "../services/projectService";
import { categoryService } from "../services/categoryService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import { validateForm, clearFieldError, LEAD_RULES } from "../utils/formValidation";
import { formatDateTime } from "../utils/formatDateTime";
import LeadIcon from "../assets/Icons/departmentIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import ViewIcon from "../assets/Icons/detailsIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./ManualLeadManagement.module.css";

const CF_TABLE = "lead";

const LEAD_STATUS_OPTIONS = [
  { value: "NEW", label: "New" },
  { value: "VIEWED", label: "Viewed" },
  { value: "CONVERTED", label: "Converted" },
  { value: "IGNORED", label: "Ignored" },
];

const LEAD_SOURCE_OPTIONS = [
  { value: "INDIAMART", label: "IndiaMART" },
  { value: "WEBSITE", label: "Company Website" },
  { value: "MANUAL", label: "Manual Entry" },
];

// Sentinel product-choice value — appended to every Product dropdown so the
// user can fall back to freeform text instead of picking a listed project.
const OTHERS_PRODUCT_ID = "OTHERS";
const OTHERS_PRODUCT_OPTION = { ID: OTHERS_PRODUCT_ID, NAME: "Others" };

const EMPTY_FORM = {
  CONTACT_NAME: "", CONTACT_MOBILE: "", CONTACT_EMAIL: "", COMPANY_NAME: "",
  ADDRESS: "", CITY: "", STATE: "", PINCODE: "", COUNTRY_ISO: "",
  LEAD_MESSAGE: "", PRODUCT_INTEREST: "",
  LEAD_STATUS: "NEW", ASSIGNED_TO_ID: "",
};

function sourceLabel(value) {
  return LEAD_SOURCE_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

function statusLabel(value) {
  return LEAD_STATUS_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

export default function ManualLeadManagement() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [dateRange, setDateRange] = useState(EMPTY_RANGE);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [departments, setDepartments] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);

  const [modal, setModal] = useState(null); // null | "add" | "edit"
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  // Category → Product cascade — UI-only state for Manual Entry leads;
  // the resolved value always lands in form.PRODUCT_INTEREST (same field,
  // same storage, no schema/API change).
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productChoice, setProductChoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [leadDetailModal, setLeadDetailModal] = useState(null);

  const [cfOpen, setCfOpen] = useState(false);


  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef();

  const toast = useToast();
  const refDataRef = useRef(false);

  const {
    fields: cfFields, cfValues, handleCfChange,
    loadValues: loadCfValues, resetValues: resetCfValues,
    validateCf, saveCfValues, refreshFields,
  } = useCustomFields(CF_TABLE);
  const cfValuesMap = useTableCfValues(CF_TABLE, rows);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const loadRefData = useCallback(async () => {
    try {
      const [deptRes, roleRes, empRes, catRes, projRes] = await Promise.all([
        departmentService.getAll(),
        roleService.getAll(),
        employeeService.getAll({ status: "ACTIVE" }),
        categoryService.getAll(),
        projectService.getAll(),
      ]);
      setDepartments(deptRes.data || []);
      setAllRoles(roleRes.data || []);
      setAllEmployees(empRes.data || []);
      setCategories(catRes.data || []);
      setProjects(projRes.data || []);
    } catch {
      toast.showError("Failed to load reference data");
    }
  }, []);

  useEffect(() => {
    if (refDataRef.current) return;
    refDataRef.current = true;
    loadRefData();
  }, [loadRefData]);

  const buildParams = useCallback((overrides = {}) => {
    const { from, to } = toIsoRange(dateRange, { withTime: true });
    const params = { ...overrides };
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterSource) params.lead_source = filterSource;
    if (filterDept) params.department_id = filterDept;
    if (filterRole) params.role_id = filterRole;
    if (filterUser) params.assigned_to_id = filterUser;
    if (from) params.created_from = from;
    if (to) params.created_to = to;
    return params;
  }, [debouncedSearch, filterSource, filterDept, filterRole, filterUser, dateRange]);

  const loadLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const params = buildParams({ limit: pageSize, offset: (page - 1) * pageSize });
      const res = await leadService.getAll(params);
      setRows(res.data?.rows || []);
      setTotal(res.data?.total || 0);
    } catch {
      toast.showError("Failed to load leads");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildParams, page, pageSize]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const handleRefresh = useCallback(() => loadLeads(true), [loadLeads]);

  const rolesForDept = useCallback(
    (deptId) => (deptId ? allRoles.filter((r) => String(r.DEPARTMENT_ID) === String(deptId)) : allRoles),
    [allRoles]
  );
  const usersForFilters = useCallback(
    (deptId, roleId) => allEmployees.filter((e) =>
      (!deptId || String(e.DEPARTMENT_ID) === String(deptId)) &&
      (!roleId || String(e.ROLE_ID) === String(roleId))
    ),
    [allEmployees]
  );

  const empMap = useMemo(
    () => Object.fromEntries(allEmployees.map((e) => [e.ID, e.NAME])),
    [allEmployees]
  );
  const empByIdMap = useMemo(
    () => Object.fromEntries(allEmployees.map((e) => [e.ID, e])),
    [allEmployees]
  );

  const handleViewDetails = useCallback(async (row) => {
    let lead = row; // fall back to the row already in hand if the detail call fails
    try {
      const res = await leadService.get(row.ID);
      lead = res.data || row;
    } catch {
      // keep the fallback assigned above
    }
    const creator = empByIdMap[lead.CREATED_BY_ID];
    const owner = empByIdMap[lead.ASSIGNED_TO_ID];
    setLeadDetailModal({
      ...lead,
      CREATED_BY_NAME: creator?.NAME || null,
      CREATED_BY_CODE: creator?.EMPLOYEE_CODE || null,
      CREATED_BY_EMAIL: creator?.EMAIL || null,
      CREATED_BY_PHONE: creator?.PHONE || null,
      CREATED_BY_DEPARTMENT: creator?.DEPARTMENT?.NAME || null,
      CREATED_BY_ROLE: creator?.ROLE?.NAME || null,
      ASSIGNED_TO_NAME: owner?.NAME || null,
    });
  }, [empByIdMap]);

  const handleSourceChange = useCallback((v) => { setFilterSource(v || ""); setPage(1); }, []);
  const handleDeptChange = useCallback((v) => {
    setFilterDept(v || ""); setFilterRole(""); setFilterUser(""); setPage(1);
  }, []);
  const handleRoleChange = useCallback((v) => { setFilterRole(v || ""); setFilterUser(""); setPage(1); }, []);
  const handleUserChange = useCallback((v) => { setFilterUser(v || ""); setPage(1); }, []);
  const handleDateRangeChange = useCallback((next) => { setDateRange(next); setPage(1); }, []);
  const handleClearDateRange = useCallback(() => { setDateRange(EMPTY_RANGE); setPage(1); }, []);

  const hasFilters = search || filterSource || filterDept || filterRole || filterUser || dateRange.fromDate || dateRange.toDate;

  const handleResetFilters = useCallback(() => {
    setSearch(""); setDebouncedSearch("");
    setFilterSource(""); setFilterDept(""); setFilterRole(""); setFilterUser("");
    setDateRange(EMPTY_RANGE);
    setPage(1);
  }, []);

  const stats = useMemo(() => [
    { value: total, label: "Total Leads" },
    { value: rows.length, label: "Showing" },
  ], [total, rows.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setErrors({});
    resetCfValues();
    setProductCategoryId("");
    setProductChoice("");
    setModal("add");
  }, [resetCfValues]);

  const formFromRow = useCallback((row) => ({
    CONTACT_NAME: row.CONTACT_NAME || "",
    CONTACT_MOBILE: row.CONTACT_MOBILE || "",
    CONTACT_EMAIL: row.CONTACT_EMAIL || "",
    COMPANY_NAME: row.COMPANY_NAME || "",
    ADDRESS: row.ADDRESS || "",
    CITY: row.CITY || "",
    STATE: row.STATE || "",
    PINCODE: row.PINCODE || "",
    COUNTRY_ISO: row.COUNTRY_ISO || "",
    LEAD_MESSAGE: row.LEAD_MESSAGE || "",
    PRODUCT_INTEREST: row.PRODUCT_INTEREST || "",
    LEAD_STATUS: row.LEAD_STATUS || "NEW",
    ASSIGNED_TO_ID: row.ASSIGNED_TO_ID || "",
  }), []);

  const openEdit = useCallback((row) => {
    setForm(formFromRow(row));
    setSelected(row);
    setErrors({});
    loadCfValues(row.ID);
    // Reconstruct the Category → Product selection for a Manual Entry lead
    // by matching the stored PRODUCT_INTEREST text back to a project name.
    // If it doesn't match any project (or the lead isn't Manual Entry),
    // fall back to "Others" (or blank) — the stored text itself is never
    // touched by this reconstruction.
    if (row.LEAD_SOURCE === "MANUAL" && row.PRODUCT_INTEREST) {
      const want = row.PRODUCT_INTEREST.trim().toLowerCase();
      const match = projects.find((p) => (p.NAME || "").trim().toLowerCase() === want);
      if (match) {
        setProductCategoryId(match.CATEGORY_ID || "");
        setProductChoice(match.ID);
      } else {
        setProductCategoryId("");
        setProductChoice(OTHERS_PRODUCT_ID);
      }
    } else {
      setProductCategoryId("");
      setProductChoice("");
    }
    setModal("edit");
  }, [formFromRow, loadCfValues, projects]);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelected(null);
    setErrors({});
  }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    clearFieldError(setErrors, field);
  }, []);

  const isManualSource = modal === "add" || (!!selected && selected.LEAD_SOURCE === "MANUAL");

  const projectsForCategory = useMemo(
    () => (productCategoryId ? projects.filter((p) => String(p.CATEGORY_ID) === String(productCategoryId)) : []),
    [projects, productCategoryId]
  );
  const productOptions = useMemo(
    () => [...projectsForCategory, OTHERS_PRODUCT_OPTION],
    [projectsForCategory]
  );

  const handleProductCategoryChange = useCallback((v) => {
    setProductCategoryId(v || "");
    setProductChoice("");
    handleFormChange("PRODUCT_INTEREST", "");
  }, [handleFormChange]);

  const handleProductChoiceChange = useCallback((v) => {
    setProductChoice(v || "");
    if (v === OTHERS_PRODUCT_ID) {
      handleFormChange("PRODUCT_INTEREST", "");
    } else {
      const proj = projects.find((p) => p.ID === v);
      handleFormChange("PRODUCT_INTEREST", proj?.NAME || "");
    }
  }, [projects, handleFormChange]);

  const handleSave = useCallback(async () => {
    const { errors: formErrors } = validateForm(LEAD_RULES, form);
    const cfError = validateCf();
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      toast.showWarning("Please fix the highlighted fields");
      return;
    }
    if (cfError) {
      toast.showWarning(cfError);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        CONTACT_NAME: form.CONTACT_NAME.trim(),
        CONTACT_MOBILE: form.CONTACT_MOBILE.trim() || null,
        CONTACT_EMAIL: form.CONTACT_EMAIL.trim() || null,
        COMPANY_NAME: form.COMPANY_NAME.trim() || null,
        ADDRESS: form.ADDRESS.trim() || null,
        CITY: form.CITY.trim() || null,
        STATE: form.STATE.trim() || null,
        PINCODE: form.PINCODE.trim() || null,
        COUNTRY_ISO: form.COUNTRY_ISO.trim() || null,
        LEAD_MESSAGE: form.LEAD_MESSAGE.trim() || null,
        PRODUCT_INTEREST: form.PRODUCT_INTEREST.trim() || null,
        LEAD_STATUS: form.LEAD_STATUS,
        ASSIGNED_TO_ID: form.ASSIGNED_TO_ID || null,
      };
      if (modal === "add") {
        const res = await leadService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Lead created");
      } else {
        await leadService.update(selected.ID, payload);
        await saveCfValues(selected.ID);
        toast.showSuccess("Lead updated");
      }
      closeModal();
      loadLeads(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, closeModal, loadLeads, toast, validateCf, saveCfValues]);

  const handleDelete = useCallback((row) => {
    setConfirmModal({
      title: "Delete Lead",
      description: `Delete the lead for "${row.CONTACT_NAME}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await leadService.remove(row.ID);
          toast.showSuccess("Lead deleted");
          loadLeads(true);
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [loadLeads, toast]);

  const downloadTemplate = useCallback(async () => {
    try {
      const headers = [
        "Contact Name", "Contact Mobile", "Contact Email", "Company Name",
        "Address", "City", "State", "Pincode", "Country ISO",
        "Lead Message", "Product Interest", "Lead Status",
        ...cfFields.map((f) => f.FIELD_NAME),
      ];
      await dlTemplate("Leads", headers, "leads_template");
    } catch {
      toast.showError("Failed to download template");
    }
  }, [cfFields]);

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
      const res = await leadService.bulkUpload(fd);
      setUploadResult(res.data);
      loadLeads(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [loadLeads, toast]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const params = buildParams({ limit: 100000, offset: 0 });
      const [leadsRes, cfValsRes] = await Promise.all([
        leadService.getAll(params),
        customFieldService.getAllValues(CF_TABLE),
      ]);
      const exportRows = leadsRes.data?.rows || [];
      const cfMap = {};
      (cfValsRes.data || []).forEach((v) => {
        const rid = String(v.TABLE_ROW_ID);
        if (!cfMap[rid]) cfMap[rid] = {};
        cfMap[rid][v.CUSTOM_FIELD_ID] = v.CUSTOM_FIELD_VALUE;
      });

      const data = exportRows.map((r, i) => {
        const row = {
          "S.No": i + 1,
          "Contact Name": r.CONTACT_NAME || "",
          "Mobile": r.CONTACT_MOBILE || "",
          "Email": r.CONTACT_EMAIL || "",
          "Company": r.COMPANY_NAME || "",
          "Lead Source": sourceLabel(r.LEAD_SOURCE),
          "Lead Status": statusLabel(r.LEAD_STATUS),
          "Lead Owner": empMap[r.ASSIGNED_TO_ID] || "",
          "Created By": empMap[r.CREATED_BY_ID] || "",
          "Created Date": r.CREATED_AT ? formatDateTime(r.CREATED_AT) : "",
        };
        cfFields.forEach((f) => {
          const val = cfMap[String(r.ID)]?.[f.ID];
          row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
        });
        return row;
      });
      exportToExcel(data, "leads");
    } catch {
      toast.showError("Export failed");
    } finally {
      setExporting(false);
    }
  }, [buildParams, cfFields, empMap]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={LeadIcon}
        iconAlt="Lead Records"
        title="Lead Management"
        subtitle="Create, view, and filter every lead — regardless of source"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={downloadTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={exporting || total === 0} />


            <PMButton variant="outline" onClick={() => setAiPanelOpen(true)}>Ask AI Assistant</PMButton>

            <PMButton variant="primary" onClick={openAdd}>Add Lead</PMButton>
          </>
        }
      />


      <StatsRow stats={stats} />

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <label>Lead Source</label>
          <PMSelect
            options={LEAD_SOURCE_OPTIONS}
            value={filterSource}
            onChange={handleSourceChange}
            valueKey="value"
            labelKey="label"
            allowClear
            clearLabel="All Sources"
          />
        </div>
        <DateTimeRangeFilter
          value={dateRange}
          onChange={handleDateRangeChange}
          onClear={handleClearDateRange}
          showTime
        />
        <div className={styles.filterGroup}>
          <label>Department</label>
          <PMSelect
            options={departments}
            value={filterDept}
            onChange={handleDeptChange}
            valueKey="ID"
            labelKey="NAME"
            allowClear
            clearLabel="All Departments"
          />
        </div>
        <div className={styles.filterGroup}>
          <label>Role</label>
          <PMSelect
            options={rolesForDept(filterDept)}
            value={filterRole}
            onChange={handleRoleChange}
            valueKey="ID"
            labelKey="NAME"
            allowClear
            clearLabel="All Roles"
          />
        </div>
        <div className={styles.filterGroup}>
          <label>Lead Owner</label>
          <PMSelect
            options={usersForFilters(filterDept, filterRole)}
            value={filterUser}
            onChange={handleUserChange}
            valueKey="ID"
            labelKey="NAME"
            allowClear
            clearLabel="All Owners"
          />
        </div>
        {hasFilters && (
          <div className={styles.filterActions}>
            <PMButton variant="outline" onClick={handleResetFilters}>Reset Filters</PMButton>
          </div>
        )}
      </div>

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by contact name, company, mobile, or email…"
          />
          <span className={styles.count}>{total} lead{total !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Contact Name</th>
                <th>Company</th>
                <th>Mobile / Email</th>
                <th>Source</th>
                <th>Status</th>
                <th>Lead Owner</th>
                <th>Created By</th>
                <th>Created At</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10 + cfFields.length}><Loader /></td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10 + cfFields.length}>
                    <EmptyState
                      icon={LeadIcon}
                      iconAlt="Lead Records"
                      title={hasFilters ? "No leads match your filters" : "No leads yet"}
                      description={!hasFilters ? "Click 'Add Lead' to create one, or wait for a polling config to pull some in." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.CONTACT_NAME || "—"}</td>
                    <td className={styles.descCell}>{r.COMPANY_NAME || "—"}</td>
                    <td className={styles.descCell}>{r.CONTACT_MOBILE || r.CONTACT_EMAIL || "—"}</td>
                    <td><span className={styles.codeBadge}>{sourceLabel(r.LEAD_SOURCE)}</span></td>
                    <td><span className={styles.statusPill} data-status={r.LEAD_STATUS}>{statusLabel(r.LEAD_STATUS)}</span></td>
                    <td>{empMap[r.ASSIGNED_TO_ID] || <span className={styles.muted}>—</span>}</td>
                    <td>{empMap[r.CREATED_BY_ID] || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.dateCell}>{formatDateTime(r.CREATED_AT)}</td>
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
                        <button className={styles.iconBtn} onClick={() => handleViewDetails(r)} title="View Details">
                          <img src={ViewIcon} alt="View" />
                        </button>
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
          total={total}
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
        title={modal === "add" ? "Add Lead" : "Edit Lead"}
        size="lg"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : modal === "add" ? "Create Lead" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Lead Source</label>
            <span className={styles.codeBadge}>{selected ? sourceLabel(selected.LEAD_SOURCE) : "Manual Entry"}</span>
          </div>
          <div className={styles.formGroup}>
            <label>Lead Status <span className={styles.req}>*</span></label>
            <PMSelect
              options={LEAD_STATUS_OPTIONS}
              value={form.LEAD_STATUS}
              onChange={(v) => handleFormChange("LEAD_STATUS", v)}
              valueKey="value"
              labelKey="label"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Contact Name <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input}${errors.CONTACT_NAME ? " " + styles.inputError : ""}`}
              value={form.CONTACT_NAME}
              onChange={(e) => handleFormChange("CONTACT_NAME", e.target.value)}
            />
            {errors.CONTACT_NAME && <span className={styles.fieldError}>{errors.CONTACT_NAME}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Contact Mobile</label>
            <input
              className={`${styles.input}${errors.CONTACT_MOBILE ? " " + styles.inputError : ""}`}
              value={form.CONTACT_MOBILE}
              onChange={(e) => handleFormChange("CONTACT_MOBILE", e.target.value)}
            />
            {errors.CONTACT_MOBILE && <span className={styles.fieldError}>{errors.CONTACT_MOBILE}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Contact Email</label>
            <input
              type="email"
              className={`${styles.input}${errors.CONTACT_EMAIL ? " " + styles.inputError : ""}`}
              value={form.CONTACT_EMAIL}
              onChange={(e) => handleFormChange("CONTACT_EMAIL", e.target.value)}
            />
            {errors.CONTACT_EMAIL && <span className={styles.fieldError}>{errors.CONTACT_EMAIL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Company Name</label>
            <input
              className={styles.input}
              value={form.COMPANY_NAME}
              onChange={(e) => handleFormChange("COMPANY_NAME", e.target.value)}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Address</label>
            <input
              className={styles.input}
              value={form.ADDRESS}
              onChange={(e) => handleFormChange("ADDRESS", e.target.value)}
            />
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
            <input className={styles.input} value={form.COUNTRY_ISO} onChange={(e) => handleFormChange("COUNTRY_ISO", e.target.value)} placeholder="e.g. IN" />
          </div>
          <div className={styles.formGroup}>
            <label>Lead Owner</label>
            <PMSelect
              options={allEmployees}
              value={form.ASSIGNED_TO_ID}
              onChange={(v) => handleFormChange("ASSIGNED_TO_ID", v)}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="— Unassigned —"
            />
          </div>
          {isManualSource ? (
            <>
              <div className={styles.formGroup}>
                <label>Product Category</label>
                <PMSelect
                  options={categories}
                  value={productCategoryId}
                  onChange={handleProductCategoryChange}
                  valueKey="ID"
                  labelKey="NAME"
                  allowClear
                  clearLabel="— Select category —"
                />
              </div>
              {!!productCategoryId && (
                <div className={styles.formGroup}>
                  <label>Product</label>
                  <PMSelect
                    options={productOptions}
                    value={productChoice}
                    onChange={handleProductChoiceChange}
                    valueKey="ID"
                    labelKey="NAME"
                    allowClear
                    clearLabel="— Select product —"
                  />
                </div>
              )}
              {productChoice === OTHERS_PRODUCT_ID && (
                <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                  <label>Product Interest (Others)</label>
                  <input
                    className={styles.input}
                    value={form.PRODUCT_INTEREST}
                    onChange={(e) => handleFormChange("PRODUCT_INTEREST", e.target.value)}
                    placeholder="Enter the product name"
                  />
                </div>
              )}
            </>
          ) : (
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <label>Product Interest</label>
              <input className={styles.input} value={form.PRODUCT_INTEREST} onChange={(e) => handleFormChange("PRODUCT_INTEREST", e.target.value)} />
            </div>
          )}
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Lead Message</label>
            <textarea
              className={styles.textarea}
              value={form.LEAD_MESSAGE}
              onChange={(e) => handleFormChange("LEAD_MESSAGE", e.target.value)}
            />
          </div>
          {selected && (
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <div className={styles.metaRow}>
                <span>Created By: <strong>{empMap[selected.CREATED_BY_ID] || "—"}</strong></span>
                <span>Created: {formatDateTime(selected.CREATED_AT)}</span>
                <span>Updated: {formatDateTime(selected.UPDATED_AT)}</span>
              </div>
            </div>
          )}
        </div>
        <CustomFieldsSection fields={cfFields} values={cfValues} onChange={handleCfChange} />
      </PMModal>

      {/* Bulk Upload Modal */}
      <PMModal
        open={bulkModal}
        onClose={() => setBulkModal(false)}
        title="Bulk Upload Leads"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Leads"</strong> and column <strong>Contact Name</strong> required
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Every valid row becomes a new lead with source "Manual Entry".
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

      {/* Lead Details Modal (mirrors /supplier-management's Invitation Details modal) */}
      <LeadDetailModal
        open={!!leadDetailModal}
        onClose={() => setLeadDetailModal(null)}
        data={leadDetailModal}
      />

      {/* Custom Fields Config Modal */}
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
      />

      {/* Lead AI Assistant — purely additive, module_code="lead" */}
      <LeadAIAssistantPanel open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} />
    </div>
  );
}
