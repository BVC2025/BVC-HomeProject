import { memo, useState } from "react";
import { PMModal, PMButton } from "../pm";
import { formatDateTime } from "../../utils/formatDateTime";
import { inventoryItemService } from "../../services/inventoryItemService";
import { useToast } from "../../hooks/useToast";
import DetailsIcon from "../../assets/Icons/detailsIcon.webp";
// Mirrors LeadDetailModal.jsx's structure/section layout/creator-card
// presentation exactly, for UI consistency — see that file's own header
// comment for the chain of precedent this pattern comes from.
import styles from "../../pages/ManualLeadManagement.module.css";

const BATCH_STATUS_LABELS = {
  ACTIVE: "Active",
  CONSUMED: "Consumed",
  EXPIRED: "Expired",
  RETURNED: "Returned",
};

function formatAmount(v) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateOnly(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString();
}

/** Batch Details modal — mirrors LeadDetailModal.jsx's section layout,
 * status-pill header, and creator-card presentation for design consistency
 * with /lead-management/leads. */
export const BatchDetailModal = memo(function BatchDetailModal({ open, onClose, data }) {
  const toast = useToast();
  const [viewingKind, setViewingKind] = useState(null);

  const handleViewFile = async (kind) => {
    if (!data?.ID) return;
    setViewingKind(kind);
    try {
      const res = await inventoryItemService.viewBatchFile(data.ID, kind);
      const blobUrl = URL.createObjectURL(res.data);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.showError(`Failed to open ${kind === "dc" ? "Delivery Challan" : "Invoice"}`);
    } finally {
      setViewingKind(null);
    }
  };

  return (
    <PMModal
      open={open}
      onClose={onClose}
      title="Batch Details"
      size="md"
      footer={<PMButton variant="outline" onClick={onClose}>Close</PMButton>}
    >
      {data && (
        <div className={styles.leadDetailBody}>
          {/* Status header */}
          <div className={styles.leadDetailHeader}>
            <div className={styles.leadDetailCompany}>
              <span className={styles.leadDetailCompanyIcon}>
                <img src={DetailsIcon} alt="Details" />
              </span>
              <div>
                <div className={styles.leadDetailCompanyName}>{data.BATCH_NUMBER || "—"}</div>
                <span className={styles.statusPill} data-status={data.STATUS}>
                  {BATCH_STATUS_LABELS[data.STATUS] || data.STATUS || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Product & Category */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Product & Category</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Product</span>
                <span className={styles.leadDetailFieldValue}>{data.PRODUCT_NAME || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Product Code</span>
                <span className={styles.leadDetailFieldValue}>{data.PRODUCT_CODE || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Category</span>
                <span className={styles.leadDetailFieldValue}>
                  <span className={styles.codeBadge}>{data.CATEGORY_NAME || "Uncategorized"}</span>
                </span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Unit</span>
                <span className={styles.leadDetailFieldValue}>{data.UNIT || "—"}</span>
              </div>
            </div>
          </div>

          {/* Supplier */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Supplier</div>
            {data.SUPPLIER_ID ? (
              <div className={styles.leadDetailGrid}>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Company Name</span>
                  <span className={styles.leadDetailFieldValue}>{data.SUPPLIER_COMPANY_NAME || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Supplier Code</span>
                  <span className={styles.leadDetailFieldValue}>{data.SUPPLIER_CODE || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Contact Person</span>
                  <span className={styles.leadDetailFieldValue}>{data.SUPPLIER_CONTACT_PERSON || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Phone / Email</span>
                  <span className={styles.leadDetailFieldValue}>
                    {[data.SUPPLIER_PHONE, data.SUPPLIER_EMAIL].filter(Boolean).join(" · ") || "—"}
                  </span>
                </div>
              </div>
            ) : (
              <div className={styles.leadDetailNotes}>No supplier recorded for this batch.</div>
            )}
          </div>

          {/* Quantity & Cost */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Quantity & Cost</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Quantity Received</span>
                <span className={styles.leadDetailFieldValue}>{data.QTY_RECEIVED?.toLocaleString() ?? "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Quantity Remaining</span>
                <span className={styles.leadDetailFieldValue}>{data.QTY_REMAINING?.toLocaleString() ?? "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Unit Cost</span>
                <span className={styles.leadDetailFieldValue}>{formatAmount(data.UNIT_COST)}</span>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Dates</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Received Date</span>
                <span className={styles.leadDetailFieldValue}>{formatDateOnly(data.RECEIVED_DATE)}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Manufacturing Date</span>
                <span className={styles.leadDetailFieldValue}>{formatDateOnly(data.MANUFACTURING_DATE)}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Expiry Date</span>
                <span className={styles.leadDetailFieldValue}>
                  {data.IS_NO_EXPIRY ? "No Expiry" : formatDateOnly(data.EXPIRY_DATE)}
                </span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Created At</span>
                <span className={styles.leadDetailFieldValue}>{formatDateTime(data.CREATED_AT)}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Updated At</span>
                <span className={styles.leadDetailFieldValue}>{formatDateTime(data.UPDATED_AT)}</span>
              </div>
            </div>
          </div>

          {/* Created By */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Created By</div>
            <div className={styles.leadDetailCreatorCard}>
              <div className={styles.leadDetailCreatorAvatar}>
                {(data.CREATED_BY_NAME || "?").charAt(0).toUpperCase()}
              </div>
              <div className={styles.leadDetailCreatorInfo}>
                <span className={styles.leadDetailCreatorName}>{data.CREATED_BY_NAME || "System / Automated"}</span>
                {data.CREATED_BY_CODE && (
                  <span className={styles.leadDetailCreatorCode}>{data.CREATED_BY_CODE}</span>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          {data.NOTES && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Notes</div>
              <div className={styles.leadDetailNotes}>{data.NOTES}</div>
            </div>
          )}

          {/* Documents */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Documents</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Delivery Challan</span>
                <span className={styles.leadDetailFieldValue}>
                  {data.DC_FILE_URL ? (
                    <PMButton variant="outline" onClick={() => handleViewFile("dc")} disabled={viewingKind === "dc"}>
                      {viewingKind === "dc" ? "Opening…" : "View"}
                    </PMButton>
                  ) : "—"}
                </span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Invoice</span>
                <span className={styles.leadDetailFieldValue}>
                  {data.INVOICE_FILE_URL ? (
                    <PMButton variant="outline" onClick={() => handleViewFile("invoice")} disabled={viewingKind === "invoice"}>
                      {viewingKind === "invoice" ? "Opening…" : "View"}
                    </PMButton>
                  ) : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </PMModal>
  );
});
