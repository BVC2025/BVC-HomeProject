import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import PMModal from "./PMModal";
import PMButton from "./PMButton";
import PMSelect from "./PMSelect";
import styles from "./CustomFieldsModal.module.css";
import { customFieldService } from "../../services/customFieldService";
import { useToast } from "../../hooks/useToast";

const FIELD_TYPES = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
  { value: "DATE", label: "Date" },
  { value: "DATETIME", label: "Date & Time" },
  { value: "CHECKBOX", label: "Checkbox" },
  { value: "RADIO", label: "Radio" },
  { value: "SELECT", label: "Dropdown" },
  { value: "TEXTAREA", label: "Text Area" },
  { value: "EMAIL", label: "Email" },
];

const HAS_OPTIONS = ["CHECKBOX", "RADIO", "SELECT"];

const EMPTY_FORM = {
  FIELD_NAME: "",
  FIELD_TYPE: "TEXT",
  OPTIONS: "",
  IS_REQUIRED: false,
  SORT_ORDER: 0,
};

function SwapConfirmPortal({ open, onClose, onConfirm, existingFieldName, sortOrder }) {
  if (!open) return null;
  return createPortal(
    <div className={styles.swapOverlay} onClick={onClose}>
      <div className={styles.swapModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.swapIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className={styles.swapTitle}>Sort Order Conflict</div>
        <div className={styles.swapDesc}>
          Sort order <strong>{sortOrder}</strong> is already used by <strong>"{existingFieldName}"</strong>.
          Do you want to swap the sort orders?
        </div>
        <div className={styles.swapFooter}>
          <PMButton variant="outline" onClick={onClose}>Cancel</PMButton>
          <PMButton variant="primary" onClick={() => { onConfirm(); onClose(); }}>Swap</PMButton>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CustomFieldsModal({ open, onClose, tableName }) {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [swapTarget, setSwapTarget] = useState(null);
  const toast = useToast();
  const didFetch = useRef(false);
  const pendingSaveRef = useRef(null);

  const fetchFields = useCallback(async () => {
    if (!tableName) return;
    setLoading(true);
    try {
      const res = await customFieldService.getFields(tableName);
      setFields(res.data || []);
    } catch {
      toast.showError("Failed to load custom fields");
    } finally {
      setLoading(false);
    }
  }, [tableName]);

  useEffect(() => {
    if (open && !didFetch.current) {
      didFetch.current = true;
      fetchFields();
    }
    if (!open) didFetch.current = false;
  }, [open, fetchFields]);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(false);
    pendingSaveRef.current = null;
  }, []);

  const handleEdit = useCallback((f) => {
    setForm({
      FIELD_NAME: f.FIELD_NAME,
      FIELD_TYPE: f.FIELD_TYPE,
      OPTIONS: Array.isArray(f.OPTIONS) ? f.OPTIONS.join(", ") : (f.OPTIONS || ""),
      IS_REQUIRED: f.IS_REQUIRED || false,
      SORT_ORDER: f.SORT_ORDER ?? 0,
    });
    setEditId(f.ID);
    setShowForm(true);
  }, []);

  const doSave = useCallback(async (payload, isSwap = false) => {
    setSaving(true);
    try {
      if (editId) {
        await customFieldService.updateField(editId, payload);
        toast.showSuccess("Field updated");
      } else {
        await customFieldService.createField(payload);
        toast.showSuccess("Field created");
      }
      await fetchFields();
      resetForm();
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [editId, tableName, fetchFields, resetForm, toast]);

  const handleSave = useCallback(async () => {
    if (!form.FIELD_NAME.trim()) {
      toast.showWarning("Field name is required");
      return;
    }
    const sortOrder = Number(form.SORT_ORDER) || 0;
    const payload = {
      TABLE_NAME: tableName,
      FIELD_NAME: form.FIELD_NAME.trim(),
      FIELD_TYPE: form.FIELD_TYPE,
      IS_REQUIRED: form.IS_REQUIRED,
      SORT_ORDER: sortOrder,
      OPTIONS: HAS_OPTIONS.includes(form.FIELD_TYPE)
        ? form.OPTIONS.split(",").map((s) => s.trim()).filter(Boolean)
        : null,
    };

    // Check for duplicate sort order
    const conflict = fields.find(
      (f) => f.SORT_ORDER === sortOrder && f.ID !== editId
    );

    if (conflict) {
      if (!editId) {
        // Creating: no duplicates allowed
        toast.showWarning(`Sort order ${sortOrder} is already used by "${conflict.FIELD_NAME}". Please use a different sort order.`);
        return;
      }
      // Editing: offer swap
      pendingSaveRef.current = { payload, conflictId: conflict.ID, conflictOrder: fields.find(f => f.ID === editId)?.SORT_ORDER ?? 0 };
      setSwapTarget({ name: conflict.FIELD_NAME, sortOrder });
      return;
    }

    await doSave(payload);
  }, [form, editId, tableName, fields, toast, doSave]);

  const handleSwapConfirm = useCallback(async () => {
    const { payload, conflictId, conflictOrder } = pendingSaveRef.current || {};
    if (!payload || !conflictId) return;
    setSaving(true);
    try {
      // Swap: first set the conflicting field to the current field's old sort order
      await customFieldService.updateField(conflictId, { SORT_ORDER: conflictOrder });
      // Then save the current field
      await customFieldService.updateField(editId, payload);
      toast.showSuccess("Sort orders swapped successfully");
      await fetchFields();
      resetForm();
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Swap failed");
    } finally {
      setSaving(false);
      pendingSaveRef.current = null;
    }
  }, [editId, fetchFields, resetForm, toast]);

  const handleDelete = useCallback(async (id) => {
    try {
      await customFieldService.deleteField(id);
      toast.showSuccess("Field deleted");
      setFields((prev) => prev.filter((f) => f.ID !== id));
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Delete failed");
    }
  }, [toast]);

  const filtered = fields.filter((f) =>
    f.FIELD_NAME?.toLowerCase().includes(search.toLowerCase())
  );

  // Sort filtered by SORT_ORDER
  const sortedFiltered = [...filtered].sort((a, b) => a.SORT_ORDER - b.SORT_ORDER);

  return (
    <>
      <PMModal
        open={open}
        onClose={onClose}
        title="Manage Custom Fields"
        size="lg"
        footer={
          showForm ? (
            <>
              <PMButton variant="outline" onClick={resetForm} disabled={saving}>Cancel</PMButton>
              <PMButton variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : editId ? "Update Field" : "Add Field"}
              </PMButton>
            </>
          ) : (
            <PMButton
              variant="primary"
              onClick={() => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); }}
            >
              + Add Field
            </PMButton>
          )
        }
      >
        <div className={styles.content}>
          {showForm && (
            <div className={styles.formBox}>
              <h3 className={styles.formTitle}>{editId ? "Edit Field" : "New Field"}</h3>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>Field Name <span className={styles.req}>*</span></label>
                  <input
                    className={styles.input}
                    value={form.FIELD_NAME}
                    onChange={(e) => handleFormChange("FIELD_NAME", e.target.value)}
                    placeholder="e.g. Client Code"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Field Type</label>
                  <PMSelect
                    options={FIELD_TYPES}
                    value={form.FIELD_TYPE}
                    onChange={(val) => handleFormChange("FIELD_TYPE", val)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Sort Order <span className={styles.hint}>(lower = first)</span></label>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    value={form.SORT_ORDER}
                    onChange={(e) => handleFormChange("SORT_ORDER", e.target.value)}
                  />
                </div>
                <div className={`${styles.formGroup} ${styles.checkRow}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.IS_REQUIRED}
                      onChange={(e) => handleFormChange("IS_REQUIRED", e.target.checked)}
                    />
                    Required field
                  </label>
                </div>
              </div>
              {HAS_OPTIONS.includes(form.FIELD_TYPE) && (
                <div className={styles.formGroup}>
                  <label>Options <span className={styles.hint}>(comma-separated)</span></label>
                  <input
                    className={styles.input}
                    value={form.OPTIONS}
                    onChange={(e) => handleFormChange("OPTIONS", e.target.value)}
                    placeholder="Option 1, Option 2, Option 3"
                  />
                </div>
              )}
            </div>
          )}

          <div className={styles.listSection}>
            <div className={styles.listHeader}>
              <span className={styles.listTitle}>
                {filtered.length} field{filtered.length !== 1 ? "s" : ""}
              </span>
              <input
                className={styles.searchInput}
                placeholder="Search fields…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {loading ? (
              <p className={styles.loading}>Loading…</p>
            ) : sortedFiltered.length === 0 ? (
              <p className={styles.empty}>No custom fields yet.</p>
            ) : (
              <div className={styles.fieldList}>
                {sortedFiltered.map((f) => (
                  <div key={f.ID} className={styles.fieldRow}>
                    <div className={styles.fieldInfo}>
                      <span className={styles.fieldName}>{f.FIELD_NAME}</span>
                      <span className={styles.fieldMeta}>
                        <span className={styles.typeBadge}>{f.FIELD_TYPE}</span>
                        {f.IS_REQUIRED && <span className={styles.reqBadge}>Required</span>}
                        <span className={styles.sortBadge}>#{f.SORT_ORDER}</span>
                      </span>
                    </div>
                    <div className={styles.fieldActions}>
                      <button className={styles.editBtn} onClick={() => handleEdit(f)} title="Edit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button className={styles.deleteBtn} onClick={() => handleDelete(f.ID)} title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PMModal>

      <SwapConfirmPortal
        open={!!swapTarget}
        onClose={() => { setSwapTarget(null); pendingSaveRef.current = null; }}
        onConfirm={handleSwapConfirm}
        existingFieldName={swapTarget?.name}
        sortOrder={swapTarget?.sortOrder}
      />
    </>
  );
}

export default React.memo(CustomFieldsModal);
