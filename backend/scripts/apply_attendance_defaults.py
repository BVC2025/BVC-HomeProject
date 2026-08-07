"""
apply_attendance_defaults.py  —  Stage A one-shot.

Pushes the new attendance defaults onto your LIVE database rows:
  • Office hours       9:15 AM  →  6:00 PM
  • Geofence radius    50 m

The Python defaults in models / services only apply to fresh installs.
This script updates the existing rows so the new values take effect on
your running system without needing to wipe the DB.

Idempotent: re-running it just re-sets the same values.

Usage:
  cd backend
  .\\venv\\Scripts\\python.exe -m scripts.apply_attendance_defaults
"""

import sys

from app.database.database import SessionLocal
from app.models.models import GeofenceSettings
from app.services.attendance_settings_service import (
    KEY_START, KEY_END, _set_value, _get_value,
)


def main() -> int:

    db = SessionLocal()

    try:

        print()
        print("=== Attendance defaults — Stage A ===")
        print()

        # ---- 1. Office hours (Setting rows) ---------------------------
        before_start = _get_value(db, KEY_START) or "(unset)"
        before_end   = _get_value(db, KEY_END)   or "(unset)"

        _set_value(db, KEY_START, "09:15")
        _set_value(db, KEY_END,   "18:00")

        db.commit()

        print(f"Office start:  {before_start:>10}  ->  09:15")
        print(f"Office end:    {before_end:>10}  ->  18:00")

        # ---- 2. Geofence radius (GeofenceSettings row(s)) -------------
        rows = db.query(GeofenceSettings).all()

        if not rows:
            print()
            print("No GeofenceSettings rows yet — admin must configure")
            print("office lat/lng via /geofence page before check-in works.")
        else:
            print()
            for r in rows:
                before = r.RADIUS_METERS
                r.RADIUS_METERS = 50
                print(
                    f"Geofence v{r.VENDOR_ID}  '{r.OFFICE_NAME or '-'}'  "
                    f"radius {before} m  ->  50 m"
                )

            db.commit()

        print()
        print("Done. Restart the backend so the cached office_hours are")
        print("re-read on the next check-in.")
        print()
        return 0

    except Exception as e:

        db.rollback()
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    finally:

        db.close()


if __name__ == "__main__":
    sys.exit(main())
