import { memo } from "react";
import { PMModal, PMButton } from "../pm";
import { formatDateTime } from "../../utils/formatDateTime";
import DetailsIcon from "../../assets/Icons/detailsIcon.webp";
import styles from "../../pages/ManualLeadManagement.module.css";

const LEAD_SOURCE_LABELS = {
  INDIAMART: "IndiaMART",
  WEBSITE: "Company Website",
  MANUAL: "Manual Entry",
};

const LEAD_STATUS_LABELS = {
  NEW: "New",
  VIEWED: "Viewed",
  CONVERTED: "Converted",
  IGNORED: "Ignored",
};

/** Lead Details modal — mirrors the structure, section layout, and creator-card
 * presentation of frontend/src/components/supplier/InvitationDetailModal.jsx
 * (used by /supplier-management's "Invitation Details" modal) for UI consistency. */
export const LeadDetailModal = memo(function LeadDetailModal({ open, onClose, data }) {
  return (
    <PMModal
      open={open}
      onClose={onClose}
      title="Lead Details"
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
                <div className={styles.leadDetailCompanyName}>{data.CONTACT_NAME || "—"}</div>
                <span className={styles.statusPill} data-status={data.LEAD_STATUS}>
                  {LEAD_STATUS_LABELS[data.LEAD_STATUS] || data.LEAD_STATUS || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Contact Information</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Mobile</span>
                <span className={styles.leadDetailFieldValue}>{data.CONTACT_MOBILE || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Email</span>
                <span className={styles.leadDetailFieldValue}>{data.CONTACT_EMAIL || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Company</span>
                <span className={styles.leadDetailFieldValue}>{data.COMPANY_NAME || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Address</span>
                <span className={styles.leadDetailFieldValue}>{data.ADDRESS || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>City / State</span>
                <span className={styles.leadDetailFieldValue}>
                  {[data.CITY, data.STATE].filter(Boolean).join(", ") || "—"}
                </span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Pincode / Country</span>
                <span className={styles.leadDetailFieldValue}>
                  {[data.PINCODE, data.COUNTRY_ISO].filter(Boolean).join(" · ") || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Lead Information */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Lead Information</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Lead Source</span>
                <span className={styles.leadDetailFieldValue}>
                  <span className={styles.codeBadge}>{LEAD_SOURCE_LABELS[data.LEAD_SOURCE] || data.LEAD_SOURCE || "—"}</span>
                </span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Lead Owner</span>
                <span className={styles.leadDetailFieldValue}>{data.ASSIGNED_TO_NAME || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Product Interest</span>
                <span className={styles.leadDetailFieldValue}>{data.PRODUCT_INTEREST || "—"}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Enquiry Type</span>
                <span className={styles.leadDetailFieldValue}>{data.ENQUIRY_TYPE || "—"}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className={styles.leadDetailSection}>
            <div className={styles.leadDetailSectionTitle}>Timeline</div>
            <div className={styles.leadDetailGrid}>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Created At</span>
                <span className={styles.leadDetailFieldValue}>{formatDateTime(data.CREATED_AT)}</span>
              </div>
              <div className={styles.leadDetailField}>
                <span className={styles.leadDetailFieldLabel}>Updated At</span>
                <span className={styles.leadDetailFieldValue}>{formatDateTime(data.UPDATED_AT)}</span>
              </div>
              {data.ENQUIRY_TIME && (
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Enquiry Time</span>
                  <span className={styles.leadDetailFieldValue}>{formatDateTime(data.ENQUIRY_TIME)}</span>
                </div>
              )}
              {data.SOURCE_FETCHED_AT && (
                <div className={styles.leadDetailField}>
                  <span className={styles.leadDetailFieldLabel}>Source Fetched At</span>
                  <span className={styles.leadDetailFieldValue}>{formatDateTime(data.SOURCE_FETCHED_AT)}</span>
                </div>
              )}
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
                {(data.CREATED_BY_CODE || data.CREATED_BY_EMAIL) && (
                  <span className={styles.leadDetailCreatorCode}>
                    {[data.CREATED_BY_CODE, data.CREATED_BY_EMAIL].filter(Boolean).join(" · ")}
                  </span>
                )}
                {(data.CREATED_BY_DEPARTMENT || data.CREATED_BY_ROLE) && (
                  <span className={styles.leadDetailCreatorMeta}>
                    {[data.CREATED_BY_DEPARTMENT, data.CREATED_BY_ROLE].filter(Boolean).join(" · ")}
                  </span>
                )}
                {data.CREATED_BY_PHONE && (
                  <span className={styles.leadDetailCreatorMeta}>{data.CREATED_BY_PHONE}</span>
                )}
              </div>
            </div>
          </div>

          {/* Lead Message */}
          {data.LEAD_MESSAGE && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Lead Message</div>
              <div className={styles.leadDetailNotes}>{data.LEAD_MESSAGE}</div>
            </div>
          )}
        </div>
      )}
    </PMModal>
  );
});
