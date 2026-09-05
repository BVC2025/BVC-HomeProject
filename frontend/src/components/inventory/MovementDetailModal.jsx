import { memo } from "react";
import { PMModal, PMButton } from "../pm";
import { formatDateTime } from "../../utils/formatDateTime";
import DetailsIcon from "../../assets/Icons/detailsIcon.webp";
// Mirrors BatchDetailModal.jsx's structure/section layout/creator-card
// presentation exactly, for UI consistency across every "detail modal"
// in the Inventory Items page.
import styles from "../../pages/ManualLeadManagement.module.css";
// Movement-type badge classes (movType/typeIn/typeOut) already
// established on the Movements table itself.
import invStyles from "../../pages/InventoryItemsPage.module.css";

const MOVEMENT_TYPE_LABELS = {
  STOCK_IN: "Stock In",
  STOCK_OUT: "Stock Out",
  ADJUSTMENT: "Adjustment",
  TRANSFER_IN: "Transfer In",
  TRANSFER_OUT: "Transfer Out",
  RETURN: "Return",
  WRITE_OFF: "Write Off",
  OPENING_STOCK: "Opening Stock",
};

function movTypeClass(type) {
  if (["STOCK_IN", "TRANSFER_IN", "RETURN", "OPENING_STOCK"].includes(type)) return invStyles.typeIn;
  if (["STOCK_OUT", "TRANSFER_OUT", "WRITE_OFF"].includes(type)) return invStyles.typeOut;
  return invStyles.typeAdj;
}

function formatAmount(v) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateOnly(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString();
}

/** Movement Details modal — one component for both "Stock In Details"
 * and "Stock Out Details", chosen by which enrichment the backend
 * actually returned (data.batch for a batch-backed receipt, data.production
 * for a production-consumption Stock Out) rather than a hardcoded type
 * switch, since a handful of other movement types (ADJUSTMENT, TRANSFER_*,
 * WRITE_OFF, OPENING_STOCK) carry neither and just fall through to the
 * plain Reference section. Mirrors BatchDetailModal.jsx's section layout
 * exactly for design consistency. */
export const MovementDetailModal = memo(function MovementDetailModal({ open, onClose, data }) {
  return (
    <PMModal
      open={open}
      onClose={onClose}
      title="Movement Details"
      size="md"
      footer={<PMButton variant="outline" onClick={onClose}>Close</PMButton>}
    >
      {data && (
        <div className={styles.leadDetailBody}>
          {/* Type header */}
          <div className={styles.leadDetailHeader}>
            <div className={styles.leadDetailCompany}>
              <span className={styles.leadDetailCompanyIcon}>
                <img src={DetailsIcon} alt="Details" />
              </span>
              <div>
                <div className={styles.leadDetailCompanyName}>{data.PRODUCT_NAME || "—"}</div>
                <span className={`${invStyles.movType} ${movTypeClass(data.MOVEMENT_TYPE)}`}>
                  {MOVEMENT_TYPE_LABELS[data.MOVEMENT_TYPE] || data.MOVEMENT_TYPE || "—"}
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

          {/* Quantity */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Quantity</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Quantity</span>
                <span className={styles.leadDetailFieldValue}>{data.QTY?.toLocaleString() ?? "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Quantity Before</span>
                <span className={styles.leadDetailFieldValue}>{data.QTY_BEFORE?.toLocaleString() ?? "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Quantity After</span>
                <span className={styles.leadDetailFieldValue}>{data.QTY_AFTER?.toLocaleString() ?? "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Difference</span>
                <span className={styles.leadDetailFieldValue}>
                  {data.DIFFERENCE != null ? (data.DIFFERENCE > 0 ? `+${data.DIFFERENCE}` : data.DIFFERENCE) : "—"}
                </span>
              </div>
              {data.UNIT_COST != null && (
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Unit Cost</span>
                  <span className={styles.leadDetailFieldValue}>{formatAmount(data.UNIT_COST)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Batch Details — Stock In (manual receipt / GRN) */}
          {data.batch && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Batch Details</div>
              <div className={styles.leadDetailGrid}>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Batch Number</span>
                  <span className={styles.leadDetailFieldValue}>{data.batch.BATCH_NUMBER || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Received Date</span>
                  <span className={styles.leadDetailFieldValue}>{formatDateOnly(data.batch.RECEIVED_DATE)}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Expiry Date</span>
                  <span className={styles.leadDetailFieldValue}>
                    {data.batch.IS_NO_EXPIRY ? "No Expiry" : formatDateOnly(data.batch.EXPIRY_DATE)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Supplier — only when the batch itself has one on file */}
          {data.batch?.SUPPLIER_ID && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Supplier</div>
              <div className={styles.leadDetailGrid}>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Company Name</span>
                  <span className={styles.leadDetailFieldValue}>{data.batch.SUPPLIER_COMPANY_NAME || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Supplier Code</span>
                  <span className={styles.leadDetailFieldValue}>{data.batch.SUPPLIER_CODE || "—"}</span>
                </div>
              </div>
            </div>
          )}

          {/* Production / Consumption Details — Stock Out via a
              CustomerProjectAssignment. TASK_COUNT covers the whole
              assignment's task list — a single consumption movement is
              never attributable to one specific task (see backend). */}
          {data.production && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Production / Consumption Details</div>
              <div className={styles.leadDetailGrid}>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Customer</span>
                  <span className={styles.leadDetailFieldValue}>{data.production.CUSTOMER_NAME || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Customer Company</span>
                  <span className={styles.leadDetailFieldValue}>{data.production.CUSTOMER_COMPANY_NAME || "—"}</span>
                </div>
                {data.production.LEAD_ID && (
                  <div className={styles.leadDetailField}>
                    <span className={styles.leadDetailFieldLabel}>Lead</span>
                    <span className={styles.leadDetailFieldValue}>
                      {[data.production.LEAD_CONTACT_NAME, data.production.LEAD_STATUS].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </div>
                )}
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Project</span>
                  <span className={styles.leadDetailFieldValue}>{data.production.PROJECT_NAME || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Project Quantity</span>
                  <span className={styles.leadDetailFieldValue}>{data.production.ASSIGNMENT_QUANTITY ?? "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Assignment Status</span>
                  <span className={styles.leadDetailFieldValue}>{data.production.ASSIGNMENT_STATUS || "—"}</span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Production Start / End</span>
                  <span className={styles.leadDetailFieldValue}>
                    {[formatDateOnly(data.production.ASSIGNMENT_START_DATE), formatDateOnly(data.production.ASSIGNMENT_END_DATE)].join(" – ")}
                  </span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Completion</span>
                  <span className={styles.leadDetailFieldValue}>
                    {data.production.PROJECT_COMPLETION_PERCENTAGE != null ? `${data.production.PROJECT_COMPLETION_PERCENTAGE}%` : "—"}
                  </span>
                </div>
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Production Tasks</span>
                  <span className={styles.leadDetailFieldValue}>
                    {data.production.TASK_COUNT != null ? `${data.production.TASK_COUNT} task${data.production.TASK_COUNT !== 1 ? "s" : ""}` : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Reference fallback — GRN/PO-referenced rows, or anything
              this modal doesn't otherwise enrich with a batch/production
              section (e.g. ADJUSTMENT, TRANSFER_*, WRITE_OFF). */}
          {!data.batch && !data.production && (data.reference_detail || data.REFERENCE_TYPE) && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Reference</div>
              <div className={styles.leadDetailNotes}>
                {data.reference_detail?.label || data.REFERENCE_TYPE}
              </div>
            </div>
          )}

          {/* Reason / Notes */}
          {(data.REASON || data.NOTES) && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Reason / Notes</div>
              {data.REASON && <div className={styles.leadDetailNotes}>{data.REASON}</div>}
              {data.NOTES && <div className={styles.leadDetailNotes}>{data.NOTES}</div>}
            </div>
          )}

          {/* Performed By */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Performed By</div>
            <div className={styles.leadDetailCreatorCard}>
              <div className={styles.leadDetailCreatorAvatar}>
                {(data.PERFORMED_BY_NAME || "?").charAt(0).toUpperCase()}
              </div>
              <div className={styles.leadDetailCreatorInfo}>
                <span className={styles.leadDetailCreatorName}>{data.PERFORMED_BY_NAME || "System / Automated"}</span>
                {data.PERFORMED_BY_CODE && (
                  <span className={styles.leadDetailCreatorCode}>{data.PERFORMED_BY_CODE}</span>
                )}
              </div>
            </div>
          </div>

          {/* Date */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Date</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Movement Date</span>
                <span className={styles.leadDetailFieldValue}>{formatDateTime(data.CREATED_AT)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </PMModal>
  );
});
