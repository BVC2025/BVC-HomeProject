"""
Stage Auto-Unlock Service
-------------------------

When an employee marks a manufacturing stage COMPLETED on a Work Order,
this service is responsible for advancing the WO's pipeline:

    1. Look up the next ProcessStage (by SEQUENCE) on the same WO.
    2. Gate-check: every earlier stage on the WO must also be COMPLETED.
       (Belt-and-suspenders — even if the caller passes the wrong
       sequence number, we won't unlock out of order.)
    3. Skill-match an employee to that next stage and stamp it onto
       the WorkOrderStageProgress row as ASSIGNED_TO_ID. STATUS stays
       PENDING — the employee still has to hit "Start" from their
       dashboard.

Pure service module — no FastAPI imports. Callers (route handlers,
background workers, retry jobs) own their own DB session.
"""

from datetime import datetime
from typing import Optional, Dict, Any

from sqlalchemy.orm import Session

from app.models.models import (
    WorkOrder,
    WorkOrderStageProgress,
    ProcessStage,
    Employee,
)

from app.services.project_from_product_service import find_best_employee


# Status constants — matches the values written elsewhere in the
# codebase (see WorkOrderStageProgress.STATUS comments in models.py:
# PENDING / IN_PROGRESS / DONE / FAILED / SKIPPED). The task spec uses
# "COMPLETED" terminology; the ERP itself uses "DONE". We accept both
# so this service is robust whether the route hands us either token.
_PENDING = "PENDING"
_COMPLETED_TOKENS = {"COMPLETED", "DONE"}


def _is_completed(status: Optional[str]) -> bool:
    """Return True if the given status string represents a finished
    stage. Accepts both 'COMPLETED' (task-spec wording) and 'DONE'
    (existing codebase wording)."""

    if not status:
        return False

    return status.strip().upper() in _COMPLETED_TOKENS


def unlock_next_stage(
    db: Session,
    wo_id: int,
    completed_stage_seq: int,
) -> Dict[str, Any]:
    """
    Advance the Work Order's pipeline by one stage.

    Finds the WorkOrderStageProgress row whose joined ProcessStage has
    SEQUENCE == completed_stage_seq + 1, gates on all earlier stages
    being COMPLETED, and (if so) skill-matches an employee onto the
    row. STATUS is left at PENDING so the assignee must explicitly
    "Start" from their dashboard.

    Args:
        db: active SQLAlchemy session.
        wo_id: WorkOrder.ID we're advancing.
        completed_stage_seq: SEQUENCE of the stage that was just
            marked done.

    Returns a dict shaped:
        {
          "unlocked": bool,
          "next_stage": {
            "ID": int,
            "NAME": str,
            "SEQUENCE": int,
            "ASSIGNED_TO_ID": str | None,
            "ASSIGNED_TO_NAME": str | None,
          } | None,
          "reason": str,
        }
    """

    # ---- Defensive input checks -----------------------------------
    if db is None:
        return {
            "unlocked": False,
            "next_stage": None,
            "reason": "DB session is None",
        }

    if wo_id is None:
        return {
            "unlocked": False,
            "next_stage": None,
            "reason": "wo_id is None",
        }

    if completed_stage_seq is None:
        return {
            "unlocked": False,
            "next_stage": None,
            "reason": "completed_stage_seq is None",
        }

    next_seq = completed_stage_seq + 1

    # ---- 1. Find next stage progress row by SEQUENCE --------------
    # Join wo_stage_progress -> process_stage and filter by WO_ID +
    # the next sequence number. There should be at most one such row
    # because (WORK_ORDER_ID, STAGE_ID) is unique and ProcessStage
    # sequences are unique per ProductModel under normal seeding.
    row_pair = (
        db.query(WorkOrderStageProgress, ProcessStage)
        .join(
            ProcessStage,
            WorkOrderStageProgress.STAGE_ID == ProcessStage.ID,
        )
        .filter(
            WorkOrderStageProgress.WORK_ORDER_ID == wo_id,
            ProcessStage.SEQUENCE == next_seq,
        )
        .first()
    )

    if not row_pair:
        # No stage with sequence = completed+1 → we just finished the
        # last stage in the pipeline.
        return {
            "unlocked": False,
            "next_stage": None,
            "reason": "Final stage reached",
        }

    next_progress, next_stage = row_pair

    if next_progress is None or next_stage is None:
        return {
            "unlocked": False,
            "next_stage": None,
            "reason": "Final stage reached",
        }

    # ---- 2. Gate: all earlier stages must be COMPLETED ------------
    # Even if a route mistakenly hands us a stale sequence, we won't
    # leapfrog over an incomplete earlier stage.
    earlier_rows = (
        db.query(WorkOrderStageProgress, ProcessStage)
        .join(
            ProcessStage,
            WorkOrderStageProgress.STAGE_ID == ProcessStage.ID,
        )
        .filter(
            WorkOrderStageProgress.WORK_ORDER_ID == wo_id,
            ProcessStage.SEQUENCE < next_seq,
        )
        .all()
    )

    for prog, _stg in earlier_rows:
        if prog is None:
            continue
        if not _is_completed(prog.STATUS):
            return {
                "unlocked": False,
                "next_stage": None,
                "reason": (
                    "Earlier stage not completed "
                    f"(progress_id={prog.ID}, status={prog.STATUS})"
                ),
            }

    # ---- 3. Short-circuit if the next row isn't fresh PENDING -----
    if next_progress.STATUS != _PENDING:
        return {
            "unlocked": False,
            "next_stage": _serialize_next(next_progress, next_stage, db),
            "reason": "Already started or done",
        }

    # ---- 4. Short-circuit if it already has an assignee -----------
    # Keep whoever is on it; just report success.
    if next_progress.ASSIGNED_TO_ID:
        return {
            "unlocked": True,
            "next_stage": _serialize_next(next_progress, next_stage, db),
            "reason": "Already assigned",
        }

    # ---- 5. Skill-match an employee to the stage ------------------
    # We need vendor_id (and ideally department) to scope the search.
    # Pull it off the WorkOrder. Both fields are nullable in practice,
    # so guard accordingly.
    work_order = (
        db.query(WorkOrder).filter(WorkOrder.ID == wo_id).first()
    )

    vendor_id = getattr(work_order, "VENDOR_ID", None) if work_order else None

    stage_kw = (next_stage.STAGE_TYPE or "").strip().lower()

    best_emp = None

    if vendor_id is not None:
        # find_best_employee(db, required_skills, vendor_id,
        #                    department_id=None, exclude_employee_ids=None)
        # → returns (Employee | None, score)
        try:
            best_emp, _score = find_best_employee(
                db,
                required_skills=stage_kw,
                vendor_id=vendor_id,
            )
        except Exception:
            # Skill matcher must never break the unlock flow — fall
            # back to "unlocked but unassigned" if anything goes wrong.
            best_emp = None

    if best_emp is None:
        # No suitable employee found. We still "unlock" the row in the
        # sense that the gate is satisfied, but nobody is on it yet —
        # an admin can manually reassign from the dashboard.
        return {
            "unlocked": True,
            "next_stage": _serialize_next(next_progress, next_stage, db),
            "reason": "Unlocked but no skill match found",
        }

    # ---- 6. Stamp the assignee onto the row (STATUS stays PENDING) -
    next_progress.ASSIGNED_TO_ID = best_emp.ID
    # STATUS deliberately left at PENDING; touch UPDATED_AT so the
    # dashboard sees the change immediately.
    next_progress.UPDATED_AT = datetime.utcnow()

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        return {
            "unlocked": False,
            "next_stage": None,
            "reason": f"DB commit failed: {exc!r}",
        }

    db.refresh(next_progress)

    return {
        "unlocked": True,
        "next_stage": _serialize_next(next_progress, next_stage, db),
        "reason": "Auto-assigned to skill-matched employee",
    }


def handle_stage_completed(
    db: Session,
    wo_stage_progress_id: int,
) -> Dict[str, Any]:
    """
    Entry point called by the route that flips a WorkOrderStageProgress
    row to COMPLETED. Does the COMPLETED_AT bookkeeping and then asks
    `unlock_next_stage` to advance the pipeline.

    Returns:
        {
          "stage_id": int | None,
          "wo_id": int | None,
          "unlocked": bool,
          "next_stage": {...} | None,
          "reason": str,
        }
    """

    if db is None:
        return {
            "stage_id": None,
            "wo_id": None,
            "unlocked": False,
            "next_stage": None,
            "reason": "DB session is None",
        }

    if wo_stage_progress_id is None:
        return {
            "stage_id": None,
            "wo_id": None,
            "unlocked": False,
            "next_stage": None,
            "reason": "wo_stage_progress_id is None",
        }

    # ---- Load the progress row ------------------------------------
    row = (
        db.query(WorkOrderStageProgress)
        .filter(WorkOrderStageProgress.ID == wo_stage_progress_id)
        .first()
    )

    if row is None:
        return {
            "stage_id": None,
            "wo_id": None,
            "unlocked": False,
            "next_stage": None,
            "reason": "Progress row not found",
        }

    # ---- Status sanity check --------------------------------------
    if not _is_completed(row.STATUS):
        return {
            "stage_id": row.STAGE_ID,
            "wo_id": row.WORK_ORDER_ID,
            "unlocked": False,
            "next_stage": None,
            "reason": "Row not COMPLETED",
        }

    # ---- Backfill COMPLETED_AT if the caller forgot ---------------
    if row.COMPLETED_AT is None:
        row.COMPLETED_AT = datetime.utcnow()
        try:
            db.commit()
        except Exception:
            db.rollback()
            # Not fatal — continue to attempt unlock anyway.

    # ---- Resolve sequence + WO from the joined ProcessStage -------
    stage = (
        db.query(ProcessStage)
        .filter(ProcessStage.ID == row.STAGE_ID)
        .first()
    )

    if stage is None:
        return {
            "stage_id": row.STAGE_ID,
            "wo_id": row.WORK_ORDER_ID,
            "unlocked": False,
            "next_stage": None,
            "reason": "ProcessStage not found",
        }

    sequence = stage.SEQUENCE
    wo_id = row.WORK_ORDER_ID

    if sequence is None or wo_id is None:
        return {
            "stage_id": row.STAGE_ID,
            "wo_id": wo_id,
            "unlocked": False,
            "next_stage": None,
            "reason": "Missing SEQUENCE or WORK_ORDER_ID on completed row",
        }

    # ---- Delegate to the unlock helper ----------------------------
    unlock_result = unlock_next_stage(db, wo_id, sequence)

    return {
        "stage_id": row.STAGE_ID,
        "wo_id": wo_id,
        **unlock_result,
    }


# --------------------------------------------------------------------
# Internal helpers
# --------------------------------------------------------------------

def _serialize_next(
    progress: WorkOrderStageProgress,
    stage: ProcessStage,
    db: Session,
) -> Optional[Dict[str, Any]]:
    """Build the `next_stage` sub-dict used in every return shape.
    Pulls the assignee's NAME on demand (separate query — cheaper than
    a join we'd do for every call)."""

    if progress is None or stage is None:
        return None

    assignee_name = None

    if progress.ASSIGNED_TO_ID:
        emp = (
            db.query(Employee)
            .filter(Employee.ID == progress.ASSIGNED_TO_ID)
            .first()
        )
        assignee_name = getattr(emp, "NAME", None) if emp else None

    return {
        "ID": stage.ID,
        "NAME": stage.STAGE_NAME,
        "SEQUENCE": stage.SEQUENCE,
        "ASSIGNED_TO_ID": progress.ASSIGNED_TO_ID,
        "ASSIGNED_TO_NAME": assignee_name,
    }
