"""Employee experience-level classification for the automatic task
assignment engine.

Classification is POOL-RELATIVE, not a fixed year-threshold rule. A
fixed-threshold approach (e.g. "3+ years = EXPERIENCED") fails exactly
the case that matters most in a small/young company: a department's sole
Super Admin, or the only Fitter on staff, might have low tenure yet is
still the *best available* person for that role — they must never be
excluded from a task requiring "EXPERIENCED" just because they haven't
hit an arbitrary absolute threshold. `classify_pool_relative()` instead
ranks employees against the real (department, role) pool they're
actually competing in and buckets them by relative standing: the sole
employee in a pool is always the best available (EXPERIENCED); with two,
the higher-ranked is EXPERIENCED and the other INTERMEDIATE; with three
or more, roughly the top/middle/bottom thirds. See
`employee_matching_service.find_candidates()` for how this feeds a
best-effort (never immediately-shortage) matching fallback.

Effective experience = prior experience (before joining this company) +
tenure actually worked here since JOINING_DATE — this remains the real
ranking signal fed into the pool-relative bucketing above.

`Employee.EXPERIENCE_YEARS` (prior experience) uses a "years.months"
POINT-VALUE encoding, not a true decimal-years fraction — confirmed by
the exact worked examples this was specified against:
    1.0 -> 1 year, 0 months
    0.5 -> 0 years, 5 months   (NOT 6 months — this is not `0.5 * 12`)
    1.5 -> 1 year, 5 months
    0.6 -> 0 years, 6 months
    0.2 -> 0 years, 2 months
i.e. the integer part is whole years and the single digit after the
decimal point is read literally as a month count (0-9), the same way a
person would casually say "one point five years" meaning "1 year 5
months," not "1.5 years." `_parse_prior_experience()` converts this
point-value encoding into true decimal years for all downstream math.
Tenure since JOINING_DATE is computed separately via
dateutil.relativedelta for calendar accuracy (unlike the one existing
tenure helper in this codebase, employee_insights_service.py's
`_tenure_months()`, which approximates via `days / 30` — not reused here
since that drifts over multi-year tenures and returns months, not years)."""

from datetime import date
from typing import Dict, List, Optional

from dateutil.relativedelta import relativedelta

_LEVELS = ("FRESHER", "INTERMEDIATE", "EXPERIENCED")


def _parse_prior_experience(value) -> float:
    """Converts Employee.EXPERIENCE_YEARS's "years.months" point-value
    encoding (see module docstring) into true decimal years. The digit(s)
    after the decimal point are read literally as a month count — e.g.
    0.5 -> 5 months -> 5/12 years, not 0.5 years. Defensively normalizes
    an out-of-range (>=12) month reading by carrying into years, in case
    of a typo'd two-digit fractional value."""
    if value is None:
        return 0.0
    value = float(value)
    years_part = int(value)
    frac = round(abs(value) - abs(years_part), 4)
    months = round(frac * 10)
    if months >= 12:
        carry, months = divmod(months, 12)
        years_part += carry
    return round(years_part + months / 12.0, 4)


def tenure_years_since_joining(joining_date: Optional[date], as_of: Optional[date] = None) -> float:
    """Calendar-accurate TRUE decimal years worked here since
    JOINING_DATE (e.g. 1 year 6 months = 1.5), using
    dateutil.relativedelta rather than a days/30 approximation."""
    if not joining_date:
        return 0.0
    as_of = as_of or date.today()
    if joining_date > as_of:
        return 0.0
    delta = relativedelta(as_of, joining_date)
    return round(delta.years + delta.months / 12.0 + delta.days / 365.0, 4)


def effective_experience_years(employee, as_of: Optional[date] = None) -> float:
    """Effective Experience = Experience before joining (Employee.
    EXPERIENCE_YEARS, point-value encoded — see module docstring) + Time
    worked since joining (computed from JOINING_DATE), both normalized to
    true decimal years before adding."""
    prior = _parse_prior_experience(employee.EXPERIENCE_YEARS)
    tenure = tenure_years_since_joining(employee.JOINING_DATE, as_of=as_of)
    return round(prior + tenure, 4)


def classify_pool_relative(employees: List, as_of: Optional[date] = None) -> Dict[str, str]:
    """Classifies a homogeneous pool of employees (callers must pass one
    (department, role) group at a time — see employee_matching_service.
    find_candidates(), which groups before calling this) into FRESHER /
    INTERMEDIATE / EXPERIENCED (matching project_models.
    EXPERIENCE_LEVEL_ENUM) RELATIVE to each other, not against a fixed
    year threshold.

    Buckets by relative position among DISTINCT effective-experience
    values (rounded to whole days so two employees who are practically
    tied — e.g. hired the same week with the same prior experience — are
    never artificially split into different tiers just to fill a quota):
        idx = min(2, floor(3 * rank / n_distinct))
    where `rank` is a distinct value's position (descending). This
    correctly generalizes every worked example: n=1 employee (or N
    employees who all share the one best/only distinct value) -> all
    EXPERIENCED (the best available, per spec — a genuinely single-tier
    team must never be forced to manufacture a false FRESHER/
    INTERMEDIATE split); 2 distinct values -> higher EXPERIENCED, lower
    INTERMEDIATE; 3+ distinct values -> roughly top/middle/bottom thirds.
    This is also what makes real parallel capacity achievable: a task
    requiring EXPERIENCED against 3 equally-senior employees must be able
    to match all 3 in parallel, not serialize through a single "chosen"
    EXPERIENCED one while the other two sit idle as artificially-demoted
    INTERMEDIATE/FRESHER. Returns {employee.ID: level}; empty dict for an
    empty pool."""
    if not employees:
        return {}
    scored = [(e, round(effective_experience_years(e, as_of), 2)) for e in employees]
    distinct_years = sorted({y for _, y in scored}, reverse=True)
    n_distinct = len(distinct_years)
    labels = ("EXPERIENCED", "INTERMEDIATE", "FRESHER")
    year_to_label = {y: labels[min(2, int(3 * rank / n_distinct))] for rank, y in enumerate(distinct_years)}
    return {e.ID: year_to_label[y] for e, y in scored}


def classify_employee_display_level(db, employee) -> Optional[str]:
    """Convenience single-employee wrapper for display-only contexts
    (e.g. the Customer Task Timeline's task detail view) — classifies
    `employee` within their real current (VENDOR_ID, DEPARTMENT_ID,
    ROLE_ID) active peer pool, using the same pool-relative logic
    find_candidates() uses at matching time. This is informational only
    (reflects standing among today's active peers, which can differ from
    the pool that existed at the moment they were actually matched to a
    task) — never used as a new matching input. Returns None if the
    employee has no department/role, or if anything goes wrong (display-
    only — never raises)."""
    from app.models.models import Employee

    if not employee or not employee.DEPARTMENT_ID or not employee.ROLE_ID:
        return None
    try:
        pool = db.query(Employee).filter(
            Employee.VENDOR_ID == employee.VENDOR_ID,
            Employee.DEPARTMENT_ID == employee.DEPARTMENT_ID,
            Employee.ROLE_ID == employee.ROLE_ID,
            Employee.STATUS == "ACTIVE",
        ).all()
        if not pool:
            pool = [employee]
        return classify_pool_relative(pool).get(employee.ID)
    except Exception:
        return None
