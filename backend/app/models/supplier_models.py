from sqlalchemy import (
    Column, String, Integer, ForeignKey, Float, Date,
    Text, UniqueConstraint, DateTime, Boolean, Numeric, JSON, Index,
    Enum as SAEnum
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from datetime import datetime
import uuid

# ──────────────────────────────────────────────
# Module-level Enum types (names must NOT clash with models.py or inventory_models.py)
# ──────────────────────────────────────────────

SUPPLIER_INVITATION_STATUS_ENUM = SAEnum(
    "OPEN", "DRAFT_SAVED", "SUBMITTED", "UNDER_REVIEW",
    "APPROVED", "REJECTED", "EXPIRED",
    name="supplier_invitation_status_enum", create_constraint=True
)


# ──────────────────────────────────────────────────────────────────────
# Supplier master — moved from models.py
# ──────────────────────────────────────────────────────────────────────
class Supplier(Base):
    """
    Supplier master — companies BVC24 buys raw materials,
    components or services from. Distinct from `Vendor`, which
    in this codebase represents the *tenant* (BVC24 itself).

    Mirrors Employee master: full contact + KYC details so PO
    workflow doesn't need to re-prompt. One row per supplier,
    scoped to a tenant via VENDOR_ID.
    """

    __tablename__ = "supplier"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "SUPPLIER_CODE",
            name="uq_supplier_vendor_code"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SUPPLIER_CODE = Column(
        String(30),
        index=True
    )
    # short SKU-style code per tenant, e.g. "SUP-SHEET-01"

    COMPANY_NAME = Column(String(150))

    CONTACT_PERSON = Column(String(100), nullable=True)

    PHONE = Column(String(30), nullable=True)

    EMAIL = Column(String(120), nullable=True)

    ADDRESS_LINE1 = Column(String(200), nullable=True)

    ADDRESS_LINE2 = Column(String(200), nullable=True)

    CITY = Column(String(80), nullable=True)

    STATE = Column(String(80), nullable=True)

    PINCODE = Column(String(15), nullable=True)

    GST_NUMBER = Column(String(20), nullable=True, index=True)

    PAN_NUMBER = Column(String(15), nullable=True)

    BANK_NAME = Column(String(100), nullable=True)

    ACCOUNT_NUMBER = Column(String(40), nullable=True)

    IFSC_CODE = Column(String(20), nullable=True)

    CATEGORY = Column(String(60), nullable=True, index=True)
    # e.g. "Sheet Metal", "Electronics", "Motors", "Display",
    # "Payment Hardware", "Refrigeration", "Packaging"

    PAYMENT_TERMS = Column(String(60), nullable=True)
    # e.g. "NET 30", "Advance 50%", "COD"

    STATUS = Column(
        String(20),
        default="ACTIVE"
    )
    # ACTIVE / INACTIVE / BLACKLISTED

    NOTES = Column(String(500), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


# ──────────────────────────────────────────────────────────────────────
# Table 1: SupplierInvitation
# Admin creates one row per invitation link. TOKEN is the secret that
# the supplier uses to access the public registration endpoint —
# no ERP login required.
# ──────────────────────────────────────────────────────────────────────
class SupplierInvitation(Base):
    __tablename__ = "supplier_invitation"

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    # secrets.token_urlsafe(48) → 64-char URL-safe string
    TOKEN = Column(String(64), nullable=False, unique=True, index=True)

    INVITED_EMAIL = Column(String(150), nullable=True)
    INVITED_PHONE = Column(String(30), nullable=True)
    INVITED_COMPANY_NAME = Column(String(150), nullable=True)

    STATUS = Column(
        SUPPLIER_INVITATION_STATUS_ENUM,
        default="OPEN", index=True
    )

    # Set to the new Supplier.ID when the invitation is approved
    SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

    CREATED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True
    )

    APPROVED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True
    )

    APPROVED_AT = Column(DateTime, nullable=True)
    REJECTED_AT = Column(DateTime, nullable=True)
    REJECTION_REASON = Column(Text, nullable=True)
    SUBMITTED_AT = Column(DateTime, nullable=True)
    EXPIRES_AT = Column(DateTime, nullable=True)
    EMAIL_SENT_AT = Column(DateTime, nullable=True)
    NOTES = Column(Text, nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    draft = relationship(
        "SupplierRegistrationDraft", back_populates="invitation",
        uselist=False, cascade="all, delete-orphan"
    )
    approval_logs = relationship(
        "SupplierApprovalLog", back_populates="invitation",
        cascade="all, delete-orphan"
    )


# ──────────────────────────────────────────────────────────────────────
# Table 2: SupplierRegistrationDraft
# One row per invitation — stores the supplier's partial form state so
# they can close the browser and resume from where they left off.
# FORM_DATA holds company details; PRODUCTS_DATA holds the product rows.
# ──────────────────────────────────────────────────────────────────────
class SupplierRegistrationDraft(Base):
    __tablename__ = "supplier_registration_draft"

    __table_args__ = (
        UniqueConstraint("INVITATION_ID", name="uq_sup_draft_invitation"),
    )

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    INVITATION_ID = Column(
        String(36),
        ForeignKey("supplier_invitation.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # Full JSON form state — company details section
    FORM_DATA = Column(JSON, nullable=True)

    # List of product-row dicts, e.g.:
    # [{"product_name":"Screw","unit":"PCS","unit_price":5.0,"moq":100,...}]
    PRODUCTS_DATA = Column(JSON, nullable=True)

    LAST_SAVED_AT = Column(DateTime, nullable=True)

    # MANUAL or VOICE
    ENTRY_MODE = Column(String(20), default="MANUAL")
    VOICE_TRANSCRIPT = Column(Text, nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    invitation = relationship("SupplierInvitation", back_populates="draft")


# ──────────────────────────────────────────────────────────────────────
# Table 4: SupplierProduct
# Three-way junction: which SUPPLIER supplies which PRODUCT at what price.
# The ranking engine queries this table for every active (VENDOR, PRODUCT)
# pair to find all competing suppliers.
# ──────────────────────────────────────────────────────────────────────
class SupplierProduct(Base):
    __tablename__ = "supplier_product"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "SUPPLIER_ID", "PRODUCT_ID",
            name="uq_sup_product_vendor_sup_prod"
        ),
        Index("ix_sup_prod_vendor_prod_price", "VENDOR_ID", "PRODUCT_ID", "UNIT_PRICE"),
        Index("ix_sup_prod_vendor_prod_status", "VENDOR_ID", "PRODUCT_ID", "STATUS"),
    )

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    PRODUCT_ID = Column(
        String(36),
        ForeignKey("product_master.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    UNIT_PRICE = Column(Numeric(14, 4), nullable=False)
    CURRENCY = Column(String(5), default="INR")

    MOQ = Column(Float, default=1.0)              # minimum order quantity
    LEAD_TIME_DAYS = Column(Integer, default=7)
    AVAILABLE_QTY = Column(Float, nullable=True)  # supplier-declared stock

    LAST_PRICE_UPDATED_AT = Column(DateTime, nullable=True)
    IS_PREFERRED = Column(Boolean, default=False)

    # ACTIVE / INACTIVE
    STATUS = Column(String(20), default="ACTIVE", index=True)
    NOTES = Column(Text, nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    product = relationship("ProductMaster", back_populates="supplier_products")
    price_history = relationship(
        "SupplierProductPriceHistory", back_populates="supplier_product",
        cascade="all, delete-orphan"
    )
    ranking_entries = relationship("SupplierRanking", back_populates="supplier_product")
    recommendation = relationship(
        "PurchaseRecommendation", back_populates="supplier_product"
    )


# ──────────────────────────────────────────────────────────────────────
# Table 5: SupplierProductPriceHistory
# Append-only audit of every price change on a SupplierProduct.
# Rows are NEVER updated after insert.
# ──────────────────────────────────────────────────────────────────────
class SupplierProductPriceHistory(Base):
    __tablename__ = "supplier_product_price_history"

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    SUPPLIER_PRODUCT_ID = Column(
        String(36),
        ForeignKey("supplier_product.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    OLD_PRICE = Column(Numeric(14, 4), nullable=False)
    NEW_PRICE = Column(Numeric(14, 4), nullable=False)

    CHANGED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True
    )

    # "EMPLOYEE" — internal staff updated the price
    # "SUPPLIER" — supplier submitted the price via their portal
    CHANGED_BY_ROLE = Column(String(20), nullable=False, default="EMPLOYEE")

    CHANGE_REASON = Column(String(500), nullable=True)
    EFFECTIVE_DATE = Column(Date, nullable=False)

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)

    # Relationship
    supplier_product = relationship(
        "SupplierProduct", back_populates="price_history"
    )


# ──────────────────────────────────────────────────────────────────────
# Table 6: SupplierRanking
# Computed rank for each (PRODUCT, SUPPLIER) pair within a vendor.
# Regenerated by supplier_ranking_service.recalculate_ranking_for_product().
# ──────────────────────────────────────────────────────────────────────
class SupplierRanking(Base):
    __tablename__ = "supplier_ranking"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "PRODUCT_ID", "SUPPLIER_ID",
            name="uq_sup_ranking_vendor_prod_sup"
        ),
        Index("ix_sup_ranking_prod_rank", "VENDOR_ID", "PRODUCT_ID", "RANK"),
    )

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    PRODUCT_ID = Column(
        String(36),
        ForeignKey("product_master.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    SUPPLIER_PRODUCT_ID = Column(
        String(36),
        ForeignKey("supplier_product.ID", ondelete="CASCADE"),
        nullable=False
    )

    RANK = Column(Integer, nullable=False)           # 1 = best

    PRICE_SCORE = Column(Float, nullable=False)       # 0-100
    AVAILABILITY_SCORE = Column(Float, nullable=False)
    PERFORMANCE_SCORE = Column(Float, nullable=False)
    SENIORITY_SCORE = Column(Float, nullable=False)
    COMPOSITE_SCORE = Column(Float, nullable=False)   # weighted sum

    UNIT_PRICE_AT_RANK = Column(Numeric(14, 4), nullable=False)   # snapshot

    RECALCULATED_AT = Column(DateTime, default=datetime.utcnow)

    # Relationships
    product = relationship("ProductMaster", back_populates="ranking_entries")
    supplier_product = relationship("SupplierProduct", back_populates="ranking_entries")


# ──────────────────────────────────────────────────────────────────────
# Table 7: PurchaseRecommendation
# One row per (VENDOR, PRODUCT) — the single best supplier recommendation.
# Updated every time rankings are recalculated.
# ──────────────────────────────────────────────────────────────────────
class PurchaseRecommendation(Base):
    __tablename__ = "purchase_recommendation"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "PRODUCT_ID",
            name="uq_purchase_rec_vendor_product"
        ),
    )

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    PRODUCT_ID = Column(
        String(36),
        ForeignKey("product_master.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    RECOMMENDED_SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    SUPPLIER_PRODUCT_ID = Column(
        String(36),
        ForeignKey("supplier_product.ID", ondelete="CASCADE"),
        nullable=False
    )

    RECOMMENDED_PRICE = Column(Numeric(14, 4), nullable=False)
    RECOMMENDATION_REASON = Column(String(500), nullable=True)

    # [{supplier_id, company_name, unit_price, rank}]
    ALTERNATIVE_SUPPLIER_IDS = Column(JSON, nullable=True)

    IS_ACTIVE = Column(Boolean, default=True)
    LAST_RECALCULATED_AT = Column(DateTime, default=datetime.utcnow)

    # Relationships
    product = relationship("ProductMaster", back_populates="recommendation")
    supplier_product = relationship("SupplierProduct", back_populates="recommendation")


# ──────────────────────────────────────────────────────────────────────
# Table 8: SupplierPerformanceMetrics
# Aggregated supplier KPIs — updated after each GRN finalization.
# One row per (VENDOR, SUPPLIER).
# ──────────────────────────────────────────────────────────────────────
class SupplierPerformanceMetrics(Base):
    __tablename__ = "supplier_performance_metrics"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "SUPPLIER_ID",
            name="uq_sup_perf_vendor_supplier"
        ),
    )

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    TOTAL_ORDERS = Column(Integer, default=0)
    COMPLETED_ORDERS = Column(Integer, default=0)
    ON_TIME_DELIVERIES = Column(Integer, default=0)
    DELAYED_DELIVERIES = Column(Integer, default=0)
    REJECTED_DELIVERIES = Column(Integer, default=0)

    TOTAL_QTY_ORDERED = Column(Float, default=0.0)
    TOTAL_QTY_RECEIVED = Column(Float, default=0.0)
    TOTAL_QTY_REJECTED = Column(Float, default=0.0)

    QUALITY_SCORE = Column(Float, default=0.0)               # 0-100
    PRICE_COMPETITIVENESS_SCORE = Column(Float, default=0.0) # 0-100
    ON_TIME_RATE = Column(Float, default=0.0)                # percentage
    OVERALL_SCORE = Column(Float, default=0.0)               # 0-100

    LAST_RECALCULATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ──────────────────────────────────────────────────────────────────────
# Table 9: SupplierApprovalLog
# Append-only audit of every admin approval or rejection action on an
# invitation. Rows are NEVER updated after insert.
# ──────────────────────────────────────────────────────────────────────
class SupplierApprovalLog(Base):
    __tablename__ = "supplier_approval_log"

    ID = Column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    INVITATION_ID = Column(
        String(36),
        ForeignKey("supplier_invitation.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # APPROVED or REJECTED
    ACTION = Column(String(20), nullable=False)

    REVIEWED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True
    )

    REVIEWED_AT = Column(DateTime, default=datetime.utcnow)
    REJECTION_REASON = Column(Text, nullable=True)
    COMMENTS = Column(Text, nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    # Relationship
    invitation = relationship("SupplierInvitation", back_populates="approval_logs")
