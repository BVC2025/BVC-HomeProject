# =====================================================================
# build-frontend.ps1  —  Produce a production build of the React app.
# ---------------------------------------------------------------------
# Output:
#   frontend/dist/   — static files ready to be served by `vite preview`
#
# Run from the repo root, in PowerShell:
#   .\deploy\build-frontend.ps1
#
# The output is what cloudflared serves at https://erp.bvc24.com via
# `vite preview --port 4173`. The build is idempotent — safe to re-run
# after every code change.
# =====================================================================

param(
    [switch]$SkipInstall  # pass to skip `npm install` (e.g. CI cache)
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repoRoot "frontend"

Write-Host ""
Write-Host "==> BVC24 ERP — production frontend build" -ForegroundColor Cyan
Write-Host "    Repo:     $repoRoot"
Write-Host "    Frontend: $frontend"
Write-Host ""

if (-not (Test-Path $frontend)) {
    throw "Frontend directory not found at $frontend"
}

Push-Location $frontend
try {

    if (-not $SkipInstall) {
        Write-Host "==> npm install (this may take a minute)..." -ForegroundColor Yellow
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }

    Write-Host "==> npm run build..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

    $distSize = (Get-ChildItem -Recurse "dist" | Measure-Object -Property Length -Sum).Sum
    $distMB   = [math]::Round($distSize / 1MB, 1)

    Write-Host ""
    Write-Host "==> Build complete." -ForegroundColor Green
    Write-Host "    Output: $frontend\dist  ($distMB MB)"
    Write-Host ""
    Write-Host "Next step:" -ForegroundColor Cyan
    Write-Host "    Serve the build:"
    Write-Host "      cd frontend"
    Write-Host "      npm run preview -- --host 127.0.0.1 --port 4173"
    Write-Host ""
    Write-Host "    Or install as a Windows service:"
    Write-Host "      .\deploy\install-services.ps1"
    Write-Host ""

} finally {
    Pop-Location
}
