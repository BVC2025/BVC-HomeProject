"""
Audit Log Service — Phase 3 security.

Writes one row per state-changing HTTP request to the `audit_log`
table. Imported by AuditMiddleware in main.py and by the
/audit-logs admin viewer.

Design notes
------------
- READ-ONLY (GET) requests are not logged. Mutations only.
- Failed requests (4xx/5xx) ARE logged — those are the most
  interesting forensically.
- Writes use a fresh SessionLocal so the middleware can't be
  blocked by the request's own DB session lifecycle.
- Failures are swallowed silently — audit must never break the
  underlying request.
- Sensitive request bodies (passwords, tokens) are intentionally
  NOT captured. URL path and method are enough to know WHAT
  happened; the row's CURRENT state in the actual table tells
  you the result.
"""

import re
from typing import Optional

from app.database.database import SessionLocal
from app.models.models import AuditLog
from app.auth.jwt_handler import verify_token


# Skip these — too noisy, never a write
_SKIP_PATH_PREFIXES = (
    "/static/",
    "/docs",
    "/openapi.json",
    "/favicon.ico",
    "/chat/health",
    "/chat/suggestions",
)

# Skip these methods (read-only, no state change)
_SKIP_METHODS = {"GET", "HEAD", "OPTIONS"}


def should_audit(method: str, path: str) -> bool:
    """True if this request should produce an audit_log row."""

    if (method or "").upper() in _SKIP_METHODS:
        return False

    p = path or ""
    for prefix in _SKIP_PATH_PREFIXES:
        if p.startswith(prefix):
            return False

    return True


# Each entry: (regex on path, TARGET_TYPE label).
# Order matters — first match wins. Place specific rules above generic.
_TARGET_PATTERNS = [
    # HR
    (re.compile(r"^/employees/by-code/([^/]+)/submit-profile"), "EMPLOYEE", 1),
    (re.compile(r"^/employees/by-code/([^/]+)"),                "EMPLOYEE", 1),
    (re.compile(r"^/employees/([^/]+)/documents/(\d+)"),        "DOCUMENT", 2),
    (re.compile(r"^/employees/([^/]+)/documents"),              "EMPLOYEE", 1),
    (re.compile(r"^/employees/([^/]+)/upload-photo"),           "EMPLOYEE", 1),
    (re.compile(r"^/employees/([^/]+)/reset-password"),         "EMPLOYEE", 1),
    (re.compile(r"^/employees/([^/]+)"),                        "EMPLOYEE", 1),
    (re.compile(r"^/update-employee/([^/]+)"),                  "EMPLOYEE", 1),
    (re.compile(r"^/delete-employee/([^/]+)"),                  "EMPLOYEE", 1),

    # Memos
    (re.compile(r"^/memos/(\d+)/acknowledge"),  "MEMO",     1),
    (re.compile(r"^/memos/(\d+)/close"),        "MEMO",     1),
    (re.compile(r"^/memos/(\d+)/cancel"),       "MEMO",     1),
    (re.compile(r"^/memos/(\d+)"),              "MEMO",     1),
    (re.compile(r"^/memos/employee/([^/]+)"),   "EMPLOYEE", 1),

    # Leave
    (re.compile(r"^/leave/decide/([^/?]+)"),    "LEAVE_TOKEN", 1),
    (re.compile(r"^/leave/(\d+)/approve"),      "LEAVE",    1),
    (re.compile(r"^/leave/(\d+)/reject"),       "LEAVE",    1),
    (re.compile(r"^/leave/(\d+)/cancel"),       "LEAVE",    1),
    (re.compile(r"^/leave/balance/([^/]+)"),    "EMPLOYEE", 1),
    (re.compile(r"^/leave/dashboard-summary/([^/]+)"), "EMPLOYEE", 1),
    (re.compile(r"^/leave/quota-policies/(\d+)"), "LEAVE_POLICY", 1),
    (re.compile(r"^/leave/quota-policies/resolve/([^/]+)"), "EMPLOYEE", 1),

    # Attendance
    (re.compile(r"^/attendance/(\d+)"),         "ATTENDANCE", 1),
    (re.compile(r"^/check-in"),                 "ATTENDANCE", None),
    (re.compile(r"^/check-out"),                "ATTENDANCE", None),
    (re.compile(r"^/mark-absent"),              "ATTENDANCE", None),

    # Geofence
    (re.compile(r"^/geofence/security-logs/(\d+)"), "SECURITY_LOG", 1),
    (re.compile(r"^/geofence/settings"),            "GEOFENCE_SETTINGS", None),

    # Tasks
    (re.compile(r"^/task-assignment/(\d+)/accept"), "TASK", 1),
    (re.compile(r"^/task-assignment/(\d+)/reject"), "TASK", 1),
    (re.compile(r"^/task-assignment/(\d+)/status"), "TASK", 1),
    (re.compile(r"^/task-assignment/(\d+)"),        "TASK", 1),

    # Onboarding
    (re.compile(r"^/employee-onboarding/sessions/(\d+)/approve"),    "ONBOARDING_SESSION", 1),
    (re.compile(r"^/employee-onboarding/sessions/(\d+)/reject"),     "ONBOARDING_SESSION", 1),
    (re.compile(r"^/employee-onboarding/sessions/(\d+)/resend-link"), "ONBOARDING_SESSION", 1),
    (re.compile(r"^/employee-onboarding/sessions/(\d+)"),            "ONBOARDING_SESSION", 1),
    (re.compile(r"^/employee-onboarding/([^/]+)/submit-form"),       "ONBOARDING_TOKEN", 1),
    (re.compile(r"^/employee-onboarding/([^/]+)/login"),             "ONBOARDING_TOKEN", 1),

    # Auth
    (re.compile(r"^/admin-login"),    "AUTH", None),
    (re.compile(r"^/employee-login"), "AUTH", None),
    (re.compile(r"^/employee-logout"), "AUTH", None),
]


def _extract_target(path: str) -> tuple[Optional[str], Optional[str]]:
    """Return (target_type, target_id) from a URL path using the
    pattern table above. Returns (None, None) on no match."""

    if not path:
        return (None, None)

    for pattern, label, group in _TARGET_PATTERNS:
        m = pattern.match(path)
        if m:
            target_id = m.group(group) if group else None
            return (label, target_id)

    return (None, None)


def _extract_user_from_auth(auth_header: Optional[str]) -> dict:
    """Best-effort decode of the Authorization header. Returns an
    empty dict when missing or invalid — we don't 401 here, we
    just log the row as anonymous."""

    if not auth_header:
        return {}

    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return {}

    payload = verify_token(parts[1])
    return payload or {}


def write_audit_row(
    *,
    method: str,
    path: str,
    status_code: int,
    auth_header: Optional[str],
    client_ip: Optional[str],
    user_agent: Optional[str],
) -> None:
    """Write one AuditLog row. Never raises — audit failures must
    not break the original request."""

    db = None
    try:
        user = _extract_user_from_auth(auth_header)
        target_type, target_id = _extract_target(path)

        db = SessionLocal()
        row = AuditLog(
            USER_ID     = (user.get("employee_id") or None),
            USER_CODE   = (user.get("code") or None),
            USER_ROLE   = (user.get("role") or None),
            USER_NAME   = (user.get("name") or None),
            METHOD      = (method or "")[:10],
            PATH        = (path or "")[:500],
            TARGET_TYPE = target_type,
            TARGET_ID   = (str(target_id)[:100] if target_id else None),
            STATUS_CODE = int(status_code) if status_code else 0,
            IP_ADDRESS  = (client_ip or "")[:45] or None,
            USER_AGENT  = (user_agent or "")[:500] or None,
        )
        db.add(row)
        db.commit()
    except Exception as e:
        # Swallow — audit must never break the underlying request.
        try:
            if db is not None:
                db.rollback()
        except Exception:
            pass
        # Print so it shows up in dev logs but doesn't propagate.
        print(f"[audit] write failed: {type(e).__name__}: {e}")
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
