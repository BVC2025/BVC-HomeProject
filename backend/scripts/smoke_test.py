"""
smoke_test.py  —  Post-deploy sanity check.

Hits 14 critical endpoints and verifies the system is alive. Run
this immediately after every deploy / restart / config change.

Usage
-----
  python -m scripts.smoke_test                          # local default
  python -m scripts.smoke_test --base https://erp.example.com
  python -m scripts.smoke_test --base https://erp.example.com \\
      --admin-code ADMIN --admin-pass admin123 \\
      --emp-code EMP101 --emp-pass test123

Exit codes
----------
  0  every check passed
  1  one or more checks failed (details printed)
"""

import argparse
import json
import sys
import time
from urllib import request as urlreq
from urllib import error as urlerr


PASS = "[PASS]"
FAIL = "[FAIL]"
SKIP = "[SKIP]"


def http(method: str, url: str, *, headers=None, body=None, timeout=10):
    """Bare urllib call. Returns (status_code, text)."""
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers = dict(headers or {})
        headers["Content-Type"] = "application/json"

    req = urlreq.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urlreq.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urlerr.HTTPError as e:
        try:
            txt = e.read().decode("utf-8", "replace")
        except Exception:
            txt = ""
        return e.code, txt
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


class Checks:
    def __init__(self, base, admin_code, admin_pass, emp_code, emp_pass):
        self.base = base.rstrip("/")
        self.admin_code = admin_code
        self.admin_pass = admin_pass
        self.emp_code = emp_code
        self.emp_pass = emp_pass
        self.admin_token = None
        self.emp_token = None
        self.failures = []

    def _log(self, label, ok, detail=""):
        tag = PASS if ok else FAIL
        if detail:
            print(f"  {tag}  {label} — {detail}")
        else:
            print(f"  {tag}  {label}")
        if not ok:
            self.failures.append(label)

    def _auth_headers(self, token):
        return {"Authorization": f"Bearer {token}"} if token else {}

    # -- Phase 1: app is alive ----------------------------------------
    def health(self):
        code, txt = http("GET", f"{self.base}/chat/health")
        self._log("01. /chat/health responds 200", code == 200, f"status={code}")

    def docs(self):
        code, _ = http("GET", f"{self.base}/docs")
        self._log("02. /docs (OpenAPI UI) loads", code == 200, f"status={code}")

    def geofence_settings(self):
        code, txt = http("GET", f"{self.base}/geofence/settings")
        ok = code == 200 and '"OFFICE_NAME"' in txt
        self._log("03. /geofence/settings returns office config", ok, f"status={code}")

    # -- Phase 2: auth works ------------------------------------------
    def admin_login(self):
        code, txt = http("POST", f"{self.base}/admin-login",
                         body={"EMPLOYEE_CODE": self.admin_code,
                               "PASSWORD":      self.admin_pass})
        ok = False
        if code == 200:
            try:
                self.admin_token = json.loads(txt).get("access_token")
                ok = bool(self.admin_token)
            except Exception:
                ok = False
        self._log("04. Admin login issues a JWT", ok, f"status={code}")

    def employee_login(self):
        code, txt = http("POST", f"{self.base}/employee-login",
                         body={"EMPLOYEE_ID": self.emp_code,
                               "PASSWORD":    self.emp_pass})
        ok = False
        if code == 200:
            try:
                self.emp_token = json.loads(txt).get("access_token")
                ok = bool(self.emp_token)
            except Exception:
                ok = False
        self._log("05. Employee login issues a JWT", ok, f"status={code}")

    def bad_login_rejected(self):
        code, _ = http("POST", f"{self.base}/admin-login",
                       body={"EMPLOYEE_CODE": self.admin_code, "PASSWORD": "deliberately-wrong"})
        ok = code in (401, 404)
        self._log("06. Wrong password is rejected (401/404)", ok, f"status={code}")

    # -- Phase 3: protection holds ------------------------------------
    def protected_no_token_blocked(self):
        code, _ = http("GET", f"{self.base}/employees")
        self._log("07. /employees rejects unauthenticated (401)", code == 401, f"status={code}")

    def admin_can_access(self):
        if not self.admin_token:
            self._log("08. Admin can read /employees", False, "no admin token from check 04")
            return
        code, _ = http("GET", f"{self.base}/employees", headers=self._auth_headers(self.admin_token))
        self._log("08. Admin can read /employees", code == 200, f"status={code}")

    def employee_cant_access_admin(self):
        if not self.emp_token:
            self._log("09. Employee cannot read /memos (admin endpoint)", False, "no emp token from check 05")
            return
        code, _ = http("GET", f"{self.base}/memos", headers=self._auth_headers(self.emp_token))
        # Should be 403 (authenticated but not authorised)
        self._log("09. Employee blocked from /memos (403)", code == 403, f"status={code}")

    def employee_sees_own_data(self):
        if not self.emp_token:
            self._log(f"10. Employee reads /employees/by-code/{self.emp_code}", False, "no emp token")
            return
        code, _ = http("GET", f"{self.base}/employees/by-code/{self.emp_code}",
                      headers=self._auth_headers(self.emp_token))
        self._log(f"10. Employee can read own profile", code == 200, f"status={code}")

    def employee_blocked_from_other(self):
        if not self.emp_token:
            self._log("11. Employee blocked from another employee's data", False, "no emp token")
            return
        code, _ = http("GET", f"{self.base}/employees/by-code/{self.admin_code}",
                      headers=self._auth_headers(self.emp_token))
        self._log("11. Employee blocked from another employee's data (403)", code == 403, f"status={code}")

    # -- Phase 4: Audit log is wired ----------------------------------
    def audit_records_login(self):
        if not self.admin_token:
            self._log("12. Audit log contains recent admin-login row", False, "no admin token")
            return
        code, txt = http("GET", f"{self.base}/audit-logs?path_contains=admin-login&limit=5",
                       headers=self._auth_headers(self.admin_token))
        ok = False
        if code == 200:
            try:
                data = json.loads(txt)
                ok = data.get("total", 0) > 0
            except Exception:
                ok = False
        self._log("12. Audit log captured the admin login", ok, f"status={code}")

    # -- Phase 5: Cron deps importable --------------------------------
    def cron_scripts_importable(self):
        # We can't run the actual cron via HTTP, but we CAN verify the
        # scripts are importable (catches syntax errors after deploy).
        import importlib
        ok = True
        try:
            for mod in ("scripts.mark_absent",
                        "scripts.expire_onboarding_sessions",
                        "scripts.prune_audit_log"):
                importlib.import_module(mod)
        except Exception as e:
            ok = False
            self._log("13. Cron scripts import without error", False,
                     f"{type(e).__name__}: {e}")
            return
        self._log("13. Cron scripts import without error", ok)

    # -- Phase 6: DB is reachable -------------------------------------
    def db_reachable(self):
        if not self.admin_token:
            self._log("14. DB reachable (admin endpoint returns data)", False, "no admin token")
            return
        code, txt = http("GET", f"{self.base}/admin/dashboard-stats",
                       headers=self._auth_headers(self.admin_token))
        ok = code == 200 and '"total_customers"' in txt
        self._log("14. DB reachable (dashboard-stats returns counts)", ok, f"status={code}")

    def run_all(self):
        print(f"\nSMOKE TEST: {self.base}")
        print("=" * (12 + len(self.base)))
        self.health()
        self.docs()
        self.geofence_settings()
        self.admin_login()
        self.employee_login()
        self.bad_login_rejected()
        self.protected_no_token_blocked()
        self.admin_can_access()
        self.employee_cant_access_admin()
        self.employee_sees_own_data()
        self.employee_blocked_from_other()
        self.audit_records_login()
        self.cron_scripts_importable()
        self.db_reachable()


def main():
    p = argparse.ArgumentParser(description="Post-deploy smoke test for BVC24 ERP.")
    p.add_argument("--base", default="http://127.0.0.1:8000",
                   help="Backend base URL (default %(default)s)")
    p.add_argument("--admin-code", default="ADMIN")
    p.add_argument("--admin-pass", default="admin123")
    p.add_argument("--emp-code", default="EMP101")
    p.add_argument("--emp-pass", default="test123")
    args = p.parse_args()

    started = time.time()
    c = Checks(args.base, args.admin_code, args.admin_pass, args.emp_code, args.emp_pass)
    c.run_all()
    elapsed = time.time() - started

    print()
    if c.failures:
        print(f"SMOKE FAILED — {len(c.failures)} failure(s) in {elapsed:.1f}s:")
        for f in c.failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"SMOKE PASSED — all 14 checks succeeded in {elapsed:.1f}s.")
    sys.exit(0)


if __name__ == "__main__":
    main()
