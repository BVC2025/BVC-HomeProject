import React, { useMemo, useState, useCallback } from "react";
import PMModal from "./PMModal";
import PMButton from "./PMButton";
import PMSelect from "./PMSelect";
import {
  isFieldVisible,
  isFieldRequired,
  isFieldDisabled,
  resolveHelperText,
  resolveOptions,
  groupBySection,
} from "./pmFormSchema";
import styles from "./PMEntityFormModal.module.css";

/**
 * Generic, schema-driven Add/Edit modal — the reusable replacement for
 * hand-rolling a one-off form inside PMModal on every management page.
 *
 * `schema` must be a module-level constant (defined once, outside any
 * component) so field-level predicate functions (required/visible/disabled/
 * helperText) are never reconstructed per render. See pmFormSchema.js for
 * the exact field shape.
 */

const PMFormFieldRow = React.memo(function PMFormFieldRow({
  field,
  value,
  error,
  required,
  disabled,
  helperText,
  options,
  onChange,
  onCheckboxChange,
}) {
  const [showSecret, setShowSecret] = useState(false);

  const rowClass = field.fullWidth ? `${styles.formGroup} ${styles.fullWidth}` : styles.formGroup;

  if (field.type === "checkbox") {
    return (
      <div className={rowClass}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={!!value}
            disabled={disabled}
            onChange={onCheckboxChange}
          />
          {field.label}
          {required && <span className={styles.req}> *</span>}
        </label>
        {helperText && <span className={styles.hint}>{helperText}</span>}
        {error && <span className={styles.fieldError}>{error}</span>}
      </div>
    );
  }

  return (
    <div className={rowClass}>
      <label>
        {field.label}
        {required && <span className={styles.req}> *</span>}
      </label>

      {field.type === "select" && (
        <PMSelect
          options={options}
          value={value ?? ""}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
          allowClear={!!field.allowClear}
          clearLabel={field.clearLabel}
        />
      )}

      {field.type === "textarea" && (
        <textarea
          className={styles.textarea}
          value={value ?? ""}
          disabled={disabled}
          placeholder={field.placeholder}
          rows={field.rows || 3}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "password" && (
        <div className={styles.passwordWrap}>
          <input
            type={showSecret ? "text" : "password"}
            className={`${styles.inputPassword} ${error ? styles.inputError : ""}`}
            value={value ?? ""}
            disabled={disabled}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className={styles.showPasswordBtn}
            onClick={() => setShowSecret((s) => !s)}
            tabIndex={-1}
          >
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
      )}

      {(field.type === "text" || field.type === "number" || field.type === "date") && (
        <input
          type={field.type}
          className={`${styles.input} ${error ? styles.inputError : ""}`}
          value={value ?? ""}
          disabled={disabled}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {helperText && <span className={styles.hint}>{helperText}</span>}
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
});

function PMEntityFormModal({
  open,
  onClose,
  title,
  size = "lg",
  mode,
  schema,
  values,
  errors = {},
  onFieldChange,
  saving = false,
  onSave,
  saveLabel,
  savingLabel,
  onCancel,
  footerExtra,
}) {
  const ctx = useMemo(() => ({ mode, saving }), [mode, saving]);

  const groups = useMemo(() => groupBySection(schema), [schema]);

  // One stable handler per field, built once per (schema, onFieldChange)
  // identity — avoids constructing a new inline closure per field per
  // render inside the .map() below.
  const fieldHandlers = useMemo(() => {
    const map = {};
    for (const field of schema) {
      map[field.name] = (val) => onFieldChange(field.name, val);
    }
    return map;
  }, [schema, onFieldChange]);

  const checkboxHandlers = useMemo(() => {
    const map = {};
    for (const field of schema) {
      map[field.name] = (e) => onFieldChange(field.name, e.target.checked);
    }
    return map;
  }, [schema, onFieldChange]);

  const handleCancel = useCallback(() => {
    (onCancel || onClose)();
  }, [onCancel, onClose]);

  const defaultSaveLabel = mode === "add" ? "Create" : "Save Changes";
  const defaultSavingLabel = "Saving…";

  const footer = (
    <div className={styles.footer}>
      {footerExtra && <div className={styles.footerExtra}>{footerExtra}</div>}
      <PMButton variant="outline" onClick={handleCancel} disabled={saving}>
        Cancel
      </PMButton>
      <PMButton variant="primary" onClick={onSave} loading={saving}>
        {saving ? (savingLabel || defaultSavingLabel) : (saveLabel || defaultSaveLabel)}
      </PMButton>
    </div>
  );

  return (
    <PMModal open={open} onClose={onClose} title={title} size={size} footer={footer}>
      <div className={styles.formGrid}>
        {groups.map((group, gi) => (
          <React.Fragment key={gi}>
            {group.section && <div className={styles.sectionTitle}>{group.section}</div>}
            {group.fields.map((field) => {
              if (!isFieldVisible(field, values, ctx)) return null;
              return (
                <PMFormFieldRow
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  error={errors[field.name]}
                  required={isFieldRequired(field, values, ctx)}
                  disabled={isFieldDisabled(field, values, ctx) || saving}
                  helperText={resolveHelperText(field, values, ctx)}
                  options={field.type === "select" ? resolveOptions(field, values) : undefined}
                  onChange={fieldHandlers[field.name]}
                  onCheckboxChange={checkboxHandlers[field.name]}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </PMModal>
  );
}

export default React.memo(PMEntityFormModal);
