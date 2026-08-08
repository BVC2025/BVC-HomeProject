/**
 * Pure, React-free schema-resolution helpers shared by PMEntityFormModal and
 * PMEntityDetailsModal, so conditional field logic (visible/required/disabled/
 * helperText depending on other field values) is written once and never
 * duplicated between the two modals.
 *
 * Field shape (see PMEntityFormModal.jsx / PMEntityDetailsModal.jsx for the
 * full per-component field contract):
 *   { name, label, section, fullWidth,
 *     visible:  true | (values, ctx) => bool,
 *     required: false | (values, ctx) => bool,
 *     disabled: false | (values, ctx) => bool,
 *     helperText: "" | (values, ctx) => string }
 *
 * ctx = { mode: "add" | "edit", saving }
 */

export function isFieldVisible(field, values, ctx) {
  if (typeof field.visible === "function") return !!field.visible(values, ctx);
  return field.visible !== false;
}

export function isFieldRequired(field, values, ctx) {
  if (typeof field.required === "function") return !!field.required(values, ctx);
  return !!field.required;
}

export function isFieldDisabled(field, values, ctx) {
  if (typeof field.disabled === "function") return !!field.disabled(values, ctx);
  return !!field.disabled;
}

export function resolveHelperText(field, values, ctx) {
  if (typeof field.helperText === "function") return field.helperText(values, ctx) || "";
  return field.helperText || "";
}

export function resolveOptions(field, values) {
  if (typeof field.options === "function") return field.options(values) || [];
  return field.options || [];
}

/**
 * Groups a flat schema array into an ordered list of { section, fields }
 * buckets, merging consecutive entries that share the same `section` value
 * (fields without a section, or with a section identical to the previous
 * field's, stay in the same bucket — this preserves schema authoring order,
 * it does not sort/group by section name globally).
 */
export function groupBySection(schema) {
  const groups = [];
  for (const field of schema) {
    const last = groups[groups.length - 1];
    if (last && last.section === field.section) {
      last.fields.push(field);
    } else {
      groups.push({ section: field.section, fields: [field] });
    }
  }
  return groups;
}
