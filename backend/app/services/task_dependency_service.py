"""Task Group dependency evaluation.

A TaskGroup's DEPENDENCY_RULE (ALL/ANY/ONE) describes how its OWN member
tasks gate the next task/group in sequence — there is no external
"depends on another group" concept, so there is no dependency graph to
validate and no cycle detection is needed: a group's only possible
dependency target (DEPENDS_ON_TASK_TEMPLATE_ID, used only when
DEPENDENCY_RULE == "ONE") is always one of its own members, which is
enforced at the point of assignment in project_template.py.

`can_task_start()` is deliberately a PURE function, not a live engine:
this codebase has no task-instance/status pipeline linked to TaskTemplate
today (Task/TaskAssignment have no FK to Project/TaskTemplate at all —
confirmed absent, same gap already documented for Auto Task Assignment
and Payment Milestones' completion tracking). This function is correct
and fully testable against a caller-supplied status mapping, ready to be
wired into a future task-generation/execution engine without fabricating
a live status source that doesn't exist yet.
"""

from typing import Dict, Iterable


def can_task_start(dependency_rule: str, member_task_ids: Iterable[str],
                    status_by_task_id: Dict[str, str],
                    depends_on_task_id: str = None) -> bool:
    """Pure evaluation of a TaskGroup's own exit/gating condition against a
    caller-supplied {task_id: status} mapping — whether the group's
    completion criterion is satisfied, so whatever comes next in sequence
    may proceed:

      - ALL: every member task must be COMPLETED.
      - ANY: at least one member task must be COMPLETED.
      - ONE: the specific `depends_on_task_id` member must be COMPLETED.

    A group with no members can always proceed (nothing to wait on)."""
    member_task_ids = list(member_task_ids)
    if not member_task_ids:
        return True

    if dependency_rule == "ONE":
        if not depends_on_task_id:
            return False
        return status_by_task_id.get(depends_on_task_id) == "COMPLETED"

    completed = [status_by_task_id.get(tid) == "COMPLETED" for tid in member_task_ids]
    if dependency_rule == "ANY":
        return any(completed)
    return all(completed)  # ALL (and the default)
