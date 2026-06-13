"""
prune_audit_log.py  —  Weekly retention cleanup for audit_log.

The Phase 3 audit middleware writes ~1 row per mutation request.
Over time this table grows. Run weekly (e.g. Sunday 02:00) to drop
rows older than RETENTION_DAYS (default 180).

Usage
-----
  python -m scripts.prune_audit_log
  python -m scripts.prune_audit_log --days 90      # custom retention
  python -m scripts.prune_audit_log --dry-run

Compliance / auditing note
--------------------------
If your jurisdiction requires longer audit retention (e.g. 1+ year
for financial events), bump --days OR export to cold storage before
pruning. This script just deletes from the live table.

Exit codes
----------
  0  success
  1  fatal error
"""

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from app.database.database import SessionLocal
from app.models.models import AuditLog


DEFAULT_RETENTION_DAYS = 180


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Prune audit_log rows older than --days.")
    p.add_argument("--days", type=int, default=DEFAULT_RETENTION_DAYS,
                   help=f"Keep rows from the last N days (default {DEFAULT_RETENTION_DAYS}).")
    p.add_argument("--dry-run", action="store_true", help="Report what would be deleted but don't delete.")
    return p.parse_args()


def prune_audit_log(days: int, dry_run: bool = False) -> dict:

    if days < 1:
        raise ValueError(f"--days must be >= 1 (got {days})")

    cutoff = datetime.utcnow() - timedelta(days=days)

    db = SessionLocal()
    try:
        q = db.query(AuditLog).filter(AuditLog.CREATED_AT < cutoff)
        to_delete = q.count()

        if dry_run:
            return {
                "cutoff":        cutoff.isoformat(),
                "days":          days,
                "would_delete":  to_delete,
                "dry_run":       True,
            }

        deleted = q.delete(synchronize_session=False)
        db.commit()

        return {
            "cutoff":   cutoff.isoformat(),
            "days":     days,
            "deleted":  deleted,
            "dry_run":  False,
        }
    finally:
        db.close()


def main() -> int:
    args = _parse_args()
    started = datetime.utcnow()
    print(f"[prune_audit] {started.isoformat()}  days={args.days}  dry_run={args.dry_run}")

    try:
        result = prune_audit_log(args.days, dry_run=args.dry_run)
    except Exception as e:
        print(f"[prune_audit] FATAL: {type(e).__name__}: {e}")
        return 1

    elapsed_ms = int((datetime.utcnow() - started).total_seconds() * 1000)
    print(f"[prune_audit] done in {elapsed_ms}ms — {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
