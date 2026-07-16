import { memo } from "react";
import { PMModal, PMButton } from "../pm";
import { formatDateTime } from "../../utils/formatDateTime";
import styles from "../../pages/SupplierManagementPage.module.css";

function Field({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className={styles.invDetailField}>
      <span className={styles.invDetailFieldLabel}>{label}</span>
      <span className={styles.invDetailFieldValue}>{String(value)}</span>
    </div>
  );
}

function FullWidthField({ label, value }) {
  if (!value) return null;
  return (
    <div className={styles.invDetailField} style={{ gridColumn: "1 / -1" }}>
      <span className={styles.invDetailFieldLabel}>{label}</span>
      <span className={styles.invDetailFieldValue}>{String(value)}</span>
    </div>
  );
}

export const ReviewModal = memo(function ReviewModal({ open, onClose, data, onApprove, onReject, appActing }) {
  if (!data) return null;

  const fd = data.draft?.form_data || data.draft?.FORM_DATA || {};
  const products = data.draft?.products_data || data.draft?.PRODUCTS_DATA || [];

  const cityStatePincode = [fd.city, fd.state, fd.pincode].filter(Boolean).join(", ");

  return (
    <PMModal
      open={open}
      onClose={onClose}
      title="Review Supplier Registration"
      size="lg"
      footer={
        <>
          <PMButton variant="outline" onClick={onClose}>Close</PMButton>
          <PMButton variant="ghost" onClick={onReject}>Reject</PMButton>
          <PMButton variant="primary" onClick={() => onApprove(data)} disabled={appActing}>
            {appActing ? "Approving…" : "Approve & Activate"}
          </PMButton>
        </>
      }
    >
      <div className={styles.invDetailBody}>
        {/* Header — company + status */}
        <div className={styles.invDetailHeader}>
          <div className={styles.invDetailCompany}>
            <div className={styles.invDetailCompanyIcon} style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {(data.INVITED_COMPANY_NAME || "S").charAt(0).toUpperCase()}
            </div>
            <div>
              <div className={styles.invDetailCompanyName}>{data.INVITED_COMPANY_NAME || "—"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <span className={`${styles.badge} ${styles.badgeSubmitted}`}>SUBMITTED</span>
                {data.SUBMITTED_AT && (
                  <span style={{ fontSize: 12, opacity: 0.75 }}>
                    {formatDateTime(data.SUBMITTED_AT)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Company Details */}
        <div className={styles.invDetailSection}>
          <div className={styles.invDetailSectionTitle}>Company Information</div>
          <div className={styles.invDetailGrid}>
            <Field label="Company Name" value={fd.company_name} />
            <Field label="GST Number" value={fd.gst_number} />
            <Field label="Registration No." value={fd.registration_no} />
            <Field label="PAN Number" value={fd.pan_number} />
            <Field label="Address Line 1" value={fd.address_line1} />
            <Field label="Address Line 2" value={fd.address_line2} />
            <Field label="City / State / PIN" value={cityStatePincode} />
          </div>
        </div>

        {/* Contact Details */}
        <div className={styles.invDetailSection}>
          <div className={styles.invDetailSectionTitle}>Contact Details</div>
          <div className={styles.invDetailGrid}>
            <Field label="Contact Person" value={fd.contact_person} />
            <Field label="Email" value={fd.email} />
            <Field label="Phone" value={fd.phone} />
            <Field label="Alternate Email" value={fd.alternate_email} />
            <Field label="Alternate Phone" value={fd.alternate_phone} />
            <Field label="Website" value={fd.website} />
          </div>
        </div>

        {/* Business & Financials */}
        {(fd.years_in_business || fd.annual_turnover || fd.employee_count ||
          fd.credit_days != null || fd.lead_time_days != null || fd.certifications?.length) && (
          <div className={styles.invDetailSection}>
            <div className={styles.invDetailSectionTitle}>Business & Financials</div>
            <div className={styles.invDetailGrid}>
              <Field label="Years in Business" value={fd.years_in_business} />
              <Field label="Annual Turnover (₹)" value={fd.annual_turnover != null ? `₹${Number(fd.annual_turnover).toLocaleString()}` : null} />
              <Field label="Employee Count" value={fd.employee_count} />
              <Field label="Credit Days" value={fd.credit_days} />
              <Field label="Lead Time (days)" value={fd.lead_time_days} />
              <Field label="Advance Payment %" value={fd.advance_percent != null ? `${fd.advance_percent}%` : null} />
              <Field label="Min. Order Value (₹)" value={fd.minimum_order_value != null ? `₹${Number(fd.minimum_order_value).toLocaleString()}` : null} />
              {Array.isArray(fd.delivery_modes) && fd.delivery_modes.length > 0 && (
                <FullWidthField label="Delivery Modes" value={fd.delivery_modes.join(", ")} />
              )}
              {Array.isArray(fd.certifications) && fd.certifications.length > 0 && (
                <FullWidthField label="Certifications" value={fd.certifications.join(", ")} />
              )}
            </div>
          </div>
        )}

        {/* Banking Details */}
        {(fd.bank_name || fd.account_number || fd.ifsc_code || fd.payment_terms) && (
          <div className={styles.invDetailSection}>
            <div className={styles.invDetailSectionTitle}>Banking Details</div>
            <div className={styles.invDetailGrid}>
              <Field label="Bank Name" value={fd.bank_name} />
              <Field label="Account Number" value={fd.account_number} />
              <Field label="IFSC Code" value={fd.ifsc_code} />
              <Field label="Payment Terms" value={fd.payment_terms} />
            </div>
          </div>
        )}

        {/* Products */}
        {products.length > 0 && (
          <div className={styles.invDetailSection}>
            <div className={styles.invDetailSectionTitle}>
              Products Registered ({products.length})
            </div>
            <div className={styles.productsList}>
              {products.map((p, i) => (
                <div key={i} className={styles.productItem}>
                  <span className={styles.productName}>
                    {p.product_name || p.PRODUCT_NAME || "—"}
                    {(p.unit || p.UNIT) && (
                      <span style={{ marginLeft: 6, opacity: 0.55, fontWeight: 400, fontSize: 12 }}>
                        / {p.unit || p.UNIT}
                      </span>
                    )}
                  </span>
                  <span className={styles.productPrice}>
                    ₹{Number(p.unit_price || p.UNIT_PRICE || 0).toLocaleString()}
                  </span>
                  {(p.moq || p.MOQ) && (
                    <span style={{ fontSize: 12, color: "#6b7280" }}>
                      MOQ: {p.moq || p.MOQ}
                    </span>
                  )}
                  {(p.lead_time_days || p.LEAD_TIME_DAYS) && (
                    <span style={{ fontSize: 12, color: "#6b7280" }}>
                      Lead: {p.lead_time_days || p.LEAD_TIME_DAYS}d
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Fields — shown only when the vendor has configured any for suppliers */}
        {Array.isArray(data.cf_fields) && data.cf_fields.length > 0 && fd.cf_values &&
          data.cf_fields.some((f) => fd.cf_values[f.ID] !== undefined && fd.cf_values[f.ID] !== null && fd.cf_values[f.ID] !== "") && (
          <div className={styles.invDetailSection}>
            <div className={styles.invDetailSectionTitle}>Additional Information</div>
            <div className={styles.invDetailGrid}>
              {data.cf_fields.map((field) => {
                const val = fd.cf_values[field.ID];
                if (val === undefined || val === null || val === "") return null;
                const displayVal = Array.isArray(val) ? val.join(", ") : String(val);
                return <Field key={field.ID} label={field.FIELD_NAME} value={displayVal} />;
              })}
            </div>
          </div>
        )}
      </div>
    </PMModal>
  );
});
