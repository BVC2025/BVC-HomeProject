import React from "react";
import styles from "./StatsRow.module.css";

const StatsRow = React.memo(function StatsRow({ stats = [] }) {
  return (
    <div className={styles.row}>
      {stats.map((stat, i) => (
        <div key={i} className={styles.card}>
          {/* Side accent bar — vertical, BVC24-style */}
          <div className={styles.accentBar} />
          <span className={styles.value}>{stat.value}</span>
          <span className={styles.label}>{stat.label}</span>
          {stat.sub && <span className={styles.sub}>{stat.sub}</span>}
        </div>
      ))}
    </div>
  );
});

export default StatsRow;
