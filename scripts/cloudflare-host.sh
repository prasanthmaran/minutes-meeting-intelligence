#!/usr/bin/env bash
# Share Minutes for review through a free Cloudflare Quick Tunnel.
# No Docker, domain or Cloudflare account needed.
#
# Builds the frontend, then runs one backend process (SQLite) that serves both the
# UI and /api on 127.0.0.1:8787. cloudflared opens an outbound-only tunnel and
# prints a public https://<random>.trycloudflare.com address. The app has no
# login of its own, so every page and API call asks for a username and password.
#
# Usage:
#   ./scripts/cloudflare-host.sh up        # build, start app + tunnel, print URL and login
#   ./scripts/cloudflare-host.sh status    # show URL, health and login
#   ./scripts/cloudflare-host.sh down      # stop tunnel and app (meetings are kept)
#
# Optional:
#   APP_USER       Login name (default: reviewer)
#   APP_PASSWORD   Login password (default: a random one, kept across restarts)
#
# AI and voice keys come from the ignored project-root .env (AI_MODE, ANTHROPIC_API_KEY,
# ELEVENLABS_API_KEY) and the database from DATABASE_URL: backend/meeting.db by default,
# or Supabase/Postgres. It is the same database as local development.
# The address changes whenever the tunnel restarts, and the site is online only
# while this computer is awake.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.cloudflare"
PORT=8787
LOCAL_URL="http://127.0.0.1:$PORT"
TUNNEL_PID="$STATE/cloudflared.pid"
APP_PID="$STATE/app.pid"
TUNNEL_LOG="$STATE/cloudflared.log"
APP_LOG="$STATE/app.log"
URL_FILE="$STATE/url"
LOGIN_FILE="$STATE/login"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}
running() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
stop() { # pid-file label
  if running "$1"; then
    say "Stopping $2"
    kill "$(cat "$1")" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5; do running "$1" || break; sleep 1; done
  fi
  rm -f "$1"
}
login_user() { sed -n 1p "$LOGIN_FILE"; }
login_password() { sed -n 2p "$LOGIN_FILE"; }

NODE_BIN=""
find_node() { # Vite and Vitest need Node 18+; README asks for 22.
  local candidate major
  for candidate in "$(command -v node || true)" "$HOME"/.nvm/versions/node/v2*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$candidate" ] || continue
    major="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 20 ]; then
      NODE_BIN="$(dirname "$candidate")"
      return
    fi
  done
  die "Node.js 20+ is required to build the frontend (README asks for 22). Install it, e.g. 'nvm install 22'."
}

require_tools() {
  command -v uv >/dev/null || die "uv is required: https://docs.astral.sh/uv/"
  command -v curl >/dev/null || die "curl is required."
  command -v openssl >/dev/null || die "openssl is required to create the password."
  find_node
  if ! command -v cloudflared >/dev/null; then
    command -v brew >/dev/null || die "Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    say "Installing cloudflared with Homebrew"
    brew install cloudflared
  fi
  if curl -s -o /dev/null "$LOCAL_URL" 2>/dev/null && ! running "$APP_PID"; then
    die "Port $PORT is already in use by another program."
  fi
}

write_login() {
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  local user="${APP_USER:-reviewer}" password="${APP_PASSWORD:-}"
  [ -z "$password" ] && [ -f "$LOGIN_FILE" ] && password="$(login_password)"
  [ -n "$password" ] || password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  printf '%s\n%s\n' "$user" "$password" >"$LOGIN_FILE"
  chmod 600 "$LOGIN_FILE"
}

build_frontend() {
  say "Building the frontend (Node $("$NODE_BIN/node" -v))"
  (
    cd "$ROOT/frontend"
    export PATH="$NODE_BIN:$PATH"
    [ -d node_modules ] || npm ci
    npm run build
  ) >"$STATE/build.log" 2>&1 || {
    tail -30 "$STATE/build.log" >&2
    die "Frontend build failed. Full log: $STATE/build.log"
  }
  [ -f "$ROOT/frontend/dist/index.html" ] || die "Build finished without frontend/dist/index.html."
}

prepare_backend() {
  say "Installing backend dependencies"
  (cd "$ROOT/backend" && uv sync --frozen) >"$STATE/sync.log" 2>&1 || {
    tail -20 "$STATE/sync.log" >&2
    die "uv sync failed. Full log: $STATE/sync.log"
  }
  say "Preparing the database from DATABASE_URL (SQLite file or Supabase/Postgres)"
  (cd "$ROOT/backend" && uv run --frozen python -m app.migrate) >"$STATE/migrate.log" 2>&1 || {
    tail -20 "$STATE/migrate.log" >&2
    die "Database setup failed. Check DATABASE_URL in .env. Full log: $STATE/migrate.log"
  }
}

start_tunnel() {
  stop "$TUNNEL_PID" "previous tunnel"
  rm -f "$URL_FILE"
  say "Opening a Cloudflare Quick Tunnel"
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
}

start_app() {
  stop "$APP_PID" "previous app process"
  say "Starting Minutes on $LOCAL_URL"
  (
    cd "$ROOT/backend"
    # Environment variables override .env. The public URL must be an allowed origin
    # because settings and voice requests check the browser Origin header.
    CORS_ORIGINS="[\"$(cat "$URL_FILE")\",\"$LOCAL_URL\"]" \
      APP_USER="$(login_user)" \
      APP_PASSWORD="$(login_password)" \
      FRONTEND_DIST="$ROOT/frontend/dist" \
      nohup uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port "$PORT" \
      --proxy-headers --forwarded-allow-ips 127.0.0.1 >"$APP_LOG" 2>&1 &
    echo $! >"$APP_PID"
  )
  local i auth
  auth="$(login_user):$(login_password)"
  for i in $(seq 1 60); do
    curl -fsS -u "$auth" "$LOCAL_URL/api/health" >/dev/null 2>&1 && return
    running "$APP_PID" || break
    sleep 1
  done
  tail -30 "$APP_LOG" >&2
  die "Minutes did not start. Full log: $APP_LOG"
}

cmd_up() {
  require_tools
  write_login
  build_frontend
  prepare_backend
  start_tunnel
  start_app
  local url code i
  url="$(cat "$URL_FILE")"
  for i in $(seq 1 20); do # a brand-new tunnel hostname can take a few seconds to resolve
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url/api/health" 2>/dev/null || true)"
    [ "$code" = "401" ] && break
    sleep 2
  done
  [ "$code" = "401" ] || echo "    note: public check returned HTTP $code (expected 401 before login); try the URL again in a minute."
  echo
  say "Minutes is live"
  echo "    URL:      $url"
  echo "    Username: $(login_user)"
  echo "    Password: $(login_password)"
  echo
  echo "    Online while this computer is awake. The URL changes if the tunnel restarts."
  echo "    Logs: $STATE    Stop: ./scripts/cloudflare-host.sh down"
}

cmd_down() {
  stop "$TUNNEL_PID" "tunnel"
  stop "$APP_PID" "Minutes"
  rm -f "$URL_FILE"
  say "Stopped. Meetings remain in the DATABASE_URL database."
}

cmd_status() {
  if running "$TUNNEL_PID" && [ -f "$URL_FILE" ]; then
    echo "tunnel: running  $(cat "$URL_FILE")"
  else
    echo "tunnel: stopped"
  fi
  if [ -f "$LOGIN_FILE" ] && curl -fsS -u "$(login_user):$(login_password)" "$LOCAL_URL/api/health" 2>/dev/null; then
    echo
    echo "login: $(login_user) / $(login_password)"
  else
    echo "app: not running on $LOCAL_URL"
  fi
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  *)
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
