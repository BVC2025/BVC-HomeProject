import React, { useCallback } from "react";
import styles from "./ExportButton.module.css";

const ExportButton = React.memo(function ExportButton({ onClick, disabled = false }) {
  const handleClick = useCallback(() => onClick(), [onClick]);

  return (
    <button
      className={styles.btn}
      onClick={handleClick}
      disabled={disabled}
      title="Export to Excel"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <polyline points="9 14 12 17 15 14" />
      </svg>
      Export
    </button>
  );
});

export default ExportButton;
