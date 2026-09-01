"""
One-shot demo seed for BVC24 (Bharath Vending Corporation).

Hit POST /demo/seed-bvc24 once after the app is running to
populate the database with:

  - A "BVC24" vendor (id=1 if not already present)
  - Departments matched to vending-machine manufacturing
  - Project categories + sample open projects with skill
    requirements and priorities
  - A handful of employees with comma-separated skills and
    fingerprint IDs already enrolled, so the /biometric/scan
    flow has something to allocate against

Idempotent: re-running will not create duplicates.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import bcrypt

from app.database.database import get_db

from app.models.models import (
    Vendor,
    Department,
    Designation,
    Role,
    Employee,
    ProjectCategory,
    Supplier,
    LeaveBalance
)


from app.auth.auth_bearer import get_current_admin

router = APIRouter(prefix="/demo", tags=["BVC24 Demo Seed"])


BVC24_DEPARTMENTS = [
    ("Production", "PRD", "Vending machine assembly line"),
    ("Design & Engineering", "DSG", "Mechanical + electrical design"),
    ("Embedded Software", "SWE", "Firmware + IoT for machines"),
    ("Quality Assurance", "QA", "Pre-dispatch inspection + RCA"),
    ("Installation & Service", "INS", "Field installation + AMC"),
    ("Sales & CRM", "SLS", "Customer onboarding + franchise"),
    ("Inventory & Warehouse", "INV", "Raw material + finished goods")
]


BVC24_SUPPLIERS = [
    {
        "SUPPLIER_CODE": "SUP-SHEET-01",
        "COMPANY_NAME": "Coimbatore Metal Works",
        "CONTACT_PERSON": "Murugan R",
        "PHONE": "+91 9876543210",
        "EMAIL": "sales@cbemetalworks.com",
        "ADDRESS_LINE1": "Plot 22, SIDCO Industrial Estate",
        "CITY": "Coimbatore",
        "STATE": "Tamil Nadu",
        "PINCODE": "641021",
        "GST_NUMBER": "33ABCDE1234F1Z5",
        "PAN_NUMBER": "ABCDE1234F",
        "BANK_NAME": "Indian Bank",
        "ACCOUNT_NUMBER": "612345678901",
        "IFSC_CODE": "IDIB000C123",
        "CATEGORY": "Sheet Metal",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE"
    },
    {
        "SUPPLIER_CODE": "SUP-ELEC-01",
        "COMPANY_NAME": "Chennai Electronics Hub",
        "CONTACT_PERSON": "Anitha Subramanian",
        "PHONE": "+91 9123456780",
        "EMAIL": "purchase@chennaielec.in",
        "ADDRESS_LINE1": "No 45, Ritchie Street",
        "CITY": "Chennai",
        "STATE": "Tamil Nadu",
        "PINCODE": "600003",
        "GST_NUMBER": "33FGHIJ5678K1Z9",
        "PAN_NUMBER": "FGHIJ5678K",
        "BANK_NAME": "HDFC Bank",
        "ACCOUNT_NUMBER": "50100123456789",
        "IFSC_CODE": "HDFC0000456",
        "CATEGORY": "Electronics",
        "PAYMENT_TERMS": "Advance 50%",
        "STATUS": "ACTIVE"
    },
    {
        "SUPPLIER_CODE": "SUP-MOTOR-01",
        "COMPANY_NAME": "Bangalore Motors & Drives",
        "CONTACT_PERSON": "Suresh K",
        "PHONE": "+91 9988776655",
        "EMAIL": "info@blrmotors.co.in",
        "ADDRESS_LINE1": "Industrial Suburb, Yeshwantpur",
        "CITY": "Bangalore",
        "STATE": "Karnataka",
        "PINCODE": "560022",
        "GST_NUMBER": "29MNOPQ8765R1Z2",
        "PAN_NUMBER": "MNOPQ8765R",
        "BANK_NAME": "Canara Bank",
        "ACCOUNT_NUMBER": "1234567890",
        "IFSC_CODE": "CNRB0000789",
        "CATEGORY": "Motors",
        "PAYMENT_TERMS": "NET 45",
        "STATUS": "ACTIVE"
    },
    {
        "SUPPLIER_CODE": "SUP-DISP-01",
        "COMPANY_NAME": "Madurai Display Tech",
        "CONTACT_PERSON": "Karthik V",
        "PHONE": "+91 9445566778",
        "EMAIL": "sales@mduraidisplay.com",
        "ADDRESS_LINE1": "Plot 8, K Pudur Industrial Area",
        "CITY": "Madurai",
        "STATE": "Tamil Nadu",
        "PINCODE": "625007",
        "GST_NUMBER": "33STUVW3456X1Z7",
        "PAN_NUMBER": "STUVW3456X",
        "BANK_NAME": "ICICI Bank",
        "ACCOUNT_NUMBER": "987654321098",
        "IFSC_CODE": "ICIC0000123",
        "CATEGORY": "Display",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE"
    },
    {
        "SUPPLIER_CODE": "SUP-PAY-01",
        "COMPANY_NAME": "PayKiosk Systems Pvt Ltd",
        "CONTACT_PERSON": "Rajesh Iyer",
        "PHONE": "+91 9876123450",
        "EMAIL": "orders@paykiosk.in",
        "ADDRESS_LINE1": "Tower B, Tidel Park",
        "CITY": "Chennai",
        "STATE": "Tamil Nadu",
        "PINCODE": "600113",
        "GST_NUMBER": "33YZABC9999P1Z3",
        "PAN_NUMBER": "YZABC9999P",
        "BANK_NAME": "Axis Bank",
        "ACCOUNT_NUMBER": "918010012345",
        "IFSC_CODE": "UTIB0000456",
        "CATEGORY": "Payment Hardware",
        "PAYMENT_TERMS": "Advance 100%",
        "STATUS": "ACTIVE"
    },
    {
        "SUPPLIER_CODE": "SUP-REFRIG-01",
        "COMPANY_NAME": "Tamil Cooling Industries",
        "CONTACT_PERSON": "Vijay Mahesh",
        "PHONE": "+91 9223344556",
        "EMAIL": "vijay@tcooling.in",
        "ADDRESS_LINE1": "Plot 12, Ambattur Industrial Estate",
        "CITY": "Chennai",
        "STATE": "Tamil Nadu",
        "PINCODE": "600058",
        "GST_NUMBER": "33DEFGH1111N1Z6",
        "PAN_NUMBER": "DEFGH1111N",
        "BANK_NAME": "SBI",
        "ACCOUNT_NUMBER": "30123456789",
        "IFSC_CODE": "SBIN0000123",
        "CATEGORY": "Refrigeration",
        "PAYMENT_TERMS": "NET 30",
        "STATUS": "ACTIVE"
    },
    {
        "SUPPLIER_CODE": "SUP-GLASS-01",
        "COMPANY_NAME": "Coromandel Glass Works",
        "CONTACT_PERSON": "Lakshmi N",
        "PHONE": "+91 9111222333",
        "EMAIL": "sales@coroglass.com",
        "CITY": "Coimbatore",
        "STATE": "Tamil Nadu",
        "PINCODE": "641004",
        "GST_NUMBER": "33IJKLM2222Q1Z4",
        "CATEGORY": "Glass",
        "PAYMENT_TERMS": "NET 15",
        "STATUS": "ACTIVE"
    }
]


BVC24_EMPLOYEES = [
    {
        "EMPLOYEE_CODE": "BVC001",
        "NAME": "Ravi Kumar",
        "EMAIL": "ravi@bvc24.com",
        "DEPT": "PRD",
        "SKILLS": "assembly,wiring,sheet metal,quality check",
        "FINGERPRINT_ID": "1001"
    },
    {
        "EMPLOYEE_CODE": "BVC002",
        "NAME": "Priya Selvam",
        "EMAIL": "priya@bvc24.com",
        "DEPT": "SWE",
        "SKILLS": "embedded c,iot,rtos,sensor integration,python",
        "FINGERPRINT_ID": "1002"
    },
    {
        "EMPLOYEE_CODE": "BVC003",
        "NAME": "Arun Mohan",
        "EMAIL": "arun@bvc24.com",
        "DEPT": "DSG",
        "SKILLS": "solidworks,thermal design,electrical schematic,product design",
        "FINGERPRINT_ID": "1003"
    },
    {
        "EMPLOYEE_CODE": "BVC004",
        "NAME": "Saranya Devi",
        "EMAIL": "saranya@bvc24.com",
        "DEPT": "QA",
        "SKILLS": "quality check,rca,inspection,documentation",
        "FINGERPRINT_ID": "1004"
    },
    {
        "EMPLOYEE_CODE": "BVC005",
        "NAME": "Karthik Raj",
        "EMAIL": "karthik@bvc24.com",
        "DEPT": "INS",
        "SKILLS": "field installation,customer training,electrical wiring",
        "FINGERPRINT_ID": "1005"
    },
    {
        "EMPLOYEE_CODE": "BVC006",
        "NAME": "Meena Lakshmi",
        "EMAIL": "meena@bvc24.com",
        "DEPT": "SLS",
        "SKILLS": "crm,franchise sales,customer onboarding,negotiation",
        "FINGERPRINT_ID": "1006"
    }
]


def _get_or_create_vendor(db: Session) -> Vendor:

    vendor = db.query(Vendor).filter(
        Vendor.VENDOR_NAME == "Bharath Vending Corporation"
    ).first()

    if vendor:

        return vendor

    vendor = Vendor(VENDOR_NAME="Bharath Vending Corporation")

    db.add(vendor)

    db.commit()

    db.refresh(vendor)

    return vendor


def _get_or_create_role(db: Session, vendor: Vendor) -> Role:

    role = db.query(Role).filter(
        Role.NAME == "WORKER",
        Role.VENDOR_ID == vendor.ID
    ).first()

    if role:

        return role

    role = Role(
        NAME="WORKER",
        DESCRIPTION="Execution-tier employee eligible for auto-allocation.",
        VENDOR_ID=vendor.ID
    )

    db.add(role)

    db.commit()

    db.refresh(role)

    return role


def _seed_departments(db: Session, vendor: Vendor) -> dict:
    """Returns a {CODE: Department} map for downstream linking."""

    out = {}

    for name, code, desc in BVC24_DEPARTMENTS:

        existing = db.query(Department).filter(
            Department.DEPARTMENT_CODE == code,
            Department.VENDOR_ID == vendor.ID
        ).first()

        if existing:

            out[code] = existing

            continue

        dept = Department(
            NAME=name,
            CODE=code,
            DESCRIPTION=desc,
            VENDOR_ID=vendor.ID
        )

        db.add(dept)

        db.flush()

        out[code] = dept

    db.commit()

    return out


def _seed_employees(
    db: Session,
    vendor: Vendor,
    role: Role,
    depts: dict
) -> int:

    created = 0

    pwd_hash = bcrypt.hashpw(
        "bvc24demo".encode(), bcrypt.gensalt()
    ).decode()

    for spec in BVC24_EMPLOYEES:

        existing = db.query(Employee).filter(
            Employee.EMPLOYEE_CODE == spec["EMPLOYEE_CODE"]
        ).first()

        if existing:

            # Backfill fingerprint / skills if they're missing
            updated = False

            if not existing.FINGERPRINT_ID:

                existing.FINGERPRINT_ID = spec["FINGERPRINT_ID"]

                updated = True

            if not existing.SKILLS:

                existing.SKILLS = spec["SKILLS"]

                updated = True

            if updated:

                db.commit()

            continue

        emp = Employee(
            EMPLOYEE_CODE=spec["EMPLOYEE_CODE"],
            NAME=spec["NAME"],
            EMAIL=spec["EMAIL"],
            PASSWORD=pwd_hash,
            DEPARTMENT_ID=depts[spec["DEPT"]].ID,
            ROLE_ID=role.ID,
            JOINING_DATE=date.today(),
            SKILLS=spec["SKILLS"],
            FINGERPRINT_ID=spec["FINGERPRINT_ID"],
            STATUS="ACTIVE",
            VENDOR_ID=vendor.ID
        )

        db.add(emp)

        created += 1

    db.commit()

    return created


def _seed_suppliers(db: Session, vendor: Vendor) -> dict:
    """Returns {SUPPLIER_CODE: Supplier} for downstream BOM linking."""

    out = {}

    for spec in BVC24_SUPPLIERS:

        existing = db.query(Supplier).filter(
            Supplier.VENDOR_ID == vendor.ID,
            Supplier.SUPPLIER_CODE == spec["SUPPLIER_CODE"]
        ).first()

        if existing:

            out[spec["SUPPLIER_CODE"]] = existing

            continue

        supplier = Supplier(VENDOR_ID=vendor.ID, **spec)

        db.add(supplier)

        db.flush()

        out[spec["SUPPLIER_CODE"]] = supplier

    db.commit()

    return out


def _seed_leave_balances(db: Session, vendor: Vendor) -> int:
    """Create a fresh LeaveBalance row for every BVC24 employee
    for the current year (idempotent)."""

    year = date.today().year

    employees = (
        db.query(Employee)
        .filter(Employee.VENDOR_ID == vendor.ID)
        .all()
    )

    created = 0

    for emp in employees:

        existing = db.query(LeaveBalance).filter(
            LeaveBalance.EMPLOYEE_ID == emp.ID,
            LeaveBalance.YEAR == year
        ).first()

        if existing:

            continue

        db.add(LeaveBalance(
            EMPLOYEE_ID=emp.ID,
            YEAR=year,
            CASUAL_TOTAL=12.0,
            CASUAL_USED=0.0,
            SICK_TOTAL=12.0,
            SICK_USED=0.0,
            EARNED_TOTAL=15.0,
            EARNED_USED=0.0
        ))

        created += 1

    db.commit()

    return created


@router.post("/seed-bvc24", dependencies=[Depends(get_current_admin)])
def seed_bvc24(db: Session = Depends(get_db)):

    vendor = _get_or_create_vendor(db)

    role = _get_or_create_role(db, vendor)

    depts = _seed_departments(db, vendor)

    new_employees = _seed_employees(db, vendor, role, depts)

    suppliers = _seed_suppliers(db, vendor)

    new_leave_balances = _seed_leave_balances(db, vendor)

    return {
        "message": "BVC24 demo data ready",
        "vendor_id": vendor.ID,
        "departments": len(depts),
        "new_employees": new_employees,
        "suppliers": len(suppliers),
        "new_leave_balances": new_leave_balances,
        "demo_fingerprint_ids": [
            {
                "FINGERPRINT_ID": e["FINGERPRINT_ID"],
                "EMPLOYEE_CODE": e["EMPLOYEE_CODE"],
                "NAME": e["NAME"]
            }
            for e in BVC24_EMPLOYEES
        ]
    }
