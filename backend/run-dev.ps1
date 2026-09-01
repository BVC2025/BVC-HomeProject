# =====================================================================
# run-dev.ps1
# ---------------------------------------------------------------------
# Starts the backend the same way every time, on the port the rest of
# the codebase (frontend api.js, deploy scripts, docs) already
# expects: 8000. Plain `uvicorn app.main:app --reload` defaults to
# uvicorn's own built-in port (8000) when --port isn't passed — this
# script exists so you don't have to remember the flag.
#
# Run from the backend directory:
#   .\run-dev.ps1
# =====================================================================

param(
    [int]$Port = 8000
)

$RepoRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $RepoRoot "venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Host "venv not found at $VenvPython — falling back to 'python' on PATH." -ForegroundColor Yellow
    $VenvPython = "python"
}

Write-Host "Starting backend on http://127.0.0.1:$Port (reload enabled)..." -ForegroundColor Cyan

& $VenvPython -m uvicorn app.main:app --reload --host 0.0.0.0 --port $Port
