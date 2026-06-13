# =====================================================================
# register_scheduled_tasks.ps1
# ---------------------------------------------------------------------
# One-time installer for the BVC24 backend cron jobs on Windows.
# Registers three Task Scheduler entries that invoke the scripts under
# backend/scripts/ via the venv's python.exe.
#
# Run ONCE on the production server, from an elevated PowerShell:
#
#     cd "d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend\scripts"
#     .\register_scheduled_tasks.ps1
#
# To uninstall every task this script creates:
#
#     .\register_scheduled_tasks.ps1 -Uninstall
#
# To preview what would change without writing anything:
#
#     .\register_scheduled_tasks.ps1 -DryRun
#
# Notes
# -----
# * Tasks run as SYSTEM by default so they survive console logout.
# * Each task uses the venv python so no PATH munging is needed.
# * If you move the backend folder later, re-run this script.
# =====================================================================

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$DryRun
)


# ---- Resolve paths from the script's own location -------------------
$ScriptsDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot  = Split-Path -Parent $ScriptsDir
$VenvPython   = Join-Path $BackendRoot "venv\Scripts\python.exe"
$LogDir       = Join-Path $BackendRoot "logs\cron"

if (-not (Test-Path $VenvPython)) {
    Write-Host "ERROR: cannot find $VenvPython" -ForegroundColor Red
    Write-Host "       Make sure backend/venv exists. Run 'python -m venv venv' first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $LogDir)) {
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    Write-Host "would create log dir: $LogDir" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "BVC24 ERP - Scheduled Tasks Installer"        -ForegroundColor Cyan
Write-Host "======================================="      -ForegroundColor Cyan
Write-Host "Backend root: $BackendRoot"
Write-Host "Python:       $VenvPython"
Write-Host "Log dir:      $LogDir"
Write-Host ""


# ---- Task catalogue --------------------------------------------------
# Name           | Script                       | Schedule
# ---------------+------------------------------+----------------------
# BVC24-MarkAbsent           | mark_absent.py                | Daily 23:55
# BVC24-ExpireOnboarding     | expire_onboarding_sessions.py | Hourly :05
# BVC24-PruneAuditLog        | prune_audit_log.py            | Weekly Sun 02:00

$Tasks = @(
    @{
        Name       = "BVC24-MarkAbsent"
        Script     = "mark_absent.py"
        Description = "End-of-day: mark active employees with no Attendance row as ABSENT."
        Trigger    = { New-ScheduledTaskTrigger -Daily -At "23:55" }
    },
    @{
        Name       = "BVC24-ExpireOnboarding"
        Script     = "expire_onboarding_sessions.py"
        Description = "Hourly: flip onboarding sessions past EXPIRES_AT from OPEN to EXPIRED."
        Trigger    = {
            # Hourly trigger via -Once + RepetitionInterval is the
            # Windows-blessed way to repeat sub-daily.
            $start = (Get-Date).Date.AddHours(((Get-Date).Hour + 1)).AddMinutes(5)
            New-ScheduledTaskTrigger -Once -At $start `
                -RepetitionInterval (New-TimeSpan -Hours 1) `
                -RepetitionDuration (New-TimeSpan -Days 3650)
        }
    },
    @{
        Name       = "BVC24-PruneAuditLog"
        Script     = "prune_audit_log.py"
        Description = "Weekly: drop audit_log rows older than 180 days."
        Trigger    = { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "02:00" }
    }
)


# ---- Uninstall path --------------------------------------------------
if ($Uninstall) {
    Write-Host "Uninstalling..." -ForegroundColor Yellow
    foreach ($t in $Tasks) {
        $existing = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
        if ($existing) {
            if ($DryRun) {
                Write-Host "  would remove $($t.Name)" -ForegroundColor Yellow
            } else {
                Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
                Write-Host "  removed $($t.Name)" -ForegroundColor Green
            }
        } else {
            Write-Host "  $($t.Name) (not present)" -ForegroundColor Gray
        }
    }
    Write-Host "Done." -ForegroundColor Cyan
    exit 0
}


# ---- Install / re-install --------------------------------------------
foreach ($t in $Tasks) {
    $scriptPath = Join-Path $ScriptsDir $t.Script
    if (-not (Test-Path $scriptPath)) {
        Write-Host "  SKIP $($t.Name): missing $scriptPath" -ForegroundColor Red
        continue
    }

    $logFile = Join-Path $LogDir ("$($t.Name).log")

    # We invoke the script via the venv python directly. Stdout/stderr
    # get appended to the per-task log so failures are diagnosable
    # after the fact.
    $arguments = "-m scripts.$($t.Script.Replace('.py',''))"
    $wrapper   = "& '$VenvPython' $arguments *>> '$logFile'"

    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$wrapper`"" `
        -WorkingDirectory $BackendRoot

    $trigger = & $t.Trigger

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest

    if ($DryRun) {
        Write-Host "  would register $($t.Name)" -ForegroundColor Yellow
        Write-Host "    script:   $scriptPath"
        Write-Host "    log:      $logFile"
        Write-Host "    desc:     $($t.Description)"
        continue
    }

    # Remove any pre-existing version first so re-runs upgrade cleanly.
    $existing = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
    }

    Register-ScheduledTask `
        -TaskName $t.Name `
        -Description $t.Description `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal | Out-Null

    Write-Host "  registered $($t.Name)" -ForegroundColor Green
    Write-Host "    log: $logFile" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Done. List the tasks anytime with:" -ForegroundColor Cyan
Write-Host '  Get-ScheduledTask -TaskName "BVC24-*" | Format-Table TaskName,State'
Write-Host ""
Write-Host "Run a task NOW for testing:" -ForegroundColor Cyan
Write-Host '  Start-ScheduledTask -TaskName "BVC24-MarkAbsent"'
Write-Host ""
Write-Host "View its last result:" -ForegroundColor Cyan
Write-Host '  Get-ScheduledTaskInfo -TaskName "BVC24-MarkAbsent"'
