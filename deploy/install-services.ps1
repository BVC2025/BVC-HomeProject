# =====================================================================
# install-services.ps1  —  One-shot installer for all 3 Windows services
# ---------------------------------------------------------------------
# Installs (or reinstalls) the three production services in order:
#   1. BVC24-Backend     (uvicorn FastAPI on :8001)
#   2. BVC24-Frontend    (vite preview on :4173, 127.0.0.1 only)
#   3. BVC24-Cloudflared (named tunnel exposing both publicly)
#
# Run from elevated PowerShell at the repo root:
#   .\deploy\install-services.ps1
#
# To uninstall everything:
#   .\deploy\install-services.ps1 -Uninstall
#
# To preview without making changes:
#   .\deploy\install-services.ps1 -DryRun
# =====================================================================

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$DryRun,
    [switch]$SkipBuild   # skip the frontend production build step
)

$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$RepoRoot  = Split-Path -Parent $DeployDir

# Verify elevation
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    throw "This script requires an elevated PowerShell (Run as Administrator)."
}

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host " BVC24 ERP — Production Services Installer"                    -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host " Repo:      $RepoRoot"
Write-Host " Deploy:    $DeployDir"
Write-Host " Mode:      " -NoNewline
if ($Uninstall) {
    Write-Host "UNINSTALL" -ForegroundColor Red
} elseif ($DryRun) {
    Write-Host "DRY-RUN" -ForegroundColor Yellow
} else {
    Write-Host "INSTALL" -ForegroundColor Green
}
Write-Host ""

$extra = @()
if ($DryRun)    { $extra += "-DryRun" }

if ($Uninstall) {
    # Tear down in REVERSE order — tunnel first so external traffic stops
    # before backend/frontend disappear.
    Write-Host "==> [1/3] Uninstalling BVC24-Cloudflared..." -ForegroundColor Yellow
    & (Join-Path $DeployDir "nssm-install-cloudflared.ps1") -Uninstall @extra

    Write-Host "==> [2/3] Uninstalling BVC24-Frontend..." -ForegroundColor Yellow
    & (Join-Path $DeployDir "nssm-install-frontend.ps1") -Uninstall @extra

    Write-Host "==> [3/3] Uninstalling BVC24-Backend..." -ForegroundColor Yellow
    & (Join-Path $DeployDir "nssm-install-backend.ps1") -Uninstall @extra

    Write-Host ""
    Write-Host "==> All services removed." -ForegroundColor Green
    return
}

# Build the frontend production bundle unless told to skip
if (-not $SkipBuild) {
    Write-Host "==> [0/3] Building frontend production bundle..." -ForegroundColor Yellow
    & (Join-Path $DeployDir "build-frontend.ps1")
    Write-Host ""
}

Write-Host "==> [1/3] Installing BVC24-Backend (uvicorn)..." -ForegroundColor Yellow
& (Join-Path $DeployDir "nssm-install-backend.ps1") @extra
Write-Host ""

Write-Host "==> [2/3] Installing BVC24-Frontend (vite preview)..." -ForegroundColor Yellow
& (Join-Path $DeployDir "nssm-install-frontend.ps1") @extra
Write-Host ""

Write-Host "==> [3/3] Installing BVC24-Cloudflared (named tunnel)..." -ForegroundColor Yellow
& (Join-Path $DeployDir "nssm-install-cloudflared.ps1") @extra
Write-Host ""

Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host " All three services installed and started."                    -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Verify:"
Write-Host "  Locally:  http://127.0.0.1:4173      (frontend)"
Write-Host "            http://127.0.0.1:8001/docs (backend OpenAPI)"
Write-Host ""
Write-Host "  Public:   https://erp.bvc24.com      (frontend)"
Write-Host "            https://api.bvc24.com/docs (backend)"
Write-Host ""
Write-Host "  From phone on MOBILE DATA (not office WiFi) — confirms the"
Write-Host "  tunnel reaches the public internet, not just the LAN."
Write-Host ""
Write-Host "Service status:  Get-Service BVC24-*"
Write-Host "Service logs:    Check the AppStdout paths printed above per service."
Write-Host ""
