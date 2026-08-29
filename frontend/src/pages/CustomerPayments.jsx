import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PageHeader, PMModal, PMButton, PMSelect, PMConfirmModal, EmptyState, Loader,
} from "../components/pm";
import { customerMasterService } from "../services/customerMasterService";
import { customerPaymentService } from "../services/customerPaymentService";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import CustomerIcon from "../assets/Icons/employee.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import styles from "./CustomerPayments.module.css";

const EMPTY_FORM = {
  assignmentId: "", amount: "", date: "", referenceNumber: "", comments: "",
};

function formatAmount(v) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// PAYMENT_DATE arrives as a naive IST datetime string (no timezone suffix,
// e.g. "2026-08-15T14:30:00") — the same convention formatDateTime() already
// relies on elsewhere. A JS Date parses a timezone-less ISO string as local
// time, so as long as the admin's browser is IST (the expected case for this
// ERP) this round-trips exactly — no manual offset math needed.
function toDatetimeLocalValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Rich, searchable Lead/Project picker for the Customer Payments page —
 * a bespoke, page-scoped dropdown (not the shared PMSelect) because PMSelect
 * only renders a single plain-text label per option, and this filter needs
 * a clear Lead | Project | Assigned-date table so a customer with the same
 * Project via multiple Leads (or multiple Leads at different dates) stays
 * distinguishable. Mirrors PMSelect's trigger/portorder-less-dropdown/
 * search-input visual language (same CSS custom properties, same close-on-
 * outside-click/Escape behavior) for consistency, scoped locally so no
 * other PMSelect consumer is touched. */
function AssignmentFilterSelect({ assignments, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) =>
      (a.lead_contact_name || "").toLowerCase().includes(q) ||
      (a.lead_company_name || "").toLowerCase().includes(q) ||
      (a.project_name || "").toLowerCase().includes(q)
    );
  }, [assignments, search]);

  const selected = assignments.find((a) => a.assignment_id === value);
  const selectedLabel = selected
    ? `${selected.lead_contact_name || "—"} · ${selected.project_name || "—"}`
    : "";

  return (
    <div className={styles.apWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.apTrigger}
        onClick={() => { setOpen((o) => !o); setSearch(""); }}
      >
        <span className={value ? styles.apTriggerValue : styles.apTriggerPlaceholder}>
          {value ? selectedLabel : "— All Leads/Projects —"}
        </span>
        <svg className={styles.apChevron} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={styles.apDropdown}>
          <div className={styles.apSearchWrap}>
            <input
              ref={searchRef}
              type="text"
              className={styles.apSearchInput}
              placeholder="Search by lead name, company, or project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={styles.apAllOption} onMouseDown={() => { onChange(""); setOpen(false); }}>
            — All Leads/Projects —
          </div>
          <div className={styles.apTableHead}>
            <span>Lead</span>
            <span>Project</span>
            <span>Qty</span>
            <span>Assigned</span>
          </div>
          <ul className={styles.apList}>
            {filtered.length === 0 ? (
              <li className={styles.apNoMatch}>No matches</li>
            ) : (
              filtered.map((a) => (
                <li
                  key={a.assignment_id}
                  className={`${styles.apOption} ${a.assignment_id === value ? styles.apOptionSelected : ""}`}
                  onMouseDown={() => { onChange(a.assignment_id); setOpen(false); }}
                >
                  <div className={styles.apOptionLead}>
                    <span className={styles.apOptionLeadName}>{a.lead_contact_name || "—"}</span>
                    {a.lead_company_name && <span className={styles.apOptionLeadCompany}>{a.lead_company_name}</span>}
                  </div>
                  <span className={styles.apOptionProject}>{a.project_name || "—"}</span>
                  <span className={styles.apOptionDate}>{a.quantity ?? 1}</span>
                  <span className={styles.apOptionDate}>{formatDateTime(a.assignment_created_at)}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Accounts-facing Customer Payments page — search a customer, see every
 * Lead/Project assignment they have with the accepted quotation amount,
 * payment totals, and individual payment records; record a manual payment
 * for cases outside the customer's own upload flow. Mirrors CustomerMaster/
 * TaskTemplatePage's PageHeader + selector-card + body shape for UI
 * consistency, with per-assignment cards instead of a flat table since each
 * Lead/Project needs its own summary + payment history block. */
export default function CustomerPayments() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const preselectCustomerId = searchParams.get("customer_id");

  const canManualAdd = hasPermission("customer.payments.manual_add");
  const canUpdate = hasPermission("customer.payments.update");
  const canDelete = hasPermission("customer.payments.delete");
  const canViewProof = hasPermission("customer.payments.view_proof");

  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(preselectCustomerId || "");
  const [selectedAssignment, setSelectedAssignment] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const [manualModal, setManualModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [proofFile, setProofFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [viewingProofId, setViewingProofId] = useState(null);
  const fileRef = useRef();

  const [editPayment, setEditPayment] = useState(null);
  const [editForm, setEditForm] = useState({ amount: "", date: "", referenceNumber: "", comments: "" });
  const [editProofFile, setEditProofFile] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const editFileRef = useRef();

  // Staff-maintained Project Completion % (see payment_milestone_service) —
  // per-assignment in-progress edit value, keyed by assignment_id; absent
  // key = not currently being edited (shows the saved value instead).
  const [completionEdits, setCompletionEdits] = useState({});
  const [savingCompletion, setSavingCompletion] = useState({});

  const metaFetched = useRef(false);
  useEffect(() => {
    if (metaFetched.current) return;
    metaFetched.current = true;
    customerMasterService.getAll().then((res) => {
      setCustomers(res.data?.rows || res.data || []);
    }).catch(() => { /* silent */ });
  }, []);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      ID: c.ID,
      DISPLAY_LABEL: c.COMPANY_NAME ? `${c.NAME} — ${c.COMPANY_NAME}` : c.NAME,
    })),
    [customers]
  );

  const assignmentOptions = useMemo(
    () => (data?.assignments || []).map((a) => ({
      value: a.assignment_id,
      label: `${a.project_name || "—"}${a.lead_contact_name ? ` (${a.lead_contact_name})` : ""}`,
    })),
    [data]
  );

  const visibleAssignments = useMemo(() => {
    const all = data?.assignments || [];
    if (!selectedAssignment) return all;
    return all.filter((a) => a.assignment_id === selectedAssignment);
  }, [data, selectedAssignment]);

  const load = useCallback(async (custId) => {
    if (!custId) { setData(null); return; }
    setLoading(true);
    try {
      const res = await customerPaymentService.getByCustomer(custId);
      setData(res.data);
    } catch {
      toast.showError("Failed to load customer payments");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // `load` is intentionally excluded from the deps below — it's a
  // useCallback that depends on `toast`, which useToast() recreates on
  // every render (a new reference each time, never memoized). Depending on
  // `load` here would re-run this effect on every render (new toast -> new
  // load -> effect fires -> setLoading -> render -> new toast -> ...),
  // which is exactly what was causing the loader to flicker/reload forever.
  // Matches the same documented pattern in LeadQuotationModal.jsx.
  const handleCompletionSave = useCallback(async (assignmentId) => {
    const raw = completionEdits[assignmentId];
    const pct = parseFloat(raw);
    if (raw === undefined || Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.showWarning("Project Completion Percentage must be between 0 and 100");
      return;
    }
    setSavingCompletion((prev) => ({ ...prev, [assignmentId]: true }));
    try {
      await customerPaymentService.updateCompletion(assignmentId, pct);
      toast.showSuccess("Project completion updated");
      setCompletionEdits((prev) => {
        const next = { ...prev };
        delete next[assignmentId];
        return next;
      });
      load(selectedCustomer);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to update project completion");
    } finally {
      setSavingCompletion((prev) => ({ ...prev, [assignmentId]: false }));
    }
  }, [completionEdits, selectedCustomer, load, toast]);

  useEffect(() => {
    setSelectedAssignment("");
    load(selectedCustomer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer]);

  const openManualEntry = useCallback((assignmentId = "") => {
    setForm({ ...EMPTY_FORM, assignmentId });
    setProofFile(null);
    setManualModal(true);
  }, []);

  const closeManualEntry = useCallback(() => { setManualModal(false); }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  const handleSaveManual = useCallback(async () => {
    if (!form.assignmentId) { toast.showWarning("Select a Lead / Project first"); return; }
    const amount = parseFloat(form.amount);
    if (Number.isNaN(amount) || amount <= 0) { toast.showWarning("Enter a valid payment amount"); return; }
    if (!form.date) { toast.showWarning("Payment date/time is required"); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("amount", String(amount));
      fd.append("payment_date", form.date);
      if (form.referenceNumber.trim()) fd.append("reference_number", form.referenceNumber.trim());
      if (form.comments.trim()) fd.append("comments", form.comments.trim());
      if (proofFile) fd.append("proof", proofFile);

      await customerPaymentService.addManual(form.assignmentId, fd);
      toast.showSuccess("Payment recorded");
      closeManualEntry();
      load(selectedCustomer);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to record payment");
    } finally {
      setSaving(false);
    }
  }, [form, proofFile, toast, closeManualEntry, load, selectedCustomer]);

  const openEditPayment = useCallback((payment) => {
    setEditPayment(payment);
    setEditForm({
      amount: payment.PAYMENT_AMOUNT != null ? String(payment.PAYMENT_AMOUNT) : "",
      date: toDatetimeLocalValue(payment.PAYMENT_DATE),
      referenceNumber: payment.PAYMENT_REFERENCE_NUMBER || "",
      comments: payment.COMMENTS || "",
    });
    setEditProofFile(null);
  }, []);

  const closeEditPayment = useCallback(() => setEditPayment(null), []);

  // The assignment this payment belongs to — looked up for the live
  // percentage preview only; the backend recomputes and stores the
  // authoritative percentage regardless of anything shown here.
  const editAssignment = useMemo(() => {
    if (!editPayment) return null;
    return (data?.assignments || []).find((a) => a.payments.some((p) => p.ID === editPayment.ID)) || null;
  }, [data, editPayment]);

  const editPreviewPercentage = useMemo(() => {
    const amt = parseFloat(editForm.amount);
    const total = editAssignment?.accepted_quotation_amount;
    if (!total || Number.isNaN(amt)) return null;
    return (amt / total) * 100;
  }, [editForm.amount, editAssignment]);

  const handleSaveEdit = useCallback(async () => {
    if (!editPayment) return;
    const amount = parseFloat(editForm.amount);
    if (Number.isNaN(amount) || amount <= 0) { toast.showWarning("Enter a valid payment amount"); return; }
    if (!editForm.date) { toast.showWarning("Payment date/time is required"); return; }

    setEditSaving(true);
    try {
      const fd = new FormData();
      fd.append("amount", String(amount));
      fd.append("payment_date", editForm.date);
      fd.append("reference_number", editForm.referenceNumber.trim());
      fd.append("comments", editForm.comments.trim());
      if (editProofFile) fd.append("proof", editProofFile);

      await customerPaymentService.update(editPayment.ID, fd);
      toast.showSuccess("Payment updated");
      closeEditPayment();
      load(selectedCustomer);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Update failed");
    } finally {
      setEditSaving(false);
    }
  }, [editPayment, editForm, editProofFile, toast, closeEditPayment, load, selectedCustomer]);

  const handleDeletePayment = useCallback((payment) => {
    setConfirmModal({
      title: "Delete Payment",
      description: `Delete this payment of ${formatAmount(payment.PAYMENT_AMOUNT)}? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await customerPaymentService.remove(payment.ID);
          toast.showSuccess("Payment deleted");
          load(selectedCustomer);
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [toast, load, selectedCustomer]);

  const handleViewProof = useCallback(async (payment) => {
    if (!payment.FILE_URL) return;
    setViewingProofId(payment.ID);
    try {
      const res = await customerPaymentService.fetchProofBlob(payment.ID);
      const blobUrl = URL.createObjectURL(res.data);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.showError("Failed to open payment proof");
    } finally {
      setViewingProofId(null);
    }
  }, [toast]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={CustomerIcon}
        iconAlt="Customer Payments"
        title="Customer Payments"
        subtitle="Search a customer to review payment history, proofs, and totals per Lead/Project"
      />

      <div className={styles.body}>
        <div className={styles.selectorCard}>
          <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px" }}>
              <label className={styles.selectorLabel}>Select Customer</label>
              <PMSelect
                options={customerOptions}
                value={selectedCustomer}
                onChange={setSelectedCustomer}
                valueKey="ID"
                labelKey="DISPLAY_LABEL"
                allowClear
                clearLabel="— Search a customer —"
                size="lg"
                style={{ maxWidth: 480 }}
              />
            </div>
            {data?.customer && data.assignments.length > 0 && (
              <div style={{ flex: "1 1 320px" }}>
                <label className={styles.selectorLabel}>Filter by Lead / Project</label>
                <AssignmentFilterSelect
                  assignments={data.assignments}
                  value={selectedAssignment}
                  onChange={setSelectedAssignment}
                />
              </div>
            )}
          </div>
          {data?.customer && (
            <div className={styles.customerMeta}>
              <span>{data.customer.EMAIL || "—"}</span>
              <span>·</span>
              <span>{data.customer.PHONE_NUMBER || "—"}</span>
              {/* Top-level "Record Payment" button removed — the per-assignment
                  "+ Add Payment" button inside each card's Payment Records
                  section (below) already covers this, and having both was
                  redundant.
              {canManualAdd && (
                <PMButton variant="primary" size="sm" onClick={() => openManualEntry(selectedAssignment)} style={{ marginLeft: "auto" }}>
                  Record Payment
                </PMButton>
              )}
              */}
            </div>
          )}
        </div>

        {loading ? (
          <Loader />
        ) : !selectedCustomer ? (
          <EmptyState
            icon={CustomerIcon}
            iconAlt="Customer Payments"
            title="Select a customer to begin"
            description="Search and select a customer above to view their payment history."
          />
        ) : !data || data.assignments.length === 0 ? (
          <EmptyState
            icon={CustomerIcon}
            iconAlt="Customer Payments"
            title="No Purchase-Order-received Leads for this customer"
            description="Payment tracking becomes available once a Lead's Purchase Order has been received. Leads still earlier in the pipeline (quotation pending/approved, PO requested, etc.) don't appear here yet."
          />
        ) : visibleAssignments.length === 0 ? (
          <EmptyState
            icon={CustomerIcon}
            iconAlt="Customer Payments"
            title="No match for this filter"
            description="Clear the Lead/Project filter above to see all of this customer's assignments."
          />
        ) : (
          visibleAssignments.map((a) => (
            <div key={a.assignment_id} className={styles.assignmentCard}>
              <div className={styles.assignmentHead}>
                <div className={styles.assignmentTitle}>
                  <span className={styles.assignmentProject}>{a.project_name || "—"}</span>
                  <span className={styles.assignmentLead}>{a.lead_contact_name ? `Lead: ${a.lead_contact_name}` : "No linked lead"}</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {a.assignment_status === "HOLD" && (
                    <span className={styles.statusPill} data-status="Hold" title="A triggered Payment Milestone is still unpaid">
                      On Hold — Payment Required
                    </span>
                  )}
                  <span className={styles.statusPill} data-status={a.payment_status}>{a.payment_status}</span>
                </div>
              </div>

              <div className={styles.summaryGrid}>
                <div className={styles.summaryField}>
                  <span className={styles.summaryLabel}>Quantity</span>
                  <span className={styles.summaryValue}>{a.quantity ?? 1}</span>
                </div>
                <div className={styles.summaryField}>
                  <span className={styles.summaryLabel}>Price Per Unit</span>
                  <span className={styles.summaryValue}>{formatAmount(a.price_per_unit)}</span>
                </div>
                <div className={styles.summaryField}>
                  <span className={styles.summaryLabel}>Total Project Value</span>
                  <span className={styles.summaryValue}>{formatAmount(a.accepted_quotation_amount)}</span>
                </div>
                <div className={styles.summaryField}>
                  <span className={styles.summaryLabel}>Total Paid</span>
                  <span className={styles.summaryValue}>{formatAmount(a.total_paid)}</span>
                </div>
                <div className={styles.summaryField}>
                  <span className={styles.summaryLabel}>Remaining Balance</span>
                  <span className={styles.summaryValue}>{formatAmount(a.remaining_balance)}</span>
                </div>
                <div className={styles.summaryField}>
                  <span className={styles.summaryLabel}>Paid / Remaining %</span>
                  <span className={styles.summaryValue}>
                    {Number(a.total_paid_percentage ?? 0).toFixed(2)}% / {Number(a.remaining_percentage ?? 0).toFixed(2)}%
                  </span>
                </div>
                <div className={styles.summaryField}>
                  <span className={styles.summaryLabel}>Project Completion %</span>
                  {canUpdate ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        className={styles.completionInput}
                        value={completionEdits[a.assignment_id] ?? String(a.project_completion_percentage ?? 0)}
                        onChange={(e) => setCompletionEdits((prev) => ({ ...prev, [a.assignment_id]: e.target.value }))}
                        disabled={!!savingCompletion[a.assignment_id]}
                      />
                      <PMButton
                        variant="outline"
                        size="sm"
                        onClick={() => handleCompletionSave(a.assignment_id)}
                        disabled={!!savingCompletion[a.assignment_id] || completionEdits[a.assignment_id] === undefined}
                      >
                        {savingCompletion[a.assignment_id] ? "Saving…" : "Save"}
                      </PMButton>
                    </div>
                  ) : (
                    <span className={styles.summaryValue}>{Number(a.project_completion_percentage ?? 0).toFixed(2)}%</span>
                  )}
                </div>
              </div>

              {a.milestones?.length > 0 && (
                <div className={styles.paymentsSection} style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className={styles.paymentsSectionTitle} style={{ marginBottom: "var(--sp-2)" }}>
                    Payment Milestones
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {a.milestones.map((m) => {
                      const label = m.STATUS === "COMPLETED" ? "Fully Paid" : m.STATUS === "REQUESTED" ? "Requested" : "Not Paid";
                      return (
                        <span
                          key={m.ID}
                          className={styles.statusPill}
                          data-status={label}
                          title={m.DESCRIPTION || ""}
                        >
                          {m.MILESTONE_NAME} (Trigger {Number(m.PROJECT_COMPLETION_TRIGGER_PERCENTAGE).toFixed(0)}% ·
                          {" "}{Number(m.REQUIRED_PAYMENT_PERCENTAGE).toFixed(0)}%) — {label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={styles.paymentsSection}>
                <div className={styles.paymentsSectionHead}>
                  <span className={styles.paymentsSectionTitle}>Payment Records</span>
                  {canManualAdd && (
                    <PMButton variant="outline" size="sm" onClick={() => openManualEntry(a.assignment_id)}>
                      + Add Payment
                    </PMButton>
                  )}
                </div>
                {a.payments.length === 0 ? (
                  <div className={styles.emptyHint}>No payments recorded yet.</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Payment Date</th>
                          <th>Amount</th>
                          <th>%</th>
                          <th>Reference</th>
                          <th>Payment Proof</th>
                          <th>Comments</th>
                          {(canUpdate || canDelete) && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {a.payments.map((p) => (
                          <tr key={p.ID}>
                            <td>{formatDateTime(p.PAYMENT_DATE)}</td>
                            <td>{formatAmount(p.PAYMENT_AMOUNT)}</td>
                            <td>{Number(p.PAYMENT_PERCENTAGE ?? 0).toFixed(2)}%</td>
                            <td>{p.PAYMENT_REFERENCE_NUMBER || <span className={styles.muted}>—</span>}</td>
                            <td>
                              {p.FILE_URL ? (
                                canViewProof ? (
                                  <button
                                    className={styles.linkBtn}
                                    onClick={() => handleViewProof(p)}
                                    disabled={viewingProofId === p.ID}
                                  >
                                    {viewingProofId === p.ID ? "Opening…" : "View"}
                                  </button>
                                ) : (
                                  <span className={styles.muted}>Uploaded</span>
                                )
                              ) : (
                                <span className={styles.muted}>—</span>
                              )}
                            </td>
                            <td>{p.COMMENTS || <span className={styles.muted}>—</span>}</td>
                            {(canUpdate || canDelete) && (
                              <td>
                                <div style={{ display: "flex", gap: 8 }}>
                                  {canUpdate && (
                                    <button className={styles.linkBtn} onClick={() => openEditPayment(p)} title="Edit">
                                      <img src={EditIcon} alt="Edit" style={{ width: 14, height: 14 }} />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button className={styles.linkBtn} onClick={() => handleDeletePayment(p)} title="Delete">
                                      <img src={DeleteIcon} alt="Delete" style={{ width: 14, height: 14 }} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Manual Payment Entry Modal */}
      <PMModal
        open={manualModal}
        onClose={closeManualEntry}
        title="Record Payment"
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeManualEntry}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSaveManual} disabled={saving}>
              {saving ? "Saving…" : "Save Payment"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Lead / Project <span className={styles.req}>*</span></label>
            <PMSelect
              options={assignmentOptions}
              value={form.assignmentId}
              onChange={(v) => handleFormChange("assignmentId", v)}
              valueKey="value"
              labelKey="label"
              allowClear
              clearLabel="— Select Lead/Project —"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Amount <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => handleFormChange("amount", e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Payment Date/Time <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              type="datetime-local"
              value={form.date}
              onChange={(e) => handleFormChange("date", e.target.value)}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Reference Number</label>
            <input
              className={styles.input}
              value={form.referenceNumber}
              onChange={(e) => handleFormChange("referenceNumber", e.target.value)}
              placeholder="Optional — UTR, cheque no., etc."
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Payment Proof</label>
            <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
              <span>{proofFile ? proofFile.name : "Click to select a file (PDF, image, or Word doc)"}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              style={{ display: "none" }}
              onChange={(e) => setProofFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Comments</label>
            <textarea
              className={styles.textarea}
              value={form.comments}
              onChange={(e) => handleFormChange("comments", e.target.value)}
              placeholder="Optional notes — e.g. paid via bank transfer, WhatsApp confirmation, etc."
              rows={3}
            />
          </div>
        </div>
      </PMModal>

      {/* Edit Payment Modal — full-field edit. Amount edits are re-validated
          server-side against the remaining balance (excluding this payment's
          own current amount) and the percentage shown here is a live,
          display-only preview; the backend always recomputes and stores the
          authoritative value regardless. */}
      <PMModal
        open={!!editPayment}
        onClose={closeEditPayment}
        title="Edit Payment"
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeEditPayment}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save Changes"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Amount <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              type="number"
              min="0.01"
              step="0.01"
              value={editForm.amount}
              onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Percentage (preview)</label>
            <input
              className={styles.input}
              value={editPreviewPercentage != null ? `${editPreviewPercentage.toFixed(2)}%` : "—"}
              disabled
              readOnly
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Payment Date/Time <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              type="datetime-local"
              value={editForm.date}
              onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Reference Number</label>
            <input
              className={styles.input}
              value={editForm.referenceNumber}
              onChange={(e) => setEditForm((f) => ({ ...f, referenceNumber: e.target.value }))}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Payment Proof</label>
            {editPayment?.FILE_NAME && !editProofFile && (
              <div className={styles.emptyHint}>Current file: {editPayment.FILE_NAME} — select a new file below to replace it.</div>
            )}
            <div className={styles.dropzone} onClick={() => editFileRef.current?.click()}>
              <span>{editProofFile ? editProofFile.name : "Click to select a replacement file (optional)"}</span>
            </div>
            <input
              ref={editFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              style={{ display: "none" }}
              onChange={(e) => setEditProofFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Comments</label>
            <textarea
              className={styles.textarea}
              value={editForm.comments}
              onChange={(e) => setEditForm((f) => ({ ...f, comments: e.target.value }))}
              rows={3}
            />
          </div>
        </div>
      </PMModal>

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
