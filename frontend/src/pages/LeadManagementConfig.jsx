import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, SearchBar, EmptyState,
  Loader, PMButton, PMSelect, PMConfirmModal,
} from "../components/pm";
import { leadPollingConfigService } from "../services/leadPollingConfigService";
import { useToast } from "../hooks/useToast";
import { validateForm, clearFieldError, LEAD_POLLING_CONFIG_RULES } from "../utils/formValidation";
import { formatDateTime } from "../utils/formatDateTime";
import LeadIcon from "../assets/Icons/projectIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import ViewIcon from "../assets/Icons/detailsIcon.webp";
import styles from "./LeadManagementConfig.module.css";

const API_TYPE_OPTIONS = [
  { value: "DATE_RANGE", label: "Date Range" },
  { value: "DATETIME_RANGE", label: "DateTime Range" },
  { value: "LAST_24_HOURS", label: "Last 24 Hours" },
];

const POLL_PRESETS = [5, 10, 15, 30];
const POLL_PRESET_OPTIONS = [...POLL_PRESETS.map((m) => String(m)), "Custom"];

const EMPTY_FORM = {
  ACCOUNT_LABEL: "",
  PLATFORM_NAME: "IndiaMART",
  BASE_URL: "https://mapi.indiamart.com/",
  ENDPOINT_URL: "wservce/crm/crmListing/v2/",
  PULL_API_KEY: "",
  API_TYPE: "DATE_RANGE",
  API_DESCRIPTION: "",
  IS_ACTIVE: false,
  POLL_INTERVAL_MINUTES: 5,
  POLL_INTERVAL_MODE: "preset",
};

function apiTypeLabel(value) {
  return API_TYPE_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

export default function LeadManagementConfig() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // null | "add" | "edit" | "view"
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [confirmModal, setConfirmModal] = useState(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await leadPollingConfigService.getAll();
      setRows(res.data || []);
    } catch {
      toast.showError("Failed to load polling configurations");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [load]);

  const handleRefresh = useCallback(() => load(true), [load]);

  const filtered = useMemo(() => {
    let data = rows;
    if (search.trim()) {
      const t = search.toLowerCase();
      data = data.filter(
        (r) =>
          (r.ACCOUNT_LABEL || "").toLowerCase().includes(t) ||
          (r.ENDPOINT_URL || "").toLowerCase().includes(t) ||
          (r.API_DESCRIPTION || "").toLowerCase().includes(t)
      );
    }
    if (filterFrom || filterTo) {
      const from = filterFrom ? new Date(filterFrom) : null;
      const to = filterTo ? new Date(filterTo) : null;
      data = data.filter((r) => {
        if (!r.CREATED_AT) return false;
        const d = new Date(r.CREATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return data;
  }, [rows, search, filterFrom, filterTo]);

  const paginated = useMemo(
    () => (pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Configurations" },
    { value: rows.filter((r) => r.IS_ACTIVE).length, label: "Active" },
    { value: filtered.length, label: "Showing" },
  ], [rows, filtered.length]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setErrors({});
    setShowApiKey(false);
    setModal("add");
  }, []);

  const formFromRow = useCallback((row) => ({
    ACCOUNT_LABEL: row.ACCOUNT_LABEL || "",
    PLATFORM_NAME: row.PLATFORM_NAME || "IndiaMART",
    BASE_URL: row.BASE_URL || "",
    ENDPOINT_URL: row.ENDPOINT_URL || "",
    PULL_API_KEY: "",
    API_TYPE: row.API_TYPE || "DATE_RANGE",
    API_DESCRIPTION: row.API_DESCRIPTION || "",
    IS_ACTIVE: row.IS_ACTIVE || false,
    POLL_INTERVAL_MINUTES: row.POLL_INTERVAL_MINUTES || 5,
    POLL_INTERVAL_MODE: POLL_PRESETS.includes(row.POLL_INTERVAL_MINUTES) ? "preset" : "custom",
  }), []);

  const openEdit = useCallback((row) => {
    setForm(formFromRow(row));
    setSelected(row);
    setErrors({});
    setShowApiKey(false);
    setModal("edit");
  }, [formFromRow]);

  const openView = useCallback((row) => {
    setForm(formFromRow(row));
    setSelected(row);
    setErrors({});
    setShowApiKey(false);
    setModal("view");
  }, [formFromRow]);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelected(null);
    setErrors({});
  }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    clearFieldError(setErrors, field);
  }, []);

  const handlePollModeChange = useCallback((mode) => {
    if (mode === "Custom") {
      setForm((prev) => ({ ...prev, POLL_INTERVAL_MODE: "custom" }));
    } else {
      setForm((prev) => ({ ...prev, POLL_INTERVAL_MODE: "preset", POLL_INTERVAL_MINUTES: Number(mode) }));
    }
    clearFieldError(setErrors, "POLL_INTERVAL_MINUTES");
  }, []);

  const handleSave = useCallback(async () => {
    const { errors: formErrors } = validateForm(LEAD_POLLING_CONFIG_RULES, form);
    const nextErrors = { ...formErrors };
    if (modal === "add" && !form.PULL_API_KEY.trim()) {
      nextErrors.PULL_API_KEY = "Pull API Key is required.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.showWarning("Please fix the highlighted fields");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ACCOUNT_LABEL: form.ACCOUNT_LABEL.trim(),
        PLATFORM_NAME: form.PLATFORM_NAME.trim() || "IndiaMART",
        BASE_URL: form.BASE_URL.trim(),
        ENDPOINT_URL: form.ENDPOINT_URL.trim(),
        API_TYPE: form.API_TYPE,
        API_DESCRIPTION: form.API_DESCRIPTION.trim() || null,
        IS_ACTIVE: form.IS_ACTIVE,
        POLL_INTERVAL_MINUTES: Number(form.POLL_INTERVAL_MINUTES) || 5,
        PULL_API_KEY: form.PULL_API_KEY.trim() || null,
      };
      if (modal === "add") {
        await leadPollingConfigService.create(payload);
        toast.showSuccess("Polling configuration created");
      } else {
        await leadPollingConfigService.update(selected.ID, payload);
        toast.showSuccess("Polling configuration updated");
      }
      closeModal();
      load();
    } catch (e) {
      if (e?.response?.status === 409) {
        setErrors((prev) => ({
          ...prev,
          ACCOUNT_LABEL: "This Account Label + API Type combination is already in use.",
        }));
        toast.showError(e.response.data?.detail || "A configuration with this Account Label and API Type already exists.");
      } else {
        toast.showError(e?.response?.data?.detail || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, closeModal, load, toast]);

  const handleDelete = useCallback((row) => {
    setConfirmModal({
      title: "Delete Polling Configuration",
      description: `Delete configuration "${row.ACCOUNT_LABEL}"? Stored leads created from this configuration are kept. This cannot be undone.`,
      onConfirm: async () => {
        try {
          await leadPollingConfigService.remove(row.ID);
          toast.showSuccess("Polling configuration deleted");
          load();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [load, toast]);

  const handleToggleActive = useCallback(async (row) => {
    setTogglingId(row.ID);
    try {
      if (row.IS_ACTIVE) {
        await leadPollingConfigService.deactivate(row.ID);
        toast.showSuccess("Configuration deactivated");
      } else {
        await leadPollingConfigService.activate(row.ID);
        toast.showSuccess("Configuration activated");
      }
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to update status");
    } finally {
      setTogglingId(null);
    }
  }, [load, toast]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  const readOnly = modal === "view";

  return (
    <div className={styles.page}>
      <PageHeader
        icon={LeadIcon}
        iconAlt="Lead Management"
        title="Lead Management Configuration"
        subtitle="Manage lead-source polling integrations"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <PMButton variant="primary" onClick={openAdd}>Add Configuration</PMButton>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by account label, endpoint, or description…"
          />
          <div className={styles.dateFilters}>
            <label className={styles.dateLabel}>From</label>
            <input
              type="datetime-local"
              className={styles.dateInput}
              value={filterFrom}
              onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
            />
            <label className={styles.dateLabel}>To</label>
            <input
              type="datetime-local"
              className={styles.dateInput}
              value={filterTo}
              onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
            />
            {(filterFrom || filterTo) && (
              <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>
            )}
          </div>
          <span className={styles.count}>{filtered.length} config{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Account Label</th>
                <th>Endpoint URL</th>
                <th>API Type</th>
                <th>Poll (min)</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={LeadIcon}
                      iconAlt="Lead Management"
                      title={search ? "No configurations match your search" : "No polling configurations yet"}
                      description={!search ? "Click 'Add Configuration' to connect a lead source." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.ACCOUNT_LABEL}</td>
                    <td className={styles.descCell}>{r.ENDPOINT_URL}</td>
                    <td><span className={styles.codeBadge}>{apiTypeLabel(r.API_TYPE)}</span></td>
                    <td>{r.POLL_INTERVAL_MINUTES}</td>
                    <td>
                      {r.IS_ACTIVE
                        ? <span className={styles.activePill}>Active</span>
                        : <span className={styles.inactivePill}>Inactive</span>}
                    </td>
                    <td className={styles.dateCell}>{formatDateTime(r.UPDATED_AT)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} onClick={() => openView(r)} title="View">
                          <img src={ViewIcon} alt="View" />
                        </button>
                        <button className={styles.iconBtn} onClick={() => openEdit(r)} title="Edit">
                          <img src={EditIcon} alt="Edit" />
                        </button>
                        <button
                          className={r.IS_ACTIVE ? styles.toggleBtnActive : styles.toggleBtn}
                          onClick={() => handleToggleActive(r)}
                          disabled={togglingId === r.ID}
                          title={r.IS_ACTIVE ? "Deactivate" : "Activate"}
                        >
                          {togglingId === r.ID ? "…" : r.IS_ACTIVE ? "Deactivate" : "Activate"}
                        </button>
                        <button className={styles.iconBtnDanger} onClick={() => handleDelete(r)} title="Delete">
                          <img src={DeleteIcon} alt="Delete" />
                        </button>
                      </div>
                    </td>
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

      {/* Add / Edit / View Modal */}
      <PMModal
        open={!!modal}
        onClose={closeModal}
        title={modal === "add" ? "Add Polling Configuration" : modal === "edit" ? "Edit Polling Configuration" : "View Polling Configuration"}
        size="md"
        footer={
          readOnly ? (
            <PMButton variant="outline" onClick={closeModal}>Close</PMButton>
          ) : (
            <>
              <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
              <PMButton variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : modal === "add" ? "Create Configuration" : "Save Changes"}
              </PMButton>
            </>
          )
        }
      >
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Account Label {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.ACCOUNT_LABEL ? " " + styles.inputError : ""}`}
              value={form.ACCOUNT_LABEL}
              onChange={(e) => handleFormChange("ACCOUNT_LABEL", e.target.value)}
              placeholder="e.g. Main IndiaMART Account"
              disabled={readOnly}
            />
            {errors.ACCOUNT_LABEL && <span className={styles.fieldError}>{errors.ACCOUNT_LABEL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Platform Name {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.PLATFORM_NAME ? " " + styles.inputError : ""}`}
              value={form.PLATFORM_NAME}
              onChange={(e) => handleFormChange("PLATFORM_NAME", e.target.value)}
              placeholder="IndiaMART"
              disabled={readOnly}
            />
            {errors.PLATFORM_NAME && <span className={styles.fieldError}>{errors.PLATFORM_NAME}</span>}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Base URL {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.BASE_URL ? " " + styles.inputError : ""}`}
              value={form.BASE_URL}
              onChange={(e) => handleFormChange("BASE_URL", e.target.value)}
              placeholder="https://mapi.indiamart.com/"
              disabled={readOnly}
            />
            {errors.BASE_URL && <span className={styles.fieldError}>{errors.BASE_URL}</span>}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Endpoint URL {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.ENDPOINT_URL ? " " + styles.inputError : ""}`}
              value={form.ENDPOINT_URL}
              onChange={(e) => handleFormChange("ENDPOINT_URL", e.target.value)}
              placeholder="wservce/crm/crmListing/v2/"
              disabled={readOnly}
            />
            {errors.ENDPOINT_URL && <span className={styles.fieldError}>{errors.ENDPOINT_URL}</span>}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>
              Pull API Key {modal === "add" && <span className={styles.req}>*</span>}
              {modal === "edit" && <span className={styles.hint}> (blank = keep existing)</span>}
            </label>
            <div className={styles.passwordWrap}>
              <input
                className={`${styles.inputPassword}${errors.PULL_API_KEY ? " " + styles.inputError : ""}`}
                type={showApiKey ? "text" : "password"}
                value={form.PULL_API_KEY}
                onChange={(e) => handleFormChange("PULL_API_KEY", e.target.value)}
                placeholder={modal === "add" ? "Enter Pull API Key" : "●●●●●●●●"}
                autoComplete="new-password"
                disabled={readOnly}
              />
              {!readOnly && (
                <button
                  type="button"
                  className={styles.showPasswordBtn}
                  onClick={() => setShowApiKey((v) => !v)}
                  tabIndex={-1}
                >
                  {showApiKey ? "Hide" : "Show"}
                </button>
              )}
            </div>
            {errors.PULL_API_KEY && <span className={styles.fieldError}>{errors.PULL_API_KEY}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>API Type {!readOnly && <span className={styles.req}>*</span>}</label>
            <PMSelect
              options={API_TYPE_OPTIONS}
              value={form.API_TYPE}
              onChange={(v) => handleFormChange("API_TYPE", v)}
              valueKey="value"
              labelKey="label"
              disabled={readOnly}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Polling Interval {!readOnly && <span className={styles.req}>*</span>}</label>
            <PMSelect
              options={POLL_PRESET_OPTIONS}
              value={form.POLL_INTERVAL_MODE === "custom" ? "Custom" : String(form.POLL_INTERVAL_MINUTES)}
              onChange={handlePollModeChange}
              disabled={readOnly}
            />
            {form.POLL_INTERVAL_MODE === "custom" && (
              <input
                className={`${styles.input}${errors.POLL_INTERVAL_MINUTES ? " " + styles.inputError : ""}`}
                type="number"
                min={5}
                max={1440}
                value={form.POLL_INTERVAL_MINUTES}
                onChange={(e) => handleFormChange("POLL_INTERVAL_MINUTES", e.target.value)}
                placeholder="Minutes (min. 5)"
                disabled={readOnly}
              />
            )}
            {errors.POLL_INTERVAL_MINUTES && <span className={styles.fieldError}>{errors.POLL_INTERVAL_MINUTES}</span>}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>API Description</label>
            <textarea
              className={styles.textarea}
              value={form.API_DESCRIPTION}
              onChange={(e) => handleFormChange("API_DESCRIPTION", e.target.value)}
              placeholder="Optional notes about this integration"
              disabled={readOnly}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={form.IS_ACTIVE}
                onChange={(e) => handleFormChange("IS_ACTIVE", e.target.checked)}
                disabled={readOnly}
              />
              Active — this configuration will be polled automatically
            </label>
          </div>
          {selected && (
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <div className={styles.metaRow}>
                <span>Last Sync: <strong>{selected.LAST_SYNC_STATUS || "PENDING"}</strong>{selected.LAST_SYNC_MESSAGE ? ` — ${selected.LAST_SYNC_MESSAGE}` : ""}</span>
                <span>Created: {formatDateTime(selected.CREATED_AT)}</span>
                <span>Updated: {formatDateTime(selected.UPDATED_AT)}</span>
              </div>
            </div>
          )}
        </div>
      </PMModal>

      {/* Delete Confirmation */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => {})}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
      />
    </div>
  );
}
