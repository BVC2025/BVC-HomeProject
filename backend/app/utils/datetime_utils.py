"""Timezone-aware datetime helper — returns naive IST datetime for DB storage."""
from datetime import datetime

try:
    from zoneinfo import ZoneInfo
    _IST = ZoneInfo("Asia/Kolkata")

    def now_ist() -> datetime:
        """Return current time in IST as a naive datetime (no tzinfo) for MySQL storage."""
        return datetime.now(_IST).replace(tzinfo=None)

except ImportError:
    try:
        import pytz
        _IST = pytz.timezone("Asia/Kolkata")

        def now_ist() -> datetime:
            return datetime.now(_IST).replace(tzinfo=None)

    except ImportError:
        from datetime import timedelta

        def now_ist() -> datetime:
            return datetime.utcnow() + timedelta(hours=5, minutes=30)
