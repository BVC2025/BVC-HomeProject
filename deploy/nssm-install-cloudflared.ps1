# =====================================================================
# nssm-install-cloudflared.ps1
# ---------------------------------------------------------------------
# Registers the Cloudflare named tunnel as a Windows service via NSSM
# so it auto-starts on boot, restarts on crash, and survives RDP logout.
# This is the public entry point — without it, erp.bvc24.com is down.
#
# Prerequisites:
#   1. NSSM 2.24+        — https://nssm.cc/release/nssm-2.24.zip
#   2. cloudflared.exe   — https://github.com/cloudflare/cloudflared/releases
#                          install to C:\Program Files\Cloudflare\cloudflared\
#                          (or pass -CloudflaredPath)
#   3. A logged-in tunnel — run ONCE manually:
#         cloudflared login
#         cloudflared tunnel create bvc24-erp
#         cloudflared tunnel route dns bvc24-erp erp.bvc24.com
#         cloudflared tunnel route dns bvc24-erp api.bvc24.com
#   4. config.yml at %USERPROFILE%\.cloudflared\config.yml
#      (copy from deploy/cloudflared-config.example.yml and fill in
#       the tunnel UUID + credentials path printed by step 3)
#
# Run ONCE from elevated PowerShell:
#   .\deploy\nssm-install-cloudflared.ps1
#
# Uninstall later:
#   .\deploy\nssm-install-cloudflared.ps1 -Uninstall
# =====================================================================

[CmdletBinding()]
param(
    [string]$ServiceName     = "BVC24-Cloudflared",
    [string]$NssmPath        = "nssm",
    [string]$CloudflaredPath = "C:\Program Files\Cloudflare\cloudflared\cloudflared.exe",
    [string]$ConfigPath      = "$env:USERPROFILE\.cloudflared\config.yml",
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

# ---- Sanity checks ---------------------------------------------------

Write-Host ""
Write-Host "==> BVC24 Cloudflare Tunnel service installer" -ForegroundColor Cyan
Write-Host "    Service:    $ServiceName"
Write-Host "    cloudflared: $CloudflaredPath"
Write-Host "    config.yml: $ConfigPath"
Write-Host ""

if ($Uninstall) {
    Write-Host "==> Uninstalling $ServiceName..." -ForegroundColor Yellow
    Invoke-Nssm @("stop",   $ServiceName)
    Invoke-Nssm @("remove", $ServiceName, "confirm")
    Write-Host "==> Done." -ForegroundColor Green
    return
}

if (-not (Test-Path $CloudflaredPath)) {
    throw "cloudflared.exe not found at $CloudflaredPath. Install from https://github.com/cloudflare/cloudflared/releases or pass -CloudflaredPath."
}

if (-not (Test-Path $ConfigPath)) {
    throw @"
config.yml not found at $ConfigPath.

First-time setup:
  1. cd to the repo deploy/ folder
  2. Copy cloudflared-config.example.yml to $ConfigPath
  3. Replace <TUNNEL-UUID> and <PATH-TO-CREDENTIALS> with the values
     printed by 'cloudflared tunnel create bvc24-erp'.
  4. Re-run this script.
"@
}

# ---- Install / reinstall the service ---------------------------------

$existing = & $NssmPath status $ServiceName 2>$null
if ($existing) {
    Write-Host "==> Existing service detected. Removing and reinstalling..." -ForegroundColor Yellow
    Invoke-Nssm @("stop",   $ServiceName)
    Invoke-Nssm @("remove", $ServiceName, "confirm")
}

$LogDir = "C:\ProgramData\cloudflared"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

Write-Host "==> Installing service..." -ForegroundColor Yellow
Invoke-Nssm @("install", $ServiceName, $CloudflaredPath, "--config", "`"$ConfigPath`"", "tunnel", "run")
Invoke-Nssm @("set", $ServiceName, "DisplayName", "BVC24 — Cloudflare Tunnel")
Invoke-Nssm @("set", $ServiceName, "Description", "Routes erp.bvc24.com + api.bvc24.com to local services via Cloudflare named tunnel.")
Invoke-Nssm @("set", $ServiceName, "Start",       "SERVICE_AUTO_START")
Invoke-Nssm @("set", $ServiceName, "AppStdout",   (Join-Path $LogDir "cloudflared.out.log"))
Invoke-Nssm @("set", $ServiceName, "AppStderr",   (Join-Path $LogDir "cloudflared.err.log"))
Invoke-Nssm @("set", $ServiceName, "AppRotateFiles", "1")
Invoke-Nssm @("set", $ServiceName, "AppRotateBytes", "10485760")  # rotate at 10 MB
Invoke-Nssm @("set", $ServiceName, "AppExit", "Default", "Restart")
Invoke-Nssm @("set", $ServiceName, "AppRestartDelay", "5000")

Write-Host "==> Starting service..." -ForegroundColor Yellow
Invoke-Nssm @("start", $ServiceName)

Start-Sleep -Seconds 3

$status = & $NssmPath status $ServiceName
Write-Host ""
Write-Host "==> Status: $status" -ForegroundColor Green
Write-Host ""
Write-Host "Logs:   $LogDir\cloudflared.{out,err}.log"
Write-Host "Verify: open https://erp.bvc24.com from your phone (mobile data, not WiFi)"
Write-Host ""
