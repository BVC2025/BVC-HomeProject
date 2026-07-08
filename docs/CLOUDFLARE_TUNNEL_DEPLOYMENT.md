# BVC24 ERP — Cloudflare Tunnel Deployment Runbook

> **Architecture choice:** Cloudflare Tunnel (no local Caddy / Nginx).
> Cloudflare's edge handles HTTPS termination; the local services
> (FastAPI on `:8001`, Vite preview on `:4173`) stay plain HTTP and
> are reached over an authenticated outbound tunnel from `cloudflared`
> on this office PC.
>
> If you'd rather run a local reverse proxy with its own HTTPS
> certificate, see the older [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)
> (Caddy-based path). Both paths produce a working production system —
> pick **one**, not both.
>
> **Total first-time deployment effort:** about 90 minutes, almost all
> of it the Cloudflare account setup. After that, redeploying a new
> build takes ~3 minutes.

---

## 0. What you'll end up with

```
Public internet
       │
       ▼  https://erp.bvc24.com  ── browses the React app
          https://api.bvc24.com  ── REST API
       │
       ▼
  Cloudflare edge (free plan, automatic HTTPS, automatic certificate)
       │
       ▼  authenticated outbound tunnel (QUIC; no inbound ports opened)
       │
  ┌────────────────────────────────────────────────────────┐
  │  Office PC — runs three Windows services 24/7         │
  │                                                       │
  │  • BVC24-Backend       uvicorn  127.0.0.1:8001        │
  │  • BVC24-Frontend      node     127.0.0.1:4173        │
  │  • BVC24-Cloudflared   tunnel   ── connects them out  │
  │                                                       │
  │  • MySQL 8.x           on the same machine             │
  └────────────────────────────────────────────────────────┘
```

**No port forwarding, no static IP, no firewall holes.** The tunnel
makes an outbound HTTPS connection to Cloudflare; that's the only
network change needed.

---

## 1. Prerequisites

Before starting, confirm you have:

| Item | Why | Check |
|---|---|---|
| Admin access to **bvc24.com** in Cloudflare DNS | Adding CNAME records for the two subdomains | dash.cloudflare.com → bvc24.com is listed |
| Office PC reaches the internet | Tunnel is outbound only, but it does need to reach Cloudflare | `Test-NetConnection api.cloudflare.com -Port 443` |
| Python venv at `backend/venv` is set up and the backend boots locally | `uvicorn` will run from this venv | `.\venv\Scripts\python.exe -m uvicorn app.main:app --port 8001` then visit `http://localhost:8001/docs` |
| `node` and `npm` on PATH, Node 18+ | Required for `npm run build` and `vite preview` | `node --version` |
| Latest code pulled from main | Frontend `api.js` must contain the `erp.bvc24.com` mapping | `git status` should be clean |

---

## 2. Install the two binaries

Both go on the office PC, **once**.

### 2.1 NSSM (Windows service wrapper)

```powershell
# Download
Invoke-WebRequest -Uri https://nssm.cc/release/nssm-2.24.zip -OutFile $env:TEMP\nssm.zip

# Extract (admin)
Expand-Archive $env:TEMP\nssm.zip -DestinationPath C:\Tools\nssm -Force

# Add to PATH
$arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
[Environment]::SetEnvironmentVariable(
    "Path",
    [Environment]::GetEnvironmentVariable("Path", "Machine") + ";C:\Tools\nssm\nssm-2.24\$arch",
    "Machine"
)
```

Close and re-open PowerShell so `$env:Path` refreshes. Verify:
```powershell
nssm --version
```

### 2.2 cloudflared (Cloudflare Tunnel client)

```powershell
Invoke-WebRequest `
  -Uri https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe `
  -OutFile "C:\Program Files\Cloudflare\cloudflared\cloudflared.exe"
```

Create the parent folder first if PowerShell complains:
```powershell
New-Item -ItemType Directory -Force "C:\Program Files\Cloudflare\cloudflared" | Out-Null
```

Verify:
```powershell
& "C:\Program Files\Cloudflare\cloudflared\cloudflared.exe" --version
```

---

## 3. Create the named tunnel

Run these once from an elevated PowerShell. Each command opens a browser
or prints credentials you'll need in the next step.

### 3.1 Authenticate

```powershell
cloudflared login
```

Browser opens → log in to Cloudflare → select **bvc24.com** → Authorize.
A certificate is saved to `%USERPROFILE%\.cloudflared\cert.pem`.

### 3.2 Create the tunnel

```powershell
cloudflared tunnel create bvc24-erp
```

Output looks like:
```
Tunnel credentials written to C:\Users\<you>\.cloudflared\<UUID>.json
Created tunnel bvc24-erp with id <UUID>
```

**Copy that UUID — you'll paste it into `config.yml` in a moment.**

### 3.3 Route the two hostnames to the tunnel

```powershell
cloudflared tunnel route dns bvc24-erp erp.bvc24.com
cloudflared tunnel route dns bvc24-erp api.bvc24.com
```

This creates two CNAME records in Cloudflare DNS automatically.
Verify in the dashboard: DNS tab → both should show
`<UUID>.cfargotunnel.com` as the target, status **Proxied (orange cloud)**.

### 3.4 Create the config file

```powershell
Copy-Item `
  "D:\PUVI-DOC\Vendor-based Manufacturing ERP\deploy\cloudflared-config.example.yml" `
  "$env:USERPROFILE\.cloudflared\config.yml"

notepad "$env:USERPROFILE\.cloudflared\config.yml"
```

Inside, replace the two placeholders:

| Placeholder | Value |
|---|---|
| `<TUNNEL-UUID>` | The UUID printed by step 3.2 |
| `<PATH-TO-CREDENTIALS>` | `C:\Users\<you>\.cloudflared\<UUID>.json` (use forward slashes or escaped backslashes) |

Save and close.

---

## 4. Backend env

```powershell
notepad "D:\PUVI-DOC\Vendor-based Manufacturing ERP\backend\.env"
```

Confirm these two lines are present and not pointing at any `trycloudflare.com` host:

```env
FRONTEND_BASE_URL=https://erp.bvc24.com
# Optional — only set if you need to add extra origins
# CORS_ALLOWED_ORIGINS=https://erp.bvc24.com,https://staging.bvc24.com
```

Everything else (DATABASE_URL, SECRET_KEY, SMTP_*, etc.) stays as it
already is.

---

## 5. Install the services (one command)

From the **repo root**, in an **elevated** PowerShell:

```powershell
cd "D:\PUVI-DOC\Vendor-based Manufacturing ERP"
.\deploy\install-services.ps1
```

What this does (in order):

1. **Build the frontend** — `npm install` then `npm run build` → `frontend/dist/`
2. **Install `BVC24-Backend`** — uvicorn on `127.0.0.1:8001`, auto-restart on crash
3. **Install `BVC24-Frontend`** — `vite preview` serving `dist/` on `127.0.0.1:4173`
4. **Install `BVC24-Cloudflared`** — tunnel runner, reads `~/.cloudflared/config.yml`

If any step fails, the script stops; fix the cause and re-run (it's
idempotent — it tears down and reinstalls each service rather than
duplicating).

Verify locally:
```powershell
curl http://127.0.0.1:8001/chat/health     # backend
curl http://127.0.0.1:4173                  # frontend HTML
Get-Service BVC24-*                         # all three Running
```

---

## 6. Verify externally

The whole point of this exercise is reachability from **outside** the
office WiFi.

1. **On your phone, switch to mobile data** (turn WiFi off).
2. Open `https://erp.bvc24.com` — should load the login page over HTTPS with a valid certificate.
3. Log in as `admin / admin123` (or whatever your admin password is).
4. Issue a memo, generate an onboarding link, send it to yourself via WhatsApp.
5. Click the WhatsApp link — should open the onboarding form, NOT a localhost-refused page.

If any of those fails, see the troubleshooting section at the bottom.

---

## 7. Updating after a code change

```powershell
cd "D:\PUVI-DOC\Vendor-based Manufacturing ERP"

# Pull latest code
git pull

# Rebuild frontend + restart the two app services
.\deploy\build-frontend.ps1
Restart-Service BVC24-Frontend
Restart-Service BVC24-Backend

# Cloudflared rarely needs a restart — only after config.yml changes
# Restart-Service BVC24-Cloudflared
```

A scripted version of this lives in `deploy/redeploy.ps1` (added in a later phase).

---

## 8. Routine ops

| Task | Command |
|---|---|
| See status | `Get-Service BVC24-*` |
| Backend logs | `Get-Content backend\logs\service\backend.err.log -Tail 100 -Wait` |
| Frontend logs | `Get-Content frontend\logs\service\frontend.err.log -Tail 100 -Wait` |
| Tunnel logs | `Get-Content C:\ProgramData\cloudflared\cloudflared.err.log -Tail 100 -Wait` |
| Stop everything | `Stop-Service BVC24-Cloudflared, BVC24-Backend, BVC24-Frontend` |
| Start everything | `Start-Service BVC24-Backend; Start-Service BVC24-Frontend; Start-Service BVC24-Cloudflared` |
| Uninstall all | `.\deploy\install-services.ps1 -Uninstall` |

Restart order matters if you stop and start manually:
1. Backend first (frontend will retry until backend is up)
2. Frontend second
3. Cloudflared last (only then does traffic start flowing)

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `erp.bvc24.com` shows Cloudflare's *"This site can't be reached"* | `BVC24-Cloudflared` not running | `Start-Service BVC24-Cloudflared`, then check `cloudflared.err.log` |
| `erp.bvc24.com` shows Cloudflare's *"Error 1033"* | Tunnel is up but no ingress rule matched | Check `config.yml` — hostname spelling must match exactly |
| `erp.bvc24.com` shows the React app but every API call 502s | `BVC24-Backend` down | `Get-Service BVC24-Backend` → `Start-Service` if Stopped |
| Login works but every page shows "Network Error" | CORS rejecting `erp.bvc24.com` | Check `backend/.env` — `CORS_ALLOWED_ORIGINS` if set should include `https://erp.bvc24.com`. If unset, defaults include it. |
| Onboarding link in WhatsApp opens `localhost:5173` | Old `FRONTEND_BASE_URL` cached | Update `backend/.env`, `Restart-Service BVC24-Backend`, regenerate the link |
| `cloudflared.err.log` says *"unauthorized"* | Token expired (rare) | Re-run `cloudflared login`, then `Restart-Service BVC24-Cloudflared` |
| Service refuses to start, NSSM says *"file not found"* | Path typo in the install script's invocation | Run installer with `-DryRun` to see exact command line; fix the wrong path |

---

## 10. Future improvements (out of scope for Phase 1)

- **Staging tunnel** — create `bvc24-erp-staging` pointing at `staging.bvc24.com:4173` and `api-staging.bvc24.com:8001`. Run from a separate code checkout to test releases before promoting.
- **Cloudflare Access** — gate `/admin/*` endpoints behind a one-time-PIN-by-email so a stolen JWT can't bypass perimeter auth. Free for up to 50 users.
- **Geo-restriction** — Cloudflare Page Rules can block traffic from outside India in 5 minutes if you ever decide to.

These are intentionally deferred — get the basic deployment stable first.
