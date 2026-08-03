import { memo } from "react";
import { PMModal, PMButton } from "../pm";
import { formatDateTime } from "../../utils/formatDateTime";
import DetailsIcon from "../../assets/Icons/detailsIcon.webp";
import styles from "../../pages/SupplierManagementPage.module.css";

const STATUS_COLORS = {
  OPEN: styles.badgeOpen,
  DRAFT_SAVED: styles.badgeDraft,
  SUBMITTED: styles.badgeSubmitted,
  UNDER_REVIEW: styles.badgeReview,
  APPROVED: styles.badgeApproved,
  REJECTED: styles.badgeRejected,
  EXPIRED: styles.badgeExpired,
};

export const InvitationDetailModal = memo(function InvitationDetailModal({ open, onClose, data }) {
  return (
    <PMModal
      open={open}
      onClose={onClose}
      title="Invitation Details"
      size="md"
      footer={<PMButton variant="outline" onClick={onClose}>Close</PMButton>}
    >
      {data && (
        <div className={styles.invDetailBody}>
          {/* Status header */}
          <div className={styles.invDetailHeader}>
            <div className={styles.invDetailCompany}>
              <span className={styles.invDetailCompanyIcon}>
                <img src={DetailsIcon} alt="Details" />
              </span>
              <div>
                <div className={styles.invDetailCompanyName}>{data.INVITED_COMPANY_NAME || "—"}</div>
                <span className={`${styles.badge} ${STATUS_COLORS[data.STATUS] || styles.badgeExpired}`}>
                  {data.STATUS?.replace(/_/g, " ") || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className={styles.invDetailSection}>
            <div className={styles.invDetailSectionTitle}>Contact Information</div>
            <div className={styles.invDetailGrid}>
              <div className={styles.invDetailField}>
                <span className={styles.invDetailFieldLabel}>Email</span>
                <span className={styles.invDetailFieldValue}>{data.INVITED_EMAIL || "—"}</span>
              </div>
              <div className={styles.invDetailField}>
                <span className={styles.invDetailFieldLabel}>Phone</span>
                <span className={styles.invDetailFieldValue}>{data.INVITED_PHONE || "—"}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className={styles.invDetailSection}>
            <div className={styles.invDetailSectionTitle}>Timeline</div>
            <div className={styles.invDetailGrid}>
              <div className={styles.invDetailField}>
                <span className={styles.invDetailFieldLabel}>Created At</span>
                <span className={styles.invDetailFieldValue}>{formatDateTime(data.CREATED_AT)}</span>
              </div>
              <div className={styles.invDetailField}>
                <span className={styles.invDetailFieldLabel}>Email Sent At</span>
                <span className={styles.invDetailFieldValue}>{formatDateTime(data.EMAIL_SENT_AT)}</span>
              </div>
              <div className={styles.invDetailField}>
                <span className={styles.invDetailFieldLabel}>Expires At</span>
                <span className={styles.invDetailFieldValue}>{formatDateTime(data.EXPIRES_AT)}</span>
              </div>
              {data.SUBMITTED_AT && (
                <div className={styles.invDetailField}>
                  <span className={styles.invDetailFieldLabel}>Submitted At</span>
                  <span className={styles.invDetailFieldValue}>{formatDateTime(data.SUBMITTED_AT)}</span>
                </div>
              )}
              {data.APPROVED_AT && (
                <div className={styles.invDetailField}>
                  <span className={styles.invDetailFieldLabel}>Approved At</span>
                  <span className={styles.invDetailFieldValue}>{formatDateTime(data.APPROVED_AT)}</span>
                </div>
              )}
              {data.REJECTED_AT && (
                <div className={styles.invDetailField}>
                  <span className={styles.invDetailFieldLabel}>Rejected At</span>
                  <span className={styles.invDetailFieldValue}>{formatDateTime(data.REJECTED_AT)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Created By */}
          <div className={styles.invDetailSection}>
            <div className={styles.invDetailSectionTitle}>Invited By</div>
            <div className={styles.invDetailCreatorCard}>
              <div className={styles.invDetailCreatorAvatar}>
                {(data.CREATED_BY_NAME || "?").charAt(0).toUpperCase()}
              </div>
              <div className={styles.invDetailCreatorInfo}>
                <span className={styles.invDetailCreatorName}>{data.CREATED_BY_NAME || "Unknown"}</span>
                {(data.CREATED_BY_CODE || data.CREATED_BY_EMAIL) && (
                  <span className={styles.invDetailCreatorCode}>
                    {[data.CREATED_BY_CODE, data.CREATED_BY_EMAIL].filter(Boolean).join(" · ")}
                  </span>
                )}
                {(data.CREATED_BY_DEPARTMENT || data.CREATED_BY_ROLE) && (
                  <span className={styles.invDetailCreatorMeta}>
                    {[data.CREATED_BY_DEPARTMENT, data.CREATED_BY_ROLE].filter(Boolean).join(" · ")}
                  </span>
                )}
                {data.CREATED_BY_PHONE && (
                  <span className={styles.invDetailCreatorMeta}>{data.CREATED_BY_PHONE}</span>
                )}
              </div>
            </div>
          </div>

          {/* Rejection reason */}
          {data.REJECTION_REASON && (
            <div className={styles.invDetailSection}>
              <div className={styles.invDetailSectionTitle}>Rejection Reason</div>
              <div className={styles.invDetailRejection}>{data.REJECTION_REASON}</div>
            </div>
          )}

          {/* Notes */}
          {data.NOTES && (
            <div className={styles.invDetailSection}>
              <div className={styles.invDetailSectionTitle}>Notes</div>
              <div className={styles.invDetailNotes}>{data.NOTES}</div>
            </div>
          )}
        </div>
      )}
    </PMModal>
  );
});
