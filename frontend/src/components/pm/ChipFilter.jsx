import React, { useCallback } from "react";
import styles from "./ChipFilter.module.css";

const ChipFilter = React.memo(function ChipFilter({
  options = [],
  value,
  onChange,
  allLabel = "All",
}) {
  const handleClick = useCallback(
    (v) => onChange(v),
    [onChange]
  );

  return (
    <div className={styles.row}>
      <button
        className={`${styles.chip} ${value === null || value === undefined ? styles.active : ""}`}
        onClick={() => handleClick(null)}
      >
        {allLabel}
      </button>
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`${styles.chip} ${value === opt.value ? styles.active : ""}`}
          onClick={() => handleClick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
});

export default ChipFilter;
