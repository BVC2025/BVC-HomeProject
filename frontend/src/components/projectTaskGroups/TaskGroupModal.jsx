import { useCallback, useMemo, useState, useEffect } from "react";
import { PMModal, PMButton, PMSelect, SearchBar } from "../pm";
import styles from "./TaskGroupModal.module.css";

const DEPENDENCY_RULES = ["ALL", "ANY", "ONE"];
const DEPENDENCY_RULE_HELP = {
  ALL: "All of this group's tasks must be completed before the next task/group can proceed.",
  ANY: "Any one of this group's tasks can be completed before the next task/group can proceed.",
  ONE: "Only the one task selected below needs to be completed before the next task/group can proceed.",
};

function fmtDuration(t) {
  const val = t.DURATION_VALUE ?? 1;
  const unit = (t.DURATION_UNIT || "DAYS").toLowerCase();
  return `${val} ${unit}`;
}

// Searchable, selectable task table — shared by both the member-selection
// and (ONE-rule only) depends-on-selection sections below. `multiple`
// toggles checkbox (member selection, always multi) vs radio (ONE's
// single trigger-task pick) interaction.
function TaskPickerTable({ tasks, selected, onToggle, multiple, emptyLabel }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tasks;
    return tasks.filter((t) => t.NAME.toLowerCase().includes(term));
  }, [tasks, search]);

  return (
    <div className={styles.pickerWrap}>
      <SearchBar value={search} onChange={setSearch} placeholder="Search tasks…" />
      <div className={styles.pickerTableWrap}>
        {tasks.length === 0 ? (
          <p className={styles.hint}>{emptyLabel}</p>
        ) : filtered.length === 0 ? (
          <p className={styles.hint}>No tasks match "{search}".</p>
        ) : (
          <table className={styles.pickerTable}>
            <thead>
              <tr>
                <th className={styles.pickCol} />
                <th>Seq</th>
                <th>Task Name</th>
                <th>Duration</th>
                <th>Scope</th>
                <th>Manpower</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const isSelected = selected.includes(t.id);
                return (
                  <tr
                    key={t.id}
                    className={isSelected ? styles.rowSelected : ""}
                    onClick={() => onToggle(t.id)}
                  >
                    <td className={styles.pickCol}>
                      <input
                        type={multiple ? "checkbox" : "radio"}
                        checked={isSelected}
                        onChange={() => onToggle(t.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className={styles.seqCell}>{t.SEQUENCE_NUMBER + 1}</td>
                    <td className={styles.nameCell}>{t.NAME}</td>
                    <td>{fmtDuration(t)}</td>
                    <td>
                      <span className={styles.scopeBadge}>{t.TASK_SCOPE || "UNIT"}</span>
                    </td>
                    <td>{t.TOTAL_REQUIRED_COUNT ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {selected.length > 0 && (
        <div className={styles.selectedCount}>
          {selected.length} task{selected.length !== 1 ? "s" : ""} selected
        </div>
      )}
    </div>
  );
}

/**
 * Create/Edit Task Group modal — reused by both the project wizard's Task
 * Group step (operating on in-memory `_key`s) and the standalone /projects
 * "Group" row-action modal (operating on real TaskTemplate IDs). Callers
 * normalize their tasks/group shape to a common `id` field so this
 * component never needs to know which representation it's working with.
 *
 * DEPENDENCY_RULE describes how THIS group's own selected tasks gate the
 * next task/group in sequence — there is no external dependency concept:
 *   - ALL: every selected task must be completed. No extra picker.
 *   - ANY: any one selected task must be completed. No extra picker.
 *   - ONE: one specific selected task must be completed — the "Depends On"
 *     picker appears only for this rule, offering only the tasks already
 *     checked above, single-select.
 *
 * `tasks`: [{ id, NAME, SEQUENCE_NUMBER, DURATION_VALUE, DURATION_UNIT, TASK_SCOPE, TOTAL_REQUIRED_COUNT }]
 * `groupedIds`: ids already claimed by ANOTHER group — excluded from the
 *   member-selection table (a task's own current group doesn't exclude it).
 * `initialGroup`: { id, NAME, memberIds, DEPENDENCY_RULE, dependencyId } or null (create mode)
 * `onSave(draft)`: async — draft has the same shape as initialGroup (id is null for a new group)
 */
export default function TaskGroupModal({
  open, onClose, onSave, tasks, groupedIds, initialGroup, saving,
}) {
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState([]);
  const [rule, setRule] = useState("ALL");
  const [dependencyId, setDependencyId] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName(initialGroup?.NAME || "");
    setMemberIds(initialGroup?.memberIds || []);
    setRule(initialGroup?.DEPENDENCY_RULE || "ALL");
    setDependencyId(initialGroup?.dependencyId || null);
  }, [open, initialGroup]);

  const memberCandidates = useMemo(() => {
    const grouped = new Set(groupedIds || []);
    return tasks.filter((t) => !grouped.has(t.id) || memberIds.includes(t.id));
  }, [tasks, groupedIds, memberIds]);

  // ONE's "Depends On" choices are exclusively the tasks already checked
  // in "Select Tasks" above — never any other task in the project.
  const dependencyCandidates = useMemo(
    () => tasks.filter((t) => memberIds.includes(t.id)),
    [tasks, memberIds]
  );

  const toggleMember = useCallback((id) => {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // A task removed from membership can no longer be the ONE trigger.
    setDependencyId((prev) => (prev === id ? null : prev));
  }, []);

  const toggleDependency = useCallback((id) => {
    setDependencyId((prev) => (prev === id ? null : id));
  }, []);

  const handleRuleChange = useCallback((val) => {
    const nextRule = val || "ALL";
    setRule(nextRule);
    if (nextRule !== "ONE") setDependencyId(null);
  }, []);

  const isValid = useMemo(() => {
    if (memberIds.length === 0) return false;
    if (rule === "ONE" && !dependencyId) return false;
    return true;
  }, [memberIds, rule, dependencyId]);

  const handleSave = useCallback(() => {
    if (!isValid) return;
    onSave({
      id: initialGroup?.id || null,
      NAME: name.trim(),
      memberIds,
      DEPENDENCY_RULE: rule,
      dependencyId: rule === "ONE" ? dependencyId : null,
    });
  }, [isValid, onSave, initialGroup, name, memberIds, rule, dependencyId]);

  if (!open) return null;

  return (
    <PMModal
      open={open}
      onClose={onClose}
      title={initialGroup ? "Edit Task Group" : "Create Task Group"}
      size="lg"
      footer={
        <div className={styles.footerRow}>
          <PMButton variant="outline" onClick={onClose}>Cancel</PMButton>
          <PMButton variant="primary" onClick={handleSave} disabled={!isValid || saving}>
            {saving ? "Saving…" : "Save Changes"}
          </PMButton>
        </div>
      }
    >
      <div className={styles.section}>
        <label className={styles.label}>Group Name</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Foundation Work (optional — defaults to “Group N”)"
        />
      </div>

      <div className={styles.section}>
        <label className={styles.label}>
          Select Tasks <span className={styles.req}>*</span>
        </label>
        <p className={styles.sectionHint}>
          Tasks already assigned to another group are hidden. Selected tasks will run in parallel as one group.
        </p>
        <TaskPickerTable
          tasks={memberCandidates}
          selected={memberIds}
          onToggle={toggleMember}
          multiple
          emptyLabel="No ungrouped tasks available — every task already belongs to a group."
        />
        {memberIds.length === 0 && (
          <span className={styles.fieldError}>Select at least one task to form a group.</span>
        )}
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Dependency Rule</label>
        <PMSelect
          options={DEPENDENCY_RULES}
          value={rule}
          onChange={handleRuleChange}
          size="sm"
        />
        <span className={styles.sectionHint}>{DEPENDENCY_RULE_HELP[rule]}</span>
      </div>

      {rule === "ONE" && (
        <div className={styles.section}>
          <label className={styles.label}>
            Depends On <span className={styles.req}>*</span>
          </label>
          <p className={styles.sectionHint}>
            Select the one task (from those selected above) that must complete before the next task/group can proceed.
          </p>
          <TaskPickerTable
            tasks={dependencyCandidates}
            selected={dependencyId ? [dependencyId] : []}
            onToggle={toggleDependency}
            multiple={false}
            emptyLabel="Select tasks above first."
          />
          {!dependencyId && (
            <span className={styles.fieldError}>Dependency Rule "ONE" requires selecting one task.</span>
          )}
        </div>
      )}
    </PMModal>
  );
}
