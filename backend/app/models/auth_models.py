from sqlalchemy import (
    Column, String, Integer, DateTime, UniqueConstraint
)
from app.database.database import Base
from datetime import datetime
import uuid


class RefreshToken(Base):
    """
    One row per issued refresh token. PRINCIPAL_TYPE + PRINCIPAL_ID is a
    loose, type-agnostic reference (no FK) — mirrors the existing
    AuditLog.USER_ID pattern already used in this codebase — because a
    refresh token can belong to any of three separate identity tables
    (Employee, RootUser, IAMUser).

    Rotation: each POST /auth/refresh revokes the presented row
    (ROTATED_AT set, REPLACED_BY_ID points at the new row) and inserts
    a fresh one. A presented token whose row already has ROTATED_AT or
    REVOKED_AT set is a reuse/theft signal — see routes/auth.py.
    """

    __tablename__ = "refresh_token"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    PRINCIPAL_TYPE = Column(String(10), nullable=False, index=True)
    # "EMPLOYEE" / "ROOT" / "IAM"

    PRINCIPAL_ID = Column(String(36), nullable=False, index=True)

    TOKEN_HASH = Column(String(64), unique=True, nullable=False, index=True)
    # sha256 hex digest of the raw opaque token. Never store the raw
    # token itself. Not bcrypt — a refresh token is high-entropy, so a
    # deterministic hash allows a direct indexed lookup (bcrypt's
    # random per-hash salt would force an unindexed table scan).

    ISSUED_AT = Column(DateTime, default=datetime.utcnow)

    EXPIRES_AT = Column(DateTime, nullable=False, index=True)

    ROTATED_AT = Column(DateTime, nullable=True)

    REPLACED_BY_ID = Column(String(36), nullable=True)

    REVOKED_AT = Column(DateTime, nullable=True)

    REVOKED_REASON = Column(String(30), nullable=True)
    # LOGOUT / ROTATED / PASSWORD_CHANGE / STATUS_CHANGE / REUSE_DETECTED

    IP_ADDRESS = Column(String(45), nullable=True)

    USER_AGENT = Column(String(500), nullable=True)

    VENDOR_ID = Column(Integer, nullable=True, index=True)


class LoginLockout(Base):
    """
    Simple brute-force guard, one row per login-identifying principal
    (looked up the same way find_employee_by_login/etc. already
    resolve an identifier, before the password check runs). No IP
    tracking, no gateway/rate-limiter — appropriate for a small
    internal tool where the real risk is a guessed/leaked single
    password, not distributed credential stuffing.
    """

    __tablename__ = "login_lockout"

    __table_args__ = (
        UniqueConstraint("PRINCIPAL_TYPE", "PRINCIPAL_ID", name="uq_login_lockout_principal"),
    )

    ID = Column(Integer, primary_key=True, autoincrement=True)

    PRINCIPAL_TYPE = Column(String(10), nullable=False, index=True)

    PRINCIPAL_ID = Column(String(36), nullable=False, index=True)

    FAILED_COUNT = Column(Integer, nullable=False, default=0)

    LAST_FAILED_AT = Column(DateTime, nullable=True)

    LOCKED_UNTIL = Column(DateTime, nullable=True)
