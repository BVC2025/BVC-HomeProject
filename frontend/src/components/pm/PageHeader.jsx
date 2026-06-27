import React from "react";
import styles from "./PageHeader.module.css";

const PageHeader = React.memo(function PageHeader({
  icon,
  iconAlt = "",
  title,
  subtitle,
  actions,
  onRefresh,
  refreshing = false,
}) {
  return (
    <div className={styles.header}>
      <div className={styles.left}>
        {icon && (
          <div className={styles.iconWrap}>
            <img src={icon} alt={iconAlt} />
          </div>
        )}
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
      </div>
      <div className={styles.right}>
        {onRefresh && (
          <button
            className={styles.refreshBtn}
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh data"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? styles.spinning : ""}
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        )}
        {actions}
      </div>
    </div>
  );
});

export default PageHeader;
