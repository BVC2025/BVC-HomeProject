"""
reset_admin_password.py

Resets the ADMIN account's password to a known value (default: 'admin123')
so you can log back in to the ERP frontend.

Usage (from backend dir, with venv active):
    .\\venv\\Scripts\\python.exe scripts\\reset_admin_password.py
    .\\venv\\Scripts\\python.exe scripts\\reset_admin_password.py --code ADMIN --password admin123
    .\\venv\\Scripts\\python.exe scripts\\reset_admin_password.py --list
"""

import argparse
import os
import sys

# Make `app.*` imports work when run as a script
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database.database import SessionLocal
from app.models.models import Employee, Role, Vendor
# Load sibling model modules so SQLAlchemy can resolve every
# relationship() target when it configures mappers on the first query.
# Without these, the first db.query(...) raises InvalidRequestError
# for names like 'InventoryCategory' that live outside models.models.
import app.models.inventory_models  # noqa: F401
import app.models.supplier_models   # noqa: F401
from app.services.auth_service import hash_password


ADMIN_ROLE_NAMES = {"SUPER_ADMIN", "ADMIN", "HR", "MANAGER", "PRODUCTION_HEAD"}


def list_admins(db):
    admin_role_ids = [
        r.ID for r in
        db.query(Role).filter(Role.NAME.in_(list(ADMIN_ROLE_NAMES))).all()
    ]

    if not admin_role_ids:
        print("No admin-style Role rows exist yet.")
        return

    rows = (
        db.query(Employee, Role)
          .join(Role, Employee.ROLE_ID == Role.ID)
          .filter(Role.ID.in_(admin_role_ids))
          .all()
    )
    if not rows:
        print("No employees with an admin role exist yet.")
        return

    print(f"{'CODE':<14}{'ROLE':<18}{'STATUS':<10}{'EMAIL'}")
    print("-" * 80)
    for emp, role in rows:
        print(f"{(emp.EMPLOYEE_CODE or '-'):<14}"
              f"{(role.NAME or '-'):<18}"
              f"{(emp.STATUS or '-'):<10}"
              f"{emp.EMAIL or '-'}")


def get_or_create_vendor(db):
    """Ensure at least one Vendor row exists (Employee + Role both FK
    to vendor.ID, and Role.VENDOR_ID is nullable=False). Returns the
    vendor with the lowest ID — normally the BVC default."""
    v = db.query(Vendor).order_by(Vendor.ID.asc()).first()
    if v:
        return v
    v = Vendor(VENDOR_NAME="Bharath Vending Corporation")
    db.add(v)
    db.commit()
    db.refresh(v)
    print(f"  Seeded default Vendor row (ID={v.ID}, name='{v.VENDOR_NAME}').")
    return v


def get_or_create_admin_role(db, vendor_id):
    role = (
        db.query(Role)
          .filter(Role.NAME == "ADMIN")
          .filter(Role.VENDOR_ID == vendor_id)
          .first()
    )
    if role:
        return role
    role = Role(
        NAME="ADMIN",
        DESCRIPTION="System administrator",
        IS_SYSTEM=1,
        VENDOR_ID=vendor_id,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    print(f"  Created ADMIN role (ID={role.ID}, vendor_id={vendor_id}).")
    return role


def reset(db, code, password):
    vendor = get_or_create_vendor(db)

    emp = (
        db.query(Employee)
          .filter(Employee.EMPLOYEE_CODE == code)
          .first()
    )

    if not emp:
        admin_role = get_or_create_admin_role(db, vendor.ID)
        print(f"No employee with EMPLOYEE_CODE='{code}'. Creating one with role ADMIN...")
        emp = Employee(
            EMPLOYEE_CODE=code,
            NAME="System Administrator",
            EMAIL=f"{code.lower()}@bvc24.local",
            STATUS="ACTIVE",
            PASSWORD=hash_password(password),
            ROLE_ID=admin_role.ID,
            VENDOR_ID=vendor.ID,
        )
        db.add(emp)
        db.commit()
        print(f"  Created. EMPLOYEE_CODE={code}, ROLE=ADMIN, VENDOR_ID={vendor.ID}, password set.")
        return

    emp.PASSWORD = hash_password(password)
    if (emp.STATUS or "").upper() != "ACTIVE":
        print(f"  Account was '{emp.STATUS}'. Flipping to ACTIVE.")
        emp.STATUS = "ACTIVE"

    # Also make sure VENDOR_ID is set on the existing row.
    if not emp.VENDOR_ID:
        emp.VENDOR_ID = vendor.ID
        print(f"  Attached to VENDOR_ID={vendor.ID}.")

    # Confirm role is admin-level; if not, promote.
    role = db.query(Role).filter(Role.ID == emp.ROLE_ID).first() if emp.ROLE_ID else None
    if not role or role.NAME not in ADMIN_ROLE_NAMES:
        admin_role = get_or_create_admin_role(db, vendor.ID)
        old = role.NAME if role else "<none>"
        print(f"  Role was '{old}' (not admin). Promoting to ADMIN.")
        emp.ROLE_ID = admin_role.ID

    db.commit()
    db.refresh(emp)
    final_role = db.query(Role).filter(Role.ID == emp.ROLE_ID).first()
    print(f"OK - password for EMPLOYEE_CODE='{code}' (role={final_role.NAME if final_role else '?'}) reset.")
    print(f"     Email: {emp.EMAIL or '-'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", default="ADMIN")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        if args.list:
            list_admins(db)
            return
        reset(db, args.code, args.password)
        print()
        print("Log in to the frontend with:")
        print(f"   Admin Code: {args.code}")
        print(f"   Password:   {args.password}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
