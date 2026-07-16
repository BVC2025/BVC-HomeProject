import { memo } from "react";
import { createPortal } from "react-dom";
import PMButton from "./PMButton";
import WarningIcon from "../../assets/Icons/warningIcon.webp";
import styles from "./SwapConfirmPortal.module.css";

/**
 * Reusable sort-order swap confirmation portal.
 * Renders via React portal (document.body) so it floats above all modals.
 *
 * Props:
 *   open              – boolean
 *   onClose           – () => void
 *   onConfirm         – () => void
 *   existingFieldName – name of the item that already owns the conflicting sort order
 *   sortOrder         – the conflicting sort order value
 *   itemLabel         – optional label for the thing being swapped (default "Sort Order")
 */
const SwapConfirmPortal = memo(function SwapConfirmPortal({
  open,
  onClose,
  onConfirm,
  existingFieldName,
  sortOrder,
  itemLabel = "Sort Order",
}) {
  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon}>
          <img src={WarningIcon} alt="Warning" />
        </div>
        <div className={styles.title}>{itemLabel} Conflict</div>
        <div className={styles.desc}>
          {itemLabel} <strong>{sortOrder}</strong> is already used by{" "}
          <strong>&ldquo;{existingFieldName}&rdquo;</strong>.
          Do you want to swap the sort orders?
        </div>
        <div className={styles.footer}>
          <PMButton variant="outline" onClick={onClose}>Cancel</PMButton>
          <PMButton variant="primary" onClick={() => { onConfirm(); onClose(); }}>
            Swap
          </PMButton>
        </div>
      </div>
    </div>,
    document.body,
  );
});

export default SwapConfirmPortal;
