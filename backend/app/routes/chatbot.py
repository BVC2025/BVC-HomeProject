"""
Rule-based ERP chatbot — zero AI cost, zero model storage.

Three-phase matcher (most "intelligent" first):

  Phase 1 — ENTITY LOOKUP
      Scan the message for any name that matches a real DB
      row (employee, project, material, machine, customer,
      department). If found, return a rich profile for it.
      This is what makes the bot feel smart — you can type
      'Ram', 'Steel Bolt', or 'ABC Foods' and get an answer.

  Phase 2 — CONCEPT/INTENT MATCHING
      Synonym-aware. 'show me low stock', 'running low on
      materials', 'which inventory is low' all hit the same
      intent because they share the same concept tokens.

  Phase 3 — TOPIC FALLBACK
      If nothing matched, route by the dominant topic so the
      user still gets a useful answer instead of "I don't
      understand."
"""

import re
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from app.database.database import get_db

from app.models.models import (
    Employee,
    Role,
    Department,
    Designation,
    Project,
    TaskAssignment,
    Inventory,
    MaterialCatalog,
    MaterialDepartment,
    Machine,
    Attendance,
    Notification,
    Customer,
    Vendor,
    SubProjectTemplate,
    ProjectCategory,
    # BVC24 extensions — Production, Quality, Suppliers, Leave,
    # Biometric, Process Stages
    Supplier,
    ProductModel,
    BOMItem,
    WorkOrder,
    ProcessStage,
    WorkOrderStageProgress,
    QCChecklistItem,
    QCInspection,
    QCInspectionResult,
    NCR,
    LeaveRequest,
    LeaveBalance,
    BiometricEvent,
    DailyAllocation
)


router = APIRouter()


# =========================
# REQUEST / RESPONSE
# =========================

class ChatMessage(BaseModel):

    message: str


def reply(
    text: str,
    items: Optional[List[Dict[str, Any]]] = None,
    suggestions: Optional[List[str]] = None
) -> Dict[str, Any]:

    return {
        "reply": text,
        "items": items or [],
        "suggestions": suggestions or []
    }


# =========================
# CONSTANTS
# =========================

ACTIVE_STATUSES = ("PENDING", "IN_PROGRESS", "ON_HOLD")

EXCLUDED_ROLES = {"SUPER_ADMIN", "ADMIN", "HR"}


# =========================
# TEXT NORMALIZATION
# =========================

TYPO_FIXES = {
    r"\binventroy\b": "inventory",
    r"\binventery\b": "inventory",
    r"\binvntory\b": "inventory",
    r"\binvetory\b": "inventory",
    r"\binventary\b": "inventory",
    r"\bstcok\b": "stock",
    r"\bemployeee+\b": "employee",
    r"\bemployes\b": "employees",
    r"\bempolyee\b": "employee",
    r"\bemploye\b": "employee",
    r"\battendence\b": "attendance",
    r"\battandance\b": "attendance",
    r"\bmachne\b": "machine",
    r"\bmachins\b": "machines",
    r"\bprojcet\b": "project",
    r"\bproect\b": "project",
    r"\bproejct\b": "project",
    r"\bdepartmnt\b": "department",
    r"\bdept\b": "department",
    r"\bmaterail\b": "material",
    r"\bmaterails\b": "materials",
    r"\borveriew\b": "overview",
    r"\bdetials\b": "details",
    r"\bsumary\b": "summary",
    r"\boverdu\b": "overdue",
    r"\bpendng\b": "pending",
    r"\btaks\b": "tasks",
    r"\btsk\b": "task",
    r"\bcustmer\b": "customer",
    r"\bvender\b": "vendor",
    r"\bvendoor\b": "vendor"
}


def normalize(text):

    if not text:

        return ""

    t = text.lower().strip()

    t = re.sub(r"[?!.,;:'\"()\[\]]", " ", t)

    t = re.sub(r"\s+", " ", t).strip()

    for pattern, fixed in TYPO_FIXES.items():

        t = re.sub(pattern, fixed, t)

    return t


def stem(word):
    """
    Lightweight English stemmer. Designed to fold plurals
    and common verb forms while NOT over-stripping:
      machines -> machine     (NOT machin)
      employees -> employee   (NOT employe)
      categories -> category
      assigned -> assign
      running -> runn
      tasks -> task
    """

    if len(word) <= 3:

        return word

    if word.endswith("ies") and len(word) > 4:

        return word[:-3] + "y"

    if word.endswith("ing") and len(word) > 5:

        return word[:-3]

    if word.endswith("ed") and len(word) > 4:

        return word[:-2]

    # Plural 's' — drop a trailing single 's' (but not 'ss' like
    # 'business', 'process'). This keeps 'machines'->'machine'
    # instead of stripping 'es' and producing 'machin'.
    if word.endswith("s") and len(word) > 3 and not word.endswith("ss"):

        return word[:-1]

    return word


def tokens(text):

    return [stem(t) for t in re.findall(r"[a-z]+", text)]


# =========================
# CONCEPT (synonym) DICTIONARY
# =========================

CONCEPTS = {
    # Topics
    "task":         {"task", "job", "work", "assignment", "todo"},
    "project":      {"project", "engagement", "site"},
    "employee":     {"employee", "staff", "worker", "user", "person", "people", "member"},
    "department":   {"department", "dept", "division", "team", "unit"},
    "customer":     {"customer", "client", "buyer"},
    "vendor":       {"vendor", "tenant"},
    # BVC24 — Supplier (procurement-side) is now distinct from Vendor (tenant)
    "supplier":     {"supplier", "suppliers", "procurement", "vendormaster"},
    "production":   {"production", "manufacturing", "factory", "shopfloor", "assembly"},
    "workorder":    {"workorder", "wo", "build", "batch"},
    "bom":          {"bom", "billofmaterials", "billofmaterial"},
    "quality":      {"quality", "qc", "qa", "inspect", "inspection"},
    "ncr":          {"ncr", "nonconformance", "defect", "rejected"},
    "leave":        {"leave", "holiday", "vacation", "casual", "sick", "earned"},
    "performance":  {"performance", "score", "increment", "raise", "rating", "review"},
    "biometric":    {"biometric", "fingerprint", "scan", "scanner", "gate", "kiosk"},
    "stage":        {"stage", "step", "phase"},
    "purchase":     {"purchase", "po", "buy", "procurement"},
    "checkin":      {"checkin", "checkedin", "arrival", "arrived"},
    "checkout":     {"checkout", "checkedout", "leaving", "depart"},
    "balance":      {"balance", "remaining", "quota"},
    "inventory":    {"inventory", "stock", "material", "supply", "store", "warehouse", "item"},
    "machine":      {"machine", "equipment", "device", "tool", "asset"},
    "attendance":   {"attendance", "present", "absent", "checkin", "check"},
    "alert":        {"alert", "notification", "warn", "message"},
    "category":     {"category", "categories", "type", "kind"},
    "approval":     {"approval", "approve", "authorize", "supervisor"},
    "workload":     {"workload", "load", "busy", "free", "occupied", "burden"},

    # Actions / qualifiers
    "count":        {"count", "many", "number", "total", "how", "much"},
    "list":         {"list", "show", "give", "tell", "all", "every", "display", "view", "see", "fetch"},
    "summary":      {"summary", "overview", "snapshot", "detail", "info", "status", "report", "about"},
    "find":         {"find", "search", "lookup", "where", "locate", "is"},

    # Task qualifiers
    "pending":      {"pending", "waiting", "open", "queued"},
    "completed":    {"completed", "done", "finished", "closed"},
    "overdue":      {"overdue", "late", "past", "due", "expired", "missed"},
    "progress":     {"progress", "ongoing", "current", "live", "working"},

    # Inventory qualifiers
    "low":          {"low", "less", "few", "running", "shortage", "minimum"},
    "empty":        {"empty", "zero", "out", "none", "nothing"},
    "value":        {"value", "worth", "cost", "price", "amount", "money"},

    # Time
    "today":        {"today", "now", "current"},
    "week":         {"week", "weekly"},
    "month":        {"month", "monthly"},

    # Who-questions
    "why":          {"why", "reason", "explain", "because", "cause"},
    "who":          {"who", "whom", "whose"},

    # Quantifiers / superlatives
    "top":          {"top", "most", "highest", "best", "max"},
    "bottom":       {"bottom", "least", "lowest", "min"},
    "average":      {"average", "avg", "mean"},

    # Help
    "help":         {"help", "guide", "tutorial", "manual"},
    "greeting":     {"hi", "hello", "hey", "hai", "hii", "yo", "hola", "namaste"}
}


# Pre-stem all concept synonyms so they match the stemmed
# tokens the parser produces. (e.g. 'employees' tokenizes to
# 'employe', so we need 'employe' in the concept set, not
# just 'employee'.)
CONCEPTS = {
    k: {stem(s) for s in v} | set(v)
    for k, v in CONCEPTS.items()
}


def has(tok_set, concept):

    return any(syn in tok_set for syn in CONCEPTS.get(concept, ()))


def has_any(tok_set, *concepts):

    return any(has(tok_set, c) for c in concepts)


# Convenience: is any of these literal (already-stemmed) tokens in the set?
def has_word(tok_set, *words):

    return any(stem(w) in tok_set or w in tok_set for w in words)


# =========================
# HELPERS
# =========================

def fmt_date(d):

    if d is None:

        return "n/a"

    if hasattr(d, "isoformat"):

        return d.isoformat()

    return str(d)


def active_task_count(db, employee_id):

    return db.query(TaskAssignment).filter(
        TaskAssignment.EMPLOYEE_ID == employee_id,
        TaskAssignment.TASK_STATUS.in_(ACTIVE_STATUSES),
        TaskAssignment.APPROVAL_STATUS == "APPROVED"
    ).count()


# =========================
# ENTITY FINDERS (run in Phase 1)
# =========================

def find_employee_in_text(db, text):

    rows = db.query(Employee).filter(
        Employee.STATUS == "ACTIVE"
    ).all()

    text_l = text.lower()

    best = None

    best_len = 0

    for e in rows:

        name = (e.NAME or "").strip().lower()

        if not name or len(name) < 2:

            continue

        # match either full name OR any first/last token of name
        parts = [name] + [p for p in name.split() if len(p) >= 3]

        for p in parts:

            if re.search(rf"\b{re.escape(p)}\b", text_l):

                if len(p) > best_len:

                    best = e

                    best_len = len(p)

                    break

        code = (e.EMPLOYEE_CODE or "").strip().lower()

        if code and len(code) >= 3 and re.search(rf"\b{re.escape(code)}\b", text_l):

            if len(code) > best_len:

                best = e

                best_len = len(code)

    return best


def find_project_in_text(db, text):

    rows = db.query(Project).all()

    text_l = text.lower()

    best = None

    best_len = 0

    for p in rows:

        name = (p.PROJECT_NAME or "").strip().lower()

        if not name or len(name) < 3:

            continue

        if re.search(rf"\b{re.escape(name)}\b", text_l):

            if len(name) > best_len:

                best = p

                best_len = len(name)

    return best


def find_material_in_text(db, text):

    rows = db.query(MaterialCatalog).all()

    text_l = text.lower()

    best = None

    best_len = 0

    for m in rows:

        name = (m.MATERIAL_NAME or "").strip().lower()

        if not name or len(name) < 3:

            continue

        if re.search(rf"\b{re.escape(name)}\b", text_l):

            if len(name) > best_len:

                best = m

                best_len = len(name)

    return best


def find_machine_in_text(db, text):

    rows = db.query(Machine).all()

    text_l = text.lower()

    best = None

    best_len = 0

    for mc in rows:

        name = (mc.MACHINE_NAME or "").strip().lower()

        if not name or len(name) < 3:

            continue

        if re.search(rf"\b{re.escape(name)}\b", text_l):

            if len(name) > best_len:

                best = mc

                best_len = len(name)

    return best


def find_customer_in_text(db, text):

    rows = db.query(Customer).all()

    text_l = text.lower()

    best = None

    best_len = 0

    for c in rows:

        name = (c.CUSTOMER_NAME or "").strip().lower()

        if not name or len(name) < 3:

            continue

        if re.search(rf"\b{re.escape(name)}\b", text_l):

            if len(name) > best_len:

                best = c

                best_len = len(name)

    return best


def find_department_in_text(db, text):

    rows = db.query(Department).all()

    text_l = text.lower()

    best = None

    best_len = 0

    for d in rows:

        name = (d.NAME or "").strip().lower()

        code = (d.CODE or "").strip().lower()

        if name and len(name) >= 3 and re.search(rf"\b{re.escape(name)}\b", text_l):

            if len(name) > best_len:

                best = d

                best_len = len(name)

        if code and len(code) >= 2 and re.search(rf"\b{re.escape(code)}\b", text_l):

            if len(code) > best_len:

                best = d

                best_len = len(code)

    return best


# =========================
# ENTITY PROFILE BUILDERS (Phase 1 responses)
# =========================

def profile_employee(db, emp, tok_set):

    dept_name = "(no department)"

    if emp.DEPARTMENT_ID:

        d = db.query(Department).filter(
            Department.ID == emp.DEPARTMENT_ID
        ).first()

        if d:

            dept_name = d.NAME

    role_name = "(no role)"

    if emp.ROLE_ID:

        r = db.query(Role).filter(Role.ID == emp.ROLE_ID).first()

        if r:

            role_name = r.ROLE_NAME

    workload = active_task_count(db, emp.ID)

    recent_tasks = db.query(TaskAssignment).filter(
        TaskAssignment.EMPLOYEE_ID == emp.ID
    ).order_by(TaskAssignment.UPDATED_AT.desc()).limit(5).all()

    items = [
        {"label": "Employee code", "meta": emp.EMPLOYEE_CODE or "-"},
        {"label": "Department", "meta": dept_name},
        {"label": "Role", "meta": role_name},
        {"label": "Email", "meta": emp.EMAIL or "-"},
        {"label": "Phone", "meta": emp.PHONE or "-"},
        {"label": "Active workload", "meta": f"{workload} task(s)"}
    ]

    for t in recent_tasks:

        items.append({
            "label": f"📋 {t.TASK_NAME or 'Task #' + str(t.TASK_ID)}",
            "meta": f"{t.TASK_STATUS} · due {fmt_date(t.DUE_DATE)}"
        })

    return reply(
        f"Here's what I know about {emp.NAME}:",
        items=items,
        suggestions=[
            f"why was {emp.NAME.split()[0].lower()} assigned",
            "workload summary"
        ]
    )


def profile_project(db, proj, tok_set):

    dept_name = "(none)"

    if proj.DEPARTMENT_ID:

        d = db.query(Department).filter(
            Department.ID == proj.DEPARTMENT_ID
        ).first()

        if d:

            dept_name = d.NAME

    customer_name = "(none)"

    if proj.CUSTOMER_ID:

        c = db.query(Customer).filter(
            Customer.ID == proj.CUSTOMER_ID
        ).first()

        if c:

            customer_name = c.CUSTOMER_NAME

    tasks = db.query(TaskAssignment).filter(
        TaskAssignment.PROJECT_ID == proj.ID
    ).all()

    by_status = {}

    for t in tasks:

        by_status[t.TASK_STATUS] = by_status.get(t.TASK_STATUS, 0) + 1

    items = [
        {"label": "Status", "meta": proj.STATUS or "PENDING"},
        {"label": "Department", "meta": dept_name},
        {"label": "Customer", "meta": customer_name},
        {"label": "Description", "meta": (proj.DESCRIPTION or "-")[:80]},
        {"label": "Total tasks", "meta": str(len(tasks))}
    ]

    for status, cnt in by_status.items():

        items.append({"label": f"  ↳ {status}", "meta": f"{cnt} task(s)"})

    return reply(
        f"Project: {proj.PROJECT_NAME}",
        items=items,
        suggestions=["list projects", "active projects"]
    )


def profile_material(db, mat, tok_set):

    stock_rows = db.query(Inventory).filter(
        Inventory.MATERIAL_ID == mat.ID
    ).all()

    total_qty = sum(r.QUANTITY for r in stock_rows)

    total_value = sum(
        (r.QUANTITY or 0) * (r.UNIT_PRICE or 0) for r in stock_rows
    )

    dept_tags = db.query(MaterialDepartment).filter(
        MaterialDepartment.MATERIAL_ID == mat.ID
    ).all()

    dept_names = []

    for dt in dept_tags:

        d = db.query(Department).filter(
            Department.ID == dt.DEPARTMENT_ID
        ).first()

        if d:

            dept_names.append(d.NAME)

    items = [
        {"label": "Total quantity", "meta": str(total_qty)},
        {"label": "Stock entries", "meta": str(len(stock_rows))},
        {"label": "Total value", "meta": f"₹{total_value:,.2f}"},
        {"label": "Departments", "meta": ", ".join(dept_names) or "(unclassified)"}
    ]

    for r in stock_rows[:5]:

        v = db.query(Vendor).filter(Vendor.ID == r.VENDOR_ID).first()

        items.append({
            "label": f"  ↳ qty {r.QUANTITY} @ ₹{r.UNIT_PRICE}",
            "meta": f"from {v.VENDOR_NAME if v else 'unknown'}"
        })

    return reply(
        f"Material: {mat.MATERIAL_NAME}",
        items=items,
        suggestions=["low stock", "inventory summary"]
    )


def profile_machine(db, mc, tok_set):

    items = [
        {"label": "Type", "meta": mc.MACHINE_TYPE or "-"},
        {"label": "Status", "meta": mc.STATUS or "-"},
        {"label": "Location", "meta": mc.LOCATION or "-"},
        {"label": "Last updated", "meta": fmt_date(mc.LAST_UPDATED)}
    ]

    return reply(
        f"Machine: {mc.MACHINE_NAME}",
        items=items,
        suggestions=["machine status", "broken machines"]
    )


def profile_customer(db, c, tok_set):

    projects = db.query(Project).filter(
        Project.CUSTOMER_ID == c.ID
    ).all()

    items = [
        {"label": "Phone", "meta": c.PHONE or "-"},
        {"label": "Email", "meta": c.EMAIL or "-"},
        {"label": "Address", "meta": (c.ADDRESS or "-")[:80]},
        {"label": "Projects", "meta": str(len(projects))}
    ]

    for p in projects[:5]:

        items.append({
            "label": f"  ↳ {p.PROJECT_NAME}",
            "meta": p.STATUS or "PENDING"
        })

    return reply(
        f"Customer: {c.CUSTOMER_NAME}",
        items=items,
        suggestions=["list customers"]
    )


def profile_department(db, d, tok_set):

    emp_count = db.query(Employee).filter(
        Employee.DEPARTMENT_ID == d.ID,
        Employee.STATUS == "ACTIVE"
    ).count()

    proj_count = db.query(Project).filter(
        Project.DEPARTMENT_ID == d.ID
    ).count()

    head_name = "-"

    if d.HEAD_EMPLOYEE_ID:

        head = db.query(Employee).filter(
            Employee.ID == d.HEAD_EMPLOYEE_ID
        ).first()

        if head:

            head_name = head.NAME

    items = [
        {"label": "Code", "meta": d.CODE or "-"},
        {"label": "Head", "meta": head_name},
        {"label": "Active employees", "meta": str(emp_count)},
        {"label": "Projects", "meta": str(proj_count)},
        {"label": "Description", "meta": (d.DESCRIPTION or "-")[:80]}
    ]

    return reply(
        f"Department: {d.NAME}",
        items=items,
        suggestions=[f"employees in {d.NAME.lower()}", "list departments"]
    )


# =========================
# INTENT HANDLERS
# =========================

def handle_help(tok_set, raw, db):

    return reply(
        "Hi! I'm your BVC24 ERP assistant. Type a question in "
        "plain English and I'll dig through the data for you. "
        "I cover every module:\n\n"
        "🏭 Production — work orders, machine models, BOM\n"
        "✅ Quality — inspections, NCRs, pass rate\n"
        "🚚 Suppliers — list, filter by category, GST/bank\n"
        "🌴 Leave — pending requests, on-leave today, balances\n"
        "📈 Performance — MD score, suggested increment %\n"
        "👆 Biometric — recent scans, who's in office\n"
        "📊 Stages — manufacturing flow per machine\n"
        "👥 People — employees, departments, workload\n"
        "📦 Inventory — stock, low stock, value\n"
        "📋 Tasks — pending, overdue, completed, by employee\n\n"
        "You can also type a name (employee, project, supplier, "
        "machine model) and I'll show its profile.",
        suggestions=[
            "BVC24 overview",
            "Production status",
            "Quality status",
            "Who is in office",
            "Pending leave",
            "Performance summary",
            "List suppliers",
            "Machine models"
        ]
    )


def handle_greeting(tok_set, raw, db):

    return reply(
        "Hello! 👋  Ask me anything about your ERP — type "
        "'help' to see what I can do, or just say something "
        "like 'show me low stock' or 'how many projects'."
    )


# ---- TASKS ----

def handle_task_total(tok_set, raw, db):

    total = db.query(TaskAssignment).count()

    by_status = db.query(
        TaskAssignment.TASK_STATUS,
        func.count(TaskAssignment.TASK_ID)
    ).group_by(TaskAssignment.TASK_STATUS).all()

    items = [
        {"label": s or "UNKNOWN", "meta": f"{c} task(s)"}
        for s, c in by_status
    ]

    return reply(
        f"There are {total} task(s) in the system.",
        items=items,
        suggestions=["pending tasks", "overdue tasks", "completed tasks"]
    )


def handle_pending_tasks(tok_set, raw, db):

    rows = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_STATUS == "PENDING",
        TaskAssignment.APPROVAL_STATUS == "APPROVED"
    ).all()

    items = [
        {
            "label": r.TASK_NAME or f"Task #{r.TASK_ID}",
            "meta": f"due {fmt_date(r.DUE_DATE)}"
        }
        for r in rows[:20]
    ]

    return reply(
        f"{len(rows)} task(s) are pending and approved.",
        items=items
    )


def handle_in_progress_tasks(tok_set, raw, db):

    rows = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_STATUS == "IN_PROGRESS"
    ).all()

    items = [
        {
            "label": r.TASK_NAME or f"Task #{r.TASK_ID}",
            "meta": f"due {fmt_date(r.DUE_DATE)}"
        }
        for r in rows[:20]
    ]

    return reply(
        f"{len(rows)} task(s) are in progress.",
        items=items
    )


def handle_completed_tasks(tok_set, raw, db):

    count = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_STATUS == "COMPLETED"
    ).count()

    return reply(f"{count} task(s) have been completed.")


def handle_overdue_tasks(tok_set, raw, db):

    today = date.today()

    rows = db.query(TaskAssignment).filter(
        TaskAssignment.DUE_DATE != None,
        TaskAssignment.DUE_DATE < today,
        TaskAssignment.TASK_STATUS.in_(ACTIVE_STATUSES),
        TaskAssignment.APPROVAL_STATUS == "APPROVED"
    ).all()

    items = []

    for r in rows[:20]:

        days = (today - r.DUE_DATE).days if r.DUE_DATE else 0

        items.append({
            "label": r.TASK_NAME or f"Task #{r.TASK_ID}",
            "meta": f"overdue by {days} day(s)"
        })

    if not rows:

        return reply("Good news — no overdue tasks. 🎉")

    return reply(
        f"⚠️  {len(rows)} task(s) are overdue.",
        items=items,
        suggestions=["workload summary", "pending tasks"]
    )


def handle_pending_approval(tok_set, raw, db):

    rows = db.query(TaskAssignment).filter(
        TaskAssignment.APPROVAL_STATUS == "PENDING_APPROVAL"
    ).all()

    items = [
        {
            "label": r.TASK_NAME or f"Task #{r.TASK_ID}",
            "meta": f"requested {fmt_date(r.APPROVAL_REQUESTED_AT)}"
        }
        for r in rows[:20]
    ]

    return reply(
        f"{len(rows)} task(s) are waiting for supervisor approval.",
        items=items
    )


# ---- WORKLOAD ----

def handle_workload_summary(tok_set, raw, db):

    employees = db.query(Employee).join(
        Role, Employee.ROLE_ID == Role.ID
    ).filter(
        Employee.STATUS == "ACTIVE",
        Role.ROLE_NAME.notin_(EXCLUDED_ROLES)
    ).all()

    rows = [
        {"EMP": e, "COUNT": active_task_count(db, e.ID)}
        for e in employees
    ]

    rows.sort(key=lambda r: (r["COUNT"], r["EMP"].EMPLOYEE_CODE or "ZZZ"))

    items = [
        {
            "label": f"{r['EMP'].NAME} ({r['EMP'].EMPLOYEE_CODE})",
            "meta": f"{r['COUNT']} active task(s)"
        }
        for r in rows
    ]

    if not rows:

        return reply(
            "No eligible worker-role employees found. "
            "All employees are either inactive or are "
            "ADMIN / HR roles."
        )

    least = rows[0]

    return reply(
        f"Workload summary: {len(rows)} eligible employee(s). "
        f"Least loaded is {least['EMP'].NAME} with "
        f"{least['COUNT']} active task(s).",
        items=items,
        suggestions=["why is the same person assigned", "list employees"]
    )


def handle_top_loaded(tok_set, raw, db):

    employees = db.query(Employee).filter(
        Employee.STATUS == "ACTIVE"
    ).all()

    rows = [
        {"EMP": e, "COUNT": active_task_count(db, e.ID)}
        for e in employees
    ]

    rows = [r for r in rows if r["COUNT"] > 0]

    rows.sort(key=lambda r: -r["COUNT"])

    items = [
        {
            "label": f"{r['EMP'].NAME} ({r['EMP'].EMPLOYEE_CODE})",
            "meta": f"{r['COUNT']} active task(s)"
        }
        for r in rows[:10]
    ]

    if not rows:

        return reply("Nobody has any active tasks right now.")

    return reply(
        f"Top {len(items)} most loaded employee(s):",
        items=items
    )


def handle_why_assigned(tok_set, raw, db):

    return reply(
        "Auto-assignment picks the least-loaded employee "
        "who meets ALL of these rules:\n"
        "  1) STATUS = ACTIVE\n"
        "  2) Role is NOT SUPER_ADMIN / ADMIN / HR\n"
        "  3) DEPARTMENT_ID matches the project's department "
        "(falls back to global if no match)\n"
        "  4) Lowest active task count wins; ties break by "
        "EMPLOYEE_CODE alphabetically\n\n"
        "If one person keeps getting picked, they're the "
        "only one passing all 4 rules. Ask 'workload "
        "summary' to see the eligible pool.",
        suggestions=["workload summary"]
    )


# ---- PROJECTS ----

def handle_project_total(tok_set, raw, db):

    total = db.query(Project).count()

    by_status = db.query(
        Project.STATUS,
        func.count(Project.ID)
    ).group_by(Project.STATUS).all()

    items = [
        {"label": s or "UNKNOWN", "meta": f"{c} project(s)"}
        for s, c in by_status
    ]

    return reply(f"There are {total} project(s).", items=items)


def handle_list_projects(tok_set, raw, db):

    rows = db.query(Project).all()

    items = [
        {
            "label": r.PROJECT_NAME or f"Project #{r.ID}",
            "meta": r.STATUS or "PENDING"
        }
        for r in rows[:30]
    ]

    return reply(f"{len(rows)} project(s) found.", items=items)


def handle_active_projects(tok_set, raw, db):

    rows = db.query(Project).filter(
        Project.STATUS != "COMPLETED"
    ).all()

    items = [
        {
            "label": r.PROJECT_NAME or f"Project #{r.ID}",
            "meta": r.STATUS or "PENDING"
        }
        for r in rows[:30]
    ]

    return reply(f"{len(rows)} active project(s).", items=items)


# ---- EMPLOYEES ----

def handle_employee_total(tok_set, raw, db):

    total = db.query(Employee).filter(
        Employee.STATUS == "ACTIVE"
    ).count()

    by_role = db.query(
        Role.ROLE_NAME,
        func.count(Employee.ID)
    ).join(
        Employee, Employee.ROLE_ID == Role.ID
    ).filter(
        Employee.STATUS == "ACTIVE"
    ).group_by(Role.ROLE_NAME).all()

    items = [
        {"label": r or "UNKNOWN", "meta": f"{c} person(s)"}
        for r, c in by_role
    ]

    return reply(
        f"There are {total} active employee(s).",
        items=items,
        suggestions=["list employees", "workload summary"]
    )


def handle_list_employees(tok_set, raw, db):

    # If the user mentioned a department name/code, scope to it.
    dept_match = find_department_in_text(db, raw)

    if dept_match is not None:

        rows = db.query(Employee).filter(
            Employee.DEPARTMENT_ID == dept_match.ID,
            Employee.STATUS == "ACTIVE"
        ).all()

        items = [
            {
                "label": f"{e.NAME} ({e.EMPLOYEE_CODE})",
                "meta": e.EMAIL or "no email"
            }
            for e in rows
        ]

        return reply(
            f"{len(rows)} active employee(s) in {dept_match.NAME}.",
            items=items
        )

    rows = db.query(Employee).filter(
        Employee.STATUS == "ACTIVE"
    ).all()

    items = []

    for e in rows[:30]:

        dept_name = "(no dept)"

        if e.DEPARTMENT_ID:

            d = db.query(Department).filter(
                Department.ID == e.DEPARTMENT_ID
            ).first()

            if d:

                dept_name = d.NAME

        items.append({
            "label": f"{e.NAME} ({e.EMPLOYEE_CODE})",
            "meta": dept_name
        })

    return reply(f"{len(rows)} active employee(s).", items=items)


# ---- DEPARTMENTS ----

def handle_list_departments(tok_set, raw, db):

    rows = db.query(Department).all()

    items = []

    for d in rows:

        head_name = "no head"

        if d.HEAD_EMPLOYEE_ID:

            head = db.query(Employee).filter(
                Employee.ID == d.HEAD_EMPLOYEE_ID
            ).first()

            if head:

                head_name = f"head: {head.NAME}"

        items.append({
            "label": f"{d.NAME} ({d.CODE})",
            "meta": head_name
        })

    return reply(f"{len(rows)} department(s).", items=items)


# ---- CUSTOMERS ----

def handle_customer_total(tok_set, raw, db):

    total = db.query(Customer).count()

    return reply(
        f"There are {total} customer(s).",
        suggestions=["list customers"]
    )


def handle_list_customers(tok_set, raw, db):

    rows = db.query(Customer).all()

    items = []

    for c in rows[:30]:

        proj_count = db.query(Project).filter(
            Project.CUSTOMER_ID == c.ID
        ).count()

        items.append({
            "label": c.CUSTOMER_NAME or f"Customer #{c.ID}",
            "meta": f"{proj_count} project(s) · {c.PHONE or 'no phone'}"
        })

    return reply(f"{len(rows)} customer(s).", items=items)


# ---- VENDORS ----

def handle_list_vendors(tok_set, raw, db):

    rows = db.query(Vendor).all()

    items = [
        {"label": v.VENDOR_NAME or f"Vendor #{v.ID}", "meta": f"ID {v.ID}"}
        for v in rows[:30]
    ]

    return reply(f"{len(rows)} vendor(s).", items=items)


# ---- INVENTORY ----

def handle_low_stock(tok_set, raw, db):

    rows = db.query(Inventory).filter(
        Inventory.QUANTITY < 10
    ).all()

    items = [
        {"label": r.MATERIAL_NAME or "(unnamed)", "meta": f"qty: {r.QUANTITY}"}
        for r in rows[:30]
    ]

    if not rows:

        return reply("All materials have healthy stock levels (>= 10). ✅")

    return reply(
        f"⚠️  {len(rows)} material(s) are low on stock (< 10 units).",
        items=items,
        suggestions=["out of stock", "inventory value"]
    )


def handle_out_of_stock(tok_set, raw, db):

    rows = db.query(Inventory).filter(
        Inventory.QUANTITY <= 0
    ).all()

    items = [
        {"label": r.MATERIAL_NAME or "(unnamed)", "meta": "OUT OF STOCK"}
        for r in rows[:30]
    ]

    if not rows:

        return reply("Nothing is out of stock. ✅")

    return reply(f"🚨 {len(rows)} material(s) are OUT OF STOCK.", items=items)


def handle_inventory_total(tok_set, raw, db):

    rows = db.query(Inventory).all()

    total_qty = sum(r.QUANTITY or 0 for r in rows)

    total_value = sum(
        (r.QUANTITY or 0) * (r.UNIT_PRICE or 0) for r in rows
    )

    catalog = db.query(MaterialCatalog).count()

    items = [
        {"label": "Stock entries", "meta": str(len(rows))},
        {"label": "Catalog items", "meta": str(catalog)},
        {"label": "Total quantity", "meta": str(total_qty)},
        {"label": "Total value", "meta": f"₹{total_value:,.2f}"}
    ]

    # Top 5 by value
    top = sorted(
        rows,
        key=lambda r: -((r.QUANTITY or 0) * (r.UNIT_PRICE or 0))
    )[:5]

    for r in top:

        v = (r.QUANTITY or 0) * (r.UNIT_PRICE or 0)

        items.append({
            "label": f"  ↳ {r.MATERIAL_NAME}",
            "meta": f"₹{v:,.2f}"
        })

    return reply(
        "Inventory summary:",
        items=items,
        suggestions=["low stock", "out of stock"]
    )


def handle_inventory_value(tok_set, raw, db):

    rows = db.query(Inventory).all()

    total = sum(
        (r.QUANTITY or 0) * (r.UNIT_PRICE or 0) for r in rows
    )

    return reply(
        f"Total inventory value: ₹{total:,.2f} across "
        f"{len(rows)} stock entries."
    )


# ---- ATTENDANCE ----

def handle_late_today(tok_set, raw, db):

    today = date.today()

    rows = db.query(Attendance).filter(
        Attendance.DATE == today,
        Attendance.STATUS == "LATE"
    ).all()

    items = []

    for a in rows:

        emp = db.query(Employee).filter(
            Employee.ID == a.EMPLOYEE_ID
        ).first()

        items.append({
            "label": emp.NAME if emp else f"Employee {a.EMPLOYEE_ID}",
            "meta": (
                f"checked in {a.CHECK_IN.strftime('%H:%M')}"
                if a.CHECK_IN else "no check-in time"
            )
        })

    if not rows:

        return reply("No employees are marked LATE today. 👍")

    return reply(f"{len(rows)} employee(s) were late today.", items=items)


def handle_attendance_today(tok_set, raw, db):

    today = date.today()

    rows = db.query(
        Attendance.STATUS,
        func.count(Attendance.ID)
    ).filter(
        Attendance.DATE == today
    ).group_by(Attendance.STATUS).all()

    items = [
        {"label": s or "UNKNOWN", "meta": f"{c} employee(s)"}
        for s, c in rows
    ]

    total = sum(c for _, c in rows)

    if not rows:

        return reply("No attendance records logged for today yet.")

    return reply(
        f"Today's attendance: {total} record(s) logged.",
        items=items
    )


def handle_absent_today(tok_set, raw, db):

    today = date.today()

    rows = db.query(Attendance).filter(
        Attendance.DATE == today,
        Attendance.STATUS == "ABSENT"
    ).all()

    items = []

    for a in rows:

        emp = db.query(Employee).filter(
            Employee.ID == a.EMPLOYEE_ID
        ).first()

        items.append({
            "label": emp.NAME if emp else f"Employee {a.EMPLOYEE_ID}",
            "meta": "ABSENT"
        })

    if not rows:

        return reply("No one is marked absent today. ✅")

    return reply(f"{len(rows)} employee(s) absent today.", items=items)


# ---- MACHINES ----

def handle_machine_status(tok_set, raw, db):

    rows = db.query(
        Machine.STATUS,
        func.count(Machine.ID)
    ).group_by(Machine.STATUS).all()

    items = [
        {"label": s or "UNKNOWN", "meta": f"{c} machine(s)"}
        for s, c in rows
    ]

    total = sum(c for _, c in rows)

    if not rows:

        return reply("No machines registered yet.")

    return reply(f"Machine status across {total} unit(s):", items=items)


def handle_broken_machines(tok_set, raw, db):

    rows = db.query(Machine).filter(
        Machine.STATUS.in_(["DOWN", "BROKEN", "MAINTENANCE"])
    ).all()

    items = [
        {
            "label": m.MACHINE_NAME or f"Machine #{m.ID}",
            "meta": f"{m.STATUS} · {m.LOCATION or 'no location'}"
        }
        for m in rows
    ]

    if not rows:

        return reply("All machines are operational. ✅")

    return reply(f"⚠️  {len(rows)} machine(s) need attention.", items=items)


# ---- ALERTS ----

def handle_alerts(tok_set, raw, db):

    rows = db.query(Notification).filter(
        Notification.IS_READ == 0
    ).order_by(Notification.CREATED_AT.desc()).limit(10).all()

    items = [
        {
            "label": n.TITLE or "(no title)",
            "meta": n.TYPE or "INFO"
        }
        for n in rows
    ]

    if not rows:

        return reply("No unread alerts. 👍")

    return reply(f"You have {len(rows)} unread alert(s).", items=items)


# ---- SYSTEM STATUS ----

def handle_system_status(tok_set, raw, db):

    today = date.today()

    emps = db.query(Employee).filter(
        Employee.STATUS == "ACTIVE"
    ).count()

    projs = db.query(Project).count()

    tasks = db.query(TaskAssignment).count()

    pending = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_STATUS == "PENDING"
    ).count()

    overdue = db.query(TaskAssignment).filter(
        TaskAssignment.DUE_DATE < today,
        TaskAssignment.TASK_STATUS.in_(ACTIVE_STATUSES)
    ).count()

    low = db.query(Inventory).filter(
        Inventory.QUANTITY < 10
    ).count()

    unread = db.query(Notification).filter(
        Notification.IS_READ == 0
    ).count()

    customers = db.query(Customer).count()

    machines = db.query(Machine).count()

    items = [
        {"label": "Active employees", "meta": str(emps)},
        {"label": "Projects", "meta": str(projs)},
        {"label": "Customers", "meta": str(customers)},
        {"label": "Machines", "meta": str(machines)},
        {"label": "Total tasks", "meta": str(tasks)},
        {"label": "Pending tasks", "meta": str(pending)},
        {"label": "Overdue tasks", "meta": str(overdue)},
        {"label": "Low-stock items", "meta": str(low)},
        {"label": "Unread alerts", "meta": str(unread)}
    ]

    return reply(
        "📊 System snapshot:",
        items=items,
        suggestions=["overdue tasks", "low stock", "workload summary"]
    )


# ---- THANKS ----

def handle_thanks(tok_set, raw, db):

    return reply("You're welcome! 😊  Anything else?")


# =========================
# RULE-BASED INTENT ROUTER
# Each rule: (predicate_fn, handler, name).
# First matching rule wins. Ordered specific → general.
# =========================

# =================================================================
# BVC24 EXTENSION HANDLERS
# Production, Quality, Suppliers, Leave, MD Performance, Biometric.
# Added after the original task/employee/inventory handlers so the
# chatbot understands every module of the BVC24 ERP.
# =================================================================


# ---- PRODUCTION & WORK ORDERS ----------------------------------

def handle_production_status(tok_set, raw, db):

    total = db.query(WorkOrder).count()

    statuses = {}

    for s in ["PLANNED", "IN_PROGRESS", "ON_HOLD", "DONE", "CANCELLED"]:

        statuses[s] = (
            db.query(WorkOrder).filter(WorkOrder.STATUS == s).count()
        )

    units = (
        db.query(func.coalesce(func.sum(WorkOrder.QUANTITY), 0))
        .filter(WorkOrder.STATUS == "IN_PROGRESS")
        .scalar()
        or 0
    )

    return reply(
        f"Production status: {total} work orders total · "
        f"{statuses['IN_PROGRESS']} in progress ({int(units)} units), "
        f"{statuses['PLANNED']} planned, {statuses['DONE']} done.",
        items=[
            {"label": k, "value": v}
            for k, v in statuses.items() if v > 0
        ],
        suggestions=[
            "List work orders",
            "Open NCRs",
            "Machine models",
            "Production pulse"
        ]
    )


def handle_list_work_orders(tok_set, raw, db):

    rows = (
        db.query(WorkOrder, ProductModel)
        .outerjoin(ProductModel, WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID)
        .order_by(WorkOrder.CREATED_AT.desc())
        .limit(10)
        .all()
    )

    if not rows:

        return reply(
            "No work orders yet. Run /demo/seed-bvc24 to seed sample WOs."
        )

    items = [
        {
            "label": wo.WO_NUMBER,
            "value": (
                f"{model.MODEL_NAME if model else '—'} · "
                f"{wo.QUANTITY} units · {wo.STATUS}"
            )
        }
        for wo, model in rows
    ]

    return reply(
        f"Latest {len(rows)} work orders:",
        items=items,
        suggestions=["Production status", "Active work orders", "Done work orders"]
    )


def handle_machine_models(tok_set, raw, db):

    rows = db.query(ProductModel).order_by(ProductModel.MODEL_NAME).all()

    if not rows:

        return reply("No machine models seeded yet.")

    items = [
        {
            "label": m.MODEL_CODE,
            "value": f"{m.MODEL_NAME} · {m.CATEGORY or 'uncategorized'} · {m.ESTIMATED_BUILD_DAYS}d build"
        }
        for m in rows
    ]

    return reply(
        f"BVC24 manufactures {len(rows)} machine models:",
        items=items,
        suggestions=["Show BOM for snack combo", "Work orders", "Production status"]
    )


def handle_bom_for_model(tok_set, raw, db):
    """If the message contains a model code or name, show its BOM."""

    model = None

    # Try MODEL_CODE first (case-insensitive)
    models = db.query(ProductModel).all()

    raw_lower = (raw or "").lower()

    for m in models:

        if m.MODEL_CODE and m.MODEL_CODE.lower() in raw_lower:

            model = m

            break

        if m.MODEL_NAME and m.MODEL_NAME.lower() in raw_lower:

            model = m

            break

    if not model:

        # Default to the first model so the user sees an example
        model = models[0] if models else None

    if not model:

        return reply("No machine models found.")

    bom = (
        db.query(BOMItem)
        .filter(BOMItem.PRODUCT_MODEL_ID == model.ID)
        .order_by(BOMItem.ID)
        .all()
    )

    items = [
        {
            "label": b.MATERIAL_NAME,
            "value": f"{b.QUANTITY} {b.UNIT or 'pcs'} · {b.ITEM_TYPE or 'PURCHASE'}"
        }
        for b in bom
    ]

    return reply(
        f"BOM for {model.MODEL_NAME} ({model.MODEL_CODE}) — "
        f"{len(items)} item(s):",
        items=items,
        suggestions=["List machine models", "Production status"]
    )


# ---- QUALITY -----------------------------------------------------

def handle_quality_status(tok_set, raw, db):

    total = db.query(QCInspection).count()

    by_status = {}

    for s in ["PENDING", "PASS", "FAIL", "REWORK"]:

        by_status[s] = (
            db.query(QCInspection).filter(QCInspection.STATUS == s).count()
        )

    pass_rate = (
        round(by_status["PASS"] / total * 100, 1) if total else 0
    )

    open_ncrs = (
        db.query(NCR).filter(NCR.STATUS.in_(["OPEN", "IN_PROGRESS"])).count()
    )

    critical = (
        db.query(NCR)
        .filter(
            NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]),
            NCR.SEVERITY == "CRITICAL"
        )
        .count()
    )

    return reply(
        f"Quality: {total} inspections · pass rate {pass_rate}% · "
        f"{open_ncrs} open NCRs ({critical} critical).",
        items=[
            {"label": k, "value": v}
            for k, v in by_status.items() if v > 0
        ],
        suggestions=["List open NCRs", "Critical NCRs", "Production status"]
    )


def handle_open_ncrs(tok_set, raw, db):

    severity_filter = None

    if has_word(tok_set, "critical"):

        severity_filter = "CRITICAL"

    elif has_word(tok_set, "major"):

        severity_filter = "MAJOR"

    elif has_word(tok_set, "minor"):

        severity_filter = "MINOR"

    q = db.query(NCR).filter(NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]))

    if severity_filter:

        q = q.filter(NCR.SEVERITY == severity_filter)

    rows = q.order_by(NCR.OPENED_AT.desc()).limit(15).all()

    if not rows:

        label = f"{severity_filter} " if severity_filter else ""

        return reply(f"No open {label}NCRs. Quality is green ✓")

    items = [
        {
            "label": n.NCR_NUMBER,
            "value": f"{n.CHECK_POINT} · {n.SEVERITY} · {n.STATUS}"
        }
        for n in rows
    ]

    return reply(
        f"{len(rows)} open NCR(s):",
        items=items,
        suggestions=["Quality status", "Critical NCRs"]
    )


# ---- SUPPLIERS --------------------------------------------------

def handle_list_suppliers(tok_set, raw, db):

    rows = (
        db.query(Supplier)
        .filter(Supplier.STATUS == "ACTIVE")
        .order_by(Supplier.COMPANY_NAME)
        .all()
    )

    if not rows:

        return reply("No suppliers found. Run /demo/seed-bvc24.")

    items = [
        {
            "label": s.SUPPLIER_CODE,
            "value": f"{s.COMPANY_NAME} · {s.CATEGORY or 'uncategorised'} · {s.CITY or '—'}"
        }
        for s in rows
    ]

    return reply(
        f"{len(rows)} active supplier(s):",
        items=items,
        suggestions=["Suppliers in Electronics", "Purchase items", "Production status"]
    )


def handle_suppliers_by_category(tok_set, raw, db):

    # Try to extract category keyword
    cat_map = {
        "motor":         "Motors",
        "electronic":    "Electronics",
        "display":       "Display",
        "payment":       "Payment Hardware",
        "refrigerat":    "Refrigeration",
        "sheet":         "Sheet Metal",
        "glass":         "Glass"
    }

    found_cat = None

    for kw, cat in cat_map.items():

        if any(kw in t for t in tok_set):

            found_cat = cat

            break

    if not found_cat:

        return handle_list_suppliers(tok_set, raw, db)

    rows = (
        db.query(Supplier)
        .filter(Supplier.CATEGORY == found_cat, Supplier.STATUS == "ACTIVE")
        .all()
    )

    if not rows:

        return reply(f"No suppliers in category '{found_cat}'.")

    items = [
        {
            "label": s.SUPPLIER_CODE,
            "value": f"{s.COMPANY_NAME} · {s.CITY or '—'} · {s.PAYMENT_TERMS or '—'}"
        }
        for s in rows
    ]

    return reply(
        f"Suppliers in {found_cat}: {len(rows)}",
        items=items
    )


# ---- LEAVE -----------------------------------------------------

def handle_leave_summary(tok_set, raw, db):

    total = db.query(LeaveRequest).count()

    by_status = {}

    for s in ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"]:

        by_status[s] = (
            db.query(LeaveRequest).filter(LeaveRequest.STATUS == s).count()
        )

    today = date.today()

    on_leave_today = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE <= today,
            LeaveRequest.END_DATE >= today
        )
        .count()
    )

    return reply(
        f"Leave overview: {total} requests · "
        f"{by_status['PENDING_APPROVAL']} pending MD approval · "
        f"{by_status['APPROVED']} approved · "
        f"{on_leave_today} on leave today.",
        items=[
            {"label": k.replace("_", " "), "value": v}
            for k, v in by_status.items() if v > 0
        ],
        suggestions=["Pending leave requests", "Who is on leave today"]
    )


def handle_pending_leave(tok_set, raw, db):

    rows = (
        db.query(LeaveRequest, Employee)
        .outerjoin(Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID)
        .filter(LeaveRequest.STATUS == "PENDING_APPROVAL")
        .order_by(LeaveRequest.CREATED_AT.desc())
        .limit(10)
        .all()
    )

    if not rows:

        return reply("No pending leave requests. MD inbox is clear ✓")

    items = [
        {
            "label": (emp.NAME if emp else "Unknown"),
            "value": (
                f"{lv.LEAVE_TYPE} · {lv.START_DATE} → {lv.END_DATE} · "
                f"{lv.DAYS} day(s) · {lv.REASON or '(no reason)'}"
            )
        }
        for lv, emp in rows
    ]

    return reply(
        f"{len(rows)} leave request(s) awaiting MD approval:",
        items=items,
        suggestions=["Who is on leave today", "Leave summary"]
    )


def handle_on_leave_today(tok_set, raw, db):

    today = date.today()

    rows = (
        db.query(LeaveRequest, Employee)
        .outerjoin(Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID)
        .filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE <= today,
            LeaveRequest.END_DATE >= today
        )
        .all()
    )

    if not rows:

        return reply("Nobody is on leave today. Full attendance ✓")

    items = [
        {
            "label": emp.NAME if emp else "Unknown",
            "value": f"{lv.LEAVE_TYPE} · until {lv.END_DATE}"
        }
        for lv, emp in rows
    ]

    return reply(
        f"{len(rows)} employee(s) on leave today:",
        items=items
    )


# ---- MD PERFORMANCE --------------------------------------------

def handle_performance_summary(tok_set, raw, db):

    # Lightweight version — call the existing service so logic stays
    # in one place.
    from app.services.performance_service import score_all_employees

    today = date.today()

    start = today - timedelta(days=29)

    # Find BVC24 vendor id
    bvc = (
        db.query(Vendor)
        .filter(Vendor.VENDOR_NAME == "Bharath Vending Corporation")
        .first()
    )

    vendor_id = bvc.ID if bvc else 1

    rows = score_all_employees(db, vendor_id, start, today)

    if not rows:

        return reply("No performance data yet for the last 30 days.")

    top = rows[0]

    bottom = rows[-1]

    avg = round(sum(r["performance_score"] for r in rows) / len(rows), 1)

    items = [
        {
            "label": r["NAME"],
            "value": (
                f"score {r['performance_score']} · "
                f"{r['band']} · suggest {r['suggested_increment_pct']}% raise"
            )
        }
        for r in rows[:6]
    ]

    return reply(
        f"Performance (last 30 days): avg score {avg}/100 · "
        f"top: {top['NAME']} ({top['performance_score']}) · "
        f"lowest: {bottom['NAME']} ({bottom['performance_score']}).",
        items=items,
        suggestions=["Open MD Performance Review", "Increment bands", "Workload summary"]
    )


# ---- BIOMETRIC / GATE ------------------------------------------

def handle_recent_biometric(tok_set, raw, db):

    rows = (
        db.query(BiometricEvent, Employee)
        .outerjoin(Employee, BiometricEvent.EMPLOYEE_ID == Employee.ID)
        .order_by(BiometricEvent.EVENT_TIME.desc())
        .limit(8)
        .all()
    )

    if not rows:

        return reply("No biometric scans recorded yet today.")

    items = [
        {
            "label": (
                emp.NAME if emp else f"Unknown FP {evt.FINGERPRINT_ID}"
            ),
            "value": (
                f"{evt.EVENT_TIME.strftime('%H:%M') if evt.EVENT_TIME else '—'} · "
                f"{evt.DEVICE_ID} · {evt.RESULT}"
            )
        }
        for evt, emp in rows
    ]

    return reply(
        f"Recent biometric scans ({len(rows)}):",
        items=items,
        suggestions=["Who is in office", "Late today", "Attendance today"]
    )


def handle_who_in_office(tok_set, raw, db):

    today = date.today()

    rows = (
        db.query(Attendance, Employee)
        .outerjoin(Employee, Attendance.EMPLOYEE_ID == Employee.ID)
        .filter(
            Attendance.DATE == today,
            Attendance.CHECK_IN.isnot(None),
            Attendance.CHECK_OUT.is_(None)
        )
        .all()
    )

    if not rows:

        return reply("Nobody is currently in office.")

    items = [
        {
            "label": emp.NAME if emp else "Unknown",
            "value": (
                f"Checked in at {att.CHECK_IN.strftime('%H:%M') if att.CHECK_IN else '—'}"
                f" · {att.STATUS or 'PRESENT'}"
            )
        }
        for att, emp in rows
    ]

    return reply(
        f"{len(rows)} employee(s) currently in office:",
        items=items,
        suggestions=["Recent biometric scans", "Who checked out", "Late today"]
    )


# ---- PROCESS STAGES (Gantt) ------------------------------------

def handle_stages_for_model(tok_set, raw, db):
    """Returns the process stages defined for a machine model."""

    models = db.query(ProductModel).all()

    raw_lower = (raw or "").lower()

    model = None

    for m in models:

        if (
            (m.MODEL_CODE and m.MODEL_CODE.lower() in raw_lower)
            or (m.MODEL_NAME and m.MODEL_NAME.lower() in raw_lower)
        ):

            model = m

            break

    if not model:

        model = models[0] if models else None

    if not model:

        return reply("No machine models seeded yet.")

    stages = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == model.ID,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    items = [
        {
            "label": f"Stage {s.SEQUENCE}: {s.STAGE_NAME}",
            "value": f"{s.STAGE_TYPE} · {s.ESTIMATED_HOURS}h"
        }
        for s in stages
    ]

    return reply(
        f"{model.MODEL_NAME} has {len(items)} manufacturing stages:",
        items=items
    )


# ---- BVC24 SYSTEM OVERVIEW (mini summary) ----------------------

def handle_bvc24_overview(tok_set, raw, db):
    """Single-shot health check covering every BVC24 module."""

    today = date.today()

    employees = db.query(Employee).filter(Employee.STATUS == "ACTIVE").count()

    in_office = (
        db.query(Attendance)
        .filter(
            Attendance.DATE == today,
            Attendance.CHECK_IN.isnot(None),
            Attendance.CHECK_OUT.is_(None)
        )
        .count()
    )

    pending_leaves = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.STATUS == "PENDING_APPROVAL")
        .count()
    )

    in_progress_wo = (
        db.query(WorkOrder).filter(WorkOrder.STATUS == "IN_PROGRESS").count()
    )

    open_ncrs = (
        db.query(NCR).filter(NCR.STATUS.in_(["OPEN", "IN_PROGRESS"])).count()
    )

    suppliers = (
        db.query(Supplier).filter(Supplier.STATUS == "ACTIVE").count()
    )

    return reply(
        "BVC24 system snapshot — everything green ✓"
        if (pending_leaves == 0 and open_ncrs == 0)
        else "BVC24 system snapshot — items need attention.",
        items=[
            {"label": "Active employees", "value": employees},
            {"label": "In office now", "value": in_office},
            {"label": "Pending leave (MD)", "value": pending_leaves},
            {"label": "Work orders in progress", "value": in_progress_wo},
            {"label": "Open NCRs", "value": open_ncrs},
            {"label": "Active suppliers", "value": suppliers}
        ],
        suggestions=[
            "Production status",
            "Quality status",
            "Pending leave",
            "Who is in office",
            "Performance summary"
        ]
    )


def build_rules():

    R = []

    def add(predicate, handler, name=""):
        R.append((predicate, handler, name))

    # ---- META ----
    add(lambda t: has(t, "greeting"), handle_greeting, "greeting")
    add(lambda t: has(t, "help"), handle_help, "help")
    add(lambda t: has_word(t, "thanks", "thank", "thx", "ty"), handle_thanks, "thanks")
    # BVC24 overview wins over the older system-status if user types "bvc24"
    add(lambda t: has_word(t, "bvc24", "bvc"), handle_bvc24_overview, "bvc24_overview")
    add(lambda t: ("system" in t or "app" in t or "dashboard" in t or "overall" in t) and (has(t, "summary") or has_word(t, "status", "statu")), handle_system_status, "system")
    add(lambda t: has_word(t, "snapshot", "overview"), handle_system_status, "snapshot")

    # =============================================================
    # BVC24 MODULES — Production, Quality, Suppliers, Leave,
    # Performance, Biometric, Stages. Added at top priority so
    # specific intents win over generic ones (e.g. "supplier list"
    # routes to the supplier handler, not the older vendor one).
    # =============================================================

    # ---- BIOMETRIC / WHO-IS-IN-OFFICE ----
    add(
        lambda t: (has(t, "who") and (has_word(t, "office", "factory") or has(t, "checkin"))),
        handle_who_in_office,
        "who_in_office"
    )
    add(
        lambda t: (has_word(t, "checkedin", "checkin") and has_word(t, "today", "currently"))
                  or (has_word(t, "in") and has_word(t, "office")),
        handle_who_in_office,
        "in_office"
    )
    add(
        lambda t: has(t, "biometric") or has_word(t, "scan", "scans", "fingerprint"),
        handle_recent_biometric,
        "biometric_recent"
    )

    # ---- LEAVE ----
    add(
        lambda t: has(t, "leave") and (has(t, "pending") or has(t, "approval")),
        handle_pending_leave,
        "pending_leave"
    )
    add(
        lambda t: (has_word(t, "on") and has(t, "leave") and has(t, "today")),
        handle_on_leave_today,
        "on_leave_today"
    )
    add(
        lambda t: has(t, "leave") and (has(t, "balance") or has(t, "summary") or has(t, "count")),
        handle_leave_summary,
        "leave_summary"
    )
    add(
        lambda t: has(t, "leave"),
        handle_leave_summary,
        "leave_generic"
    )

    # ---- PERFORMANCE / INCREMENT ----
    add(
        lambda t: has(t, "performance") or has_word(t, "increment", "raise", "rating"),
        handle_performance_summary,
        "performance"
    )

    # ---- QUALITY / NCR ----
    add(
        lambda t: has(t, "ncr") or (has(t, "quality") and (has(t, "list") or has(t, "pending"))),
        handle_open_ncrs,
        "open_ncrs"
    )
    add(
        lambda t: has(t, "quality") or has_word(t, "inspect", "inspection", "qc", "qa"),
        handle_quality_status,
        "quality_status"
    )

    # ---- SUPPLIERS ----
    add(
        lambda t: has(t, "supplier") and (
            has_word(t, "motor", "electronic", "display", "payment", "refrigerat", "sheet", "glass")
        ),
        handle_suppliers_by_category,
        "suppliers_by_cat"
    )
    add(
        lambda t: has(t, "supplier") or has(t, "purchase"),
        handle_list_suppliers,
        "suppliers"
    )

    # ---- PRODUCTION / WORK ORDERS / BOM ----
    add(
        lambda t: has(t, "bom"),
        handle_bom_for_model,
        "bom"
    )
    add(
        lambda t: has(t, "stage"),
        handle_stages_for_model,
        "stages"
    )
    add(
        lambda t: (has_word(t, "machinemodel") or
                   (has_word(t, "machine") and has_word(t, "model", "models", "catalog", "variant"))),
        handle_machine_models,
        "machine_models"
    )
    add(
        lambda t: has(t, "workorder") or
                  (has(t, "production") and has(t, "list")) or
                  (has_word(t, "wo")),
        handle_list_work_orders,
        "work_orders"
    )
    add(
        lambda t: has(t, "production") or has_word(t, "manufacturing", "factory", "assembly"),
        handle_production_status,
        "production"
    )

    # ---- WHY ASSIGNED ----
    add(
        lambda t: has(t, "why") and has_word(t, "assigned", "picked", "chosen", "always", "getting", "selected"),
        handle_why_assigned,
        "why_assigned"
    )

    # ---- ATTENDANCE — keep BEFORE 'overdue' so 'late today' wins ----
    add(
        lambda t: has_word(t, "late") and has_word(t, "today"),
        handle_late_today,
        "late_today"
    )
    add(
        lambda t: has_word(t, "late") and has(t, "employee"),
        handle_late_today,
        "late_emp"
    )
    add(
        lambda t: has_word(t, "absent"),
        handle_absent_today,
        "absent"
    )
    add(
        lambda t: has(t, "attendance"),
        handle_attendance_today,
        "attendance"
    )

    # ---- WORKLOAD ----
    add(
        lambda t: has(t, "top") and has(t, "workload"),
        handle_top_loaded,
        "top_loaded"
    )
    add(
        lambda t: has(t, "top") and has(t, "employee"),
        handle_top_loaded,
        "top_loaded_emp"
    )
    add(
        lambda t: has(t, "workload"),
        handle_workload_summary,
        "workload"
    )
    add(
        lambda t: has(t, "who") and has_word(t, "free", "available", "idle"),
        handle_workload_summary,
        "who_free"
    )

    # ---- INVENTORY SPECIFICS (before task — 'stock value' shouldn't hit task) ----
    add(
        lambda t: has(t, "inventory") and has(t, "empty"),
        handle_out_of_stock,
        "out_of_stock"
    )
    add(
        lambda t: has(t, "inventory") and has(t, "low"),
        handle_low_stock,
        "low_stock"
    )
    add(
        lambda t: has(t, "inventory") and has(t, "value"),
        handle_inventory_value,
        "inv_value"
    )
    add(
        lambda t: has(t, "inventory"),
        handle_inventory_total,
        "inventory_generic"
    )

    # ---- MACHINE SPECIFICS (before task — "machines working" shouldn't hit task) ----
    add(
        lambda t: has(t, "machine") and has_word(t, "broken", "down", "maintenance", "fault"),
        handle_broken_machines,
        "broken_machine"
    )
    add(
        lambda t: has(t, "machine"),
        handle_machine_status,
        "machine_generic"
    )

    # ---- TASK SPECIFICS ----
    add(
        lambda t: has(t, "approval") and has(t, "pending"),
        handle_pending_approval,
        "pending_approval"
    )
    add(
        lambda t: has_word(t, "unapproved") or (has_word(t, "waiting") and has(t, "task")),
        handle_pending_approval,
        "unapproved"
    )
    add(
        lambda t: has(t, "overdue") and has(t, "task"),
        handle_overdue_tasks,
        "overdue_task"
    )
    add(
        lambda t: has_word(t, "overdue", "past"),
        handle_overdue_tasks,
        "overdue"
    )
    add(
        lambda t: has(t, "progress") and has(t, "task"),
        handle_in_progress_tasks,
        "in_progress"
    )
    add(
        lambda t: has(t, "completed") and has(t, "task"),
        handle_completed_tasks,
        "completed"
    )
    add(
        lambda t: has(t, "pending") and has(t, "task"),
        handle_pending_tasks,
        "pending"
    )
    add(
        lambda t: has(t, "task") and (has(t, "count") or has(t, "list")),
        handle_task_total,
        "task_count_or_list"
    )
    add(
        lambda t: has(t, "task"),
        handle_task_total,
        "task_generic"
    )

    # ---- ALERTS ----
    add(lambda t: has(t, "alert"), handle_alerts, "alerts")

    # ---- PROJECTS ----
    add(
        lambda t: has(t, "project") and any(w in t for w in {"active", "ongoing", "open", "running"}),
        handle_active_projects,
        "active_proj"
    )
    add(
        lambda t: has(t, "project") and has(t, "count"),
        handle_project_total,
        "project_count"
    )
    add(
        lambda t: has(t, "project") and has(t, "list"),
        handle_list_projects,
        "project_list"
    )
    add(
        lambda t: has(t, "project"),
        handle_list_projects,
        "project_generic"
    )

    # ---- CUSTOMERS / VENDORS ----
    add(
        lambda t: has(t, "customer") and has(t, "count"),
        handle_customer_total,
        "customer_count"
    )
    add(
        lambda t: has(t, "customer"),
        handle_list_customers,
        "customer_generic"
    )
    add(
        lambda t: has(t, "vendor"),
        handle_list_vendors,
        "vendor_generic"
    )

    # ---- EMPLOYEES (before department — 'employees in HR' should list HR people) ----
    add(
        lambda t: has(t, "employee") and has(t, "count"),
        handle_employee_total,
        "employee_count"
    )
    add(
        lambda t: has(t, "employee"),
        handle_list_employees,
        "employee_generic"
    )

    # ---- DEPARTMENTS ----
    add(
        lambda t: has(t, "department"),
        handle_list_departments,
        "department_generic"
    )

    return R


RULES = build_rules()


# =========================
# MAIN PARSE
# =========================

def parse_intent(text, db):

    raw = (text or "").strip()

    if not raw:

        return reply(
            "Please type a question. Try 'help' to see what "
            "I can answer."
        )

    norm = normalize(raw)

    tok_set = set(tokens(norm))

    # ===== PHASE 1: RULE-BASED INTENT =====
    # Specific intent patterns take priority — 'system status'
    # must NOT be interpreted as 'employee named System'.
    for predicate, handler, name in RULES:

        try:

            if predicate(tok_set):

                return handler(tok_set, norm, db)

        except Exception as e:

            return reply(
                f"Sorry, I hit an error while looking that up: {str(e)}"
            )

    # ===== PHASE 2: ENTITY LOOKUP =====
    # No structured intent matched. Maybe the user typed a name
    # directly: 'Ram', 'Steel Bolt', 'ABC Foods'. Scan tables.
    finders = [
        (find_material_in_text, profile_material),
        (find_machine_in_text, profile_machine),
        (find_customer_in_text, profile_customer),
        (find_project_in_text, profile_project),
        (find_department_in_text, profile_department),
        (find_employee_in_text, profile_employee)
    ]

    for finder, profiler in finders:

        try:

            ent = finder(db, norm)

            if ent is not None:

                return profiler(db, ent, tok_set)

        except Exception:

            pass

    # ===== PHASE 3: TOPIC FALLBACK =====
    # Single concept mentioned but no rule matched — route by topic.
    topic_handlers = [
        # BVC24 modules first
        ("production",  handle_production_status),
        ("workorder",   handle_list_work_orders),
        ("bom",         handle_bom_for_model),
        ("quality",     handle_quality_status),
        ("ncr",         handle_open_ncrs),
        ("supplier",    handle_list_suppliers),
        ("purchase",    handle_list_suppliers),
        ("leave",       handle_leave_summary),
        ("performance", handle_performance_summary),
        ("biometric",   handle_recent_biometric),
        ("stage",       handle_stages_for_model),
        ("checkin",     handle_who_in_office),
        # Legacy
        ("inventory",   handle_inventory_total),
        ("task",        handle_task_total),
        ("project",     handle_list_projects),
        ("employee",    handle_list_employees),
        ("department",  handle_list_departments),
        ("customer",    handle_list_customers),
        ("vendor",      handle_list_vendors),
        ("machine",     handle_machine_status),
        ("attendance",  handle_attendance_today),
        ("alert",       handle_alerts),
        ("workload",    handle_workload_summary)
    ]

    for concept, handler in topic_handlers:

        if has(tok_set, concept):

            try:

                return handler(tok_set, norm, db)

            except Exception as e:

                return reply(
                    f"Sorry, I hit an error while looking that up: {str(e)}"
                )

    # ===== PHASE 4: TRUE UNKNOWN =====
    return reply(
        "I didn't quite catch that. Here's what I can help with — "
        "try one of these or type a name (employee, project, "
        "supplier, machine model):",
        suggestions=[
            "BVC24 overview",
            "Production status",
            "Quality status",
            "Open NCRs",
            "Who is in office",
            "Pending leave",
            "Performance summary",
            "List suppliers",
            "Machine models",
            "Workload summary",
            "Help"
        ]
    )


# =========================
# ENDPOINT
# =========================

class ChatStreamMessage(BaseModel):

    message: str

    history: Optional[List[Dict[str, str]]] = None

    use_gemini: Optional[bool] = None
    # tri-state:
    #   True  -> always use Gemini
    #   False -> always use rule-based
    #   None  -> hybrid (rules first, fallback to Gemini)


def _is_rule_unknown(result: Dict) -> bool:
    """Heuristic: did the rule-based bot just return the generic
    'I didn't quite catch that' fallback?"""

    reply_txt = (result.get("reply") or "").lower()

    return (
        "didn't quite catch" in reply_txt
        or "don't understand" in reply_txt
    )


@router.post("/chat")
def chat(
    data: ChatMessage,
    db: Session = Depends(get_db)
):
    """Non-streaming endpoint. Pure rule-based — runs the keyword
    matcher (`parse_intent`) against the user's message and returns
    the structured reply. 100% local, no external API, no quota."""

    return parse_intent(data.message, db)


@router.post("/chat/stream")
def chat_stream(
    data: ChatStreamMessage,
    db: Session = Depends(get_db)
):
    """
    SSE-streaming endpoint, pure rule-based.

    Streams the rule-based parser's reply with a typewriter effect
    so the UX feels alive without any LLM call. The Gemini route
    was disabled because the project's Google account hit
    permission/quota restrictions on every model.

    Frame format (one JSON per SSE event):
      {"type": "text",  "text": str}                   # token chunk
      {"type": "items", "items": [...]}                # rule-based items
      {"type": "suggestions", "suggestions": [...]}    # follow-up chips
      {"type": "source", "source": "rules"}            # always rules now
      {"type": "done"}
      {"type": "error", "message": str}
    """

    def _sse(payload: Dict) -> str:

        return f"data: {json.dumps(payload)}\n\n"

    def generate():

        message = (data.message or "").strip()

        if not message:

            yield _sse({"type": "error", "message": "Empty message"})

            yield _sse({"type": "done"})

            return

        # Always go through the rule-based parser. No Gemini fallback
        # — that path was removed after the Google account hit
        # project-level permission denials.
        yield _sse({"type": "source", "source": "rules"})

        try:

            result = parse_intent(message, db)

        except Exception as e:

            yield _sse({
                "type": "error",
                "message": f"Parser error: {e}"
            })

            yield _sse({"type": "done"})

            return

        # Stream the reply with a fake typewriter effect for consistent UX.
        text = (result.get("reply") or "").strip()

        for i in range(0, len(text), 6):

            yield _sse({"type": "text", "text": text[i:i + 6]})

        items = result.get("items") or []

        if items:

            yield _sse({"type": "items", "items": items})

        suggestions = result.get("suggestions") or []

        if suggestions:

            yield _sse({
                "type": "suggestions",
                "suggestions": suggestions
            })

        yield _sse({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/chat/health")
def chat_health():
    """Reports the chatbot mode. The Gemini AI path is currently
    disabled — the project's Google account hit 403/quota errors on
    every model, so the chatbot runs purely on the local rule-based
    parser. 100% free, no external API, works offline."""

    return {
        "rules": True,
        "gemini": False,
        "gemini_model_preferred": None,
        "gemini_model_fallbacks": [],
        "mode": "rules_only",
        "message": (
            "Chatbot runs on the local rule-based parser. "
            "No external API, no quota, works offline."
        )
    }


@router.get("/chat/suggestions")
def chat_suggestions():
    """Surfaces a tighter set of BVC24-aware quick prompts so the
    chat panel highlights what the system can actually answer."""

    return {
        "suggestions": [
            "BVC24 overview",
            "Production status",
            "Quality status",
            "Open NCRs",
            "Who is in office",
            "Recent biometric scans",
            "Pending leave requests",
            "Performance summary",
            "List suppliers",
            "Suppliers in Electronics",
            "Machine models",
            "Show BOM",
            "Pending tasks",
            "Workload summary",
            "Low stock materials",
            "List customers",
            "Help"
        ]
    }
