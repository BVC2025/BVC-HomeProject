import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMSelect, PMConfirmModal,
} from "../components/pm";
import { projectService } from "../services/projectService";
import { taskService } from "../services/taskService";
import { categoryService } from "../services/categoryService";
import { departmentService } from "../services/departmentService";
import { roleService } from "../services/roleService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import ProjectIcon from "../assets/Icons/projectIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import BomIcon from "../assets/Icons/bomIcon.webp"
import ManualIcon from "../assets/Icons/editIcon.webp"
import UploadIcon from "../assets/Icons/uploadIcon.webp"
import styles from "./ProjectPage.module.css";

const DURATION_UNITS = ["HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"];

const EMPTY_TASK = () => ({
  _key: Math.random().toString(36).slice(2),
  NAME: "", DESCRIPTION: "", DURATION_VALUE: 1, DURATION_UNIT: "DAYS",
  DEPARTMENT_ID: "", ROLE_ID: "",
});

export default function ProjectPage() {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cfOpen, setCfOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

  // Wizard
  const [wizard, setWizard] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ CATEGORY_ID: "", NAME: "", DESCRIPTION: "", BOM_MODE: "MANUAL" });
  const [tasks, setTasks] = useState([EMPTY_TASK()]);
  const [saving, setSaving] = useState(false);

  // BOM parse
  const [bomFile, setBomFile] = useState(null);
  const [bomSheets, setBomSheets] = useState([]);
  const [bomSheet, setBomSheet] = useState("");
  const [bomParsing, setBomParsing] = useState(false);
  const [bomParsed, setBomParsed] = useState(false);
  const fileRef = useRef();
  const [dragIdx, setDragIdx] = useState(null);

  // Bulk upload (separate from BOM upload)
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkXlFile, setBulkXlFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkUploadResult, setBulkUploadResult] = useState(null);
  const bulkFileRef = useRef();

  const toast = useToast();
  const fetchedRef = useRef(false);
  const { fields: cfFields, cfValues, handleCfChange, loadValues: loadCfValues, resetValues: resetCfValues, validateCf, saveCfValues, refreshFields } = useCustomFields("project");
  const cfValuesMap = useTableCfValues("project", rows);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [projRes, catRes, deptRes, roleRes] = await Promise.all([
        projectService.getAll(),
        categoryService.getAll(),
        departmentService.getAll(),
        roleService.getAll(),
      ]);
      setRows(projRes.data || []);
      setCategories(catRes.data || []);
      setDepartments(deptRes.data || []);
      setAllRoles(roleRes.data || []);
    } catch {
      toast.showError("Failed to load data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadAll();
  }, [loadAll]);

  const handleRefresh = useCallback(() => loadAll(true), [loadAll]);

  const catMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.ID, c.NAME])),
    [categories]
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (filterCat) r = r.filter((x) => x.CATEGORY_ID === filterCat);
    if (search.trim()) {
      const t = search.toLowerCase();
      r = r.filter((x) => x.NAME?.toLowerCase().includes(t));
    }
    return r;
  }, [rows, search, filterCat]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: rows.length, label: "Total Projects" },
    { value: rows.filter((r) => r.BOM_MODE === "BOM_UPLOAD").length, label: "BOM Upload" },
    { value: rows.filter((r) => r.BOM_MODE !== "BOM_UPLOAD").length, label: "Manual" },
    { value: filtered.length, label: "Showing" },
  ], [rows, filtered.length]);

  const rolesForDept = useCallback(
    (deptId) => deptId ? allRoles.filter((r) => String(r.DEPARTMENT_ID) === String(deptId)) : allRoles,
    [allRoles]
  );

  const openCreate = useCallback(() => {
    setForm({ CATEGORY_ID: "", NAME: "", DESCRIPTION: "", BOM_MODE: "MANUAL" });
    setTasks([EMPTY_TASK()]);
    setBomFile(null); setBomSheets([]); setBomSheet(""); setBomParsed(false);
    setStep(1); setEditRow(null); setWizard("create");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback(async (row) => {
    setForm({ CATEGORY_ID: row.CATEGORY_ID, NAME: row.NAME, DESCRIPTION: row.DESCRIPTION || "", BOM_MODE: row.BOM_MODE || "MANUAL" });
    setEditRow(row);
    try {
      const taskRes = await taskService.getByProject(row.ID);
      setTasks(
        taskRes.data.length > 0
          ? taskRes.data.map((t) => ({
            _key: t.ID,
            ID: t.ID,
            NAME: t.NAME,
            DESCRIPTION: t.DESCRIPTION || "",
            DURATION_VALUE: t.DURATION_VALUE,
            DURATION_UNIT: t.DURATION_UNIT,
            DEPARTMENT_ID: t.DEPARTMENT_ID ? String(t.DEPARTMENT_ID) : "",
            ROLE_ID: t.ROLE_ID ? String(t.ROLE_ID) : "",
          }))
          : [EMPTY_TASK()]
      );
    } catch {
      setTasks([EMPTY_TASK()]);
    }
    setBomFile(null); setBomSheets([]); setBomSheet(""); setBomParsed(false);
    setStep(1); setWizard("edit");
    loadCfValues(row.ID);
  }, [loadCfValues]);

  const closeWizard = useCallback(() => { setWizard(null); setStep(1); setEditRow(null); }, []);

  const handleDelete = useCallback((row) => {
    setConfirmModal({
      title: "Delete Project",
      description: `Delete project "${row.NAME}"? This will also delete all its tasks.`,
      onConfirm: async () => {
        try {
          await projectService.remove(row.ID);
          toast.showSuccess("Project deleted");
          loadAll();
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [loadAll, toast]);

  const goStep2 = useCallback(() => {
    if (!form.CATEGORY_ID) { toast.showWarning("Please select a category"); return; }
    if (!form.NAME.trim()) { toast.showWarning("Project name is required"); return; }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setStep(2);
  }, [form, toast, validateCf]);

  const handleBomFile = useCallback(async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setBomFile(f); setBomSheets([]); setBomSheet(""); setBomParsed(false); setBomParsing(true);
    const fd = new FormData(); fd.append("file", f);
    try {
      const res = await projectService.parseBom(fd);
      if (res.data.sheets) { setBomSheets(res.data.sheets); }
      else if (res.data.rows) { applyBomRows(res.data.rows); }
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "BOM parse failed");
    } finally {
      setBomParsing(false);
    }
  }, [toast]);

  const handleBomSheet = useCallback(async () => {
    if (!bomFile || !bomSheet) return;
    setBomParsing(true);
    const fd = new FormData(); fd.append("file", bomFile);
    try {
      const res = await projectService.parseBom(fd, bomSheet);
      if (res.data.rows) applyBomRows(res.data.rows);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Parse failed");
    } finally {
      setBomParsing(false);
    }
  }, [bomFile, bomSheet, toast]);

  const applyBomRows = (bomRows) => {
    setTasks(
      bomRows.map((r, i) => ({
        _key: Math.random().toString(36).slice(2) + i,
        NAME: r.name || r.NAME || "",
        DESCRIPTION: r.description || r.DESCRIPTION || "",
        DURATION_VALUE: r.duration_value || 1,
        DURATION_UNIT: r.duration_unit || "DAYS",
        DEPARTMENT_ID: "",
        ROLE_ID: "",
      }))
    );
    setBomParsed(true);
  };

  const addTask = useCallback(() => setTasks((prev) => [...prev, EMPTY_TASK()]), []);
  const removeTask = useCallback((idx) => setTasks((prev) => prev.filter((_, i) => i !== idx)), []);
  const updateTask = useCallback((idx, field, value) =>
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t))), []);

  const onDragStart = useCallback((idx) => setDragIdx(idx), []);
  const onDragOver = useCallback((e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setTasks((prev) => {
      const a = [...prev];
      const [r] = a.splice(dragIdx, 1);
      a.splice(idx, 0, r);
      setDragIdx(idx);
      return a;
    });
  }, [dragIdx]);
  const onDragEnd = useCallback(() => setDragIdx(null), []);

  const handleSave = useCallback(async () => {
    const validTasks = tasks.filter((t) => t.NAME.trim());
    if (validTasks.length === 0) { toast.showWarning("Add at least one task"); return; }
    setSaving(true);
    try {
      const payload = {
        CATEGORY_ID: form.CATEGORY_ID,
        NAME: form.NAME,
        DESCRIPTION: form.DESCRIPTION || null,
        BOM_MODE: form.BOM_MODE,
        tasks: validTasks.map((t, i) => ({
          NAME: t.NAME,
          DESCRIPTION: t.DESCRIPTION || null,
          DURATION_VALUE: parseFloat(t.DURATION_VALUE) || 1,
          DURATION_UNIT: t.DURATION_UNIT,
          SEQUENCE_NUMBER: i,
          DEPARTMENT_ID: t.DEPARTMENT_ID ? parseInt(t.DEPARTMENT_ID) : null,
          ROLE_ID: t.ROLE_ID ? parseInt(t.ROLE_ID) : null,
        })),
      };
      if (wizard === "edit" && editRow) {
        await projectService.update(editRow.ID, payload);
        await saveCfValues(editRow.ID);
        toast.showSuccess("Project updated");
      } else {
        const res = await projectService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Project created");
      }
      closeWizard();
      loadAll();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [tasks, form, wizard, editRow, closeWizard, loadAll, toast, saveCfValues]);

  const handleExport = useCallback(() => {
    const data = filtered.map((r, i) => {
      const row = {
        "S.No": i + 1,
        "Project Name": r.NAME,
        Category: catMap[r.CATEGORY_ID] || "",
        Mode: r.BOM_MODE === "BOM_UPLOAD" ? "BOM Upload" : "Manual",
        Tasks: r.TASK_COUNT ?? "",
        "Est. Days": r.ESTIMATED_TOTAL_DAYS ? parseFloat(r.ESTIMATED_TOTAL_DAYS).toFixed(1) : "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(r.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, "projects");
  }, [filtered, catMap, cfFields, cfValuesMap]);

  const handleSearchChange = useCallback((v) => { setSearch(v); setPage(1); }, []);
  const handleCatFilter = useCallback((v) => { setFilterCat(v); setPage(1); }, []);

  const handleDownloadProjTemplate = useCallback(async () => {
    try {
      const headers = ["Category Name", "Project Name", "Description", ...cfFields.map((f) => f.FIELD_NAME)];
      await dlTemplate("Projects", headers, "projects_template");
    } catch {
      toast.showError("Failed to download template");
    }
  }, [cfFields, toast]);

  const openBulkXl = useCallback(() => {
    setBulkXlFile(null);
    setBulkUploadResult(null);
    setBulkModal(true);
  }, []);

  const handleBulkFileChange = useCallback(async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = "";
    setBulkXlFile(f);
    setBulkUploadResult(null);
    const fd = new FormData();
    fd.append("file", f);
    setBulkUploading(true);
    try {
      const res = await projectService.bulkUpload(fd);
      setBulkUploadResult(res.data);
      loadAll(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [loadAll, toast]);

  const fmtDays = (d) => (d != null ? `${parseFloat(d).toFixed(1)} d` : "—");

  return (
    <div className={styles.page}>
      <PageHeader
        icon={ProjectIcon}
        iconAlt="Projects"
        title="Projects"
        subtitle="Define project templates with task sequences and duration tracking"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={handleDownloadProjTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulkXl}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={filtered.length === 0} />
            <PMButton variant="primary" onClick={openCreate}>New Project</PMButton>
          </>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search projects…"
          />
          <div className={styles.catFilter}>
            <PMSelect
              options={categories}
              value={filterCat ?? ""}
              onChange={(v) => handleCatFilter(v || null)}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="All Categories"
            />
          </div>
          <span className={styles.count}>{filtered.length} project{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Project Name</th>
                <th>Category</th>
                <th>Mode</th>
                <th>Tasks</th>
                <th>Est. Days</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7 + cfFields.length}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7 + cfFields.length}>
                    <EmptyState
                      icon={ProjectIcon}
                      iconAlt="Projects"
                      title={search || filterCat ? "No projects match your filter" : "No projects yet"}
                      description={!search && !filterCat ? "Click '+ New Project' to create one." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r, i) => (
                  <tr key={r.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{r.NAME}</td>
                    <td>
                      <span className={styles.catBadge}>
                        {r.CATEGORY_NAME || catMap[r.CATEGORY_ID] || "—"}
                      </span>
                    </td>
                    <td>
                      {r.BOM_MODE === "BOM_UPLOAD"
                        ? <span className={`${styles.modeBadge} ${styles.modeBom}`}>BOM</span>
                        : <span className={`${styles.modeBadge} ${styles.modeManual}`}>Manual</span>}
                    </td>
                    <td className={styles.numCell}>{r.TASK_COUNT ?? "—"}</td>
                    <td className={styles.numCell}>{fmtDays(r.ESTIMATED_TOTAL_DAYS)}</td>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(r.ID)]?.[f.ID];
                      return <td key={f.ID} className={styles.descCell}>{val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}</td>;
                    })}
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} onClick={() => openEdit(r)} title="Edit">
                          <img src={EditIcon} alt="Edit" />
                        </button>
                        <PMButton variant="ghost" size="sm" onClick={() => navigate(`/task-templates?project_id=${r.ID}`)}>Tasks</PMButton>
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

      {/* ── Wizard Modal */}
      {wizard && (
        <div className={styles.overlay} onClick={closeWizard}>
          <div className={styles.wizardModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.wizardHeader}>
              <div>
                <h2 className={styles.wizardTitle}>
                  {wizard === "edit" ? "Edit Project" : "New Project"}
                </h2>
                <div className={styles.stepRow}>
                  {["Basic Info", "Tasks", "Review"].map((s, i) => (
                    <div
                      key={i}
                      className={`${styles.stepItem} ${step === i + 1 ? styles.stepActive : step > i + 1 ? styles.stepDone : ""}`}
                    >
                      <span className={styles.stepDot}>{step > i + 1 ? "✓" : i + 1}</span>
                      <span className={styles.stepLabel}>{s}</span>
                      {i < 2 && <span className={styles.stepLine} />}
                    </div>
                  ))}
                </div>
              </div>
              <button className={styles.closeBtn} onClick={closeWizard}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Step 1 */}
            {step === 1 && (
              <div className={styles.wizardBody}>
                <div className={styles.formGroup}>
                  <label>Category <span className={styles.req}>*</span></label>
                  <PMSelect
                    options={categories}
                    value={form.CATEGORY_ID}
                    onChange={(val) => setForm((f) => ({ ...f, CATEGORY_ID: val }))}
                    valueKey="ID"
                    labelKey="NAME"
                    allowClear
                    clearLabel="— Select category —"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Project Name <span className={styles.req}>*</span></label>
                  <input
                    className={styles.input}
                    value={form.NAME}
                    onChange={(e) => setForm((f) => ({ ...f, NAME: e.target.value }))}
                    placeholder="e.g. Electrical Panel Installation"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Description</label>
                  <textarea
                    className={styles.textarea}
                    value={form.DESCRIPTION}
                    onChange={(e) => setForm((f) => ({ ...f, DESCRIPTION: e.target.value }))}
                    placeholder="Optional description"
                    rows={3}
                  />
                </div>
                <CustomFieldsSection
                  fields={cfFields}
                  values={cfValues}
                  onChange={handleCfChange}
                />
                <div className={styles.formGroup}>
                  <label>Task Entry Mode</label>
                  <div className={styles.modeCards}>
                    <div
                      className={`${styles.modeCard} ${form.BOM_MODE === "MANUAL" ? styles.modeCardActive : ""}`}
                      onClick={() => setForm((f) => ({ ...f, BOM_MODE: "MANUAL" }))}
                    >
                      <div className={styles.modeCardIcon}>
                        <div className={styles.modeCardIconWrap}>
                          <img src={ManualIcon} alt="Manual" />
                        </div>
                      </div>
                      <div className={styles.modeCardTitle}>Manual</div>
                      <div className={styles.modeCardDesc}>Add tasks one by one</div>
                    </div>
                    <div
                      className={`${styles.modeCard} ${form.BOM_MODE === "BOM_UPLOAD" ? styles.modeCardActive : ""}`}
                      onClick={() => setForm((f) => ({ ...f, BOM_MODE: "BOM_UPLOAD" }))}
                    >
                      <div className={styles.modeCardIcon}>
                        <div className={styles.modeCardIconWrap}>
                          <img src={BomIcon} alt="BOM Upload" />
                        </div>
                      </div>
                      <div className={styles.modeCardTitle}>BOM Upload</div>
                      <div className={styles.modeCardDesc}>Import task list from Excel</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2 */}
            {step === 2 && (
              <div className={styles.wizardBody}>
                {form.BOM_MODE === "BOM_UPLOAD" && !bomParsed && (
                  <div className={styles.bomSection}>
                    <div className={styles.dropzone} onClick={() => fileRef.current.click()}>
                      <span className={styles.dropIconWrap}><img src={UploadIcon} alt="Upload" /></span>
                      <span>{bomFile ? bomFile.name : "Click to select BOM Excel file (.xlsx)"}</span>
                      {bomParsing && <span className={styles.hint}>Parsing…</span>}
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      style={{ display: "none" }}
                      onChange={handleBomFile}
                    />
                    {bomSheets.length > 0 && (
                      <div className={styles.sheetRow}>
                        <PMSelect
                          options={bomSheets}
                          value={bomSheet}
                          onChange={setBomSheet}
                          allowClear
                          clearLabel="— Select sheet —"
                          style={{ flex: 1 }}
                        />
                        <PMButton
                          variant="outline"
                          onClick={handleBomSheet}
                          disabled={!bomSheet || bomParsing}
                        >
                          Import
                        </PMButton>
                      </div>
                    )}
                    <p className={styles.orDivider}>or add tasks manually below</p>
                  </div>
                )}

                <div className={styles.taskEditorHeader}>
                  <span className={styles.taskEditorTitle}>
                    Tasks ({tasks.filter((t) => t.NAME.trim()).length})
                  </span>
                  <PMButton variant="outline" size="sm" onClick={addTask}>Add Row</PMButton>
                </div>

                <div className={styles.taskEditor}>
                  <div className={styles.taskEditorHead}>
                    <span className={styles.thDrag} />
                    <span className={styles.thNum}>#</span>
                    <span className={styles.thName}>Task Name *</span>
                    <span className={styles.thDur}>Duration</span>
                    <span className={styles.thDept}>Department</span>
                    <span className={styles.thRole}>Role</span>
                    <span className={styles.thDel} />
                  </div>
                  {tasks.map((t, idx) => (
                    <div
                      key={t._key}
                      className={`${styles.taskRow} ${dragIdx === idx ? styles.taskRowDragging : ""}`}
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => onDragOver(e, idx)}
                      onDragEnd={onDragEnd}
                    >
                      <span className={styles.dragHandle}>⠿</span>
                      <span className={styles.rowNum}>{idx + 1}</span>
                      <input
                        className={styles.taskInput}
                        value={t.NAME}
                        onChange={(e) => updateTask(idx, "NAME", e.target.value)}
                        placeholder="Task name"
                      />
                      <div className={styles.durCell}>
                        <input
                          className={styles.durInput}
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={t.DURATION_VALUE}
                          onChange={(e) => updateTask(idx, "DURATION_VALUE", e.target.value)}
                        />
                        <PMSelect
                          options={DURATION_UNITS}
                          value={t.DURATION_UNIT}
                          onChange={(val) => updateTask(idx, "DURATION_UNIT", val)}
                          size="sm"
                          style={{ flex: 1 }}
                        />
                      </div>
                      <PMSelect
                        options={departments}
                        value={t.DEPARTMENT_ID}
                        onChange={(val) => updateTask(idx, "DEPARTMENT_ID", val)}
                        valueKey="ID"
                        labelKey="NAME"
                        allowClear
                        clearLabel="—"
                        size="sm"
                      />
                      <PMSelect
                        options={rolesForDept(t.DEPARTMENT_ID)}
                        value={t.ROLE_ID}
                        onChange={(val) => updateTask(idx, "ROLE_ID", val)}
                        valueKey="ID"
                        labelKey="NAME"
                        allowClear
                        clearLabel="—"
                        size="sm"
                      />
                      <button
                        className={styles.removeBtn}
                        onClick={() => removeTask(idx)}
                        disabled={tasks.length === 1}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && (
              <div className={styles.wizardBody}>
                <div className={styles.reviewSection}>
                  <div className={styles.reviewGrid}>
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Category</span>
                      <span className={styles.reviewValue}>{catMap[form.CATEGORY_ID] || "—"}</span>
                    </div>
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Project Name</span>
                      <span className={styles.reviewValue}>{form.NAME}</span>
                    </div>
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Mode</span>
                      <span className={styles.reviewValue}>
                        {form.BOM_MODE === "BOM_UPLOAD" ? "BOM Upload" : "Manual"}
                      </span>
                    </div>
                    {form.DESCRIPTION && (
                      <div className={`${styles.reviewItem} ${styles.reviewFull}`}>
                        <span className={styles.reviewLabel}>Description</span>
                        <span className={styles.reviewValue}>{form.DESCRIPTION}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className={styles.reviewTasksTitle}>
                  Tasks ({tasks.filter((t) => t.NAME.trim()).length})
                </div>
                <div className={styles.reviewTaskList}>
                  {tasks.filter((t) => t.NAME.trim()).map((t, i) => (
                    <div key={t._key} className={styles.reviewTaskRow}>
                      <span className={styles.reviewSeq}>{i + 1}</span>
                      <span className={styles.reviewTaskName}>{t.NAME}</span>
                      <span className={styles.reviewDur}>{t.DURATION_VALUE} {t.DURATION_UNIT}</span>
                      {t.DEPARTMENT_ID && (
                        <span className={styles.reviewDept}>
                          {departments.find((d) => String(d.ID) === String(t.DEPARTMENT_ID))?.NAME}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.wizardFooter}>
              {step > 1 && (
                <PMButton variant="outline" onClick={() => setStep((s) => s - 1)}>← Back</PMButton>
              )}
              <div style={{ flex: 1 }} />
              <PMButton variant="outline" onClick={closeWizard}>Cancel</PMButton>
              {step < 3
                ? <PMButton variant="primary" onClick={step === 1 ? goStep2 : () => setStep(3)}>Next →</PMButton>
                : <PMButton variant="primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : wizard === "edit" ? "Save Changes" : "Create Project"}
                </PMButton>}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload Modal */}
      {bulkModal && (
        <PMModal
          open={bulkModal}
          onClose={() => setBulkModal(false)}
          title="Bulk Upload Projects"
          size="sm"
        >
          <p className={styles.bulkHint}>
            Upload an Excel file with sheet name <strong>"Projects"</strong> and columns:{" "}
            <strong>Category Name</strong>, <strong>Project Name</strong>, <strong>Description</strong>
            {cfFields.length > 0 && <>, plus any custom fields</>}.
            Existing records (matched by category + name) are updated; new ones are inserted.
          </p>
          <div className={styles.dropzone} onClick={() => bulkFileRef.current?.click()}>
            <span className={styles.dropIconWrap}><img src={UploadIcon} alt="Upload" /></span>
            <span>{bulkXlFile ? bulkXlFile.name : "Click to browse or drop Excel (.xlsx)"}</span>
            {bulkUploading && <span>Uploading…</span>}
          </div>
          <input
            ref={bulkFileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={handleBulkFileChange}
          />

          {bulkUploadResult && (
            <div className={styles.uploadResult}>
              <div className={styles.resultStats}>
                <div className={styles.resultStat}>
                  <span className={styles.statValue}>{bulkUploadResult.inserted ?? 0}</span>
                  <span className={styles.statLabel}>Inserted</span>
                </div>
                <div className={styles.resultStat}>
                  <span className={styles.statValue}>{bulkUploadResult.updated ?? 0}</span>
                  <span className={styles.statLabel}>Updated</span>
                </div>
                <div className={styles.resultStat}>
                  <span className={styles.statValue}>{bulkUploadResult.skipped ?? 0}</span>
                  <span className={styles.statLabel}>Skipped</span>
                </div>
              </div>
              {bulkUploadResult.errors?.length > 0 && (
                <div className={styles.errorSection}>
                  <p className={styles.errorSectionTitle}>Errors ({bulkUploadResult.errors.length})</p>
                  <ul className={styles.errorList}>
                    {bulkUploadResult.errors.map((e, i) => (
                      <li key={i} className={styles.errorItem}>
                        <span className={styles.errorRowNum}>Row {e.row}</span>
                        {e.field && <span className={styles.errorField}>{e.field}</span>}
                        <span className={styles.errorMsg}>{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </PMModal>
      )}

      {/* Custom Fields Modal */}
      <CustomFieldsModal
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        tableName="project"
      />

      {/* Delete Confirmation */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => { })}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
