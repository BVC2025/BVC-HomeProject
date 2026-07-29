import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, StatsRow, PMSelect, EmptyState, Loader } from "../components/pm";
import { aiModuleService } from "../services/aiModuleService";
import { aiTrainingJobService } from "../services/aiTrainingJobService";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import styles from "./AIPlatformShared.module.css";

const STATUS_BADGE = {
  PENDING: styles.badgePending,
  RUNNING: styles.badgeRunning,
  COMPLETED: styles.badgeCompleted,
  FAILED: styles.badgeFailed,
};

export default function AITrainingJobsPage() {
  const [modules, setModules] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [modRes, jobRes] = await Promise.all([
        aiModuleService.getAll(),
        aiTrainingJobService.getAll({
          module_code: modules.find((m) => m.ID === moduleFilter)?.MODULE_CODE,
          status: statusFilter || undefined,
        }),
      ]);
      setModules(modRes.data || []);
      setJobs(jobRes.data || []);
    } catch {
      if (!silent) toast.showError("Failed to load training jobs");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter, statusFilter]);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      load();
    }
  }, [load]);

  useEffect(() => {
    if (fetchedRef.current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter, statusFilter]);

  // Auto-poll every 5s while any job is PENDING/RUNNING, so status
  // transitions show up without a manual refresh.
  useEffect(() => {
    const hasActive = jobs.some((j) => j.STATUS === "PENDING" || j.STATUS === "RUNNING");
    if (!hasActive) return;
    const id = setInterval(() => load(true), 5000);
    return () => clearInterval(id);
  }, [jobs, load]);

  const moduleOptions = useMemo(() => modules.map((m) => ({ value: m.ID, label: m.MODULE_NAME })), [modules]);

  const stats = useMemo(() => [
    { value: jobs.length, label: "Total Jobs" },
    { value: jobs.filter((j) => j.STATUS === "RUNNING" || j.STATUS === "PENDING").length, label: "In Progress" },
    { value: jobs.filter((j) => j.STATUS === "COMPLETED").length, label: "Completed" },
    { value: jobs.filter((j) => j.STATUS === "FAILED").length, label: "Failed" },
  ], [jobs]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="AI Training Jobs"
        subtitle="Ingestion runs for uploaded knowledge base documents"
        onRefresh={() => load(true)}
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <div className={styles.filterGroup}>
            <PMSelect options={moduleOptions} value={moduleFilter} onChange={setModuleFilter} placeholder="All modules" allowClear size="sm" />
            <PMSelect options={["PENDING", "RUNNING", "COMPLETED", "FAILED"]} value={statusFilter} onChange={setStatusFilter} placeholder="All statuses" allowClear size="sm" />
          </div>
          <span className={styles.count}>{jobs.length} job{jobs.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Chunks</th>
                <th>Vectors</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}><Loader /></td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={7}><EmptyState title="No training jobs yet" /></td></tr>
              ) : (
                jobs.map((j, i) => (
                  <tr key={j.ID}>
                    <td className={styles.idx}>{i + 1}</td>
                    <td><span className={STATUS_BADGE[j.STATUS] || styles.badgePending}>{j.STATUS}</span></td>
                    <td>{j.TOTAL_CHUNKS}</td>
                    <td>{j.TOTAL_VECTORS}</td>
                    <td>{formatDateTime(j.STARTED_AT)}</td>
                    <td>{formatDateTime(j.COMPLETED_AT)}</td>
                    <td className={styles.descCell}>{j.ERROR_MESSAGE || <span className={styles.muted}>—</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
