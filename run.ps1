<#
  INSPECTA BUILDOS — one-command launcher (Windows PowerShell)

  Usage:
    ./run.ps1            # LOCAL mode: backend uses local Postgres (DATABASE_URL in backend/.env),
                         # runs generate -> db push -> seed -> API, plus the frontend dev server.
    ./run.ps1 -Docker    # DOCKER mode: `docker compose up` in backend/ (bundled Docker Postgres),
                         # plus the frontend dev server.
    ./run.ps1 -InstallOnly   # Just install dependencies and exit.

  Backend API : http://localhost:4000
  Frontend    : http://localhost:3000
#>
param(
  [switch]$Docker,
  [switch]$InstallOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Ensure-Env($dir) {
  $env = Join-Path $dir '.env'
  $example = Join-Path $dir '.env.example'
  if (-not (Test-Path $env) -and (Test-Path $example)) {
    Copy-Item $example $env
    Write-Host "  Created $dir\.env from .env.example" -ForegroundColor Yellow
  }
}

function Ensure-Deps($dir) {
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Write-Host "  Installing dependencies in $dir ..." -ForegroundColor Cyan
    Push-Location $dir
    npm install --no-audit --no-fund
    Pop-Location
  }
}

Write-Host "INSPECTA BUILDOS launcher" -ForegroundColor Green
Ensure-Env $backend
Ensure-Env $frontend
Ensure-Deps $backend
Ensure-Deps $frontend

if ($InstallOnly) {
  Write-Host "Dependencies installed. Exiting (InstallOnly)." -ForegroundColor Green
  return
}

if ($Docker) {
  Write-Host "Starting backend stack via Docker Compose (Docker Postgres) ..." -ForegroundColor Green
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$backend`"; docker compose up --build"
} else {
  Write-Host "Starting backend (LOCAL Postgres) ..." -ForegroundColor Green
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$backend`"; npm start"
}

Write-Host "Starting frontend dev server ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$frontend`"; npm run dev"

Write-Host ""
Write-Host "Backend : http://localhost:4000  (health: /api/health)" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Green
Write-Host "Login   : admin@inspecta.ai / Admin@12345" -ForegroundColor Green
