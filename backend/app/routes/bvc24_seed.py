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

from datetime import date, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import bcrypt

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin

from app.models.models import (
    Vendor,
    Department,
    Designation,
    Role,
    Employee,
    Customer,
    CustomerProject,
    ProjectCategory,
    ProductModel,
    BOMItem,
    WorkOrder,
    QCChecklistItem,
    QCInspection,
    QCInspectionResult,
    Supplier,
    ProcessStage,
    WorkOrderStageProgress,
    LeaveBalance
)


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


BVC24_PROJECTS = [
    {
        "PROJECT_NAME": "Snack & Beverage Combo Machine - Chennai Order",
        "DESCRIPTION": "Assembly + dispatch of 12 dual-tray combo vending machines for Chennai metro stations.",
        "DEPT": "PRD",
        "SKILLS_REQUIRED": "assembly,wiring,sheet metal,quality check",
        "PRIORITY": "HIGH",
        "STATUS": "IN_PROGRESS"
    },
    {
        "PROJECT_NAME": "Medicine Dispenser Firmware v2.3",
        "DESCRIPTION": "RTC + temperature sensor integration for pharmacy vending machines.",
        "DEPT": "SWE",
        "SKILLS_REQUIRED": "embedded c,iot,rtos,sensor integration",
        "PRIORITY": "HIGH",
        "STATUS": "IN_PROGRESS"
    },
    {
        "PROJECT_NAME": "Hot Food Box Cabinet Redesign",
        "DESCRIPTION": "Thermal insulation upgrade + new control panel for hot food vending units.",
        "DEPT": "DSG",
        "SKILLS_REQUIRED": "solidworks,thermal design,electrical schematic",
        "PRIORITY": "MEDIUM",
        "STATUS": "PENDING"
    },
    {
        "PROJECT_NAME": "Karur Installation Drive - 8 Units",
        "DESCRIPTION": "Site survey, installation and customer training across 8 Karur retail outlets.",
        "DEPT": "INS",
        "SKILLS_REQUIRED": "field installation,customer training,electrical wiring",
        "PRIORITY": "HIGH",
        "STATUS": "IN_PROGRESS"
    },
    {
        "PROJECT_NAME": "Pre-Dispatch QC - Q3 Batch",
        "DESCRIPTION": "Full pre-dispatch inspection cycle for 35 units; RCA on field returns.",
        "DEPT": "QA",
        "SKILLS_REQUIRED": "quality check,rca,inspection,documentation",
        "PRIORITY": "MEDIUM",
        "STATUS": "PENDING"
    },
    {
        "PROJECT_NAME": "Kiosk Cosmetics Line - Salem Pilot",
        "DESCRIPTION": "New cosmetic-product vending kiosk pilot for Salem retail group.",
        "DEPT": "DSG",
        "SKILLS_REQUIRED": "ui/ux,touch screen,product design",
        "PRIORITY": "LOW",
        "STATUS": "PENDING"
    }
]


BVC24_PRODUCT_MODELS = [
    {
        "MODEL_CODE": "BVC-SBC-01",
        "MODEL_NAME": "Snack & Beverage Combo Machine",
        "CATEGORY": "snack-beverage",
        "DESCRIPTION": "Dual-tray combo machine — snacks + cold drinks. Touchscreen + cashless.",
        "ESTIMATED_BUILD_DAYS": 12,
        "bom": [
            ("Sheet metal cabinet (1.2mm CRCA)", 1.0, "set"),
            ("Spiral dispensing motor", 24.0, "pcs"),
            ("Refrigeration compressor (R134a)", 1.0, "pcs"),
            ("Control board (BVC24 v3)", 1.0, "pcs"),
            ("10\" touchscreen display", 1.0, "pcs"),
            ("Cashless payment terminal", 1.0, "pcs"),
            ("Internal LED strip 1m", 3.0, "m"),
            ("Wiring harness", 1.0, "set"),
            ("Tempered glass front 600x900", 1.0, "pcs"),
            ("Lock & key assembly", 1.0, "set")
        ]
    },
    {
        "MODEL_CODE": "BVC-MED-01",
        "MODEL_NAME": "Medicine Dispenser",
        "CATEGORY": "medicine",
        "DESCRIPTION": "Pharmacy-grade vending machine with temperature sensor + RTC for shelf-life management.",
        "ESTIMATED_BUILD_DAYS": 14,
        "bom": [
            ("Sheet metal cabinet (1.5mm CRCA)", 1.0, "set"),
            ("Spiral dispensing motor", 36.0, "pcs"),
            ("Temperature sensor (DS18B20)", 4.0, "pcs"),
            ("RTC module (DS3231)", 1.0, "pcs"),
            ("Control board (BVC24 Pharma v2)", 1.0, "pcs"),
            ("10\" touchscreen display", 1.0, "pcs"),
            ("Aadhaar biometric reader", 1.0, "pcs"),
            ("Receipt printer (thermal)", 1.0, "pcs"),
            ("UPS battery backup", 1.0, "pcs"),
            ("Tempered glass front 600x900", 1.0, "pcs")
        ]
    },
    {
        "MODEL_CODE": "BVC-HFB-01",
        "MODEL_NAME": "Hot Food Box",
        "CATEGORY": "hot-food",
        "DESCRIPTION": "Insulated hot food vending unit — maintains 60°C with PID-controlled heating.",
        "ESTIMATED_BUILD_DAYS": 16,
        "bom": [
            ("Insulated cabinet (PU foam 50mm)", 1.0, "set"),
            ("Heating element (1.5kW)", 2.0, "pcs"),
            ("PID temperature controller", 1.0, "pcs"),
            ("Thermal sensor (PT100)", 4.0, "pcs"),
            ("Conveyor servo motor", 1.0, "pcs"),
            ("Control board (BVC24 v3)", 1.0, "pcs"),
            ("10\" touchscreen display", 1.0, "pcs"),
            ("Stainless steel inner liner", 1.0, "set"),
            ("Door seal silicone gasket", 2.0, "m")
        ]
    },
    {
        "MODEL_CODE": "BVC-CSM-01",
        "MODEL_NAME": "Cosmetics Kiosk",
        "CATEGORY": "cosmetics",
        "DESCRIPTION": "Touchscreen kiosk for cosmetic / lifestyle products. Compact footprint.",
        "ESTIMATED_BUILD_DAYS": 10,
        "bom": [
            ("Slim cabinet (0.9mm CRCA)", 1.0, "set"),
            ("Spiral dispensing motor", 18.0, "pcs"),
            ("Control board (BVC24 Lite v1)", 1.0, "pcs"),
            ("15\" touchscreen display", 1.0, "pcs"),
            ("Cashless payment terminal", 1.0, "pcs"),
            ("Internal LED strip 1m", 4.0, "m"),
            ("Tempered glass front 500x800", 1.0, "pcs")
        ]
    },
    {
        "MODEL_CODE": "BVC-FNV-01",
        "MODEL_NAME": "Fruits & Vegetables Vending",
        "CATEGORY": "grocery",
        "DESCRIPTION": "Chilled vending unit with humidity control for fresh produce.",
        "ESTIMATED_BUILD_DAYS": 14,
        "bom": [
            ("Sheet metal cabinet (1.2mm CRCA)", 1.0, "set"),
            ("Refrigeration compressor (R290)", 1.0, "pcs"),
            ("Humidity sensor (DHT22)", 4.0, "pcs"),
            ("Mister atomizer", 2.0, "pcs"),
            ("Locker compartment (304 SS)", 24.0, "pcs"),
            ("Control board (BVC24 Fresh v1)", 1.0, "pcs"),
            ("10\" touchscreen display", 1.0, "pcs"),
            ("Tempered glass front 600x900", 1.0, "pcs")
        ]
    }
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


# Common manufacturing stages — applied to every machine model.
# Each tuple: (sequence, name, stage_type, est_hours, description)
COMMON_STAGES = [
    (1, "Design Review", "DESIGN", 4, "Sign off engineering drawings + customer-specific options."),
    (2, "Mechanical Design", "MECHANICAL", 8, "Cabinet, frame, shelf & tray dimensions finalised."),
    (3, "Electrical Design", "ELECTRICAL", 8, "Control board layout, harness routing, sensor placement."),
    (4, "Sheet Metal Fabrication", "FABRICATION", 16, "Cut, bend, weld and paint the cabinet structure."),
    (5, "Electrical Wiring", "WIRING", 12, "Run harness, terminate connectors, route low-voltage lines."),
    (6, "Component Assembly", "ASSEMBLY", 16, "Mount motors, sensors, display, payment terminal."),
    (7, "Software Flashing", "ELECTRICAL", 4, "Flash firmware, configure menu, test UI flows."),
    (8, "Bench Testing", "TESTING", 8, "Functional smoke test, run dispense cycles, verify telemetry."),
    (9, "Pre-Dispatch QC", "QC", 6, "Quality module checklist run — gates DONE."),
    (10, "Packaging & Dispatch Prep", "PACKAGING", 4, "Foam, crate, label, generate dispatch docs.")
]


# Map BOM material name keyword -> supplier code, so we can
# auto-classify seeded BOM items as PURCHASE with a default
# supplier. Items whose names don't match any keyword stay as
# PROCESS (in-house manufactured).
BOM_SUPPLIER_HINTS = [
    ("motor", "SUP-MOTOR-01"),
    ("compressor", "SUP-REFRIG-01"),
    ("control board", "SUP-ELEC-01"),
    ("touchscreen", "SUP-DISP-01"),
    ("display", "SUP-DISP-01"),
    ("payment terminal", "SUP-PAY-01"),
    ("led", "SUP-ELEC-01"),
    ("rtc", "SUP-ELEC-01"),
    ("sensor", "SUP-ELEC-01"),
    ("biometric reader", "SUP-ELEC-01"),
    ("printer", "SUP-PAY-01"),
    ("ups", "SUP-ELEC-01"),
    ("glass", "SUP-GLASS-01"),
    ("wiring harness", "SUP-ELEC-01"),
    ("heating element", "SUP-ELEC-01"),
    ("pid", "SUP-ELEC-01"),
    ("servo", "SUP-MOTOR-01"),
    ("lock", "SUP-SHEET-01"),
    ("atomizer", "SUP-REFRIG-01"),
    ("locker compartment", "SUP-SHEET-01"),
    ("stainless", "SUP-SHEET-01")
]

# BOM items containing these keywords are clearly in-house
# work — keep them as PROCESS regardless of supplier match.
BOM_PROCESS_KEYWORDS = [
    "cabinet",
    "frame",
    "harness routing",
    "door seal"
]


BVC24_QC_CHECKLISTS = {
    "BVC-SBC-01": [
        ("All 24 dispensing motors functional", "CRITICAL", "Trigger each motor; confirm rotation + bottle/snack drop."),
        ("Refrigeration holds 4°C within 30 min", "CRITICAL", "Empty unit; run for 30 min; verify internal temp 4±2°C."),
        ("10\" touchscreen responsive across full surface", "MAJOR", "Press each quadrant; verify <100ms latency."),
        ("Cashless payment terminal accepts UPI + card", "CRITICAL", "Run ₹1 test txn via UPI and card; confirm both succeed."),
        ("Internal LED strips light uniformly", "MINOR", "Power on; visually confirm no dead segments."),
        ("Lock & key cycle smooth, no binding", "MAJOR", "Open/close lock 5 times."),
        ("Cabinet has no visible scratches or dents", "MINOR", "Visual inspection in good light."),
        ("Tempered glass front free of cracks/chips", "MAJOR", "Edge + face visual; tap test."),
        ("Power consumption within 350W idle spec", "MAJOR", "Measure with energy meter for 5 min."),
        ("End-to-end dispense test: product → tray pickup", "CRITICAL", "Buy 3 products; confirm each drops to retrieval tray.")
    ],
    "BVC-MED-01": [
        ("All 36 dispensing motors functional", "CRITICAL", "Trigger each motor individually."),
        ("Temperature sensors read within ±1°C of reference", "CRITICAL", "Compare 4 internal sensors to calibrated thermometer."),
        ("RTC time accurate to ±5 sec/day", "MAJOR", "Sync with NTP; verify after 1 hr."),
        ("Aadhaar biometric reader matches enrolled finger", "CRITICAL", "Enrol test finger; verify match in <2 sec."),
        ("Thermal receipt printer outputs clear", "MAJOR", "Print test slip; verify legibility + cut."),
        ("UPS battery holds load for 30 min on mains loss", "CRITICAL", "Disconnect mains; monitor for 30 min."),
        ("10\" touchscreen calibrated", "MAJOR", "Tap calibration target points."),
        ("Compartment door lock verified", "MAJOR", "Confirm only released after dispense.")
    ],
    "BVC-HFB-01": [
        ("Heating element reaches 60°C within 10 min", "CRITICAL", "Cold start; monitor with thermocouple."),
        ("PID controller maintains ±2°C steady state", "CRITICAL", "Hold for 30 min; record swing."),
        ("All 4 thermal sensors read within ±1°C", "CRITICAL", "Cross-check with calibrated probe."),
        ("Door seal silicone intact, no gaps", "MAJOR", "Visual + paper-test (paper should not slide through closed door)."),
        ("Conveyor servo motor moves smoothly", "MAJOR", "Run conveyor through full cycle 3 times."),
        ("Touchscreen + ordering UI responsive", "MAJOR", "Place mock order, confirm flow."),
        ("Stainless inner liner free of dents/damage", "MINOR", "Visual inspection."),
        ("Power draw within 1.6kW peak spec", "MAJOR", "Measure during heat-up cycle.")
    ],
    "BVC-CSM-01": [
        ("All 18 dispensing motors functional", "CRITICAL", "Test each motor."),
        ("15\" touchscreen calibrated", "MAJOR", "Tap calibration points."),
        ("Cashless payment terminal accepts UPI + card", "CRITICAL", "Run test transactions."),
        ("Internal LED uniform across all shelves", "MINOR", "Visual."),
        ("Tempered glass front clean + undamaged", "MAJOR", "Visual + tap test."),
        ("Lock cycle smooth", "MAJOR", "5 cycles."),
        ("End-to-end dispense + tray retrieval", "CRITICAL", "Buy 2 products.")
    ],
    "BVC-FNV-01": [
        ("Refrigeration holds 8°C within 30 min", "CRITICAL", "Run from empty; verify internal temp."),
        ("Humidity sensors read 60-70% RH", "MAJOR", "Compare to calibrated hygrometer."),
        ("Mister atomizer fires on schedule", "MAJOR", "Trigger via UI; observe spray."),
        ("All 24 locker compartments open + close", "CRITICAL", "Cycle each compartment 2 times."),
        ("Touchscreen responsive", "MAJOR", "Tap test."),
        ("Tempered glass front intact", "MAJOR", "Visual + tap."),
        ("Power draw within spec", "MAJOR", "Measure for 15 min.")
    ]
}


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


def _seed_projects(
    db: Session,
    vendor: Vendor,
    depts: dict
) -> int:

    # Need a customer to satisfy the FK
    customer = db.query(Customer).filter(
        Customer.VENDOR_ID == vendor.ID
    ).first()

    if not customer:

        customer = Customer(
            CUSTOMER_NAME="BVC24 Internal",
            PHONE="+91 422 4356565",
            EMAIL="info@bvc24.com",
            ADDRESS="Plot 16B, E&E Industrial Estate, Sitra, Coimbatore 641014",
            VENDOR_ID=vendor.ID
        )

        db.add(customer)

        db.commit()

        db.refresh(customer)

    created = 0

    for spec in BVC24_PROJECTS:

        existing = db.query(CustomerProject).filter(
            CustomerProject.PROJECT_NAME == spec["PROJECT_NAME"],
            CustomerProject.VENDOR_ID == vendor.ID
        ).first()

        if existing:

            # Backfill skills + priority if they were missing
            updated = False

            if not existing.SKILLS_REQUIRED:

                existing.SKILLS_REQUIRED = spec["SKILLS_REQUIRED"]

                updated = True

            if not existing.PRIORITY or existing.PRIORITY == "MEDIUM":

                existing.PRIORITY = spec["PRIORITY"]

                updated = True

            if updated:

                db.commit()

            continue

        project = CustomerProject(
            PROJECT_NAME=spec["PROJECT_NAME"],
            DESCRIPTION=spec["DESCRIPTION"],
            STATUS=spec["STATUS"],
            DEPARTMENT_ID=depts[spec["DEPT"]].ID,
            CUSTOMER_ID=customer.ID,
            SKILLS_REQUIRED=spec["SKILLS_REQUIRED"],
            PRIORITY=spec["PRIORITY"],
            VENDOR_ID=vendor.ID
        )

        db.add(project)

        created += 1

    db.commit()

    return created


def _seed_product_models(db: Session, vendor: Vendor) -> dict:
    """Returns {MODEL_CODE: ProductModel} for downstream WO seeding."""

    out = {}

    for spec in BVC24_PRODUCT_MODELS:

        existing = db.query(ProductModel).filter(
            ProductModel.VENDOR_ID == vendor.ID,
            ProductModel.MODEL_CODE == spec["MODEL_CODE"]
        ).first()

        if existing:

            out[spec["MODEL_CODE"]] = existing

            # Skip re-seeding BOM if it already has lines
            existing_bom_count = db.query(BOMItem).filter(
                BOMItem.PRODUCT_MODEL_ID == existing.ID
            ).count()

            if existing_bom_count == 0:

                for name, qty, unit in spec["bom"]:

                    db.add(BOMItem(
                        PRODUCT_MODEL_ID=existing.ID,
                        MATERIAL_NAME=name,
                        QUANTITY=qty,
                        UNIT=unit
                    ))

            continue

        model = ProductModel(
            MODEL_NAME=spec["MODEL_NAME"],
            MODEL_CODE=spec["MODEL_CODE"],
            CATEGORY=spec["CATEGORY"],
            DESCRIPTION=spec["DESCRIPTION"],
            ESTIMATED_BUILD_DAYS=spec["ESTIMATED_BUILD_DAYS"],
            STATUS="ACTIVE",
            VENDOR_ID=vendor.ID
        )

        db.add(model)

        db.flush()

        for name, qty, unit in spec["bom"]:

            db.add(BOMItem(
                PRODUCT_MODEL_ID=model.ID,
                MATERIAL_NAME=name,
                QUANTITY=qty,
                UNIT=unit
            ))

        out[spec["MODEL_CODE"]] = model

    db.commit()

    return out


def _seed_work_orders(
    db: Session,
    vendor: Vendor,
    models: dict
) -> int:
    """A handful of sample work orders covering different statuses
    so the production dashboard isn't empty on first load."""

    today = date.today()

    samples = [
        # (model_code, qty, status, planned_start, planned_end, notes)
        (
            "BVC-SBC-01", 12, "IN_PROGRESS",
            today, None,
            "Chennai metro stations — 12 combo machines"
        ),
        (
            "BVC-MED-01", 4, "IN_PROGRESS",
            today, None,
            "Apollo pharmacy pilot — Coimbatore"
        ),
        (
            "BVC-HFB-01", 6, "PLANNED",
            None, None,
            "Salem retail group hot food vending"
        ),
        (
            "BVC-FNV-01", 8, "PLANNED",
            None, None,
            "Karur installation drive batch"
        ),
        (
            "BVC-CSM-01", 3, "DONE",
            None, today,
            "Salem cosmetics kiosk pilot completed"
        )
    ]

    created = 0

    for code, qty, status, p_start, p_end, notes in samples:

        model = models.get(code)

        if not model:

            continue

        existing = db.query(WorkOrder).filter(
            WorkOrder.VENDOR_ID == vendor.ID,
            WorkOrder.PRODUCT_MODEL_ID == model.ID,
            WorkOrder.NOTES == notes
        ).first()

        if existing:

            continue

        wo_year = datetime.utcnow().year

        wo_count_this_year = db.query(WorkOrder).filter(
            WorkOrder.VENDOR_ID == vendor.ID
        ).count()

        wo = WorkOrder(
            WO_NUMBER=f"WO-{wo_year}-{wo_count_this_year + 1:04d}",
            PRODUCT_MODEL_ID=model.ID,
            PROJECT_ID=None,
            QUANTITY=qty,
            STATUS=status,
            PLANNED_START_DATE=p_start,
            PLANNED_END_DATE=p_end,
            ACTUAL_START_DATE=(
                today if status in ("IN_PROGRESS", "DONE") else None
            ),
            ACTUAL_END_DATE=today if status == "DONE" else None,
            NOTES=notes,
            VENDOR_ID=vendor.ID
        )

        db.add(wo)

        db.flush()

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


def _seed_process_stages(
    db: Session,
    models: dict
) -> int:
    """Apply COMMON_STAGES to every model that doesn't have stages yet."""

    created = 0

    for code, model in models.items():

        existing = db.query(ProcessStage).filter(
            ProcessStage.PRODUCT_MODEL_ID == model.ID
        ).count()

        if existing > 0:

            continue

        for seq, name, stage_type, hours, desc in COMMON_STAGES:

            db.add(ProcessStage(
                PRODUCT_MODEL_ID=model.ID,
                SEQUENCE=seq,
                STAGE_NAME=name,
                STAGE_TYPE=stage_type,
                ESTIMATED_HOURS=hours,
                DESCRIPTION=desc,
                IS_ACTIVE=1
            ))

            created += 1

    db.commit()

    return created


def _classify_existing_bom(
    db: Session,
    vendor: Vendor,
    suppliers: dict,
    models: dict
) -> int:
    """
    For every BOM item that's still default PURCHASE with no
    supplier set, try to assign a supplier from BOM_SUPPLIER_HINTS.
    Lines that match BOM_PROCESS_KEYWORDS get converted to PROCESS
    and pointed at the first MECHANICAL/FABRICATION stage.
    """

    updated = 0

    for model in models.values():

        # Find the "in-house fabrication" stage for this model
        fab_stage = (
            db.query(ProcessStage)
            .filter(
                ProcessStage.PRODUCT_MODEL_ID == model.ID,
                ProcessStage.STAGE_TYPE.in_(
                    ["FABRICATION", "MECHANICAL"]
                )
            )
            .order_by(ProcessStage.SEQUENCE)
            .first()
        )

        bom_items = db.query(BOMItem).filter(
            BOMItem.PRODUCT_MODEL_ID == model.ID
        ).all()

        for item in bom_items:

            # Skip if already classified non-default
            if (
                item.PREFERRED_SUPPLIER_ID
                or item.PROCESS_STAGE_ID
            ):

                continue

            name_lower = (item.MATERIAL_NAME or "").lower()

            # First: in-house keywords?
            is_process = any(
                kw in name_lower for kw in BOM_PROCESS_KEYWORDS
            )

            if is_process and fab_stage:

                item.ITEM_TYPE = "PROCESS"

                item.PROCESS_STAGE_ID = fab_stage.ID

                updated += 1

                continue

            # Otherwise: supplier hints
            matched_supplier = None

            for keyword, sup_code in BOM_SUPPLIER_HINTS:

                if keyword in name_lower:

                    matched_supplier = suppliers.get(sup_code)

                    break

            if matched_supplier:

                item.ITEM_TYPE = "PURCHASE"

                item.PREFERRED_SUPPLIER_ID = matched_supplier.ID

                updated += 1

            else:

                # Leave as PURCHASE with no preferred supplier
                # so procurement can choose later.
                item.ITEM_TYPE = "PURCHASE"

    db.commit()

    return updated


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


def _spawn_existing_wo_stages(db: Session, vendor: Vendor) -> int:
    """Backfill stage progress for WorkOrders created before the
    process module existed."""

    wos = db.query(WorkOrder).filter(
        WorkOrder.VENDOR_ID == vendor.ID
    ).all()

    spawned = 0

    for wo in wos:

        existing = db.query(WorkOrderStageProgress).filter(
            WorkOrderStageProgress.WORK_ORDER_ID == wo.ID
        ).count()

        if existing > 0:

            continue

        stages = db.query(ProcessStage).filter(
            ProcessStage.PRODUCT_MODEL_ID == wo.PRODUCT_MODEL_ID,
            ProcessStage.IS_ACTIVE == 1
        ).all()

        for stage in stages:

            # Mark all stages DONE for the already-DONE WO so
            # the demo dashboard reflects completed history.
            status = "DONE" if wo.STATUS == "DONE" else "PENDING"

            db.add(WorkOrderStageProgress(
                WORK_ORDER_ID=wo.ID,
                STAGE_ID=stage.ID,
                STATUS=status,
                COMPLETED_AT=(
                    datetime.utcnow() if status == "DONE" else None
                )
            ))

            spawned += 1

    db.commit()

    return spawned


def _seed_qc_checklists(
    db: Session,
    vendor: Vendor,
    models: dict
) -> int:

    created = 0

    for code, items in BVC24_QC_CHECKLISTS.items():

        model = models.get(code)

        if not model:

            continue

        existing_count = db.query(QCChecklistItem).filter(
            QCChecklistItem.PRODUCT_MODEL_ID == model.ID
        ).count()

        if existing_count > 0:

            continue

        for idx, (check_point, severity, description) in enumerate(
            items, start=1
        ):

            db.add(QCChecklistItem(
                PRODUCT_MODEL_ID=model.ID,
                SEQUENCE=idx,
                CHECK_POINT=check_point,
                DESCRIPTION=description,
                SEVERITY=severity,
                IS_ACTIVE=1
            ))

            created += 1

    db.commit()

    return created


def _seed_sample_inspection(
    db: Session,
    vendor: Vendor
) -> int:
    """One sample PASS inspection on the DONE work order so the
    Quality dashboard isn't empty on first load."""

    # Find the DONE Salem cosmetics kiosk WO
    done_wo = (
        db.query(WorkOrder)
        .filter(
            WorkOrder.VENDOR_ID == vendor.ID,
            WorkOrder.STATUS == "DONE"
        )
        .first()
    )

    if not done_wo:

        return 0

    # Skip if an inspection already exists for this WO
    existing = (
        db.query(QCInspection)
        .filter(QCInspection.WORK_ORDER_ID == done_wo.ID)
        .first()
    )

    if existing:

        return 0

    # Saranya (QA) as inspector
    inspector = (
        db.query(Employee)
        .filter(Employee.EMPLOYEE_CODE == "BVC004")
        .first()
    )

    items = (
        db.query(QCChecklistItem)
        .filter(
            QCChecklistItem.PRODUCT_MODEL_ID == done_wo.PRODUCT_MODEL_ID,
            QCChecklistItem.IS_ACTIVE == 1
        )
        .order_by(QCChecklistItem.SEQUENCE)
        .all()
    )

    if not items:

        return 0

    inspection = QCInspection(
        WORK_ORDER_ID=done_wo.ID,
        PRODUCT_MODEL_ID=done_wo.PRODUCT_MODEL_ID,
        INSPECTOR_ID=inspector.ID if inspector else None,
        INSPECTION_DATE=date.today(),
        STATUS="PASS",
        PASS_COUNT=len(items),
        FAIL_COUNT=0,
        REWORK_COUNT=0,
        NOTES="Demo seed — all points passed pre-dispatch QC.",
        VENDOR_ID=vendor.ID
    )

    db.add(inspection)

    db.flush()

    for item in items:

        db.add(QCInspectionResult(
            INSPECTION_ID=inspection.ID,
            CHECKLIST_ITEM_ID=item.ID,
            CHECK_POINT=item.CHECK_POINT,
            RESULT="PASS"
        ))

    db.commit()

    return 1


@router.post("/seed-bvc24")
def seed_bvc24(db: Session = Depends(get_db), _: dict = Depends(get_current_admin)):

    vendor = _get_or_create_vendor(db)

    role = _get_or_create_role(db, vendor)

    depts = _seed_departments(db, vendor)

    new_employees = _seed_employees(db, vendor, role, depts)

    new_projects = _seed_projects(db, vendor, depts)

    models = _seed_product_models(db, vendor)

    suppliers = _seed_suppliers(db, vendor)

    new_stages = _seed_process_stages(db, models)

    new_work_orders = _seed_work_orders(db, vendor, models)

    new_qc_items = _seed_qc_checklists(db, vendor, models)

    new_inspections = _seed_sample_inspection(db, vendor)

    classified_bom = _classify_existing_bom(
        db, vendor, suppliers, models
    )

    spawned_stages = _spawn_existing_wo_stages(db, vendor)

    new_leave_balances = _seed_leave_balances(db, vendor)

    return {
        "message": "BVC24 demo data ready",
        "vendor_id": vendor.ID,
        "departments": len(depts),
        "new_employees": new_employees,
        "new_projects": new_projects,
        "product_models": len(models),
        "suppliers": len(suppliers),
        "new_process_stages": new_stages,
        "new_work_orders": new_work_orders,
        "wo_stage_rows_spawned": spawned_stages,
        "bom_items_classified": classified_bom,
        "new_qc_checklist_items": new_qc_items,
        "new_inspections": new_inspections,
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
