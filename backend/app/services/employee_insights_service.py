"""
EmployeeInsightsService — workforce analytics & risk predictions.

Five live insights per employee, computed deterministically from existing
tables (no ML training required for v1):

  1. Attrition Risk      — "likely to quit"
  2. Burnout Risk        — "overworked"
  3. Performance Trend   — "improving / stable / declining"
  4. Anomaly Detection   — per-employee z-score baselines
  5. Department Health   — composite department score

Design choices:
  - Rule-based weighted scoring. This is what BambooHR / Workday actually
    do in production — small per-company data volumes don't justify deep
    learning, and HR decisions need to be auditable + explainable for
    legal reasons.
  - Every signal contributes a known weight. Tunables live at the top of
    this file so HR can rebalance without code changes.
  - Confidence scores reflect "how many signals agree" — multi-signal
    alignment increases confidence.

The LLM is intentionally NOT in the hot path — predictions must be
reproducible across calls.
"""

from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
from statistics import mean, pstdev

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.models import (
    Employee, Department, Attendance, LeaveRequest, LeaveBalance,
    TaskAssignment, AttendanceAlert,
)

# ML layer — XGBoost classifiers + IsolationForest detector.
# Replaces the rule-based weighted-sum scoring of v1.
from app.services.ml_predictor import predictor as ML


# =====================================================================
# Tunables — change the company's "definition of risk" without touching code
# =====================================================================

class InsightsPolicy:
    # Rolling windows
    SHORT_WINDOW_DAYS  = 30
    MEDIUM_WINDOW_DAYS = 90

    # Attrition signal weights (sum can be anything; scores are normalised)
    ATTRITION_WEIGHTS = {
        "rising_late_count":         20,  # late count higher this month vs last
        "high_leave_utilisation":    20,  # uses > 70% of yearly balance
        "performance_decline":       25,  # task completion dropping
        "long_tenure_no_promotion":  15,  # > 18 months tenure stagnation
        "no_recent_overtime":        10,  # disengagement signal
        "absent_pattern":            10,  # > 2 absences in 30 days
    }

    # Burnout signal weights
    BURNOUT_WEIGHTS = {
        "high_overtime":             35,  # > 30 OT hours in last 30 days
        "low_leave_consumption":     20,  # < 20% leave used despite tenure
        "consecutive_workdays":      20,  # > 14 days without a break
        "weekend_work":              15,  # any Sunday check-in
        "late_evening_checkouts":    10,  # > 8 pm checkouts repeatedly
    }

    BURNOUT_TIERS = {
        "CRITICAL": 75,
        "AT_RISK":  55,
        "STRETCHED": 35,
    }

    ATTRITION_TIERS = {
        "HIGH":   70,
        "MEDIUM": 45,
        "LOW":    20,
    }

    DEPT_HEALTH_TIERS = {
        "HEALTHY":  75,
        "WATCH":    55,
        "AT_RISK":  35,
    }


# =====================================================================
# Output dataclasses (serialisable to JSON)
# =====================================================================


@dataclass
class SignalContribution:
    name: str
    triggered: bool
    weight: int
    value: Any = None
    explanation: str = ""


@dataclass
class AttritionInsight:
    employee_id: str
    employee_code: Optional[str]
    employee_name: str
    department: Optional[str]
    score: int
    tier: str
    confidence: float
    signals: List[SignalContribution]
    recommended_action: str


@dataclass
class BurnoutInsight:
    employee_id: str
    employee_code: Optional[str]
    employee_name: str
    department: Optional[str]
    score: int
    tier: str
    confidence: float
    overtime_hours_30d: float
    leave_utilisation_pct: float
    weekend_workdays_30d: int
    signals: List[SignalContribution]
    recommended_action: str


@dataclass
class PerformanceTrend:
    employee_id: str
    employee_code: Optional[str]
    employee_name: str
    trend: str            # IMPROVING / STABLE / DECLINING / INSUFFICIENT_DATA
    slope: float           # points per month
    current_score: float
    projected_next_month: float
    confidence: float
    summary: str


@dataclass
class AnomalyFinding:
    signal: str
    value: float
    baseline_mean: float
    baseline_std: float
    z_score: float
    verdict: str          # "Mild" / "Significant" / "Severe"


@dataclass
class AnomalyReport:
    employee_id: str
    employee_code: Optional[str]
    employee_name: str
    has_anomalies: bool
    anomalies: List[AnomalyFinding]
    recommended_action: str


@dataclass
class DepartmentHealth:
    department_id: int
    department_name: str
    headcount: int
    avg_attrition_risk: float
    avg_burnout_risk: float
    declining_performers: int
    anomaly_count: int
    health_score: int
    tier: str
    top_drivers: List[str]


# =====================================================================
# Service
# =====================================================================


class EmployeeInsightsService:

    def __init__(self, db: Session, vendor_id: int):
        self.db = db
        self.vendor_id = vendor_id
        self.today = date.today()
        self.short_start  = self.today - timedelta(days=InsightsPolicy.SHORT_WINDOW_DAYS)
        self.medium_start = self.today - timedelta(days=InsightsPolicy.MEDIUM_WINDOW_DAYS)
        self.month_start = self.today.replace(day=1)
        self.prev_month_start = (self.month_start - timedelta(days=1)).replace(day=1)
        # cache active employees once per service instance
        self._active_emps = None
        self._dept_map = None

    # ---- helpers ----------------------------------------------------

    def _active(self) -> List[Employee]:
        if self._active_emps is None:
            self._active_emps = (self.db.query(Employee)
                                  .filter(Employee.VENDOR_ID == self.vendor_id,
                                          Employee.STATUS == "ACTIVE").all())
        return self._active_emps

    def _dept_name(self, dept_id: Optional[int]) -> Optional[str]:
        if dept_id is None:
            return None
        if self._dept_map is None:
            self._dept_map = {d.ID: d.NAME for d in
                              self.db.query(Department)
                                .filter(Department.VENDOR_ID == self.vendor_id).all()}
        return self._dept_map.get(dept_id)

    def _attendance(self, emp_id: str, start: date) -> List[Attendance]:
        return (self.db.query(Attendance)
                .filter(Attendance.EMPLOYEE_ID == emp_id,
                        Attendance.DATE >= start,
                        Attendance.DATE <= self.today).all())

    def _leaves(self, emp_id: str, start: date) -> List[LeaveRequest]:
        return (self.db.query(LeaveRequest)
                .filter(LeaveRequest.EMPLOYEE_ID == emp_id,
                        LeaveRequest.STATUS == "APPROVED",
                        LeaveRequest.START_DATE >= start).all())

    # =================================================================
    # 1. ATTRITION RISK
    # =================================================================

    def attrition_risk(self, emp: Employee) -> AttritionInsight:
        """ML-driven attrition prediction.

        v1: features are extracted from existing tables and fed to an XGBoost
        binary classifier (predict_proba → probability of resignation in 90d).
        Feature importance is pulled from the trained model — surfaced in the
        signals list so HR sees WHICH features the model weighted most."""

        # ---- Extract the 10 features the model was trained on ------------
        # Boolean-flavoured signals (kept identical to v1 rule names so the
        # UI continues to render the explanation panel naturally).
        recent_late = sum(1 for a in self._attendance(emp.ID, self.short_start)
                          if (a.STATUS or "").upper() == "LATE")
        prev_window_lates = sum(1 for a in self._attendance(emp.ID, self.medium_start)
                                if (a.STATUS or "").upper() == "LATE"
                                and a.DATE < self.short_start) // 2
        rising_late = int(recent_late > max(prev_window_lates + 1, 2))

        bal = (self.db.query(LeaveBalance)
               .filter(LeaveBalance.EMPLOYEE_ID == emp.ID,
                       LeaveBalance.YEAR == self.today.year).first())
        utilisation = 0.0
        if bal:
            total = float((bal.CASUAL_TOTAL or 0) + (bal.SICK_TOTAL or 0) +
                          (bal.EARNED_TOTAL or 0))
            used = float((bal.CASUAL_USED or 0) + (bal.SICK_USED or 0) +
                         (bal.EARNED_USED or 0))
            utilisation = (used / total * 100) if total else 0.0
        high_leave = int(utilisation > 70)

        recent_tasks_done = (self.db.query(TaskAssignment)
                             .filter(TaskAssignment.EMPLOYEE_ID == emp.ID,
                                     TaskAssignment.TASK_STATUS == "COMPLETED",
                                     TaskAssignment.ASSIGNED_DATE >= self.short_start)
                             .count())
        prev_tasks_done = (self.db.query(TaskAssignment)
                           .filter(TaskAssignment.EMPLOYEE_ID == emp.ID,
                                   TaskAssignment.TASK_STATUS == "COMPLETED",
                                   TaskAssignment.ASSIGNED_DATE >= self.medium_start,
                                   TaskAssignment.ASSIGNED_DATE <  self.short_start)
                           .count()) // 2
        perf_decline = int(recent_tasks_done < prev_tasks_done * 0.6
                           and prev_tasks_done >= 3)

        tenure_months = self._tenure_months(emp)
        long_tenure_stuck = int(tenure_months >= 18)

        ot_30d = sum(float(getattr(a, "OVERTIME_HOURS", 0) or 0)
                     for a in self._attendance(emp.ID, self.short_start))
        no_ot = int(ot_30d < 0.5 and tenure_months >= 6)

        absences = sum(1 for a in self._attendance(emp.ID, self.short_start)
                       if (a.STATUS or "").upper() == "ABSENT")
        absent_pattern = int(absences >= 2)

        feature_dict = {
            "rising_late_count":         rising_late,
            "high_leave_utilisation":    high_leave,
            "performance_decline":       perf_decline,
            "long_tenure_no_promotion":  long_tenure_stuck,
            "no_recent_overtime":        no_ot,
            "absent_pattern":            absent_pattern,
            "tenure_months":             tenure_months,
            "late_count_30d":            recent_late,
            "leave_used_pct":            utilisation,
            "tasks_completed_30d":       recent_tasks_done,
        }

        # ---- ML prediction ---------------------------------------------
        prediction = ML.predict_attrition(feature_dict)

        # ---- Build the signal explanation list -------------------------
        # Each signal gets its weight from the *model's* feature_importances_
        # — so what HR sees mirrors what XGBoost actually used.
        explanations = {
            "rising_late_count":        f"Late {recent_late}× in last 30d (was ~{prev_window_lates} before)",
            "high_leave_utilisation":   f"{utilisation:.0f}% of yearly leave already used",
            "performance_decline":      (f"Completed {recent_tasks_done} tasks "
                                         f"(vs ~{prev_tasks_done} monthly before)"),
            "long_tenure_no_promotion": f"Tenure: {tenure_months} months without role change",
            "no_recent_overtime":       f"OT in last 30d: {ot_30d:.1f}h",
            "absent_pattern":           f"{absences} absence(s) in last 30 days",
        }
        triggered_flags = {
            "rising_late_count":        bool(rising_late),
            "high_leave_utilisation":   bool(high_leave),
            "performance_decline":      bool(perf_decline),
            "long_tenure_no_promotion": bool(long_tenure_stuck),
            "no_recent_overtime":       bool(no_ot),
            "absent_pattern":           bool(absent_pattern),
        }
        signals: List[SignalContribution] = []
        for name in triggered_flags:
            imp = prediction.feature_importance.get(name, 0.0)
            signals.append(SignalContribution(
                name=name,
                triggered=triggered_flags[name],
                weight=int(round(imp)),    # XGBoost-derived importance %
                value=feature_dict[name],
                explanation=explanations[name],
            ))

        action = self._attrition_action(prediction.tier, signals)

        return AttritionInsight(
            employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
            employee_name=emp.NAME or "",
            department=self._dept_name(emp.DEPARTMENT_ID),
            score=prediction.score,
            tier=prediction.tier,
            confidence=prediction.confidence,
            signals=signals,
            recommended_action=action,
        )

    def _attrition_action(self, tier: str, signals: List[SignalContribution]) -> str:
        if tier == "HIGH":
            return ("Schedule a retention 1-on-1 in the next 7 days. "
                    "Review compensation and role growth path.")
        if tier == "MEDIUM":
            return ("Manager check-in within 2 weeks. Discuss workload "
                    "and career direction.")
        if tier == "LOW":
            triggered = [s.name for s in signals if s.triggered]
            return ("Routine — no action needed." if not triggered
                    else f"Monitor: {', '.join(triggered[:2])}")
        return "No action needed."

    def attrition_all(self) -> List[AttritionInsight]:
        return [self.attrition_risk(e) for e in self._active()]

    # =================================================================
    # 2. BURNOUT RISK
    # =================================================================

    def burnout_risk(self, emp: Employee) -> BurnoutInsight:
        """ML-driven burnout prediction (XGBoost classifier)."""

        att_30d = self._attendance(emp.ID, self.short_start)

        # ---- Extract 7 features ----------------------------------------
        ot_total = sum(float(getattr(a, "OVERTIME_HOURS", 0) or 0) for a in att_30d)
        bal = (self.db.query(LeaveBalance)
               .filter(LeaveBalance.EMPLOYEE_ID == emp.ID,
                       LeaveBalance.YEAR == self.today.year).first())
        utilisation_pct = 0.0
        if bal:
            total = float((bal.CASUAL_TOTAL or 0) + (bal.SICK_TOTAL or 0) +
                          (bal.EARNED_TOTAL or 0))
            used = float((bal.CASUAL_USED or 0) + (bal.SICK_USED or 0) +
                         (bal.EARNED_USED or 0))
            utilisation_pct = (used / total * 100) if total else 0.0
        streak = self._consecutive_workdays(emp.ID)
        weekend_days = sum(1 for a in att_30d
                           if a.DATE and a.DATE.weekday() == 6
                           and (a.STATUS or "").upper() != "ABSENT")
        late_evenings = sum(1 for a in att_30d
                            if a.CHECK_OUT and a.CHECK_OUT.hour >= 20)
        late_count_30d = sum(1 for a in att_30d
                             if (a.STATUS or "").upper() == "LATE")
        tenure_months = self._tenure_months(emp)

        feature_dict = {
            "overtime_hours_30d":         round(ot_total, 1),
            "consecutive_workdays":       streak,
            "leave_utilisation_pct":      round(utilisation_pct, 1),
            "weekend_workdays_30d":       weekend_days,
            "late_evening_checkouts_30d": late_evenings,
            "late_count_30d":             late_count_30d,
            "tenure_months":              tenure_months,
        }

        prediction = ML.predict_burnout(feature_dict)

        # Friendly signal explanations driven by XGBoost importances.
        explanations = {
            "overtime_hours_30d":          f"{ot_total:.1f} OT hours in 30 days",
            "consecutive_workdays":        f"Working {streak} days without a break",
            "leave_utilisation_pct":       f"Only {utilisation_pct:.0f}% leave used this year",
            "weekend_workdays_30d":        f"Worked {weekend_days} Sunday(s) in 30 days",
            "late_evening_checkouts_30d":  f"{late_evenings} late-evening checkouts (after 8pm)",
            "late_count_30d":              f"{late_count_30d} late arrivals",
            "tenure_months":               f"Tenure: {tenure_months} months",
        }
        # Triggered = whether the value is "concerning"
        trigger_thresholds = {
            "overtime_hours_30d":          ot_total > 30,
            "consecutive_workdays":        streak > 14,
            "leave_utilisation_pct":       (utilisation_pct < 15
                                            and self.today.month >= 4),
            "weekend_workdays_30d":        weekend_days >= 1,
            "late_evening_checkouts_30d":  late_evenings >= 8,
            "late_count_30d":              late_count_30d >= 3,
            "tenure_months":               False,
        }
        signals: List[SignalContribution] = []
        for name in feature_dict:
            imp = prediction.feature_importance.get(name, 0.0)
            signals.append(SignalContribution(
                name=name,
                triggered=bool(trigger_thresholds[name]),
                weight=int(round(imp)),
                value=feature_dict[name],
                explanation=explanations[name],
            ))

        action = self._burnout_action(prediction.tier)

        return BurnoutInsight(
            employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
            employee_name=emp.NAME or "",
            department=self._dept_name(emp.DEPARTMENT_ID),
            score=prediction.score, tier=prediction.tier,
            confidence=prediction.confidence,
            overtime_hours_30d=round(ot_total, 1),
            leave_utilisation_pct=round(utilisation_pct, 1),
            weekend_workdays_30d=weekend_days,
            signals=signals,
            recommended_action=action,
        )

    def _burnout_action(self, tier: str) -> str:
        if tier == "CRITICAL":
            return ("Force 5-day leave this week. Redistribute workload. "
                    "Mandatory wellness conversation with manager.")
        if tier == "AT_RISK":
            return ("Encourage 2-3 day break in next 2 weeks. Manager "
                    "should review project deadlines for relief.")
        if tier == "STRETCHED":
            return "Monitor — schedule a check-in within a month."
        return "Healthy — no action needed."

    def burnout_all(self) -> List[BurnoutInsight]:
        return [self.burnout_risk(e) for e in self._active()]

    # =================================================================
    # 3. PERFORMANCE TREND
    # =================================================================

    def performance_trend(self, emp: Employee) -> PerformanceTrend:
        # Bucket task-completion + attendance over last 3 months
        buckets = self._monthly_perf_buckets(emp.ID, months=3)

        if all(b["score"] is None for b in buckets) or len(buckets) < 2:
            return PerformanceTrend(
                employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
                employee_name=emp.NAME or "",
                trend="INSUFFICIENT_DATA",
                slope=0.0, current_score=0.0,
                projected_next_month=0.0, confidence=0.1,
                summary="Not enough history to detect a trend (need ≥ 2 months of activity)."
            )

        scores = [b["score"] for b in buckets if b["score"] is not None]
        # Linear slope: pts per month
        n = len(scores)
        xs = list(range(n))
        x_mean = mean(xs); y_mean = mean(scores)
        num = sum((xs[i] - x_mean) * (scores[i] - y_mean) for i in range(n))
        den = sum((x - x_mean) ** 2 for x in xs) or 1
        slope = num / den
        current = scores[-1]
        projected = max(0.0, min(100.0, current + slope))

        # Variance → confidence
        try:
            variance = pstdev(scores)
        except Exception:
            variance = 0.0
        confidence = round(min(1.0, max(0.4, 1.0 - variance / 20)), 2)

        if slope > 2:
            trend, summary = "IMPROVING", f"Up ~{abs(slope):.1f} pts/month for 3 months."
        elif slope < -2:
            trend, summary = "DECLINING", f"Down ~{abs(slope):.1f} pts/month — investigate."
        else:
            trend, summary = "STABLE", "Performance broadly flat across the 3-month window."

        return PerformanceTrend(
            employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
            employee_name=emp.NAME or "",
            trend=trend, slope=round(slope, 2),
            current_score=round(current, 1),
            projected_next_month=round(projected, 1),
            confidence=confidence,
            summary=summary,
        )

    def _monthly_perf_buckets(self, emp_id: str, months: int) -> List[Dict[str, Any]]:
        out = []
        for back in range(months - 1, -1, -1):
            ref = self.today.replace(day=1) - timedelta(days=1)
            for _ in range(back):
                ref = ref.replace(day=1) - timedelta(days=1)
            month_first = ref.replace(day=1)
            month_last = ref

            att = (self.db.query(Attendance)
                   .filter(Attendance.EMPLOYEE_ID == emp_id,
                           Attendance.DATE.between(month_first, month_last)).all())
            tasks_done = (self.db.query(TaskAssignment)
                          .filter(TaskAssignment.EMPLOYEE_ID == emp_id,
                                  TaskAssignment.TASK_STATUS == "COMPLETED",
                                  TaskAssignment.ASSIGNED_DATE.between(month_first, month_last))
                          .count())
            tasks_total = (self.db.query(TaskAssignment)
                           .filter(TaskAssignment.EMPLOYEE_ID == emp_id,
                                   TaskAssignment.ASSIGNED_DATE.between(month_first, month_last))
                           .count())
            present = sum(1 for a in att
                          if (a.STATUS or "").upper() in ("PRESENT", "LATE"))
            late = sum(1 for a in att if (a.STATUS or "").upper() == "LATE")

            if not att and not tasks_total:
                out.append({"month": month_first.isoformat()[:7], "score": None})
                continue

            att_score = (present / max(len(att), 1)) * 100 if att else 50
            task_score = (tasks_done / max(tasks_total, 1)) * 100 if tasks_total else 50
            punctuality_penalty = min(20, late * 4)
            score = round(0.5 * att_score + 0.5 * task_score - punctuality_penalty, 1)
            out.append({"month": month_first.isoformat()[:7],
                        "score": max(0.0, min(100.0, score))})
        return out

    def performance_trends_all(self) -> List[PerformanceTrend]:
        return [self.performance_trend(e) for e in self._active()]

    # =================================================================
    # 4. ANOMALY DETECTION (per-employee z-score)
    # =================================================================

    def anomaly_report(self, emp: Employee) -> AnomalyReport:
        """ML-driven anomaly detection via IsolationForest.

        IsolationForest is an unsupervised ML model — it learned the boundary
        of NORMAL employee-week signals (low late count, low absences, modest
        OT) during training. For each employee we extract their most-recent
        week's signals, ask the model 'is this normal?'; if the model returns
        anomaly=true, we ALSO compute per-signal z-scores against the
        employee's own history so HR sees WHICH signal drove the call."""

        weekly = self._weekly_signals(emp.ID, weeks=12)
        recent_week = weekly[-1] if weekly else None
        if not recent_week or len(weekly) < 4:
            return AnomalyReport(
                employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
                employee_name=emp.NAME or "",
                has_anomalies=False, anomalies=[],
                recommended_action="Not enough history for anomaly detection."
            )

        # Feed IsolationForest with the most-recent week
        verdict = ML.detect_anomaly({
            "weekly_late_count":   recent_week["late"],
            "weekly_absent_count": recent_week["absent"],
            "weekly_ot_hours":     recent_week["ot_hours"],
        })

        anomalies: List[AnomalyFinding] = []
        if verdict.is_anomaly:
            # Explain WHY by showing per-signal z-scores vs own history.
            for signal_name, model_key in (
                ("late",     "weekly_late_count"),
                ("absent",   "weekly_absent_count"),
                ("ot_hours", "weekly_ot_hours"),
            ):
                historical = [w[signal_name] for w in weekly[:-1]]
                current = recent_week[signal_name]
                mu = mean(historical) if historical else 0
                try:
                    sigma = pstdev(historical) if len(historical) > 1 else 0
                except Exception:
                    sigma = 0
                if sigma == 0:
                    if current > mu + 2:
                        anomalies.append(AnomalyFinding(
                            signal=signal_name, value=float(current),
                            baseline_mean=round(mu, 2), baseline_std=0.0,
                            z_score=99.0,
                            verdict="Severe (no prior variation)"
                        ))
                    continue
                z = (current - mu) / sigma
                if abs(z) >= 1.5:    # IsolationForest already said anomalous
                    sev = ("Severe" if abs(z) >= 3
                           else "Significant" if abs(z) >= 2 else "Mild")
                    anomalies.append(AnomalyFinding(
                        signal=signal_name, value=float(current),
                        baseline_mean=round(mu, 2),
                        baseline_std=round(sigma, 2),
                        z_score=round(z, 2), verdict=sev,
                    ))

        action = ("Review well-being and check workload" if anomalies
                  else "Routine — within historical norms.")
        return AnomalyReport(
            employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
            employee_name=emp.NAME or "",
            has_anomalies=verdict.is_anomaly,
            anomalies=anomalies,
            recommended_action=action,
        )

    def _weekly_signals(self, emp_id: str, weeks: int) -> List[Dict[str, Any]]:
        start = self.today - timedelta(weeks=weeks)
        att = (self.db.query(Attendance)
               .filter(Attendance.EMPLOYEE_ID == emp_id,
                       Attendance.DATE >= start).all())
        out = []
        for w in range(weeks):
            wk_start = start + timedelta(weeks=w)
            wk_end = wk_start + timedelta(days=6)
            rows = [a for a in att if a.DATE and wk_start <= a.DATE <= wk_end]
            late = sum(1 for a in rows if (a.STATUS or "").upper() == "LATE")
            absent = sum(1 for a in rows if (a.STATUS or "").upper() == "ABSENT")
            ot = sum(float(getattr(a, "OVERTIME_HOURS", 0) or 0) for a in rows)
            out.append({"week_of": wk_start.isoformat(),
                        "late": late, "absent": absent, "ot_hours": round(ot, 1)})
        return out

    def anomalies_all(self) -> List[AnomalyReport]:
        return [self.anomaly_report(e) for e in self._active()]

    # =================================================================
    # 5. DEPARTMENT HEALTH
    # =================================================================

    def department_health_all(self) -> List[DepartmentHealth]:
        # Pre-compute per-employee scores once
        attrition = {a.employee_id: a for a in self.attrition_all()}
        burnout   = {b.employee_id: b for b in self.burnout_all()}
        trends    = {p.employee_id: p for p in self.performance_trends_all()}
        anomalies = {an.employee_id: an for an in self.anomalies_all()}

        # Group active employees by department
        by_dept: Dict[Optional[int], List[Employee]] = {}
        for emp in self._active():
            by_dept.setdefault(emp.DEPARTMENT_ID, []).append(emp)

        out: List[DepartmentHealth] = []
        for dept_id, emps in by_dept.items():
            if not emps:
                continue
            dept_name = self._dept_name(dept_id) or "(Unassigned)"
            n = len(emps)
            avg_attr  = mean([attrition[e.ID].score for e in emps if e.ID in attrition]) if emps else 0
            avg_burn  = mean([burnout[e.ID].score for e in emps if e.ID in burnout]) if emps else 0
            declining = sum(1 for e in emps if trends.get(e.ID) and trends[e.ID].trend == "DECLINING")
            anomaly_n = sum(1 for e in emps if anomalies.get(e.ID) and anomalies[e.ID].has_anomalies)

            # Health = 100 - weighted risk
            health = 100 - round(
                0.35 * avg_attr +
                0.30 * avg_burn +
                0.20 * (declining / n * 100) +
                0.15 * (anomaly_n / n * 100)
            )
            health = max(0, min(100, health))

            T = InsightsPolicy.DEPT_HEALTH_TIERS
            tier = ("HEALTHY" if health >= T["HEALTHY"]
                    else "WATCH"   if health >= T["WATCH"]
                    else "AT_RISK" if health >= T["AT_RISK"]
                    else "CRITICAL")

            drivers: List[str] = []
            if avg_burn >= 50: drivers.append(f"High avg burnout ({round(avg_burn)})")
            if avg_attr >= 50: drivers.append(f"High avg attrition risk ({round(avg_attr)})")
            if declining:      drivers.append(f"{declining} employee(s) on declining trend")
            if anomaly_n:      drivers.append(f"{anomaly_n} anomaly flag(s)")
            if not drivers:    drivers.append("Stable — no major concerns")

            out.append(DepartmentHealth(
                department_id=dept_id or 0,
                department_name=dept_name,
                headcount=n,
                avg_attrition_risk=round(avg_attr, 1),
                avg_burnout_risk=round(avg_burn, 1),
                declining_performers=declining,
                anomaly_count=anomaly_n,
                health_score=health, tier=tier, top_drivers=drivers,
            ))
        out.sort(key=lambda d: d.health_score)
        return out

    # =================================================================
    # SHARED HELPERS
    # =================================================================

    def _tenure_months(self, emp: Employee) -> int:
        if not emp.JOINING_DATE:
            return 0
        delta = self.today - emp.JOINING_DATE
        return int(delta.days / 30)

    def _consecutive_workdays(self, emp_id: str) -> int:
        # Count consecutive days ending today with attendance != ABSENT and != null
        d = self.today
        streak = 0
        for _ in range(60):
            rec = (self.db.query(Attendance)
                   .filter(Attendance.EMPLOYEE_ID == emp_id,
                           Attendance.DATE == d).first())
            if not rec or (rec.STATUS or "").upper() == "ABSENT":
                break
            streak += 1
            d -= timedelta(days=1)
        return streak

    # =================================================================
    # CONVENIENCE: serialise dataclass to plain dict for JSON response
    # =================================================================

    @staticmethod
    def to_dict(obj) -> Dict[str, Any]:
        d = asdict(obj)
        # SignalContributions become dicts already via asdict
        return d
