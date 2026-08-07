# =====================================================================
# fix-mysql-password.ps1
#
# One-shot helper to verify a MySQL root password and update backend/.env
# with the correct URL-encoded connection string. Run from
# d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend
#
# Usage:
#   .\fix-mysql-password.ps1
# =====================================================================

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Host "Cannot find .env at $envPath" -ForegroundColor Red
    exit 1
}

$mysqlExe = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
if (-not (Test-Path $mysqlExe)) {
    $mysqlExe = (Get-Command mysql -ErrorAction SilentlyContinue)?.Source
}
if (-not $mysqlExe) {
    Write-Host "Cannot find mysql.exe" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Enter the MySQL root password (input is hidden):" -ForegroundColor Cyan
$secure = Read-Host -AsSecureString
$bstr  = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrEmpty($plain)) {
    Write-Host "No password entered. Aborting." -ForegroundColor Red
    exit 1
}

# Step 1 — test against MySQL directly
Write-Host ""
Write-Host "Testing password against MySQL..." -ForegroundColor Cyan
$env:MYSQL_PWD = $plain
$test = & $mysqlExe -u root -h 127.0.0.1 -P 3306 -e "SELECT VERSION()" 2>&1
$rc   = $LASTEXITCODE
$env:MYSQL_PWD = $null

if ($rc -ne 0) {
    Write-Host ""
    Write-Host "MYSQL REJECTED THIS PASSWORD." -ForegroundColor Red
    Write-Host "  $test" -ForegroundColor Red
    Write-Host ""
    Write-Host "Your remembered password is not what MySQL has stored." -ForegroundColor Yellow
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "  - Try again with a different password"
    Write-Host "  - Reset the root password (see Option C from earlier)"
    Write-Host "  - Open MySQL Workbench - it may have the password cached"
    exit 1
}

Write-Host "OK - password is accepted by MySQL." -ForegroundColor Green
Write-Host "  $($test -join ' ')" -ForegroundColor Green

# Step 2 — verify the vending_erp database exists
Write-Host ""
Write-Host "Verifying the vending_erp database exists..." -ForegroundColor Cyan
$env:MYSQL_PWD = $plain
$dbCheck = & $mysqlExe -u root -h 127.0.0.1 -P 3306 -N -B -e "SHOW DATABASES LIKE 'vending_erp'" 2>&1
$env:MYSQL_PWD = $null

if ([string]::IsNullOrWhiteSpace($dbCheck)) {
    Write-Host "  Database 'vending_erp' does NOT exist. Creating it now..." -ForegroundColor Yellow
    $env:MYSQL_PWD = $plain
    & $mysqlExe -u root -h 127.0.0.1 -P 3306 -e "CREATE DATABASE vending_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    $env:MYSQL_PWD = $null
    Write-Host "  Created." -ForegroundColor Green
} else {
    Write-Host "  Database 'vending_erp' exists." -ForegroundColor Green
}

# Step 3 — URL-encode and rewrite .env
$encoded = [System.Web.HttpUtility]::UrlEncode($plain)
$newLine = "MY_SQL=mysql+pymysql://root:$encoded@localhost:3306"

Write-Host ""
Write-Host "Updating .env ..." -ForegroundColor Cyan
$content = Get-Content $envPath
$replaced = $false
$newContent = $content | ForEach-Object {
    if ($_ -match '^\s*MY_SQL\s*=') {
        $replaced = $true
        $newLine
    } else { $_ }
}
if (-not $replaced) {
    $newContent = @($newLine) + $newContent
}
$newContent | Set-Content $envPath -Encoding UTF8 -NoNewline:$false
Write-Host "  .env updated." -ForegroundColor Green

# Step 4 — final SQLAlchemy connection test (the exact path the app uses)
Write-Host ""
Write-Host "Final test - connecting via SQLAlchemy / pymysql..." -ForegroundColor Cyan
$pyTest = & ".\venv\Scripts\python.exe" -c @"
from dotenv import load_dotenv
load_dotenv()
import os
from sqlalchemy import create_engine, text
url = f"{os.getenv('MY_SQL')}/{os.getenv('DB_NAME')}"
e = create_engine(url)
c = e.connect()
v = c.execute(text('SELECT VERSION()')).scalar()
c.close()
print(f'OK - MySQL {v}')
"@ 2>&1
Write-Host $pyTest

# Wipe the plaintext password from memory
$plain = $null
[System.GC]::Collect()

Write-Host ""
Write-Host "Done. Start uvicorn now:" -ForegroundColor Cyan
Write-Host "  .\venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8001" -ForegroundColor White
