#!/usr/bin/env bash
# Start Hackstreet PesaMatters locally: free required ports, bring up Postgres +
# API + Vite (member / admin), wait until ready, list every URL, open the
# member app in the browser.
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

# True if anything is accepting TCP on the host port.
# Prefer this over PID checks: Docker publishes often show LISTEN with no pid=
# (ss -p needs privileges / docker-proxy is not always visible).
port_is_listening() {
  local port="$1"
  ss -H -ltn "sport = :${port}" 2>/dev/null | grep -q .
}

# PIDs listening on TCP port (Linux ss). Empty if free, Docker-only, or unreadable.
pids_on_port() {
  local port="$1"
  ss -H -lptn "sport = :${port}" 2>/dev/null \
    | grep -oE 'pid=[0-9]+' \
    | cut -d= -f2 \
    | sort -u \
    || true
}

# Running Docker containers that currently publish the host port.
# Exited containers may still *declare* a publish mapping; they do not hold the bind.
docker_ids_on_port() {
  local port="$1"
  docker ps -q --filter "publish=${port}" 2>/dev/null || true
}

docker_names_on_port() {
  local port="$1"
  docker ps --filter "publish=${port}" --format '{{.Names}}' 2>/dev/null || true
}

# Stop whatever is bound to the given TCP port (host PIDs and Docker publishes).
# Idempotent. Required so a foreign compose DB on 5433 cannot fake "free" via ss -p.
free_port() {
  local port="$1"
  local label="$2"
  local pids docker_ids docker_names

  docker_ids="$(docker_ids_on_port "$port")"
  pids="$(pids_on_port "$port")"

  if ! port_is_listening "$port" && [[ -z "$docker_ids" ]] && [[ -z "$pids" ]]; then
    log "Port ${port} (${label}) is free."
    return 0
  fi

  if [[ -n "$docker_ids" ]]; then
    docker_names="$(docker_names_on_port "$port" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    log "Port ${port} (${label}) held by Docker (${docker_names:-containers}) — stopping."
    # Intentional word-split: ids are whitespace-separated hex we produced.
    # shellcheck disable=SC2086
    docker stop $docker_ids >/dev/null 2>&1 || true
    sleep 0.4
  fi

  pids="$(pids_on_port "$port")"
  if [[ -n "$pids" ]]; then
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
  fi

  if port_is_listening "$port"; then
    pids="$(pids_on_port "$port")"
    docker_names="$(docker_names_on_port "$port" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    die "Could not free port ${port} (${label}); still listening${pids:+ (PIDs: ${pids})}${docker_names:+ (Docker: ${docker_names})}"
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

# Print every local service once the stack is ready.
list_servers() {
  local origin="$1"
  local api_port="$2"
  local postgres_port="$3"
  log ""
  log "Servers"
  log "-------"
  log "  Postgres   docker compose db   localhost:${postgres_port}"
  log "  API        Express             http://127.0.0.1:${api_port}/api/health"
  log "  Member     Vite SPA            ${origin}/"
  log "  Admin      Vite SPA            ${origin}/admin"
  log ""
}

db_container_running() {
  docker compose ps --status running --services 2>/dev/null | grep -qx db
}

# Host can refuse 5433 while compose still reports "running (healthy)" if the
# published port never bound (NetworkSettings.Ports={}). Trust the host port.
wait_for_port() {
  local port="$1"
  local label="$2"
  local attempts="${3:-60}"
  local i=0
  log "Waiting for ${label} on 127.0.0.1:${port} ..."
  while (( i < attempts )); do
    if port_is_listening "$port"; then
      # Confirm accept, not only LISTEN visibility.
      if (echo >/dev/tcp/127.0.0.1/"${port}") >/dev/null 2>&1; then
        log "${label} accepts connections on port ${port}."
        return 0
      fi
    fi
    sleep 0.5
    i=$((i + 1))
  done
  die "Timed out waiting for ${label} on 127.0.0.1:${port}"
}

ensure_postgres() {
  local port="$1"

  if db_container_running && port_is_listening "$port"; then
    log "Postgres container already running on port ${port}."
  else
    if db_container_running; then
      log "Postgres container is up but host port ${port} is not published — recreating."
    fi
    free_port "$port" "Postgres"
    # Stop our compose db too when it is running without a host publish
    # (it will not appear in docker's publish= filter).
    if db_container_running; then
      docker compose stop db >/dev/null 2>&1 || true
    fi
    log "Starting Postgres..."
    docker compose up -d --force-recreate --wait
  fi

  wait_for_port "$port" "Postgres" 90
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
  postgres_port="$(env_value POSTGRES_PORT 5433 .env)"
  app_origin="$(env_value APP_ORIGIN http://127.0.0.1:5173 .env)"
  client_port=5173

  log "Freeing app ports..."
  free_port "$client_port" "Vite"
  free_port "$api_port" "API"

  ensure_postgres "$postgres_port"

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
  wait_for_url "${app_origin}/login" "Member (Vite)" 120
  wait_for_url "${app_origin}/admin/login" "Admin (Vite)" 60

  list_servers "$app_origin" "$api_port" "$postgres_port"
  open_browser "${app_origin}/"

  log "Stack is up. Press Ctrl+C to stop."
  wait -n "$server_pid" "$client_pid"
  exit $?
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
