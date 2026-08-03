import { useEffect } from "react";

import styles from "./ConfirmDialog.module.css";


/**
 * Small confirm modal reused across the app for destructive actions
 * (logout, delete, discard changes…). Deliberately unstyled from the
 * outside — colours + border-radius live in the CSS module so every
 * confirm looks the same.
 *
 * Props:
 *   open         — boolean, controlled visibility
 *   title        — headline (required)
 *   message      — supporting paragraph (optional)
 *   confirmLabel — text on the destructive/primary button
 *   cancelLabel  — text on the safe/dismiss button
 *   danger       — if true, confirm button is red (destructive style)
 *   onConfirm    — callback when the confirm button is clicked
 *   onCancel     — callback when the cancel button OR backdrop OR
 *                  Escape key is used
 *
 * The primary button is DESTRUCTIVE — its label is what the user
 * loses ("Log Out", "Delete", "Discard"). The cancel button is
 * SAFE — its label is what keeps them where they are ("Continue",
 * "Keep editing"). This mirrors how iOS / material dialogs work.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}) {

  // ESC to cancel. Only bind while the dialog is open, so we don't
  // leak listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        // Backdrop dismisses. Clicks inside the card don't bubble here.
        if (e.target === e.currentTarget) onCancel?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmDialogTitle"
    >
      <div className={styles.card}>

        <div className={styles.iconWrap} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.8"
               strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        </div>

        <h3 id="confirmDialogTitle" className={styles.title}>{title}</h3>

        {message && <p className={styles.message}>{message}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onCancel}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? styles.btnDanger : styles.btnPrimary}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
