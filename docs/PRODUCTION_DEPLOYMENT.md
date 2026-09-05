# BVC24 ERP — Production Deployment Runbook

> Target platform: **Windows Server** (the platform you're already on).
> Linux/Docker variants in [Appendix](#appendix-linux-variant) — same tools, different commands.
>
> Total deployment time from a fresh server: **2-3 hours** end-to-end, including all manual steps.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Server preparation](#2-server-preparation)
3. [Database setup](#3-database-setup)
4. [Code deploy](#4-code-deploy)
5. [Configuration](#5-configuration)
6. [Build frontend](#6-build-frontend)
7. [Install backend as a service](#7-install-backend-as-a-service)
8. [Install Caddy (reverse proxy + HTTPS)](#8-install-caddy-reverse-proxy--https)
9. [Install cron tasks](#9-install-cron-tasks)
10. [DNS setup](#10-dns-setup)
11. [First-run setup](#11-first-run-setup)
12. [Smoke test](#12-smoke-test)
13. [Routine operations](#13-routine-operations)
14. [Updating to a new version](#14-updating-to-a-new-version)
15. [Rollback](#15-rollback)
16. [Troubleshooting](#16-troubleshooting)
17. [Appendix — Linux variant](#appendix-linux-variant)

---

## 1. Prerequisites

| Need | What works | Notes |
|---|---|---|
| Server | Windows Server 2019+ / Windows 10 Pro | 2 vCPU, 4 GB RAM, 40 GB disk minimum |
| Public IP | Static recommended | If dynamic, see Cloudflare Tunnel alternative |
| Domain | Owned domain you can edit DNS for | e.g. `erp.yourcompany.com` |
| Email (SMTP) | Gmail App Password / SendGrid / Resend / SES | For leave-approval emails |
| Python | 3.11+ | Used by backend |
| Node | 20+ | Used to build frontend |
| MySQL | 8.0+ | Or a managed MySQL (AWS RDS, etc.) |
| Caddy | 2.7+ | Reverse proxy + HTTPS |
| NSSM | 2.24+ | Run backend as a service |

---

## 2. Server preparation

```powershell
# Open PowerShell as Administrator.

# 2.1 Disable IE Enhanced Security (so you can download installers)
# Server Manager → Local Server → IE Enhanced Security Configuration → Off

# 2.2 Install Python 3.11+
# https://www.python.org/downloads/ → run installer, check "Add to PATH"
python --version

# 2.3 Install Node 20 LTS
# https://nodejs.org/en/download → run installer
node --version

# 2.4 Install Git
# https://git-scm.com/download/win
git --version

# 2.5 Install NSSM
# Download from https://nssm.cc/release/nssm-2.24.zip
# Extract win64/nssm.exe to C:\Windows\System32\
nssm version

# 2.6 Install Caddy
# Download from https://caddyserver.com/download → caddy_X.Y.Z_windows_amd64.zip
# Extract caddy.exe to C:\Caddy\
# Add C:\Caddy to PATH
caddy version

# 2.7 Install MySQL Server 8.0
# https://dev.mysql.com/downloads/installer/
# During install, write down the root password. You'll need it in §3.
```

---

## 3. Database setup

```powershell
# 3.1 Connect to MySQL as root
mysql -u root -p

# Inside the MySQL prompt:
```
```sql
CREATE DATABASE bvc24_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Dedicated app user (do NOT use root in the .env file)
CREATE USER 'bvc24_app'@'localhost' IDENTIFIED BY 'GENERATE-A-STRONG-PASSWORD-HERE';
GRANT ALL PRIVILEGES ON bvc24_prod.* TO 'bvc24_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> **Why a dedicated user?** If the app ever leaks credentials, the attacker gets DML on bvc24_prod only — not your whole MySQL server. Don't use root.

---

## 4. Code deploy

```powershell
# 4.1 Choose a deployment root
$DeployRoot = "C:\inetpub\bvc24"
New-Item -ItemType Directory -Path $DeployRoot -Force | Out-Null
cd $DeployRoot

# 4.2 Clone the repo (use HTTPS + a deploy token, NOT your personal password)
git clone https://github.com/YOUR_ORG/YOUR_REPO.git .

# 4.3 Pin to a specific tag/commit for reproducibility
git checkout v1.0.0      # or whatever your release tag is

# 4.4 Set up the Python venv
cd backend
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt

# 4.5 Install frontend dependencies
cd ..\frontend
npm ci
```

---

## 5. Configuration

```powershell
# 5.1 Backend .env
Copy-Item ..\deploy\backend.env.example backend\.env
notepad backend\.env

# Fill in EVERY CHANGE_ME value:
#   - DATABASE_URL              ← use the bvc24_app user + password from §3
#   - SECRET_KEY                ← run: python -c "import secrets; print(secrets.token_urlsafe(48))"
#   - FRONTEND_BASE_URL         ← https://erp.yourcompany.com
#   - SMTP_HOST / USER / PASS   ← from your email provider
#   - BCRYPT_ROUNDS=12          ← (NOT 4)

# 5.2 Frontend production env
Copy-Item ..\deploy\frontend.env.production.example frontend\.env.production
notepad frontend\.env.production
# Set VITE_API_URL = https://erp.yourcompany.com/api
```

---

## 6. Build frontend

```powershell
cd $DeployRoot\frontend
npm run build

# This produces frontend\dist\ — the directory Caddy will serve.
# Check it exists:
Test-Path .\dist\index.html      # should print True
```

---

## 7. Install backend as a service

```powershell
cd $DeployRoot\deploy
.\nssm-install-backend.ps1

# What this does:
#   - Registers a Windows service called "BVC24-Backend"
#   - Runs uvicorn on 0.0.0.0:8001 with 2 workers
#   - Auto-starts on boot
#   - Restarts on crash with 5s backoff
#   - Logs stdout/stderr to backend\logs\service\

# Verify it's running:
Get-Service BVC24-Backend
# Status: Running

# Live tail the log if it's NOT running:
Get-Content $DeployRoot\backend\logs\service\stderr.log -Tail 50
```

---

## 8. Install Caddy (reverse proxy + HTTPS)

```powershell
# 8.1 Copy + edit the config
Copy-Item $DeployRoot\deploy\Caddyfile.example C:\Caddy\Caddyfile
notepad C:\Caddy\Caddyfile

# Replace both occurrences of erp.example.com with YOUR domain.
# Update the frontend dist path if your $DeployRoot differs.

# 8.2 Make Caddy a service (also via NSSM)
nssm install BVC24-Caddy C:\Caddy\caddy.exe "run --config C:\Caddy\Caddyfile"
nssm set BVC24-Caddy AppDirectory C:\Caddy
nssm set BVC24-Caddy AppStdout C:\Caddy\logs\stdout.log
nssm set BVC24-Caddy AppStderr C:\Caddy\logs\stderr.log
nssm set BVC24-Caddy Start SERVICE_AUTO_START
nssm start BVC24-Caddy

# 8.3 Verify Caddy started
Get-Service BVC24-Caddy
# Caddy will auto-provision the HTTPS cert on first request to your
# domain. This requires DNS (§10) to already point at this server.

# 8.4 Open Windows Firewall for HTTPS + HTTP
New-NetFirewallRule -DisplayName "Caddy HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Caddy HTTP"  -Direction Inbound -LocalPort 80  -Protocol TCP -Action Allow
```

---

## 9. Install cron tasks

```powershell
cd $DeployRoot\backend\scripts
.\register_scheduled_tasks.ps1

# Registers 3 Task Scheduler entries:
#   BVC24-MarkAbsent          daily   23:55
#   BVC24-ExpireOnboarding    hourly  :05
#   BVC24-PruneAuditLog       weekly  Sun 02:00

# Verify:
Get-ScheduledTask -TaskName "BVC24-*" | Format-Table TaskName,State
```

---

## 10. DNS setup

On your domain registrar / DNS provider:

```
Type   Name                      Value                  TTL
A      erp.yourcompany.com       <SERVER PUBLIC IP>     3600
```

Wait 5-15 minutes for DNS to propagate. Verify:

```powershell
nslookup erp.yourcompany.com
# Should resolve to your server's public IP
```

Caddy will now auto-acquire the Let's Encrypt cert on first request. **You don't need certbot.**

---

## 11. First-run setup

```powershell
# 11.1 Create the first admin user
cd $DeployRoot\backend
.\venv\Scripts\python.exe -c "
from dotenv import load_dotenv; load_dotenv()
from app.database.database import SessionLocal
from app.models.models import Employee, Role
from app.services.auth_service import hash_password
db = SessionLocal()

# Find SUPER_ADMIN role
role = db.query(Role).filter(Role.ROLE_NAME == 'SUPER_ADMIN').first()
if not role:
    role = Role(ROLE_NAME='SUPER_ADMIN')
    db.add(role); db.commit(); db.refresh(role)

# Check if ADMIN already exists
existing = db.query(Employee).filter(Employee.EMPLOYEE_CODE == 'ADMIN').first()
if existing:
    print('ADMIN already exists; not changing.')
else:
    emp = Employee(
        EMPLOYEE_CODE='ADMIN',
        NAME='System Administrator',
        EMAIL='admin@yourcompany.com',
        PASSWORD=hash_password('CHANGE-ME-IMMEDIATELY-IN-THE-UI'),
        ROLE_ID=role.ID,
        STATUS='ACTIVE',
        PROFILE_SUBMITTED=1
    )
    db.add(emp); db.commit()
    print('Created ADMIN. Login: ADMIN / CHANGE-ME-IMMEDIATELY-IN-THE-UI')
db.close()
"

# 11.2 Configure the geofence (replace lat/lng with your office)
.\venv\Scripts\python.exe -c "
from dotenv import load_dotenv; load_dotenv()
from app.database.database import SessionLocal
from app.models.models import GeofenceSettings
db = SessionLocal()
g = db.query(GeofenceSettings).filter(GeofenceSettings.VENDOR_ID == 1).first()
if not g:
    g = GeofenceSettings(
        VENDOR_ID=1, OFFICE_NAME='Main Office',
        LATITUDE=11.0411, LONGITUDE=77.0388,
        RADIUS_METERS=100, IS_ACTIVE=True
    )
    db.add(g); db.commit()
    print('Geofence created. Edit via the admin UI to change.')
else:
    print('Geofence already exists.')
db.close()
"

# 11.3 Open the site
Start-Process "https://erp.yourcompany.com/login"
# Sign in as ADMIN / your initial password
# IMMEDIATELY: Settings → My Account → Change password
```

---

## 12. Smoke test

```powershell
cd $DeployRoot\backend
.\venv\Scripts\python.exe -m scripts.smoke_test --base https://erp.yourcompany.com/api

# Should print:
#   SMOKE PASSED — all 14 checks succeeded in 1.0s.

# Run this after EVERY deploy. If it fails, see §15 Rollback.
```

---

## 13. Routine operations

### Daily

```powershell
# Check service health
Get-Service BVC24-Backend, BVC24-Caddy

# Tail backend errors (look for tracebacks)
Get-Content $DeployRoot\backend\logs\service\stderr.log -Tail 100
```

### Weekly

```powershell
# Check cron task last-run results
Get-ScheduledTaskInfo -TaskName "BVC24-MarkAbsent"
Get-ScheduledTaskInfo -TaskName "BVC24-ExpireOnboarding"
Get-ScheduledTaskInfo -TaskName "BVC24-PruneAuditLog"

# Tail their logs
Get-Content $DeployRoot\backend\logs\cron\BVC24-MarkAbsent.log -Tail 20

# Review audit log for failed logins / 403s
# (via the admin UI's /audit-logs feed or curl with admin token)
```

### Monthly

```powershell
# 1. Backup the database (always before updates)
$stamp = Get-Date -Format "yyyyMMdd"
mysqldump -u root -p bvc24_prod | Out-File "C:\backups\bvc24_$stamp.sql"

# 2. Review disk usage of logs
Get-ChildItem $DeployRoot\backend\logs -Recurse |
    Measure-Object Length -Sum |
    Select-Object @{n='SizeMB';e={[math]::Round($_.Sum/1MB,1)}}

# 3. Check SSL cert expiry (Caddy auto-renews, but verify)
# Open https://erp.yourcompany.com in a browser → padlock → cert info
```

---

## 14. Updating to a new version

```powershell
# 1. ALWAYS backup the database first
cd $DeployRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
mysqldump -u root -p bvc24_prod | Out-File "C:\backups\pre-update-$stamp.sql"

# 2. Pull the new code
git fetch
git checkout v1.2.3      # or whatever the new tag is

# 3. Update Python deps (no-op if no new packages)
cd backend
.\venv\Scripts\pip install -q -r requirements.txt

# 4. Rebuild frontend
cd ..\frontend
npm ci
npm run build

# 5. Restart backend (frontend doesn't need a restart — Caddy serves the fresh dist/)
Restart-Service BVC24-Backend

# 6. Smoke test IMMEDIATELY
cd ..\backend
.\venv\Scripts\python.exe -m scripts.smoke_test --base https://erp.yourcompany.com/api

# If smoke test fails → §15 Rollback
```

---

## 15. Rollback

If the smoke test fails after an update, rollback to the previous version:

```powershell
cd $DeployRoot\deploy
.\rollback.ps1

# Or roll back to a specific tag/commit:
.\rollback.ps1 -To v1.1.0

# This will:
#   1. git fetch + git reset --hard
#   2. Reinstall pinned deps
#   3. Rebuild frontend
#   4. Restart backend service
#   5. Run smoke test
#
# If smoke test STILL fails, restore the DB backup:
mysql -u root -p bvc24_prod < C:\backups\pre-update-<timestamp>.sql
```

---

## 16. Troubleshooting

### Backend service won't start

```powershell
# 1. Read the stderr log
Get-Content $DeployRoot\backend\logs\service\stderr.log -Tail 100

# 2. Common causes
#    - DATABASE_URL wrong / MySQL down → fix .env, restart
#    - SECRET_KEY missing → set it in .env
#    - Port 8001 already in use → another process; kill or change --port

# 3. Run uvicorn manually outside the service to see the real error
cd $DeployRoot\backend
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002
# Hit Ctrl+C when done; this is just diagnostic.
```

### HTTPS not working

```powershell
# 1. Did Caddy successfully provision the cert?
Get-Content C:\Caddy\logs\stdout.log -Tail 100 | Select-String -Pattern "certificate"

# Common reasons cert acquisition fails:
#   - DNS not pointing at this server yet (run nslookup again)
#   - Port 80 not reachable from the internet (Let's Encrypt verifies via :80)
#   - Firewall blocking 80/443

# 2. Test from outside
# Use https://www.ssllabs.com/ssltest/ — paste your domain
```

### Login works but pages show 0s / blank cards

Your browser has a stale JWT from before the deploy. Log out + back in.

### "Connection refused" on /api/* through Caddy

The backend service may not actually be running.

```powershell
Get-Service BVC24-Backend
# If Stopped:
Restart-Service BVC24-Backend
Get-Content $DeployRoot\backend\logs\service\stderr.log -Tail 50
```

### Mobile users can't log in but PC works

99% of the time: HTTPS isn't actually working. Check the browser's address bar on the phone — does it show the padlock?

```powershell
# If not, the cert isn't valid. Diagnose:
# 1. Open https://www.ssllabs.com/ssltest/ from PC → enter your domain
# 2. If it says "Common name doesn't match", DNS is wrong
# 3. If it says "Certificate not trusted", you may have a self-signed cert
#    instead of Let's Encrypt. Check C:\Caddy\logs\stdout.log for ACME errors.
```

### Cron task isn't running

```powershell
# Check if it's actually scheduled
Get-ScheduledTaskInfo -TaskName "BVC24-MarkAbsent"

# LastRunResult should be 0 (success) or 267009 (currently running)
# Anything else = failure. Read its log:
Get-Content $DeployRoot\backend\logs\cron\BVC24-MarkAbsent.log -Tail 50

# Common cause: the venv's python.exe path changed (e.g. you moved the
# deployment). Re-run register_scheduled_tasks.ps1 to update the paths.
```

### Audit log table growing too fast

```powershell
# Check size
mysql -u root -p bvc24_prod -e "SELECT COUNT(*) FROM audit_log;"

# Prune aggressively (e.g. drop everything older than 30 days)
cd $DeployRoot\backend
.\venv\Scripts\python.exe -m scripts.prune_audit_log --days 30
```

---

## Appendix — Linux variant

Same architecture, different commands:

| Windows | Linux |
|---|---|
| NSSM | systemd unit file in `/etc/systemd/system/bvc24-backend.service` |
| Caddy on `C:\Caddy\` | Caddy from official apt repo, config at `/etc/caddy/Caddyfile` |
| Task Scheduler | `cron` entries in `/etc/cron.d/bvc24` |
| MySQL Installer | `apt install mysql-server` |
| PowerShell | `bash` |
| `C:\inetpub\bvc24\` | `/opt/bvc24/` |

Systemd service example (`/etc/systemd/system/bvc24-backend.service`):

```ini
[Unit]
Description=BVC24 ERP backend (uvicorn)
After=network.target mysql.service

[Service]
Type=simple
User=bvc24
WorkingDirectory=/opt/bvc24/backend
ExecStart=/opt/bvc24/backend/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 2
Restart=on-failure
RestartSec=5
StandardOutput=append:/opt/bvc24/backend/logs/service/stdout.log
StandardError=append:/opt/bvc24/backend/logs/service/stderr.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable bvc24-backend
sudo systemctl start bvc24-backend
sudo systemctl status bvc24-backend
```

---

*Document version: 1.0 · Last updated: 2026-06-12 · Phase 5 deliverable*
