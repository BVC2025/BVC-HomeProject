"""Payslip request handler — points user at their newest payslip."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.models import Employee, PayrollRun, PayrollSlip
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


_MONTHS = ["", "January","February","March","April","May","June",
           "July","August","September","October","November","December"]


class PayslipHandler(BaseHandler):

    intent = "payslip_request"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:

        slots = session.slots
        for key in ("month", "year"):
            if entities.get(key) is not None and slots.get(key) is None:
                slots[key] = entities[key]

        q = (
            db.query(PayrollSlip, PayrollRun)
            .join(PayrollRun, PayrollSlip.PAYROLL_RUN_ID == PayrollRun.ID)
            .filter(PayrollSlip.EMPLOYEE_ID == employee.ID)
        )

        if slots.get("month"):
            try:
                q = q.filter(PayrollRun.PAY_MONTH == int(slots["month"]))
            except Exception:
                pass
        if slots.get("year"):
            try:
                q = q.filter(PayrollRun.PAY_YEAR == int(slots["year"]))
            except Exception:
                pass

        pair = (
            q.order_by(PayrollRun.PAY_YEAR.desc(), PayrollRun.PAY_MONTH.desc())
             .first()
        )

        session.active_intent = None; session.slots = {}

        if not pair:
            return HandlerReply(
                reply=(
                    "I couldn't find a matching payslip. Ask HR to generate one, "
                    "or check the Salary tab."
                ),
                conversation_complete=True,
                action_taken="payslip_missing",
            )

        slip, run = pair
        mname = _MONTHS[run.PAY_MONTH] if 1 <= (run.PAY_MONTH or 0) <= 12 else "—"
        net   = float(slip.NET_PAY or 0)
        return HandlerReply(
            reply=(
                f"Your {mname} {run.PAY_YEAR} payslip is ready — net pay "
                f"₹{net:,.2f}. Open the Salary tab to download the PDF."
            ),
            conversation_complete=True,
            action_taken="payslip_pointed",
        )
