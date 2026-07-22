import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, StatsRow, PMModal, EmptyState, Loader, PMButton, PMConfirmModal } from "../components/pm";
import { aiModuleService } from "../services/aiModuleService";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import styles from "./AIPlatformShared.module.css";

export default function AIModulesPage() {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ DESCRIPTION: "", LLM_MODEL: "", IS_ACTIVE: true });
  const [saving, setSaving] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res = await aiModuleService.getAll();
      setModules(res.data || []);
    } catch {
      toast.showError("Failed to load AI modules");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [load]);

  const stats = useMemo(() => [
    { value: modules.length, label: "Total Modules" },
    { value: modules.filter((m) => m.IS_ACTIVE).length, label: "Active" },
  ], [modules]);

  const openEdit = useCallback((m) => {
    setEditing(m);
    setForm({ DESCRIPTION: m.DESCRIPTION || "", LLM_MODEL: m.LLM_MODEL || "", IS_ACTIVE: m.IS_ACTIVE });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await aiModuleService.update(editing.ID, form);
      toast.showSuccess("Module updated");
      setEditing(null);
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [editing, form, toast, load]);

  const handleDeactivate = useCallback((m) => {
    setConfirmModal({
      title: "Deactivate Module",
      description: `Deactivate "${m.MODULE_NAME}"? Its chat endpoint will stop answering until reactivated.`,
      onConfirm: async () => {
        try {
          await aiModuleService.deactivate(m.ID);
          toast.showSuccess("Module deactivated");
          load(true);
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Deactivate failed");
        }
      },
    });
  }, [toast, load]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="AI Modules"
        subtitle="Every AI Assistant registered on the common RAG platform"
        onRefresh={() => load(true)}
        refreshing={refreshing}
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Module</th>
                <th>Code</th>
                <th>Collection</th>
                <th>LLM Model</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><Loader /></td></tr>
              ) : modules.length === 0 ? (
                <tr><td colSpan={8}><EmptyState title="No AI modules yet" /></td></tr>
              ) : (
                modules.map((m, i) => (
                  <tr key={m.ID}>
                    <td className={styles.idx}>{i + 1}</td>
                    <td className={styles.nameCell}>{m.MODULE_NAME}</td>
                    <td>{m.MODULE_CODE}</td>
                    <td>{m.VECTOR_COLLECTION_NAME}</td>
                    <td>{m.LLM_MODEL}</td>
                    <td>
                      <span className={m.IS_ACTIVE ? styles.badgeActive : styles.badgeInactive}>
                        {m.IS_ACTIVE ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{formatDateTime(m.CREATED_AT)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} title="Edit" onClick={() => openEdit(m)}>✎</button>
                        {m.IS_ACTIVE && (
                          <button className={styles.iconBtnDanger} title="Deactivate" onClick={() => handleDeactivate(m)}>⏸</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PMModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.MODULE_NAME || ""}`}
        size="sm"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setEditing(null)}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>Description</label>
            <textarea
              className={styles.textarea}
              value={form.DESCRIPTION}
              onChange={(e) => setForm((f) => ({ ...f, DESCRIPTION: e.target.value }))}
              rows={3}
            />
          </div>
          <div className={styles.formGroup}>
            <label>LLM Model</label>
            <input
              className={styles.input}
              value={form.LLM_MODEL}
              onChange={(e) => setForm((f) => ({ ...f, LLM_MODEL: e.target.value }))}
            />
          </div>
          <div className={styles.formGroup}>
            <label>
              <input
                type="checkbox"
                checked={form.IS_ACTIVE}
                onChange={(e) => setForm((f) => ({ ...f, IS_ACTIVE: e.target.checked }))}
              />{" "}
              Active
            </label>
          </div>
        </div>
      </PMModal>

      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => {})}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
      />
    </div>
  );
}
