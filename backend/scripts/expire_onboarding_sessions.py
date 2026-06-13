"""
expire_onboarding_sessions.py  —  Hourly onboarding cleanup.

Flips EmployeeOnboardingSession.STATUS from OPEN to EXPIRED for any
session whose EXPIRES_AT has passed. Without this, a candidate's
expired link still APPEARS active in the admin sessions list and
clutters the queue.

Usage
-----
  python -m scripts.expire_onboarding_sessions
  python -m scripts.expire_onboarding_sessions --dry-run

The matching public route (POST /employee-onboarding/{token}/login)
ALSO flips on access — this script just sweeps up sessions whose
candidate never came back.

Exit codes
----------
  0  success
  1  fatal error
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from app.database.database import SessionLocal
from app.models.models import EmployeeOnboardingSession


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Expire onboarding sessions past EXPIRES_AT.")
    p.add_argument("--dry-run", action="store_true", help="Report what would change but don't write.")
    return p.parse_args()


def expire_open_sessions(dry_run: bool = False) -> dict:

    db = SessionLocal()
    now = datetime.utcnow()
    try:
        candidates = (
            db.query(EmployeeOnboardingSession)
            .filter(EmployeeOnboardingSession.STATUS == "OPEN")
            .filter(EmployeeOnboardingSession.EXPIRES_AT.isnot(None))
            .filter(EmployeeOnboardingSession.EXPIRES_AT < now)
            .all()
        )

        if dry_run:
            return {
                "would_expire":   len(candidates),
                "would_expire_codes": [s.EMPLOYEE_CODE for s in candidates],
                "now":            now.isoformat(),
                "dry_run":        True,
            }

        flipped = 0
        for s in candidates:
            s.STATUS = "EXPIRED"
            flipped += 1

        db.commit()

        return {
            "expired":  flipped,
            "now":      now.isoformat(),
            "dry_run":  False,
        }
    finally:
        db.close()


def main() -> int:
    args = _parse_args()
    started = datetime.utcnow()
    print(f"[expire_onboarding] {started.isoformat()}  dry_run={args.dry_run}")

    try:
        result = expire_open_sessions(dry_run=args.dry_run)
    except Exception as e:
        print(f"[expire_onboarding] FATAL: {type(e).__name__}: {e}")
        return 1

    elapsed_ms = int((datetime.utcnow() - started).total_seconds() * 1000)
    print(f"[expire_onboarding] done in {elapsed_ms}ms — {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
