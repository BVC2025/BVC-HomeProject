import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, EmptyState, Loader, PMButton, PMSelect, PMModal,
  DateTimeRangeFilter, EMPTY_RANGE, toIsoRange,
} from "../components/pm";
import { pollingLogService } from "../services/pollingLogService";
import { leadPollingConfigService } from "../services/leadPollingConfigService";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import ViewIcon from "../assets/Icons/detailsIcon.webp";
import styles from "./PollingActivityLog.module.css";

const STATUS_OPTIONS = [
  { value: "SUCCESS", label: "Success" },
  { value: "NO_LEADS", label: "No Leads" },
  { value: "RATE_LIMITED", label: "Rate Limited" },
  { value: "AUTH_FAILED", label: "Auth Failed" },
  { value: "ERROR", label: "Error" },
  { value: "PENDING", label: "Pending" },
];

function statusLabel(value) {
  return STATUS_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

function formatDuration(ms) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export default function PollingActivityLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [configs, setConfigs] = useState([]);
  const [filterConfigId, setFilterConfigId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dateRange, setDateRange] = useState(EMPTY_RANGE);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [detailRow, setDetailRow] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const loadConfigs = useCallback(async () => {
    try {
      const res = await leadPollingConfigService.getAll();
      setConfigs(res.data || []);
    } catch {
      toast.showError("Failed to load configurations");
    }
  }, []);

  const loadLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const { from, to } = toIsoRange(dateRange, { withTime: true });
      const params = { limit: pageSize, offset: (page - 1) * pageSize };
      if (filterConfigId) params.config_id = filterConfigId;
      if (filterStatus) params.status = filterStatus;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      const res = await pollingLogService.getAll(params);
      setRows(res.data?.rows || []);
      setTotal(res.data?.total || 0);
    } catch {
      toast.showError("Failed to load polling activity");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize, filterConfigId, filterStatus, dateRange]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleRefresh = useCallback(() => loadLogs(true), [loadLogs]);

  const configMap = useMemo(
    () => Object.fromEntries(configs.map((c) => [c.ID, c.ACCOUNT_LABEL])),
    [configs]
  );

  const handleConfigChange = useCallback((v) => { setFilterConfigId(v || ""); setPage(1); }, []);
  const handleStatusChange = useCallback((v) => { setFilterStatus(v || ""); setPage(1); }, []);
  const handleDateRangeChange = useCallback((next) => { setDateRange(next); setPage(1); }, []);
  const handleClearDateRange = useCallback(() => { setDateRange(EMPTY_RANGE); setPage(1); }, []);

  const hasFilters = filterConfigId || filterStatus || dateRange.fromDate || dateRange.toDate;
  const handleResetFilters = useCallback(() => {
    setFilterConfigId(""); setFilterStatus(""); setDateRange(EMPTY_RANGE); setPage(1);
  }, []);

  const stats = useMemo(() => [
    { value: total, label: "Total Attempts" },
    { value: rows.filter((r) => r.STATUS === "SUCCESS").length, label: "Success (this page)" },
  ], [total, rows]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={ViewIcon}
        iconAlt="Polling Activity"
        title="Polling Activity"
        subtitle="Monitor every automated lead-polling attempt — success, failure, and why"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <StatsRow stats={stats} />

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <label>Configuration</label>
          <PMSelect
            options={configs}
            value={filterConfigId}
            onChange={handleConfigChange}
            valueKey="ID"
            labelKey="ACCOUNT_LABEL"
            allowClear
            clearLabel="All Configurations"
          />
        </div>
        <div className={styles.filterGroup}>
          <label>Status</label>
          <PMSelect
            options={STATUS_OPTIONS}
            value={filterStatus}
            onChange={handleStatusChange}
            valueKey="value"
            labelKey="label"
            allowClear
            clearLabel="All Statuses"
          />
        </div>
        <DateTimeRangeFilter
          value={dateRange}
          onChange={handleDateRangeChange}
          onClear={handleClearDateRange}
          showTime
        />
        {hasFilters && (
          <div className={styles.filterActions}>
            <PMButton variant="outline" onClick={handleResetFilters}>Reset Filters</PMButton>
          </div>
        )}
      </div>

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <span className={styles.count}>{total} attempt{total !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Account Label</th>
                <th>Poll Time</th>
                <th>API Type</th>
                <th>Status</th>
                <th>Lead Count</th>
                <th>Duration</th>
                <th>Error</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><Loader /></td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={ViewIcon}
                      iconAlt="Polling Activity"
                      title={hasFilters ? "No activity matches your filters" : "No polling activity yet"}
                      description={!hasFilters ? "Activate a polling configuration to start seeing attempts here." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{configMap[r.CONFIG_ID] || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.dateCell}>{formatDateTime(r.POLL_TIME)}</td>
                    <td><span className={styles.codeBadge}>{r.API_TYPE || "—"}</span></td>
                    <td><span className={styles.statusPill} data-status={r.STATUS}>{statusLabel(r.STATUS)}</span></td>
                    <td>{r.LEAD_COUNT}</td>
                    <td>{formatDuration(r.DURATION_MS)}</td>
                    <td className={styles.descCell}>{r.ERROR_MESSAGE || <span className={styles.muted}>—</span>}</td>
                    <td>
                      <button className={styles.iconBtn} onClick={() => setDetailRow(r)} title="View Details">
                        <img src={ViewIcon} alt="View" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>

      {/* Detail Modal */}
      <PMModal
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title="Polling Attempt Details"
        size="md"
        footer={<PMButton variant="outline" onClick={() => setDetailRow(null)}>Close</PMButton>}
      >
        {detailRow && (
          <div className={styles.detailGrid}>
            <div className={styles.detailRow}><label>Account Label</label><span>{configMap[detailRow.CONFIG_ID] || "—"}</span></div>
            <div className={styles.detailRow}><label>Poll Time</label><span>{formatDateTime(detailRow.POLL_TIME)}</span></div>
            <div className={styles.detailRow}><label>API Type</label><span>{detailRow.API_TYPE || "—"}</span></div>
            <div className={styles.detailRow}><label>Status</label><span className={styles.statusPill} data-status={detailRow.STATUS}>{statusLabel(detailRow.STATUS)}</span></div>
            <div className={styles.detailRow}><label>Lead Count</label><span>{detailRow.LEAD_COUNT}</span></div>
            <div className={styles.detailRow}><label>Duration</label><span>{formatDuration(detailRow.DURATION_MS)}</span></div>
            {detailRow.ERROR_MESSAGE && (
              <div className={styles.detailBlock}>
                <label>Error Message</label>
                <p>{detailRow.ERROR_MESSAGE}</p>
              </div>
            )}
            {detailRow.ERROR_DETAILS && (
              <div className={styles.detailBlock}>
                <label>Error Details</label>
                <pre className={styles.pre}>{detailRow.ERROR_DETAILS}</pre>
              </div>
            )}
            {detailRow.RESPONSE_DETAILS && (
              <div className={styles.detailBlock}>
                <label>Response Details</label>
                <pre className={styles.pre}>{detailRow.RESPONSE_DETAILS}</pre>
              </div>
            )}
          </div>
        )}
      </PMModal>
    </div>
  );
}
