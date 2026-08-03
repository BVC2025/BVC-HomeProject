import { memo } from "react";
import { PMModal, PMButton } from "../pm";
import styles from "../../pages/SupplierManagementPage.module.css";

export const RejectModal = memo(function RejectModal({ open, onClose, form, onChange, onConfirm, acting }) {
  return (
    <PMModal
      open={open}
      onClose={onClose}
      title="Reject Registration"
      size="sm"
      footer={
        <>
          <PMButton variant="outline" onClick={onClose}>Cancel</PMButton>
          <PMButton variant="danger" onClick={onConfirm} disabled={acting}>
            {acting ? "Rejecting…" : "Reject Application"}
          </PMButton>
        </>
      }
    >
      <div className={styles.formStack}>
        <div className={styles.formGroup}>
          <label>Rejection Reason <span className={styles.req}>*</span></label>
          <textarea
            className={styles.textarea}
            value={form.REJECTION_REASON}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Explain why this registration is being rejected…"
            rows={4}
          />
        </div>
      </div>
    </PMModal>
  );
});
