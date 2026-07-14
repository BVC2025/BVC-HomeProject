# BVC eSSL Bridge — Windows-side sync

## What this is

The office network isolates the Ubuntu server (192.168.1.10) from the
biometric device on WiFi (192.168.1.5). This tiny Windows service
sits in the middle: it can reach both, and it forwards attendance
events from the device into the ERP backend every 5 minutes.

```
device (WiFi) ─── pyzk ───▶ Windows PC ─── HTTPS ───▶ ERP backend (Ubuntu)
```

Nothing to install or configure on the biometric device. Everything
runs on the Windows PC as a scheduled task; the ERP just gains one
new endpoint that accepts the events.

---

## One-time setup

### 1) Generate an API key

Long random string. Both sides need to know it.

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the string it prints (looks like `xy_kQ...aBcD`).

### 2) Server side — set the key in the backend .env

SSH into the Ubuntu server:

```bash
nano ~/erp-app/backend/.env
```

Add one line at the bottom:

```
ESSL_BRIDGE_API_KEY=<paste the same string here>
```

Save (Ctrl+O, Enter, Ctrl+X), then restart the backend so it reloads:

```bash
pkill -f "uvicorn app.main"
sleep 2
cd ~/erp-app/backend
source venv/bin/activate
nohup uvicorn app.main:app --host 0.0.0.0 --port 8001 > ~/backend.log 2>&1 &
```

Verify the endpoint is up:

```bash
curl -sI http://localhost:8001/api/essl-bridge/watermark
# expect HTTP/1.1 401 (missing api key) — good, endpoint exists
```

### 3) Windows side — create bvc-sync.env

In this folder:

```powershell
Copy-Item bvc-sync.env.example bvc-sync.env
notepad bvc-sync.env
```

Fill in:
- `API_KEY=<same string from step 1>`
- `BACKEND_URL=http://192.168.1.10:8001` (already correct)
- Other values default correctly for the office setup.

### 4) Windows side — install dependencies

Use the backend venv (it already has pyzk):

```powershell
& "..\backend\venv\Scripts\python.exe" -m pip install requests
```

Or into a fresh Python:

```powershell
python -m pip install pyzk==0.9 requests
```

### 5) Test manually — with DRY_RUN first

Edit `bvc-sync.env` and set `DRY_RUN=1` for the first test.

Then:

```powershell
& "..\backend\venv\Scripts\python.exe" .\bvc_sync.py
```

Expected output:

```
YYYY-MM-DD HH:MM:SS INFO ============================================================
YYYY-MM-DD HH:MM:SS INFO bvc-sync starting  backend=http://192.168.1.10:8001 device=192.168.1.5
YYYY-MM-DD HH:MM:SS INFO server watermark = 2026-07-06 ...
YYYY-MM-DD HH:MM:SS INFO connecting to device 192.168.1.5:4370
YYYY-MM-DD HH:MM:SS INFO device returned 47 events, 12 newer than watermark
YYYY-MM-DD HH:MM:SS INFO DRY_RUN=1 → not POSTing. Would send 12 events.
```

If that looks right, flip `DRY_RUN=0` and run again — this time it
actually POSTs and the ERP dashboard will show the new attendance
rows within seconds.

### 6) Register the Scheduled Task

Open PowerShell **as Administrator**, then:

```powershell
cd path\to\bvc-sync
PowerShell -ExecutionPolicy Bypass -File .\install-task.ps1
```

Task runs every 5 minutes from now on. To confirm:

```powershell
Get-ScheduledTaskInfo -TaskName "BVC eSSL Bridge"
```

---

## Day-to-day operation

### Watch it work

```powershell
Get-Content .\bvc-sync.log -Tail 30 -Wait
```

Each run logs:
- how many events the device had
- how many were newer than watermark
- how many the server applied / deduplicated / rejected

### Trigger a run right now

```powershell
Start-ScheduledTask -TaskName "BVC eSSL Bridge"
```

### Stop the automatic runs

```powershell
Disable-ScheduledTask -TaskName "BVC eSSL Bridge"
```

Re-enable with `Enable-ScheduledTask`. Fully remove with
`schtasks /Delete /TN "BVC eSSL Bridge" /F`.

---

## Troubleshooting

### `pyzk not installed`
Run `pip install pyzk==0.9 requests` in whichever Python is being
used. If unsure, check `bvc-sync.log` — first line prints the
interpreter path.

### `cannot reach biometric device 192.168.1.5:4370`
Windows PC lost its route to the device. `ping 192.168.1.5` from
PowerShell. If ping works but the bridge fails, the ESSL service
on the device is stopped — power-cycle the device.

### `cannot reach server`
Server down, or the URL in `bvc-sync.env` is wrong.

### `server rejected the API key`
`API_KEY` in `bvc-sync.env` and `ESSL_BRIDGE_API_KEY` in server .env
don't match. Copy one to the other.

### `ESSL_BRIDGE_API_KEY is not set on the server`
Step 2 was skipped or the backend wasn't restarted after editing .env.

### Task not running at all
`Get-ScheduledTaskInfo -TaskName "BVC eSSL Bridge"` shows the last
result. `0x0` = success. `0x1` = config problem (missing API key).
`0x2` = device unreachable. `0x3` = server unreachable. `0x4` =
server-side error. Full trace is in `bvc-sync.log`.

---

## Uninstall

```powershell
schtasks /Delete /TN "BVC eSSL Bridge" /F
# then delete this folder if you want
```

Server side — remove `ESSL_BRIDGE_API_KEY` from backend `.env` and
restart uvicorn. The `/api/essl-bridge/*` endpoints will start
returning 503, which is fine — nothing else calls them.
