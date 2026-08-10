from sqlalchemy import (
    Column, String, Integer, ForeignKey, DateTime, UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from datetime import datetime
import uuid


class RootUser(Base):
    """
    The account owner for a Vendor/Account — an AWS-root-account-style
    identity. Exactly one per vendor (enforced by the unique index on
    VENDOR_ID). Logs in via POST /root-login (see routes/auth.py) and
    is never subject to permission checks — auth_bearer.require() and
    get_current_admin() short-circuit-allow any token carrying
    principal_type == "ROOT". No DELETE route is exposed for this
    table; only password-reset and profile-field mutations are.
    """

    __tablename__ = "root_user"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", name="uq_root_user_vendor_id"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    EMAIL = Column(String(100), unique=True)

    PASSWORD = Column(String(255))
    # bcrypt only — see app.services.auth_service.hash_password/verify_password.
    # Unlike Employee, RootUser has no legacy plaintext fallback.

    STATUS = Column(String(20), default="ACTIVE")

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID"))

    LAST_LOGIN_AT = Column(DateTime, nullable=True)

    PASSWORD_RESET_TOKEN = Column(String(100), nullable=True)

    PASSWORD_RESET_EXPIRES_AT = Column(DateTime, nullable=True)

    MFA_ENABLED = Column(Integer, default=0)
    # Per-user state flag. No MFA flow is implemented yet — this just
    # reserves the column so enabling it later doesn't need another migration.

    TOKEN_VERSION = Column(Integer, nullable=False, default=1)
    # Same purpose as Employee.TOKEN_VERSION — bumped on password
    # change / STATUS change, checked once per request.

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vendor = relationship("Vendor", back_populates="root_users")


class IAMUser(Base):
    """
    Login credentials (username + password) for an Employee.

    Deliberately thin: profile data, department, and role assignment
    all live on the linked Employee (Employee.ROLE_ID -> Role) so role
    assignment stays in exactly one place. This table exists only to
    hold the IAM-style login identity (USERNAME/PASSWORD) separately
    from the HR record, without duplicating anything HR already owns.
    """

    __tablename__ = "iam_user"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    USERNAME = Column(String(50), unique=True, nullable=False, index=True)

    PASSWORD = Column(String(255), nullable=False)
    # bcrypt only — see app.services.auth_service.hash_password/verify_password.

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID"), nullable=False, index=True)

    STATUS = Column(String(20), default="ACTIVE")
    # ACTIVE / SUSPENDED / RESIGNED / TERMINATED — same convention as Employee.STATUS

    EMPLOYEE_ID = Column(String(36), ForeignKey("employee.ID"), nullable=True, index=True)
    # Links this login identity to its HR record. Role/permissions are
    # resolved by following this FK to Employee.ROLE_ID -> Role — this
    # table does NOT carry its own role/permission columns.

    LAST_LOGIN_AT = Column(DateTime, nullable=True)

    TOKEN_VERSION = Column(Integer, nullable=False, default=1)
    # Same purpose as Employee.TOKEN_VERSION — bumped on password
    # change / STATUS change / role change (via the linked Employee),
    # checked once per request.

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmployeePermissionOverride(Base):
    """
    Per-employee grant/deny exception on top of their Role's default
    permissions. Live current-state table — one row per (EMPLOYEE_ID,
    PERMISSION_ID) pair; update EFFECT to change a decision, don't
    insert a second row for the same pair. History of changes lives
    separately in EmployeePermissionOverrideAudit (append-only).

    Resolution order (see app.services.auth_service): active DENY
    override > active GRANT override > role default > implicit deny.
    Creating/editing a row here requires `permission.override.manage`,
    itself subject to the self-escalation guard (RBAC/IAM-category
    codes can never be granted or denied via this table by anyone but
    Root — see routes/rbac.py).
    """

    __tablename__ = "employee_permission_override"

    __table_args__ = (
        UniqueConstraint("EMPLOYEE_ID", "PERMISSION_ID", name="uq_emp_perm_override"),
    )

    ID = Column(Integer, primary_key=True, autoincrement=True)

    EMPLOYEE_ID = Column(String(36), ForeignKey("employee.ID"), nullable=False, index=True)

    PERMISSION_ID = Column(Integer, ForeignKey("permission.ID"), nullable=False, index=True)

    EFFECT = Column(String(5), nullable=False)
    # "GRANT" or "DENY"

    REASON = Column(String(255), nullable=False)
    # Mandatory — mirrors EmployeeStatusHistory.REASON's precedent for
    # administrative-exception actions.

    GRANTED_BY_ID = Column(String(36), ForeignKey("employee.ID"), nullable=True)

    GRANTED_AT = Column(DateTime, default=datetime.utcnow)

    EXPIRES_AT = Column(DateTime, nullable=True)
    # Optional time-boxing (e.g. temporary cover for someone on leave).

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID"), nullable=False, index=True)


class EmployeePermissionOverrideAudit(Base):
    """
    Append-only history of every change to EmployeePermissionOverride —
    never updated, never deleted. Mirrors this codebase's existing
    live-state-vs-history-log split (compare Employee.STATUS vs. the
    append-only EmployeeStatusHistory).
    """

    __tablename__ = "employee_permission_override_audit"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    EMPLOYEE_ID = Column(String(36), ForeignKey("employee.ID"), nullable=False, index=True)

    PERMISSION_ID = Column(Integer, ForeignKey("permission.ID"), nullable=False, index=True)

    OLD_EFFECT = Column(String(5), nullable=True)
    # NULL if this row records the override's initial creation.

    NEW_EFFECT = Column(String(5), nullable=True)
    # NULL if this row records the override's deletion.

    REASON = Column(String(255), nullable=True)

    CHANGED_BY_ID = Column(String(36), ForeignKey("employee.ID"), nullable=True)

    CHANGED_AT = Column(DateTime, default=datetime.utcnow)

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID"), nullable=False, index=True)
