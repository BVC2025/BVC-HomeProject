import styles from "./IconButton.module.css";

/**
 * Circular icon button used for row actions across the app.
 *
 *   <IconButton variant="edit"   onClick={...} title="Edit employee" />
 *   <IconButton variant="delete" onClick={...} title="Delete employee" />
 */

function IconButton({
  variant = "edit",
  onClick,
  title,
  disabled = false
}) {

  const Icon = variant === "delete" ? TrashIcon : PencilIcon;
  const label = variant === "delete" ? "Delete" : "Edit";
  const cls = variant === "delete"
    ? `${styles.btn} ${styles.btnDelete}`
    : `${styles.btn} ${styles.btnEdit}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      aria-label={title || label}
      disabled={disabled}
      className={cls}
    >
      <Icon />
    </button>
  );
}


function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}


function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}


export default IconButton;
