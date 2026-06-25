import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMSelect, PMConfirmModal,
} from "../components/pm";
import { taskService } from "../services/taskService";
import { projectService } from "../services/projectService";
import { departmentService } from "../services/departmentService";
import { roleService } from "../services/roleService";
import { useToast } from "../hooks/useToast";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import TaskIcon from "../assets/Icons/taskIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./TaskTemplatePage.module.css";

const DURATION_UNITS = ["HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"];

const EMPTY_FORM = {
  NAME: "", DESCRIPTION: "", DURATION_VALUE: 1,
  DURATION_UNIT: "DAYS", DEPARTMENT_ID: "", ROLE_ID: "", SEQUENCE_NUMBER: 0,
};

export default function TaskTemplatePage() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project_id");

  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [selectedProject, setSelectedProject] = useState(projectId || "");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cfOpen, setCfOpen] = useState(false);

  // Bulk upload
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const bulkFileRef = useRef();

  const toast = useToast();
  const metaFetched = useRef(false);
  const { fields: cfFields, cfValues, handleCfChange, loadValues: loadCfValues, resetValues: resetCfValues, validateCf, saveCfValues, refreshFields } = useCustomFields("task_template");
  const cfValuesMap = useTableCfValues("task_template", tasks);

  useEffect(() => { if (!cfOpen) refreshFields(); }, [cfOpen, refreshFields]);

  const loadMeta = useCallback(async () => {
    try {
      const [projRes, deptRes, roleRes] = await Promise.all([
        projectService.getAll(),
        departmentService.getAll(),
        roleService.getAll(),
      ]);
      setProjects(projRes.data || []);
      setDepartments(deptRes.data || []);
      setAllRoles(roleRes.data || []);
    } catch { /* silent */ }
  }, []);

  const loadTasks = useCallback(async (projId, silent = false) => {
    if (!projId) { setTasks([]); return; }
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await taskService.getByProject(projId);
      setTasks(res.data || []);
    } catch {
      toast.showError("Failed to load tasks");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (metaFetched.current) return;
    metaFetched.current = true;
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadTasks(selectedProject);
    setPage(1);
  }, [selectedProject, loadTasks]);

  const handleRefresh = useCallback(() => loadTasks(selectedProject, true), [selectedProject, loadTasks]);

  const rolesForDept = useCallback(
    (deptId) => deptId ? allRoles.filter((r) => String(r.DEPARTMENT_ID) === String(deptId)) : allRoles,
    [allRoles]
  );

  const currentProject = useMemo(
    () => projects.find((p) => String(p.ID) === String(selectedProject)),
    [projects, selectedProject]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return tasks;
    const t = search.toLowerCase();
    return tasks.filter((task) => task.NAME?.toLowerCase().includes(t));
  }, [tasks, search]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const openAdd = useCallback(() => {
    setForm({ ...EMPTY_FORM, SEQUENCE_NUMBER: tasks.length });
    setEditId(null);
    setModal("task");
    resetCfValues();
  }, [tasks.length, resetCfValues]);

  const openEdit = useCallback((t) => {
    setForm({
      NAME: t.NAME,
      DESCRIPTION: t.DESCRIPTION || "",
      DURATION_VALUE: t.DURATION_VALUE,
      DURATION_UNIT: t.DURATION_UNIT,
      DEPARTMENT_ID: t.DEPARTMENT_ID ? String(t.DEPARTMENT_ID) : "",
      ROLE_ID: t.ROLE_ID ? String(t.ROLE_ID) : "",
      SEQUENCE_NUMBER: t.SEQUENCE_NUMBER,
    });
    setEditId(t.ID);
    setModal("task");
    loadCfValues(t.ID);
  }, [loadCfValues]);

  const closeModal = useCallback(() => { setModal(null); setEditId(null); }, []);

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.NAME.trim()) { toast.showWarning("Task name is required"); return; }
    if (!selectedProject) { toast.showWarning("Select a project first"); return; }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setSaving(true);
    try {
      const payload = {
        NAME: form.NAME,
        DESCRIPTION: form.DESCRIPTION || null,
        DURATION_VALUE: parseFloat(form.DURATION_VALUE) || 1,
        DURATION_UNIT: form.DURATION_UNIT,
        SEQUENCE_NUMBER: parseInt(form.SEQUENCE_NUMBER) || 0,
        DEPARTMENT_ID: form.DEPARTMENT_ID ? parseInt(form.DEPARTMENT_ID) : null,
        ROLE_ID: form.ROLE_ID ? parseInt(form.ROLE_ID) : null,
        PROJECT_ID: selectedProject,
      };
      if (editId) {
        await taskService.update(editId, payload);
        await saveCfValues(editId);
        toast.showSuccess("Task updated");
      } else {
        const res = await taskService.create(payload);
        const newId = res.data?.ID;
        if (newId) await saveCfValues(newId);
        toast.showSuccess("Task created");
      }
      closeModal();
      loadTasks(selectedProject);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, editId, selectedProject, closeModal, loadTasks, toast, validateCf, saveCfValues]);

  const handleDelete = useCallback((t) => {
    setConfirmModal({
      title: "Delete Task",
      description: `Delete task "${t.NAME}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await taskService.remove(t.ID);
          toast.showSuccess("Task deleted");
          loadTasks(selectedProject);
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [selectedProject, loadTasks, toast]);

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

  const onDragEnd = useCallback(async () => {
    setDragIdx(null);
    if (tasks.length === 0) return;
    setReordering(true);
    try {
      await taskService.reorder(
        tasks.map((t, i) => ({ id: t.ID, sequence_number: i }))
      );
    } catch {
      toast.showError("Reorder failed");
      loadTasks(selectedProject);
    } finally {
      setReordering(false);
    }
  }, [tasks, selectedProject, loadTasks, toast]);

  const deptMap = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.ID, d.NAME])),
    [departments]
  );

  const roleMap = useMemo(
    () => Object.fromEntries(allRoles.map((r) => [r.ID, r.NAME || r.ROLE_NAME])),
    [allRoles]
  );

  const gridCols = useMemo(
    () => `28px 40px minmax(0,1fr) 140px 150px 150px ${cfFields.map(() => "130px").join(" ")} 130px`.trim(),
    [cfFields]
  );

  const handleExport = useCallback(() => {
    const data = filtered.map((t, i) => {
      const row = {
        "S.No": i + 1,
        "Task Name": t.NAME,
        Duration: `${t.DURATION_VALUE} ${t.DURATION_UNIT}`,
        Department: t.DEPARTMENT_NAME || deptMap[t.DEPARTMENT_ID] || "",
        Role: t.ROLE_NAME || roleMap[t.ROLE_ID] || "",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(t.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, `tasks_${currentProject?.NAME || "export"}`);
  }, [filtered, currentProject, deptMap, roleMap, cfFields, cfValuesMap]);

  const handleDownloadTaskTemplate = useCallback(async () => {
    try {
      const headers = [
        "Project Name", "Task Name", "Description",
        "Duration Value", "Duration Unit", "Department", "Role", "Sequence",
        ...cfFields.map((f) => f.FIELD_NAME),
      ];
      await dlTemplate("Tasks", headers, "task_templates_template");
    } catch {
      toast.showError("Failed to download template");
    }
  }, [cfFields, toast]);

  const openBulk = useCallback(() => {
    setBulkFile(null);
    setUploadResult(null);
    setBulkModal(true);
  }, []);

  const handleBulkFileChange = useCallback(async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = "";
    setBulkFile(f);
    setUploadResult(null);
    const fd = new FormData();
    fd.append("file", f);
    setBulkUploading(true);
    try {
      const res = await taskService.bulkUpload(fd);
      setUploadResult(res.data);
      if (selectedProject) loadTasks(selectedProject, true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }, [selectedProject, loadTasks, toast]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={TaskIcon}
        iconAlt="Tasks"
        title="Task Templates"
        subtitle="Manage task sequences for project templates"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <>
            <PMButton variant="ghost" onClick={handleDownloadTaskTemplate}>Template</PMButton>
            <PMButton variant="outline" onClick={openBulk}>Bulk Upload</PMButton>
            <PMButton variant="ghost" onClick={() => setCfOpen(true)}>Custom Fields</PMButton>
            <ExportButton onClick={handleExport} disabled={filtered.length === 0} />
            {selectedProject && (
              <PMButton variant="primary" onClick={openAdd}>Add Task</PMButton>
            )}
          </>
        }
      />

      <div className={styles.body}>
        {/* Project Selector */}
        <div className={styles.selectorCard}>
          <label className={styles.selectorLabel}>Select Project Template</label>
          <PMSelect
            options={projects}
            value={selectedProject}
            onChange={setSelectedProject}
            valueKey="ID"
            labelKey="NAME"
            allowClear
            clearLabel="— Choose a project —"
            size="lg"
            style={{ maxWidth: 480 }}
          />
          {currentProject && (
            <div className={styles.projectMeta}>
              <span className={styles.projectName}>{currentProject.NAME}</span>
              <span className={styles.taskCount}>{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
              {reordering && <span className={styles.reorderHint}>Saving order…</span>}
            </div>
          )}
        </div>

        {/* Task List */}
        {selectedProject && (
          <div className={styles.taskSection}>
            <div className={styles.toolbar}>
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setPage(1); }}
                placeholder="Search tasks…"
              />
              <span className={styles.count}>{filtered.length} task{filtered.length !== 1 ? "s" : ""}</span>
            </div>

            {loading ? (
              <Loader />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={TaskIcon}
                iconAlt="Tasks"
                title={search ? "No tasks match your search" : "No tasks in this project"}
                description={!search ? "Click '+ Add Task' to start building the task list." : undefined}
                action={
                  !search && (
                    <PMButton variant="primary" onClick={openAdd}>+ Add Task</PMButton>
                  )
                }
              />
            ) : (
              <div className={styles.taskList}>
                <div className={styles.taskListHead} style={{ gridTemplateColumns: gridCols }}>
                  <span className={styles.thDrag} />
                  <span className={styles.thSeq}>#</span>
                  <span className={styles.thName}>Task Name</span>
                  <span className={styles.thDur}>Duration</span>
                  <span className={styles.thDept}>Department</span>
                  <span className={styles.thRole}>Role</span>
                  {cfFields.map((f) => <span key={f.ID}>{f.FIELD_NAME}</span>)}
                  <span className={styles.thAct}>Actions</span>
                </div>
                {paginated.map((t) => {
                  const taskIdx = tasks.findIndex((x) => (x._key || x.ID) === (t._key || t.ID));
                  return (
                  <div
                    key={t.ID || t._key}
                    className={`${styles.taskCard} ${dragIdx === taskIdx ? styles.dragging : ""}`}
                    style={{ gridTemplateColumns: gridCols }}
                    draggable
                    onDragStart={() => onDragStart(taskIdx)}
                    onDragOver={(e) => onDragOver(e, taskIdx)}
                    onDragEnd={onDragEnd}
                  >
                    <span className={styles.dragHandle}>⠿</span>
                    <span className={styles.seqNum}>{t.SEQUENCE_NUMBER + 1}</span>
                    <span className={styles.taskName}>{t.NAME}</span>
                    <span className={styles.durBadge}>
                      {t.DURATION_VALUE} {t.DURATION_UNIT}
                    </span>
                    <span className={styles.deptText}>
                      {t.DEPARTMENT_NAME || deptMap[t.DEPARTMENT_ID] || <span className={styles.muted}>—</span>}
                    </span>
                    <span className={styles.roleText}>
                      {t.ROLE_NAME || roleMap[t.ROLE_ID] || <span className={styles.muted}>—</span>}
                    </span>
                    {cfFields.map((f) => {
                      const val = cfValuesMap[String(t.ID)]?.[f.ID];
                      return (
                        <span key={f.ID} className={styles.cfText}>
                          {val == null || val === "" ? <span className={styles.muted}>—</span> : Array.isArray(val) ? val.join(", ") : String(val)}
                        </span>
                      );
                    })}
                    <div className={styles.taskActions}>
                      <button className={styles.iconBtn} onClick={() => openEdit(t)} title="Edit">
                        <img src={EditIcon} alt="Edit" />
                      </button>
                      <button className={styles.iconBtnDanger} onClick={() => handleDelete(t)} title="Delete">
                        <img src={DeleteIcon} alt="Delete" />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <TablePagination
                total={filtered.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              />
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <PMModal
        open={modal === "task"}
        onClose={closeModal}
        title={editId ? "Edit Task" : "Add Task"}
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={closeModal}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editId ? "Save Changes" : "Add Task"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGrid}>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Task Name <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              value={form.NAME}
              onChange={(e) => handleFormChange("NAME", e.target.value)}
              placeholder="e.g. Foundation Excavation"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Duration Value</label>
            <input
              className={styles.input}
              type="number"
              min={0.5}
              step={0.5}
              value={form.DURATION_VALUE}
              onChange={(e) => handleFormChange("DURATION_VALUE", e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Duration Unit</label>
            <PMSelect
              options={DURATION_UNITS}
              value={form.DURATION_UNIT}
              onChange={(val) => handleFormChange("DURATION_UNIT", val)}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Department</label>
            <PMSelect
              options={departments}
              value={form.DEPARTMENT_ID}
              onChange={(val) => handleFormChange("DEPARTMENT_ID", val)}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="— None —"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Role</label>
            <PMSelect
              options={rolesForDept(form.DEPARTMENT_ID)}
              value={form.ROLE_ID}
              onChange={(val) => handleFormChange("ROLE_ID", val)}
              valueKey="ID"
              labelKey="NAME"
              allowClear
              clearLabel="— None —"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Sequence #</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={form.SEQUENCE_NUMBER}
              onChange={(e) => handleFormChange("SEQUENCE_NUMBER", e.target.value)}
            />
          </div>
          <div className={`${styles.formGroup} ${styles.fullWidth}`}>
            <label>Description</label>
            <textarea
              className={styles.textarea}
              value={form.DESCRIPTION}
              onChange={(e) => handleFormChange("DESCRIPTION", e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>
        </div>
        <CustomFieldsSection
          fields={cfFields}
          values={cfValues}
          onChange={handleCfChange}
        />
      </PMModal>

      {/* Bulk Upload Modal */}
      <PMModal
        open={bulkModal}
        onClose={() => setBulkModal(false)}
        title="Bulk Upload Task Templates"
        size="sm"
      >
        <p className={styles.bulkHint}>
          Upload an Excel file with sheet name <strong>"Tasks"</strong> and columns:{" "}
          <strong>Project Name</strong>, <strong>Task Name</strong>,{" "}
          <strong>Description</strong>, <strong>Duration Value</strong>, <strong>Duration Unit</strong>,{" "}
          <strong>Department</strong>, <strong>Role</strong>, <strong>Sequence</strong>
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Existing tasks (matched by project + name) are updated; new ones are inserted.
        </p>
        <div className={styles.dropzone} onClick={() => bulkFileRef.current?.click()}>
          <span className={styles.dropIconWrap}><img src={UploadIcon} alt="Upload" /></span>
          <span>{bulkFile ? bulkFile.name : "Click to browse or drop Excel (.xlsx)"}</span>
          {bulkUploading && <span>Uploading…</span>}
        </div>
        <input
          ref={bulkFileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleBulkFileChange}
        />

        {uploadResult && (
          <div className={styles.uploadResult}>
            <div className={styles.resultStats}>
              <div className={styles.resultStat}>
                <span className={styles.statValue}>{uploadResult.inserted ?? 0}</span>
                <span className={styles.statLabel}>Inserted</span>
              </div>
              <div className={styles.resultStat}>
                <span className={styles.statValue}>{uploadResult.updated ?? 0}</span>
                <span className={styles.statLabel}>Updated</span>
              </div>
              <div className={styles.resultStat}>
                <span className={styles.statValue}>{uploadResult.skipped ?? 0}</span>
                <span className={styles.statLabel}>Skipped</span>
              </div>
            </div>
            {uploadResult.errors?.length > 0 && (
              <div className={styles.errorSection}>
                <p className={styles.errorSectionTitle}>Errors ({uploadResult.errors.length})</p>
                <ul className={styles.errorList}>
                  {uploadResult.errors.map((e, i) => (
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

      {/* Custom Fields Modal */}
      <CustomFieldsModal
        open={cfOpen}
        onClose={() => setCfOpen(false)}
        tableName="task_template"
      />

      {/* Delete Confirmation */}
      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => {})}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
