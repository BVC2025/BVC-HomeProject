"""
Audit Log viewer — Phase 3 security.

Admin-only endpoint to read the audit_log table written by
AuditMiddleware. Supports filtering by user, target, action,
status code, and date range. Newest-first, paginated.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import AuditLog
from app.auth.auth_bearer import get_current_admin


router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


def _serialize(row: AuditLog) -> dict:
    return {
        "ID":          row.ID,
        "USER_ID":     row.USER_ID,
        "USER_CODE":   row.USER_CODE,
        "USER_NAME":   row.USER_NAME,
        "USER_ROLE":   row.USER_ROLE,
        "METHOD":      row.METHOD,
        "PATH":        row.PATH,
        "TARGET_TYPE": row.TARGET_TYPE,
        "TARGET_ID":   row.TARGET_ID,
        "STATUS_CODE": row.STATUS_CODE,
        "IP_ADDRESS":  row.IP_ADDRESS,
        "USER_AGENT":  row.USER_AGENT,
        "CREATED_AT":  row.CREATED_AT.isoformat() if row.CREATED_AT else None,
    }


@router.get("", dependencies=[Depends(get_current_admin)])
def list_audit_logs(
    user_id:      Optional[str] = Query(None, description="Filter by USER_ID (employee UUID)"),
    user_code:    Optional[str] = Query(None, description="Filter by USER_CODE (e.g. EMP101)"),
    role:         Optional[str] = Query(None, description="Filter by USER_ROLE"),
    method:       Optional[str] = Query(None, description="Filter by HTTP method"),
    target_type:  Optional[str] = Query(None, description="Filter by TARGET_TYPE (e.g. LEAVE, MEMO)"),
    target_id:    Optional[str] = Query(None, description="Filter by TARGET_ID"),
    status_code:  Optional[int] = Query(None, description="Filter by HTTP status code"),
    failures_only: bool          = Query(False, description="Only show 4xx/5xx responses"),
    path_contains: Optional[str] = Query(None, description="Substring match on PATH"),
    since_hours:  Optional[int]  = Query(None, ge=1, le=720, description="Only rows from last N hours (max 720)"),
    limit:        int            = Query(100, ge=1, le=1000),
    offset:       int            = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List recent audit-log entries with filters.

    Newest entries first. Use `failures_only=true` for the security
    feed (login attempts, permission denials). `since_hours=24`
    gives "yesterday and today" view.
    """

    q = db.query(AuditLog)

    if user_id:       q = q.filter(AuditLog.USER_ID == user_id)
    if user_code:     q = q.filter(AuditLog.USER_CODE == user_code.upper())
    if role:          q = q.filter(AuditLog.USER_ROLE == role.upper())
    if method:        q = q.filter(AuditLog.METHOD == method.upper())
    if target_type:   q = q.filter(AuditLog.TARGET_TYPE == target_type.upper())
    if target_id:     q = q.filter(AuditLog.TARGET_ID == str(target_id))
    if status_code:   q = q.filter(AuditLog.STATUS_CODE == int(status_code))
    if failures_only: q = q.filter(AuditLog.STATUS_CODE >= 400)
    if path_contains: q = q.filter(AuditLog.PATH.like(f"%{path_contains}%"))
    if since_hours:
        cutoff = datetime.utcnow() - timedelta(hours=since_hours)
        q = q.filter(AuditLog.CREATED_AT >= cutoff)

    total = q.count()

    rows = (
        q.order_by(AuditLog.ID.desc())
         .offset(offset)
         .limit(limit)
         .all()
    )

    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "rows":   [_serialize(r) for r in rows],
    }


@router.get("/stats", dependencies=[Depends(get_current_admin)])
def audit_stats(
    since_hours: int = Query(24, ge=1, le=720),
    db: Session = Depends(get_db),
):
    """Headline counts for an admin dashboard tile.

    Returns:
      total:        rows in the window
      mutations:    POST + PUT + PATCH + DELETE
      failures:     status_code >= 400
      auth_failures: status_code == 401 or 403
      unique_users: distinct USER_ID with at least one row
    """

    from sqlalchemy import func, distinct

    cutoff = datetime.utcnow() - timedelta(hours=since_hours)
    base = db.query(AuditLog).filter(AuditLog.CREATED_AT >= cutoff)

    total          = base.count()
    failures       = base.filter(AuditLog.STATUS_CODE >= 400).count()
    auth_failures  = base.filter(AuditLog.STATUS_CODE.in_([401, 403])).count()
    unique_users   = base.filter(AuditLog.USER_ID.isnot(None)).with_entities(
        func.count(distinct(AuditLog.USER_ID))
    ).scalar() or 0

    return {
        "window_hours":   since_hours,
        "total":          total,
        "failures":       failures,
        "auth_failures":  auth_failures,
        "unique_users":   int(unique_users),
    }
