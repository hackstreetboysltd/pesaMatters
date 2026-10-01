#!/usr/bin/env bash
# Start Hackstreet PesaMatters locally: free required ports, bring up Postgres +
# API + Vite, wait until ready, open the app in the browser.
#
# Dependencies: bash, docker, npm, curl, ss (iproute2), xdg-open (or open / sensible-browser)
set -euo pipefail

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*" >&2
}

# Read KEY=value from .env without sourcing (avoids executing .env contents).
env_value() {
  local key="$1"
  local default="$2"
  local file="$3"
  local line=""
  if [[ -f "$file" ]]; then
    line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      printf '%s\n' "${line#*=}"
      return 0
    fi
  fi
  printf '%s\n' "$default"
}

# PIDs listening on TCP port (Linux ss). Empty if free or unreadable.
pids_on_port() {
  local port="$1"
  ss -H -lptn "sport = :${port}" 2>/dev/null \
    | grep -oE 'pid=[0-9]+' \
    | cut -d= -f2 \
    | sort -u \
    || true
}

# Stop whatever is bound to the given TCP port. Idempotent.
free_port() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(pids_on_port "$port")"
  if [[ -z "$pids" ]]; then
    log "Port ${port} (${label}) is free."
    return 0
  fi
  log "Port ${port} (${label}) in use by PID(s): ${pids} — stopping."
  # Intentional word-split: pids is a newline/space-separated list of integers we produced.
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 0.4
  pids="$(pids_on_port "$port")"
  if [[ -n "$pids" ]]; then
    log "Port ${port} still held by PID(s): ${pids} — force killing."
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 0.2
  fi
  pids="$(pids_on_port "$port")"
  if [[ -n "$pids" ]]; then
    die "Could not free port ${port} (${label}); still held by PID(s): ${pids}"
  fi
  log "Port ${port} (${label}) is free."
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-90}"
  local i=0
  log "Waiting for ${label} at ${url} ..."
  while (( i < attempts )); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      log "${label} is ready."
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  die "Timed out waiting for ${label} at ${url}"
}

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$url" >/dev/null 2>&1 || true
  else
    log "No browser launcher found. Open ${url} yourself."
    return 0
  fi
  log "Opened ${url} in the browser."
}

db_container_running() {
  docker compose ps --status running --services 2>/dev/null | grep -qx db
}

main() {
  local root api_port postgres_port client_port app_origin
  local server_pid="" client_pid=""

  root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$root"

  command -v docker >/dev/null 2>&1 || die "docker is required"
  command -v npm >/dev/null 2>&1 || die "npm is required"
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v ss >/dev/null 2>&1 || die "ss (iproute2) is required"

  [[ -f .env ]] || die "Missing .env — copy .env.example to .env and set the passwords first."
  [[ -d node_modules ]] || die "Missing node_modules — run: npm install"

  api_port="$(env_value PORT 8787 .env)"
  postgres_port="$(env_value POSTGRES_PORT 5432 .env)"
  app_origin="$(env_value APP_ORIGIN http://127.0.0.1:5173 .env)"
  client_port=5173

  log "Freeing app ports..."
  free_port "$client_port" "Vite"
  free_port "$api_port" "API"

  if db_container_running; then
    log "Postgres container already running on port ${postgres_port}."
  else
    free_port "$postgres_port" "Postgres"
    log "Starting Postgres..."
    docker compose up -d --wait
  fi

  log "Applying schema and seed (idempotent)..."
  npm run db:migrate
  npm run db:seed

  trap '
    if [[ -n "${server_pid:-}" ]] && kill -0 "$server_pid" 2>/dev/null; then
      kill "$server_pid" 2>/dev/null || true
    fi
    if [[ -n "${client_pid:-}" ]] && kill -0 "$client_pid" 2>/dev/null; then
      kill "$client_pid" 2>/dev/null || true
    fi
  ' EXIT

  log "Starting API..."
  npm run dev -w hackstreet-server &
  server_pid=$!

  log "Starting Vite..."
  npm run dev -w hackstreet-client &
  client_pid=$!

  wait_for_url "http://127.0.0.1:${api_port}/api/health" "API" 120
  wait_for_url "${app_origin}/" "Vite" 120

  open_browser "${app_origin}/"

  log "Stack is up. Press Ctrl+C to stop."
  wait -n "$server_pid" "$client_pid"
  exit $?
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
