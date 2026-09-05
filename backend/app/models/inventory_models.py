from sqlalchemy import (
    Column, String, Integer, ForeignKey, Float, Date,
    Text, UniqueConstraint, DateTime, Boolean, Numeric, JSON, Index,
    Enum as SAEnum
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from app.utils.datetime_utils import now_ist
import uuid

# ──────────────────────────────────────────────
# Module-level Enum types  (names must NOT clash with models.py enums:
#   field_type_enum, unit_enum, duration_unit_enum,
#   task_status_enum, assignment_mode_enum)
# ──────────────────────────────────────────────

INV_MOVEMENT_TYPE_ENUM = SAEnum(
    "STOCK_IN", "STOCK_OUT", "ADJUSTMENT",
    "TRANSFER_IN", "TRANSFER_OUT",
    "RETURN", "WRITE_OFF", "OPENING_STOCK",
    name="inv_movement_type_enum", create_constraint=True
)

INV_STATUS_ENUM = SAEnum(
    "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "OVERSTOCK",
    name="inv_status_enum", create_constraint=True
)

PRODUCT_STATUS_ENUM = SAEnum(
    "ACTIVE", "INACTIVE", "DISCONTINUED",
    name="product_status_enum", create_constraint=True
)


# ──────────────────────────────────────────────────────────────────────
# Table 1: InventoryCategory
# Hierarchical product categorisation (supports one level of nesting).
# ──────────────────────────────────────────────────────────────────────
class InventoryCategory(Base):
    __tablename__ = "inventory_category"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "NAME",
            name="uq_inv_cat_vendor_name"
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

    NAME = Column(String(100), nullable=False)
    CODE = Column(String(30), nullable=True)
    DESCRIPTION = Column(Text, nullable=True)
    SORT_ORDER = Column(Integer, default=0)
    IS_ACTIVE = Column(Boolean, default=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    # Relationships
    products = relationship("ProductMaster", back_populates="category")
    supplier_products = relationship("SupplierProduct", back_populates="category")


# ──────────────────────────────────────────────────────────────────────
# Table 2: ProductMaster
# Vendor-scoped product catalogue used by BOM/PO/supplier-onboarding
# workflows.  Procurement ranking queries this table.
# ──────────────────────────────────────────────────────────────────────
class ProductMaster(Base):
    __tablename__ = "product_master"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "PRODUCT_CODE",
            name="uq_product_master_vendor_code"
        ),
        Index("ix_product_vendor_status", "VENDOR_ID", "STATUS"),
        Index("ix_product_vendor_category", "VENDOR_ID", "CATEGORY_ID"),
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

    CATEGORY_ID = Column(
        String(36),
        ForeignKey("inventory_category.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

    DEPARTMENT_ID = Column(
        Integer,
        ForeignKey("department.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

    PRODUCT_CODE = Column(String(50), nullable=False, index=True)
    PRODUCT_NAME = Column(String(200), nullable=False)
    DESCRIPTION = Column(Text, nullable=True)
    HSN_CODE = Column(String(20), nullable=True)
    UNIT = Column(String(20), default="PCS")   # flexible; not enum to allow custom units
    IMAGE_URL = Column(String(500), nullable=True)
    SPECIFICATIONS = Column(JSON, nullable=True)
    STATUS = Column(PRODUCT_STATUS_ENUM, default="ACTIVE")

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    # Relationships
    category = relationship("InventoryCategory", back_populates="products")
    department = relationship("Department", foreign_keys=[DEPARTMENT_ID])
    stock = relationship("InventoryStock", back_populates="product", uselist=False,
                          cascade="all, delete-orphan")
    batches = relationship("InventoryBatch", back_populates="product",
                            cascade="all, delete-orphan")
    movements = relationship("InventoryMovement", back_populates="product",
                              cascade="all, delete-orphan")
    supplier_products = relationship("SupplierProduct", back_populates="product")
    ranking_entries = relationship("SupplierRanking", back_populates="product")
    recommendation = relationship(
        "PurchaseRecommendation", back_populates="product", uselist=False
    )


# ──────────────────────────────────────────────────────────────────────
# NOTE — InventoryItem removed (inventory-consolidation migration).
#
# InventoryItem used to sit between ProductMaster and InventoryStock/
# InventoryBatch/InventoryMovement, modelling "this product, at this
# storage location." The simplified architecture drops the location
# dimension entirely: InventoryStock/InventoryBatch/InventoryMovement
# now reference ProductMaster.ID directly via a PRODUCT_ID column.
#
# See backend/app/main.py's _migrate_inventory_add_product_id_columns() /
# _migrate_backfill_inventory_product_id() / _migrate_inventory_stock_
# finalize_schema() / _migrate_inventory_movement_finalize_schema() /
# _migrate_inventory_batch_finalize_schema() for the migration that
# backfilled every existing row onto PRODUCT_ID before this class was
# removed. The physical `inventory_item` table is intentionally left in
# place in MySQL (not dropped) — same "unmap, don't drop" convention
# already used for TaskTemplateDependency / ProjectPaymentMilestone.
# ──────────────────────────────────────────────────────────────────────


# ──────────────────────────────────────────────────────────────────────
# Table 4: InventoryStock
# One row per (VENDOR_ID, PRODUCT_ID) — the current real-time stock
# snapshot. Always updated atomically with InventoryMovement via
# inventory_automation_service.record_movement().
# ──────────────────────────────────────────────────────────────────────
class InventoryStock(Base):
    __tablename__ = "inventory_stock"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "PRODUCT_ID",
            name="uq_inv_stock_vendor_product"
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
        ForeignKey("product_master.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    MIN_QTY = Column(Float, nullable=False, default=0.0)
    # Reorder threshold. When CURRENT_QTY drops at or below this value,
    # the low-stock automatic-reorder workflow triggers. 0 disables it.

    MAX_QTY = Column(Float, nullable=True)
    # Desired stock ceiling. NULL = no cap (never flagged OVERSTOCK,
    # and the low-stock reorder-qty math falls back to MIN_QTY-based
    # sizing instead of MAX_QTY - CURRENT_QTY).

    CURRENT_QTY = Column(Float, nullable=False, default=0.0)

    STATUS = Column(INV_STATUS_ENUM, default="OUT_OF_STOCK")

    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    # Relationship
    product = relationship("ProductMaster", back_populates="stock")


# ──────────────────────────────────────────────────────────────────────
# Table 5: InventoryMovement
# Append-only stock-ledger.  Every stock change (in/out/adjust/transfer)
# creates a new row here; rows are NEVER updated after insert.
#
# QTY semantics: for STOCK_IN/STOCK_OUT/TRANSFER_IN/TRANSFER_OUT/RETURN/
# WRITE_OFF/OPENING_STOCK, QTY is the delta actually applied. For
# ADJUSTMENT, QTY is the ABSOLUTE new quantity that was set (not a
# delta) — the true difference for an adjustment row is always
# QTY_AFTER - QTY_BEFORE, never QTY itself.
# ──────────────────────────────────────────────────────────────────────
class InventoryMovement(Base):
    __tablename__ = "inventory_movement"

    __table_args__ = (
        Index("ix_inv_mov_product_date", "VENDOR_ID", "PRODUCT_ID", "CREATED_AT"),
        Index("ix_inv_mov_type_date", "VENDOR_ID", "MOVEMENT_TYPE", "CREATED_AT"),
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
        ForeignKey("product_master.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    MOVEMENT_TYPE = Column(INV_MOVEMENT_TYPE_ENUM, nullable=False, index=True)

    QTY = Column(Float, nullable=False)      # see class docstring for ADJUSTMENT semantics
    QTY_BEFORE = Column(Float, nullable=False)
    QTY_AFTER = Column(Float, nullable=False)

    UNIT_COST = Column(Float, nullable=True)

    # "PO" | "GRN" | "MANUAL" | "CUSTOMER_PROJECT_ASSIGNMENT" | etc.
    REFERENCE_TYPE = Column(String(30), nullable=True)
    REFERENCE_ID = Column(String(36), nullable=True, index=True)

    BATCH_ID = Column(
        String(36),
        ForeignKey("inventory_batch.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

    REASON = Column(String(500), nullable=True)
    NOTES = Column(Text, nullable=True)

    PERFORMED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

    CREATED_AT = Column(DateTime, default=now_ist, index=True)

    # Relationships
    product = relationship("ProductMaster", back_populates="movements")
    batch = relationship("InventoryBatch", back_populates="movements")
    performed_by = relationship("Employee", foreign_keys=[PERFORMED_BY_ID])


# ──────────────────────────────────────────────────────────────────────
# Table 6: InventoryBatch
# Batch / lot tracking for received goods — one row per receipt (a
# second delivery of the same product, even from the same supplier, is
# always its own batch, never merged into an existing one).
# ──────────────────────────────────────────────────────────────────────
class InventoryBatch(Base):
    __tablename__ = "inventory_batch"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "PRODUCT_ID", "BATCH_NUMBER",
            name="uq_inv_batch_vendor_product_batch"
        ),
        Index("ix_inv_batch_expiry", "EXPIRY_DATE"),
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
        ForeignKey("product_master.ID", ondelete="RESTRICT"),
        nullable=False, index=True
    )

    # Auto-generated at creation time (PRODUCT_CODE-YYYYMMDD-HHMMSS-N) —
    # never client-supplied. See inventory_batches.py's _generate_batch_number().
    BATCH_NUMBER = Column(String(100), nullable=False)

    # Kept additively alongside the spec's own suggested column list —
    # dropping these would regress the already-live "expiring soon"
    # batch feature and lose direct PO/GRN traceability for no benefit.
    MANUFACTURING_DATE = Column(Date, nullable=True)
    EXPIRY_DATE = Column(Date, nullable=True)
    # Explicit "this product never expires" flag — distinguishes a
    # genuinely non-expiring product from EXPIRY_DATE simply not having
    # been entered yet. Always kept in sync with EXPIRY_DATE at the route
    # layer: True means EXPIRY_DATE is NULL, never a sentinel date.
    IS_NO_EXPIRY = Column(Boolean, nullable=False, default=False)
    PO_ID = Column(
        Integer,
        ForeignKey("purchase_order.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )
    GRN_ID = Column(
        Integer,
        ForeignKey("goods_receipt_note.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

    SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

    RECEIVED_DATE = Column(Date, nullable=True)

    QTY_RECEIVED = Column(Float, nullable=False)
    QTY_REMAINING = Column(Float, nullable=False)
    UNIT_COST = Column(Float, nullable=True)

    # Delivery-Challan / Invoice upload — at least one is required when a
    # batch is created manually (enforced at the route layer).
    DC_FILE_URL = Column(String(500), nullable=True)
    INVOICE_FILE_URL = Column(String(500), nullable=True)

    # ACTIVE / CONSUMED / EXPIRED / RETURNED — varchar, not enum, so values can grow
    STATUS = Column(String(20), default="ACTIVE")

    NOTES = Column(Text, nullable=True)

    CREATED_BY = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True
    )

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    # Relationships
    product = relationship("ProductMaster", back_populates="batches")
    movements = relationship("InventoryMovement", back_populates="batch")
