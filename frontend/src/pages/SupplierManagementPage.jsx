import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { supplierManagementService } from "../services/supplierManagementService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import SupplierIcon from "../assets/Icons/supplierIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./SupplierManagementPage.module.css";

const SUPPLIER_EMPTY_FORM = {
  NAME: "", CONTACT_PERSON: "", PHONE: "", EMAIL: "", ADDRESS: "",
  GST_NUMBER: "", CATEGORY: "", STATUS: "ACTIVE",
  WEBSITE: "", CREDIT_DAYS: 30, LEAD_TIME_DAYS: 7, ADVANCE_PERCENT: 0,
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
  const [suppForm, setSuppForm] = useState(SUPPLIER_EMPTY_FORM);
  const [suppSaving, setSuppSaving] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();
  const [confirmModal, setConfirmModal] = useState(null);

  // Invitations tab state
  const [invitations, setInvitations] = useState([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invSearch, setInvSearch] = useState("");
  const [invPage, setInvPage] = useState(1);
  const [invModal, setInvModal] = useState(false);
  const [invForm, setInvForm] = useState(INVITE_EMPTY_FORM);
  const [invSaving, setInvSaving] = useState(false);

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
    if (!suppSearch.trim()) return suppliers;
    const t = suppSearch.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.NAME?.toLowerCase().includes(t) ||
        (s.CONTACT_PERSON || "").toLowerCase().includes(t) ||
        (s.EMAIL || "").toLowerCase().includes(t) ||
        (s.PHONE || "").toLowerCase().includes(t) ||
        (s.GST_NUMBER || "").toLowerCase().includes(t)
    );
  }, [suppliers, suppSearch]);

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
      NAME: s.NAME || "",
      CONTACT_PERSON: s.CONTACT_PERSON || "",
      PHONE: s.PHONE || "",
      EMAIL: s.EMAIL || "",
      ADDRESS: s.ADDRESS || "",
      GST_NUMBER: s.GST_NUMBER || "",
      CATEGORY: s.CATEGORY || "",
      STATUS: s.STATUS || "ACTIVE",
      WEBSITE: s.WEBSITE || "",
      CREDIT_DAYS: s.CREDIT_DAYS ?? 30,
      LEAD_TIME_DAYS: s.LEAD_TIME_DAYS ?? 7,
      ADVANCE_PERCENT: s.ADVANCE_PERCENT ?? 0,
    });
    setSelectedSupplier(s);
    setSuppModal("edit");
    loadCfValues(s.ID);
  }, [loadCfValues]);

  const closeSuppModal = useCallback(() => {
    setSuppModal(null);
    setSelectedSupplier(null);
  }, []);

  const handleSuppFormChange = useCallback((field, val) => {
    setSuppForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  const handleSaveSupplier = useCallback(async () => {
    if (!suppForm.NAME.trim()) {
      toast.showWarning("Supplier name is required");
      return;
    }
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
        Name: s.NAME,
        "Contact Person": s.CONTACT_PERSON || "",
        Phone: s.PHONE || "",
        Email: s.EMAIL || "",
        "GST Number": s.GST_NUMBER || "",
        Category: s.CATEGORY || "",
        Status: s.STATUS || "",
        Address: s.ADDRESS || "",
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
    if (!invSearch.trim()) return invitations;
    const t = invSearch.toLowerCase();
    return invitations.filter(
      (i) =>
        (i.INVITED_COMPANY_NAME || "").toLowerCase().includes(t) ||
        (i.INVITED_EMAIL || "").toLowerCase().includes(t)
    );
  }, [invitations, invSearch]);

  const invPaginated = useMemo(
    () => filteredInv.slice((invPage - 1) * 25, invPage * 25),
    [filteredInv, invPage]
  );

  const handleSendInvite = useCallback(async () => {
    if (!invForm.INVITED_COMPANY_NAME.trim() || !invForm.INVITED_EMAIL.trim()) {
      toast.showWarning("Company name and email are required");
      return;
    }
    setInvSaving(true);
    try {
      await supplierManagementService.sendInvitation(invForm);
      toast.showSuccess("Invitation sent");
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

  const handleResend = useCallback(async (id) => {
    try {
      await supplierManagementService.resendInvitation(id);
      toast.showSuccess("Invitation resent");
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Resend failed");
    }
  }, [toast]);

  const handleExpire = useCallback((inv) => {
    setConfirmModal({
      title: "Expire Invitation",
      description: `Expire invitation for "${inv.INVITED_COMPANY_NAME}"? The registration link will no longer work.`,
      onConfirm: async () => {
        try {
          await supplierManagementService.expireInvitation(inv.ID);
          toast.showSuccess("Invitation expired");
          fetchedRef.current.invitations = false;
          loadInvitations();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Failed to expire");
        }
      },
    });
  }, [loadInvitations, toast]);

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
                  {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppLoading ? (
                  <tr><td colSpan={9 + cfFields.length}><Loader /></td></tr>
                ) : suppPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={9 + cfFields.length}>
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
                      <td className={styles.nameCell}>{s.NAME}</td>
                      <td className={styles.descCell}>{s.CONTACT_PERSON || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.monoCell}>{s.PHONE || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.descCell}>{s.EMAIL || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.monoCell}>{s.GST_NUMBER || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <span className={`${styles.badge} ${SUPPLIER_STATUS_COLORS[s.STATUS] || styles.badgeExpired}`}>
                          {s.STATUS || "—"}
                        </span>
                      </td>
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
                          <button className={styles.iconBtn} onClick={() => openEditSupplier(s)} title="Edit">
                            <img src={EditIcon} alt="Edit" />
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invLoading ? (
                  <tr><td colSpan={8}><Loader /></td></tr>
                ) : invPaginated.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
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
                      <td className={styles.dateCell}>{inv.EMAIL_SENT_AT ? new Date(inv.EMAIL_SENT_AT).toLocaleDateString() : "—"}</td>
                      <td className={styles.dateCell}>{inv.EXPIRES_AT ? new Date(inv.EXPIRES_AT).toLocaleDateString() : "—"}</td>
                      <td>
                        <div className={styles.rowActions}>
                          {["OPEN", "DRAFT_SAVED"].includes(inv.STATUS) && (
                            <>
                              <button className={styles.actionBtn} onClick={() => handleResend(inv.ID)}>Resend</button>
                              <button className={styles.actionBtnDanger} onClick={() => handleExpire(inv)}>Expire</button>
                            </>
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
        size="md"
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
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Supplier Name <span className={styles.req}>*</span></label>
            <input className={styles.input} value={suppForm.NAME} onChange={(e) => handleSuppFormChange("NAME", e.target.value)} placeholder="e.g. Acme Industries Pvt. Ltd." />
          </div>
          <div className={styles.formGroup}>
            <label>Contact Person</label>
            <input className={styles.input} value={suppForm.CONTACT_PERSON} onChange={(e) => handleSuppFormChange("CONTACT_PERSON", e.target.value)} placeholder="Primary contact name" />
          </div>
          <div className={styles.formGroup}>
            <label>Phone</label>
            <input className={styles.input} value={suppForm.PHONE} onChange={(e) => handleSuppFormChange("PHONE", e.target.value)} placeholder="+91 9XXXXXXXXX" />
          </div>
          <div className={styles.formGroup}>
            <label>Email</label>
            <input className={styles.input} type="email" value={suppForm.EMAIL} onChange={(e) => handleSuppFormChange("EMAIL", e.target.value)} placeholder="supplier@company.com" />
          </div>
          <div className={styles.formGroup}>
            <label>GST Number</label>
            <input className={styles.input} value={suppForm.GST_NUMBER} onChange={(e) => handleSuppFormChange("GST_NUMBER", e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" maxLength={15} />
          </div>
          <div className={styles.formGroup}>
            <label>Category</label>
            <input className={styles.input} value={suppForm.CATEGORY} onChange={(e) => handleSuppFormChange("CATEGORY", e.target.value)} placeholder="e.g. Electrical, Civil" />
          </div>
          <div className={styles.formGroup}>
            <label>Website</label>
            <input className={styles.input} value={suppForm.WEBSITE} onChange={(e) => handleSuppFormChange("WEBSITE", e.target.value)} placeholder="https://supplier.com" />
          </div>
          <div className={styles.formGroup}>
            <label>Credit Days</label>
            <input className={styles.input} type="number" min={0} value={suppForm.CREDIT_DAYS} onChange={(e) => handleSuppFormChange("CREDIT_DAYS", parseInt(e.target.value, 10) || 0)} />
          </div>
          <div className={styles.formGroup}>
            <label>Lead Time (days)</label>
            <input className={styles.input} type="number" min={0} value={suppForm.LEAD_TIME_DAYS} onChange={(e) => handleSuppFormChange("LEAD_TIME_DAYS", parseInt(e.target.value, 10) || 0)} />
          </div>
          <div className={styles.formGroup}>
            <label>Advance %</label>
            <input className={styles.input} type="number" min={0} max={100} value={suppForm.ADVANCE_PERCENT} onChange={(e) => handleSuppFormChange("ADVANCE_PERCENT", parseFloat(e.target.value) || 0)} />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Address</label>
            <textarea className={styles.textarea} value={suppForm.ADDRESS} onChange={(e) => handleSuppFormChange("ADDRESS", e.target.value)} placeholder="Full business address" rows={3} />
          </div>
        </div>
        <CustomFieldsSection fields={cfFields} values={cfValues} onChange={handleCfChange} />
      </PMModal>

      {/* ── Invite Supplier Modal ── */}
      <PMModal
        open={invModal}
        onClose={() => { setInvModal(false); setInvForm(INVITE_EMPTY_FORM); }}
        title="Invite Supplier"
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => { setInvModal(false); setInvForm(INVITE_EMPTY_FORM); }}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSendInvite} disabled={invSaving}>
              {invSaving ? "Sending…" : "Send Invitation"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Company Name <span className={styles.req}>*</span></label>
            <input className={styles.input} value={invForm.INVITED_COMPANY_NAME} onChange={(e) => setInvForm((p) => ({ ...p, INVITED_COMPANY_NAME: e.target.value }))} placeholder="e.g. Acme Industries" />
          </div>
          <div className={styles.formGroup}>
            <label>Email <span className={styles.req}>*</span></label>
            <input className={styles.input} type="email" value={invForm.INVITED_EMAIL} onChange={(e) => setInvForm((p) => ({ ...p, INVITED_EMAIL: e.target.value }))} placeholder="contact@supplier.com" />
          </div>
          <div className={styles.formGroup}>
            <label>Phone</label>
            <input className={styles.input} value={invForm.INVITED_PHONE} onChange={(e) => setInvForm((p) => ({ ...p, INVITED_PHONE: e.target.value }))} placeholder="+91 9XXXXXXXXX" />
          </div>
        </div>
        <p className={styles.inviteNote}>
          An invitation email with a secure registration link will be sent. The supplier can complete their profile and add products at their own pace.
        </p>
      </PMModal>

      {/* ── Review Modal ── */}
      <PMModal
        open={!!reviewModal}
        onClose={() => setReviewModal(null)}
        title="Review Supplier Registration"
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setReviewModal(null)}>Close</PMButton>
            <PMButton variant="ghost" onClick={() => { setRejectModal(reviewModal); setReviewModal(null); }}>Reject</PMButton>
            <PMButton variant="primary" onClick={() => handleApprove(reviewModal)} disabled={appActing}>
              {appActing ? "Approving…" : "Approve & Activate"}
            </PMButton>
          </>
        }
      >
        {reviewModal && (
          <div className={styles.reviewBody}>
            <div className={styles.reviewSection}>
              <p className={styles.reviewLabel}>Company</p>
              <p className={styles.reviewValue}>{reviewModal.INVITED_COMPANY_NAME}</p>
            </div>
            <div className={styles.reviewSection}>
              <p className={styles.reviewLabel}>Email</p>
              <p className={styles.reviewValue}>{reviewModal.INVITED_EMAIL}</p>
            </div>
            <div className={styles.reviewSection}>
              <p className={styles.reviewLabel}>Submitted</p>
              <p className={styles.reviewValue}>{reviewModal.SUBMITTED_AT ? new Date(reviewModal.SUBMITTED_AT).toLocaleString() : "—"}</p>
            </div>
            {reviewModal.draft?.FORM_DATA && (
              <div className={styles.reviewSection}>
                <p className={styles.reviewLabel}>Registration Data</p>
                <div className={styles.formDataGrid}>
                  {Object.entries(reviewModal.draft.FORM_DATA).map(([k, v]) => (
                    v ? <div key={k} className={styles.formDataItem}><span className={styles.fdKey}>{k.replace(/_/g, " ")}</span><span className={styles.fdVal}>{String(v)}</span></div> : null
                  ))}
                </div>
              </div>
            )}
            {reviewModal.draft?.PRODUCTS_DATA?.length > 0 && (
              <div className={styles.reviewSection}>
                <p className={styles.reviewLabel}>Products Registered ({reviewModal.draft.PRODUCTS_DATA.length})</p>
                <div className={styles.productsList}>
                  {reviewModal.draft.PRODUCTS_DATA.map((p, i) => (
                    <div key={i} className={styles.productItem}>
                      <span className={styles.productName}>{p.PRODUCT_NAME || p.PRODUCT_ID}</span>
                      <span className={styles.productPrice}>₹{Number(p.UNIT_PRICE || 0).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </PMModal>

      {/* ── Reject Modal ── */}
      <PMModal
        open={!!rejectModal}
        onClose={() => { setRejectModal(null); setRejectForm(REJECT_EMPTY); }}
        title="Reject Registration"
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => { setRejectModal(null); setRejectForm(REJECT_EMPTY); }}>Cancel</PMButton>
            <PMButton variant="danger" onClick={handleReject} disabled={appActing}>
              {appActing ? "Rejecting…" : "Reject Application"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Rejection Reason <span className={styles.req}>*</span></label>
            <textarea
              className={styles.textarea}
              value={rejectForm.REJECTION_REASON}
              onChange={(e) => setRejectForm({ REJECTION_REASON: e.target.value })}
              placeholder="Explain why this registration is being rejected…"
              rows={4}
            />
          </div>
        </div>
      </PMModal>

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
    </div>
  );
}
