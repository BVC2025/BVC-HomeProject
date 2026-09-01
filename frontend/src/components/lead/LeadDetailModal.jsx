import { memo, useEffect, useState } from "react";
import { PMModal, PMButton } from "../pm";
import { formatDateTime } from "../../utils/formatDateTime";
import { leadService } from "../../services/leadService";
import { API_BASE_URL } from "../../services/api";
import DetailsIcon from "../../assets/Icons/detailsIcon.webp";
import styles from "../../pages/ManualLeadManagement.module.css";

function absoluteUrl(path) {
  if (!path) return "";
  return path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
}

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
  QUOTE_APPROVAL_PENDING: "Quote Approval Pending",
  QUOTE_APPROVED: "Quote Approved",
  QUOTE_REJECTED: "Quote Rejected",
  REVISED_QUOTE_APPROVAL_PENDING: "Revised Quote Approval Pending",
  REVISED_QUOTE_APPROVED: "Revised Quote Approved",
  REVISED_QUOTE_REJECTED: "Revised Quote Rejected",
  PO_REQUESTED: "Purchase Order Requested",
  PO_RECEIVED: "Purchase Order Received",
  PRODUCTION_SCHEDULED: "Production Scheduled",
  PRODUCTION_STARTED: "Production Started",
};

// A lead's Customer Payment Summary becomes meaningful once its PO is
// received — and stays meaningful for every later stage of the same
// lifecycle. PRODUCTION_SCHEDULED/PRODUCTION_STARTED are set well after
// PO_RECEIVED by the automatic production scheduling engine, so a lead
// sitting at either must still show this section exactly like one still
// at PO_RECEIVED — an exact `=== "PO_RECEIVED"` check would incorrectly
// hide it (and stop fetching payment data) the moment the lead moves on.
const PO_RECEIVED_OR_LATER_STATUSES = new Set(["PO_RECEIVED", "PRODUCTION_SCHEDULED", "PRODUCTION_STARTED"]);

function formatAmount(v) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Lead Details modal — mirrors the structure, section layout, and creator-card
 * presentation of frontend/src/components/supplier/InvitationDetailModal.jsx
 * (used by /supplier-management's "Invitation Details" modal) for UI consistency. */
export const LeadDetailModal = memo(function LeadDetailModal({ open, onClose, data }) {
  const [payments, setPayments] = useState(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  useEffect(() => {
    if (!open || !data?.ID || !PO_RECEIVED_OR_LATER_STATUSES.has(data.LEAD_STATUS)) {
      setPayments(null);
      return;
    }
    let cancelled = false;
    setPaymentsLoading(true);
    leadService.getPayments(data.ID)
      .then((res) => { if (!cancelled) setPayments(res.data); })
      .catch(() => { if (!cancelled) setPayments(null); })
      .finally(() => { if (!cancelled) setPaymentsLoading(false); });
    return () => { cancelled = true; };
  }, [open, data?.ID, data?.LEAD_STATUS]);

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
                {data.CUSTOMER_ID && (
                  <span className={styles.codeBadge}>Linked to Customer Master</span>
                )}
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

          {/* Customer Payment Summary — once a Purchase Order has been received,
              or the lead has since moved on to Production Scheduled/Started */}
          {PO_RECEIVED_OR_LATER_STATUSES.has(data.LEAD_STATUS) && (
            <div className={styles.leadDetailSection}>
              <div className={styles.leadDetailSectionTitle}>Customer Payment Summary</div>
              {paymentsLoading ? (
                <div className={styles.leadDetailNotes}>Loading payment summary…</div>
              ) : !payments ? (
                <div className={styles.leadDetailNotes}>Payment summary is not available.</div>
              ) : (
                <>
                  <div className={styles.leadDetailGrid}>
                    <div className={styles.leadDetailField}>
                      <span className={styles.leadDetailFieldLabel}>Quantity</span>
                      <span className={styles.leadDetailFieldValue}>{payments.quantity ?? 1}</span>
                    </div>
                    <div className={styles.leadDetailField}>
                      <span className={styles.leadDetailFieldLabel}>Price Per Unit</span>
                      <span className={styles.leadDetailFieldValue}>{formatAmount(payments.price_per_unit)}</span>
                    </div>
                    <div className={styles.leadDetailField}>
                      <span className={styles.leadDetailFieldLabel}>Total Project Value</span>
                      <span className={styles.leadDetailFieldValue}>{formatAmount(payments.accepted_amount)}</span>
                    </div>
                    <div className={styles.leadDetailField}>
                      <span className={styles.leadDetailFieldLabel}>Total Paid</span>
                      <span className={styles.leadDetailFieldValue}>{formatAmount(payments.total_paid)}</span>
                    </div>
                    <div className={styles.leadDetailField}>
                      <span className={styles.leadDetailFieldLabel}>Remaining Balance</span>
                      <span className={styles.leadDetailFieldValue}>{formatAmount(payments.remaining_balance)}</span>
                    </div>
                    <div className={styles.leadDetailField}>
                      <span className={styles.leadDetailFieldLabel}>Paid / Remaining %</span>
                      <span className={styles.leadDetailFieldValue}>
                        {Number(payments.total_paid_percentage ?? 0).toFixed(2)}% / {Number(payments.remaining_percentage ?? 0).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  {payments.payments?.length > 0 ? (
                    <div className={styles.tableWrap} style={{ marginTop: "var(--sp-3)" }}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>%</th>
                            <th>Reference</th>
                            <th>Proof</th>
                            <th>Comments</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.payments.map((p) => (
                            <tr key={p.ID}>
                              <td className={styles.dateCell}>{formatDateTime(p.PAYMENT_DATE)}</td>
                              <td>{formatAmount(p.PAYMENT_AMOUNT)}</td>
                              <td>{Number(p.PAYMENT_PERCENTAGE ?? 0).toFixed(2)}%</td>
                              <td className={styles.descCell}>{p.PAYMENT_REFERENCE_NUMBER || "—"}</td>
                              <td>
                                {p.FILE_URL ? (
                                  <a href={absoluteUrl(p.FILE_URL)} target="_blank" rel="noopener noreferrer">
                                    View
                                  </a>
                                ) : "—"}
                              </td>
                              <td className={styles.descCell}>{p.COMMENTS || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.leadDetailNotes}>No payments recorded yet.</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </PMModal>
  );
});
