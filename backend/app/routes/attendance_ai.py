"""
Attendance Automation — AI/rule-driven attendance monitoring.

Purpose:
  Scan the last 30 days of attendance per employee and raise alerts when a
  pattern breaches thresholds. Two consumption surfaces:
    - GET  /attendance-ai/alerts       (HR / manager dashboard)
    - POST /attendance-ai/scan         (idempotent manual + cron trigger)

Design:
  - Thresholds live in code (easy to tune later from settings).
  - Alerts deduplicated by UNIQUE(EMPLOYEE_ID, ALERT_KEY, ALERT_DATE) so
    running the scanner multiple times a day never spams.
  - Each new alert ALSO writes a row to Notification so it surfaces in the
    bell icon without any UI plumbing.
"""

from datetime import date, datetime, timedelta
from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin, get_current_user
from app.models.models import (
    Employee, Attendance, AttendanceAlert, Notification,
)


router = APIRouter(prefix="/attendance-ai", tags=["attendance-ai"])


# =====================================================================
# Thresholds — tune here without DB changes.
# =====================================================================

class Thresholds:
    WINDOW_DAYS = 30
    LATE_COUNT_WARN     = 3
    LATE_COUNT_CRITICAL = 6
    ABSENT_COUNT_WARN     = 2
    ABSENT_COUNT_CRITICAL = 4
    EARLY_EXIT_WARN       = 3
    OT_HOURS_WARN_PER_DAY = 3.0   # any single day with > 3h OT
    OT_HOURS_WARN_TOTAL   = 12.0  # cumulative OT over the window


# =====================================================================
# Pydantic schemas
# =====================================================================


class AlertOut(BaseModel):
    id: int
    employee_id: str
    employee_code: Optional[str] = None
    employee_name: str
    alert_key: str
    severity: str
    alert_date: date
    window_days: int
    metric_value: Optional[float] = None
    threshold: Optional[float] = None
    title: str
    detail: Optional[str] = None
    status: str


class ScanResultOut(BaseModel):
    scanned_employees: int
    alerts_created: int
    alerts_deduplicated: int
    window_days: int
    ran_at: datetime


class EmployeeAttendanceProfile(BaseModel):
    """Per-employee summary used by the dashboard widget."""
    employee_id: str
    employee_code: Optional[str] = None
    employee_name: str
    late_count: int
    absent_count: int
    early_exit_count: int
    on_time_count: int
    total_records: int
    on_time_pct: float
    open_alerts: int
    risk_score: float   # 0-100 — higher = more concerning


# =====================================================================
# Service: AttendanceMonitor
# =====================================================================


class AttendanceMonitor:
    """Deterministic rule engine. Not LLM-based — these patterns are
    crisp and benefit from being predictable, not creative.

    LLM layer can be added on top later for natural-language alert
    summaries; the *detection* itself should stay deterministic so HR
    audits remain reproducible."""

    def __init__(self, db: Session, vendor_id: int):
        self.db = db
        self.vendor_id = vendor_id
        self.today = date.today()
        self.window_start = self.today - timedelta(days=Thresholds.WINDOW_DAYS)

    # ---- public API --------------------------------------------------

    def scan_all(self) -> ScanResultOut:
        emps = (self.db.query(Employee)
                .filter(Employee.VENDOR_ID == self.vendor_id,
                        Employee.STATUS == "ACTIVE").all())
        created = 0
        deduped = 0
        for emp in emps:
            c, d = self._scan_one(emp)
            created += c
            deduped += d
        self.db.commit()
        return ScanResultOut(
            scanned_employees=len(emps), alerts_created=created,
            alerts_deduplicated=deduped, window_days=Thresholds.WINDOW_DAYS,
            ran_at=datetime.utcnow(),
        )

    def profile(self, emp: Employee) -> EmployeeAttendanceProfile:
        rows = self._load_attendance(emp.ID)
        late    = sum(1 for r in rows if (r.STATUS or "").upper() == "LATE")
        absent  = sum(1 for r in rows if (r.STATUS or "").upper() == "ABSENT")
        early   = sum(1 for r in rows if (r.STATUS or "").upper() == "EARLY_EXIT")
        ontime  = sum(1 for r in rows if (r.STATUS or "").upper() in ("PRESENT", "ON_TIME"))
        total   = len(rows)
        ontime_pct = round(ontime * 100 / total, 1) if total else 0.0

        open_alerts = (self.db.query(AttendanceAlert)
                       .filter(AttendanceAlert.EMPLOYEE_ID == emp.ID,
                               AttendanceAlert.STATUS == "OPEN").count())

        # Naive risk score — weighted breach contributions, capped at 100.
        risk = min(100, (
            late * 8 + absent * 15 + early * 5 + open_alerts * 10
        ))

        return EmployeeAttendanceProfile(
            employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
            employee_name=emp.NAME or "",
            late_count=late, absent_count=absent, early_exit_count=early,
            on_time_count=ontime, total_records=total,
            on_time_pct=ontime_pct, open_alerts=open_alerts,
            risk_score=float(risk),
        )

    # ---- internals ---------------------------------------------------

    def _load_attendance(self, emp_id: str):
        return (self.db.query(Attendance)
                .filter(Attendance.EMPLOYEE_ID == emp_id,
                        Attendance.DATE >= self.window_start,
                        Attendance.DATE <= self.today).all())

    def _scan_one(self, emp: Employee) -> tuple[int, int]:
        rows = self._load_attendance(emp.ID)
        late_rows   = [r for r in rows if (r.STATUS or "").upper() == "LATE"]
        absent_rows = [r for r in rows if (r.STATUS or "").upper() == "ABSENT"]
        early_rows  = [r for r in rows if (r.STATUS or "").upper() == "EARLY_EXIT"]

        # Total OT — best-effort: not every Attendance row stores OT_HOURS.
        ot_total = 0.0
        ot_spikes = 0
        for r in rows:
            ot = getattr(r, "OT_HOURS", None) or 0.0
            try:
                ot = float(ot)
            except (TypeError, ValueError):
                ot = 0.0
            ot_total += ot
            if ot >= Thresholds.OT_HOURS_WARN_PER_DAY:
                ot_spikes += 1

        created = 0
        deduped = 0

        # 1. Late-arrival pattern
        if len(late_rows) >= Thresholds.LATE_COUNT_WARN:
            sev = "CRITICAL" if len(late_rows) >= Thresholds.LATE_COUNT_CRITICAL else "WARNING"
            c, d = self._raise_alert(
                emp, "LATE_PATTERN", sev,
                metric=len(late_rows), threshold=Thresholds.LATE_COUNT_WARN,
                title=f"{emp.NAME} was late {len(late_rows)} times in the last "
                      f"{Thresholds.WINDOW_DAYS} days",
                detail=(
                    f"Late arrivals: {len(late_rows)}. "
                    f"Threshold: {Thresholds.LATE_COUNT_WARN}+. "
                    f"Most recent: {max((r.DATE for r in late_rows), default='—')}. "
                    "Recommend a 1-on-1 conversation."
                ),
            )
            created += c; deduped += d

        # 2. Absenteeism pattern
        if len(absent_rows) >= Thresholds.ABSENT_COUNT_WARN:
            sev = "CRITICAL" if len(absent_rows) >= Thresholds.ABSENT_COUNT_CRITICAL else "WARNING"
            c, d = self._raise_alert(
                emp, "ABSENT_PATTERN", sev,
                metric=len(absent_rows), threshold=Thresholds.ABSENT_COUNT_WARN,
                title=f"{emp.NAME} was absent {len(absent_rows)} days in the last "
                      f"{Thresholds.WINDOW_DAYS} days",
                detail=(
                    f"Absences: {len(absent_rows)}. "
                    f"Threshold: {Thresholds.ABSENT_COUNT_WARN}+. "
                    "Check whether leave was applied for; flag to manager."
                ),
            )
            created += c; deduped += d

        # 3. Frequent early exits
        if len(early_rows) >= Thresholds.EARLY_EXIT_WARN:
            c, d = self._raise_alert(
                emp, "EARLY_EXIT_PATTERN", "WARNING",
                metric=len(early_rows), threshold=Thresholds.EARLY_EXIT_WARN,
                title=f"{emp.NAME} left early {len(early_rows)} times",
                detail="Confirm shift hours and recent workload.",
            )
            created += c; deduped += d

        # 4. OT abuse — either cumulative or single-day spikes
        if ot_total >= Thresholds.OT_HOURS_WARN_TOTAL or ot_spikes >= 3:
            sev = "WARNING"
            c, d = self._raise_alert(
                emp, "OT_ABUSE", sev,
                metric=ot_total, threshold=Thresholds.OT_HOURS_WARN_TOTAL,
                title=f"{emp.NAME} has logged {ot_total:.1f} OT hours in "
                      f"{Thresholds.WINDOW_DAYS} days",
                detail=(
                    f"Cumulative OT: {ot_total:.1f}h. "
                    f"Days with > {Thresholds.OT_HOURS_WARN_PER_DAY}h OT: {ot_spikes}. "
                    "Audit for burnout risk or timesheet inflation."
                ),
            )
            created += c; deduped += d

        return created, deduped

    def _raise_alert(self, emp: Employee, key: str, severity: str,
                     metric: float, threshold: float,
                     title: str, detail: str) -> tuple[int, int]:
        """Idempotent for (employee, key, today). Returns (created, deduped)."""
        existing = (self.db.query(AttendanceAlert)
                    .filter(AttendanceAlert.EMPLOYEE_ID == emp.ID,
                            AttendanceAlert.ALERT_KEY == key,
                            AttendanceAlert.ALERT_DATE == self.today).first())
        if existing:
            # Update metric in case it has changed
            existing.METRIC_VALUE = metric
            existing.SEVERITY = severity
            existing.DETAIL = detail
            return 0, 1

        alert = AttendanceAlert(
            EMPLOYEE_ID=emp.ID, ALERT_KEY=key, SEVERITY=severity,
            ALERT_DATE=self.today, WINDOW_DAYS=Thresholds.WINDOW_DAYS,
            METRIC_VALUE=metric, THRESHOLD=threshold,
            TITLE=title, DETAIL=detail, STATUS="OPEN",
            VENDOR_ID=emp.VENDOR_ID,
        )
        self.db.add(alert)
        # Also drop a bell-icon notification.
        self.db.add(Notification(
            TITLE=f"⚠ {title}",
            MESSAGE=detail[:255] if detail else None,
            TYPE="ATTENDANCE_ALERT",
            VENDOR_ID=emp.VENDOR_ID,
        ))
        return 1, 0


# =====================================================================
# Routes
# =====================================================================


@router.post("/scan", response_model=ScanResultOut)
def run_scan(db: Session = Depends(get_db),
             user: dict = Depends(get_current_admin)):
    """Manually trigger the monitor. Idempotent — safe to call repeatedly.
    Wire a cron to hit this once daily (e.g. 7am) for hands-off operation."""
    monitor = AttendanceMonitor(db, user.get("vendor_id", 1))
    return monitor.scan_all()


@router.get("/alerts", response_model=List[AlertOut])
def list_alerts(status: str = Query("OPEN"),
                severity: Optional[str] = None,
                limit: int = 50,
                db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)):
    vendor_id = user.get("vendor_id", 1)
    q = (db.query(AttendanceAlert, Employee)
         .join(Employee, AttendanceAlert.EMPLOYEE_ID == Employee.ID)
         .filter(AttendanceAlert.VENDOR_ID == vendor_id))
    if status != "ALL":
        q = q.filter(AttendanceAlert.STATUS == status)
    if severity:
        q = q.filter(AttendanceAlert.SEVERITY == severity)
    q = q.order_by(AttendanceAlert.SEVERITY.desc(),
                   AttendanceAlert.CREATED_AT.desc()).limit(limit)
    rows = q.all()
    return [AlertOut(
        id=a.ID, employee_id=e.ID, employee_code=e.EMPLOYEE_CODE,
        employee_name=e.NAME or "",
        alert_key=a.ALERT_KEY, severity=a.SEVERITY,
        alert_date=a.ALERT_DATE, window_days=a.WINDOW_DAYS,
        metric_value=a.METRIC_VALUE, threshold=a.THRESHOLD,
        title=a.TITLE, detail=a.DETAIL, status=a.STATUS,
    ) for a, e in rows]


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int,
                      db: Session = Depends(get_db),
                      user: dict = Depends(get_current_admin)):
    alert = db.get(AttendanceAlert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    alert.STATUS = "ACKNOWLEDGED"
    alert.ACKNOWLEDGED_BY_ID = user.get("employee_id")
    alert.ACKNOWLEDGED_AT = datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.post("/alerts/{alert_id}/dismiss")
def dismiss_alert(alert_id: int,
                  db: Session = Depends(get_db),
                  user: dict = Depends(get_current_admin)):
    alert = db.get(AttendanceAlert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    alert.STATUS = "DISMISSED"
    db.commit()
    return {"ok": True}


@router.get("/profile/{emp_id}", response_model=EmployeeAttendanceProfile)
def employee_profile(emp_id: str,
                     db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    emp = (db.query(Employee)
           .filter((Employee.ID == emp_id) | (Employee.EMPLOYEE_CODE == emp_id))
           .first())
    if not emp:
        raise HTTPException(404, "Employee not found")
    monitor = AttendanceMonitor(db, emp.VENDOR_ID)
    return monitor.profile(emp)


@router.get("/at-risk", response_model=List[EmployeeAttendanceProfile])
def at_risk_employees(limit: int = 20,
                      db: Session = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    """Top-N employees by attendance risk_score. Useful for the HR widget."""
    vendor_id = user.get("vendor_id", 1)
    monitor = AttendanceMonitor(db, vendor_id)
    emps = (db.query(Employee)
            .filter(Employee.VENDOR_ID == vendor_id,
                    Employee.STATUS == "ACTIVE").all())
    profiles = [monitor.profile(e) for e in emps]
    profiles.sort(key=lambda p: p.risk_score, reverse=True)
    return [p for p in profiles[:limit] if p.risk_score > 0]
