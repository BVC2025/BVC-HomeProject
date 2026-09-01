import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, CustomFieldsModal, CustomFieldsSection,
  SearchBar, EmptyState, ExportButton, Loader,
  PMButton, PMSelect, PMConfirmModal,
} from "../components/pm";
import TaskGroupModal from "../components/projectTaskGroups/TaskGroupModal";
import ProjectGroupsModal from "../components/projectTaskGroups/ProjectGroupsModal";
import ProjectInventoryRequirementsModal from "../components/projectInventory/ProjectInventoryRequirementsModal";
import { projectService } from "../services/projectService";
import { taskService } from "../services/taskService";
import { taskGroupService } from "../services/taskGroupService";
import { projectProductRequirementService } from "../services/projectProductRequirementService";
import { categoryService } from "../services/categoryService";
import { departmentService } from "../services/departmentService";
import { roleService } from "../services/roleService";
import { inventoryCategoryService } from "../services/inventoryCategoryService";
import { productMasterService } from "../services/productMasterService";
import API from "../services/api";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../context/AuthContext";
import { useCustomFields, useTableCfValues } from "../hooks/useCustomFields";
import { exportToExcel, downloadTemplate as dlTemplate } from "../utils/exportExcel";
import { formatDateTime } from "../utils/formatDateTime";
import ProjectIcon from "../assets/Icons/projectIcon.webp";
import EditIcon from "../assets/Icons/editIcon.webp";
import DeleteIcon from "../assets/Icons/deleteIcon.webp";
import BomIcon from "../assets/Icons/bomIcon.webp"
import ManualIcon from "../assets/Icons/editIcon.webp"
import UploadIcon from "../assets/Icons/uploadIcon.webp"
import styles from "./ProjectPage.module.css";

const DURATION_UNITS = ["HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"];
const EXPERIENCE_LEVELS = ["FRESHER", "INTERMEDIATE", "EXPERIENCED"];
const TASK_SCOPES = ["PROJECT", "UNIT"];
const TASK_SCOPE_HELP = {
  PROJECT: "Task is created once for the complete project.",
  UNIT: "Task is created separately for each project unit/quantity.",
};
const ASSIGNMENT_MODE_OPTIONS = [
  { value: "PARALLEL", label: "Parallel" },
  { value: "SEQUENTIAL", label: "Sequential" },
];

// Full parity with /task-templates' own requirements editor — each task
// carries its own requirements array, so multiple manpower requirements
// (e.g. Supervisor + Technician + Helper) can be configured directly here
// without needing to visit /task-templates afterward.
const EMPTY_REQUIREMENT = () => ({
  _key: Math.random().toString(36).slice(2),
  DEPARTMENT_ID: "", ROLE_ID: "", EXPERIENCE_LEVEL: "", REQUIRED_COUNT: 1,
});

// Group/dependency configuration now lives at the project level (Task
// Group step below), not per-task — a task carries no group/dependency
// fields of its own any more.
const EMPTY_TASK = () => ({
  _key: Math.random().toString(36).slice(2),
  NAME: "", DESCRIPTION: "", DURATION_VALUE: 1, DURATION_UNIT: "DAYS",
  TASK_SCOPE: "UNIT", requirements: [],
});

// One row per product a project requires from inventory — added via the
// Inventory Requirement wizard step (after Task Group, before Review).
// A product can only appear once per project (enforced both client-side,
// by excluding already-added PRODUCT_IDs from the picker, and server-side
// via a unique constraint) — mirrors TaskGroupModal's own "exclude
// already-selected" inversion pattern from the Task Group work.
const EMPTY_PRODUCT_REQ = (product) => ({
  _key: Math.random().toString(36).slice(2),
  PRODUCT_ID: product.ID,
  PRODUCT_CODE: product.PRODUCT_CODE,
  PRODUCT_NAME: product.PRODUCT_NAME,
  UNIT: product.UNIT,
  CATEGORY_ID: product.CATEGORY_ID,
  REQUIRED_QTY: 1,
});

// ---------------------------------------------------------------------
// Duration calculation — a client-side PREVIEW only, mirroring the
// backend's authoritative calculate_project_estimated_duration() exactly
// (project_template.py) so the Review step can show a live estimate
// before saving. The backend always recalculates and stores the real
// value on save; this preview is never sent to the server.
// ---------------------------------------------------------------------
const UNIT_TO_DAYS = { DAYS: 1, WEEKS: 5, MONTHS: 22, YEARS: 260 };

function taskDurationHours(t, workHours) {
  const val = parseFloat(t.DURATION_VALUE) || 0;
  const unit = (t.DURATION_UNIT || "DAYS").toUpperCase();
  if (unit === "HOURS") return val;
  return val * (UNIT_TO_DAYS[unit] || 1) * workHours;
}

function computeDurationBreakdown(tasks, taskGroups, assignmentMode, workHours) {
  const named = tasks.filter((t) => t.NAME.trim());
  const groupedKeys = new Set();
  const groups = [];
  taskGroups.forEach((g, i) => {
    const members = named.filter((t) => g.taskKeys.includes(t._key));
    if (members.length === 0) return;
    members.forEach((t) => groupedKeys.add(t._key));
    const hoursList = members.map((t) => taskDurationHours(t, workHours));
    const maxHours = Math.max(...hoursList);
    groups.push({
      key: g._key,
      name: g.NAME || `Group ${i + 1}`,
      members,
      durationHours: maxHours,
      durationDays: workHours > 0 ? maxHours / workHours : 0,
    });
  });
  const standalone = named.filter((t) => !groupedKeys.has(t._key)).map((t) => ({
    key: t._key,
    name: t.NAME,
    durationHours: taskDurationHours(t, workHours),
    durationDays: workHours > 0 ? taskDurationHours(t, workHours) / workHours : 0,
  }));
  const topLevelHours = [...groups.map((g) => g.durationHours), ...standalone.map((s) => s.durationHours)];
  let totalHours = 0;
  if (topLevelHours.length > 0) {
    totalHours = assignmentMode === "PARALLEL"
      ? Math.max(...topLevelHours)
      : topLevelHours.reduce((a, b) => a + b, 0);
  }
  return {
    totalHours,
    totalDays: workHours > 0 ? totalHours / workHours : 0,
    groups,
    standalone,
  };
}


export default function ProjectPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canViewGroups = hasPermission("project.task_groups.view");
  // Read-only surface — reuses the existing project.view permission rather
  // than adding a new permission-catalogue row for a view-only modal.
  const canViewInventory = hasPermission("project.view");
  const canCreateGroups = hasPermission("project.task_groups.create");
  const canUpdateGroups = hasPermission("project.task_groups.update");
  const canDeleteGroups = hasPermission("project.task_groups.delete");

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
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [groupsRowProject, setGroupsRowProject] = useState(null);
  const [inventoryRowProject, setInventoryRowProject] = useState(null);
  const [companyWorkHours, setCompanyWorkHours] = useState(8);

  // Wizard
  const [wizard, setWizard] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [step, setStep] = useState("Basic Info");
  const [form, setForm] = useState({ CATEGORY_ID: "", NAME: "", DESCRIPTION: "", BOM_MODE: "MANUAL", ASSIGNMENT_MODE: "PARALLEL" });
  const [tasks, setTasks] = useState([EMPTY_TASK()]);
  const [taskErrors, setTaskErrors] = useState({}); // { [task._key]: { [requirement._key]: { EXPERIENCE_LEVEL?, REQUIRED_COUNT?, DUPLICATE? } } }
  const [taskGroups, setTaskGroups] = useState([]);
  const [groupModalState, setGroupModalState] = useState(null); // { editing: group|null } | null
  const [productRequirements, setProductRequirements] = useState([]);
  const [invCategories, setInvCategories] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [reqCategoryFilter, setReqCategoryFilter] = useState("");
  const [reqSelectedProductId, setReqSelectedProductId] = useState("");
  const [reqQty, setReqQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

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
      const [projRes, catRes, deptRes, roleRes, invCatRes, productRes] = await Promise.all([
        projectService.getAll(),
        categoryService.getAll(),
        departmentService.getAll(),
        roleService.getAll(),
        inventoryCategoryService.getAll(),
        productMasterService.getAll({ page_size: 5000 }),
      ]);
      setRows(projRes.data || []);
      setCategories(catRes.data || []);
      setDepartments(deptRes.data || []);
      setAllRoles(roleRes.data || []);
      setInvCategories(invCatRes.data || []);
      setAllProducts(productRes.data?.items || []);
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
    // Used only for the wizard's client-side duration PREVIEW (Review
    // step) — the backend independently resolves and stores the
    // authoritative WORK_HOURS itself on every save.
    API.get("/settings/company")
      .then((res) => {
        const wh = parseFloat(res.data?.WORK_HOURS);
        if (wh && wh > 0) setCompanyWorkHours(wh);
      })
      .catch(() => {});
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
    if (filterFrom || filterTo) {
      const from = filterFrom ? new Date(filterFrom) : null;
      const to = filterTo ? new Date(filterTo) : null;
      r = r.filter((x) => {
        if (!x.CREATED_AT) return false;
        const d = new Date(x.CREATED_AT);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return r;
  }, [rows, search, filterCat, filterFrom, filterTo]);

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
    setForm({ CATEGORY_ID: "", NAME: "", DESCRIPTION: "", BOM_MODE: "MANUAL", ASSIGNMENT_MODE: "PARALLEL" });
    setTasks([EMPTY_TASK()]);
    setTaskGroups([]);
    setProductRequirements([]);
    setReqCategoryFilter(""); setReqSelectedProductId(""); setReqQty(1);
    setTaskErrors({});
    setBomFile(null); setBomSheets([]); setBomSheet(""); setBomParsed(false);
    setStep("Basic Info"); setEditRow(null); setWizard("create");
    resetCfValues();
  }, [resetCfValues]);

  const openEdit = useCallback(async (row) => {
    setForm({
      CATEGORY_ID: row.CATEGORY_ID, NAME: row.NAME, DESCRIPTION: row.DESCRIPTION || "",
      BOM_MODE: row.BOM_MODE || "MANUAL", ASSIGNMENT_MODE: row.ASSIGNMENT_MODE || "PARALLEL",
    });
    setEditRow(row);
    try {
      const [taskRes, groupRes, reqRes] = await Promise.all([
        taskService.getByProject(row.ID),
        taskGroupService.getByProject(row.ID),
        projectProductRequirementService.getByProject(row.ID),
      ]);
      setTasks(
        taskRes.data.length > 0
          ? taskRes.data.map((t) => ({
            _key: t.ID,
            ID: t.ID,
            NAME: t.NAME,
            DESCRIPTION: t.DESCRIPTION || "",
            DURATION_VALUE: t.DURATION_VALUE,
            DURATION_UNIT: t.DURATION_UNIT,
            TASK_SCOPE: t.TASK_SCOPE || "PROJECT",
            requirements: (t.requirements || []).map((r) => ({
              _key: r.ID,
              DEPARTMENT_ID: r.DEPARTMENT_ID ? String(r.DEPARTMENT_ID) : "",
              ROLE_ID: r.ROLE_ID ? String(r.ROLE_ID) : "",
              EXPERIENCE_LEVEL: r.EXPERIENCE_LEVEL || "",
              REQUIRED_COUNT: r.REQUIRED_COUNT || 1,
            })),
          }))
          : [EMPTY_TASK()]
      );
      // Each task's own _key equals its real ID here (see _key: t.ID
      // above), so referencing group membership/dependencies by real
      // TaskTemplate ID directly works as _key lookups too.
      setTaskGroups(
        (groupRes.data || []).map((g) => ({
          _key: g.ID,
          NAME: g.NAME || "",
          taskKeys: g.task_templates.map((t) => t.ID),
          DEPENDENCY_RULE: g.DEPENDENCY_RULE,
          dependencyKey: g.DEPENDS_ON_TASK_TEMPLATE_ID || null,
        }))
      );
      setProductRequirements(
        (reqRes.data || []).map((r) => ({
          _key: r.ID,
          PRODUCT_ID: r.PRODUCT_ID,
          PRODUCT_CODE: r.PRODUCT_CODE,
          PRODUCT_NAME: r.PRODUCT_NAME,
          UNIT: r.UNIT,
          CATEGORY_ID: r.CATEGORY_ID,
          REQUIRED_QTY: r.REQUIRED_QTY || 1,
        }))
      );
    } catch {
      setTasks([EMPTY_TASK()]);
      setTaskGroups([]);
      setProductRequirements([]);
    }
    setReqCategoryFilter(""); setReqSelectedProductId(""); setReqQty(1);
    setTaskErrors({});
    setBomFile(null); setBomSheets([]); setBomSheet(""); setBomParsed(false);
    setStep("Basic Info"); setWizard("edit");
    loadCfValues(row.ID);
  }, [loadCfValues]);

  const closeWizard = useCallback(() => { setWizard(null); setStep("Basic Info"); setEditRow(null); setTaskErrors({}); }, []);

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

  // Dynamic wizard steps: the Task Group step only appears for SEQUENTIAL
  // projects (and only if the user can view groups at all). Leaving Basic
  // Info always advances to "Tasks" in both cases, so `step` (a step NAME,
  // not a raw index) never becomes invalid for the current `steps` array —
  // ASSIGNMENT_MODE can only be edited while on "Basic Info" itself.
  const steps = useMemo(() => {
    const s = ["Basic Info", "Tasks"];
    if (form.ASSIGNMENT_MODE === "SEQUENTIAL" && canViewGroups) s.push("Task Group");
    s.push("Inventory Requirement");
    s.push("Review");
    return s;
  }, [form.ASSIGNMENT_MODE, canViewGroups]);
  const stepIndex = Math.max(0, steps.indexOf(step));

  // Every named task's manpower requirements must be complete before the
  // wizard can move on — blank placeholder task rows (no name typed yet)
  // are excluded, matching the existing "only named rows are real tasks"
  // convention used everywhere else in this file (handleSave, the task
  // count badges, the Review step's task list). Mirrors
  // TaskTemplatePage.jsx's validateRequirements() exactly: Department,
  // Role, Experience Level, and Required Count are all mandatory on any
  // requirement row that exists (a task may still have zero requirements),
  // duplicate Department+Role+Experience combinations within one task are
  // rejected, and a task cannot depend on itself or form a circular chain.
  const validateTasks = useCallback(() => {
    const errors = {};
    for (const t of tasks) {
      if (!t.NAME.trim()) continue;
      const reqErrors = {};
      const seen = new Set();
      for (const r of t.requirements) {
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
        if (Object.keys(rowErrors).length > 0) reqErrors[r._key] = rowErrors;
      }
      if (Object.keys(reqErrors).length > 0) errors[t._key] = reqErrors;
    }
    return errors;
  }, [tasks]);

  const goNext = useCallback(() => {
    if (step === "Basic Info") {
      if (!form.CATEGORY_ID) { toast.showWarning("Please select a category"); return; }
      if (!form.NAME.trim()) { toast.showWarning("Project name is required"); return; }
      const cfError = validateCf();
      if (cfError) { toast.showWarning(cfError); return; }
      setStep("Tasks");
      return;
    }
    if (step === "Tasks") {
      if (tasks.filter((t) => t.NAME.trim()).length === 0) {
        toast.showWarning("Add at least one task");
        return;
      }
      const errors = validateTasks();
      if (Object.keys(errors).length > 0) {
        setTaskErrors(errors);
        toast.showWarning("Please fix the manpower requirement fields highlighted below before continuing.");
        return;
      }
      setTaskErrors({});
      setStep(steps.includes("Task Group") ? "Task Group" : "Inventory Requirement");
      return;
    }
    if (step === "Task Group") {
      setStep("Inventory Requirement");
      return;
    }
    if (step === "Inventory Requirement") {
      setStep("Review");
    }
  }, [step, form, toast, validateCf, tasks, validateTasks, steps]);

  const goBack = useCallback(() => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  }, [step, steps]);

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
        TASK_SCOPE: "UNIT",
        requirements: [],
      }))
    );
    // The old task _keys any groups referenced are gone now — a fresh BOM
    // import replaces the task list wholesale, so any groups configured
    // against the previous list can no longer be resolved.
    setTaskGroups([]);
    setBomParsed(true);
  };

  const addTask = useCallback(() => setTasks((prev) => [...prev, EMPTY_TASK()]), []);

  // Removing a task also cleans up any Task Group that referenced it —
  // as a member or as a dependency target — so no group is left pointing
  // at a task that no longer exists. A group left with zero members is
  // dropped entirely (an empty group can never be re-saved as valid
  // anyway). The task itself is simply removed from the wizard's staged
  // list — nothing is deleted server-side until Save.
  const removeTask = useCallback((idx) => {
    const removedKey = tasksRef.current[idx]?._key;
    setTasks((prev) => prev.filter((_, i) => i !== idx));
    if (removedKey) {
      setTaskGroups((prev) => prev
        .map((g) => ({
          ...g,
          taskKeys: g.taskKeys.filter((k) => k !== removedKey),
          dependencyKey: g.dependencyKey === removedKey ? null : g.dependencyKey,
        }))
        .filter((g) => g.taskKeys.length > 0)
      );
    }
  }, []);

  const updateTask = useCallback((idx, field, value) => {
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  }, []);

  // Manpower requirement helpers — identical logic to TaskTemplatePage.jsx's
  // addRequirement/removeRequirement/updateRequirement, parameterized by
  // which task's requirements array to operate on.
  const addRequirement = useCallback((taskIdx) => {
    setTasks((prev) => prev.map((t, i) => (i === taskIdx ? { ...t, requirements: [...t.requirements, EMPTY_REQUIREMENT()] } : t)));
  }, []);

  const removeRequirement = useCallback((taskIdx, reqIdx) => {
    setTasks((prev) => prev.map((t, i) => (i === taskIdx ? { ...t, requirements: t.requirements.filter((_, ri) => ri !== reqIdx) } : t)));
  }, []);

  const updateRequirement = useCallback((taskIdx, reqIdx, field, value) => {
    setTasks((prev) => {
      const task = prev[taskIdx];
      const nextRequirements = task.requirements.map((r, ri) => (ri === reqIdx ? { ...r, [field]: value } : r));
      const reqKey = nextRequirements[reqIdx]._key;
      setTaskErrors((prevErrors) => {
        const taskKey = task._key;
        if (!prevErrors[taskKey]?.[reqKey]) return prevErrors;
        const rowErrors = { ...prevErrors[taskKey][reqKey] };
        delete rowErrors[field];
        delete rowErrors.DUPLICATE; // any edit can resolve a stale duplicate flag too
        const updatedTaskErrors = { ...prevErrors[taskKey] };
        if (Object.keys(rowErrors).length > 0) updatedTaskErrors[reqKey] = rowErrors;
        else delete updatedTaskErrors[reqKey];
        const updated = { ...prevErrors };
        if (Object.keys(updatedTaskErrors).length > 0) updated[taskKey] = updatedTaskErrors;
        else delete updated[taskKey];
        return updated;
      });
      return prev.map((t, i) => (i === taskIdx ? { ...t, requirements: nextRequirements } : t));
    });
  }, []);

  // ── Task Group step (wizard) ──────────────────────────────────────────
  // Tasks passed to the shared TaskGroupModal picker table, in the shape
  // it expects — only named tasks are real candidates.
  const pickerTasksFromWizard = useMemo(
    () => tasks.filter((t) => t.NAME.trim()).map((t, i) => ({
      id: t._key,
      NAME: t.NAME,
      SEQUENCE_NUMBER: i,
      DURATION_VALUE: t.DURATION_VALUE,
      DURATION_UNIT: t.DURATION_UNIT,
      TASK_SCOPE: t.TASK_SCOPE,
      TOTAL_REQUIRED_COUNT: t.requirements.reduce((sum, r) => sum + (parseInt(r.REQUIRED_COUNT, 10) || 0), 0),
    })),
    [tasks]
  );

  // Task keys already claimed by ANOTHER group (the group currently open
  // in the modal, if any, is excluded so its own members stay selectable).
  const groupedTaskKeysExcludingCurrent = useMemo(() => {
    const editingKey = groupModalState?.editing?._key;
    const claimed = new Set();
    taskGroups.forEach((g) => {
      if (g._key === editingKey) return;
      g.taskKeys.forEach((k) => claimed.add(k));
    });
    return Array.from(claimed);
  }, [taskGroups, groupModalState]);

  const initialGroupForWizardModal = useMemo(() => {
    const g = groupModalState?.editing;
    if (!g) return null;
    return {
      id: g._key,
      NAME: g.NAME || "",
      memberIds: g.taskKeys,
      DEPENDENCY_RULE: g.DEPENDENCY_RULE,
      dependencyId: g.dependencyKey || null,
    };
  }, [groupModalState]);

  const openCreateGroupModal = useCallback(() => setGroupModalState({ editing: null }), []);
  const openEditGroupModal = useCallback((g) => setGroupModalState({ editing: g }), []);
  const closeGroupModal = useCallback(() => setGroupModalState(null), []);

  const handleSaveGroupModal = useCallback((draft) => {
    setTaskGroups((prev) => {
      if (draft.id) {
        return prev.map((g) => (g._key === draft.id
          ? { ...g, NAME: draft.NAME, taskKeys: draft.memberIds, DEPENDENCY_RULE: draft.DEPENDENCY_RULE, dependencyKey: draft.dependencyId }
          : g));
      }
      return [...prev, {
        _key: Math.random().toString(36).slice(2),
        NAME: draft.NAME, taskKeys: draft.memberIds,
        DEPENDENCY_RULE: draft.DEPENDENCY_RULE, dependencyKey: draft.dependencyId,
      }];
    });
    setGroupModalState(null);
  }, []);

  const handleDeleteGroup = useCallback((groupKey) => {
    setTaskGroups((prev) => prev.filter((g) => g._key !== groupKey));
  }, []);

  // Removing a task from a group only clears its group assignment — the
  // task itself stays in the Tasks list untouched, and becomes selectable
  // for another group immediately. A group left with no members is
  // dropped (an empty group is never a valid, savable state).
  const handleRemoveTaskFromGroup = useCallback((groupKey, taskKey) => {
    setTaskGroups((prev) => prev
      .map((g) => (g._key === groupKey ? { ...g, taskKeys: g.taskKeys.filter((k) => k !== taskKey) } : g))
      .filter((g) => g.taskKeys.length > 0)
    );
  }, []);

  // Products already added to this project are excluded from the picker
  // (a product may only appear once per project — the same inversion
  // pattern TaskGroupModal uses to exclude already-selected members).
  const availableProductsForReq = useMemo(() => {
    const addedIds = new Set(productRequirements.map((r) => r.PRODUCT_ID));
    return allProducts.filter((p) => {
      if (addedIds.has(p.ID)) return false;
      if (reqCategoryFilter && p.CATEGORY_ID !== reqCategoryFilter) return false;
      return true;
    });
  }, [allProducts, productRequirements, reqCategoryFilter]);

  const handleAddProductRequirement = useCallback(() => {
    const product = allProducts.find((p) => p.ID === reqSelectedProductId);
    if (!product) { toast.showWarning("Select a product first"); return; }
    const qty = parseFloat(reqQty);
    if (!reqQty || Number.isNaN(qty) || qty <= 0) { toast.showWarning("Enter a required quantity greater than 0"); return; }
    if (productRequirements.some((r) => r.PRODUCT_ID === product.ID)) {
      toast.showWarning("This product has already been added to the project.");
      return;
    }
    setProductRequirements((prev) => [...prev, { ...EMPTY_PRODUCT_REQ(product), REQUIRED_QTY: qty }]);
    setReqSelectedProductId(""); setReqQty(1);
  }, [allProducts, reqSelectedProductId, reqQty, productRequirements, toast]);

  const handleRemoveProductRequirement = useCallback((key) => {
    setProductRequirements((prev) => prev.filter((r) => r._key !== key));
  }, []);

  const handleProductRequirementQtyChange = useCallback((key, value) => {
    setProductRequirements((prev) => prev.map((r) => (r._key === key ? { ...r, REQUIRED_QTY: value } : r)));
  }, []);

  const durationBreakdown = useMemo(
    () => computeDurationBreakdown(tasks, taskGroups, form.ASSIGNMENT_MODE, companyWorkHours),
    [tasks, taskGroups, form.ASSIGNMENT_MODE, companyWorkHours]
  );

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
    // Defense-in-depth — goNext() already blocks leaving the Tasks step
    // without this, but re-check here too in case Review is ever reached
    // another way, so a project can never be saved with an incomplete
    // manpower requirement. Group validity (membership, dependency rule,
    // cycles) is already enforced per-group at group-save time in the
    // Task Group step's modal — the backend re-validates all of it
    // authoritatively regardless.
    const errors = validateTasks();
    if (Object.keys(errors).length > 0) {
      setTaskErrors(errors);
      setStep("Tasks");
      toast.showWarning("Please fix the manpower requirement fields highlighted below before saving.");
      return;
    }
    setSaving(true);
    try {
      // Groups/dependencies reference tasks by _key in this component's
      // state; the backend needs their 0-based position within the
      // tasks[] array actually being submitted (validTasks) instead,
      // since brand-new tasks have no real ID yet — see TaskGroupIn /
      // TaskGroupDependencyIndexIn in project_template.py.
      const indexByKey = new Map(validTasks.map((t, i) => [t._key, i]));
      const validGroups = taskGroups.filter((g) => g.taskKeys.some((k) => indexByKey.has(k)));
      const payload = {
        CATEGORY_ID: form.CATEGORY_ID,
        NAME: form.NAME,
        DESCRIPTION: form.DESCRIPTION || null,
        BOM_MODE: form.BOM_MODE,
        ASSIGNMENT_MODE: form.ASSIGNMENT_MODE || "PARALLEL",
        tasks: validTasks.map((t, i) => ({
          NAME: t.NAME,
          DESCRIPTION: t.DESCRIPTION || null,
          DURATION_VALUE: parseFloat(t.DURATION_VALUE) || 1,
          DURATION_UNIT: t.DURATION_UNIT,
          SEQUENCE_NUMBER: i,
          TASK_SCOPE: t.TASK_SCOPE || "UNIT",
          requirements: t.requirements.map((r) => ({
            DEPARTMENT_ID: r.DEPARTMENT_ID ? parseInt(r.DEPARTMENT_ID) : null,
            ROLE_ID: r.ROLE_ID ? parseInt(r.ROLE_ID) : null,
            EXPERIENCE_LEVEL: r.EXPERIENCE_LEVEL,
            REQUIRED_COUNT: parseInt(r.REQUIRED_COUNT) || 1,
          })),
        })),
        task_groups: validGroups.map((g) => ({
          NAME: g.NAME || null,
          task_indexes: g.taskKeys.filter((k) => indexByKey.has(k)).map((k) => indexByKey.get(k)),
          DEPENDENCY_RULE: g.DEPENDENCY_RULE,
          DEPENDS_ON_TASK_INDEX: g.dependencyKey && indexByKey.has(g.dependencyKey)
            ? indexByKey.get(g.dependencyKey)
            : null,
        })),
        product_requirements: productRequirements.map((r) => ({
          PRODUCT_ID: r.PRODUCT_ID,
          REQUIRED_QTY: parseFloat(r.REQUIRED_QTY) || 1,
        })),
      };
      if (wizard === "edit" && editRow) {
        const res = await projectService.update(editRow.ID, payload);
        await saveCfValues(editRow.ID);
        // The task/group list is frozen once real production tasks have
        // already been generated/assigned against it (see the backend's
        // _project_has_live_production_tasks() guard) — everything else
        // in this save still applied, but call out the one thing that
        // didn't so it's never a silent, confusing no-op.
        if (res.data?.tasks_skipped_reason) {
          toast.showWarning(res.data.tasks_skipped_reason);
        } else {
          toast.showSuccess("Project updated");
        }
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
  }, [tasks, taskGroups, productRequirements, form, wizard, editRow, closeWizard, loadAll, toast, saveCfValues, validateTasks]);

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
          <div className={styles.dateFilters}>
            <label className={styles.dateLabel}>From</label>
            <input type="datetime-local" className={styles.dateInput} value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }} />
            <label className={styles.dateLabel}>To</label>
            <input type="datetime-local" className={styles.dateInput} value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }} />
            {(filterFrom || filterTo) && <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>}
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
                <th>Created Date</th>
                {cfFields.map((f) => <th key={f.ID}>{f.FIELD_NAME}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8 + cfFields.length}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8 + cfFields.length}>
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
                    <td>{formatDateTime(r.CREATED_AT)}</td>
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
                        {canViewGroups && (
                          <PMButton variant="ghost" size="sm" onClick={() => setGroupsRowProject(r)}>Group</PMButton>
                        )}
                        {canViewInventory && (
                          <PMButton variant="ghost" size="sm" onClick={() => setInventoryRowProject(r)}>Inventory</PMButton>
                        )}
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
                  {steps.map((s, i) => (
                    <div
                      key={s}
                      className={`${styles.stepItem} ${step === s ? styles.stepActive : stepIndex > i ? styles.stepDone : ""}`}
                    >
                      <span className={styles.stepDot}>{stepIndex > i ? "✓" : i + 1}</span>
                      <span className={styles.stepLabel}>{s}</span>
                      {i < steps.length - 1 && <span className={styles.stepLine} />}
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

            {/* Basic Info */}
            {step === "Basic Info" && (
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
                <div className={styles.formGroup}>
                  <label>Assignment Mode</label>
                  <PMSelect
                    options={ASSIGNMENT_MODE_OPTIONS}
                    value={form.ASSIGNMENT_MODE}
                    onChange={(val) => setForm((f) => ({ ...f, ASSIGNMENT_MODE: val || "PARALLEL" }))}
                    valueKey="value"
                    labelKey="label"
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
            {step === "Tasks" && (
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
                  {tasks.map((t, idx) => (
                    <div
                      key={t._key}
                      className={`${styles.taskCard2} ${dragIdx === idx ? styles.taskRowDragging : ""}`}
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => onDragOver(e, idx)}
                      onDragEnd={onDragEnd}
                    >
                      <div className={styles.taskCard2Head}>
                        <span className={styles.dragHandle}>⠿</span>
                        <span className={styles.rowNum}>{idx + 1}</span>
                        <input
                          className={styles.taskNameInput}
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
                        <div className={styles.taskScopeCell}>
                          <PMSelect
                            options={TASK_SCOPES}
                            value={t.TASK_SCOPE}
                            onChange={(val) => updateTask(idx, "TASK_SCOPE", val)}
                            size="sm"
                          />
                          <span className={styles.taskScopeHint}>{TASK_SCOPE_HELP[t.TASK_SCOPE]}</span>
                        </div>
                        <button
                          className={styles.removeBtn}
                          onClick={() => removeTask(idx)}
                          disabled={tasks.length === 1}
                          title="Remove task"
                        >
                          ×
                        </button>
                      </div>

                      <div className={styles.requirementsSection}>
                        <div className={styles.requirementsHeader}>
                          <span className={styles.requirementsTitle}>
                            Manpower Requirements {t.requirements.length > 0 && `(${t.requirements.length})`}
                          </span>
                        </div>
                        {t.requirements.length === 0 && (
                          <p className={styles.hint}>No manpower requirements added yet — this task has no specific staffing need, or add one below.</p>
                        )}
                        {t.requirements.map((r, ridx) => (
                          <div key={r._key} className={styles.requirementRow}>
                            <div className={styles.requirementRowHead}>
                              <span className={styles.requirementRowTitle}>Requirement {ridx + 1}</span>
                              <button
                                type="button"
                                className={styles.removeRowBtn}
                                onClick={() => removeRequirement(idx, ridx)}
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
                                  onChange={(val) => updateRequirement(idx, ridx, "DEPARTMENT_ID", val)}
                                  valueKey="ID"
                                  labelKey="NAME"
                                  placeholder="Select Department"
                                  size="sm"
                                  className={taskErrors[t._key]?.[r._key]?.DEPARTMENT_ID ? styles.taskSelectError : ""}
                                />
                                {taskErrors[t._key]?.[r._key]?.DEPARTMENT_ID && (
                                  <span className={styles.taskFieldError}>{taskErrors[t._key][r._key].DEPARTMENT_ID}</span>
                                )}
                              </div>
                              <div className={styles.requirementFieldCell}>
                                <label>Role <span className={styles.req}>*</span></label>
                                <PMSelect
                                  options={rolesForDept(r.DEPARTMENT_ID)}
                                  value={r.ROLE_ID}
                                  onChange={(val) => updateRequirement(idx, ridx, "ROLE_ID", val)}
                                  valueKey="ID"
                                  labelKey="NAME"
                                  placeholder="Select Role"
                                  size="sm"
                                  className={taskErrors[t._key]?.[r._key]?.ROLE_ID ? styles.taskSelectError : ""}
                                />
                                {taskErrors[t._key]?.[r._key]?.ROLE_ID && (
                                  <span className={styles.taskFieldError}>{taskErrors[t._key][r._key].ROLE_ID}</span>
                                )}
                              </div>
                              <div className={styles.requirementFieldCell}>
                                <label>Experience <span className={styles.req}>*</span></label>
                                <PMSelect
                                  options={EXPERIENCE_LEVELS}
                                  value={r.EXPERIENCE_LEVEL}
                                  onChange={(val) => updateRequirement(idx, ridx, "EXPERIENCE_LEVEL", val)}
                                  placeholder="Select Experience Level"
                                  size="sm"
                                  className={taskErrors[t._key]?.[r._key]?.EXPERIENCE_LEVEL ? styles.taskSelectError : ""}
                                />
                                {taskErrors[t._key]?.[r._key]?.EXPERIENCE_LEVEL && (
                                  <span className={styles.taskFieldError}>{taskErrors[t._key][r._key].EXPERIENCE_LEVEL}</span>
                                )}
                              </div>
                              <div className={styles.requirementFieldCell}>
                                <label>Required Count <span className={styles.req}>*</span></label>
                                <input
                                  className={`${styles.durInput}${taskErrors[t._key]?.[r._key]?.REQUIRED_COUNT ? " " + styles.inputError : ""}`}
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={r.REQUIRED_COUNT}
                                  onChange={(e) => updateRequirement(idx, ridx, "REQUIRED_COUNT", e.target.value)}
                                />
                                {taskErrors[t._key]?.[r._key]?.REQUIRED_COUNT && (
                                  <span className={styles.taskFieldError}>{taskErrors[t._key][r._key].REQUIRED_COUNT}</span>
                                )}
                              </div>
                            </div>
                            {taskErrors[t._key]?.[r._key]?.DUPLICATE && (
                              <span className={styles.taskFieldError}>{taskErrors[t._key][r._key].DUPLICATE}</span>
                            )}
                          </div>
                        ))}
                        <button type="button" className={styles.addRowBtn} onClick={() => addRequirement(idx)}>
                          + Add Requirement
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Task Group — only shown for SEQUENTIAL projects */}
            {step === "Task Group" && (
              <div className={styles.wizardBody}>
                <div className={styles.taskEditorHeader}>
                  <span className={styles.taskEditorTitle}>Task Groups ({taskGroups.length})</span>
                  {canCreateGroups && (
                    <PMButton variant="outline" size="sm" onClick={openCreateGroupModal}>+ Create Group</PMButton>
                  )}
                </div>
                {taskGroups.length === 0 ? (
                  <p className={styles.hint}>
                    No task groups yet. Group tasks that should run in parallel and configure what each group
                    depends on — ungrouped tasks continue to run individually, in sequence.
                  </p>
                ) : (
                  <div className={styles.taskEditor}>
                    {taskGroups.map((g, i) => {
                      const members = tasks.filter((t) => g.taskKeys.includes(t._key));
                      const depName = g.dependencyKey
                        ? tasks.find((t) => t._key === g.dependencyKey)?.NAME
                        : null;
                      return (
                        <div key={g._key} className={styles.groupCard}>
                          <div className={styles.groupCardHead}>
                            <span className={styles.rowNum}>{i + 1}</span>
                            <span className={styles.groupCardName}>{g.NAME || `Group ${i + 1}`}</span>
                            <div style={{ flex: 1 }} />
                            {canUpdateGroups && (
                              <button className={styles.linkBtn} onClick={() => openEditGroupModal(g)}>Edit</button>
                            )}
                            {canDeleteGroups && (
                              <button className={styles.linkBtnDanger} onClick={() => handleDeleteGroup(g._key)}>Delete Group</button>
                            )}
                          </div>
                          <div className={styles.groupMemberList}>
                            {members.map((t) => (
                              <div key={t._key} className={styles.groupMemberRow}>
                                <span>{t.NAME}</span>
                                <span className={styles.muted}>{t.DURATION_VALUE} {t.DURATION_UNIT}</span>
                                {canUpdateGroups && (
                                  <button className={styles.removeRowBtn} onClick={() => handleRemoveTaskFromGroup(g._key, t._key)}>Remove</button>
                                )}
                              </div>
                            ))}
                          </div>
                          <p className={styles.hint}>
                            Dependency Rule: <strong>{g.DEPENDENCY_RULE}</strong>
                            {depName && <> — Depends on: {depName}</>}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {step === "Inventory Requirement" && (
              <div className={styles.wizardBody}>
                <div className={styles.taskEditorHeader}>
                  <span className={styles.taskEditorTitle}>Required Inventory ({productRequirements.length})</span>
                </div>
                <p className={styles.hint}>
                  Select the inventory products this project needs, and how many of each — this is per one
                  unit of the project; the actual quantity purchased by a customer multiplies this automatically.
                </p>

                <div className={styles.reqPickerRow}>
                  <PMSelect
                    value={reqCategoryFilter}
                    onChange={(v) => { setReqCategoryFilter(v); setReqSelectedProductId(""); }}
                    options={[{ value: "", label: "All Categories" }, ...invCategories.map((c) => ({ value: c.ID, label: c.NAME }))]}
                    placeholder="Inventory Category"
                  />
                  <PMSelect
                    value={reqSelectedProductId}
                    onChange={setReqSelectedProductId}
                    options={availableProductsForReq.map((p) => ({ value: p.ID, label: `${p.PRODUCT_NAME} (${p.PRODUCT_CODE})` }))}
                    placeholder={availableProductsForReq.length === 0 ? "No more products available" : "Select a Product"}
                    disabled={availableProductsForReq.length === 0}
                  />
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={reqQty}
                    onChange={(e) => setReqQty(e.target.value)}
                    className={styles.input}
                    placeholder="Qty"
                    style={{ maxWidth: 100 }}
                  />
                  <PMButton variant="outline" size="sm" onClick={handleAddProductRequirement} disabled={!reqSelectedProductId}>
                    + Add
                  </PMButton>
                </div>

                {productRequirements.length === 0 ? (
                  <p className={styles.hint}>No inventory products required yet — this project won't automatically consume any stock.</p>
                ) : (
                  <table className={styles.reviewReqTable}>
                    <thead>
                      <tr><th>Product Code</th><th>Product Name</th><th>Unit</th><th>Required Qty</th><th></th></tr>
                    </thead>
                    <tbody>
                      {productRequirements.map((r) => (
                        <tr key={r._key}>
                          <td>{r.PRODUCT_CODE}</td>
                          <td>{r.PRODUCT_NAME}</td>
                          <td>{r.UNIT || "—"}</td>
                          <td>
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              value={r.REQUIRED_QTY}
                              onChange={(e) => handleProductRequirementQtyChange(r._key, e.target.value)}
                              className={styles.input}
                              style={{ maxWidth: 90 }}
                            />
                          </td>
                          <td>
                            <button className={styles.removeRowBtn} onClick={() => handleRemoveProductRequirement(r._key)}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Review */}
            {step === "Review" && (
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
                    <div className={styles.reviewItem}>
                      <span className={styles.reviewLabel}>Assignment Mode</span>
                      <span className={styles.reviewValue}>
                        {form.ASSIGNMENT_MODE === "SEQUENTIAL" ? "Sequential" : "Parallel"}
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
                <div className={styles.reviewDurationCard}>
                  <div className={styles.reviewDurationHead}>Estimated Project Duration</div>
                  <div className={styles.reviewDurationStats}>
                    <span className={styles.reviewDurationValue}>{durationBreakdown.totalDays.toFixed(1)} Days</span>
                    <span className={styles.reviewDurationSub}>{durationBreakdown.totalHours.toFixed(1)} Working Hours</span>
                  </div>
                  {(durationBreakdown.groups.length > 0 || durationBreakdown.standalone.length > 0) && (
                    <div className={styles.reviewDurationBreakdown}>
                      {durationBreakdown.groups.map((g) => (
                        <div key={g.key} className={styles.reviewDurationRow}>
                          <span>{g.name} ({g.members.map((m) => m.NAME).join(" + ")}) — Parallel</span>
                          <span>{g.durationDays.toFixed(1)} Days</span>
                        </div>
                      ))}
                      {durationBreakdown.standalone.map((s) => (
                        <div key={s.key} className={styles.reviewDurationRow}>
                          <span>{s.name}</span>
                          <span>{s.durationDays.toFixed(1)} Days</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {taskGroups.length > 0 && (
                  <>
                    <div className={styles.reviewTasksTitle}>Task Groups ({taskGroups.length})</div>
                    <div className={styles.reviewTaskList}>
                      {taskGroups.map((g, i) => {
                        const members = tasks.filter((t) => g.taskKeys.includes(t._key) && t.NAME.trim());
                        const depName = g.dependencyKey
                          ? tasks.find((t) => t._key === g.dependencyKey)?.NAME
                          : null;
                        return (
                          <div key={g._key} className={styles.reviewTaskDetailCard}>
                            <div className={styles.reviewTaskDetailHead}>
                              <span className={styles.reviewTaskName}>{g.NAME || `Group ${i + 1}`}</span>
                            </div>
                            <table className={styles.reviewReqTable}>
                              <thead>
                                <tr><th>Seq</th><th>Task</th><th>Duration</th><th>Scope</th><th>Manpower</th></tr>
                              </thead>
                              <tbody>
                                {members.map((t) => (
                                  <tr key={t._key}>
                                    <td>{tasks.indexOf(t) + 1}</td>
                                    <td>{t.NAME}</td>
                                    <td>{t.DURATION_VALUE} {t.DURATION_UNIT}</td>
                                    <td>{t.TASK_SCOPE}</td>
                                    <td>{t.requirements.reduce((s, r) => s + (parseInt(r.REQUIRED_COUNT, 10) || 0), 0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className={styles.hint}>
                              Dependency Rule: <strong>{g.DEPENDENCY_RULE}</strong>
                              {depName && <> — Depends on: {depName}</>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className={styles.reviewTasksTitle}>
                  Tasks ({tasks.filter((t) => t.NAME.trim()).length})
                </div>
                <div className={styles.reviewTaskList}>
                  {tasks.filter((t) => t.NAME.trim()).map((t, i) => (
                    <div key={t._key} className={styles.reviewTaskDetailCard}>
                      <div className={styles.reviewTaskDetailHead}>
                        <span className={styles.reviewSeq}>{i + 1}</span>
                        <span className={styles.reviewTaskName}>{t.NAME}</span>
                        <span className={styles.durBadge}>{t.DURATION_VALUE} {t.DURATION_UNIT}</span>
                        <span className={styles.durBadge}>{t.TASK_SCOPE || "UNIT"}</span>
                      </div>
                      {t.DESCRIPTION && <p className={styles.hint}>{t.DESCRIPTION}</p>}
                      {t.requirements.length > 0 ? (
                        <table className={styles.reviewReqTable}>
                          <thead>
                            <tr><th>Department</th><th>Role</th><th>Experience</th><th>Count</th></tr>
                          </thead>
                          <tbody>
                            {t.requirements.map((r) => (
                              <tr key={r._key}>
                                <td>{departments.find((d) => String(d.ID) === String(r.DEPARTMENT_ID))?.NAME || "—"}</td>
                                <td>{rolesForDept(r.DEPARTMENT_ID).find((role) => String(role.ID) === String(r.ROLE_ID))?.NAME || "—"}</td>
                                <td>{r.EXPERIENCE_LEVEL || "—"}</td>
                                <td>{r.REQUIRED_COUNT}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className={styles.hint}>No manpower requirements configured.</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className={styles.reviewTasksTitle}>
                  Required Inventory ({productRequirements.length})
                </div>
                {productRequirements.length === 0 ? (
                  <p className={styles.hint}>No inventory products required for this project.</p>
                ) : (
                  <table className={styles.reviewReqTable}>
                    <thead>
                      <tr><th>Category</th><th>Product Code</th><th>Product Name</th><th>Unit</th><th>Required Qty</th></tr>
                    </thead>
                    <tbody>
                      {productRequirements.map((r) => (
                        <tr key={r._key}>
                          <td>{invCategories.find((c) => c.ID === r.CATEGORY_ID)?.NAME || "—"}</td>
                          <td>{r.PRODUCT_CODE}</td>
                          <td>{r.PRODUCT_NAME}</td>
                          <td>{r.UNIT || "—"}</td>
                          <td>{r.REQUIRED_QTY}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div className={styles.wizardFooter}>
              {stepIndex > 0 && (
                <PMButton variant="outline" onClick={goBack}>← Back</PMButton>
              )}
              <div style={{ flex: 1 }} />
              <PMButton variant="outline" onClick={closeWizard}>Cancel</PMButton>
              {stepIndex < steps.length - 1
                ? <PMButton variant="primary" onClick={goNext}>Next →</PMButton>
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

      {/* Create/Edit Task Group modal — wizard's Task Group step */}
      <TaskGroupModal
        open={!!groupModalState}
        onClose={closeGroupModal}
        onSave={handleSaveGroupModal}
        tasks={pickerTasksFromWizard}
        groupedIds={groupedTaskKeysExcludingCurrent}
        initialGroup={initialGroupForWizardModal}
      />

      {/* "Group" row action — manage an existing project's groups outside the wizard */}
      <ProjectGroupsModal
        open={!!groupsRowProject}
        onClose={() => setGroupsRowProject(null)}
        project={groupsRowProject}
        canCreate={canCreateGroups}
        canUpdate={canUpdateGroups}
        canDelete={canDeleteGroups}
      />

      {/* "Inventory" row action — read-only view of a project's configured
          Inventory Requirements outside the create/edit wizard. */}
      <ProjectInventoryRequirementsModal
        open={!!inventoryRowProject}
        onClose={() => setInventoryRowProject(null)}
        project={inventoryRowProject}
      />
    </div>
  );
}
