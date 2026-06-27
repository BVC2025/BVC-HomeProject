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

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    products = relationship("ProductMaster", back_populates="category")


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

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    category = relationship("InventoryCategory", back_populates="products")
    department = relationship("Department", foreign_keys=[DEPARTMENT_ID])
    inventory_items = relationship("InventoryItem", back_populates="product")
    supplier_products = relationship("SupplierProduct", back_populates="product")
    ranking_entries = relationship("SupplierRanking", back_populates="product")
    recommendation = relationship(
        "PurchaseRecommendation", back_populates="product", uselist=False
    )


# ──────────────────────────────────────────────────────────────────────
# Table 3: InventoryItem
# Physical item master: links a product to a storage location.
# One ProductMaster can have items in multiple locations.
# ──────────────────────────────────────────────────────────────────────
class InventoryItem(Base):
    __tablename__ = "inventory_item"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "PRODUCT_ID", "LOCATION",
            name="uq_inv_item_vendor_product_loc"
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

    LOCATION = Column(String(200), nullable=True)   # warehouse / bin / shelf

    BATCH_TRACKING = Column(Boolean, default=False)

    REORDER_LEVEL = Column(Float, default=0.0)
    REORDER_QTY = Column(Float, default=0.0)
    SAFETY_STOCK = Column(Float, default=0.0)
    MAX_STOCK = Column(Float, default=0.0)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    product = relationship("ProductMaster", back_populates="inventory_items")
    stock = relationship(
        "InventoryStock", back_populates="inventory_item",
        uselist=False, cascade="all, delete-orphan"
    )
    movements = relationship(
        "InventoryMovement", back_populates="inventory_item",
        cascade="all, delete-orphan"
    )
    batches = relationship(
        "InventoryBatch", back_populates="inventory_item",
        cascade="all, delete-orphan"
    )


# ──────────────────────────────────────────────────────────────────────
# Table 4: InventoryStock
# One row per InventoryItem — the current real-time stock snapshot.
# Always updated atomically with InventoryMovement via record_movement().
# ──────────────────────────────────────────────────────────────────────
class InventoryStock(Base):
    __tablename__ = "inventory_stock"

    __table_args__ = (
        UniqueConstraint(
            "INVENTORY_ITEM_ID",
            name="uq_inv_stock_item"
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

    INVENTORY_ITEM_ID = Column(
        String(36),
        ForeignKey("inventory_item.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    CURRENT_QTY = Column(Float, nullable=False, default=0.0)
    RESERVED_QTY = Column(Float, default=0.0)    # held for open POs / work orders
    AVAILABLE_QTY = Column(Float, default=0.0)   # CURRENT_QTY - RESERVED_QTY
    UNIT_COST = Column(Float, default=0.0)        # weighted average cost

    STATUS = Column(INV_STATUS_ENUM, default="OUT_OF_STOCK")

    LAST_MOVEMENT_AT = Column(DateTime, nullable=True)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    inventory_item = relationship("InventoryItem", back_populates="stock")


# ──────────────────────────────────────────────────────────────────────
# Table 5: InventoryMovement
# Append-only stock-ledger.  Every stock change (in/out/adjust/transfer)
# creates a new row here; rows are NEVER updated after insert.
# ──────────────────────────────────────────────────────────────────────
class InventoryMovement(Base):
    __tablename__ = "inventory_movement"

    __table_args__ = (
        Index("ix_inv_mov_item_date", "VENDOR_ID", "INVENTORY_ITEM_ID", "CREATED_AT"),
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

    INVENTORY_ITEM_ID = Column(
        String(36),
        ForeignKey("inventory_item.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    MOVEMENT_TYPE = Column(INV_MOVEMENT_TYPE_ENUM, nullable=False, index=True)

    QTY = Column(Float, nullable=False)      # always positive; direction is implied by MOVEMENT_TYPE
    QTY_BEFORE = Column(Float, nullable=False)
    QTY_AFTER = Column(Float, nullable=False)

    UNIT_COST = Column(Float, nullable=True)

    REFERENCE_TYPE = Column(String(30), nullable=True)   # "PO", "GRN", "SO", "MANUAL", etc.
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

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)

    # Relationships
    inventory_item = relationship("InventoryItem", back_populates="movements")
    batch = relationship("InventoryBatch", back_populates="movements")


# ──────────────────────────────────────────────────────────────────────
# Table 6: InventoryBatch
# Batch / lot tracking for received goods.
# Linked to the GRN that created the batch.
# ──────────────────────────────────────────────────────────────────────
class InventoryBatch(Base):
    __tablename__ = "inventory_batch"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "INVENTORY_ITEM_ID", "BATCH_NUMBER",
            name="uq_inv_batch_vendor_item_batch"
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

    INVENTORY_ITEM_ID = Column(
        String(36),
        ForeignKey("inventory_item.ID", ondelete="CASCADE"),
        nullable=False, index=True
    )

    BATCH_NUMBER = Column(String(100), nullable=False)
    LOT_NUMBER = Column(String(100), nullable=True)

    SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID", ondelete="SET NULL"),
        nullable=True, index=True
    )

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

    MANUFACTURING_DATE = Column(Date, nullable=True)
    EXPIRY_DATE = Column(Date, nullable=True)

    QTY_RECEIVED = Column(Float, nullable=False)
    QTY_REMAINING = Column(Float, nullable=False)
    UNIT_COST = Column(Float, nullable=True)

    # ACTIVE / CONSUMED / EXPIRED / RETURNED — varchar, not enum, so values can grow
    STATUS = Column(String(20), default="ACTIVE")

    NOTES = Column(Text, nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    inventory_item = relationship("InventoryItem", back_populates="batches")
    movements = relationship("InventoryMovement", back_populates="batch")
