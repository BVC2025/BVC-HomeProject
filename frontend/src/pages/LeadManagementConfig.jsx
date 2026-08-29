import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, SearchBar, EmptyState,
  Loader, PMButton, PMSelect, PMConfirmModal,
} from "../components/pm";
import { leadPollingConfigService } from "../services/leadPollingConfigService";
import { whatsappModuleSettingService } from "../services/whatsappModuleSettingService";
import { leadModuleSettingService } from "../services/leadModuleSettingService";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../context/AuthContext";
import { validateForm, clearFieldError, LEAD_POLLING_CONFIG_RULES, WHATSAPP_MODULE_SETTING_RULES } from "../utils/formValidation";
import { formatDateTime } from "../utils/formatDateTime";
import LeadIcon from "../assets/Icons/projectIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import ViewIcon from "../assets/Icons/detailsIcon.webp";
import PoRequestIcon from "../assets/Icons/uploadIcon.webp";
import WhatsAppIcon from "../assets/Icons/mailIcon.webp";
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

const WA_EMPTY_FORM = {
  IS_ENABLED: true,
  AUTO_TRIGGER_ENABLED: true,
  WELCOME_TEMPLATE_NAME: "",
  WELCOME_TEMPLATE_LANG: "en_US",
  WELCOME_TEMPLATE_PARAMS: "",
  REENGAGE_TEMPLATE_NAME: "",
  REENGAGE_TEMPLATE_LANG: "en_US",
  AI_REPLY_ENABLED: true,
  SUPPORTED_LANGUAGES: "en",
};

export default function LeadManagementConfig() {
  const { hasPermission } = useAuth();
  const canViewWhatsApp = hasPermission("lead.config.whatsapp_automation.view");
  const canManageWhatsApp = hasPermission("lead.config.whatsapp_automation.manage");
  const canViewAutoPO = hasPermission("lead.config.auto_po_request.view");
  const canManageAutoPO = hasPermission("lead.config.auto_po_request.manage");

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

  // WhatsApp Automation (per-module settings — the shared Meta connection
  // itself lives on the separate System > WhatsApp Configuration page)
  const [waSettingId, setWaSettingId] = useState(null);
  const [waForm, setWaForm] = useState(WA_EMPTY_FORM);
  const [waErrors, setWaErrors] = useState({});
  const [waLoading, setWaLoading] = useState(true);
  const [waSaving, setWaSaving] = useState(false);
  const waFetchedRef = useRef(false);

  // Auto Send Purchase Order Request — Lead Management's own singleton
  // module setting (separate from WhatsAppModuleSetting, see
  // LeadModuleSetting model).
  const [poAutoSendEnabled, setPoAutoSendEnabled] = useState(false);
  const [poLoading, setPoLoading] = useState(true);
  const [poSaving, setPoSaving] = useState(false);
  const poFetchedRef = useRef(false);

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

  const loadWaSetting = useCallback(async () => {
    setWaLoading(true);
    try {
      const res = await whatsappModuleSettingService.getForLeadModule();
      const row = res.data?.row;
      if (row) {
        setWaSettingId(row.ID);
        setWaForm({
          IS_ENABLED: row.IS_ENABLED ?? true,
          AUTO_TRIGGER_ENABLED: row.AUTO_TRIGGER_ENABLED ?? true,
          WELCOME_TEMPLATE_NAME: row.WELCOME_TEMPLATE_NAME || "",
          WELCOME_TEMPLATE_LANG: row.WELCOME_TEMPLATE_LANG || "en_US",
          WELCOME_TEMPLATE_PARAMS: row.WELCOME_TEMPLATE_PARAMS || "",
          REENGAGE_TEMPLATE_NAME: row.REENGAGE_TEMPLATE_NAME || "",
          REENGAGE_TEMPLATE_LANG: row.REENGAGE_TEMPLATE_LANG || "en_US",
          AI_REPLY_ENABLED: row.AI_REPLY_ENABLED ?? true,
          SUPPORTED_LANGUAGES: row.SUPPORTED_LANGUAGES || "en",
        });
      } else {
        setWaSettingId(null);
        setWaForm(WA_EMPTY_FORM);
      }
    } catch {
      toast.showError("Failed to load WhatsApp automation settings");
    } finally {
      setWaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (waFetchedRef.current || !canViewWhatsApp) return;
    waFetchedRef.current = true;
    loadWaSetting();
  }, [loadWaSetting, canViewWhatsApp]);

  const loadPoSetting = useCallback(async () => {
    setPoLoading(true);
    try {
      const res = await leadModuleSettingService.get();
      setPoAutoSendEnabled(!!res.data?.AUTO_SEND_PO_REQUEST_ENABLED);
    } catch {
      toast.showError("Failed to load Purchase Order Request settings");
    } finally {
      setPoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (poFetchedRef.current || !canViewAutoPO) return;
    poFetchedRef.current = true;
    loadPoSetting();
  }, [loadPoSetting, canViewAutoPO]);

  const handlePoSave = useCallback(async (enabled) => {
    setPoAutoSendEnabled(enabled);
    setPoSaving(true);
    try {
      await leadModuleSettingService.update({ AUTO_SEND_PO_REQUEST_ENABLED: enabled });
      toast.showSuccess("Purchase Order Request setting saved");
    } catch (e) {
      setPoAutoSendEnabled(!enabled);
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setPoSaving(false);
    }
  }, [toast]);

  const handleWaFormChange = useCallback((field, val) => {
    setWaForm((prev) => ({ ...prev, [field]: val }));
    clearFieldError(setWaErrors, field);
  }, []);

  const handleWaSave = useCallback(async () => {
    const { errors: formErrors } = validateForm(WHATSAPP_MODULE_SETTING_RULES, waForm);
    if (Object.keys(formErrors).length > 0) {
      setWaErrors(formErrors);
      toast.showWarning("Please fix the highlighted fields");
      return;
    }

    setWaSaving(true);
    try {
      const payload = {
        IS_ENABLED: waForm.IS_ENABLED,
        AUTO_TRIGGER_ENABLED: waForm.AUTO_TRIGGER_ENABLED,
        WELCOME_TEMPLATE_NAME: waForm.WELCOME_TEMPLATE_NAME.trim() || null,
        WELCOME_TEMPLATE_LANG: waForm.WELCOME_TEMPLATE_LANG.trim() || "en_US",
        WELCOME_TEMPLATE_PARAMS: waForm.WELCOME_TEMPLATE_PARAMS.trim() || null,
        REENGAGE_TEMPLATE_NAME: waForm.REENGAGE_TEMPLATE_NAME.trim() || null,
        REENGAGE_TEMPLATE_LANG: waForm.REENGAGE_TEMPLATE_LANG.trim() || "en_US",
        AI_REPLY_ENABLED: waForm.AI_REPLY_ENABLED,
        SUPPORTED_LANGUAGES: waForm.SUPPORTED_LANGUAGES.trim() || "en",
      };
      if (waSettingId) {
        await whatsappModuleSettingService.update(waSettingId, payload);
      } else {
        await whatsappModuleSettingService.create(payload);
      }
      toast.showSuccess("WhatsApp automation settings saved");
      loadWaSetting();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setWaSaving(false);
    }
  }, [waForm, waSettingId, loadWaSetting, toast]);

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

      {/* Auto Send Purchase Order Request — whether approving a Final/Revised
          Quotation automatically emails the customer a PO request. */}
      {canViewAutoPO && (
        <div className={styles.settingsCard}>
          <div className={styles.settingsCardHeader}>
            <div className={styles.settingsCardIconWrap}>
              <img src={PoRequestIcon} alt="" />
            </div>
            <div className={styles.settingsCardHeaderText}>
              <h3 className={styles.settingsCardTitle}>Auto Send Purchase Order Request</h3>
              <p className={styles.settingsCardSubtitle}>
                Automatically email the customer a Purchase Order request the moment they approve
                a Final or Revised Quotation.
              </p>
            </div>
            {!poLoading && (
              <span className={styles.settingsCardStatusPill} data-active={poAutoSendEnabled}>
                <span className={styles.statusDot} />
                {poAutoSendEnabled ? "Enabled" : "Disabled"}
              </span>
            )}
          </div>
          <div className={styles.settingsCardBody}>
            {poLoading ? (
              <Loader />
            ) : (
              <div className={styles.toggleRow}>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={poAutoSendEnabled}
                    disabled={!canManageAutoPO || poSaving}
                    onChange={(e) => handlePoSave(e.target.checked)}
                  />
                  <span className={styles.toggleSlider} />
                </label>
                <div className={styles.toggleRowText}>
                  <span className={styles.toggleRowLabel}>
                    Automatically send Purchase Order Request on approval
                  </span>
                  <span className={styles.hint}>
                    When disabled, an authorized user can send it manually from the lead's quotation view.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WhatsApp Automation — Lead Management's own per-module settings.
          The shared Meta connection itself is configured separately, on the
          System > WhatsApp Configuration page. */}
      {canViewWhatsApp && (
      <div className={styles.settingsCard}>
        <div className={styles.settingsCardHeader}>
          <div className={styles.settingsCardIconWrap}>
            <img src={WhatsAppIcon} alt="" />
          </div>
          <div className={styles.settingsCardHeaderText}>
            <h3 className={styles.settingsCardTitle}>WhatsApp Automation</h3>
            <p className={styles.settingsCardSubtitle}>
              Controls how the Lead AI Assistant uses WhatsApp — welcome message, re-engagement, and AI
              auto-reply. The Meta account connection itself is managed under System → WhatsApp Configuration.
            </p>
          </div>
          {!waLoading && (
            <span className={styles.settingsCardStatusPill} data-active={waForm.IS_ENABLED}>
              <span className={styles.statusDot} />
              {waForm.IS_ENABLED ? "Enabled" : "Disabled"}
            </span>
          )}
        </div>
        <div className={styles.settingsCardBody}>
        {waLoading ? (
          <Loader />
        ) : (
          <>
            <div className={styles.toggleRow}>
              <label className={styles.toggleSwitch}>
                <input
                  type="checkbox"
                  checked={waForm.IS_ENABLED}
                  disabled={!canManageWhatsApp}
                  onChange={(e) => handleWaFormChange("IS_ENABLED", e.target.checked)}
                />
                <span className={styles.toggleSlider} />
              </label>
              <div className={styles.toggleRowText}>
                <span className={styles.toggleRowLabel}>Enabled</span>
                <span className={styles.hint}>Lead Management participates in WhatsApp at all</span>
              </div>
            </div>
            <div className={styles.toggleRow}>
              <label className={styles.toggleSwitch}>
                <input
                  type="checkbox"
                  checked={waForm.AUTO_TRIGGER_ENABLED}
                  disabled={!canManageWhatsApp}
                  onChange={(e) => handleWaFormChange("AUTO_TRIGGER_ENABLED", e.target.checked)}
                />
                <span className={styles.toggleSlider} />
              </label>
              <div className={styles.toggleRowText}>
                <span className={styles.toggleRowLabel}>Automatic welcome message</span>
                <span className={styles.hint}>Send an automatic WhatsApp welcome message when a new Lead is created</span>
              </div>
            </div>

            <hr className={styles.settingsCardDivider} />

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>
                  Welcome Template Name {waForm.AUTO_TRIGGER_ENABLED && <span className={styles.req}>*</span>}
                </label>
                <input
                  className={`${styles.input}${waErrors.WELCOME_TEMPLATE_NAME ? " " + styles.inputError : ""}`}
                  value={waForm.WELCOME_TEMPLATE_NAME}
                  onChange={(e) => handleWaFormChange("WELCOME_TEMPLATE_NAME", e.target.value)}
                  placeholder="e.g. lead_welcome"
                />
                {waErrors.WELCOME_TEMPLATE_NAME && <span className={styles.fieldError}>{waErrors.WELCOME_TEMPLATE_NAME}</span>}
                <span className={styles.hint}>Must be an approved template in Meta Business Manager</span>
              </div>
              <div className={styles.formGroup}>
                <label>Welcome Template Language</label>
                <input
                  className={styles.input}
                  value={waForm.WELCOME_TEMPLATE_LANG}
                  onChange={(e) => handleWaFormChange("WELCOME_TEMPLATE_LANG", e.target.value)}
                  placeholder="en_US"
                />
              </div>
              <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                <label>Welcome Template Parameters</label>
                <input
                  className={styles.input}
                  value={waForm.WELCOME_TEMPLATE_PARAMS}
                  onChange={(e) => handleWaFormChange("WELCOME_TEMPLATE_PARAMS", e.target.value)}
                  placeholder="e.g. CONTACT_NAME"
                />
                <span className={styles.hint}>Comma-separated Lead field names mapped to the template's {"{{1}}, {{2}}..."} placeholders</span>
              </div>
              <div className={styles.formGroup}>
                <label>Re-engagement Template Name</label>
                <input
                  className={styles.input}
                  value={waForm.REENGAGE_TEMPLATE_NAME}
                  onChange={(e) => handleWaFormChange("REENGAGE_TEMPLATE_NAME", e.target.value)}
                />
                <span className={styles.hint}>Used when an AI reply is ready but the customer's 24-hour window has closed</span>
              </div>
              <div className={styles.formGroup}>
                <label>Re-engagement Template Language</label>
                <input
                  className={styles.input}
                  value={waForm.REENGAGE_TEMPLATE_LANG}
                  onChange={(e) => handleWaFormChange("REENGAGE_TEMPLATE_LANG", e.target.value)}
                  placeholder="en_US"
                />
              </div>
            </div>

            <hr className={styles.settingsCardDivider} />

            <div className={styles.toggleRow}>
              <label className={styles.toggleSwitch}>
                <input
                  type="checkbox"
                  checked={waForm.AI_REPLY_ENABLED}
                  disabled={!canManageWhatsApp}
                  onChange={(e) => handleWaFormChange("AI_REPLY_ENABLED", e.target.checked)}
                />
                <span className={styles.toggleSlider} />
              </label>
              <div className={styles.toggleRowText}>
                <span className={styles.toggleRowLabel}>AI Auto-Reply</span>
                <span className={styles.hint}>Let the Lead AI Assistant answer incoming WhatsApp messages</span>
              </div>
            </div>

            <div className={styles.formGrid}>
              <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                <label>Supported Languages</label>
                <input
                  className={styles.input}
                  value={waForm.SUPPORTED_LANGUAGES}
                  onChange={(e) => handleWaFormChange("SUPPORTED_LANGUAGES", e.target.value)}
                  placeholder="en,ta"
                />
                <span className={styles.hint}>Comma-separated language codes offered on first contact — informational; the AI mirrors any language the customer actually uses</span>
              </div>
            </div>

            <div>
              <PMButton variant="primary" onClick={handleWaSave} disabled={waSaving || !canManageWhatsApp}>
                {waSaving ? "Saving…" : "Save WhatsApp Automation Settings"}
              </PMButton>
            </div>
          </>
        )}
        </div>
      </div>
      )}

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
