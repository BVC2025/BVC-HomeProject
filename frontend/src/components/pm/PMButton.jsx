import { memo } from "react";
import styles from "./PMButton.module.css";

function PMButton({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  icon = null,
  iconEnd = null,
  fullWidth = false,
  type = "button",
  onClick,
  className = "",
  style,
  ...rest
}) {
  const cls = [
    styles.btn,
    styles[variant],
    styles[`sz_${size}`],
    fullWidth ? styles.fullWidth : "",
    loading ? styles.loading : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={cls}
      style={style}
      {...rest}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {!loading && icon && (
        <span className={styles.iconWrap} aria-hidden="true">{icon}</span>
      )}
      <span className={styles.label}>{children}</span>
      {!loading && iconEnd && (
        <span className={styles.iconWrap} aria-hidden="true">{iconEnd}</span>
      )}
    </button>
  );
}

export default memo(PMButton);
