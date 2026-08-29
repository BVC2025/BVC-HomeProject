import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PageHeader, PMModal, SearchBar, EmptyState, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { paymentMilestoneService } from "../services/paymentMilestoneService";
import { useToast } from "../hooks/useToast";
import ProjectIcon from "../assets/Icons/projectIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import styles from "./PaymentMilestonePage.module.css";

const EMPTY_FORM = {
  MILESTONE_NAME: "", MILESTONE_ORDER: 0,
  PROJECT_COMPLETION_TRIGGER_PERCENTAGE: "0", REQUIRED_PAYMENT_PERCENTAGE: "",
  DESCRIPTION: "", IS_ACTIVE: true,
};

const GRID_COLS = "28px 40px minmax(0,1fr) 130px 130px minmax(0,1.2fr) 100px 100px";

/** Common, vendor-level Payment Milestone configuration — shared across
 * every Customer Lead Project for this vendor (no longer configured
 * per-project; see project_milestone_models.PaymentMilestone). Mirrors
 * TaskTemplatePage.jsx's list/modal/drag-reorder shape, minus the project
 * picker, since there's now exactly one shared list to manage. */
export default function PaymentMilestonePage() {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

  const toast = useToast();

  const loadMilestones = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await paymentMilestoneService.getAll();
      setMilestones(res.data || []);
    } catch {
      toast.showError("Failed to load payment milestones");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadMilestones(); }, [loadMilestones]);

  const handleRefresh = useCallback(() => loadMilestones(true), [loadMilestones]);

  const filtered = useMemo(() => {
    if (!search.trim()) return milestones;
    const t = search.toLowerCase();
    return milestones.filter((m) => m.MILESTONE_NAME?.toLowerCase().includes(t));
  }, [milestones, search]);

  // Sum of REQUIRED_PAYMENT_PERCENTAGE across every OTHER active milestone
  // (excluding the one currently being edited) — the live total shown
  // under the field as the admin types, and the basis for the ≤100% check.
  const otherActiveSum = useMemo(
    () => milestones
      .filter((m) => m.IS_ACTIVE && m.ID !== editId)
      .reduce((sum, m) => sum + Number(m.REQUIRED_PAYMENT_PERCENTAGE || 0), 0),
    [milestones, editId]
  );

  const projectedTotal = useMemo(() => {
    const pct = parseFloat(form.REQUIRED_PAYMENT_PERCENTAGE);
    if (Number.isNaN(pct) || !form.IS_ACTIVE) return otherActiveSum;
    return otherActiveSum + pct;
  }, [otherActiveSum, form.REQUIRED_PAYMENT_PERCENTAGE, form.IS_ACTIVE]);

  const openAdd = useCallback(() => {
    setForm({ ...EMPTY_FORM, MILESTONE_ORDER: milestones.length });
    setFormErrors({});
    setEditId(null);
    setModal("milestone");
  }, [milestones.length]);

  const openEdit = useCallback((m) => {
    setForm({
      MILESTONE_NAME: m.MILESTONE_NAME,
      MILESTONE_ORDER: m.MILESTONE_ORDER,
      PROJECT_COMPLETION_TRIGGER_PERCENTAGE: String(m.PROJECT_COMPLETION_TRIGGER_PERCENTAGE),
      REQUIRED_PAYMENT_PERCENTAGE: String(m.REQUIRED_PAYMENT_PERCENTAGE),
      DESCRIPTION: m.DESCRIPTION || "",
      IS_ACTIVE: !!m.IS_ACTIVE,
    });
    setFormErrors({});
    setEditId(m.ID);
    setModal("milestone");
  }, []);

  const closeModal = useCallback(() => { setModal(null); setEditId(null); }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    setFormErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }, []);

  // Mirrors the backend's own validation exactly (payment_milestone.py) so
  // the admin sees the same rules immediately, before ever hitting Save.
  const validate = useCallback(() => {
    const errors = {};
    if (!form.MILESTONE_NAME.trim()) errors.MILESTONE_NAME = "Milestone name is required";

    const trigger = parseFloat(form.PROJECT_COMPLETION_TRIGGER_PERCENTAGE);
    if (Number.isNaN(trigger) || trigger < 0 || trigger > 100) {
      errors.PROJECT_COMPLETION_TRIGGER_PERCENTAGE = "Must be between 0 and 100";
    }

    const required = parseFloat(form.REQUIRED_PAYMENT_PERCENTAGE);
    if (Number.isNaN(required) || required <= 0 || required > 100) {
      errors.REQUIRED_PAYMENT_PERCENTAGE = "Must be between 1 and 100";
    } else if (form.IS_ACTIVE && otherActiveSum + required > 100) {
      errors.REQUIRED_PAYMENT_PERCENTAGE =
        `Combined with other active milestones (${otherActiveSum.toFixed(2)}%), this would total ` +
        `${(otherActiveSum + required).toFixed(2)}% — the total cannot exceed 100%.`;
    }

    const order = parseInt(form.MILESTONE_ORDER, 10);
    const dup = milestones.find((m) => m.ID !== editId && m.MILESTONE_ORDER === order);
    if (dup) errors.MILESTONE_ORDER = `Order ${order} is already used by "${dup.MILESTONE_NAME}"`;

    if (!Number.isNaN(trigger) && form.IS_ACTIVE) {
      for (const other of milestones) {
        if (other.ID === editId || !other.IS_ACTIVE) continue;
        const otherTrigger = Number(other.PROJECT_COMPLETION_TRIGGER_PERCENTAGE);
        if (other.MILESTONE_ORDER < order && otherTrigger > trigger) {
          errors.PROJECT_COMPLETION_TRIGGER_PERCENTAGE =
            `Must not be lower than "${other.MILESTONE_NAME}" (order ${other.MILESTONE_ORDER}), which triggers at ${otherTrigger.toFixed(2)}%`;
          break;
        }
        if (other.MILESTONE_ORDER > order && otherTrigger < trigger) {
          errors.PROJECT_COMPLETION_TRIGGER_PERCENTAGE =
            `Must not be higher than "${other.MILESTONE_NAME}" (order ${other.MILESTONE_ORDER}), which triggers at ${otherTrigger.toFixed(2)}%`;
          break;
        }
      }
    }

    return errors;
  }, [form, milestones, editId, otherActiveSum]);

  const handleSave = useCallback(async () => {
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.showWarning("Please fix the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        MILESTONE_NAME: form.MILESTONE_NAME,
        MILESTONE_ORDER: parseInt(form.MILESTONE_ORDER) || 0,
        PROJECT_COMPLETION_TRIGGER_PERCENTAGE: parseFloat(form.PROJECT_COMPLETION_TRIGGER_PERCENTAGE),
        REQUIRED_PAYMENT_PERCENTAGE: parseFloat(form.REQUIRED_PAYMENT_PERCENTAGE),
        DESCRIPTION: form.DESCRIPTION || null,
        IS_ACTIVE: !!form.IS_ACTIVE,
      };
      if (editId) {
        await paymentMilestoneService.update(editId, payload);
        toast.showSuccess("Payment milestone updated");
      } else {
        await paymentMilestoneService.create(payload);
        toast.showSuccess("Payment milestone created");
      }
      closeModal();
      loadMilestones();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, editId, validate, closeModal, loadMilestones, toast]);

  const handleDelete = useCallback((m) => {
    setConfirmModal({
      title: "Delete Payment Milestone",
      description: `Delete milestone "${m.MILESTONE_NAME}"? This applies to every Customer Lead Project for this vendor and cannot be undone.`,
      onConfirm: async () => {
        try {
          await paymentMilestoneService.remove(m.ID);
          toast.showSuccess("Payment milestone deleted");
          loadMilestones();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [loadMilestones, toast]);

  const onDragStart = useCallback((idx) => setDragIdx(idx), []);
  const onDragOver = useCallback((e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setMilestones((prev) => {
      const a = [...prev];
      const [r] = a.splice(dragIdx, 1);
      a.splice(idx, 0, r);
      setDragIdx(idx);
      return a;
    });
  }, [dragIdx]);

  const onDragEnd = useCallback(async () => {
    setDragIdx(null);
    if (milestones.length === 0) return;
    setReordering(true);
    try {
      await paymentMilestoneService.reorder(
        milestones.map((m, i) => ({ id: m.ID, milestone_order: i }))
      );
    } catch {
      toast.showError("Reorder failed");
      loadMilestones();
    } finally {
      setReordering(false);
    }
  }, [milestones, loadMilestones, toast]);

  const activeSum = useMemo(
    () => milestones.filter((m) => m.IS_ACTIVE).reduce((s, m) => s + Number(m.REQUIRED_PAYMENT_PERCENTAGE || 0), 0),
    [milestones]
  );

  return (
    <div className={styles.page}>
      <PageHeader
        icon={ProjectIcon}
        iconAlt="Payment Milestones"
        title="Payment Milestones"
        subtitle="Common configuration shared across all Customer Lead Projects for this vendor"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={<PMButton variant="primary" onClick={openAdd}>Add Milestone</PMButton>}
      />

      <div className={styles.body}>
        <div className={styles.selectorCard}>
          <div className={styles.projectMeta}>
            <span className={styles.taskCount}>{milestones.length} milestone{milestones.length !== 1 ? "s" : ""}</span>
            <span className={activeSum > 100 ? styles.sumWarning : styles.sumOk}>
              {activeSum.toFixed(2)}% of 100% required payment configured (active milestones)
            </span>
            {reordering && <span className={styles.reorderHint}>Saving order…</span>}
          </div>
        </div>

        <div className={styles.taskSection}>
          <div className={styles.toolbar}>
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search milestones…"
            />
            <span className={styles.count}>{filtered.length} milestone{filtered.length !== 1 ? "s" : ""}</span>
          </div>

          {loading ? (
            <Loader />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ProjectIcon}
              iconAlt="Payment Milestones"
              title={search ? "No milestones match your search" : "No payment milestones configured"}
              description={!search ? "Click '+ Add Milestone' to define the first payment threshold." : undefined}
              action={
                !search && (
                  <PMButton variant="primary" onClick={openAdd}>+ Add Milestone</PMButton>
                )
              }
            />
          ) : (
            <div className={styles.taskList}>
              <div className={styles.taskListHead} style={{ gridTemplateColumns: GRID_COLS }}>
                <span className={styles.thDrag} />
                <span className={styles.thSeq}>#</span>
                <span className={styles.thName}>Milestone Name</span>
                <span>Completion Trigger</span>
                <span>Required Payment</span>
                <span>Description</span>
                <span>Active</span>
                <span className={styles.thAct}>Actions</span>
              </div>
              {filtered.map((m) => {
                const idx = milestones.findIndex((x) => x.ID === m.ID);
                return (
                  <div
                    key={m.ID}
                    className={`${styles.taskCard} ${dragIdx === idx ? styles.dragging : ""}`}
                    style={{ gridTemplateColumns: GRID_COLS }}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDragEnd={onDragEnd}
                  >
                    <span className={styles.dragHandle}>⠿</span>
                    <span className={styles.seqNum}>{m.MILESTONE_ORDER + 1}</span>
                    <span className={styles.taskName}>{m.MILESTONE_NAME}</span>
                    <span className={styles.durBadge}>{Number(m.PROJECT_COMPLETION_TRIGGER_PERCENTAGE).toFixed(2)}%</span>
                    <span className={styles.durBadge}>{Number(m.REQUIRED_PAYMENT_PERCENTAGE).toFixed(2)}%</span>
                    <span className={styles.deptText}>{m.DESCRIPTION || <span className={styles.muted}>—</span>}</span>
                    <span>
                      <span className={`${styles.activePill} ${m.IS_ACTIVE ? styles.activePillOn : styles.activePillOff}`}>
                        {m.IS_ACTIVE ? "Active" : "Inactive"}
                      </span>
                    </span>
                    <div className={styles.taskActions}>
                      <button className={styles.iconBtn} onClick={() => openEdit(m)} title="Edit">
                        <img src={EditIcon} alt="Edit" />
                      </button>
                      <button className={styles.iconBtnDanger} onClick={() => handleDelete(m)} title="Delete">
                        <img src={DeleteIcon} alt="Delete" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      <PMModal
        open={modal === "milestone"}
        onClose={closeModal}
        title={editId ? "Edit Payment Milestone" : "Add Payment Milestone"}
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editId ? "Save Changes" : "Add Milestone"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Milestone Name <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input}${formErrors.MILESTONE_NAME ? " " + styles.inputError : ""}`}
              value={form.MILESTONE_NAME}
              onChange={(e) => handleFormChange("MILESTONE_NAME", e.target.value)}
              placeholder="e.g. Initial Payment"
            />
            {formErrors.MILESTONE_NAME && <span className={styles.fieldError}>{formErrors.MILESTONE_NAME}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Milestone Order</label>
            <input
              className={`${styles.input}${formErrors.MILESTONE_ORDER ? " " + styles.inputError : ""}`}
              type="number"
              min={0}
              value={form.MILESTONE_ORDER}
              onChange={(e) => handleFormChange("MILESTONE_ORDER", e.target.value)}
            />
            {formErrors.MILESTONE_ORDER && <span className={styles.fieldError}>{formErrors.MILESTONE_ORDER}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Project Completion Trigger % <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input}${formErrors.PROJECT_COMPLETION_TRIGGER_PERCENTAGE ? " " + styles.inputError : ""}`}
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={form.PROJECT_COMPLETION_TRIGGER_PERCENTAGE}
              onChange={(e) => handleFormChange("PROJECT_COMPLETION_TRIGGER_PERCENTAGE", e.target.value)}
              placeholder="e.g. 0"
            />
            <span className={styles.hint}>Project completion % at which this milestone becomes due.</span>
            {formErrors.PROJECT_COMPLETION_TRIGGER_PERCENTAGE && (
              <span className={styles.fieldError}>{formErrors.PROJECT_COMPLETION_TRIGGER_PERCENTAGE}</span>
            )}
          </div>
          <div className={styles.formGroup}>
            <label>Required Payment % <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input}${formErrors.REQUIRED_PAYMENT_PERCENTAGE ? " " + styles.inputError : ""}`}
              type="number"
              min={1}
              max={100}
              step={0.01}
              value={form.REQUIRED_PAYMENT_PERCENTAGE}
              onChange={(e) => handleFormChange("REQUIRED_PAYMENT_PERCENTAGE", e.target.value)}
              placeholder="e.g. 50"
            />
            <span className={projectedTotal > 100 ? styles.sumWarning : styles.hint}>
              Total across all active milestones: {projectedTotal.toFixed(2)}% / 100%
            </span>
            {formErrors.REQUIRED_PAYMENT_PERCENTAGE && (
              <span className={styles.fieldError}>{formErrors.REQUIRED_PAYMENT_PERCENTAGE}</span>
            )}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Description</label>
            <textarea
              className={styles.textarea}
              value={form.DESCRIPTION}
              onChange={(e) => handleFormChange("DESCRIPTION", e.target.value)}
              placeholder="e.g. Initial payment required before project work begins."
              rows={3}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth} ${styles.checkboxRow}`}>
            <input
              type="checkbox"
              id="milestoneActive"
              checked={form.IS_ACTIVE}
              onChange={(e) => handleFormChange("IS_ACTIVE", e.target.checked)}
            />
            <label htmlFor="milestoneActive" style={{ margin: 0 }}>Active</label>
          </div>
        </div>
      </PMModal>

      {/* Delete Confirmation */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => { })}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
