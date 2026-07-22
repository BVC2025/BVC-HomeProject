import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, Loader } from "../components/pm";
import { aiModuleService } from "../services/aiModuleService";
import { useToast } from "../hooks/useToast";
import styles from "./AIPlatformShared.module.css";

export default function AISettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await aiModuleService.getSettings();
      setSettings(res.data);
    } catch {
      toast.showError("Failed to load AI settings");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [load]);

  return (
    <div className={styles.page}>
      <PageHeader title="AI Settings" subtitle="Global RAG platform configuration" onRefresh={load} />

      {loading ? (
        <Loader />
      ) : (
        <div className={styles.tableSection}>
          <div className={styles.tableWrap} style={{ padding: "var(--sp-4)" }}>
            <div className={styles.formStack}>
              <div className={styles.formGroup}>
                <label>Vector Database (Qdrant)</label>
                <input className={styles.input} value={settings?.qdrant_url || ""} disabled />
              </div>
              <div className={styles.formGroup}>
                <label>Embedding Model</label>
                <input className={styles.input} value={settings?.embedding_model || ""} disabled />
              </div>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Module</th>
                  <th>LLM Model</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(settings?.modules || []).map((m) => (
                  <tr key={m.ID}>
                    <td className={styles.nameCell}>{m.MODULE_NAME}</td>
                    <td>{m.LLM_MODEL}</td>
                    <td>
                      <span className={m.IS_ACTIVE ? styles.badgeActive : styles.badgeInactive}>
                        {m.IS_ACTIVE ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted} style={{ fontSize: "var(--font-xs)" }}>
            Per-module LLM model can be changed from the AI Modules page.
          </p>
        </div>
      )}
    </div>
  );
}
