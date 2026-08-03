import PMSelect from "./PMSelect";
import styles from "./CustomFieldsSection.module.css";

function renderInput(field, value, onChange) {
  const v = value ?? "";
  const onChg = (e) => onChange(field.ID, e.target.value);

  switch (field.FIELD_TYPE) {
    case "TEXT":
      return <input type="text" className={styles.input} value={v} onChange={onChg} placeholder={field.FIELD_NAME} />;
    case "NUMBER":
      return <input type="number" className={styles.input} value={v} onChange={onChg} placeholder="0" />;
    case "DATE":
      return <input type="date" className={styles.input} value={v} onChange={onChg} />;
    case "DATETIME":
      return <input type="datetime-local" className={styles.input} value={v} onChange={onChg} />;
    case "EMAIL":
      return <input type="email" className={styles.input} value={v} onChange={onChg} placeholder="email@example.com" />;
    case "PHONE":
      return <input type="tel" className={styles.input} value={v} onChange={onChg} placeholder="+91 98765 43210" />;
    case "TEXTAREA":
      return (
        <textarea
          className={styles.textarea}
          value={v}
          onChange={onChg}
          placeholder={field.FIELD_NAME}
          rows={3}
        />
      );
    case "CHECKBOX": {
      const opts = Array.isArray(field.OPTIONS) ? field.OPTIONS : [];
      const sel = Array.isArray(value) ? value : [];
      return (
        <div className={styles.checkGroup}>
          {opts.map((opt) => (
            <label key={opt} className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={sel.includes(opt)}
                onChange={(e) => {
                  const next = e.target.checked ? [...sel, opt] : sel.filter((s) => s !== opt);
                  onChange(field.ID, next);
                }}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      );
    }
    case "RADIO": {
      const opts = Array.isArray(field.OPTIONS) ? field.OPTIONS : [];
      return (
        <div className={styles.radioGroup}>
          {opts.map((opt) => (
            <label key={opt} className={styles.radioLabel}>
              <input
                type="radio"
                name={`cf_${field.ID}`}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(field.ID, opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      );
    }
    case "SELECT": {
      const opts = Array.isArray(field.OPTIONS)
        ? field.OPTIONS.map((o) => ({ value: o, label: o }))
        : [];
      return (
        <PMSelect
          options={opts}
          value={v}
          onChange={(val) => onChange(field.ID, val)}
          allowClear
          clearLabel="— Select —"
        />
      );
    }
    default:
      return <input type="text" className={styles.input} value={v} onChange={onChg} />;
  }
}

export default function CustomFieldsSection({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div className={styles.section}>
      <div className={styles.divider}>
        <span className={styles.dividerLabel}>Additional Fields</span>
      </div>
      {fields.map((field) => (
        <div key={field.ID} className={styles.field}>
          <label className={styles.label}>
            {field.FIELD_NAME}
            {field.IS_REQUIRED && <span className={styles.req}> *</span>}
          </label>
          {renderInput(field, values[field.ID], onChange)}
        </div>
      ))}
    </div>
  );
}
