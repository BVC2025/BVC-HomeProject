"""Task dependency graph validation and evaluation.

`can_task_start()` is deliberately a PURE function, not a live engine: this
codebase has no task-instance/status pipeline linked to TaskTemplate today
(Task/TaskAssignment have no FK to Project/TaskTemplate at all — confirmed
absent, same gap already documented for Auto Task Assignment and Payment
Milestones' completion tracking). This function is correct and fully
testable against a caller-supplied status mapping, ready to be wired into
a future task-generation/execution engine without fabricating a live
status source that doesn't exist yet.
"""

from typing import Dict, Iterable, List

from fastapi import HTTPException
from sqlalchemy.orm import Session


def detect_cycle(edges: Dict[str, List[str]]) -> bool:
    """Plain DFS cycle detector over an in-memory adjacency map
    (task_id -> [depends_on_task_ids]). Returns True if any cycle exists,
    including a task depending on itself (a self-loop is a 1-node cycle)."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {node: WHITE for node in edges}

    def visit(node: str) -> bool:
        color[node] = GRAY
        for neighbor in edges.get(node, []):
            neighbor_color = color.get(neighbor, WHITE)
            if neighbor_color == GRAY:
                return True
            if neighbor_color == WHITE and visit(neighbor):
                return True
        color[node] = BLACK
        return False

    for node in list(edges.keys()):
        if color[node] == WHITE:
            if visit(node):
                return True
    return False


def validate_no_cycle(db: Session, project_id: str, task_id: str, depends_on_ids: Iterable[str]):
    """Loads the project's EXISTING dependency edges, overlays the proposed
    edges for `task_id` (replacing whatever it currently has), and raises
    HTTPException(400) if the resulting graph contains a cycle."""
    from app.models.models import TaskTemplate, TaskTemplateDependency

    task_ids = {
        row[0] for row in db.query(TaskTemplate.ID).filter(TaskTemplate.PROJECT_ID == project_id).all()
    }
    edges: Dict[str, List[str]] = {tid: [] for tid in task_ids}
    existing = (
        db.query(TaskTemplateDependency)
        .filter(TaskTemplateDependency.TASK_TEMPLATE_ID.in_(task_ids))
        .all()
    )
    for dep in existing:
        if dep.TASK_TEMPLATE_ID != task_id:  # this task's edges are being replaced below
            edges.setdefault(dep.TASK_TEMPLATE_ID, []).append(dep.DEPENDS_ON_TASK_TEMPLATE_ID)

    edges[task_id] = list(depends_on_ids)

    if detect_cycle(edges):
        raise HTTPException(
            status_code=400,
            detail="This dependency configuration would create a circular chain "
                   "(e.g. Task A depends on Task B, which depends back on Task A).",
        )


def validate_same_project(db: Session, project_id: str, depends_on_ids: Iterable[str]):
    """Confirms every referenced task belongs to the same project — a task
    must not depend on an unrelated task from another project."""
    from app.models.models import TaskTemplate

    depends_on_ids = list(depends_on_ids)
    if not depends_on_ids:
        return
    rows = db.query(TaskTemplate.ID, TaskTemplate.PROJECT_ID).filter(TaskTemplate.ID.in_(depends_on_ids)).all()
    found = {row[0]: row[1] for row in rows}
    for dep_id in depends_on_ids:
        if dep_id not in found:
            raise HTTPException(status_code=404, detail=f"Dependency task {dep_id} not found")
        if found[dep_id] != project_id:
            raise HTTPException(
                status_code=400,
                detail="A task cannot depend on a task from a different project.",
            )


def can_task_start(task_template_id: str, status_by_task_id: Dict[str, str], db: Session = None,
                    *, dependency_rule: str = None, depends_on_ids: Iterable[str] = None) -> bool:
    """Pure evaluation of TaskTemplate.DEPENDENCY_RULE against a
    caller-supplied {task_id: status} mapping — no dependencies at all
    means the task can start immediately. Callers may either pass `db` (to
    load the task's real DEPENDENCY_RULE/dependency rows) or, for unit
    testing, pass `dependency_rule`/`depends_on_ids` directly."""
    if depends_on_ids is None or dependency_rule is None:
        from app.models.models import TaskTemplate, TaskTemplateDependency

        task = db.query(TaskTemplate).filter(TaskTemplate.ID == task_template_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        dependency_rule = task.DEPENDENCY_RULE
        depends_on_ids = [
            row[0] for row in db.query(TaskTemplateDependency.DEPENDS_ON_TASK_TEMPLATE_ID)
            .filter(TaskTemplateDependency.TASK_TEMPLATE_ID == task_template_id).all()
        ]

    depends_on_ids = list(depends_on_ids)
    if not depends_on_ids:
        return True

    completed = [status_by_task_id.get(dep_id) == "COMPLETED" for dep_id in depends_on_ids]
    if dependency_rule == "ANY":
        return any(completed)
    return all(completed)  # ALL (and the default)
