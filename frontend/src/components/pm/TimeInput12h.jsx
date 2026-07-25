import PMSelect from "./PMSelect";
import { HOURS, MINUTES, AMPM_OPTIONS } from "../../utils/timeRangeUtils";
import styles from "./TimeInput12h.module.css";

/** Small hour/minute/AM-PM control — no native time-picker exposes AM/PM
 * selection the way this app's requirements call for, so this is built
 * specifically to fill that gap and shared across every page that needs it. */
export default function TimeInput12h({ value, onChange, disabled }) {
  return (
    <div className={styles.timeGroup}>
      <select
        className={styles.timeSelect}
        value={value.hour}
        onChange={(e) => onChange({ ...value, hour: e.target.value })}
        disabled={disabled}
      >
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className={styles.timeColon}>:</span>
      <select
        className={styles.timeSelect}
        value={value.minute}
        onChange={(e) => onChange({ ...value, minute: e.target.value })}
        disabled={disabled}
      >
        {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <div className={styles.ampmWrap}>
        <PMSelect
          options={AMPM_OPTIONS}
          value={value.ampm}
          onChange={(v) => onChange({ ...value, ampm: v })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
