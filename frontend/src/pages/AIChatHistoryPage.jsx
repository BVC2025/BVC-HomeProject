import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, StatsRow, PMSelect, EmptyState, Loader, ExportButton } from "../components/pm";
import { aiModuleService } from "../services/aiModuleService";
import { aiChatHistoryService } from "../services/aiChatHistoryService";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import { exportToExcel } from "../utils/exportExcel";
import styles from "./AIPlatformShared.module.css";

export default function AIChatHistoryPage() {
  const [modules, setModules] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const moduleCode = modules.find((m) => m.ID === moduleFilter)?.MODULE_CODE;
      const [modRes, histRes] = await Promise.all([
        aiModuleService.getAll(),
        aiChatHistoryService.getAll({
          module_code: moduleCode,
          created_from: filterFrom || undefined,
          created_to: filterTo || undefined,
        }),
      ]);
      setModules(modRes.data || []);
      setHistory(histRes.data || []);
    } catch {
      if (!silent) toast.showError("Failed to load chat history");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter, filterFrom, filterTo]);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      load();
    }
  }, [load]);

  useEffect(() => {
    if (fetchedRef.current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter, filterFrom, filterTo]);

  const moduleOptions = useMemo(() => modules.map((m) => ({ value: m.ID, label: m.MODULE_NAME })), [modules]);

  const stats = useMemo(() => {
    const withTiming = history.filter((h) => h.RESPONSE_TIME != null);
    const avgTime = withTiming.length
      ? (withTiming.reduce((s, h) => s + h.RESPONSE_TIME, 0) / withTiming.length).toFixed(2)
      : "—";
    const totalTokens = history.reduce((s, h) => s + (h.TOTAL_TOKENS || 0), 0);
    return [
      { value: history.length, label: "Total Conversations" },
      { value: avgTime, label: "Avg Response (s)" },
      { value: totalTokens, label: "Total Tokens" },
    ];
  }, [history]);

  const handleExport = useCallback(() => {
    const data = history.map((h, i) => ({
      "S.No": i + 1,
      Question: h.QUESTION,
      Answer: h.ANSWER,
      Model: h.MODEL_NAME,
      "Prompt Tokens": h.PROMPT_TOKENS,
      "Completion Tokens": h.COMPLETION_TOKENS,
      "Total Tokens": h.TOTAL_TOKENS,
      "Response Time (s)": h.RESPONSE_TIME,
      "Asked At": formatDateTime(h.CREATED_AT),
    }));
    exportToExcel(data, "ai_chat_history");
  }, [history]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="AI Chat History"
        subtitle="Every question asked to any AI Assistant, with tokens and response time"
        onRefresh={() => load(true)}
        actions={<ExportButton onClick={handleExport} disabled={history.length === 0} />}
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <div className={styles.filterGroup}>
            <PMSelect options={moduleOptions} value={moduleFilter} onChange={setModuleFilter} placeholder="All modules" allowClear size="sm" />
            <div className={styles.dateFilters}>
              <label className={styles.dateLabel}>From</label>
              <input type="datetime-local" className={styles.dateInput} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
              <label className={styles.dateLabel}>To</label>
              <input type="datetime-local" className={styles.dateInput} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
              {(filterFrom || filterTo) && (
                <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>
              )}
            </div>
          </div>
          <span className={styles.count}>{history.length} conversation{history.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Model</th>
                <th>Tokens</th>
                <th>Response Time</th>
                <th>Asked</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}><Loader /></td></tr>
              ) : history.length === 0 ? (
                <tr><td colSpan={7}><EmptyState title="No conversations yet" /></td></tr>
              ) : (
                history.map((h, i) => (
                  <tr key={h.ID}>
                    <td className={styles.idx}>{i + 1}</td>
                    <td className={styles.descCell} title={h.QUESTION}>{h.QUESTION}</td>
                    <td className={styles.descCell} title={h.ANSWER}>{h.ANSWER}</td>
                    <td>{h.MODEL_NAME || <span className={styles.muted}>—</span>}</td>
                    <td>{h.TOTAL_TOKENS ?? <span className={styles.muted}>—</span>}</td>
                    <td>{h.RESPONSE_TIME != null ? `${h.RESPONSE_TIME}s` : <span className={styles.muted}>—</span>}</td>
                    <td>{formatDateTime(h.CREATED_AT)}</td>
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
