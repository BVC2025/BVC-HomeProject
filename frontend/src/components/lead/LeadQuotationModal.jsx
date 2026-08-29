import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { PMModal, PMButton, PMSelect, EmptyState, Loader } from "../pm";
import TablePagination from "../TablePagination";
import { leadService } from "../../services/leadService";
import { useToast } from "../../hooks/useToast";
import { formatDateTime } from "../../utils/formatDateTime";
import LeadIcon from "../../assets/Icons/departmentIcon.webp";
import styles from "../../pages/ManualLeadManagement.module.css";

const PAGE_SIZE = 10;

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const TYPE_LABELS = { FINAL_QUOTATION: "Final Quotation", REVISED_QUOTATION: "Revised Quotation" };
const STATUS_LABELS = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };

function formatAmount(v) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Lead → Quotation history modal (Quotation icon on /lead-management/leads).
 * Shows the ≤2 quotation records (Final + Revised) for one lead's
 * conversion, with a status filter and — when exactly one Final quotation
 * exists and no Revised one has been sent yet — a "Send Revised Quote"
 * action. Mirrors SupplierProductModal.jsx's "table + status filter inside
 * a PMModal" shape and RejectModal.jsx's mandatory-reason-textarea pattern. */
export const LeadQuotationModal = memo(function LeadQuotationModal({ open, onClose, lead, canSendRevised }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseForm, setReviseForm] = useState({ FINAL_PRICE: "", REASON: "" });
  const [reviseErrors, setReviseErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [sendingPO, setSendingPO] = useState(false);

  const load = useCallback(async () => {
    if (!lead) return;
    setLoading(true);
    try {
      const res = await leadService.getQuotations(lead.ID);
      setRows(res.data?.rows || []);
    } catch {
      toast.showError("Failed to load quotations");
    } finally {
      setLoading(false);
    }
  }, [lead, toast]);

  useEffect(() => {
    if (open) {
      setStatusFilter("");
      setPage(1);
      load();
    }
    // `load` is intentionally excluded — it's a useCallback that depends on
    // `toast`, which useToast() recreates on every render (a new object/
    // function references each time, never memoized). Depending on `load`
    // here would re-run this effect on every render while the modal is
    // open (new toast -> new load -> effect fires -> setLoading -> render
    // -> new toast -> ...), causing the loader to flicker forever. Only
    // `open` and the lead's identity are real triggers for a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.ID]);

  const filtered = useMemo(
    () => (statusFilter ? rows.filter((r) => r.QUOTATION_STATUS === statusFilter) : rows),
    [rows, statusFilter]
  );
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const finalRow = useMemo(() => rows.find((r) => r.QUOTATION_TYPE === "FINAL_QUOTATION"), [rows]);
  const revisedRow = useMemo(() => rows.find((r) => r.QUOTATION_TYPE === "REVISED_QUOTATION"), [rows]);
  const canRevise = canSendRevised && !!finalRow && !revisedRow;

  // The accepted quotation to base a Purchase Order Request on — prefers a
  // REVISED_QUOTATION if one was approved, else the FINAL_QUOTATION,
  // matching the backend's own send-po-request resolution exactly.
  const poEligibleQuotation = useMemo(() => {
    if (revisedRow?.QUOTATION_STATUS === "APPROVED") return revisedRow;
    if (finalRow?.QUOTATION_STATUS === "APPROVED") return finalRow;
    return null;
  }, [finalRow, revisedRow]);
  // Resending is allowed (Send PO Request Again) — the action stays
  // available until the PO has actually been received, not just until
  // the first send. PO_REQUEST_SENT_AT only decides the button's label.
  const isPORequestSent = !!poEligibleQuotation?.PO_REQUEST_SENT_AT;
  const canSendPO = canSendRevised && !!poEligibleQuotation && lead?.LEAD_STATUS !== "PO_RECEIVED";

  const handleSendPORequest = useCallback(async () => {
    if (!lead) return;
    const resend = isPORequestSent;
    setSendingPO(true);
    try {
      const res = await leadService.sendPurchaseOrderRequest(lead.ID);
      if (res.data?.email_sent) {
        toast.showSuccess(resend ? "Purchase Order Request sent again" : "Purchase Order Request sent");
      } else {
        toast.showWarning(res.data?.message || "Purchase Order Request could not be sent.");
      }
      load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.showError(typeof detail === "string" ? detail : "Failed to send Purchase Order Request");
    } finally {
      setSendingPO(false);
    }
  }, [lead, toast, load, isPORequestSent]);

  const openRevise = useCallback(() => {
    setReviseForm({ FINAL_PRICE: finalRow ? String(finalRow.QUOTED_PRICE) : "", REASON: "" });
    setReviseErrors({});
    setReviseOpen(true);
  }, [finalRow]);

  const handleReviseChange = useCallback((field, value) => {
    setReviseForm((f) => ({ ...f, [field]: value }));
    setReviseErrors((e) => ({ ...e, [field]: undefined }));
  }, []);

  const handleReviseSubmit = useCallback(async () => {
    const price = parseFloat(reviseForm.FINAL_PRICE);
    const errs = {};
    if (reviseForm.FINAL_PRICE === "" || Number.isNaN(price) || price < 0) {
      errs.FINAL_PRICE = "Enter a valid, non-negative price.";
    }
    if (!reviseForm.REASON.trim()) {
      errs.REASON = "Reason for Revision is required.";
    }
    if (Object.keys(errs).length > 0) {
      setReviseErrors(errs);
      return;
    }

    setSending(true);
    try {
      const res = await leadService.sendRevisedQuote(lead.ID, {
        FINAL_PRICE: price,
        REASON: reviseForm.REASON.trim(),
      });
      if (res.data?.email_sent) {
        toast.showSuccess("Revised quotation sent");
      } else {
        toast.showWarning(res.data?.message || "Revised quotation created, but the email could not be sent.");
      }
      setReviseOpen(false);
      load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.showError(typeof detail === "string" ? detail : "Failed to send revised quotation");
    } finally {
      setSending(false);
    }
  }, [lead, reviseForm, toast, load]);

  return (
    <>
      <PMModal
        open={open}
        onClose={onClose}
        title={`Quotations — ${lead?.CONTACT_NAME || ""}`}
        size="lg"
      >
        <div className={styles.filterBar} style={{ marginBottom: "var(--sp-4)" }}>
          <div className={styles.filterGroup}>
            <label>Status</label>
            <PMSelect
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v || ""); setPage(1); }}
              valueKey="value"
              labelKey="label"
            />
          </div>
          <div className={styles.filterActions}>
            {canSendRevised && poEligibleQuotation && (
              canSendPO ? (
                <PMButton variant="outline" size="sm" onClick={handleSendPORequest} disabled={sendingPO}>
                  {sendingPO ? "Sending…" : isPORequestSent ? "Send PO Request Again" : "Send Purchase Order Request"}
                </PMButton>
              ) : (
                <span className={styles.muted}>Purchase Order received</span>
              )
            )}
            {canSendRevised && (
              canRevise ? (
                <PMButton variant="primary" size="sm" onClick={openRevise}>Send Revised Quote</PMButton>
              ) : (
                <span className={styles.muted}>
                  {revisedRow ? "Revised quote already sent" : "No final quotation yet"}
                </span>
              )
            )}
          </div>
        </div>

        {loading ? (
          <Loader />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={LeadIcon}
            iconAlt="Quotations"
            title="No quotations yet"
            description="Quotations for this lead will appear here once it's converted."
          />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Project</th>
                    <th>Customer</th>
                    <th>Quoted Amount</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Updated</th>
                    <th>Revision Reason</th>
                    <th>Reason for Rejection</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((q) => (
                    <tr key={q.ID}>
                      <td>{TYPE_LABELS[q.QUOTATION_TYPE] || q.QUOTATION_TYPE}</td>
                      <td className={styles.descCell}>{q.PROJECT_NAME || "—"}</td>
                      <td className={styles.descCell}>{q.CUSTOMER_NAME || "—"}</td>
                      <td>{formatAmount(q.QUOTED_PRICE)}</td>
                      <td>
                        <span className={styles.statusPill} data-status={q.QUOTATION_STATUS}>
                          {STATUS_LABELS[q.QUOTATION_STATUS] || q.QUOTATION_STATUS}
                        </span>
                      </td>
                      <td className={styles.dateCell}>{formatDateTime(q.CREATED_AT)}</td>
                      <td className={styles.dateCell}>{formatDateTime(q.UPDATED_AT)}</td>
                      <td className={styles.descCell}>{q.REVISION_REASON || "—"}</td>
                      <td className={styles.descCell}>
                        {q.QUOTATION_STATUS === "REJECTED" ? (q.REJECTION_REASON || "—") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              total={filtered.length}
              page={page}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              onPageSizeChange={() => {}}
            />
          </>
        )}
      </PMModal>

      <PMModal
        open={reviseOpen}
        onClose={() => setReviseOpen(false)}
        title="Send Revised Quote"
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setReviseOpen(false)}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleReviseSubmit} disabled={sending}>
              {sending ? "Sending…" : "Send Revised Quote"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Previously Shared Price</label>
            <span className={styles.codeBadge}>{formatAmount(finalRow?.QUOTED_PRICE)}</span>
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Revised Price <span className={styles.req}>*</span></label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={`${styles.input}${reviseErrors.FINAL_PRICE ? " " + styles.inputError : ""}`}
              value={reviseForm.FINAL_PRICE}
              onChange={(e) => handleReviseChange("FINAL_PRICE", e.target.value)}
            />
            {reviseErrors.FINAL_PRICE && <span className={styles.fieldError}>{reviseErrors.FINAL_PRICE}</span>}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Reason for Revision <span className={styles.req}>*</span></label>
            <textarea
              className={`${styles.textarea}${reviseErrors.REASON ? " " + styles.inputError : ""}`}
              value={reviseForm.REASON}
              onChange={(e) => handleReviseChange("REASON", e.target.value)}
              placeholder="Explain why this quotation is being revised…"
              rows={4}
            />
            {reviseErrors.REASON && <span className={styles.fieldError}>{reviseErrors.REASON}</span>}
          </div>
        </div>
      </PMModal>
    </>
  );
});
