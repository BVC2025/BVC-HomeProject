# =====================================================================
# nssm-install-backend.ps1
# ---------------------------------------------------------------------
# Registers the BVC24 backend (uvicorn) as a Windows service via NSSM
# so it auto-starts on boot, restarts on crash, and survives RDP logout.
#
# Prerequisite: NSSM 2.24+ installed
#   - Download:  https://nssm.cc/release/nssm-2.24.zip
#   - Extract nssm.exe somewhere on PATH (e.g. C:\Windows\System32)
#     OR pass -NssmPath C:\path\to\nssm.exe
#
# Run ONCE from elevated PowerShell:
#   .\nssm-install-backend.ps1
#
# To uninstall the service later:
#   .\nssm-install-backend.ps1 -Uninstall
#
# To preview (no changes):
#   .\nssm-install-backend.ps1 -DryRun
# =====================================================================

[CmdletBinding()]
param(
    [string]$ServiceName = "BVC24-Backend",
    [string]$NssmPath    = "nssm",       # assumes on PATH; override if needed
    [int]   $Port        = 8001,
    [string]$BindHost    = "0.0.0.0",
    [int]   $Workers     = 2,
    [switch]$Uninstall,
    [switch]$DryRun
)


# ---- Resolve paths from this script's own location ------------------
$DeployDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = Split-Path -Parent $DeployDir
$BackendRoot = Join-Path $RepoRoot "backend"
$VenvPython  = Join-Path $BackendRoot "venv\Scripts\python.exe"
$LogDir      = Join-Path $BackendRoot "logs\service"

if (-not (Test-Path $BackendRoot)) {
    Write-Host "ERROR: cannot find backend folder at $BackendRoot" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "ERROR: cannot find $VenvPython" -ForegroundColor Red
    Write-Host "       Run 'python -m venv venv' in the backend folder first." -ForegroundColor Red
    exit 1
}

# Locate nssm.exe
$nssmExe = Get-Command $NssmPath -ErrorAction SilentlyContinue
if (-not $nssmExe) {
    Write-Host "ERROR: nssm.exe not found." -ForegroundColor Red
    Write-Host "       Either:"
    Write-Host "         1. Install NSSM and put nssm.exe on PATH, OR"
    Write-Host "         2. Pass -NssmPath C:\path\to\nssm.exe"
    Write-Host "       Download: https://nssm.cc/release/nssm-2.24.zip"
    exit 1
}
$NssmExePath = $nssmExe.Source

Write-Host ""
Write-Host "BVC24 ERP - Backend Service Installer" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Service name:  $ServiceName"
Write-Host "NSSM:          $NssmExePath"
Write-Host "Python:        $VenvPython"
Write-Host "Backend root:  $BackendRoot"
Write-Host "Bind:          $BindHost`:$Port  (workers=$Workers)"
Write-Host "Log dir:       $LogDir"
Write-Host ""


# ---- Uninstall path -------------------------------------------------
if ($Uninstall) {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "Service $ServiceName is not installed." -ForegroundColor Gray
        exit 0
    }
    if ($DryRun) {
        Write-Host "would stop + remove $ServiceName" -ForegroundColor Yellow
        exit 0
    }
    if ($svc.Status -eq "Running") {
        Write-Host "Stopping $ServiceName..." -ForegroundColor Yellow
        & $NssmExePath stop $ServiceName | Out-Null
    }
    & $NssmExePath remove $ServiceName confirm | Out-Null
    Write-Host "Removed $ServiceName." -ForegroundColor Green
    exit 0
}


# ---- Ensure log dir exists ------------------------------------------
if (-not (Test-Path $LogDir)) {
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    Write-Host "would create $LogDir" -ForegroundColor Yellow
}


# ---- If service already exists, stop + remove so we can recreate ----
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    if ($DryRun) {
        Write-Host "would stop+remove existing $ServiceName before re-install" -ForegroundColor Yellow
    } else {
        Write-Host "Stopping existing $ServiceName..." -ForegroundColor Yellow
        & $NssmExePath stop $ServiceName 2>$null | Out-Null
        & $NssmExePath remove $ServiceName confirm | Out-Null
    }
}


# ---- Install --------------------------------------------------------
$uvicornArgs = "-m uvicorn app.main:app --host $BindHost --port $Port --workers $Workers"

if ($DryRun) {
    Write-Host "would run:" -ForegroundColor Yellow
    Write-Host "  $NssmExePath install $ServiceName `"$VenvPython`" $uvicornArgs"
    Write-Host "  $NssmExePath set $ServiceName AppDirectory `"$BackendRoot`""
    Write-Host "  $NssmExePath set $ServiceName AppStdout `"$LogDir\stdout.log`""
    Write-Host "  $NssmExePath set $ServiceName AppStderr `"$LogDir\stderr.log`""
    Write-Host "  $NssmExePath set $ServiceName Start SERVICE_AUTO_START"
    exit 0
}

& $NssmExePath install $ServiceName $VenvPython $uvicornArgs
& $NssmExePath set $ServiceName AppDirectory     $BackendRoot
& $NssmExePath set $ServiceName AppStdout        (Join-Path $LogDir "stdout.log")
& $NssmExePath set $ServiceName AppStderr        (Join-Path $LogDir "stderr.log")
& $NssmExePath set $ServiceName AppRotateFiles   1
& $NssmExePath set $ServiceName AppRotateBytes   52428800   # 50 MB
& $NssmExePath set $ServiceName AppRotateOnline  1
& $NssmExePath set $ServiceName Start            SERVICE_AUTO_START
& $NssmExePath set $ServiceName AppRestartDelay  5000        # 5s wait before restart
& $NssmExePath set $ServiceName AppStopMethodSkip 0
& $NssmExePath set $ServiceName Description      "BVC24 Manufacturing ERP — FastAPI backend (uvicorn)"

# Start the service
& $NssmExePath start $ServiceName

# Brief health check
Start-Sleep -Seconds 3
$svcAfter = Get-Service -Name $ServiceName
Write-Host ""
Write-Host "Service status: $($svcAfter.Status)" -ForegroundColor Cyan
if ($svcAfter.Status -ne "Running") {
    Write-Host "Service is NOT running. Check $LogDir\stderr.log" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Installed. Manage it like:" -ForegroundColor Cyan
Write-Host "  Get-Service $ServiceName"
Write-Host "  Restart-Service $ServiceName"
Write-Host "  Stop-Service $ServiceName"
Write-Host "  Get-Content `"$LogDir\stderr.log`" -Tail 50"
