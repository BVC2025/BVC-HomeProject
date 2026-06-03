# BVC24 ERP — Security Audit (Phase 6c)

OWASP-style review of the codebase. Findings are graded by
severity. **CRITICAL** must be fixed before any production rollout.
**HIGH** should be fixed before public-facing deployment.
**MEDIUM / LOW** are improvements, not blockers.

---

## Summary

| Severity | Count |
|---|---|
| 🔴 Critical | 3 |
| 🟠 High | 4 |
| 🟡 Medium | 5 |
| 🟢 Low / Improvement | 4 |

---

## 🔴 CRITICAL findings

### C-1. New module endpoints are completely unauthenticated

**Impact**: Anyone on the network can call `/suppliers`, `/production/work-orders`,
`/quality/inspections`, `/process/...`, `/performance/summary`, `/biometric/enroll`,
even `/demo/seed-bvc24`. Read AND write. No JWT, no role check, no rate limit.

**Evidence**: Searched all new route files for `Depends(get_current_user)` —
zero matches. The `auth_bearer.py` infrastructure exists and is used in
the original `task.py` / `auth.py`, but none of the modules I added wire it up.

**Fix** — add the dependency to every admin route:

```python
from app.auth.auth_bearer import get_current_admin

@router.post("/work-orders", dependencies=[Depends(get_current_admin)])
def create_work_order(...):
    ...
```

Routes that should stay public:
- `/biometric/scan` — needed for the gate kiosk (intentionally public)
- `/biometric/events` — should be admin-only (currently public)
- `/auth/login` — needed to obtain a JWT

Apply auth to: `/suppliers/*`, `/production/*` (except read endpoints
optionally), `/quality/*`, `/process/*`, `/performance/*`, `/demo/seed-bvc24`.

**Effort**: 30 minutes. Lowest-hanging fruit on the audit.

---

### C-2. JWT secret defaults to `dev-secret-change-me`

**Evidence**: [`backend/app/auth/jwt_handler.py:9`](../backend/app/auth/jwt_handler.py#L9)

```python
SECRET_KEY = os.getenv("SECRET_KEY") or "dev-secret-change-me"
```

**Impact**: If `.env` doesn't set `SECRET_KEY`, tokens become
forge-able by anyone who reads the source code (which is most
of the internet).

**Fix**:

```python
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY env var must be set (32+ random bytes)"
    )
```

Then ensure production `.env` has:
```
SECRET_KEY=<output of `python -c "import secrets; print(secrets.token_urlsafe(48))"`>
```

**Effort**: 5 minutes + secret rotation.

---

### C-3. CORS allows ANY origin with credentials

**Evidence**: [`backend/app/main.py`](../backend/app/main.py)

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    ...
)
```

**Impact**: This combination is dangerous — `allow_origins=["*"]` + `allow_credentials=True` lets any malicious site call our API with the user's cookie/token. Modern browsers actually reject this combo for credentialed requests, but the config still signals "no security review here."

**Fix** — lock the origin list explicitly:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://erp.bvc24.com"   # production
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"]
)
```

Drive via `ALLOWED_ORIGINS` env var in production.

**Effort**: 10 minutes.

---

## 🟠 HIGH findings

### H-1. Default admin password is `bvc24demo` (hardcoded)

**Evidence**: [`backend/app/routes/bvc24_seed.py`](../backend/app/routes/bvc24_seed.py) — every seeded employee shares the bcrypt hash of `"bvc24demo"`.

**Impact**: Fine for a demo, but if this seed runs against production
DB, every employee account has the same easily-guessable password.

**Fix**: Generate a per-employee random password on seed and email/SMS
the password back, or force a "must change on first login" flag.

---

### H-2. No rate limiting

**Impact**: `/biometric/scan` is public and could be flooded with
random fingerprint IDs (denial of service or enumeration attack).
`/auth/login` similarly has no brute-force protection.

**Fix**: Add `slowapi` middleware with per-IP throttling:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@router.post("/scan")
@limiter.limit("30/minute")
def biometric_scan(...):
    ...
```

`/auth/login` should be `5/minute`.

---

### H-3. SQL `MATERIAL_NAME` and free-text fields stored without length cap on input

**Impact**: Most fields have `String(N)` constraints in the model
which truncate silently or throw 500 on overflow. There's no Pydantic
`max_length` validation on the way in.

**Example**: [`backend/app/schemas/supplier_schema.py`](../backend/app/schemas/supplier_schema.py) — `NOTES: Optional[str] = None` has no length limit.

**Fix**: Add `Field(max_length=N)` to every text input schema:

```python
from pydantic import BaseModel, Field

class SupplierCreate(BaseModel):
    COMPANY_NAME: str = Field(..., max_length=150, min_length=2)
    GST_NUMBER: Optional[str] = Field(None, max_length=20, pattern=r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$")
    ...
```

---

### H-4. Biometric scan endpoint trusts client-supplied `TIMESTAMP`

**Evidence**: [`backend/app/routes/biometric.py`](../backend/app/routes/biometric.py) — `_parse_event_time()` uses the client's `TIMESTAMP` if present.

**Impact**: A malicious kiosk (or anyone hitting the endpoint) can
backdate or future-date check-ins, manipulating attendance + the
performance review system.

**Fix**: Use server time always:

```python
def _parse_event_time(raw: str | None) -> datetime:
    return datetime.now()   # always server time
```

Or accept TIMESTAMP only when the request includes a signed device
HMAC proving it came from a trusted gate.

---

## 🟡 MEDIUM findings

### M-1. `allow_methods=["*"]` and `allow_headers=["*"]` in CORS

Tighten to the verbs actually used (GET, POST, PATCH, DELETE) — defense in depth.

---

### M-2. `print()` statements leak environment data to stdout

[`backend/app/main.py:14-15`](../backend/app/main.py#L14)

```python
print(f"[startup] APPROVER_EMAIL = {os.getenv('APPROVER_EMAIL', '(empty)')}")
print(f"[startup] SMTP_HOST      = {os.getenv('SMTP_HOST', '(empty)')}")
```

Replace with a structured logger that has env-driven log levels,
and never log secrets.

---

### M-3. `/debug/env` endpoint exposes env vars (even masked)

[`backend/app/main.py:92-124`](../backend/app/main.py#L92) — `/debug/env`
returns env values including SMTP host/user/password (masked).
Useful for dev, dangerous in production.

**Fix**: Gate behind a DEBUG env flag:

```python
@app.get("/debug/env")
def debug_env():
    if os.getenv("DEBUG", "false").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")
    ...
```

---

### M-4. No `X-Request-ID` / structured logging

Hard to trace failures across modules in production.
Add a request-id middleware + JSON logging (loguru / structlog).

---

### M-5. No HTTPS enforcement / HSTS

`uvicorn` runs HTTP by default. For production:
- Run behind nginx/caddy with TLS
- Add `Strict-Transport-Security` header
- Redirect HTTP → HTTPS

---

## 🟢 LOW / improvement

### L-1. Email-format validation

`EMAIL` fields stored as plain `String(120)` — could use Pydantic `EmailStr` (requires `email-validator` package).

### L-2. Soft-delete pattern is inconsistent

`Supplier.delete` sets STATUS=INACTIVE (soft) but `BOM item delete` does hard `db.delete()`. Pick one convention.

### L-3. No DB connection pool tuning

`create_engine` uses defaults. For production, set `pool_size`, `max_overflow`, `pool_recycle=3600`.

### L-4. Frontend stores JWT in `localStorage`

[`frontend/src/services/api.js`](../frontend/src/services/api.js#L9) — `localStorage.getItem("token")` is vulnerable to XSS. Consider `httpOnly` cookies for production.

---

## Recommended fix order

1. **C-1** auth on all admin routes (30 min) → unlocks deployment
2. **C-2** JWT secret env-required (5 min)
3. **C-3** lock CORS origins (10 min)
4. **H-4** server-side timestamp on biometric scan (5 min)
5. **H-2** rate limiting on `/scan` + `/auth/login` (30 min)
6. **H-1** force password change on first login (1 hour)
7. **M-3** gate `/debug/env` behind DEBUG flag (5 min)
8. **H-3** Pydantic length + pattern validation (1 hour, can be incremental)
9. Remaining MEDIUM/LOW items as time permits

Total for **CRITICAL + HIGH** fixes: ~2.5 hours of focused work.

---

## Sign-off

| Item | Owner | Target date | Status |
|---|---|---|---|
| C-1 admin auth | _____ | _____ | [ ] |
| C-2 SECRET_KEY enforced | _____ | _____ | [ ] |
| C-3 CORS locked | _____ | _____ | [ ] |
| H-1 first-login password | _____ | _____ | [ ] |
| H-2 rate limiting | _____ | _____ | [ ] |
| H-3 input length caps | _____ | _____ | [ ] |
| H-4 server timestamp | _____ | _____ | [ ] |
| Production go-live cleared | Security lead | _____ | [ ] |
