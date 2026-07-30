import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, SearchBar, EmptyState,
  Loader, PMButton, PMConfirmModal,
} from "../components/pm";
import { whatsappConfigService } from "../services/whatsappConfigService";
import { useToast } from "../hooks/useToast";
import { validateForm, clearFieldError, WHATSAPP_CONFIG_RULES, WHATSAPP_ACCESS_TOKEN_RULE } from "../utils/formValidation";
import { formatDateTime } from "../utils/formatDateTime";
import WhatsAppIcon from "../assets/Icons/mailIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import ViewIcon from "../assets/Icons/detailsIcon.webp";
import styles from "./WhatsAppConfigManagement.module.css";

const EMPTY_FORM = {
  ACCOUNT_LABEL: "",
  BUSINESS_DISPLAY_NAME: "",
  BUSINESS_PHONE_NUMBER: "",
  PHONE_NUMBER_ID: "",
  WABA_ID: "",
  APP_ID: "",
  APP_SECRET: "",
  ACCESS_TOKEN: "",
  TOKEN_EXPIRES_AT: "",
  VERIFY_TOKEN: "",
  API_BASE_URL: "https://graph.facebook.com",
  GRAPH_API_VERSION: "v21.0",
  WEBHOOK_CALLBACK_URL: "",
  WEBHOOK_ENABLED: false,
  DEFAULT_COUNTRY_CODE: "91",
  DEFAULT_LANGUAGE: "en",
  MAX_SEND_PER_SECOND: 8,
  DAILY_SEND_CAP: 900,
  IS_ACTIVE: false,
};

function generateToken(len = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function healthClass(status, styles) {
  if (status === "HEALTHY") return styles.healthHealthy;
  if (["AUTH_FAILED", "TEMPLATE_MISSING", "ENCRYPTION_KEY_MISSING", "ERROR", "AI_MODULE_INACTIVE"].includes(status)) return styles.healthError;
  if (["RATE_LIMITED", "DAILY_CAP_REACHED"].includes(status)) return styles.healthWarning;
  return styles.inactivePill;
}

export default function WhatsAppConfigManagement() {
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
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [testingId, setTestingId] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await whatsappConfigService.getAll();
      setRows(res.data?.rows || []);
    } catch {
      toast.showError("Failed to load WhatsApp configurations");
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
    if (!search.trim()) return rows;
    const t = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.ACCOUNT_LABEL || "").toLowerCase().includes(t) ||
        (r.BUSINESS_DISPLAY_NAME || "").toLowerCase().includes(t) ||
        (r.PHONE_NUMBER_ID || "").toLowerCase().includes(t)
    );
  }, [rows, search]);

  const paginated = useMemo(
    () => (pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Configurations" },
    { value: rows.filter((r) => r.IS_ACTIVE).length, label: "Active" },
    { value: rows.filter((r) => r.HEALTH_STATUS === "HEALTHY").length, label: "Healthy" },
    { value: filtered.length, label: "Showing" },
  ], [rows, filtered.length]);

  const openAdd = useCallback(() => {
    setForm({ ...EMPTY_FORM, VERIFY_TOKEN: generateToken() });
    setSelected(null);
    setErrors({});
    setShowAppSecret(false);
    setShowAccessToken(false);
    setModal("add");
  }, []);

  const formFromRow = useCallback((row) => ({
    ACCOUNT_LABEL: row.ACCOUNT_LABEL || "",
    BUSINESS_DISPLAY_NAME: row.BUSINESS_DISPLAY_NAME || "",
    BUSINESS_PHONE_NUMBER: row.BUSINESS_PHONE_NUMBER || "",
    PHONE_NUMBER_ID: row.PHONE_NUMBER_ID || "",
    WABA_ID: row.WABA_ID || "",
    APP_ID: row.APP_ID || "",
    APP_SECRET: "",
    ACCESS_TOKEN: "",
    TOKEN_EXPIRES_AT: row.TOKEN_EXPIRES_AT ? row.TOKEN_EXPIRES_AT.slice(0, 10) : "",
    VERIFY_TOKEN: row.VERIFY_TOKEN || "",
    API_BASE_URL: row.API_BASE_URL || "https://graph.facebook.com",
    GRAPH_API_VERSION: row.GRAPH_API_VERSION || "v21.0",
    WEBHOOK_CALLBACK_URL: row.WEBHOOK_CALLBACK_URL || "",
    WEBHOOK_ENABLED: row.WEBHOOK_ENABLED || false,
    DEFAULT_COUNTRY_CODE: row.DEFAULT_COUNTRY_CODE || "91",
    DEFAULT_LANGUAGE: row.DEFAULT_LANGUAGE || "en",
    MAX_SEND_PER_SECOND: row.MAX_SEND_PER_SECOND ?? 8,
    DAILY_SEND_CAP: row.DAILY_SEND_CAP ?? 900,
    IS_ACTIVE: row.IS_ACTIVE || false,
  }), []);

  const openEdit = useCallback((row) => {
    setForm(formFromRow(row));
    setSelected(row);
    setErrors({});
    setShowAppSecret(false);
    setShowAccessToken(false);
    setModal("edit");
  }, [formFromRow]);

  const openView = useCallback((row) => {
    setForm(formFromRow(row));
    setSelected(row);
    setErrors({});
    setShowAppSecret(false);
    setShowAccessToken(false);
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

  const handleCopy = useCallback(async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.showSuccess("Copied to clipboard");
    } catch {
      toast.showWarning("Could not copy — please copy manually");
    }
  }, [toast]);

  const handleSave = useCallback(async () => {
    const { errors: formErrors } = validateForm(WHATSAPP_CONFIG_RULES, form);
    const nextErrors = { ...formErrors };
    if (modal === "add") {
      for (const rule of WHATSAPP_ACCESS_TOKEN_RULE) {
        const fn = typeof rule === "function" ? rule : null;
        const err = fn ? fn(form.ACCESS_TOKEN, form) : null;
        if (err) { nextErrors.ACCESS_TOKEN = err; break; }
      }
      if (!form.ACCESS_TOKEN.trim()) nextErrors.ACCESS_TOKEN = "Access Token is required.";
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
        BUSINESS_DISPLAY_NAME: form.BUSINESS_DISPLAY_NAME.trim() || null,
        BUSINESS_PHONE_NUMBER: form.BUSINESS_PHONE_NUMBER.trim() || null,
        PHONE_NUMBER_ID: form.PHONE_NUMBER_ID.trim(),
        WABA_ID: form.WABA_ID.trim(),
        APP_ID: form.APP_ID.trim() || null,
        APP_SECRET: form.APP_SECRET.trim() || null,
        ACCESS_TOKEN: form.ACCESS_TOKEN.trim() || null,
        TOKEN_EXPIRES_AT: form.TOKEN_EXPIRES_AT || null,
        VERIFY_TOKEN: form.VERIFY_TOKEN.trim(),
        API_BASE_URL: form.API_BASE_URL.trim(),
        GRAPH_API_VERSION: form.GRAPH_API_VERSION.trim(),
        WEBHOOK_CALLBACK_URL: form.WEBHOOK_CALLBACK_URL.trim() || null,
        WEBHOOK_ENABLED: form.WEBHOOK_ENABLED,
        DEFAULT_COUNTRY_CODE: form.DEFAULT_COUNTRY_CODE.trim(),
        DEFAULT_LANGUAGE: form.DEFAULT_LANGUAGE.trim() || "en",
        MAX_SEND_PER_SECOND: form.MAX_SEND_PER_SECOND,
        DAILY_SEND_CAP: form.DAILY_SEND_CAP,
        IS_ACTIVE: form.IS_ACTIVE,
      };
      if (modal === "add") {
        await whatsappConfigService.create(payload);
        toast.showSuccess("WhatsApp configuration created");
      } else {
        await whatsappConfigService.update(selected.ID, payload);
        toast.showSuccess("WhatsApp configuration updated");
      }
      closeModal();
      load();
    } catch (e) {
      if (e?.response?.status === 409) {
        toast.showError(e.response.data?.detail || "This configuration conflicts with an existing one.");
      } else if (e?.response?.status === 503) {
        toast.showError(e.response.data?.detail || "Encryption key not configured on the server.");
      } else {
        toast.showError(e?.response?.data?.detail || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, closeModal, load, toast]);

  const handleDelete = useCallback((row) => {
    setConfirmModal({
      title: "Delete WhatsApp Configuration",
      description: `Delete configuration "${row.ACCOUNT_LABEL}"? Stored conversation history is kept. This cannot be undone.`,
      onConfirm: async () => {
        try {
          await whatsappConfigService.remove(row.ID);
          toast.showSuccess("WhatsApp configuration deleted");
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
        await whatsappConfigService.deactivate(row.ID);
        toast.showSuccess("Configuration deactivated");
      } else {
        await whatsappConfigService.activate(row.ID);
        toast.showSuccess("Configuration activated");
      }
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to update status");
    } finally {
      setTogglingId(null);
    }
  }, [load, toast]);

  const handleTestConnection = useCallback(async (row) => {
    setTestingId(row.ID);
    try {
      await whatsappConfigService.testConnection(row.ID);
      toast.showSuccess("Connection verified");
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Connection test failed");
    } finally {
      setTestingId(null);
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
        icon={WhatsAppIcon}
        iconAlt="WhatsApp Configuration"
        title="WhatsApp Configuration"
        subtitle="Manage per-vendor Meta WhatsApp Cloud API accounts — shared by every ERP module (Lead Management, and future modules)"
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
            placeholder="Search by account label, business name, or phone number ID…"
          />
          <span className={styles.count}>{filtered.length} config{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Account Label</th>
                <th>Business Name</th>
                <th>Phone Number ID</th>
                <th>Webhook</th>
                <th>Health</th>
                <th>Status</th>
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
                      icon={WhatsAppIcon}
                      iconAlt="WhatsApp Configuration"
                      title={search ? "No configurations match your search" : "No WhatsApp configurations yet"}
                      description={!search ? "Click 'Add Configuration' to connect a vendor's Meta WhatsApp Business account." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.ACCOUNT_LABEL}</td>
                    <td className={styles.descCell}>{r.BUSINESS_DISPLAY_NAME || "—"}</td>
                    <td><span className={styles.codeBadge}>{r.PHONE_NUMBER_ID}</span></td>
                    <td>
                      {r.WEBHOOK_ENABLED
                        ? <span className={styles.activePill}>Enabled</span>
                        : <span className={styles.inactivePill}>Disabled</span>}
                    </td>
                    <td><span className={healthClass(r.HEALTH_STATUS, styles)}>{r.HEALTH_STATUS}</span></td>
                    <td>
                      {r.IS_ACTIVE
                        ? <span className={styles.activePill}>Active</span>
                        : <span className={styles.inactivePill}>Inactive</span>}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} onClick={() => openView(r)} title="View">
                          <img src={ViewIcon} alt="View" />
                        </button>
                        <button className={styles.iconBtn} onClick={() => openEdit(r)} title="Edit">
                          <img src={EditIcon} alt="Edit" />
                        </button>
                        <button
                          className={styles.toggleBtn}
                          onClick={() => handleTestConnection(r)}
                          disabled={testingId === r.ID}
                          title="Test Connection"
                        >
                          {testingId === r.ID ? "…" : "Test"}
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
        title={modal === "add" ? "Add WhatsApp Configuration" : modal === "edit" ? "Edit WhatsApp Configuration" : "View WhatsApp Configuration"}
        size="lg"
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
          <div className={styles.sectionTitle}>Identity</div>
          <div className={styles.formGroup}>
            <label>Account Label {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.ACCOUNT_LABEL ? " " + styles.inputError : ""}`}
              value={form.ACCOUNT_LABEL}
              onChange={(e) => handleFormChange("ACCOUNT_LABEL", e.target.value)}
              placeholder="e.g. Main WhatsApp Business Account"
              disabled={readOnly}
            />
            {errors.ACCOUNT_LABEL && <span className={styles.fieldError}>{errors.ACCOUNT_LABEL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Business Display Name</label>
            <input
              className={styles.input}
              value={form.BUSINESS_DISPLAY_NAME}
              onChange={(e) => handleFormChange("BUSINESS_DISPLAY_NAME", e.target.value)}
              placeholder="Auto-filled by Test Connection"
              disabled={readOnly}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Business Phone Number</label>
            <input
              className={styles.input}
              value={form.BUSINESS_PHONE_NUMBER}
              onChange={(e) => handleFormChange("BUSINESS_PHONE_NUMBER", e.target.value)}
              placeholder="Auto-filled by Test Connection"
              disabled={readOnly}
            />
          </div>

          <div className={styles.sectionTitle}>Meta Credentials</div>
          <div className={styles.formGroup}>
            <label>Phone Number ID {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.PHONE_NUMBER_ID ? " " + styles.inputError : ""}`}
              value={form.PHONE_NUMBER_ID}
              onChange={(e) => handleFormChange("PHONE_NUMBER_ID", e.target.value)}
              placeholder="From Meta Business dashboard"
              disabled={readOnly}
            />
            {errors.PHONE_NUMBER_ID && <span className={styles.fieldError}>{errors.PHONE_NUMBER_ID}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>WhatsApp Business Account ID (WABA ID) {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.WABA_ID ? " " + styles.inputError : ""}`}
              value={form.WABA_ID}
              onChange={(e) => handleFormChange("WABA_ID", e.target.value)}
              disabled={readOnly}
            />
            {errors.WABA_ID && <span className={styles.fieldError}>{errors.WABA_ID}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Meta App ID</label>
            <input
              className={styles.input}
              value={form.APP_ID}
              onChange={(e) => handleFormChange("APP_ID", e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Token Expires At</label>
            <input
              className={styles.input}
              type="date"
              value={form.TOKEN_EXPIRES_AT}
              onChange={(e) => handleFormChange("TOKEN_EXPIRES_AT", e.target.value)}
              disabled={readOnly}
            />
            <span className={styles.hint}>Leave blank for a permanent system-user token</span>
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>
              Meta App Secret {modal === "edit" && <span className={styles.hint}> (blank = keep existing)</span>}
            </label>
            <div className={styles.passwordWrap}>
              <input
                className={styles.inputPassword}
                type={showAppSecret ? "text" : "password"}
                value={form.APP_SECRET}
                onChange={(e) => handleFormChange("APP_SECRET", e.target.value)}
                placeholder={modal === "add" ? "Enter App Secret" : "●●●●●●●●"}
                autoComplete="new-password"
                disabled={readOnly}
              />
              {!readOnly && (
                <button type="button" className={styles.showPasswordBtn} onClick={() => setShowAppSecret((v) => !v)} tabIndex={-1}>
                  {showAppSecret ? "Hide" : "Show"}
                </button>
              )}
            </div>
            <span className={styles.hint}>Encrypted at rest — used to verify webhook signatures</span>
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>
              Permanent Access Token {modal === "add" && <span className={styles.req}>*</span>}
              {modal === "edit" && <span className={styles.hint}> (blank = keep existing)</span>}
            </label>
            <div className={styles.passwordWrap}>
              <input
                className={`${styles.inputPassword}${errors.ACCESS_TOKEN ? " " + styles.inputError : ""}`}
                type={showAccessToken ? "text" : "password"}
                value={form.ACCESS_TOKEN}
                onChange={(e) => handleFormChange("ACCESS_TOKEN", e.target.value)}
                placeholder={modal === "add" ? "Enter Access Token" : "●●●●●●●●"}
                autoComplete="new-password"
                disabled={readOnly}
              />
              {!readOnly && (
                <button type="button" className={styles.showPasswordBtn} onClick={() => setShowAccessToken((v) => !v)} tabIndex={-1}>
                  {showAccessToken ? "Hide" : "Show"}
                </button>
              )}
            </div>
            {errors.ACCESS_TOKEN && <span className={styles.fieldError}>{errors.ACCESS_TOKEN}</span>}
            <span className={styles.hint}>Encrypted at rest</span>
          </div>

          <div className={styles.sectionTitle}>Webhook</div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Verify Token {!readOnly && <span className={styles.req}>*</span>}</label>
            <div className={styles.copyWrap}>
              <input
                className={`${styles.input}${errors.VERIFY_TOKEN ? " " + styles.inputError : ""}`}
                value={form.VERIFY_TOKEN}
                onChange={(e) => handleFormChange("VERIFY_TOKEN", e.target.value)}
                disabled={readOnly}
              />
              <button type="button" className={styles.copyBtn} onClick={() => handleCopy(form.VERIFY_TOKEN)} tabIndex={-1}>Copy</button>
            </div>
            {errors.VERIFY_TOKEN && <span className={styles.fieldError}>{errors.VERIFY_TOKEN}</span>}
            {!readOnly && (
              <span className={styles.hint}>
                Paste this into Meta's webhook setup screen. Not a secret — shown in full so it can be matched exactly.
              </span>
            )}
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Webhook Callback URL</label>
            <div className={styles.copyWrap}>
              <input
                className={styles.input}
                value={form.WEBHOOK_CALLBACK_URL}
                onChange={(e) => handleFormChange("WEBHOOK_CALLBACK_URL", e.target.value)}
                placeholder="https://your-backend-domain.com/whatsapp-webhook"
                disabled={readOnly}
              />
              <button type="button" className={styles.copyBtn} onClick={() => handleCopy(form.WEBHOOK_CALLBACK_URL)} tabIndex={-1}>Copy</button>
            </div>
            <span className={styles.hint}>The public URL you register in Meta's App dashboard for this account</span>
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={form.WEBHOOK_ENABLED}
                onChange={(e) => handleFormChange("WEBHOOK_ENABLED", e.target.checked)}
                disabled={readOnly}
              />
              Webhook Enabled — accept and process inbound customer messages
            </label>
          </div>

          <div className={styles.sectionTitle}>API Settings</div>
          <div className={styles.formGroup}>
            <label>API Base URL {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.API_BASE_URL ? " " + styles.inputError : ""}`}
              value={form.API_BASE_URL}
              onChange={(e) => handleFormChange("API_BASE_URL", e.target.value)}
              disabled={readOnly}
            />
            {errors.API_BASE_URL && <span className={styles.fieldError}>{errors.API_BASE_URL}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Graph API Version {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.GRAPH_API_VERSION ? " " + styles.inputError : ""}`}
              value={form.GRAPH_API_VERSION}
              onChange={(e) => handleFormChange("GRAPH_API_VERSION", e.target.value)}
              placeholder="v21.0"
              disabled={readOnly}
            />
            {errors.GRAPH_API_VERSION && <span className={styles.fieldError}>{errors.GRAPH_API_VERSION}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Default Country Code {!readOnly && <span className={styles.req}>*</span>}</label>
            <input
              className={`${styles.input}${errors.DEFAULT_COUNTRY_CODE ? " " + styles.inputError : ""}`}
              value={form.DEFAULT_COUNTRY_CODE}
              onChange={(e) => handleFormChange("DEFAULT_COUNTRY_CODE", e.target.value)}
              placeholder="91"
              disabled={readOnly}
            />
            {errors.DEFAULT_COUNTRY_CODE && <span className={styles.fieldError}>{errors.DEFAULT_COUNTRY_CODE}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Default Language</label>
            <input
              className={styles.input}
              value={form.DEFAULT_LANGUAGE}
              onChange={(e) => handleFormChange("DEFAULT_LANGUAGE", e.target.value)}
              placeholder="en"
              disabled={readOnly}
            />
            <span className={styles.hint}>Fallback language code before any module-specific language selection happens</span>
          </div>

          <div className={styles.sectionTitle}>Rate Limits & Status</div>
          <div className={styles.formGroup}>
            <label>Max Sends / Second</label>
            <input
              className={`${styles.input}${errors.MAX_SEND_PER_SECOND ? " " + styles.inputError : ""}`}
              type="number"
              min={1}
              max={80}
              value={form.MAX_SEND_PER_SECOND}
              onChange={(e) => handleFormChange("MAX_SEND_PER_SECOND", e.target.value)}
              disabled={readOnly}
            />
            {errors.MAX_SEND_PER_SECOND && <span className={styles.fieldError}>{errors.MAX_SEND_PER_SECOND}</span>}
          </div>
          <div className={styles.formGroup}>
            <label>Daily Send Cap</label>
            <input
              className={`${styles.input}${errors.DAILY_SEND_CAP ? " " + styles.inputError : ""}`}
              type="number"
              min={1}
              max={100000}
              value={form.DAILY_SEND_CAP}
              onChange={(e) => handleFormChange("DAILY_SEND_CAP", e.target.value)}
              disabled={readOnly}
            />
            {errors.DAILY_SEND_CAP && <span className={styles.fieldError}>{errors.DAILY_SEND_CAP}</span>}
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
              Active — enables outbound sending for this configuration
            </label>
          </div>

          {selected && (
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <div className={styles.metaRow}>
                <span>Health: <strong>{selected.HEALTH_STATUS}</strong>{selected.LAST_ERROR_MESSAGE ? ` — ${selected.LAST_ERROR_MESSAGE}` : ""}</span>
                <span>Last Success: {formatDateTime(selected.LAST_SUCCESS_AT)}</span>
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
