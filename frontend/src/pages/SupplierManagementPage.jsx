import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { InvitationDetailModal } from "../components/supplier/InvitationDetailModal";
import { ReviewModal } from "../components/supplier/ReviewModal";
import { RejectModal } from "../components/supplier/RejectModal";
import SupplierProductModal from "../components/supplier/SupplierProductModal";
import { supplierManagementService } from "../services/supplierManagementService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import { formatDateTime } from "../utils/formatDateTime";
import SupplierIcon from "../assets/Icons/supplierIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import DetailsIcon from "../assets/Icons/detailsIcon.webp";
import styles from "./SupplierManagementPage.module.css";
import { validateForm, clearFieldError, SUPPLIER_RULES, INVITE_RULES } from "../utils/formValidation";

const SUPPLIER_EMPTY_FORM = {
  COMPANY_NAME: "", REGISTRATION_NO: "", COMPANY_TYPE: "",
  CONTACT_PERSON: "", PHONE: "", EMAIL: "",
  ALTERNATE_EMAIL: "", ALTERNATE_PHONE: "",
  ADDRESS_LINE1: "", ADDRESS_LINE2: "", CITY: "", STATE: "", PINCODE: "",
  GST_NUMBER: "", PAN_NUMBER: "",
  BANK_NAME: "", ACCOUNT_NUMBER: "", IFSC_CODE: "", PAYMENT_TERMS: "",
  CATEGORY: "", STATUS: "ACTIVE", NOTES: "", WEBSITE: "",
  YEARS_IN_BUSINESS: "", ANNUAL_TURNOVER: "", EMPLOYEE_COUNT: "",
  CREDIT_DAYS: 30, LEAD_TIME_DAYS: 7, ADVANCE_PERCENT: 0, MINIMUM_ORDER_VALUE: 0,
};

const INVITE_EMPTY_FORM = { INVITED_COMPANY_NAME: "", INVITED_EMAIL: "", INVITED_PHONE: "" };

const REJECT_EMPTY = { REJECTION_REASON: "" };

const STATUS_COLORS = {
  OPEN: styles.badgeOpen,
  DRAFT_SAVED: styles.badgeDraft,
  SUBMITTED: styles.badgeSubmitted,
  UNDER_REVIEW: styles.badgeReview,
  APPROVED: styles.badgeApproved,
  REJECTED: styles.badgeRejected,
  EXPIRED: styles.badgeExpired,
};

const SUPPLIER_STATUS_COLORS = {
  ACTIVE: styles.badgeApproved,
  INACTIVE: styles.badgeExpired,
  BLACKLISTED: styles.badgeRejected,
};

const TABS = [
  { key: "suppliers", label: "Suppliers" },
  { key: "invitations", label: "Invitations" },
  { key: "approvals", label: "Pending Approval" },
];

export default function SupplierManagementPage() {
  const [activeTab, setActiveTab] = useState("suppliers");

  // Suppliers tab state
  const [suppliers, setSuppliers] = useState([]);
  const [suppLoading, setSuppLoading] = useState(true);
  const [suppRefreshing, setSuppRefreshing] = useState(false);
  const [suppSearch, setSuppSearch] = useState("");
  const [suppPage, setSuppPage] = useState(1);
  const [suppPageSize, setSuppPageSize] = useState(25);
  const [suppModal, setSuppModal] = useState(null); // null | "add" | "edit"
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [productsModal, setProductsModal] = useState(null); // null | supplier object
  const [suppForm, setSuppForm] = useState(SUPPLIER_EMPTY_FORM);
  const [suppErrors, setSuppErrors] = useState({});
  const [suppSaving, setSuppSaving] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();
  const [confirmModal, setConfirmModal] = useState(null);

  // Suppliers tab date filter
  const [suppFilterFrom, setSuppFilterFrom] = useState("");
  const [suppFilterTo, setSuppFilterTo] = useState("");

  // Invitations tab state
  const [invitations, setInvitations] = useState([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invSearch, setInvSearch] = useState("");
  const [invPage, setInvPage] = useState(1);
  const [invModal, setInvModal] = useState(false);
  const [invForm, setInvForm] = useState(INVITE_EMPTY_FORM);
  const [invErrors, setInvErrors] = useState({});
  const [invSaving, setInvSaving] = useState(false);
  // Invitation date filter
  const [invFilterField, setInvFilterField] = useState("CREATED_AT");
  const [invFilterFrom, setInvFilterFrom] = useState("");
  const [invFilterTo, setInvFilterTo] = useState("");
  // Invitation detail modal
  const [invDetailModal, setInvDetailModal] = useState(null);
  // Per-row in-flight tracking — prevents duplicate Resend/Expire requests
  const [resendingIds, setResendingIds] = useState(new Set());
  const [expiringId, setExpiringId] = useState(null);

  // Approvals tab state
  const [approvals, setApprovals] = useState([]);
  const [appLoading, setAppLoading] = useState(false);
  const [appPage, setAppPage] = useState(1);
  const [reviewModal, setReviewModal] = useState(null); // invitation object
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectForm, setRejectForm] = useState(REJECT_EMPTY);
  const [appActing, setAppActing] = useState(false);

  const toast = useToast();
  const fetchedRef = useRef({});

  const {
    fields: cfFields, cfValues, handleCfChange,
    loadValues: loadCfValues, resetValues: resetCfValues,
    validateCf, saveCfValues, refreshFields,
  } = useCustomFields("inventory_supplier_details");
  const cfValuesMap = useTableCfValues("inventory_supplier_details", suppliers);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  // ── Loaders ────────────────────────────────────────────────────────────
  const loadSuppliers = useCallback(async (silent = false) => {
    if (!silent) setSuppLoading(true); else setSuppRefreshing(true);
    try {
      const res = await supplierManagementService.getAll();
      setSuppliers(res.data || []);
    } catch {
      toast.showError("Failed to load suppliers");
    } finally {
      setSuppLoading(false);
      setSuppRefreshing(false);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    setInvLoading(true);
    try {
      const res = await supplierManagementService.getInvitations();
      setInvitations(res.data || []);
    } catch {
      toast.showError("Failed to load invitations");
    } finally {
      setInvLoading(false);
    }
  }, []);

  const loadApprovals = useCallback(async () => {
    setAppLoading(true);
    try {
      const res = await supplierManagementService.getPendingApprovals();
      setApprovals(res.data || []);
    } catch {
      toast.showError("Failed to load pending approvals");
    } finally {
      setAppLoading(false);
    }
  }, []);

  // Load on tab switch (once per tab)
  useEffect(() => {
    if (activeTab === "suppliers" && !fetchedRef.current.suppliers) {
      fetchedRef.current.suppliers = true;
      loadSuppliers();
    }
    if (activeTab === "invitations" && !fetchedRef.current.invitations) {
      fetchedRef.current.invitations = true;
      loadInvitations();
    }
    if (activeTab === "approvals" && !fetchedRef.current.approvals) {
      fetchedRef.current.approvals = true;
      loadApprovals();
    }
  }, [activeTab, loadSuppliers, loadInvitations, loadApprovals]);

  const handleRefresh = useCallback(() => {
    if (activeTab === "suppliers") { fetchedRef.current.suppliers = false; loadSuppliers(true); }
    if (activeTab === "invitations") { fetchedRef.current.invitations = false; loadInvitations(); }
    if (activeTab === "approvals") { fetchedRef.current.approvals = false; loadApprovals(); }
  }, [activeTab, loadSuppliers, loadInvitations, loadApprovals]);

  // ── Suppliers CRUD ─────────────────────────────────────────────────────
  const filteredSuppliers = useMemo(() => {
    let data = suppliers;
    if (suppSearch.trim()) {
      const t = suppSearch.toLowerCase();
      data = data.filter(
        (s) =>
          s.COMPANY_NAME?.toLowerCase().includes(t) ||
          (s.CONTACT_PERSON || "").toLowerCase().includes(t) ||
          (s.EMAIL || "").toLowerCase().includes(t) ||
          (s.PHONE || "").toLowerCase().includes(t) ||
          (s.GST_NUMBER || "").toLowerCase().includes(t)
      );
    }
    if (suppFilterFrom || suppFilterTo) {
      const from = suppFilterFrom ? new Date(suppFilterFrom) : null;
      const to = suppFilterTo ? new Date(suppFilterTo) : null;
      data = data.filter((s) => {
        if (!s.CREATED_AT) return false;
        const d = new Date(s.CREATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return data;
  }, [suppliers, suppSearch, suppFilterFrom, suppFilterTo]);

  const suppPaginated = useMemo(
    () => suppPageSize === 0 ? filteredSuppliers : filteredSuppliers.slice((suppPage - 1) * suppPageSize, suppPage * suppPageSize),
    [filteredSuppliers, suppPage, suppPageSize]
  );

  const suppStats = useMemo(() => [
    { value: suppliers.length, label: "Total Suppliers" },
    { value: suppliers.filter((s) => s.STATUS === "ACTIVE").length, label: "Active" },
    { value: approvals.length, label: "Pending Approval" },
    { value: invitations.filter((i) => i.STATUS === "OPEN" || i.STATUS === "DRAFT_SAVED").length, label: "Open Invitations" },
  ], [suppliers, approvals, invitations]);

  const openAddSupplier = useCallback(() => {
    setSuppForm(SUPPLIER_EMPTY_FORM);
    setSelectedSupplier(null);
    setSuppModal("add");
    resetCfValues();
  }, [resetCfValues]);

  const openEditSupplier = useCallback((s) => {
    setSuppForm({
      COMPANY_NAME:        s.COMPANY_NAME || "",
      REGISTRATION_NO:     s.REGISTRATION_NO || "",
      COMPANY_TYPE:        s.COMPANY_TYPE || "",
      CONTACT_PERSON:      s.CONTACT_PERSON || "",
      PHONE:               s.PHONE || "",
      EMAIL:               s.EMAIL || "",
      ALTERNATE_EMAIL:     s.ALTERNATE_EMAIL || "",
      ALTERNATE_PHONE:     s.ALTERNATE_PHONE || "",
      ADDRESS_LINE1:       s.ADDRESS_LINE1 || s.ADDRESS || "",
      ADDRESS_LINE2:       s.ADDRESS_LINE2 || "",
      CITY:                s.CITY || "",
      STATE:               s.STATE || "",
      PINCODE:             s.PINCODE || "",
      GST_NUMBER:          s.GST_NUMBER || "",
      PAN_NUMBER:          s.PAN_NUMBER || "",
      BANK_NAME:           s.BANK_NAME || "",
      ACCOUNT_NUMBER:      s.ACCOUNT_NUMBER || "",
      IFSC_CODE:           s.IFSC_CODE || "",
      PAYMENT_TERMS:       s.PAYMENT_TERMS || "",
      CATEGORY:            s.CATEGORY || "",
      STATUS:              s.STATUS || "ACTIVE",
      NOTES:               s.NOTES || "",
      WEBSITE:             s.WEBSITE || "",
      YEARS_IN_BUSINESS:   s.YEARS_IN_BUSINESS != null ? String(s.YEARS_IN_BUSINESS) : "",
      ANNUAL_TURNOVER:     s.ANNUAL_TURNOVER != null ? String(s.ANNUAL_TURNOVER) : "",
      EMPLOYEE_COUNT:      s.EMPLOYEE_COUNT != null ? String(s.EMPLOYEE_COUNT) : "",
      CREDIT_DAYS:         s.CREDIT_DAYS ?? 30,
      LEAD_TIME_DAYS:      s.LEAD_TIME_DAYS ?? 7,
      ADVANCE_PERCENT:     s.ADVANCE_PERCENT ?? 0,
      MINIMUM_ORDER_VALUE: s.MINIMUM_ORDER_VALUE ?? 0,
    });
    setSelectedSupplier(s);
    setSuppModal("edit");
    loadCfValues(s.ID);
  }, [loadCfValues]);

  const closeSuppModal = useCallback(() => {
    setSuppModal(null);
    setSelectedSupplier(null);
    setSuppErrors({});
  }, []);

  const handleSuppFormChange = useCallback((field, val) => {
    setSuppForm((prev) => ({ ...prev, [field]: val }));
    clearFieldError(setSuppErrors, field);
  }, []);

  const handleSaveSupplier = useCallback(async () => {
    const { isValid: suppValid, errors: suppValidErrors } = validateForm(SUPPLIER_RULES, suppForm);
    if (!suppValid) { setSuppErrors(suppValidErrors); return; }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setSuppSaving(true);
    try {
      if (suppModal === "add") {
        const res = await supplierManagementService.create(suppForm);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Supplier added");
      } else {
        await supplierManagementService.update(selectedSupplier.ID, suppForm);
        await saveCfValues(selectedSupplier.ID);
        toast.showSuccess("Supplier updated");
      }
      closeSuppModal();
      loadSuppliers(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSuppSaving(false);
    }
  }, [suppForm, suppModal, selectedSupplier, closeSuppModal, loadSuppliers, toast, validateCf, saveCfValues]);

  const handleExportSuppliers = useCallback(() => {
    const data = filteredSuppliers.map((s, i) => {
      const row = {
        "S.No": i + 1,
        Name: s.COMPANY_NAME,
        "Contact Person": s.CONTACT_PERSON || "",
        Phone: s.PHONE || "",
        Email: s.EMAIL || "",
        "GST Number": s.GST_NUMBER || "",
        Category: s.CATEGORY || "",
        Status: s.STATUS || "",
        Address: s.ADDRESS || "",
        "Created Date": formatDateTime(s.CREATED_AT),
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(s.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "suppliers");
  }, [filteredSuppliers, cfFields, cfValuesMap]);

  const handleDownloadTemplate = useCallback(async () => {
    const headers = [
      "Name", "Contact Person", "Phone", "Email", "GST Number", "Category", "Address",
      ...cfFields.map((f) => f.FIELD_NAME),
    ];
    await dlTemplate("Suppliers", headers, "suppliers_template");
  }, [cfFields]);

  const openBulk = useCallback(() => {
    setBulkFile(null); setUploadResult(null); setBulkModal(true);
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
      const res = await supplierManagementService.bulkUpload(fd);
      setUploadResult(res.data);
      loadSuppliers(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [loadSuppliers, toast]);

  // ── Invitations ────────────────────────────────────────────────────────
  const filteredInv = useMemo(() => {
    let data = invitations;
    if (invSearch.trim()) {
      const t = invSearch.toLowerCase();
      data = data.filter(
        (i) =>
          (i.INVITED_COMPANY_NAME || "").toLowerCase().includes(t) ||
          (i.INVITED_EMAIL || "").toLowerCase().includes(t)
      );
    }
    if (invFilterFrom || invFilterTo) {
      const from = invFilterFrom ? new Date(invFilterFrom) : null;
      const to = invFilterTo ? new Date(invFilterTo) : null;
      data = data.filter((i) => {
        const val = i[invFilterField];
        if (!val) return false;
        const d = new Date(val);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return data;
  }, [invitations, invSearch, invFilterField, invFilterFrom, invFilterTo]);

  const invPaginated = useMemo(
    () => filteredInv.slice((invPage - 1) * 25, invPage * 25),
    [filteredInv, invPage]
  );

  const handleSendInvite = useCallback(async () => {
    const { isValid: invValid, errors: invValidErrors } = validateForm(INVITE_RULES, invForm);
    if (!invValid) { setInvErrors(invValidErrors); return; }
    setInvSaving(true);
    try {
      const empId = localStorage.getItem("employee_id");
      const payload = { ...invForm, CREATED_BY_ID: empId || null };
      const res = await supplierManagementService.sendInvitation(payload);
      const es = res?.data?.email_status;
      if (es?.sent) {
        toast.showSuccess(`Invitation sent — From: ${es.from_email || "—"} → To: ${es.to_email || "—"}`);
      } else {
        toast.showWarning(`Invitation created but email delivery failed. ${es?.error || "Check SMTP config."}`);
      }
      setInvModal(false);
      setInvForm(INVITE_EMPTY_FORM);
      fetchedRef.current.invitations = false;
      loadInvitations();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to send invitation");
    } finally {
      setInvSaving(false);
    }
  }, [invForm, loadInvitations, toast]);
  // Note: 409 from duplicate check surfaces via e?.response?.data?.detail in the catch above

  const handleResend = useCallback(async (id) => {
    setResendingIds((prev) => new Set(prev).add(id));
    try {
      const res = await supplierManagementService.resendInvitation(id);
      const es = res?.data?.email_status;
      if (es?.sent) {
        toast.showSuccess(`Invitation resent — From: ${es.from_email || "—"} → To: ${es.to_email || "—"}`);
      } else {
        toast.showWarning(`Resend attempted but email delivery failed. ${es?.error || "Check SMTP config."}`);
      }
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Resend failed");
    } finally {
      setResendingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [toast]);

  const handleExpire = useCallback((inv) => {
    setConfirmModal({
      title: "Expire Invitation",
      description: `Expire invitation for "${inv.INVITED_COMPANY_NAME}"? The registration link will no longer work.`,
      onConfirm: async () => {
        setExpiringId(inv.ID);
        try {
          await supplierManagementService.expireInvitation(inv.ID);
          toast.showSuccess("Invitation expired");
          fetchedRef.current.invitations = false;
          loadInvitations();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Failed to expire");
        } finally {
          setExpiringId(null);
        }
      },
    });
  }, [loadInvitations, toast]);

  const handleDeleteInvitation = useCallback((inv) => {
    setConfirmModal({
      title: "Delete Invitation",
      description: `Permanently delete the invitation for "${inv.INVITED_COMPANY_NAME || inv.INVITED_EMAIL}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await supplierManagementService.deleteInvitation(inv.ID);
          toast.showSuccess("Invitation deleted");
          fetchedRef.current.invitations = false;
          loadInvitations();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [loadInvitations, toast]);

  const handleDeleteSupplier = useCallback((s) => {
    setConfirmModal({
      title: "Delete Supplier",
      description: `Permanently delete "${s.COMPANY_NAME}"? All associated products, rankings, and performance metrics will be removed. This cannot be undone.`,
      onConfirm: async () => {
        try {
          await supplierManagementService.deleteSupplier(s.ID);
          toast.showSuccess("Supplier permanently deleted");
          fetchedRef.current.suppliers = false;
          loadSuppliers();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [loadSuppliers, toast]);

  const handleViewInvitationDetail = useCallback(async (inv) => {
    try {
      const res = await supplierManagementService.getInvitationDetail(inv.ID);
      setInvDetailModal(res.data);
    } catch {
      // If detail endpoint fails (e.g. approved status), show what we have
      setInvDetailModal(inv);
    }
  }, []);

  // ── Approvals ──────────────────────────────────────────────────────────
  const appPaginated = useMemo(
    () => approvals.slice((appPage - 1) * 25, appPage * 25),
    [approvals, appPage]
  );

  const handleApprove = useCallback(async (inv) => {
    setAppActing(true);
    try {
      await supplierManagementService.approveSupplier(inv.ID);
      toast.showSuccess("Supplier approved. Portal access granted.");
      setReviewModal(null);
      // Reload all three tabs
      fetchedRef.current.suppliers = false;
      fetchedRef.current.invitations = false;
      fetchedRef.current.approvals = false;
      loadSuppliers();
      loadInvitations();
      loadApprovals();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Approval failed");
    } finally {
      setAppActing(false);
    }
  }, [loadSuppliers, loadInvitations, loadApprovals, toast]);

  const handleReject = useCallback(async () => {
    if (!rejectForm.REJECTION_REASON.trim()) {
      toast.showWarning("Rejection reason is required");
      return;
    }
    setAppActing(true);
    try {
      await supplierManagementService.rejectSupplier(rejectModal.ID, rejectForm);
      toast.showInfo("Supplier application rejected");
      setRejectModal(null);
      setRejectForm(REJECT_EMPTY);
      fetchedRef.current.approvals = false;
      fetchedRef.current.invitations = false;
      loadApprovals();
      loadInvitations();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Rejection failed");
    } finally {
      setAppActing(false);
    }
  }, [rejectModal, rejectForm, loadApprovals, loadInvitations, toast]);

  const isRefreshing = (
    (activeTab === "suppliers" && suppRefreshing) ||
    (activeTab === "invitations" && invLoading) ||
    (activeTab === "approvals" && appLoading)
  );

  return (
    <div className={styles.page}>
      <PageHeader
        icon={SupplierIcon}
        iconAlt="Supplier Management"
        title="Supplier Management"
        subtitle="Manage suppliers, send onboarding invitations, and review registrations"
        onRefresh={handleRefresh}
        refreshing={isRefreshing}
        actions={
          activeTab === "suppliers" ? (
            <>
              <PMButton variant="ghost" onClick={handleDownloadTemplate}>Template</PMButton>
              <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
              <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
              <ExportButton onClick={handleExportSuppliers} disabled={filteredSuppliers.length === 0} />
              <PMButton variant="primary" onClick={openAddSupplier}>Add Supplier</PMButton>
            </>
          ) : activeTab === "invitations" ? (
            <PMButton variant="primary" onClick={() => setInvModal(true)}>Invite Supplier</PMButton>
          ) : null
        }
      />

      <StatsRow stats={suppStats} />

      {/* Tabs */}
      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            {t.key === "approvals" && approvals.length > 0 && (
              <span className={styles.tabBadge}>{approvals.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Suppliers ── */}
      {activeTab === "suppliers" && (
        <div className={styles.tableSection}>
          <div className={styles.toolbar}>
            <SearchBar
              value={suppSearch}
              onChange={(v) => { setSuppSearch(v); setSuppPage(1); }}
              placeholder="Search by name, email, phone, GST…"
            />
            <div className={styles.dateFilters}>
              <label className={styles.dateLabel}>From</label>
              <input type="datetime-local" className={styles.dateInput} value={suppFilterFrom} onChange={(e) => { setSuppFilterFrom(e.target.value); setSuppPage(1); }} />
              <label className={styles.dateLabel}>To</label>
              <input type="datetime-local" className={styles.dateInput} value={suppFilterTo} onChange={(e) => { setSuppFilterTo(e.target.value); setSuppPage(1); }} />
              {(suppFilterFrom || suppFilterTo) && (
                <button className={styles.clearFilter} onClick={() => { setSuppFilterFrom(""); setSuppFilterTo(""); }}>✕</button>
              )}
            </div>
            <span className={styles.count}>{filteredSuppliers.length} supplier{filteredSuppliers.length !== 1 ? "s" : ""}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>GST</th>
                  <th>Status</th>
                  <th>Created Date</th>
                  {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppLoading ? (
                  <tr><td colSpan={10 + cfFields.length}><Loader /></td></tr>
                ) : suppPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={10 + cfFields.length}>
                      <EmptyState
                        icon={SupplierIcon}
                        iconAlt="Suppliers"
                        title={suppSearch ? "No suppliers match your search" : "No suppliers yet"}
                        description={!suppSearch ? "Add a supplier or invite one via the Invitations tab." : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  suppPaginated.map((s, i) => (
                    <tr key={s.ID}>
                      <td className={styles.idx}>{(suppPage - 1) * suppPageSize + i + 1}</td>
                      <td className={styles.nameCell}>{s.COMPANY_NAME}</td>
                      <td className={styles.descCell}>{s.CONTACT_PERSON || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.monoCell}>{s.PHONE || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.descCell}>{s.EMAIL || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.monoCell}>{s.GST_NUMBER || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <span className={`${styles.badge} ${SUPPLIER_STATUS_COLORS[s.STATUS] || styles.badgeExpired}`}>
                          {s.STATUS || "—"}
                        </span>
                      </td>
                      <td className={styles.dateCell}>{formatDateTime(s.CREATED_AT)}</td>
                      {cfFields.map((f) => {
                        const val = cfValuesMap[String(s.ID)]?.[f.ID];
                        return (
                          <td key={f.ID} className={styles.descCell}>
                            {val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}
                          </td>
                        );
                      })}
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            className={styles.iconBtnDetails}
                            onClick={() => setProductsModal(s)}
                            title="View Products"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="3" width="20" height="14" rx="2" />
                              <path d="M8 21h8M12 17v4" />
                            </svg>
                          </button>
                          <button className={styles.iconBtn} onClick={() => openEditSupplier(s)} title="Edit">
                            <img src={EditIcon} alt="Edit" />
                          </button>
                          {s.STATUS === "BLACKLISTED" && (
                            <button className={styles.iconBtnDanger} onClick={() => handleDeleteSupplier(s)} title="Delete permanently">
                              <img src={DeleteIcon} alt="Delete" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={filteredSuppliers.length}
            page={suppPage}
            pageSize={suppPageSize}
            onPageChange={setSuppPage}
            onPageSizeChange={(n) => { setSuppPageSize(n); setSuppPage(1); }}
          />
        </div>
      )}

      {/* ── Tab: Invitations ── */}
      {activeTab === "invitations" && (
        <div className={styles.tableSection}>
          <div className={styles.toolbar}>
            <SearchBar
              value={invSearch}
              onChange={(v) => { setInvSearch(v); setInvPage(1); }}
              placeholder="Search by company or email…"
            />
            <div className={styles.dateFilters}>
              <select
                className={styles.dateFieldSelect}
                value={invFilterField}
                onChange={(e) => { setInvFilterField(e.target.value); setInvPage(1); }}
              >
                <option value="CREATED_AT">Created At</option>
                <option value="EMAIL_SENT_AT">Sent At</option>
                <option value="EXPIRES_AT">Expire At</option>
                <option value="SUBMITTED_AT">Submitted At</option>
                <option value="APPROVED_AT">Approved At</option>
                <option value="REJECTED_AT">Rejected At</option>
              </select>
              <label className={styles.dateLabel}>From</label>
              <input type="datetime-local" className={styles.dateInput} value={invFilterFrom} onChange={(e) => { setInvFilterFrom(e.target.value); setInvPage(1); }} />
              <label className={styles.dateLabel}>To</label>
              <input type="datetime-local" className={styles.dateInput} value={invFilterTo} onChange={(e) => { setInvFilterTo(e.target.value); setInvPage(1); }} />
              {(invFilterFrom || invFilterTo) && (
                <button className={styles.clearFilter} onClick={() => { setInvFilterFrom(""); setInvFilterTo(""); }}>✕</button>
              )}
            </div>
            <span className={styles.count}>{filteredInv.length} invitation{filteredInv.length !== 1 ? "s" : ""}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Company Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Sent At</th>
                  <th>Expires At</th>
                  <th>Created Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invLoading ? (
                  <tr><td colSpan={9}><Loader /></td></tr>
                ) : invPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={SupplierIcon}
                        iconAlt="Invitations"
                        title="No invitations yet"
                        description="Click 'Invite Supplier' to send the first invitation."
                      />
                    </td>
                  </tr>
                ) : (
                  invPaginated.map((inv, i) => (
                    <tr key={inv.ID}>
                      <td className={styles.idx}>{(invPage - 1) * 25 + i + 1}</td>
                      <td className={styles.nameCell}>{inv.INVITED_COMPANY_NAME || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.descCell}>{inv.INVITED_EMAIL}</td>
                      <td className={styles.monoCell}>{inv.INVITED_PHONE || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <span className={`${styles.badge} ${STATUS_COLORS[inv.STATUS] || styles.badgeExpired}`}>
                          {inv.STATUS?.replace("_", " ") || "—"}
                        </span>
                      </td>
                      <td className={styles.dateCell}>{formatDateTime(inv.EMAIL_SENT_AT)}</td>
                      <td className={styles.dateCell}>{formatDateTime(inv.EXPIRES_AT)}</td>
                      <td className={styles.dateCell}>{formatDateTime(inv.CREATED_AT)}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button className={styles.iconBtnDetails} onClick={() => handleViewInvitationDetail(inv)} title="View Details"><img src={DetailsIcon} alt="Details" /></button>
                          {["OPEN", "DRAFT_SAVED"].includes(inv.STATUS) && (
                            <>
                              <button
                                className={styles.actionBtn}
                                onClick={() => handleResend(inv.ID)}
                                disabled={resendingIds.has(inv.ID)}
                              >
                                {resendingIds.has(inv.ID) ? "Sending…" : "Resend"}
                              </button>
                              <button
                                className={styles.actionBtnDanger}
                                onClick={() => handleExpire(inv)}
                                disabled={expiringId === inv.ID}
                              >
                                {expiringId === inv.ID ? "Expiring…" : "Expire"}
                              </button>
                            </>
                          )}
                          {inv.STATUS === "EXPIRED" && (
                            <button className={styles.iconBtnDanger} onClick={() => handleDeleteInvitation(inv)} title="Delete">
                              <img src={DeleteIcon} alt="Delete" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={filteredInv.length}
            page={invPage}
            pageSize={25}
            onPageChange={setInvPage}
            onPageSizeChange={() => { }}
          />
        </div>
      )}

      {/* ── Tab: Pending Approvals ── */}
      {activeTab === "approvals" && (
        <div className={styles.tableSection}>
          <div className={styles.toolbar}>
            <span className={styles.count}>{approvals.length} pending review</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Company Name</th>
                  <th>Email</th>
                  <th>Submitted At</th>
                  <th>Products</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appLoading ? (
                  <tr><td colSpan={6}><Loader /></td></tr>
                ) : appPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        icon={SupplierIcon}
                        iconAlt="Approvals"
                        title="No pending approvals"
                        description="All supplier registrations have been reviewed."
                      />
                    </td>
                  </tr>
                ) : (
                  appPaginated.map((inv, i) => (
                    <tr key={inv.ID}>
                      <td className={styles.idx}>{(appPage - 1) * 25 + i + 1}</td>
                      <td className={styles.nameCell}>{inv.INVITED_COMPANY_NAME || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.descCell}>{inv.INVITED_EMAIL}</td>
                      <td className={styles.dateCell}>{inv.SUBMITTED_AT ? new Date(inv.SUBMITTED_AT).toLocaleDateString() : "—"}</td>
                      <td className={styles.centerCell}>
                        {inv.draft?.PRODUCTS_DATA?.length ?? 0}
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button className={styles.actionBtn} onClick={() => setReviewModal(inv)}>Review</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={approvals.length}
            page={appPage}
            pageSize={25}
            onPageChange={setAppPage}
            onPageSizeChange={() => { }}
          />
        </div>
      )}

      {/* ── Add/Edit Supplier Modal ── */}
      <PMModal
        open={!!suppModal}
        onClose={closeSuppModal}
        title={suppModal === "add" ? "Add Supplier" : "Edit Supplier"}
        size="lg"
        footer={
          <>
            <PMButton variant="outline" onClick={closeSuppModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSaveSupplier} disabled={suppSaving}>
              {suppSaving ? "Saving…" : suppModal === "add" ? "Create Supplier" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          {/* Company */}
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Company Name <span className={styles.req}>*</span></label>
            <input className={`${styles.input}${suppErrors.COMPANY_NAME ? " " + styles.inputError : ""}`} value={suppForm.COMPANY_NAME} onChange={(e) => handleSuppFormChange("COMPANY_NAME", e.target.value)} placeholder="e.g. Acme Industries Pvt. Ltd." />
            {suppErrors.COMPANY_NAME && <span className={styles.fieldError}>{suppErrors.COMPANY_NAME}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Registration No.</label>
            <input className={styles.input} value={suppForm.REGISTRATION_NO} onChange={(e) => handleSuppFormChange("REGISTRATION_NO", e.target.value)} placeholder="CIN / LLPIN" />
          </div>
          <div className={styles.formGroup}>
            <label>Company Type</label>
            <select className={styles.select} value={suppForm.COMPANY_TYPE} onChange={(e) => handleSuppFormChange("COMPANY_TYPE", e.target.value)}>
              <option value="">Select type…</option>
              {["Sole Proprietorship","Partnership","LLP","Private Limited","Public Limited","OPC","Co-operative","Government","Other"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label>GST Number</label>
            <input className={`${styles.input}${suppErrors.GST_NUMBER ? " " + styles.inputError : ""}`} value={suppForm.GST_NUMBER} onChange={(e) => handleSuppFormChange("GST_NUMBER", e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" maxLength={15} />
            {suppErrors.GST_NUMBER && <span className={styles.fieldError}>{suppErrors.GST_NUMBER}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>PAN Number</label>
            <input className={styles.input} value={suppForm.PAN_NUMBER} onChange={(e) => handleSuppFormChange("PAN_NUMBER", e.target.value.toUpperCase())} placeholder="AAAAA9999A" maxLength={10} />
          </div>
          {/* Address */}
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Address Line 1</label>
            <textarea className={styles.textarea} value={suppForm.ADDRESS_LINE1} onChange={(e) => handleSuppFormChange("ADDRESS_LINE1", e.target.value)} placeholder="Street address, building, area" rows={2} />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Address Line 2</label>
            <input className={styles.input} value={suppForm.ADDRESS_LINE2} onChange={(e) => handleSuppFormChange("ADDRESS_LINE2", e.target.value)} placeholder="Floor, suite, landmark (optional)" />
          </div>
          <div className={styles.formGroup}>
            <label>City</label>
            <input className={styles.input} value={suppForm.CITY} onChange={(e) => handleSuppFormChange("CITY", e.target.value)} placeholder="e.g. Mumbai" />
          </div>
          <div className={styles.formGroup}>
            <label>State</label>
            <input className={styles.input} value={suppForm.STATE} onChange={(e) => handleSuppFormChange("STATE", e.target.value)} placeholder="e.g. Maharashtra" />
          </div>
          <div className={styles.formGroup}>
            <label>PIN Code</label>
            <input className={styles.input} value={suppForm.PINCODE} onChange={(e) => handleSuppFormChange("PINCODE", e.target.value)} placeholder="400001" maxLength={6} />
          </div>
          {/* Contact */}
          <div className={styles.formGroup}>
            <label>Contact Person</label>
            <input className={styles.input} value={suppForm.CONTACT_PERSON} onChange={(e) => handleSuppFormChange("CONTACT_PERSON", e.target.value)} placeholder="Primary contact name" />
          </div>
          <div className={styles.formGroup}>
            <label>Phone</label>
            <input className={`${styles.input}${suppErrors.PHONE ? " " + styles.inputError : ""}`} value={suppForm.PHONE} onChange={(e) => handleSuppFormChange("PHONE", e.target.value)} placeholder="+91 9XXXXXXXXX" />
            {suppErrors.PHONE && <span className={styles.fieldError}>{suppErrors.PHONE}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Email</label>
            <input className={`${styles.input}${suppErrors.EMAIL ? " " + styles.inputError : ""}`} type="email" value={suppForm.EMAIL} onChange={(e) => handleSuppFormChange("EMAIL", e.target.value)} placeholder="supplier@company.com" />
            {suppErrors.EMAIL && <span className={styles.fieldError}>{suppErrors.EMAIL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Alternate Email</label>
            <input className={`${styles.input}${suppErrors.ALTERNATE_EMAIL ? " " + styles.inputError : ""}`} type="email" value={suppForm.ALTERNATE_EMAIL} onChange={(e) => handleSuppFormChange("ALTERNATE_EMAIL", e.target.value)} placeholder="alt@company.com" />
            {suppErrors.ALTERNATE_EMAIL && <span className={styles.fieldError}>{suppErrors.ALTERNATE_EMAIL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Alternate Phone</label>
            <input className={`${styles.input}${suppErrors.ALTERNATE_PHONE ? " " + styles.inputError : ""}`} value={suppForm.ALTERNATE_PHONE} onChange={(e) => handleSuppFormChange("ALTERNATE_PHONE", e.target.value)} placeholder="+91 9XXXXXXXXX" />
            {suppErrors.ALTERNATE_PHONE && <span className={styles.fieldError}>{suppErrors.ALTERNATE_PHONE}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Website</label>
            <input className={`${styles.input}${suppErrors.WEBSITE ? " " + styles.inputError : ""}`} value={suppForm.WEBSITE} onChange={(e) => handleSuppFormChange("WEBSITE", e.target.value)} placeholder="https://supplier.com" />
            {suppErrors.WEBSITE && <span className={styles.fieldError}>{suppErrors.WEBSITE}</span>}
          </div>
          {/* Business */}
          <div className={styles.formGroup}>
            <label>Years in Business</label>
            <input className={styles.input} type="number" min={0} value={suppForm.YEARS_IN_BUSINESS} onChange={(e) => handleSuppFormChange("YEARS_IN_BUSINESS", e.target.value)} placeholder="e.g. 10" />
          </div>
          <div className={styles.formGroup}>
            <label>Annual Turnover (₹)</label>
            <input className={styles.input} type="number" min={0} value={suppForm.ANNUAL_TURNOVER} onChange={(e) => handleSuppFormChange("ANNUAL_TURNOVER", e.target.value)} placeholder="e.g. 5000000" />
          </div>
          <div className={styles.formGroup}>
            <label>Employee Count</label>
            <input className={styles.input} type="number" min={0} step={1} value={suppForm.EMPLOYEE_COUNT} onChange={(e) => handleSuppFormChange("EMPLOYEE_COUNT", e.target.value)} placeholder="e.g. 50" />
          </div>
          <div className={styles.formGroup}>
            <label>Category</label>
            <input className={styles.input} value={suppForm.CATEGORY} onChange={(e) => handleSuppFormChange("CATEGORY", e.target.value)} placeholder="e.g. Electrical, Civil" />
          </div>
          {/* Financials */}
          <div className={styles.formGroup}>
            <label>Advance %</label>
            <input className={`${styles.input}${suppErrors.ADVANCE_PERCENT ? " " + styles.inputError : ""}`} type="number" min={0} max={100} value={suppForm.ADVANCE_PERCENT} onChange={(e) => handleSuppFormChange("ADVANCE_PERCENT", parseFloat(e.target.value) || 0)} />
            {suppErrors.ADVANCE_PERCENT && <span className={styles.fieldError}>{suppErrors.ADVANCE_PERCENT}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Credit Days</label>
            <input className={`${styles.input}${suppErrors.CREDIT_DAYS ? " " + styles.inputError : ""}`} type="number" min={0} value={suppForm.CREDIT_DAYS} onChange={(e) => handleSuppFormChange("CREDIT_DAYS", parseInt(e.target.value, 10) || 0)} />
            {suppErrors.CREDIT_DAYS && <span className={styles.fieldError}>{suppErrors.CREDIT_DAYS}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Min. Order Value (₹)</label>
            <input className={styles.input} type="number" min={0} value={suppForm.MINIMUM_ORDER_VALUE} onChange={(e) => handleSuppFormChange("MINIMUM_ORDER_VALUE", parseFloat(e.target.value) || 0)} />
          </div>
          <div className={styles.formGroup}>
            <label>Lead Time (days)</label>
            <input className={`${styles.input}${suppErrors.LEAD_TIME_DAYS ? " " + styles.inputError : ""}`} type="number" min={0} value={suppForm.LEAD_TIME_DAYS} onChange={(e) => handleSuppFormChange("LEAD_TIME_DAYS", parseInt(e.target.value, 10) || 0)} />
            {suppErrors.LEAD_TIME_DAYS && <span className={styles.fieldError}>{suppErrors.LEAD_TIME_DAYS}</span>}
          </div>
          {/* Banking */}
          <div className={styles.formGroup}>
            <label>Bank Name</label>
            <input className={styles.input} value={suppForm.BANK_NAME} onChange={(e) => handleSuppFormChange("BANK_NAME", e.target.value)} placeholder="e.g. State Bank of India" />
          </div>
          <div className={styles.formGroup}>
            <label>Account Number</label>
            <input className={styles.input} value={suppForm.ACCOUNT_NUMBER} onChange={(e) => handleSuppFormChange("ACCOUNT_NUMBER", e.target.value)} placeholder="Bank account number" />
          </div>
          <div className={styles.formGroup}>
            <label>IFSC Code</label>
            <input className={styles.input} value={suppForm.IFSC_CODE} onChange={(e) => handleSuppFormChange("IFSC_CODE", e.target.value.toUpperCase())} placeholder="SBIN0001234" maxLength={11} />
          </div>
          <div className={styles.formGroup}>
            <label>Payment Terms</label>
            <select className={styles.select} value={suppForm.PAYMENT_TERMS} onChange={(e) => handleSuppFormChange("PAYMENT_TERMS", e.target.value)}>
              <option value="">Select terms…</option>
              {["Advance","NET 15","NET 30","NET 45","NET 60","COD"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {/* Status & Notes */}
          <div className={styles.formGroup}>
            <label>Status <span className={styles.req}>*</span></label>
            <select className={styles.select} value={suppForm.STATUS} onChange={(e) => handleSuppFormChange("STATUS", e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="BLACKLISTED">Blacklisted</option>
            </select>
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Notes</label>
            <textarea className={styles.textarea} value={suppForm.NOTES} onChange={(e) => handleSuppFormChange("NOTES", e.target.value)} placeholder="Internal notes about this supplier" rows={2} />
          </div>
        </div>
        <CustomFieldsSection fields={cfFields} values={cfValues} onChange={handleCfChange} />
      </PMModal>

      {/* ── Invite Supplier Modal ── */}
      <PMModal
        open={invModal}
        onClose={() => { setInvModal(false); setInvForm(INVITE_EMPTY_FORM); setInvErrors({}); }}
        title="Invite Supplier"
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => { setInvModal(false); setInvForm(INVITE_EMPTY_FORM); setInvErrors({}); }}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSendInvite} disabled={invSaving}>
              {invSaving ? "Sending…" : "Send Invitation"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Company Name <span className={styles.req}>*</span></label>
            <input className={`${styles.input}${invErrors.INVITED_COMPANY_NAME ? " " + styles.inputError : ""}`} value={invForm.INVITED_COMPANY_NAME} onChange={(e) => { setInvForm((p) => ({ ...p, INVITED_COMPANY_NAME: e.target.value })); clearFieldError(setInvErrors, "INVITED_COMPANY_NAME"); }} placeholder="e.g. Acme Industries" />
            {invErrors.INVITED_COMPANY_NAME && <span className={styles.fieldError}>{invErrors.INVITED_COMPANY_NAME}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Email <span className={styles.req}>*</span></label>
            <input className={`${styles.input}${invErrors.INVITED_EMAIL ? " " + styles.inputError : ""}`} type="email" value={invForm.INVITED_EMAIL} onChange={(e) => { setInvForm((p) => ({ ...p, INVITED_EMAIL: e.target.value })); clearFieldError(setInvErrors, "INVITED_EMAIL"); }} placeholder="contact@supplier.com" />
            {invErrors.INVITED_EMAIL && <span className={styles.fieldError}>{invErrors.INVITED_EMAIL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Phone</label>
            <input className={`${styles.input}${invErrors.INVITED_PHONE ? " " + styles.inputError : ""}`} value={invForm.INVITED_PHONE} onChange={(e) => { setInvForm((p) => ({ ...p, INVITED_PHONE: e.target.value })); clearFieldError(setInvErrors, "INVITED_PHONE"); }} placeholder="+91 9XXXXXXXXX" />
            {invErrors.INVITED_PHONE && <span className={styles.fieldError}>{invErrors.INVITED_PHONE}</span>}
          </div>
        </div>
        <p className={styles.inviteNote}>
          An invitation email with a secure registration link will be sent. The supplier can complete their profile and add products at their own pace.
        </p>
      </PMModal>

      {/* ── Review Modal ── */}
      <ReviewModal
        open={!!reviewModal}
        onClose={() => setReviewModal(null)}
        data={reviewModal}
        onApprove={handleApprove}
        onReject={() => { setRejectModal(reviewModal); setReviewModal(null); }}
        appActing={appActing}
      />

      {/* ── Reject Modal ── */}
      <RejectModal
        open={!!rejectModal}
        onClose={() => { setRejectModal(null); setRejectForm(REJECT_EMPTY); }}
        form={rejectForm}
        onChange={(v) => setRejectForm({ REJECTION_REASON: v })}
        onConfirm={handleReject}
        acting={appActing}
      />

      {/* ── Bulk Upload Modal ── */}
      <PMModal open={bulkModal} onClose={() => setBulkModal(false)} title="Bulk Upload Suppliers" size="sm">
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Suppliers"</strong> and columns:{" "}
          <strong>Name</strong>, <strong>Contact Person</strong>, <strong>Phone</strong>, <strong>Email</strong>, <strong>GST Number</strong>
          {cfFields.length > 0 && <>, plus any custom fields</>}.
        </p>
        <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
          <span className={styles.dropIconWrap}><img src={UploadIcon} alt="Upload" /></span>
          <span>{bulkFile ? bulkFile.name : "Click to browse or drop Excel (.xlsx)"}</span>
          {bulkUploading && <span>Uploading…</span>}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFileChange} />
        {uploadResult && (
          <div className={styles.uploadResult}>
            <div className={styles.resultStats}>
              <div className={styles.resultStat}><span className={styles.statValue}>{uploadResult.inserted ?? 0}</span><span className={styles.statLabel}>Inserted</span></div>
              <div className={styles.resultStat}><span className={styles.statValue}>{uploadResult.updated ?? 0}</span><span className={styles.statLabel}>Updated</span></div>
              <div className={styles.resultStat}><span className={styles.statValue}>{uploadResult.skipped ?? 0}</span><span className={styles.statLabel}>Skipped</span></div>
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

      {/* ── Invitation Detail Modal ── */}
      <InvitationDetailModal
        open={!!invDetailModal}
        onClose={() => setInvDetailModal(null)}
        data={invDetailModal}
      />

      {/* Custom Fields Config Modal */}
      <CustomFieldsModal open={cfOpen} onClose={() => setCfOpen(false)} tableName="inventory_supplier_details" />

      {/* Confirm Modal */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => { })}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
      />

      {/* ── Supplier Products Modal ── */}
      <SupplierProductModal
        open={!!productsModal}
        onClose={() => setProductsModal(null)}
        supplier={productsModal}
      />
    </div>
  );
}
