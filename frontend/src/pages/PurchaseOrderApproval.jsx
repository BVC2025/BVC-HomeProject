import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  PageHeader, PMButton, PMModal, PMConfirmModal, EmptyState, Loader,
} from "../components/pm";
import { purchaseOrderApprovalService } from "../services/purchaseOrderApprovalService";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import InventoryIcon from "../assets/Icons/inventoryIcon.webp";
import styles from "./PurchaseOrderApproval.module.css";

function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PoCard({ po }) {
  return (
    <div className={styles.poCard}>
      <div className={styles.poCardHead}>
        <div className={styles.poCardTitleBlock}>
          <span className={styles.poNumber}>{po.PO_NUMBER}</span>
          <span className={styles.poSupplier}>{po.SUPPLIER_NAME || "Unknown Supplier"}</span>
        </div>
        <span className={styles.poStatusPill} data-status={po.STATUS}>{po.STATUS}</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th>HSN</th>
              <th className={styles.numCol}>Qty</th>
              <th className={styles.numCol}>Unit Price</th>
              <th className={styles.numCol}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {(po.LINES || []).map((l) => (
              <tr key={l.ID}>
                <td>{l.DESCRIPTION || "—"}</td>
                <td>{l.HSN_CODE || "—"}</td>
                <td className={styles.numCol}>{l.ORDERED ?? l.QUANTITY} {l.UNIT}</td>
                <td className={styles.numCol}>{inr(l.UNIT_PRICE)}</td>
                <td className={styles.numCol}>{inr(l.LINE_TOTAL)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.poTotals}>
        <span>Subtotal: {inr(po.SUBTOTAL)}</span>
        <span>Tax: {inr(po.TAX_AMOUNT)}</span>
        <span className={styles.grandTotal}>Grand Total: {inr(po.GRAND_TOTAL)}</span>
      </div>
    </div>
  );
}

/** Purchase Order Approval — the deep-link target from the "Purchase Order
 * Approval Needed" email (review_batch_url = {FRONTEND_URL}/purchase-order-
 * approval/{batchId}). Shows every per-supplier Purchase Order the low-stock
 * reorder automation grouped into one PurchaseOrderApprovalBatch, and, while
 * PROPOSED, lets a permitted staff member Approve (sends every DRAFT PO to
 * its supplier) or Reject (cancels every DRAFT PO) the whole batch as a
 * single consolidated decision. Structural clone of
 * ProductionScheduleApproval.jsx for visual consistency. */
export default function PurchaseOrderApproval() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const toast = useToast();

  const canDecide = hasPermission("purchase_order.manage");

  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await purchaseOrderApprovalService.getBatch(id);
      setBatch(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Unable to load this purchase order batch. It may not exist, or you may not have access.");
      setBatch(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = useCallback(async () => {
    setApproving(true);
    try {
      const res = await purchaseOrderApprovalService.approveBatch(id);
      setBatch(res.data);
      toast.showSuccess("Purchase orders approved and sent to suppliers.");
      setConfirmApproveOpen(false);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to approve this batch.");
    } finally {
      setApproving(false);
    }
  }, [id, toast]);

  const handleReject = useCallback(async () => {
    setRejecting(true);
    try {
      const res = await purchaseOrderApprovalService.rejectBatch(id, {
        reason: rejectReason.trim() || undefined,
      });
      setBatch(res.data);
      toast.showSuccess("Purchase order batch rejected.");
      setRejectOpen(false);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to reject this batch.");
    } finally {
      setRejecting(false);
    }
  }, [id, rejectReason, toast]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={InventoryIcon}
        iconAlt="Purchase Order Approval"
        title="Purchase Order Approval"
        subtitle="Review the auto-generated low-stock reorder purchase orders and approve or reject them"
      />

      <div className={styles.body}>
        {loading ? (
          <Loader />
        ) : error ? (
          <EmptyState icon={InventoryIcon} iconAlt="Purchase Order Approval" title="Unable to load this batch" description={error} />
        ) : !batch ? (
          <EmptyState icon={InventoryIcon} iconAlt="Purchase Order Approval" title="Batch not found" />
        ) : (
          <>
            <div className={styles.batchHead}>
              <div className={styles.batchHeadInfo}>
                <span className={styles.batchLabel}>Trigger: {batch.trigger_type === "MANUAL" ? "Manual" : "Low Stock Reorder"}</span>
                <span className={styles.batchMeta}>Created {formatDateTime(batch.created_at)}</span>
              </div>
              <span className={styles.statusPill} data-status={batch.status}>{batch.status}</span>
            </div>

            {batch.trigger_note && (
              <div className={styles.noteBanner}>
                ⚠ {batch.trigger_note}
              </div>
            )}

            <div className={styles.poList}>
              {(batch.purchase_orders || []).map((po) => (
                <PoCard key={po.ID} po={po} />
              ))}
              {(!batch.purchase_orders || batch.purchase_orders.length === 0) && (
                <EmptyState icon={InventoryIcon} iconAlt="Purchase Orders" title="No purchase orders in this batch" />
              )}
            </div>

            {batch.status === "APPROVED" && (
              <div className={styles.decisionSection} data-tone="success">
                <div className={styles.sectionLabel}>Approved</div>
                <p>Approved by {batch.approved_by_name || "—"} on {formatDateTime(batch.approved_at)}. Every draft purchase order has been sent to its supplier.</p>
              </div>
            )}

            {batch.status === "REJECTED" && (
              <div className={styles.decisionSection} data-tone="danger">
                <div className={styles.sectionLabel}>Rejected</div>
                <p>Rejected by {batch.rejected_by_name || "—"} on {formatDateTime(batch.rejected_at)}.</p>
                {batch.reject_reason && <p>Reason: {batch.reject_reason}</p>}
              </div>
            )}

            {batch.status === "PROPOSED" && (
              <div className={styles.actionsBar}>
                {canDecide ? (
                  <>
                    <PMButton variant="primary" onClick={() => setConfirmApproveOpen(true)} disabled={approving}>
                      {approving ? "Approving…" : "Approve & Send to Suppliers"}
                    </PMButton>
                    <PMButton variant="outline" onClick={() => { setRejectReason(""); setRejectOpen(true); }} disabled={rejecting}>
                      Reject
                    </PMButton>
                  </>
                ) : (
                  <p className={styles.mutedNote}>You do not have permission to act on this batch.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <PMConfirmModal
        open={confirmApproveOpen}
        onClose={() => setConfirmApproveOpen(false)}
        onConfirm={handleApprove}
        title="Approve Purchase Orders"
        description="This sends every draft purchase order in this batch to its supplier by email. This cannot be undone."
        confirmLabel="Approve & Send"
        cancelLabel="Cancel"
      />

      <PMModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject Purchase Order Batch"
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setRejectOpen(false)}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleReject} disabled={rejecting}>
              {rejecting ? "Submitting…" : "Submit Rejection"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGroup}>
          <label>Reason (optional)</label>
          <textarea
            className={styles.textarea}
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this purchase order batch being rejected?"
          />
        </div>
      </PMModal>
    </div>
  );
}
