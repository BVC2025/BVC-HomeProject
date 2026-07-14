# =====================================================================
# install-task.ps1
# ---------------------------------------------------------------------
# Registers a Windows Scheduled Task that runs bvc_sync.py every 5
# minutes as the current user. Uses the venv Python if present, else
# falls back to `python` on PATH.
#
# Usage (in an ADMIN PowerShell window):
#     PowerShell -ExecutionPolicy Bypass -File .\install-task.ps1
#
# To uninstall:
#     schtasks /Delete /TN "BVC eSSL Bridge" /F
# =====================================================================

$ErrorActionPreference = "Stop"

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$script   = Join-Path $here "bvc_sync.py"
$envFile  = Join-Path $here "bvc-sync.env"
$taskName = "BVC eSSL Bridge"

# ---- Sanity checks -------------------------------------------------
if (-not (Test-Path $script)) {
    throw "bvc_sync.py not found at $script"
}
if (-not (Test-Path $envFile)) {
    Write-Warning "bvc-sync.env is missing at $envFile."
    Write-Warning "Copy bvc-sync.env.example to bvc-sync.env and fill in API_KEY."
    Write-Warning "Task will still be registered — it will exit with an error until .env exists."
}

# ---- Locate a Python interpreter -----------------------------------
# Prefer the project's venv (has pyzk + requests already installed).
$venvPy = Join-Path (Split-Path $here -Parent) "backend\venv\Scripts\python.exe"
if (Test-Path $venvPy) {
    $python = $venvPy
    Write-Host "Using venv Python: $python"
} else {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "No python interpreter found. Install Python 3 or run the backend venv setup first."
    }
    $python = $cmd.Source
    Write-Host "Using system Python: $python"
    Write-Warning "Install dependencies once: $python -m pip install pyzk==0.9 requests"
}

# ---- Register / update the task -----------------------------------
# Delete existing first so re-running the installer just refreshes it.
schtasks /Delete /TN $taskName /F 2>$null | Out-Null

$action = New-ScheduledTaskAction `
    -Execute $python `
    -Argument "`"$script`"" `
    -WorkingDirectory $here

$trigger = New-ScheduledTaskTrigger `
    -Once (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Every 5 minutes, pull attendance from the eSSL biometric device and forward it to the ERP backend on the Ubuntu server." `
    | Out-Null

Write-Host ""
Write-Host "Task registered: $taskName" -ForegroundColor Green
Write-Host "  runs:    every 5 minutes starting 1 min from now"
Write-Host "  python:  $python"
Write-Host "  script:  $script"
Write-Host "  workdir: $here"
Write-Host ""
Write-Host "Manual test now:"
Write-Host "  Start-ScheduledTask -TaskName `"$taskName`""
Write-Host ""
Write-Host "View logs:"
Write-Host "  Get-Content `"$here\bvc-sync.log`" -Tail 30 -Wait"
