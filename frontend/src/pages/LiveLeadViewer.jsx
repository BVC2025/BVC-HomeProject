import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, SearchBar, EmptyState, Loader, PMButton, PMSelect,
  TimeInput12h, EMPTY_TIME, buildDateTimeIso,
} from "../components/pm";
import { leadPollingConfigService } from "../services/leadPollingConfigService";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import ViewIcon from "../assets/Icons/detailsIcon.webp";
import styles from "./LiveLeadViewer.module.css";

const API_TYPE_OPTIONS = [
  { value: "DATE_RANGE", label: "Date Range" },
  { value: "DATETIME_RANGE", label: "DateTime Range" },
  { value: "LAST_24_HOURS", label: "Last 24 Hours" },
];

export default function LiveLeadViewer() {
  const [configs, setConfigs] = useState([]);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [filterConfigId, setFilterConfigId] = useState("");
  const [apiType, setApiType] = useState("LAST_24_HOURS");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState(EMPTY_TIME);
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState(EMPTY_TIME);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const loadConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    try {
      const res = await leadPollingConfigService.getAll();
      setConfigs((res.data || []).filter((c) => c.IS_ACTIVE));
    } catch {
      toast.showError("Failed to load polling configurations");
    } finally {
      setLoadingConfigs(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadConfigs();
  }, [loadConfigs]);

  const handleConfigChange = useCallback((id) => {
    setFilterConfigId(id);
    const cfg = configs.find((c) => String(c.ID) === String(id));
    if (cfg) setApiType(cfg.API_TYPE);
  }, [configs]);

  const handleReset = useCallback(() => {
    setStartDate("");
    setStartTime(EMPTY_TIME);
    setEndDate("");
    setEndTime(EMPTY_TIME);
    setSearch("");
    setResults([]);
    setSearched(false);
    setPage(1);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!filterConfigId) { toast.showWarning("Select a configuration first"); return; }
    if (apiType !== "LAST_24_HOURS" && (!startDate || !endDate)) {
      toast.showWarning("Start Date and End Date are required for this API type");
      return;
    }

    let startIso = null;
    let endIso = null;
    if (apiType === "DATE_RANGE") {
      startIso = startDate;
      endIso = endDate;
    } else if (apiType === "DATETIME_RANGE") {
      startIso = buildDateTimeIso(startDate, startTime);
      endIso = buildDateTimeIso(endDate, endTime);
    }

    setSearching(true);
    try {
      const res = await leadPollingConfigService.previewLeads({
        CONFIG_ID: filterConfigId,
        API_TYPE: apiType,
        START_TIME: startIso,
        END_TIME: endIso,
      });
      const leads = res.data?.leads || [];
      setResults(leads);
      setSearched(true);
      setPage(1);
      if (leads.length === 0) {
        toast.showWarning("No leads found for the selected criteria");
      } else {
        toast.showInfo(`${leads.length} lead${leads.length !== 1 ? "s" : ""} fetched`);
      }
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to fetch leads");
    } finally {
      setSearching(false);
    }
  }, [filterConfigId, apiType, startDate, startTime, endDate, endTime, toast]);

  const filtered = useMemo(() => {
    if (!search.trim()) return results;
    const t = search.toLowerCase();
    return results.filter(
      (r) =>
        (r.CONTACT_NAME || "").toLowerCase().includes(t) ||
        (r.COMPANY_NAME || "").toLowerCase().includes(t) ||
        (r.CONTACT_MOBILE || "").toLowerCase().includes(t) ||
        (r.CONTACT_EMAIL || "").toLowerCase().includes(t)
    );
  }, [results, search]);

  const paginated = useMemo(
    () => (pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: results.length, label: "Leads Fetched" },
    { value: filtered.length, label: "Showing" },
  ], [results.length, filtered.length]);

  const hasFilters = startDate || endDate || search;

  return (
    <div className={styles.page}>
      <PageHeader
        icon={ViewIcon}
        iconAlt="Live Lead Viewer"
        title="Live Lead Viewer"
        subtitle="Test lead polling configurations — results are not stored"
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
            placeholder={loadingConfigs ? "Loading…" : "Select a configuration"}
            allowClear
            clearLabel="— Select —"
          />
        </div>
        <div className={styles.filterGroup}>
          <label>API Type</label>
          <PMSelect
            options={API_TYPE_OPTIONS}
            value={apiType}
            onChange={setApiType}
            valueKey="value"
            labelKey="label"
          />
        </div>

        {apiType !== "LAST_24_HOURS" && (
          <>
            <div className={styles.filterGroup}>
              <label>Start Date</label>
              <input
                type="date"
                className={styles.dateInput}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            {apiType === "DATETIME_RANGE" && (
              <div className={styles.filterGroup}>
                <label>Start Time</label>
                <TimeInput12h value={startTime} onChange={setStartTime} />
              </div>
            )}
            <div className={styles.filterGroup}>
              <label>End Date</label>
              <input
                type="date"
                className={styles.dateInput}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {apiType === "DATETIME_RANGE" && (
              <div className={styles.filterGroup}>
                <label>End Time</label>
                <TimeInput12h value={endTime} onChange={setEndTime} />
              </div>
            )}
          </>
        )}

        <div className={styles.filterActions}>
          <PMButton variant="primary" onClick={handleSearch} disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </PMButton>
          {hasFilters && <PMButton variant="outline" onClick={handleReset}>Reset</PMButton>}
        </div>
      </div>

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Filter results by name, company, mobile, or email…"
          />
          <span className={styles.count}>{filtered.length} lead{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Contact Name</th>
                <th>Mobile</th>
                <th>Email</th>
                <th>Company</th>
                <th>City</th>
                <th>State</th>
                <th>Enquiry Type</th>
                <th>Product</th>
                <th>Message</th>
                <th>Enquiry Time</th>
              </tr>
            </thead>
            <tbody>
              {searching ? (
                <tr><td colSpan={11}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <EmptyState
                      icon={ViewIcon}
                      iconAlt="Live Lead Viewer"
                      title={searched ? "No leads found for the selected criteria" : "Select a configuration and search"}
                      description={!searched ? "Results are fetched live and are never stored." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.EXTERNAL_REFERENCE_ID || i}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.CONTACT_NAME || "—"}</td>
                    <td>{r.CONTACT_MOBILE || "—"}</td>
                    <td className={styles.descCell}>{r.CONTACT_EMAIL || "—"}</td>
                    <td className={styles.descCell}>{r.COMPANY_NAME || "—"}</td>
                    <td>{r.CITY || "—"}</td>
                    <td>{r.STATE || "—"}</td>
                    <td><span className={styles.codeBadge}>{r.ENQUIRY_TYPE || "—"}</span></td>
                    <td className={styles.descCell}>{r.PRODUCT_INTEREST || "—"}</td>
                    <td className={styles.descCell}>{r.LEAD_MESSAGE || "—"}</td>
                    <td className={styles.dateCell}>{r.ENQUIRY_TIME ? formatDateTime(r.ENQUIRY_TIME) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>
    </div>
  );
}
