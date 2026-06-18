# =====================================================================
# update-tunnel-urls.ps1
# ---------------------------------------------------------------------
# Pastes two fresh Cloudflare quick-tunnel URLs into the THREE files
# that pin them, so cloudflared rotations stop being a 5-minute chore.
#
# Quick-tunnel hostnames rotate every time `cloudflared tunnel --url ...`
# is restarted. Without keeping the three files below in sync, login
# fails, onboarding links break, and CORS rejects the new origin.
#
# Files touched:
#   1. backend/.env                          FRONTEND_BASE_URL
#   2. frontend/.env.local                   VITE_API_URL
#   3. frontend/src/services/api.js          LEGACY_QUICK_TUNNEL_BACKEND_URL
#
# Usage (from repo root):
#   .\deploy\update-tunnel-urls.ps1 `
#     -Frontend "https://poll-skill-won-conclusions.trycloudflare.com" `
#     -Backend  "https://lender-buried-serious-duration.trycloudflare.com"
#
# After running, you still need to:
#   • Restart Vite dev server     (Ctrl+C + `npm run dev`) — env-vars
#     are only read at boot
#   • Restart uvicorn              — same reason for backend .env
#
# The CORS allowlist already permits any *.trycloudflare.com host via
# regex (see backend/app/main.py _CORS_ORIGIN_REGEX), so no CORS edit
# is needed.
# =====================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Frontend,

    [Parameter(Mandatory = $true)]
    [string]$Backend
)

$ErrorActionPreference = "Stop"

# ---- Validate the inputs --------------------------------------------

function Assert-TunnelUrl {
    param([string]$Url, [string]$Label)
    if ($Url -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com/?$') {
        throw "$Label URL doesn't look right: $Url`nExpected: https://<random-words>.trycloudflare.com"
    }
}

Assert-TunnelUrl -Url $Frontend -Label "Frontend"
Assert-TunnelUrl -Url $Backend  -Label "Backend"

# Strip any trailing slash
$Frontend = $Frontend.TrimEnd('/')
$Backend  = $Backend.TrimEnd('/')

# ---- Resolve repo paths from this script's own location -------------

$DeployDir = $PSScriptRoot
$RepoRoot  = Split-Path -Parent $DeployDir

$envBackend  = Join-Path $RepoRoot "backend\.env"
$envFrontend = Join-Path $RepoRoot "frontend\.env.local"
$apiJs       = Join-Path $RepoRoot "frontend\src\services\api.js"

foreach ($f in @($envBackend, $envFrontend, $apiJs)) {
    if (-not (Test-Path $f)) {
        throw "Missing file: $f"
    }
}

Write-Host ""
Write-Host "=== Tunnel URL update ===" -ForegroundColor Cyan
Write-Host "  Frontend tunnel : $Frontend"
Write-Host "  Backend  tunnel : $Backend"
Write-Host ""

# ---- 1. backend/.env (FRONTEND_BASE_URL) ----------------------------

$content = Get-Content $envBackend -Raw

if ($content -notmatch '(?m)^FRONTEND_BASE_URL\s*=') {
    Write-Host "[skip] FRONTEND_BASE_URL not found in backend/.env — leaving file alone" -ForegroundColor Yellow
} else {
    $new = [regex]::Replace($content, '(?m)^FRONTEND_BASE_URL\s*=.*$', "FRONTEND_BASE_URL=$Frontend")
    Set-Content -Path $envBackend -Value $new -NoNewline
    Write-Host "[updated] backend/.env  -> FRONTEND_BASE_URL=$Frontend" -ForegroundColor Green
}

# ---- 2. frontend/.env.local (VITE_API_URL) --------------------------

$content = Get-Content $envFrontend -Raw

if ($content -notmatch '(?m)^VITE_API_URL\s*=') {
    Write-Host "[skip] VITE_API_URL not found in frontend/.env.local — leaving file alone" -ForegroundColor Yellow
} else {
    $new = [regex]::Replace($content, '(?m)^VITE_API_URL\s*=.*$', "VITE_API_URL=$Backend")
    Set-Content -Path $envFrontend -Value $new -NoNewline
    Write-Host "[updated] frontend/.env.local  -> VITE_API_URL=$Backend" -ForegroundColor Green
}

# ---- 3. api.js (LEGACY_QUICK_TUNNEL_BACKEND_URL) --------------------

$content = Get-Content $apiJs -Raw

if ($content -notmatch 'LEGACY_QUICK_TUNNEL_BACKEND_URL\s*=') {
    Write-Host "[skip] LEGACY_QUICK_TUNNEL_BACKEND_URL not found in api.js — leaving file alone" -ForegroundColor Yellow
} else {
    # Match the constant declaration and replace just the URL string
    $pattern = '(LEGACY_QUICK_TUNNEL_BACKEND_URL\s*=\s*)"[^"]+"'
    $replace = "`$1`"$Backend`""
    $new = [regex]::Replace($content, $pattern, $replace)
    Set-Content -Path $apiJs -Value $new -NoNewline
    Write-Host "[updated] api.js  -> LEGACY_QUICK_TUNNEL_BACKEND_URL = $Backend" -ForegroundColor Green
}

Write-Host ""
Write-Host "All 3 files updated." -ForegroundColor Green
Write-Host ""
Write-Host "Now restart both dev servers so the new env values load:" -ForegroundColor Cyan
Write-Host "  Backend  : Ctrl+C the uvicorn window, then" -ForegroundColor Gray
Write-Host '             .\venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001' -ForegroundColor Gray
Write-Host ""
Write-Host "  Frontend : Ctrl+C the Vite window, then" -ForegroundColor Gray
Write-Host '             npm run dev' -ForegroundColor Gray
Write-Host ""
