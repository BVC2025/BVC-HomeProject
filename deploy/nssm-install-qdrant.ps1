# =====================================================================
# nssm-install-qdrant.ps1
# ---------------------------------------------------------------------
# Registers the Qdrant vector database as a Windows service via NSSM,
# the same way deploy/nssm-install-backend.ps1 registers uvicorn. This
# repo has no Docker/docker-compose, so Qdrant runs as a plain local
# Windows service instead of a container.
#
# Prerequisites:
#   1. NSSM 2.24+ installed (see nssm-install-backend.ps1 for details)
#   2. Qdrant Windows binary downloaded and extracted somewhere on disk
#      Download: https://github.com/qdrant/qdrant/releases
#      (grab the `qdrant-x86_64-pc-windows-msvc.zip` asset, extract
#      qdrant.exe to e.g. C:\qdrant\qdrant.exe)
#
# Run ONCE from elevated PowerShell:
#   .\nssm-install-qdrant.ps1 -QdrantExePath C:\qdrant\qdrant.exe
#
# To uninstall the service later:
#   .\nssm-install-qdrant.ps1 -Uninstall
#
# To preview (no changes):
#   .\nssm-install-qdrant.ps1 -QdrantExePath C:\qdrant\qdrant.exe -DryRun
# =====================================================================

[CmdletBinding()]
param(
    [string]$ServiceName   = "BVC24-Qdrant",
    [string]$NssmPath      = "nssm",              # assumes on PATH; override if needed
    [string]$QdrantExePath = "",                  # required unless -Uninstall
    [string]$BindHost      = "127.0.0.1",         # local-only by default — no external exposure
    [int]   $HttpPort      = 6333,
    [int]   $GrpcPort      = 6334,
    [switch]$Uninstall,
    [switch]$DryRun
)


# ---- Resolve paths from this script's own location ------------------
$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $DeployDir
$DataDir   = Join-Path $RepoRoot "backend\qdrant-storage"
$LogDir    = Join-Path $RepoRoot "backend\logs\service"

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


# ---- Uninstall path ---------------------------------------------------
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


# ---- Validate QdrantExePath ------------------------------------------
if (-not $QdrantExePath -or -not (Test-Path $QdrantExePath)) {
    Write-Host "ERROR: -QdrantExePath not found: '$QdrantExePath'" -ForegroundColor Red
    Write-Host "       Download the Windows binary from:" -ForegroundColor Red
    Write-Host "       https://github.com/qdrant/qdrant/releases" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "BVC24 ERP - Qdrant Service Installer" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Service name:  $ServiceName"
Write-Host "NSSM:          $NssmExePath"
Write-Host "Qdrant exe:    $QdrantExePath"
Write-Host "Bind:          $BindHost`:$HttpPort (HTTP) / $BindHost`:$GrpcPort (gRPC)"
Write-Host "Data dir:      $DataDir"
Write-Host "Log dir:       $LogDir"
Write-Host ""


# ---- Ensure data/log dirs exist ---------------------------------------
foreach ($dir in @($DataDir, $LogDir)) {
    if (-not (Test-Path $dir)) {
        if (-not $DryRun) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        Write-Host "would create $dir" -ForegroundColor Yellow
    }
}


# ---- If service already exists, stop + remove so we can recreate ------
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


# ---- Install ------------------------------------------------------------
if ($DryRun) {
    Write-Host "would run:" -ForegroundColor Yellow
    Write-Host "  $NssmExePath install $ServiceName `"$QdrantExePath`""
    Write-Host "  $NssmExePath set $ServiceName AppDirectory `"$DataDir`""
    Write-Host "  $NssmExePath set $ServiceName AppEnvironmentExtra QDRANT__SERVICE__HOST=$BindHost QDRANT__SERVICE__HTTP_PORT=$HttpPort QDRANT__SERVICE__GRPC_PORT=$GrpcPort QDRANT__STORAGE__STORAGE_PATH=$DataDir"
    Write-Host "  $NssmExePath set $ServiceName Start SERVICE_AUTO_START"
    exit 0
}

& $NssmExePath install $ServiceName $QdrantExePath
& $NssmExePath set $ServiceName AppDirectory        $DataDir
& $NssmExePath set $ServiceName AppEnvironmentExtra "QDRANT__SERVICE__HOST=$BindHost`nQDRANT__SERVICE__HTTP_PORT=$HttpPort`nQDRANT__SERVICE__GRPC_PORT=$GrpcPort`nQDRANT__STORAGE__STORAGE_PATH=$DataDir"
& $NssmExePath set $ServiceName AppStdout           (Join-Path $LogDir "qdrant-stdout.log")
& $NssmExePath set $ServiceName AppStderr           (Join-Path $LogDir "qdrant-stderr.log")
& $NssmExePath set $ServiceName AppRotateFiles      1
& $NssmExePath set $ServiceName AppRotateBytes      52428800   # 50 MB
& $NssmExePath set $ServiceName AppRotateOnline     1
& $NssmExePath set $ServiceName Start               SERVICE_AUTO_START
& $NssmExePath set $ServiceName AppRestartDelay     5000        # 5s wait before restart
& $NssmExePath set $ServiceName Description         "BVC24 ERP — Qdrant vector database (RAG AI Platform)"

# Start the service
& $NssmExePath start $ServiceName

# Brief health check
Start-Sleep -Seconds 3
$svcAfter = Get-Service -Name $ServiceName
Write-Host ""
Write-Host "Service status: $($svcAfter.Status)" -ForegroundColor Cyan
if ($svcAfter.Status -ne "Running") {
    Write-Host "Service is NOT running. Check $LogDir\qdrant-stderr.log" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Installed. Verify with:" -ForegroundColor Cyan
Write-Host "  Invoke-RestMethod http://$BindHost`:$HttpPort/collections"
Write-Host "Manage it like:" -ForegroundColor Cyan
Write-Host "  Get-Service $ServiceName"
Write-Host "  Restart-Service $ServiceName"
Write-Host "  Stop-Service $ServiceName"
Write-Host "  Get-Content `"$LogDir\qdrant-stderr.log`" -Tail 50"
