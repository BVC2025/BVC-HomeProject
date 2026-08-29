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
import { formatDateTime } from "../utils/formatDateTime";
import TaskIcon from "../assets/Icons/taskIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import UploadIcon from "../assets/Icons/uploadIcon.webp";
import styles from "./TaskTemplatePage.module.css";

const DURATION_UNITS = ["HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"];
const EXPERIENCE_LEVELS = ["FRESHER", "INTERMEDIATE", "EXPERIENCED"];
const TASK_SCOPES = ["PROJECT", "UNIT"];
const TASK_SCOPE_HELP = {
  PROJECT: "Task is created once for the complete project.",
  UNIT: "Task is created separately for each project unit/quantity.",
};

const DEPENDENCY_RULES = ["ALL", "ANY"];
const DEPENDENCY_RULE_HELP = {
  ALL: "Every dependency must be completed before this task can start.",
  ANY: "At least one dependency must be completed before this task can start.",
};

const EMPTY_FORM = {
  NAME: "", DESCRIPTION: "", DURATION_VALUE: 1,
  DURATION_UNIT: "DAYS", TASK_SCOPE: "UNIT", SEQUENCE_NUMBER: 0,
  EXECUTION_GROUP_ID: "", DEPENDENCY_RULE: "ALL",
};

const EMPTY_REQUIREMENT = () => ({
  _key: Math.random().toString(36).slice(2),
  DEPARTMENT_ID: "", ROLE_ID: "", EXPERIENCE_LEVEL: "", REQUIRED_COUNT: 1,
});

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
  const [requirements, setRequirements] = useState([]);
  const [requirementErrors, setRequirementErrors] = useState({}); // { [_key]: { DEPARTMENT_ID?, ROLE_ID?, EXPERIENCE_LEVEL?, REQUIRED_COUNT?, DUPLICATE? } }
  const [dependencies, setDependencies] = useState([]); // [DEPENDS_ON_TASK_TEMPLATE_ID, ...]
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
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

  const handleFormChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  // Execution Group options — built from the OTHER tasks already in this
  // project (excluding the one being edited), grouped by EXECUTION_GROUP_ID.
  // "+ Create New Group" generates a fresh UUID client-side — the user
  // never sees or types a raw group ID.
  const groupOptions = useMemo(() => {
    const groups = new Map(); // groupId -> [taskNames]
    for (const t of tasks) {
      if (t.ID === editId || !t.EXECUTION_GROUP_ID) continue;
      if (!groups.has(t.EXECUTION_GROUP_ID)) groups.set(t.EXECUTION_GROUP_ID, []);
      groups.get(t.EXECUTION_GROUP_ID).push(t.NAME);
    }
    const opts = [{ value: "", label: "— None (runs independently) —" }];
    let i = 1;
    for (const [groupId, names] of groups) {
      opts.push({ value: groupId, label: `Group ${i++} (${names.join(", ")})` });
    }
    opts.push({ value: "__NEW__", label: "+ Create New Group" });
    return opts;
  }, [tasks, editId]);

  const handleGroupChange = useCallback((val) => {
    if (val === "__NEW__") {
      handleFormChange("EXECUTION_GROUP_ID", crypto.randomUUID());
    } else {
      handleFormChange("EXECUTION_GROUP_ID", val);
    }
  }, [handleFormChange]);

  // Other named tasks in this project this task could depend on — self
  // excluded so a circular/self dependency can never even be selected.
  const dependencyCandidates = useMemo(
    () => tasks.filter((t) => t.ID !== editId),
    [tasks, editId]
  );

  const toggleDependency = useCallback((taskId) => {
    setDependencies((prev) => (
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    ));
  }, []);

  const currentProject = useMemo(
    () => projects.find((p) => String(p.ID) === String(selectedProject)),
    [projects, selectedProject]
  );

  const filtered = useMemo(() => {
    let data = tasks;
    if (search.trim()) {
      const t = search.toLowerCase();
      data = data.filter((task) => task.NAME?.toLowerCase().includes(t));
    }
    if (filterFrom || filterTo) {
      const from = filterFrom ? new Date(filterFrom) : null;
      const to = filterTo ? new Date(filterTo) : null;
      data = data.filter((task) => {
        if (!task.CREATED_AT) return false;
        const d = new Date(task.CREATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return data;
  }, [tasks, search, filterFrom, filterTo]);

  const paginated = useMemo(
    () => pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const openAdd = useCallback(() => {
    setForm({ ...EMPTY_FORM, SEQUENCE_NUMBER: tasks.length });
    setRequirements([]);
    setRequirementErrors({});
    setDependencies([]);
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
      TASK_SCOPE: t.TASK_SCOPE || "PROJECT",
      SEQUENCE_NUMBER: t.SEQUENCE_NUMBER,
      EXECUTION_GROUP_ID: t.EXECUTION_GROUP_ID || "",
      DEPENDENCY_RULE: t.DEPENDENCY_RULE || "ALL",
    });
    setRequirements(
      (t.requirements || []).map((r) => ({
        _key: r.ID,
        DEPARTMENT_ID: r.DEPARTMENT_ID ? String(r.DEPARTMENT_ID) : "",
        ROLE_ID: r.ROLE_ID ? String(r.ROLE_ID) : "",
        EXPERIENCE_LEVEL: r.EXPERIENCE_LEVEL || "",
        REQUIRED_COUNT: r.REQUIRED_COUNT || 1,
      }))
    );
    setRequirementErrors({});
    setDependencies((t.dependencies || []).map((d) => d.DEPENDS_ON_TASK_TEMPLATE_ID));
    setEditId(t.ID);
    setModal("task");
    loadCfValues(t.ID);
  }, [loadCfValues]);

  const closeModal = useCallback(() => { setModal(null); setEditId(null); }, []);

  const addRequirement = useCallback(() => {
    setRequirements((prev) => [...prev, EMPTY_REQUIREMENT()]);
  }, []);

  const removeRequirement = useCallback((idx) => {
    setRequirements((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateRequirement = useCallback((idx, field, value) => {
    setRequirements((prev) => {
      const next = prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
      const key = next[idx]._key;
      setRequirementErrors((prevErrors) => {
        if (!prevErrors[key]) return prevErrors;
        const rowErrors = { ...prevErrors[key] };
        delete rowErrors[field];
        delete rowErrors.DUPLICATE; // any edit can resolve a stale duplicate flag too
        const updated = { ...prevErrors };
        if (Object.keys(rowErrors).length > 0) updated[key] = rowErrors;
        else delete updated[key];
        return updated;
      });
      return next;
    });
  }, []);

  // Mirrors ProjectPage.jsx's validateTasks() shape: per-row error map keyed
  // by _key, surfaced under each field via requirementErrors[_key][FIELD].
  const validateRequirements = useCallback(() => {
    const errors = {};
    const seen = new Set();
    for (const r of requirements) {
      const rowErrors = {};
      if (!r.DEPARTMENT_ID) rowErrors.DEPARTMENT_ID = "Department is required";
      if (!r.ROLE_ID) rowErrors.ROLE_ID = "Role is required";
      if (!r.EXPERIENCE_LEVEL) rowErrors.EXPERIENCE_LEVEL = "Experience level is required";
      const count = parseInt(r.REQUIRED_COUNT, 10);
      if (r.REQUIRED_COUNT === "" || Number.isNaN(count) || count < 1) {
        rowErrors.REQUIRED_COUNT = "Enter a whole number of 1 or more";
      }
      const dupKey = `${r.DEPARTMENT_ID || ""}|${r.ROLE_ID || ""}|${r.EXPERIENCE_LEVEL || ""}`;
      if (seen.has(dupKey)) {
        rowErrors.DUPLICATE = "This Department + Role + Experience Level combination is already added — increase its Required Count instead.";
      }
      seen.add(dupKey);
      if (Object.keys(rowErrors).length > 0) errors[r._key] = rowErrors;
    }
    return errors;
  }, [requirements]);

  const handleSave = useCallback(async () => {
    if (!form.NAME.trim()) { toast.showWarning("Task name is required"); return; }
    if (!selectedProject) { toast.showWarning("Select a project first"); return; }
    const seq = parseInt(form.SEQUENCE_NUMBER) || 0;
    const seqClash = tasks.find((t) => t.ID !== editId && t.SEQUENCE_NUMBER === seq);
    if (seqClash) {
      toast.showWarning(`Sequence Number ${seq} is already used by task "${seqClash.NAME}". Choose a different number.`);
      return;
    }
    const reqErrors = validateRequirements();
    if (Object.keys(reqErrors).length > 0) {
      setRequirementErrors(reqErrors);
      toast.showWarning("Please fix the manpower requirement fields highlighted below.");
      return;
    }
    const cfError = validateCf();
    if (cfError) { toast.showWarning(cfError); return; }
    setSaving(true);
    try {
      const payload = {
        NAME: form.NAME,
        DESCRIPTION: form.DESCRIPTION || null,
        DURATION_VALUE: parseFloat(form.DURATION_VALUE) || 1,
        DURATION_UNIT: form.DURATION_UNIT,
        SEQUENCE_NUMBER: seq,
        TASK_SCOPE: form.TASK_SCOPE || "PROJECT",
        EXECUTION_GROUP_ID: form.EXECUTION_GROUP_ID || "",
        DEPENDENCY_RULE: form.DEPENDENCY_RULE || "ALL",
        requirements: requirements.map((r) => ({
          DEPARTMENT_ID: r.DEPARTMENT_ID ? parseInt(r.DEPARTMENT_ID) : null,
          ROLE_ID: r.ROLE_ID ? parseInt(r.ROLE_ID) : null,
          EXPERIENCE_LEVEL: r.EXPERIENCE_LEVEL,
          REQUIRED_COUNT: parseInt(r.REQUIRED_COUNT) || 1,
        })),
        dependencies: dependencies.map((id) => ({ DEPENDS_ON_TASK_TEMPLATE_ID: id })),
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
  }, [form, requirements, dependencies, tasks, validateRequirements, editId, selectedProject, closeModal, loadTasks, toast, validateCf, saveCfValues]);

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

  const manpowerParts = useCallback((t) => {
    return (t.requirements || []).map((r) => {
      const dept = r.DEPARTMENT_NAME || deptMap[r.DEPARTMENT_ID] || "—";
      const role = r.ROLE_NAME || roleMap[r.ROLE_ID] || "—";
      return `${dept} / ${role} / ${r.EXPERIENCE_LEVEL} × ${r.REQUIRED_COUNT}`;
    });
  }, [deptMap, roleMap]);

  const manpowerSummary = useCallback((t) => {
    const count = (t.requirements || []).length;
    if (count === 0) return null;
    const total = t.TOTAL_REQUIRED_COUNT ?? (t.requirements || []).reduce((s, r) => s + (r.REQUIRED_COUNT || 0), 0);
    return `${count} requirement${count !== 1 ? "s" : ""} · ${total} total`;
  }, []);

  const gridCols = useMemo(
    () => `28px 40px minmax(0,1fr) 140px 100px 190px 150px 120px 130px 150px ${cfFields.map(() => "130px").join(" ")} 130px`.trim(),
    [cfFields]
  );

  // Friendly "Group N" label for a task's EXECUTION_GROUP_ID, consistent
  // across rows within the currently-loaded task list (Map preserves
  // first-seen insertion order, so the same group always gets the same
  // number for as long as this page stays open).
  const groupLabelMap = useMemo(() => {
    const map = new Map();
    let i = 1;
    for (const t of tasks) {
      if (t.EXECUTION_GROUP_ID && !map.has(t.EXECUTION_GROUP_ID)) map.set(t.EXECUTION_GROUP_ID, `Group ${i++}`);
    }
    return map;
  }, [tasks]);

  const handleExport = useCallback(() => {
    const data = filtered.map((t, i) => {
      const row = {
        "S.No": i + 1,
        "Task Name": t.NAME,
        Duration: `${t.DURATION_VALUE} ${t.DURATION_UNIT}`,
        "Task Scope": t.TASK_SCOPE || "PROJECT",
        "Manpower Requirements": manpowerParts(t).join("; ") || "—",
      };
      cfFields.forEach((f) => {
        const val = cfValuesMap[String(t.ID)]?.[f.ID];
        row[f.FIELD_NAME] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      });
      return row;
    });
    exportToExcel(data, `tasks_${currentProject?.NAME || "export"}`);
  }, [filtered, currentProject, manpowerParts, cfFields, cfValuesMap]);

  const handleDownloadTaskTemplate = useCallback(async () => {
    try {
      const headers = [
        "Project Name", "Task Name", "Description",
        "Duration Value", "Duration Unit", "Department", "Role",
        "Experience Level", "Required Count", "Sequence",
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
              <div className={styles.dateFilters}>
                <label className={styles.dateLabel}>From</label>
                <input type="datetime-local" className={styles.dateInput} value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }} />
                <label className={styles.dateLabel}>To</label>
                <input type="datetime-local" className={styles.dateInput} value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }} />
                {(filterFrom || filterTo) && <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>}
              </div>
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
                  <span className={styles.thDept}>Task Scope</span>
                  <span className={styles.thRole}>Manpower</span>
                  <span>Execution Group</span>
                  <span>Dependencies</span>
                  <span>Created Date</span>
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
                      <span className={styles.deptText}>{t.TASK_SCOPE || "PROJECT"}</span>
                      <span
                        className={styles.roleText}
                        title={manpowerParts(t).join("\n") || undefined}
                      >
                        {manpowerSummary(t) || <span className={styles.muted}>—</span>}
                      </span>
                      <span>
                        {t.EXECUTION_GROUP_ID
                          ? <span className={styles.groupChip}>{groupLabelMap.get(t.EXECUTION_GROUP_ID)}</span>
                          : <span className={styles.muted}>—</span>}
                      </span>
                      <span
                        title={(t.dependencies || []).map((d) => d.DEPENDS_ON_TASK_NAME).join("\n") || undefined}
                      >
                        {t.dependencies?.length > 0
                          ? <span className={styles.groupChip}>{t.dependencies.length} ({t.DEPENDENCY_RULE})</span>
                          : <span className={styles.muted}>—</span>}
                      </span>
                      <span className={styles.cfText}>{formatDateTime(t.CREATED_AT)}</span>
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
            <label>Sequence #</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={form.SEQUENCE_NUMBER}
              onChange={(e) => handleFormChange("SEQUENCE_NUMBER", e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Task Scope</label>
            <PMSelect
              options={TASK_SCOPES}
              value={form.TASK_SCOPE}
              onChange={(val) => handleFormChange("TASK_SCOPE", val)}
            />
            <span className={styles.hint}>{TASK_SCOPE_HELP[form.TASK_SCOPE]}</span>
          </div>
          <div className={styles.formGroup}>
            <label>Execution Group</label>
            <PMSelect
              options={groupOptions}
              value={form.EXECUTION_GROUP_ID}
              onChange={handleGroupChange}
            />
            <span className={styles.hint}>Tasks in the same group are eligible to run in parallel.</span>
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

        <div className={styles.requirementsSection}>
          <div className={styles.requirementsHeader}>
            <span className={styles.requirementsTitle}>
              Manpower Requirements {requirements.length > 0 && `(${requirements.length})`}
            </span>
          </div>
          {requirements.length === 0 && (
            <p className={styles.hint}>No manpower requirements added yet — this task has no specific staffing need, or add one below.</p>
          )}
          {requirements.map((r, idx) => (
            <div key={r._key} className={styles.requirementRow}>
              <div className={styles.requirementRowHead}>
                <span className={styles.requirementRowTitle}>Requirement {idx + 1}</span>
                <button
                  type="button"
                  className={styles.removeRowBtn}
                  onClick={() => removeRequirement(idx)}
                >
                  Remove
                </button>
              </div>
              <div className={styles.requirementGrid}>
                <div className={styles.requirementFieldCell}>
                  <label>Department <span className={styles.req}>*</span></label>
                  <PMSelect
                    options={departments}
                    value={r.DEPARTMENT_ID}
                    onChange={(val) => updateRequirement(idx, "DEPARTMENT_ID", val)}
                    valueKey="ID"
                    labelKey="NAME"
                    placeholder="Select Department"
                    size="sm"
                    className={requirementErrors[r._key]?.DEPARTMENT_ID ? styles.taskSelectError : ""}
                  />
                  {requirementErrors[r._key]?.DEPARTMENT_ID && (
                    <span className={styles.taskFieldError}>{requirementErrors[r._key].DEPARTMENT_ID}</span>
                  )}
                </div>
                <div className={styles.requirementFieldCell}>
                  <label>Role <span className={styles.req}>*</span></label>
                  <PMSelect
                    options={rolesForDept(r.DEPARTMENT_ID)}
                    value={r.ROLE_ID}
                    onChange={(val) => updateRequirement(idx, "ROLE_ID", val)}
                    valueKey="ID"
                    labelKey="NAME"
                    placeholder="Select Role"
                    size="sm"
                    className={requirementErrors[r._key]?.ROLE_ID ? styles.taskSelectError : ""}
                  />
                  {requirementErrors[r._key]?.ROLE_ID && (
                    <span className={styles.taskFieldError}>{requirementErrors[r._key].ROLE_ID}</span>
                  )}
                </div>
                <div className={styles.requirementFieldCell}>
                  <label>Experience <span className={styles.req}>*</span></label>
                  <PMSelect
                    options={EXPERIENCE_LEVELS}
                    value={r.EXPERIENCE_LEVEL}
                    onChange={(val) => updateRequirement(idx, "EXPERIENCE_LEVEL", val)}
                    placeholder="Select Experience Level"
                    size="sm"
                    className={requirementErrors[r._key]?.EXPERIENCE_LEVEL ? styles.taskSelectError : ""}
                  />
                  {requirementErrors[r._key]?.EXPERIENCE_LEVEL && (
                    <span className={styles.taskFieldError}>{requirementErrors[r._key].EXPERIENCE_LEVEL}</span>
                  )}
                </div>
                <div className={styles.requirementFieldCell}>
                  <label>Required Count <span className={styles.req}>*</span></label>
                  <input
                    className={`${styles.input}${requirementErrors[r._key]?.REQUIRED_COUNT ? " " + styles.inputError : ""}`}
                    type="number"
                    min={1}
                    step={1}
                    value={r.REQUIRED_COUNT}
                    onChange={(e) => updateRequirement(idx, "REQUIRED_COUNT", e.target.value)}
                  />
                  {requirementErrors[r._key]?.REQUIRED_COUNT && (
                    <span className={styles.taskFieldError}>{requirementErrors[r._key].REQUIRED_COUNT}</span>
                  )}
                </div>
              </div>
              {requirementErrors[r._key]?.DUPLICATE && (
                <span className={styles.taskFieldError}>{requirementErrors[r._key].DUPLICATE}</span>
              )}
            </div>
          ))}
          <button type="button" className={styles.addRowBtn} onClick={addRequirement}>
            + Add Requirement
          </button>
        </div>

        <div className={styles.requirementsSection}>
          <div className={styles.requirementsHeader}>
            <span className={styles.requirementsTitle}>
              Dependencies {dependencies.length > 0 && `(${dependencies.length})`}
            </span>
          </div>
          {dependencyCandidates.length === 0 ? (
            <p className={styles.hint}>No other tasks in this project yet to depend on.</p>
          ) : (
            <div className={styles.dependencyList}>
              {dependencyCandidates.map((t) => (
                <label key={t.ID} className={styles.dependencyItem}>
                  <input
                    type="checkbox"
                    checked={dependencies.includes(t.ID)}
                    onChange={() => toggleDependency(t.ID)}
                  />
                  <span>{t.NAME}</span>
                </label>
              ))}
            </div>
          )}
          {dependencies.length > 1 && (
            <div className={`${styles.formGroup} ${styles.dependencyRuleField}`}>
              <label>Dependency Rule</label>
              <PMSelect
                options={DEPENDENCY_RULES}
                value={form.DEPENDENCY_RULE}
                onChange={(val) => handleFormChange("DEPENDENCY_RULE", val)}
                size="sm"
              />
              <span className={styles.hint}>{DEPENDENCY_RULE_HELP[form.DEPENDENCY_RULE]}</span>
            </div>
          )}
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
          <strong>Department</strong>, <strong>Role</strong>, <strong>Experience Level</strong>,{" "}
          <strong>Required Count</strong>, <strong>Sequence</strong>
          {cfFields.length > 0 && <>, plus any custom fields</>}.
          Department/Role/Experience Level/Required Count together define one manpower requirement per
          task (optional — leave all four blank for a task with no specific staffing need). Existing
          tasks (matched by project + name) are updated; new ones are inserted.
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
        onConfirm={confirmModal?.onConfirm ?? (() => { })}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
