"""
Workforce Analytics — AI-driven HR insights.

  GET /employee-insights/attrition       → ranked attrition risk per employee
  GET /employee-insights/burnout         → ranked burnout risk per employee
  GET /employee-insights/performance     → performance trends (improving/declining/stable)
  GET /employee-insights/anomalies       → per-employee anomaly findings
  GET /employee-insights/department-health → composite dept score
  GET /employee-insights/dashboard       → all-in-one for the dashboard widget
"""

from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_user, get_current_admin
from app.services.employee_insights_service import EmployeeInsightsService
from app.services.ml_predictor import predictor as ML_PREDICTOR


router = APIRouter(prefix="/employee-insights", tags=["employee-insights"])


@router.get("/attrition")
def attrition(limit: int = Query(50, ge=1, le=200),
              tier: Optional[str] = None,
              db: Session = Depends(get_db),
              user: dict = Depends(get_current_user)) -> List[Dict[str, Any]]:
    svc = EmployeeInsightsService(db, user.get("vendor_id", 1))
    rows = svc.attrition_all()
    if tier:
        tier_u = tier.upper()
        rows = [r for r in rows if r.tier == tier_u]
    rows.sort(key=lambda r: r.score, reverse=True)
    return [svc.to_dict(r) for r in rows[:limit]]


@router.get("/burnout")
def burnout(limit: int = Query(50, ge=1, le=200),
            tier: Optional[str] = None,
            db: Session = Depends(get_db),
            user: dict = Depends(get_current_user)) -> List[Dict[str, Any]]:
    svc = EmployeeInsightsService(db, user.get("vendor_id", 1))
    rows = svc.burnout_all()
    if tier:
        tier_u = tier.upper()
        rows = [r for r in rows if r.tier == tier_u]
    rows.sort(key=lambda r: r.score, reverse=True)
    return [svc.to_dict(r) for r in rows[:limit]]


@router.get("/performance")
def performance(trend: Optional[str] = None,
                db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)) -> List[Dict[str, Any]]:
    svc = EmployeeInsightsService(db, user.get("vendor_id", 1))
    rows = svc.performance_trends_all()
    if trend:
        trend_u = trend.upper()
        rows = [r for r in rows if r.trend == trend_u]
    rows.sort(key=lambda r: r.slope)   # most-declining first
    return [svc.to_dict(r) for r in rows]


@router.get("/anomalies")
def anomalies(only_flagged: bool = False,
              db: Session = Depends(get_db),
              user: dict = Depends(get_current_user)) -> List[Dict[str, Any]]:
    svc = EmployeeInsightsService(db, user.get("vendor_id", 1))
    rows = svc.anomalies_all()
    if only_flagged:
        rows = [r for r in rows if r.has_anomalies]
    rows.sort(key=lambda r: (-len(r.anomalies),
                             max((abs(a.z_score) for a in r.anomalies), default=0)),
              reverse=False)
    return [svc.to_dict(r) for r in rows]


@router.get("/department-health")
def department_health(db: Session = Depends(get_db),
                      user: dict = Depends(get_current_user)) -> List[Dict[str, Any]]:
    svc = EmployeeInsightsService(db, user.get("vendor_id", 1))
    return [svc.to_dict(r) for r in svc.department_health_all()]


@router.get("/model-info")
def model_info(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Returns metadata for the three trained ML models — algorithm,
    training timestamp, sample count, features, and accuracy metrics.
    Surfaced in the UI so HR can see exactly what's powering the predictions."""
    return ML_PREDICTOR.model_info()


@router.post("/retrain")
def retrain(user: dict = Depends(get_current_admin)) -> Dict[str, Any]:
    """Deletes the on-disk .pkl files and retrains all three models.
    Admin-only — useful after policy weights or feature definitions change."""
    ML_PREDICTOR.retrain_all()
    return {"ok": True, "models": ML_PREDICTOR.model_info()}


@router.get("/dashboard")
def dashboard_bundle(db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Bundle everything the dashboard needs in a single response,
    so we get all five widgets with one HTTP roundtrip."""
    svc = EmployeeInsightsService(db, user.get("vendor_id", 1))

    attr = svc.attrition_all()
    burn = svc.burnout_all()
    trends = svc.performance_trends_all()
    anoms = svc.anomalies_all()
    depts = svc.department_health_all()

    # Headline counters used by the top tiles
    high_attrition = sum(1 for a in attr if a.tier == "HIGH")
    critical_burn  = sum(1 for b in burn if b.tier == "CRITICAL")
    declining      = sum(1 for t in trends if t.trend == "DECLINING")
    anomaly_emps   = sum(1 for an in anoms if an.has_anomalies)
    healthy_depts  = sum(1 for d in depts if d.tier == "HEALTHY")

    # Top-N for the page
    attr.sort(key=lambda r: r.score, reverse=True)
    burn.sort(key=lambda r: r.score, reverse=True)
    trends.sort(key=lambda r: r.slope)   # most declining first
    anoms_flagged = [a for a in anoms if a.has_anomalies]

    return {
        "summary": {
            "high_attrition_risk":  high_attrition,
            "critical_burnout":     critical_burn,
            "declining_performers": declining,
            "anomalies_flagged":    anomaly_emps,
            "healthy_departments":  healthy_depts,
            "total_employees":      len(attr),
        },
        "top_attrition_risk": [svc.to_dict(a) for a in attr[:10]],
        "top_burnout_risk":   [svc.to_dict(b) for b in burn[:10]],
        "declining_trends":   [svc.to_dict(t) for t in trends if t.trend == "DECLINING"][:10],
        "anomalies":          [svc.to_dict(an) for an in anoms_flagged][:10],
        "departments":        [svc.to_dict(d) for d in depts],
    }
