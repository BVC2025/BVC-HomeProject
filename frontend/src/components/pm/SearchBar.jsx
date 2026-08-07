import React, { useCallback } from "react";
import styles from "./SearchBar.module.css";

const SearchBar = React.memo(function SearchBar({
  value,
  onChange,
  placeholder = "Search…",
}) {
  const handleChange = useCallback(
    (e) => onChange(e.target.value),
    [onChange]
  );

  const handleClear = useCallback(() => onChange(""), [onChange]);

  return (
    <div className={styles.wrap}>
      <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className={styles.input}
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
      />
      {value && (
        <button className={styles.clear} onClick={handleClear} aria-label="Clear search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
});

export default SearchBar;
