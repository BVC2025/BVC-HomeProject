import TimeInput12h from "./TimeInput12h";
import { isRangeSet } from "../../utils/timeRangeUtils";
import styles from "./DateTimeRangeFilter.module.css";

/**
 * Compound "From date+time / To date+time" toolbar filter, shared by every
 * page that needs a created/poll-time range with the app's AM/PM time
 * control. showTime=false collapses to date-only inputs.
 */
export default function DateTimeRangeFilter({ value, onChange, showTime = true, onClear, disabled }) {
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className={styles.rangeGroup}>
      <div className={styles.field}>
        <label>From Date</label>
        <input
          type="date"
          className={styles.dateInput}
          value={value.fromDate}
          onChange={(e) => set({ fromDate: e.target.value })}
          disabled={disabled}
        />
      </div>
      {showTime && (
        <div className={styles.field}>
          <label>From Time</label>
          <TimeInput12h value={value.fromTime} onChange={(t) => set({ fromTime: t })} disabled={disabled} />
        </div>
      )}
      <div className={styles.field}>
        <label>To Date</label>
        <input
          type="date"
          className={styles.dateInput}
          value={value.toDate}
          onChange={(e) => set({ toDate: e.target.value })}
          disabled={disabled}
        />
      </div>
      {showTime && (
        <div className={styles.field}>
          <label>To Time</label>
          <TimeInput12h value={value.toTime} onChange={(t) => set({ toTime: t })} disabled={disabled} />
        </div>
      )}
      {isRangeSet(value) && onClear && (
        <button type="button" className={styles.clearBtn} onClick={onClear}>✕</button>
      )}
    </div>
  );
}
