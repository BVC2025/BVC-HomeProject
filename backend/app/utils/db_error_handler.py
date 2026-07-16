"""
Shared utility for parsing SQLAlchemy / pymysql IntegrityErrors into
developer-friendly HTTPException responses.

Usage:
    from sqlalchemy.exc import IntegrityError
    from app.utils.db_error_handler import raise_db_error

    try:
        db.add(row)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "create supplier invitation")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "create supplier invitation")
"""

import re
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError


def _parse_integrity_error(orig_str: str) -> dict:
    """
    Parse pymysql IntegrityError original message and return
    a human-readable error dict.
    """
    # 1062 — Duplicate entry 'value' for key 'table.field'
    if "1062" in orig_str or "Duplicate entry" in orig_str:
        value_match = re.search(r"Duplicate entry '([^']+)'", orig_str)
        key_match = re.search(r"for key '([^']+)'", orig_str)
        value = value_match.group(1) if value_match else "this value"
        key = key_match.group(1).split(".")[-1] if key_match else "a unique field"
        return {
            "code": 1062,
            "error": f"Duplicate entry: '{value}' already exists. Check the field: {key}.",
        }

    # 1452 — FK parent missing (child references non-existent parent)
    if "1452" in orig_str or "Cannot add or update a child row" in orig_str:
        col_match = re.search(r"FOREIGN KEY \(`([^`]+)`\)", orig_str)
        ref_match = re.search(r"REFERENCES `([^`]+)`", orig_str)
        fk_col = col_match.group(1) if col_match else "a foreign key field"
        ref_table = ref_match.group(1) if ref_match else "the referenced table"
        return {
            "code": 1452,
            "error": (
                f"The value for '{fk_col}' does not exist in '{ref_table}'. "
                f"Ensure the referenced record exists before saving."
            ),
        }

    # 1451 — FK child exists (parent cannot be deleted)
    if "1451" in orig_str or "Cannot delete or update a parent row" in orig_str:
        ref_match = re.search(r"CONSTRAINT `([^`]+)`", orig_str)
        constraint = ref_match.group(1) if ref_match else "a child table"
        return {
            "code": 1451,
            "error": (
                f"Cannot delete this record because other records depend on it "
                f"(constraint: {constraint}). Remove all child records first."
            ),
        }

    # Generic integrity error
    return {
        "code": 0,
        "error": f"Database constraint violation: {orig_str}",
    }


def raise_db_error(e: Exception, operation: str = "database operation") -> None:
    """
    Raise an HTTPException with a structured, developer-friendly error body.

    Handles:
      - IntegrityError 1062 (Duplicate entry)
      - IntegrityError 1452 (FK parent not found)
      - IntegrityError 1451 (FK child exists — cannot delete parent)
      - All other exceptions (wrapped as 500)

    This function never returns — it always raises.
    """
    if isinstance(e, IntegrityError):
        orig = str(getattr(e, "orig", "") or e)
        parsed = _parse_integrity_error(orig)
        status = 409 if parsed["code"] in (1062, 1451) else 422
        raise HTTPException(
            status_code=status,
            detail={
                "success": False,
                "message": f"Failed to complete: {operation}.",
                "error": parsed["error"],
                "db_error": orig[:300],
            },
        )

    raise HTTPException(
        status_code=500,
        detail={
            "success": False,
            "message": f"Unexpected error during: {operation}.",
            "error": str(e),
        },
    )
