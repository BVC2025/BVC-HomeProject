from sqlalchemy import Column, String, Integer, ForeignKey
from sqlalchemy.orm import relationship
from app.database.database import Base
from datetime import datetime
from sqlalchemy import DateTime
import uuid

class Vendor(Base):
    __tablename__ = "vendor"

    ID = Column(Integer, primary_key=True)
    VENDOR_NAME = Column(String(100))

    root_users = relationship("RootUser", back_populates="vendor")
class RootUser(Base):
    __tablename__ = "root_user"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    EMAIL = Column(String(100), unique=True)

    PASSWORD = Column(String(255))

    STATUS = Column(String(20), default="ACTIVE")
    

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID"))

    vendor = relationship("Vendor", back_populates="root_users")


class IAMUser(Base):

    __tablename__ = "iam_user"

    ID = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    NAME = Column(String(100))

    EMAIL = Column(String(100), unique=True)

    PASSWORD = Column(String(255))

    STATUS = Column(
        String(20),
        default="ACTIVE"
    )

    ROLE_ID = Column(
        Integer,
        ForeignKey("role.ID")
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )

class Role(Base):

    __tablename__ = "role"

    ID = Column(Integer, primary_key=True, index=True)

    ROLE_NAME = Column(String(100))

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )



class Customer(Base):

    __tablename__ = "customer"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    CUSTOMER_NAME = Column(
        String(100)
    )

    PHONE = Column(
        String(20)
    )

    EMAIL = Column(
        String(100)
    )

    ADDRESS = Column(
        String(255)
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )


class Project(Base):

    __tablename__ = "project"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    PROJECT_NAME = Column(
        String(100)
    )

    DESCRIPTION = Column(
        String(255)
    )

    STATUS = Column(
        String(50),
        default="PENDING"
    )

    CUSTOMER_ID = Column(
        Integer,
        ForeignKey("customer.ID")
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )       



class Task(Base):
    START_TIME = Column(DateTime, nullable=True)

    END_TIME = Column(DateTime, nullable=True)

    __tablename__ = "task"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    TASK_NAME = Column(
        String(100)
    )

    DESCRIPTION = Column(
        String(255)
    )

    STATUS = Column(
        String(50),
        default="PENDING"
    )

    PRIORITY = Column(
        String(50),
        default="MEDIUM"
    )

    PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID")
    )

    ASSIGNED_TO = Column(
        String(36),
        ForeignKey("iam_user.ID")
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )