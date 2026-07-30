import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMEntityFormModal, PMEntityDetailsModal, SearchBar,
  EmptyState, Loader, PMButton, PMConfirmModal, PMSelect,
} from "../components/pm";
import { whatsappModuleSettingService } from "../services/whatsappModuleSettingService";
import { whatsappConfigService } from "../services/whatsappConfigService";
import { useToast } from "../hooks/useToast";
import { validateForm, clearFieldError, WHATSAPP_MODULE_SETTING_ADMIN_RULES } from "../utils/formValidation";
import {
  WHATSAPP_MODULE_SETTING_FORM_SCHEMA,
  WHATSAPP_MODULE_SETTING_DETAIL_SCHEMA,
  buildWhatsAppPreviewSections,
  MODULE_OPTIONS,
  moduleLabel,
} from "./whatsappModuleSettingSchemas";
import WhatsAppIcon from "../assets/Icons/mailIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import ViewIcon from "../assets/Icons/detailsIcon.webp";
import styles from "./WhatsAppModuleSettingsManagement.module.css";

const EMPTY_FORM = {
  MODULE_CODE: "",
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

const STATUS_FILTER_OPTIONS = [
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

const SettingRow = React.memo(function SettingRow({ row, index, onView, onEdit, onDelete, onToggle, isToggling }) {
  return (
    <tr>
      <td className={styles.idx}>{index}</td>
      <td>
        <span className={styles.codeBadge}>{moduleLabel(row.MODULE_CODE)}</span>
      </td>
      <td className={styles.descCell}>
        {row.WELCOME_TEMPLATE_NAME ? `${row.WELCOME_TEMPLATE_NAME} (${row.WELCOME_TEMPLATE_LANG || "—"})` : "— Not configured —"}
      </td>
      <td className={styles.muted}>{row.SUPPORTED_LANGUAGES || "—"}</td>
      <td>
        <span className={row.AUTO_TRIGGER_ENABLED ? styles.activePill : styles.inactivePill}>
          {row.AUTO_TRIGGER_ENABLED ? "On" : "Off"}
        </span>
      </td>
      <td>
        <span className={row.AI_REPLY_ENABLED ? styles.activePill : styles.inactivePill}>
          {row.AI_REPLY_ENABLED ? "On" : "Off"}
        </span>
      </td>
      <td>
        <span className={row.IS_ENABLED ? styles.activePill : styles.inactivePill}>
          {row.IS_ENABLED ? "Enabled" : "Disabled"}
        </span>
      </td>
      <td>
        <div className={styles.rowActions}>
          <button className={styles.iconBtn} onClick={() => onView(row)} title="View Details" aria-label="View Details">
            <img src={ViewIcon} alt="" />
          </button>
          <button className={styles.iconBtn} onClick={() => onEdit(row)} title="Edit" aria-label="Edit">
            <img src={EditIcon} alt="" />
          </button>
          <button className={styles.iconBtnDanger} onClick={() => onDelete(row)} title="Delete" aria-label="Delete">
            <img src={DeleteIcon} alt="" />
          </button>
          <button
            className={row.IS_ENABLED ? styles.toggleBtnActive : styles.toggleBtn}
            onClick={() => onToggle(row)}
            disabled={isToggling}
          >
            {row.IS_ENABLED ? "Disable" : "Enable"}
          </button>
        </div>
      </td>
    </tr>
  );
});

export default function WhatsAppModuleSettingsManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(null); // null | "enabled" | "disabled"
  const [moduleFilter, setModuleFilter] = useState(null); // null | MODULE_CODE string
  const [modal, setModal] = useState(null); // null | "add" | "edit" | "view"
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [confirmModal, setConfirmModal] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [businessDisplayName, setBusinessDisplayName] = useState("");

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await whatsappModuleSettingService.getAll();
      setRows(res.data?.rows || []);
    } catch {
      toast.showError("Failed to load WhatsApp module settings");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadVendorConfig = useCallback(async () => {
    try {
      const res = await whatsappConfigService.getAll();
      const cfg = (res.data?.rows || [])[0];
      setBusinessDisplayName(cfg?.BUSINESS_DISPLAY_NAME || "");
    } catch {
      // Non-critical — the preview just falls back to a generic placeholder.
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
    loadVendorConfig();
  }, [load, loadVendorConfig]);

  const handleRefresh = useCallback(() => load(true), [load]);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter === "enabled") r = r.filter((x) => x.IS_ENABLED);
    else if (statusFilter === "disabled") r = r.filter((x) => !x.IS_ENABLED);
    if (moduleFilter) r = r.filter((x) => x.MODULE_CODE === moduleFilter);
    if (search.trim()) {
      const t = search.toLowerCase();
      r = r.filter(
        (x) =>
          (x.MODULE_CODE || "").toLowerCase().includes(t) ||
          (x.WELCOME_TEMPLATE_NAME || "").toLowerCase().includes(t) ||
          (x.REENGAGE_TEMPLATE_NAME || "").toLowerCase().includes(t)
      );
    }
    return r;
  }, [rows, search, statusFilter, moduleFilter]);

  const paginated = useMemo(
    () => (pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)),
    [filtered, page, pageSize]
  );

  const stats = useMemo(
    () => [
      { value: rows.length, label: "Total Modules" },
      { value: rows.filter((r) => r.IS_ENABLED).length, label: "Enabled" },
      { value: rows.filter((r) => r.AI_REPLY_ENABLED).length, label: "AI Reply Enabled" },
      { value: filtered.length, label: "Showing" },
    ],
    [rows, filtered.length]
  );

  const handleSearchChange = useCallback((val) => {
    setSearch(val);
    setPage(1);
  }, []);

  const handleStatusFilterChange = useCallback((val) => {
    setStatusFilter(val || null);
    setPage(1);
  }, []);

  const handleModuleFilterChange = useCallback((val) => {
    setModuleFilter(val || null);
    setPage(1);
  }, []);

  const hasFilters = !!statusFilter || !!moduleFilter;

  const handleResetFilters = useCallback(() => {
    setStatusFilter(null);
    setModuleFilter(null);
    setPage(1);
  }, []);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelected(null);
    setErrors({});
    setModal("add");
  }, []);

  const formFromRow = useCallback(
    (row) => ({
      MODULE_CODE: row.MODULE_CODE || "",
      IS_ENABLED: !!row.IS_ENABLED,
      AUTO_TRIGGER_ENABLED: !!row.AUTO_TRIGGER_ENABLED,
      WELCOME_TEMPLATE_NAME: row.WELCOME_TEMPLATE_NAME || "",
      WELCOME_TEMPLATE_LANG: row.WELCOME_TEMPLATE_LANG || "en_US",
      WELCOME_TEMPLATE_PARAMS: row.WELCOME_TEMPLATE_PARAMS || "",
      REENGAGE_TEMPLATE_NAME: row.REENGAGE_TEMPLATE_NAME || "",
      REENGAGE_TEMPLATE_LANG: row.REENGAGE_TEMPLATE_LANG || "en_US",
      AI_REPLY_ENABLED: !!row.AI_REPLY_ENABLED,
      SUPPORTED_LANGUAGES: row.SUPPORTED_LANGUAGES || "en",
    }),
    []
  );

  const openEdit = useCallback(
    (row) => {
      setForm(formFromRow(row));
      setSelected(row);
      setErrors({});
      setModal("edit");
    },
    [formFromRow]
  );

  const openView = useCallback((row) => {
    setSelected(row);
    setModal("view");
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelected(null);
    setErrors({});
  }, []);

  const handleFormChange = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    clearFieldError(setErrors, field);
  }, []);

  const handleSave = useCallback(async () => {
    const { isValid, errors: fieldErrors } = validateForm(WHATSAPP_MODULE_SETTING_ADMIN_RULES, form);
    if (!isValid) {
      setErrors(fieldErrors);
      return;
    }
    setSaving(true);
    try {
      if (modal === "add") {
        await whatsappModuleSettingService.createForModule(form.MODULE_CODE, form);
        toast.showSuccess("WhatsApp module setting created");
      } else {
        const updatePayload = { ...form };
        delete updatePayload.MODULE_CODE;
        await whatsappModuleSettingService.update(selected.ID, updatePayload);
        toast.showSuccess("WhatsApp module setting updated");
      }
      closeModal();
      load(true);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.showError(typeof detail === "string" ? detail : "Failed to save WhatsApp module setting");
    } finally {
      setSaving(false);
    }
  }, [form, modal, selected, toast, closeModal, load]);

  const handleDelete = useCallback(
    (row) => {
      setConfirmModal({
        title: "Delete WhatsApp Module Setting",
        description:
          `Delete the WhatsApp automation settings for module "${row.MODULE_CODE}"? This will silently stop ` +
          `all automatic WhatsApp welcome/re-engagement messages and AI replies for this module — the sending ` +
          `code treats a missing setting as "do nothing," not as an error, so no one will be alerted. This ` +
          `cannot be undone.`,
        onConfirm: async () => {
          try {
            await whatsappModuleSettingService.remove(row.ID);
            toast.showSuccess("WhatsApp module setting deleted");
            load(true);
          } catch {
            toast.showError("Failed to delete WhatsApp module setting");
          }
        },
      });
    },
    [toast, load]
  );

  const handleToggle = useCallback(
    async (row) => {
      setTogglingId(row.ID);
      try {
        await whatsappModuleSettingService.update(row.ID, { IS_ENABLED: !row.IS_ENABLED });
        toast.showSuccess(row.IS_ENABLED ? "Module setting disabled" : "Module setting enabled");
        load(true);
      } catch {
        toast.showError("Failed to update status");
      } finally {
        setTogglingId(null);
      }
    },
    [toast, load]
  );

  const detailExtraSections = useMemo(() => buildWhatsAppPreviewSections(businessDisplayName), [businessDisplayName]);

  const detailActions = useMemo(() => {
    if (!selected) return null;
    return (
      <PMButton
        variant="outline"
        onClick={() => {
          closeModal();
          openEdit(selected);
        }}
      >
        Edit
      </PMButton>
    );
  }, [selected, closeModal, openEdit]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={WhatsAppIcon}
        iconAlt="WhatsApp Module Settings"
        title="WhatsApp Module Settings"
        subtitle="Configure per-module WhatsApp automation — welcome/re-engagement templates, AI auto-reply, and supported languages for each ERP module."
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={<PMButton onClick={openAdd}>Add Module Setting</PMButton>}
      />

      <div className={styles.tableSection}>
        <StatsRow stats={stats} />

        <div className={styles.toolbar}>
          <SearchBar value={search} onChange={handleSearchChange} placeholder="Search by module code or template name…" />
          <span className={styles.count}>{filtered.length} of {rows.length}</span>
        </div>

        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <label>Status</label>
            <PMSelect
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={handleStatusFilterChange}
              valueKey="value"
              labelKey="label"
              allowClear
              clearLabel="All Statuses"
            />
          </div>
          <div className={styles.filterGroup}>
            <label>Module</label>
            <PMSelect
              options={MODULE_OPTIONS}
              value={moduleFilter}
              onChange={handleModuleFilterChange}
              valueKey="value"
              labelKey="label"
              allowClear
              clearLabel="All Modules"
            />
          </div>
          {hasFilters && (
            <div className={styles.filterActions}>
              <PMButton variant="outline" onClick={handleResetFilters}>Reset Filters</PMButton>
            </div>
          )}
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Module</th>
                <th>Welcome Template</th>
                <th>Languages</th>
                <th>Auto-Trigger</th>
                <th>AI Reply</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <Loader />
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No WhatsApp module settings found"
                      description="Add a setting to configure WhatsApp automation for an ERP module."
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((row, i) => (
                  <SettingRow
                    key={row.ID}
                    row={row}
                    index={(page - 1) * pageSize + i + 1}
                    onView={openView}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onToggle={handleToggle}
                    isToggling={togglingId === row.ID}
                  />
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
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      <PMEntityFormModal
        open={modal === "add" || modal === "edit"}
        onClose={closeModal}
        mode={modal === "add" ? "add" : "edit"}
        title={modal === "add" ? "Add WhatsApp Module Setting" : "Edit WhatsApp Module Setting"}
        size="lg"
        schema={WHATSAPP_MODULE_SETTING_FORM_SCHEMA}
        values={form}
        errors={errors}
        onFieldChange={handleFormChange}
        saving={saving}
        onSave={handleSave}
        saveLabel={modal === "add" ? "Create Setting" : "Save Changes"}
      />

      <PMEntityDetailsModal
        open={modal === "view"}
        onClose={closeModal}
        title="WhatsApp Module Setting Details"
        size="lg"
        schema={WHATSAPP_MODULE_SETTING_DETAIL_SCHEMA}
        values={selected || {}}
        actions={detailActions}
        extraSections={detailExtraSections}
      />

      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm}
        title={confirmModal?.title}
        description={confirmModal?.description}
      />
    </div>
  );
}
