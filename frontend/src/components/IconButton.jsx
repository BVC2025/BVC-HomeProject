/**
 * Circular icon button used for row actions across the app.
 *
 *   <IconButton variant="edit"   onClick={...} title="Edit employee" />
 *   <IconButton variant="delete" onClick={...} title="Delete employee" />
 *
 * Matches the modern row-action style: soft tinted circle
 * with a glyph in the middle. Hover deepens the tint.
 */

const VARIANTS = {
  edit: {
    bg: "#dbeafe",      // blue-100
    bgHover: "#bfdbfe", // blue-200
    fg: "#2563eb",      // blue-600
    title: "Edit",
    icon: PencilIcon
  },
  delete: {
    bg: "#fee2e2",      // red-100
    bgHover: "#fecaca", // red-200
    fg: "#dc2626",      // red-600
    title: "Delete",
    icon: TrashIcon
  }
};


function IconButton({
  variant = "edit",
  onClick,
  title,
  disabled = false
}) {

  const cfg = VARIANTS[variant] || VARIANTS.edit;

  const Icon = cfg.icon;

  return (

    <button
      type="button"
      onClick={onClick}
      title={title || cfg.title}
      aria-label={title || cfg.title}
      disabled={disabled}
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: "none",
        background: disabled ? "#f1f5f9" : cfg.bg,
        color: disabled ? "#cbd5e1" : cfg.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.15s, transform 0.05s",
        flexShrink: 0
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = cfg.bgHover;
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.background = cfg.bg;
      }}
    >
      <Icon />
    </button>
  );
}


function PencilIcon() {

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}


function TrashIcon() {

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}


export default IconButton;
