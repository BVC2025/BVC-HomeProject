import { createPortal } from "react-dom";
import PMButton from "./PMButton";
import styles from "./PMConfirmModal.module.css";

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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
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
