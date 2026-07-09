"""
list_essl_users.py — print every user on the device and show which
ones are already mapped to an Employee via FINGERPRINT_ID.

Usage:
    cd backend
    .\\venv\\Scripts\\python.exe -m scripts.list_essl_users

Reads the same ESSL_DEVICE_* vars from .env that the bridge uses.
Read-only — never mutates the device or the DB.
"""

import os
import sys


def main() -> int:

    try:
        from zk import ZK
    except ImportError:
        print("pyzk not installed", file=sys.stderr)
        return 2

    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    from app.database.database import SessionLocal
    from app.models.models import Employee

    ip   = os.getenv("ESSL_DEVICE_IP",   "192.168.1.201")
    port = int(os.getenv("ESSL_DEVICE_PORT", "4370"))
    key  = int(os.getenv("ESSL_COMM_KEY", "0"))

    zk = ZK(ip, port=port, password=key, timeout=15)
    conn = None
    db = SessionLocal()

    try:
        conn = zk.connect()
        users = conn.get_users()

        # Sort by numeric user_id when possible
        def _sort_key(u):
            try:
                return (0, int(u.user_id))
            except (ValueError, TypeError):
                return (1, str(u.user_id))

        users.sort(key=_sort_key)

        # Pre-fetch all mapped employees so we don't hit the DB 24 times
        mapped = {}
        rows = (
            db.query(Employee)
            .filter(Employee.FINGERPRINT_ID.isnot(None))
            .all()
        )
        for e in rows:
            mapped[str(e.FINGERPRINT_ID)] = e

        print()
        print(f"{'user_id':>8}  {'device name':<20}  {'mapped to':<40}  status")
        print("-" * 90)

        unmapped_count = 0
        default_named  = 0

        for u in users:
            uid = str(u.user_id)
            dname = (u.name or "").strip() or "(blank)"
            is_default = dname.startswith("NN-")
            if is_default:
                default_named += 1

            emp = mapped.get(uid)
            if emp:
                mapped_str = f"{emp.EMPLOYEE_CODE} — {emp.NAME}"
                status = "✓ mapped"
            else:
                mapped_str = "(unmapped)"
                status = "  needs mapping"
                unmapped_count += 1

            print(f"{uid:>8}  {dname:<20}  {mapped_str:<40}  {status}")

        print()
        print(f"Total users on device : {len(users)}")
        print(f"Already mapped        : {len(users) - unmapped_count}")
        print(f"Needs mapping         : {unmapped_count}")
        print(f"With default 'NN-XX'  : {default_named}   (HR must identify)")
        print()

        if unmapped_count:
            print("To map an employee, run SQL like:")
            print("  UPDATE employee SET FINGERPRINT_ID = '4'")
            print("  WHERE EMPLOYEE_CODE = 'EMP103';")

        return 0

    except Exception as e:
        print(f"FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    finally:
        if conn:
            try:
                conn.disconnect()
            except Exception:
                pass
        db.close()


if __name__ == "__main__":
    sys.exit(main())
