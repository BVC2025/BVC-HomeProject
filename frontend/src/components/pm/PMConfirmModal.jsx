import { createPortal } from "react-dom";
import PMButton from "./PMButton";
import styles from "./PMConfirmModal.module.css";
import WarningIcon from "../../assets/Icons/warningIcon.webp";

export default function PMConfirmModal({
  open,
  onClose,
  onConfirm,
  title = "Confirm Delete",
  description = "This action cannot be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
}) {
  if (!open) return null;
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.icon}>
            <img src={WarningIcon} alt="Warning" />
          </div>
          <span className={styles.title}>{title}</span>
        </div>
        <div className={styles.body}>
          <p className={styles.desc}>{description}</p>
        </div>
        <div className={styles.footer}>
          <PMButton variant="outline" onClick={onClose}>{cancelLabel}</PMButton>
          <PMButton variant="danger" onClick={() => { onConfirm?.(); onClose(); }}>
            {confirmLabel}
          </PMButton>
        </div>
      </div>
    </div>,
    document.body
  );
}
