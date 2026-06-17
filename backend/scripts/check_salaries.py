"""
check_salaries.py  —  Diagnostic.

Prints two tables side by side:
  1. Employee.SALARY     — the persisted base salary (source of truth)
  2. Latest PayrollSlip   — what the UI shows; this is a snapshot taken
                            at the moment of payroll generation

If column 1 has values but column 2 still reads 0, the slips are stale
and need a Re-generate from the Payroll UI.

Usage:
  cd backend
  .\\venv\\Scripts\\python.exe -m scripts.check_salaries
"""

import sys
from sqlalchemy import desc

from app.database.database import SessionLocal
from app.models.models import Employee, PayrollSlip, PayrollRun


def main() -> int:

    db = SessionLocal()

    try:

        employees = db.query(Employee).filter(
            Employee.STATUS == "ACTIVE"
        ).order_by(Employee.EMPLOYEE_CODE).all()

        # latest run (any month) to compare slip snapshots against
        latest_run = db.query(PayrollRun).order_by(
            desc(PayrollRun.PAY_YEAR),
            desc(PayrollRun.PAY_MONTH)
        ).first()

        slips_by_emp = {}

        if latest_run:

            slips = db.query(PayrollSlip).filter(
                PayrollSlip.PAYROLL_RUN_ID == latest_run.ID
            ).all()

            for s in slips:

                slips_by_emp[s.EMPLOYEE_ID] = s

        period = (
            f"{latest_run.PAY_YEAR}-{latest_run.PAY_MONTH:02d}"
            if latest_run else "-"
        )

        print()
        print(f"Latest payroll run on disk: {period}")
        print()
        print(f"{'CODE':<10} {'NAME':<24} {'EMP.SALARY':>13}   {'SLIP.BASE_SALARY':>18}   {'SLIP.NET_PAY':>14}")
        print("-" * 88)

        for emp in employees:

            slip = slips_by_emp.get(emp.ID)

            emp_salary = float(emp.SALARY or 0)

            slip_base  = float(slip.BASE_SALARY or 0) if slip else None

            slip_net   = float(slip.NET_PAY or 0) if slip else None

            name = (emp.NAME or "")[:23]

            slip_base_str = f"Rs.{slip_base:>10,.0f}" if slip_base is not None else "-"

            slip_net_str  = f"Rs.{slip_net:>10,.0f}"  if slip_net  is not None else "-"

            flag = ""

            if slip_base is not None and emp_salary > 0 and abs(slip_base - emp_salary) > 1:

                flag = "  <- STALE (re-generate)"

            print(
                f"{emp.EMPLOYEE_CODE or '-':<10} {name:<24} "
                f"Rs.{emp_salary:>10,.0f}      {slip_base_str:>15}   {slip_net_str:>12}{flag}"
            )

        print("-" * 88)
        print()
        print("If any row shows STALE, open Payroll and click Re-generate to refresh the slips.")
        print()

        return 0

    except Exception as e:

        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)

        return 1

    finally:

        db.close()


if __name__ == "__main__":

    sys.exit(main())
