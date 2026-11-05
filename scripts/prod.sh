#!/usr/bin/env bash
# Production (POC) for Minutes: this Mac + a free Cloudflare Quick Tunnel.
# No Docker, domain or Cloudflare account needed.
#
# One backend process on 127.0.0.1:8787 serves the built UI and /api, behind
# HTTP Basic auth. cloudflared publishes it at https://<random>.trycloudflare.com.
#
# Commands (each prints numbered steps and stops at the first failure):
#   ./scripts/prod.sh start              First launch: build, start app + tunnel. NEW URL.
#   ./scripts/prod.sh deploy             Ship code changes: build, migrate, restart app.
#                                        Keeps the tunnel, so the URL STAYS THE SAME.
#   ./scripts/prod.sh deploy frontend    UI-only changes: rebuild; no restart, same URL.
#   ./scripts/prod.sh status             Version, URL, health and login.
#   ./scripts/prod.sh logs [app|tunnel]  Follow a log (Ctrl+C to exit).
#   ./scripts/prod.sh stop               Stop app and tunnel. Data is kept.
#
# Optional: APP_USER / APP_PASSWORD (default reviewer / random, kept across restarts).
# Keys and DATABASE_URL come from the ignored project-root .env. Put AI_MODE and
# ANTHROPIC_API_KEY there: keys entered in Settings are lost on every restart.

set -euo pipefail
. "$(dirname "$0")/lib.sh"

STATE="$ROOT/.cloudflare"
PORT=8787
LOCAL_URL="http://127.0.0.1:$PORT"
TUNNEL_PID="$STATE/cloudflared.pid"
APP_PID="$STATE/app.pid"
TUNNEL_LOG="$STATE/cloudflared.log"
APP_LOG="$STATE/app.log"
URL_FILE="$STATE/url"
LOGIN_FILE="$STATE/login"

login_user() { sed -n 1p "$LOGIN_FILE"; }
login_password() { sed -n 2p "$LOGIN_FILE"; }
auth() { echo "$(login_user):$(login_password)"; }
public_url() { cat "$URL_FILE"; }

check_tools() {
  require_uv
  command -v openssl >/dev/null || die "openssl is required to create the password."
  find_node
  ok "uv, openssl and Node $("$NODE_BIN/node" -v) found"
  if ! command -v cloudflared >/dev/null; then
    command -v brew >/dev/null || die "Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    say "Installing cloudflared with Homebrew…"
    brew install cloudflared >"$STATE/brew.log" 2>&1 || die "brew install cloudflared failed. Log: $STATE/brew.log"
  fi
  ok "cloudflared $(cloudflared --version 2>&1 | awk '{print $3}')"
}

write_login() {
  local user="${APP_USER:-reviewer}" password="${APP_PASSWORD:-}"
  [ -z "$password" ] && [ -f "$LOGIN_FILE" ] && password="$(login_password)"
  [ -n "$password" ] || password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  printf '%s\n%s\n' "$user" "$password" >"$LOGIN_FILE"
  chmod 600 "$LOGIN_FILE"
  ok "Login ready for user '$user'"
}

start_tunnel() {
  stop_pid "$TUNNEL_PID" "previous tunnel"
  rm -f "$URL_FILE"
  nohup cloudflared tunnel --no-autoupdate --url "$LOCAL_URL" >"$TUNNEL_LOG" 2>&1 &
  echo $! >"$TUNNEL_PID"
  local i url=""
  for i in $(seq 1 45); do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
    [ -n "$url" ] && grep -q "Registered tunnel connection" "$TUNNEL_LOG" && break
    running "$TUNNEL_PID" || break
    sleep 1
  done
  if [ -z "$url" ] || ! running "$TUNNEL_PID"; then
    tail -20 "$TUNNEL_LOG" >&2
    die "cloudflared did not open a tunnel. Full log: $TUNNEL_LOG"
  fi
  echo "$url" >"$URL_FILE"
  ok "Tunnel open: $url"
}

restart_app() {
  stop_pid "$APP_PID" "previous app process"
  free_port "$PORT" "app.main:app"
  (
    cd "$ROOT/backend"
    # Environment overrides .env. The public URL must be an allowed origin because
    # settings and voice requests check the browser Origin header.
    CORS_ORIGINS="[\"$(public_url)\",\"$LOCAL_URL\"]" \
      APP_USER="$(login_user)" \
      APP_PASSWORD="$(login_password)" \
      FRONTEND_DIST="$ROOT/frontend/dist" \
      nohup "$ROOT/backend/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$PORT" \
      --proxy-headers --forwarded-allow-ips 127.0.0.1 >"$APP_LOG" 2>&1 &
    echo $! >"$APP_PID"
  )
  if ! wait_for "$LOCAL_URL/api/health" 60 -u "$(auth)"; then
    tail -30 "$APP_LOG" >&2
    die "Minutes did not start. Full log: $APP_LOG"
  fi
  ok "App healthy on $LOCAL_URL: $(curl -s -u "$(auth)" "$LOCAL_URL/api/health")"
}

verify_public() {
  local url code i
  url="$(public_url)"
  for i in $(seq 1 20); do # a new tunnel hostname can take a few seconds to resolve
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url/api/health" 2>/dev/null || true)"
    [ "$code" = "401" ] && break
    sleep 2
  done
  [ "$code" = "401" ] || die "Public URL returned HTTP $code (expected 401 before login). Retry in a minute: ./scripts/prod.sh status"
  ok "Public URL requires the login (401 without it)"
  code="$(curl -s -o /dev/null -w '%{http_code}' -u "$(auth)" "$url/")"
  [ "$code" = "200" ] || die "Public URL returned HTTP $code with the login."
  ok "Public URL loads with the login (200)"
}

summary() {
  printf '\n\033[1;32mMinutes is live\033[0m\n'
  echo "  URL:      $(public_url)"
  echo "  Username: $(login_user)"
  echo "  Password: $(login_password)"
}

cmd_start() {
  mkdir -p "$STATE" && chmod 700 "$STATE"
  plan 7
  step "Checking tools"
  check_tools
  step "Preparing the login"
  write_login
  step "Building the frontend"
  frontend_install "$STATE"
  frontend_build "$STATE"
  step "Installing backend dependencies and preparing the database"
  backend_sync "$STATE"
  backend_migrate "$STATE"
  step "Opening the Cloudflare tunnel (new URL)"
  start_tunnel
  step "Starting the app"
  restart_app
  step "Checking the public URL"
  verify_public
  summary
  echo
  echo "  Share this URL. It changes only if you run 'start' again or the tunnel stops."
  echo "  Ship later code changes with: ./scripts/prod.sh deploy  (same URL)"
}

require_live() {
  running "$TUNNEL_PID" && [ -f "$URL_FILE" ] && [ -f "$LOGIN_FILE" ] ||
    die "Production is not running. Start it first: ./scripts/prod.sh start"
}

cmd_deploy() {
  if [ "${1:-}" = "frontend" ]; then
    plan 3
    step "Checking what will be deployed"
    require_live
    show_version
    find_node
    step "Building the frontend (served immediately, no restart)"
    frontend_install "$STATE"
    frontend_build "$STATE"
    step "Checking the public URL"
    verify_public
    summary
    return
  fi
  plan 5
  step "Checking what will be deployed"
  require_live
  show_version
  require_uv
  find_node
  step "Building the frontend"
  frontend_install "$STATE"
  frontend_build "$STATE"
  step "Installing backend dependencies and applying database migrations"
  backend_sync "$STATE"
  backend_migrate "$STATE"
  step "Restarting the app (tunnel stays up, same URL)"
  restart_app
  step "Checking the public URL"
  verify_public
  summary
  echo
  echo "  Note: keys entered in Settings were cleared by the restart unless they are in .env."
}

cmd_status() {
  plan 3
  step "Version on disk"
  show_version
  step "Tunnel"
  if running "$TUNNEL_PID" && [ -f "$URL_FILE" ]; then ok "Running: $(public_url)"; else say "Stopped"; fi
  step "App"
  if [ -f "$LOGIN_FILE" ] && running "$APP_PID" &&
    curl -fsS -u "$(auth)" "$LOCAL_URL/api/health" >/dev/null 2>&1; then
    ok "Healthy: $(curl -s -u "$(auth)" "$LOCAL_URL/api/health")"
    say "Started: $(ps -o lstart= -p "$(cat "$APP_PID")" | sed 's/  */ /g')"
    say "Login:   $(login_user) / $(login_password)"
  else
    say "Not running on $LOCAL_URL"
  fi
}

cmd_logs() {
  case "${1:-app}" in
    app) tail -n 50 -f "$APP_LOG" ;;
    tunnel) tail -n 50 -f "$TUNNEL_LOG" ;;
    *) die "Choose a log: app or tunnel" ;;
  esac
}

cmd_stop() {
  plan 2
  step "Stopping the tunnel"
  stop_pid "$TUNNEL_PID" "tunnel"
  rm -f "$URL_FILE"
  step "Stopping the app"
  stop_pid "$APP_PID" "app"
  printf '\n\033[1;32mStopped.\033[0m Meetings remain in the DATABASE_URL database.\n'
}

case "${1:-}" in
  start | up) cmd_start ;;
  deploy) cmd_deploy "${2:-}" ;;
  status) cmd_status ;;
  logs) cmd_logs "${2:-app}" ;;
  stop | down) cmd_stop ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
