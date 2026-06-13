# =====================================================================
# rollback.ps1
# ---------------------------------------------------------------------
# Emergency rollback: revert the repo to a previous commit and restart
# the backend service. Use when a deploy broke things and you need the
# previous version back FAST.
#
# Usage
#   # Roll back to the previous commit
#   .\rollback.ps1
#
#   # Roll back to a specific commit / tag
#   .\rollback.ps1 -To v1.2.3
#   .\rollback.ps1 -To abc1234
#
#   # Preview without writing
#   .\rollback.ps1 -DryRun
#
# What it does
#   1. git fetch
#   2. git reset --hard <target>   ← DESTRUCTIVE: discards uncommitted changes
#   3. Reinstall pinned Python deps (no-op if same versions)
#   4. Rebuild the frontend
#   5. Restart the backend Windows service
#   6. Run the smoke test
#
# Safety
#   - Refuses to run if there are uncommitted changes (unless -Force)
#   - Captures the current SHA in $env:TEMP\bvc24-rollback-<timestamp>.txt
#     so you can roll FORWARD again if rollback was a mistake.
# =====================================================================

[CmdletBinding()]
param(
    [string]$To           = "HEAD~1",
    [string]$ServiceName  = "BVC24-Backend",
    [switch]$Force,
    [switch]$DryRun
)


# ---- Resolve paths --------------------------------------------------
$DeployDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = Split-Path -Parent $DeployDir
$BackendRoot = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$VenvPython  = Join-Path $BackendRoot "venv\Scripts\python.exe"


Write-Host ""
Write-Host "BVC24 ERP - EMERGENCY ROLLBACK" -ForegroundColor Red
Write-Host "================================" -ForegroundColor Red
Write-Host "Repo:    $RepoRoot"
Write-Host "Target:  $To"
Write-Host "Service: $ServiceName"
Write-Host "DryRun:  $DryRun"
Write-Host ""


# ---- Check git is clean ---------------------------------------------
Push-Location $RepoRoot
try {
    $dirty = git status --porcelain
    if ($dirty -and -not $Force) {
        Write-Host "REFUSING — there are uncommitted changes:" -ForegroundColor Red
        Write-Host $dirty
        Write-Host ""
        Write-Host "Either commit/stash them, or re-run with -Force." -ForegroundColor Red
        exit 1
    }

    $currentSha = (git rev-parse HEAD).Trim()
    Write-Host "Currently at: $currentSha" -ForegroundColor Cyan

    # Save the current SHA so the operator can roll FORWARD if needed
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $marker = Join-Path $env:TEMP "bvc24-rollback-$stamp.txt"
    if (-not $DryRun) {
        "Rolled back FROM: $currentSha at $stamp`r`nTarget: $To" | Out-File $marker
        Write-Host "Saved current SHA to: $marker" -ForegroundColor Yellow
    }


    # ---- Fetch + reset ----------------------------------------------
    Write-Host ""
    Write-Host "Fetching latest refs..." -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host "  would: git fetch --all --tags" -ForegroundColor Yellow
        Write-Host "  would: git reset --hard $To" -ForegroundColor Yellow
    } else {
        git fetch --all --tags
        git reset --hard $To
        if ($LASTEXITCODE -ne 0) {
            Write-Host "git reset failed. Aborting." -ForegroundColor Red
            exit 1
        }
    }
    $targetSha = if ($DryRun) { "<dry-run>" } else { (git rev-parse HEAD).Trim() }
    Write-Host "Now at: $targetSha" -ForegroundColor Cyan


    # ---- Reinstall Python deps --------------------------------------
    Write-Host ""
    Write-Host "Reinstalling Python deps..." -ForegroundColor Cyan
    Push-Location $BackendRoot
    try {
        if ($DryRun) {
            Write-Host "  would: $VenvPython -m pip install -r requirements.txt" -ForegroundColor Yellow
        } else {
            & $VenvPython -m pip install -q -r requirements.txt
            if ($LASTEXITCODE -ne 0) {
                Write-Host "pip install failed. Service NOT restarted." -ForegroundColor Red
                exit 1
            }
        }
    } finally {
        Pop-Location
    }


    # ---- Rebuild frontend -------------------------------------------
    Write-Host ""
    Write-Host "Rebuilding frontend..." -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        if ($DryRun) {
            Write-Host "  would: npm ci" -ForegroundColor Yellow
            Write-Host "  would: npm run build" -ForegroundColor Yellow
        } else {
            npm ci --silent
            npm run build
            if ($LASTEXITCODE -ne 0) {
                Write-Host "frontend build failed. Service NOT restarted." -ForegroundColor Red
                exit 1
            }
        }
    } finally {
        Pop-Location
    }


    # ---- Restart backend service ------------------------------------
    Write-Host ""
    Write-Host "Restarting $ServiceName..." -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host "  would: Restart-Service $ServiceName" -ForegroundColor Yellow
    } else {
        Restart-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 4
        $svc = Get-Service -Name $ServiceName
        if ($svc.Status -ne "Running") {
            Write-Host "Service did not come back up. Check stderr.log!" -ForegroundColor Red
            exit 1
        }
    }


    # ---- Smoke test -------------------------------------------------
    Write-Host ""
    Write-Host "Running smoke test..." -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host "  would: $VenvPython -m scripts.smoke_test" -ForegroundColor Yellow
    } else {
        Push-Location $BackendRoot
        try {
            & $VenvPython -m scripts.smoke_test
            if ($LASTEXITCODE -ne 0) {
                Write-Host "" -ForegroundColor Red
                Write-Host "SMOKE TEST FAILED after rollback. State is uncertain." -ForegroundColor Red
                Write-Host "Original SHA was: $currentSha" -ForegroundColor Yellow
                Write-Host "Recovery marker: $marker" -ForegroundColor Yellow
                exit 1
            }
        } finally {
            Pop-Location
        }
    }


    Write-Host ""
    Write-Host "ROLLBACK COMPLETE" -ForegroundColor Green
    if (-not $DryRun) {
        Write-Host "  From: $currentSha" -ForegroundColor Gray
        Write-Host "  To:   $targetSha"   -ForegroundColor Gray
        Write-Host "  Marker (for rolling forward): $marker" -ForegroundColor Gray
    }
}
finally {
    Pop-Location
}
