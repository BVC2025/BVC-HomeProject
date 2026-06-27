import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import styles from "./PMSelect.module.css";

function PMSelect({
  options = [],
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  disabled = false,
  size = "md",
  className = "",
  style,
  valueKey = "value",
  labelKey = "label",
  allowClear = false,
  clearLabel = "— None —",
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropStyle, setDropStyle] = useState({});
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  const normalized = useMemo(() => {
    return options.map((o) => {
      if (typeof o === "string" || typeof o === "number") {
        return { value: String(o), label: String(o) };
      }
      const v = o[valueKey] ?? o.value ?? o.ID ?? o.id;
      const l =
        o[labelKey] ??
        o.label ??
        o.NAME ??
        o.name ??
        o.ROLE_NAME ??
        String(v ?? "");
      return { value: String(v ?? ""), label: String(l) };
    });
  }, [options, valueKey, labelKey]);

  const hasValue =
    value !== "" && value !== null && value !== undefined;

  const selectedLabel = useMemo(() => {
    if (!hasValue) return "";
    return normalized.find((o) => o.value === String(value))?.label ?? "";
  }, [normalized, value, hasValue]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => o.label.toLowerCase().includes(q));
  }, [normalized, search]);

  const calcDropStyle = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estHeight = Math.min(280, normalized.length * 36 + 56);
    const goUp = spaceBelow < estHeight && spaceAbove > spaceBelow;
    setDropStyle({
      position: "fixed",
      left: rect.left,
      width: Math.max(rect.width, 180),
      zIndex: 9999,
      ...(goUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, [normalized.length]);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    calcDropStyle();
    setOpen(true);
    setSearch("");
  }, [disabled, calcDropStyle]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const selectOption = useCallback(
    (val) => {
      onChange(val);
      closeDropdown();
    },
    [onChange, closeDropdown]
  );

  /* Focus search input when dropdown opens */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  /* Close on outside click — ignore clicks inside trigger or dropdown portal */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        !triggerRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open, closeDropdown]);

  /* Keyboard + scroll repositioning */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeDropdown();
    };
    const onRepos = () => calcDropStyle();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onRepos, true);
    window.addEventListener("resize", onRepos);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onRepos, true);
      window.removeEventListener("resize", onRepos);
    };
  }, [open, closeDropdown, calcDropStyle]);

  const wrapCls = [
    styles.wrap,
    styles[`sz_${size}`],
    open ? styles.wrapOpen : "",
    disabled ? styles.wrapDisabled : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const dropdown = (
    <div ref={dropdownRef} className={styles.dropdown} style={dropStyle}>
      <div className={styles.searchWrap}>
        <svg
          className={styles.searchIcon}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="M15 15l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          className={styles.searchInput}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
        />
        {search && (
          <button
            type="button"
            className={styles.clearSearch}
            onMouseDown={(e) => {
              e.stopPropagation();
              setSearch("");
            }}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <ul className={styles.list}>
        {allowClear && (
          <li
            className={`${styles.option} ${!hasValue ? styles.optionSelected : ""}`}
            onMouseDown={() => selectOption("")}
          >
            <span className={styles.optionLabel}>{clearLabel}</span>
            {!hasValue && (
              <svg
                className={styles.checkIcon}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 8l4 4 6-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </li>
        )}
        {filtered.length === 0 ? (
          <li className={styles.noMatch}>No options found</li>
        ) : (
          filtered.map((opt) => {
            const sel = opt.value === String(value ?? "");
            return (
              <li
                key={opt.value}
                className={`${styles.option} ${sel ? styles.optionSelected : ""}`}
                onMouseDown={() => selectOption(opt.value)}
              >
                <span className={styles.optionLabel}>{opt.label}</span>
                {sel && (
                  <svg
                    className={styles.checkIcon}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M3 8l4 4 6-7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  return (
    <div className={wrapCls} style={style}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={open ? closeDropdown : openDropdown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={
            hasValue ? styles.triggerValue : styles.triggerPlaceholder
          }
        >
          {hasValue ? selectedLabel || placeholder : placeholder}
        </span>
        <svg
          className={`${styles.chevron} ${open ? styles.chevronUp : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M4 6l4 4 4-4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && createPortal(dropdown, document.body)}
    </div>
  );
}

export default memo(PMSelect);
