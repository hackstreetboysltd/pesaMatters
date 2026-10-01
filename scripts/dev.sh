#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  docker compose up -d
fi

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then kill "$server_pid" 2>/dev/null || true; fi
  if [[ -n "${client_pid:-}" ]]; then kill "$client_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

npm run dev -w hackstreet-server &
server_pid=$!
npm run dev -w hackstreet-client &
client_pid=$!
wait -n "$server_pid" "$client_pid"
