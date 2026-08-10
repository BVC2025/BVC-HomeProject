"""
backfill_root_users.py  —  Part 1, Phase 3.

Creates exactly one RootUser per existing Vendor that doesn't already
have one. Idempotent — re-running skips vendors that already have a
root user (enforced at the DB level too, via the unique index on
root_user.VENDOR_ID).

A random password is generated for each new root user and printed
ONCE — it is bcrypt-hashed before storage and cannot be recovered
afterwards, so capture it immediately (or reset it via a future
password-reset flow).

Usage
-----
  python -m scripts.backfill_root_users             # create + print credentials
  python -m scripts.backfill_root_users --dry-run    # report what would be created

Exit codes
----------
  0  success
  1  fatal
"""

import argparse
import secrets
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from app.database.database import SessionLocal
from app.models.models import Vendor
from app.models.rbac_models import RootUser
from app.services.auth_service import hash_password


def _generate_password() -> str:
    # 16 URL-safe chars — plenty of entropy for a one-time-shown,
    # immediately-changeable initial credential.
    return secrets.token_urlsafe(12)


def main() -> int:
    p = argparse.ArgumentParser(description="Create one RootUser per Vendor lacking one.")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    db = SessionLocal()
    try:
        vendors = db.query(Vendor).all()
        existing_vendor_ids = {r.VENDOR_ID for r in db.query(RootUser).all()}

        created = []

        for vendor in vendors:

            if vendor.ID in existing_vendor_ids:
                continue

            email = f"root+vendor{vendor.ID}@bvc24.local"
            password = _generate_password()

            if args.dry_run:
                created.append((vendor.ID, vendor.VENDOR_NAME, email, "<dry-run, not generated>"))
                continue

            root = RootUser(
                EMAIL=email,
                PASSWORD=hash_password(password),
                STATUS="ACTIVE",
                VENDOR_ID=vendor.ID,
            )
            db.add(root)
            db.commit()

            created.append((vendor.ID, vendor.VENDOR_NAME, email, password))

        if not created:
            print("Every existing vendor already has a Root User. Nothing to do.")
            return 0

        print(f"{'VENDOR_ID':<12}{'VENDOR_NAME':<30}{'EMAIL':<35}{'PASSWORD (capture now!)'}")
        print("-" * 110)
        for vendor_id, name, email, password in created:
            print(f"{vendor_id:<12}{(name or '-'):<30}{email:<35}{password}")

        if args.dry_run:
            print(f"\ndry-run: would create {len(created)} root user(s)")
        else:
            print(f"\ncommitted: created {len(created)} root user(s) — passwords shown above will NOT be shown again")

        return 0

    except Exception as e:
        db.rollback()
        print(f"FATAL: {type(e).__name__}: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
