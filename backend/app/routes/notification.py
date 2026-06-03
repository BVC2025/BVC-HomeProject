from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, time

from app.database.database import get_db

from app.models.models import (
    Notification,
    Inventory,
    Task,
    Machine,
    TaskAssignment,
    Employee,
    Setting
)

from app.schemas.notification_schema import (
    NotificationCreate
)

from app.services.email_service import (
    send_alert_email,
    build_alert_html,
    is_smtp_configured
)

from app.routes.settings import (
    is_email_alerts_enabled
)

router = APIRouter()


LOW_STOCK_THRESHOLD = 10

CRITICAL_TYPES = {"ERROR", "WARNING"}


def _maybe_send_email(db, title, message, alert_type):

    if alert_type not in CRITICAL_TYPES:

        return

    if not is_email_alerts_enabled(db):

        return

    if not is_smtp_configured():

        return

    try:

        html = build_alert_html(
            title,
            message,
            alert_type
        )

        send_alert_email(
            f"[Bharath ERP] {title}",
            html
        )

    except Exception as e:

        print(f"Email send failed: {e}")


# =========================
# CREATE NOTIFICATION
# =========================

@router.post("/create-notification")
def create_notification(
    data: NotificationCreate,
    db: Session = Depends(get_db)
):

    alert_type = (data.TYPE or "INFO").upper()

    notif = Notification(
        TITLE=data.TITLE,
        MESSAGE=data.MESSAGE,
        TYPE=alert_type,
        VENDOR_ID=data.VENDOR_ID,
        CREATED_AT=datetime.utcnow()
    )

    db.add(notif)

    db.commit()

    db.refresh(notif)

    _maybe_send_email(
        db,
        data.TITLE,
        data.MESSAGE,
        alert_type
    )

    return {
        "message": "Notification created",
        "id": notif.ID
    }


# =========================
# LIST NOTIFICATIONS
# =========================

@router.get("/notifications")
def list_notifications(
    db: Session = Depends(get_db)
):

    rows = db.query(Notification).order_by(
        Notification.CREATED_AT.desc()
    ).limit(100).all()

    return [
        {
            "ID": n.ID,
            "TITLE": n.TITLE,
            "MESSAGE": n.MESSAGE,
            "TYPE": n.TYPE,
            "IS_READ": bool(n.IS_READ),
            "CREATED_AT": (
                n.CREATED_AT.isoformat()
                if n.CREATED_AT else None
            )
        }
        for n in rows
    ]


# =========================
# UNREAD COUNT
# =========================

@router.get("/notifications/unread-count")
def unread_count(
    db: Session = Depends(get_db)
):

    count = db.query(Notification).filter(
        Notification.IS_READ == 0
    ).count()

    return {"count": count}


# =========================
# MARK READ
# =========================

@router.put("/notifications/{notif_id}/read")
def mark_read(
    notif_id: int,
    db: Session = Depends(get_db)
):

    notif = db.query(Notification).filter(
        Notification.ID == notif_id
    ).first()

    if not notif:

        raise HTTPException(
            status_code=404,
            detail="Notification not found"
        )

    notif.IS_READ = 1

    db.commit()

    return {"message": "Marked as read"}


# =========================
# MARK ALL READ
# =========================

@router.put("/notifications/mark-all-read")
def mark_all_read(
    db: Session = Depends(get_db)
):

    db.query(Notification).filter(
        Notification.IS_READ == 0
    ).update({Notification.IS_READ: 1})

    db.commit()

    return {"message": "All marked as read"}


# =========================
# DELETE NOTIFICATION
# =========================

@router.delete("/notifications/{notif_id}")
def delete_notification(
    notif_id: int,
    db: Session = Depends(get_db)
):

    notif = db.query(Notification).filter(
        Notification.ID == notif_id
    ).first()

    if not notif:

        raise HTTPException(
            status_code=404,
            detail="Notification not found"
        )

    db.delete(notif)

    db.commit()

    return {"message": "Notification deleted"}


# =========================
# GENERATE SYSTEM ALERTS
# =========================

@router.post("/notifications/generate")
def generate_system_alerts(
    db: Session = Depends(get_db)
):

    created = 0

    new_alerts = []

    low_stock = db.query(Inventory).filter(
        Inventory.QUANTITY <= LOW_STOCK_THRESHOLD
    ).all()

    for item in low_stock:

        title = "Low Stock Alert"

        msg = (
            f"{item.MATERIAL_NAME} has only "
            f"{item.QUANTITY} units left."
        )

        if not _notification_exists(db, title, msg):

            db.add(Notification(
                TITLE=title,
                MESSAGE=msg,
                TYPE="WARNING",
                VENDOR_ID=item.VENDOR_ID
            ))

            new_alerts.append((title, msg, "WARNING"))

            created += 1

    down_machines = db.query(Machine).filter(
        Machine.STATUS == "DOWN"
    ).all()

    for m in down_machines:

        title = "Machine Down"

        msg = (
            f"{m.MACHINE_NAME} is reported DOWN."
        )

        if not _notification_exists(db, title, msg):

            db.add(Notification(
                TITLE=title,
                MESSAGE=msg,
                TYPE="ERROR",
                VENDOR_ID=m.VENDOR_ID
            ))

            new_alerts.append((title, msg, "ERROR"))

            created += 1

    pending = db.query(Task).filter(
        Task.STATUS == "PENDING"
    ).count()

    if pending >= 10:

        title = "Backlog Warning"

        msg = (
            f"You have {pending} pending tasks. "
            "Consider re-prioritising."
        )

        if not _notification_exists(db, title, msg):

            db.add(Notification(
                TITLE=title,
                MESSAGE=msg,
                TYPE="INFO"
            ))

            new_alerts.append((title, msg, "INFO"))

            created += 1

    # =========================
    # 6 PM EMPLOYEE PENDING-TASK ALERTS
    # One WARNING per employee whose today's task is still
    # not COMPLETED after 18:00 local time. Date is embedded
    # in the message so the same employee won't re-alert the
    # same day, but a fresh alert fires the next evening.
    # =========================

    now = datetime.now()

    six_pm = time(18, 0)

    if now.time() >= six_pm:

        today_str = now.strftime("%Y-%m-%d")

        today_date = now.date()

        pending_rows = db.query(
            TaskAssignment,
            Employee.NAME,
            Employee.EMPLOYEE_CODE
        ).join(
            Employee,
            TaskAssignment.EMPLOYEE_ID == Employee.ID
        ).filter(
            TaskAssignment.ASSIGNED_DATE == today_date,
            TaskAssignment.TASK_STATUS != "COMPLETED"
        ).all()

        for assignment, emp_name, emp_code in pending_rows:

            title = "End-of-Day Pending Task"

            msg = (
                f"{today_str} — {emp_name} "
                f"({emp_code}) has not "
                f"completed today's task: "
                f"'{assignment.TASK_NAME}'. "
                f"Current status: {assignment.TASK_STATUS}."
            )

            already = db.query(Notification).filter(
                Notification.TITLE == title,
                Notification.MESSAGE == msg
            ).first()

            if not already:

                db.add(Notification(
                    TITLE=title,
                    MESSAGE=msg,
                    TYPE="WARNING"
                ))

                new_alerts.append((title, msg, "WARNING"))

                created += 1

    db.commit()

    for title, msg, alert_type in new_alerts:

        _maybe_send_email(db, title, msg, alert_type)

    return {
        "message": "System alerts generated",
        "created": created
    }


def _notification_exists(db, title, message):

    return db.query(Notification).filter(
        Notification.TITLE == title,
        Notification.MESSAGE == message,
        Notification.IS_READ == 0
    ).first() is not None
