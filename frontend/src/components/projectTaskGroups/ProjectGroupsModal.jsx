import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PMModal, PMButton, PMConfirmModal, Loader } from "../pm";
import { taskService } from "../../services/taskService";
import { taskGroupService } from "../../services/taskGroupService";
import { useToast } from "../../hooks/useToast";
import TaskGroupModal from "./TaskGroupModal";
import styles from "./ProjectGroupsModal.module.css";

function fmtDuration(t) {
  const val = t.DURATION_VALUE ?? 1;
  const unit = (t.DURATION_UNIT || "DAYS").toLowerCase();
  return `${val} ${unit}`;
}

/**
 * "Group" row-action modal opened from /projects — lets the user view,
 * create, edit, and delete Task Groups for a project outside the
 * create/edit wizard, against the real standalone /projects/{id}/task-groups
 * API (unlike the wizard, which stages everything client-side until Save).
 */
export default function ProjectGroupsModal({ open, onClose, project, canCreate, canUpdate, canDelete }) {
  const toast = useToast();
  // useToast() returns a brand-new object on every call (not memoized), so
  // closing over it directly in `load`'s deps would give `load` a new
  // identity on every render — which kept re-firing the mount effect below
  // and re-showing the loader in a loop. Reading it via a ref instead lets
  // `load` depend only on `project`, which is stable across renders.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupModal, setGroupModal] = useState(null); // { group } | { group: null } for create
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [taskRes, groupRes] = await Promise.all([
        taskService.getByProject(project.ID),
        taskGroupService.getByProject(project.ID),
      ]);
      setTasks(taskRes.data || []);
      setGroups(groupRes.data || []);
    } catch {
      toastRef.current.showError("Failed to load task groups.");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const pickerTasks = useMemo(
    () => tasks.map((t) => ({
      id: t.ID,
      NAME: t.NAME,
      SEQUENCE_NUMBER: t.SEQUENCE_NUMBER,
      DURATION_VALUE: t.DURATION_VALUE,
      DURATION_UNIT: t.DURATION_UNIT,
      TASK_SCOPE: t.TASK_SCOPE,
      TOTAL_REQUIRED_COUNT: t.TOTAL_REQUIRED_COUNT,
    })),
    [tasks]
  );

  const openCreateGroup = useCallback(() => setGroupModal({ group: null }), []);
  const openEditGroup = useCallback((g) => setGroupModal({ group: g }), []);
  const closeGroupModal = useCallback(() => setGroupModal(null), []);

  const initialGroupForModal = useMemo(() => {
    const g = groupModal?.group;
    if (!g) return null;
    return {
      id: g.ID,
      NAME: g.NAME || "",
      memberIds: g.task_templates.map((t) => t.ID),
      DEPENDENCY_RULE: g.DEPENDENCY_RULE,
      dependencyId: g.DEPENDS_ON_TASK_TEMPLATE_ID || null,
    };
  }, [groupModal]);

  const groupedIdsExcludingCurrent = useMemo(() => {
    const currentMembers = new Set(initialGroupForModal?.memberIds || []);
    return tasks
      .filter((t) => t.TASK_GROUP_ID && !currentMembers.has(t.ID))
      .map((t) => t.ID);
  }, [tasks, initialGroupForModal]);

  const handleSaveGroup = useCallback(async (draft) => {
    setSaving(true);
    try {
      const payload = {
        NAME: draft.NAME || null,
        task_template_ids: draft.memberIds,
        DEPENDENCY_RULE: draft.DEPENDENCY_RULE,
        DEPENDS_ON_TASK_TEMPLATE_ID: draft.dependencyId,
      };
      if (draft.id) {
        await taskGroupService.update(project.ID, draft.id, payload);
        toastRef.current.showSuccess("Task group updated.");
      } else {
        await taskGroupService.create(project.ID, payload);
        toastRef.current.showSuccess("Task group created.");
      }
      setGroupModal(null);
      load();
    } catch (e) {
      toastRef.current.showError(e?.response?.data?.detail || "Failed to save task group.");
    } finally {
      setSaving(false);
    }
  }, [project, load]);

  const handleDeleteGroup = useCallback((g) => {
    setConfirmDelete({
      group: g,
      onConfirm: async () => {
        try {
          await taskGroupService.remove(project.ID, g.ID);
          toastRef.current.showSuccess("Task group deleted — its tasks are now ungrouped.");
          setConfirmDelete(null);
          load();
        } catch (e) {
          toastRef.current.showError(e?.response?.data?.detail || "Failed to delete task group.");
        }
      },
    });
  }, [project, load]);

  const handleRemoveTask = useCallback(async (g, taskId) => {
    const remaining = g.task_templates.map((t) => t.ID).filter((id) => id !== taskId);
    if (remaining.length === 0) {
      handleDeleteGroup(g);
      return;
    }
    try {
      await taskGroupService.update(project.ID, g.ID, { task_template_ids: remaining });
      toastRef.current.showSuccess("Task removed from group.");
      load();
    } catch (e) {
      toastRef.current.showError(e?.response?.data?.detail || "Failed to update task group.");
    }
  }, [project, load, handleDeleteGroup]);

  if (!open || !project) return null;

  return (
    <>
      <PMModal
        open={open}
        onClose={onClose}
        title={`Task Groups — ${project.NAME}`}
        size="lg"
        footer={
          canCreate ? (
            <div className={styles.footerRow}>
              <PMButton variant="primary" onClick={openCreateGroup}>+ Create Group</PMButton>
            </div>
          ) : null
        }
      >
        {loading ? (
          <div className={styles.loaderWrap}><Loader /></div>
        ) : groups.length === 0 ? (
          <p className={styles.emptyHint}>
            No task groups yet.{canCreate ? " Click “+ Create Group” below to group tasks that should run in parallel." : ""}
          </p>
        ) : (
          <div className={styles.groupList}>
            {groups.map((g, i) => (
              <div key={g.ID} className={styles.groupCard}>
                <div className={styles.groupCardHead}>
                  <span className={styles.groupName}>{g.NAME || `Group ${i + 1}`}</span>
                  <div className={styles.groupActions}>
                    {canUpdate && (
                      <button className={styles.linkBtn} onClick={() => openEditGroup(g)}>Edit</button>
                    )}
                    {canDelete && (
                      <button className={styles.linkBtnDanger} onClick={() => handleDeleteGroup(g)}>Delete Group</button>
                    )}
                  </div>
                </div>

                <div className={styles.memberList}>
                  {g.task_templates.map((t) => (
                    <div key={t.ID} className={styles.memberRow}>
                      <span className={styles.memberSeq}>{t.SEQUENCE_NUMBER + 1}</span>
                      <span className={styles.memberName}>{t.NAME}</span>
                      <span className={styles.memberDur}>{fmtDuration(t)}</span>
                      <span className={styles.memberScope}>{t.TASK_SCOPE}</span>
                      <span className={styles.memberManpower}>{t.TOTAL_REQUIRED_COUNT ?? 0} manpower</span>
                      {canUpdate && (
                        <button
                          className={styles.removeMemberBtn}
                          title="Remove from group"
                          onClick={() => handleRemoveTask(g, t.ID)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className={styles.groupMeta}>
                  <span className={styles.ruleChip}>Dependency Rule: {g.DEPENDENCY_RULE}</span>
                  {g.DEPENDS_ON_TASK_NAME && (
                    <span className={styles.depChip}>
                      Depends on: {g.DEPENDS_ON_TASK_NAME}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </PMModal>

      <TaskGroupModal
        open={!!groupModal}
        onClose={closeGroupModal}
        onSave={handleSaveGroup}
        tasks={pickerTasks}
        groupedIds={groupedIdsExcludingCurrent}
        initialGroup={initialGroupForModal}
        saving={saving}
      />

      <PMConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDelete?.onConfirm ?? (() => {})}
        title="Delete Task Group"
        description={`Delete "${confirmDelete?.group?.NAME || "this group"}"? Its tasks will become ungrouped, not deleted.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </>
  );
}
