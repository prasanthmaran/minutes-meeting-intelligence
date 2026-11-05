#!/usr/bin/env bash
# Local development for Minutes: backend on 127.0.0.1:8000, Vite frontend on :5173.
#
# Commands (each prints numbered steps and stops at the first failure):
#   ./scripts/dev.sh start                  Install deps, prepare the database, start both.
#                                           Also use it after pulling changes.
#   ./scripts/dev.sh restart [backend]      Restart both (or only the backend) after edits.
#   ./scripts/dev.sh status                 Version, health and addresses.
#   ./scripts/dev.sh logs [backend|frontend]  Follow a log (Ctrl+C to exit).
#   ./scripts/dev.sh stop                   Stop both.
#
# Frontend edits reload in the browser automatically; backend edits need a restart.
# The database is DATABASE_URL from the project-root .env (SQLite file or Supabase),
# the same one production uses unless you point them at different databases.

set -euo pipefail
. "$(dirname "$0")/lib.sh"

STATE="$ROOT/.dev"
API_PORT=8000
WEB_PORT=5173
API_URL="http://127.0.0.1:$API_PORT"
WEB_URL="http://localhost:$WEB_PORT"
API_PID="$STATE/backend.pid"
WEB_PID="$STATE/frontend.pid"
API_LOG="$STATE/backend.log"
WEB_LOG="$STATE/frontend.log"

start_backend() {
  stop_pid "$API_PID" "previous backend"
  free_port "$API_PORT" "app.main:app"
  (
    cd "$ROOT/backend"
    nohup "$ROOT/backend/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$API_PORT" \
      >"$API_LOG" 2>&1 &
    echo $! >"$API_PID"
  )
  if ! wait_for "$API_URL/api/health" 60; then
    tail -30 "$API_LOG" >&2
    die "Backend did not start. Full log: $API_LOG"
  fi
  ok "Backend healthy on $API_URL: $(curl -s "$API_URL/api/health")"
}

start_frontend() {
  stop_pid "$WEB_PID" "previous frontend"
  free_port "$WEB_PORT" "vite"
  (
    cd "$ROOT/frontend"
    PATH="$NODE_BIN:$PATH" nohup "$ROOT/frontend/node_modules/.bin/vite" --host 127.0.0.1 \
      --port "$WEB_PORT" --strictPort >"$WEB_LOG" 2>&1 &
    echo $! >"$WEB_PID"
  )
  if ! wait_for "$WEB_URL/" 60; then
    tail -30 "$WEB_LOG" >&2
    die "Frontend did not start. Full log: $WEB_LOG"
  fi
  ok "Frontend running on $WEB_URL (proxies /api to $API_URL)"
}

cmd_start() {
  mkdir -p "$STATE"
  plan 5
  step "Checking tools and version"
  require_uv
  find_node
  ok "uv and Node $("$NODE_BIN/node" -v) found"
  show_version
  step "Installing dependencies"
  backend_sync "$STATE"
  frontend_install "$STATE"
  step "Preparing the database"
  backend_migrate "$STATE"
  step "Starting the backend"
  start_backend
  step "Starting the frontend"
  start_frontend
  printf '\n\033[1;32mDevelopment is running\033[0m\n'
  echo "  App:     $WEB_URL"
  echo "  API:     $API_URL"
  echo "  Logs:    ./scripts/dev.sh logs backend | frontend"
}

cmd_restart() {
  if [ "${1:-}" = "backend" ]; then
    mkdir -p "$STATE"
    plan 2
    step "Preparing the database"
    require_uv
    backend_migrate "$STATE"
    step "Restarting the backend"
    start_backend
    return
  fi
  cmd_start
}

cmd_status() {
  plan 3
  step "Version on disk"
  show_version
  step "Backend ($API_URL)"
  if curl -fsS "$API_URL/api/health" >/dev/null 2>&1; then
    ok "Healthy: $(curl -s "$API_URL/api/health")"
    running "$API_PID" || say "Note: not started by this script (pid $(port_pid "$API_PORT"))"
  else
    say "Not running"
  fi
  step "Frontend ($WEB_URL)"
  if curl -fsS "$WEB_URL/" >/dev/null 2>&1; then ok "Running"; else say "Not running"; fi
}

cmd_logs() {
  case "${1:-backend}" in
    backend) tail -n 50 -f "$API_LOG" ;;
    frontend) tail -n 50 -f "$WEB_LOG" ;;
    *) die "Choose a log: backend or frontend" ;;
  esac
}

cmd_stop() {
  plan 2
  step "Stopping the frontend"
  stop_pid "$WEB_PID" "frontend"
  step "Stopping the backend"
  stop_pid "$API_PID" "backend"
  local left
  left="$(port_pid "$API_PORT")"
  [ -z "$left" ] || say "Note: something else still listens on $API_PORT (pid $left)"
  printf '\n\033[1;32mStopped.\033[0m\n'
}

case "${1:-}" in
  start) cmd_start ;;
  restart) cmd_restart "${2:-}" ;;
  status) cmd_status ;;
  logs) cmd_logs "${2:-backend}" ;;
  stop) cmd_stop ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
