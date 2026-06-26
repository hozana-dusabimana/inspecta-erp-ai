#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
DOCKER=false
INSTALL_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --docker|-d)
      DOCKER=true
      ;;
    --install-only|-i)
      INSTALL_ONLY=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: ./run.sh [--docker|-d] [--install-only|-i]"
      exit 1
      ;;
  esac
done

ensure_env() {
  local dir="$1"
  if [[ ! -f "$dir/.env" && -f "$dir/.env.example" ]]; then
    cp "$dir/.env.example" "$dir/.env"
    echo "Created $dir/.env from .env.example"
  fi
}

ensure_deps() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    echo "Installing dependencies in $dir ..."
    npm install --prefix "$dir" --no-audit --no-fund
  fi
}

compose_cmd() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  elif docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    echo "Docker Compose is not installed. Install docker-compose or the Docker compose plugin."
    exit 1
  fi
}

echo "INSPECTA BUILDOS launcher"
ensure_env "$BACKEND"
ensure_env "$FRONTEND"
ensure_deps "$BACKEND"
ensure_deps "$FRONTEND"

if [[ "$INSTALL_ONLY" == true ]]; then
  echo "Dependencies installed. Exiting."
  exit 0
fi

if [[ "$DOCKER" == true ]]; then
  echo "Starting backend stack via Docker Compose..."
  (cd "$BACKEND" && compose_cmd up --build) &
else
  echo "Starting backend with local Postgres..."
  (cd "$BACKEND" && npm start) &
fi

echo "Starting frontend dev server..."
(cd "$FRONTEND" && npm run dev) &

echo
echo "Backend : http://localhost:4000  (health: /api/health)"
echo "Frontend: http://localhost:3000"
echo "Login   : admin@inspecta.ai / Admin@12345"
echo
echo "Press Ctrl+C to stop both servers."
wait
