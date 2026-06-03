"""Phase E — Statutory deduction calculations.

Implements India-specific payroll deductions:

  * PF  (Provident Fund) — 12% of (BASIC + DA) capped at ₹1,800/mo
        when basic_da exceeds the ₹15,000 wage ceiling. Employer
        contributes another 12% (1% admin charges included).

  * ESI (Employees' State Insurance) — applies only when monthly
        gross ≤ ₹21,000. Employee 0.75%, employer 3.25%.

  * PT  (Professional Tax) — state-specific slab. Defaults to the
        Tamil Nadu slab; override via SalaryStructure.PT_STATE.

These rates are the actual EPF/ESIC rules as of 2024-2025. Tunable
in code; a settings UI is a follow-up if you ever need to vary by
financial year.
"""

from typing import Dict, Optional


# ---- Provident Fund -------------------------------------------------

PF_WAGE_CEILING       = 15000.0  # only BASIC up to this attracts PF
PF_EMPLOYEE_RATE      = 0.12     # 12%
PF_EMPLOYER_RATE      = 0.12     # 12% (the 1% admin is on top, ignored for net-pay)


def pf_employee(basic: float, da: float = 0.0) -> float:
    """Employee PF contribution = 12% of min(basic+DA, 15000)."""

    base = max(0.0, (basic or 0.0) + (da or 0.0))

    capped = min(base, PF_WAGE_CEILING)

    return round(capped * PF_EMPLOYEE_RATE, 2)


def pf_employer(basic: float, da: float = 0.0) -> float:
    """Employer PF contribution (informational — not deducted from
    employee net). Same calculation as employee for the net-pay path."""

    base = max(0.0, (basic or 0.0) + (da or 0.0))

    capped = min(base, PF_WAGE_CEILING)

    return round(capped * PF_EMPLOYER_RATE, 2)


# ---- Employees' State Insurance -------------------------------------

ESI_GROSS_CEILING     = 21000.0  # ESI doesn't apply above this
ESI_EMPLOYEE_RATE     = 0.0075   # 0.75%
ESI_EMPLOYER_RATE     = 0.0325   # 3.25%


def esi_employee(gross: float) -> float:
    """ESI is zero when gross > ₹21,000/month."""

    if (gross or 0.0) > ESI_GROSS_CEILING:

        return 0.0

    return round(max(0.0, gross) * ESI_EMPLOYEE_RATE, 2)


def esi_employer(gross: float) -> float:

    if (gross or 0.0) > ESI_GROSS_CEILING:

        return 0.0

    return round(max(0.0, gross) * ESI_EMPLOYER_RATE, 2)


# ---- Professional Tax (state-specific) ------------------------------

# Tamil Nadu — half-yearly returns; monthly approximations shown.
# Source: TN Municipal Laws (Second Amendment) Act 1998 slabs.
_TN_SLABS = [
    # (monthly_gross_upper, monthly_pt)
    (21000,    0.0),
    (30000,  135.0),
    (45000,  315.0),
    (60000,  690.0),
    (75000, 1025.0),
    (float("inf"), 1250.0),
]

_KA_SLABS = [
    (14999,    0.0),
    (24999,  200.0),     # Karnataka exempts below 15000
    (float("inf"), 300.0),
]

_MH_SLABS = [
    (7500,    0.0),
    (10000,  175.0),
    (float("inf"), 200.0),  # ₹300 in February only
]

_WB_SLABS = [
    (10000,    0.0),
    (15000,  110.0),
    (25000,  130.0),
    (40000,  150.0),
    (float("inf"), 200.0),
]

_STATE_SLAB_MAP: Dict[str, list] = {
    "TAMIL_NADU":  _TN_SLABS,
    "KARNATAKA":   _KA_SLABS,
    "MAHARASHTRA": _MH_SLABS,
    "WEST_BENGAL": _WB_SLABS,
}


def professional_tax(gross: float, state: Optional[str] = None) -> float:
    """Monthly PT amount for the given state. States without a
    professional tax (Delhi, UP, Haryana, etc.) return 0 — callers
    can pass None to skip PT entirely."""

    if not state:

        return 0.0

    slabs = _STATE_SLAB_MAP.get(state.upper().strip().replace(" ", "_"))

    if not slabs:

        return 0.0

    g = max(0.0, gross or 0.0)

    for upper, amount in slabs:

        if g <= upper:

            return round(amount, 2)

    return 0.0


# ---- Convenience: one-shot deductions block -------------------------

def compute_statutory_deductions(
    *,
    basic: float,
    da: float,
    gross: float,
    pt_state: Optional[str] = "TAMIL_NADU",
    pf_applicable: bool = True,
    esi_applicable: bool = True
) -> Dict[str, float]:
    """Returns a dict with every statutory deduction component +
    `employee_total` (what gets subtracted from net pay) and
    `employer_total` (cost-to-company side, not deducted).

    Caller passes the *earned* basic/gross for the month, not the
    structured amounts — this keeps part-month / LOP cases honest."""

    pf_emp = pf_employee(basic, da) if pf_applicable else 0.0

    pf_emr = pf_employer(basic, da) if pf_applicable else 0.0

    esi_emp = esi_employee(gross) if esi_applicable else 0.0

    esi_emr = esi_employer(gross) if esi_applicable else 0.0

    pt     = professional_tax(gross, pt_state)

    return {
        "pf_employee":     pf_emp,
        "pf_employer":     pf_emr,
        "esi_employee":    esi_emp,
        "esi_employer":    esi_emr,
        "professional_tax": pt,
        "employee_total":  round(pf_emp + esi_emp + pt, 2),
        "employer_total":  round(pf_emr + esi_emr, 2),
    }
