# =====================================================================
# nssm-install-frontend.ps1
# ---------------------------------------------------------------------
# Registers `vite preview` (the production static-file server for the
# built React app) as a Windows service via NSSM. Binds to 127.0.0.1
# only — Cloudflare Tunnel reaches it; the LAN does not.
#
# Prerequisites:
#   1. NSSM 2.24+
#   2. Node.js 18+ on PATH
#   3. A production build exists at frontend/dist/
#      (run .\deploy\build-frontend.ps1 first)
#
# Run ONCE from elevated PowerShell:
#   .\deploy\nssm-install-frontend.ps1
#
# Uninstall later:
#   .\deploy\nssm-install-frontend.ps1 -Uninstall
# =====================================================================

[CmdletBinding()]
param(
    [string]$ServiceName = "BVC24-Frontend",
    [string]$NssmPath    = "nssm",
    [int]   $Port        = 4173,
    [switch]$Uninstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Invoke-Nssm {
    param([string[]]$Args)
    if ($DryRun) {
        Write-Host "  [dry-run] $NssmPath $($Args -join ' ')" -ForegroundColor DarkGray
        return
    }
    & $NssmPath @Args
    if ($LASTEXITCODE -ne 0) {
        throw "NSSM command failed: $NssmPath $($Args -join ' ')"
    }
}

# ---- Resolve paths ---------------------------------------------------

$DeployDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = Split-Path -Parent $DeployDir
$FrontendDir = Join-Path $RepoRoot "frontend"
$DistDir     = Join-Path $FrontendDir "dist"
$LogDir      = Join-Path $FrontendDir "logs\service"

Write-Host ""
Write-Host "==> BVC24 Frontend (vite preview) service installer" -ForegroundColor Cyan
Write-Host "    Service:  $ServiceName"
Write-Host "    Frontend: $FrontendDir"
Write-Host "    Port:     $Port (127.0.0.1 only — Cloudflare tunnel hits this)"
Write-Host ""

if ($Uninstall) {
    Write-Host "==> Uninstalling $ServiceName..." -ForegroundColor Yellow
    Invoke-Nssm @("stop",   $ServiceName)
    Invoke-Nssm @("remove", $ServiceName, "confirm")
    Write-Host "==> Done." -ForegroundColor Green
    return
}

# ---- Sanity checks ---------------------------------------------------

if (-not (Test-Path $DistDir)) {
    throw "Build output not found at $DistDir. Run .\deploy\build-frontend.ps1 first."
}

$npmCmd = (Get-Command npm -ErrorAction SilentlyContinue)
if (-not $npmCmd) {
    throw "npm not found on PATH. Install Node.js 18+ and re-open PowerShell."
}

# NSSM needs the absolute path to npm.cmd (Windows wrapper around node)
$NpmPath = $npmCmd.Source

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

# ---- Install / reinstall ---------------------------------------------

$existing = & $NssmPath status $ServiceName 2>$null
if ($existing) {
    Write-Host "==> Existing service detected. Removing and reinstalling..." -ForegroundColor Yellow
    Invoke-Nssm @("stop",   $ServiceName)
    Invoke-Nssm @("remove", $ServiceName, "confirm")
}

Write-Host "==> Installing service..." -ForegroundColor Yellow

# `npm run preview -- --host 127.0.0.1 --port 4173`
Invoke-Nssm @("install", $ServiceName, $NpmPath, "run", "preview", "--", "--host", "127.0.0.1", "--port", "$Port")
Invoke-Nssm @("set", $ServiceName, "DisplayName",      "BVC24 — Frontend (vite preview)")
Invoke-Nssm @("set", $ServiceName, "Description",      "Serves the built React app at http://127.0.0.1:$Port for Cloudflare Tunnel.")
Invoke-Nssm @("set", $ServiceName, "AppDirectory",     $FrontendDir)
Invoke-Nssm @("set", $ServiceName, "Start",            "SERVICE_AUTO_START")
Invoke-Nssm @("set", $ServiceName, "AppStdout",        (Join-Path $LogDir "frontend.out.log"))
Invoke-Nssm @("set", $ServiceName, "AppStderr",        (Join-Path $LogDir "frontend.err.log"))
Invoke-Nssm @("set", $ServiceName, "AppRotateFiles",   "1")
Invoke-Nssm @("set", $ServiceName, "AppRotateBytes",   "10485760")
Invoke-Nssm @("set", $ServiceName, "AppExit",          "Default", "Restart")
Invoke-Nssm @("set", $ServiceName, "AppRestartDelay",  "5000")

Write-Host "==> Starting service..." -ForegroundColor Yellow
Invoke-Nssm @("start", $ServiceName)

Start-Sleep -Seconds 3

$status = & $NssmPath status $ServiceName
Write-Host ""
Write-Host "==> Status: $status" -ForegroundColor Green
Write-Host ""
Write-Host "Logs:   $LogDir\frontend.{out,err}.log"
Write-Host "Local:  http://127.0.0.1:$Port"
Write-Host ""
