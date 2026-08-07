import React from "react";
import styles from "./EmptyState.module.css";

const EmptyState = React.memo(function EmptyState({
  icon,
  iconAlt = "",
  title = "No records found",
  description,
  action,
}) {
  return (
    <div className={styles.wrap}>
      {icon && (
        <div className={styles.iconWrap}>
          <img src={icon} alt={iconAlt} />
        </div>
      )}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.desc}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
});

export default EmptyState;
