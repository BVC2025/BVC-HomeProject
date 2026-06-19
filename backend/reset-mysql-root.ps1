# =====================================================================
# reset-mysql-root.ps1
#
# Resets the MySQL 8.0 root@localhost password to 'admin123'.
# REQUIRES: Administrator PowerShell.
#
# How to run:
#   1. Press Win, type "PowerShell", right-click "Run as administrator"
#   2. cd "d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend"
#   3. powershell -ExecutionPolicy Bypass -File .\reset-mysql-root.ps1
#
# What it does:
#   - Stops the MySQL80 Windows service
#   - Writes a one-line init SQL: ALTER USER ... IDENTIFIED BY 'admin123'
#   - Starts mysqld manually with --init-file pointing at that script
#   - Waits a few seconds so MySQL processes the init
#   - Kills the manual mysqld
#   - Restarts the MySQL80 service normally
#   - Verifies 'admin123' now works
#   - Deletes the init file (it had a plaintext password)
# =====================================================================

$ErrorActionPreference = "Stop"

# Confirm we're running as admin
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "This script must be run from an Administrator PowerShell." -ForegroundColor Red
    Write-Host "Close this window, right-click PowerShell -> Run as administrator, then re-run." -ForegroundColor Red
    exit 1
}

$mysqld   = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe"
$mysql    = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$initFile = "C:\mysql-reset-admin123.sql"
$newPwd   = "admin123"
$service  = "MySQL80"

if (-not (Test-Path $mysqld)) { Write-Host "mysqld not found at $mysqld" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $mysql))  { Write-Host "mysql not found at $mysql"   -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "== Step 1: stopping $service ==" -ForegroundColor Cyan
try {
    Stop-Service -Name $service -Force -ErrorAction Stop
    Write-Host "  Stopped." -ForegroundColor Green
} catch {
    Write-Host "  Could not stop: $_" -ForegroundColor Red
    exit 1
}

# Kill any leftover mysqld processes (otherwise the manual start below will conflict)
Get-Process mysqld -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "== Step 2: writing init file ==" -ForegroundColor Cyan
@"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$newPwd';
FLUSH PRIVILEGES;
"@ | Set-Content -Path $initFile -Encoding ASCII
Write-Host "  $initFile" -ForegroundColor Green

Write-Host ""
Write-Host "== Step 3: starting mysqld with --init-file (5 second wait) ==" -ForegroundColor Cyan
$proc = Start-Process -FilePath $mysqld `
                      -ArgumentList "--init-file=$initFile","--console" `
                      -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 5

if (-not $proc.HasExited) {
    Write-Host "  mysqld is running (PID $($proc.Id)). Killing it now that init has been processed." -ForegroundColor Green
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Seconds 2
} else {
    Write-Host "  mysqld already exited (exit code $($proc.ExitCode)). Init may have failed." -ForegroundColor Yellow
}

# Make sure no stray mysqld is left holding port 3306
Get-Process mysqld -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "== Step 4: starting $service service normally ==" -ForegroundColor Cyan
Start-Service -Name $service
Start-Sleep -Seconds 3
$svc = Get-Service -Name $service
if ($svc.Status -ne "Running") {
    Write-Host "  Service failed to start. Status: $($svc.Status)" -ForegroundColor Red
    exit 1
}
Write-Host "  Running." -ForegroundColor Green

Write-Host ""
Write-Host "== Step 5: verifying admin123 now works ==" -ForegroundColor Cyan
$env:MYSQL_PWD = $newPwd
$test = & $mysql -u root -h 127.0.0.1 -P 3306 -N -B -e "SELECT VERSION()" 2>&1
$rc = $LASTEXITCODE
$env:MYSQL_PWD = $null

if ($rc -eq 0) {
    Write-Host "  SUCCESS - 'admin123' is now the MySQL root password. MySQL $test" -ForegroundColor Green
} else {
    Write-Host "  Still failing: $test" -ForegroundColor Red
    Write-Host "  Reset did not take effect. Check MySQL error log at:" -ForegroundColor Yellow
    Write-Host "  C:\ProgramData\MySQL\MySQL Server 8.0\Data\<hostname>.err" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "== Step 6: cleaning up init file (contained the password) ==" -ForegroundColor Cyan
Remove-Item -Path $initFile -Force -ErrorAction SilentlyContinue
Write-Host "  Deleted $initFile" -ForegroundColor Green

Write-Host ""
Write-Host "Done. The .env already points at admin123, so you can now start uvicorn:" -ForegroundColor Cyan
Write-Host "  cd `"d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend`"" -ForegroundColor White
Write-Host "  .\venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8001" -ForegroundColor White
