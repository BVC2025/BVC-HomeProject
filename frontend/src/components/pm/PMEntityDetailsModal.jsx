import React, { useMemo } from "react";
import PMModal from "./PMModal";
import PMButton from "./PMButton";
import { isFieldVisible, groupBySection } from "./pmFormSchema";
import styles from "./PMEntityDetailsModal.module.css";

/**
 * Generic, schema-driven read-only Details modal. Kept as a separate
 * component from PMEntityFormModal (not a "readOnly" mode of it) — merging
 * them back together would just relocate the "one PMModal juggling
 * modal==='view' checks everywhere" pattern this pair of components exists
 * to replace.
 *
 * `extraSections` is the extensibility point for domain-specific content
 * (e.g. the WhatsApp Sample Message Preview) that the generic component
 * itself has no knowledge of.
 */

const DetailFieldRow = React.memo(function DetailFieldRow({ field, value, values }) {
  const rowClass = field.fullWidth ? `${styles.detailGroup} ${styles.fullWidth}` : styles.detailGroup;
  const display = field.format
    ? field.format(value, values)
    : value === null || value === undefined || value === ""
    ? "—"
    : String(value);

  return (
    <div className={rowClass}>
      <span className={styles.detailLabel}>{field.label}</span>
      <span className={styles.detailValue}>{display}</span>
    </div>
  );
});

function PMEntityDetailsModal({
  open,
  onClose,
  title,
  size = "lg",
  schema,
  values = {},
  actions,
  extraSections = [],
}) {
  const groups = useMemo(() => groupBySection(schema), [schema]);

  const footer = (
    <div className={styles.footer}>
      {actions && <div className={styles.footerActions}>{actions}</div>}
      <PMButton variant="outline" onClick={onClose}>
        Close
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
              if (!isFieldVisible(field, values, {})) return null;
              return (
                <DetailFieldRow key={field.name} field={field} value={values[field.name]} values={values} />
              );
            })}
          </React.Fragment>
        ))}

        {extraSections.map((section, i) => (
          <div key={section.key || i} className={styles.extraSection}>
            {section.title && <div className={styles.sectionTitle}>{section.title}</div>}
            {section.render(values)}
          </div>
        ))}
      </div>
    </PMModal>
  );
}

export default React.memo(PMEntityDetailsModal);
