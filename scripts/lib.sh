# Shared helpers for scripts/dev.sh and scripts/prod.sh. Source, don't run.
# Bash 3.2 compatible (macOS default shell).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STEP=0
STEPS=0
plan() { # number of steps in the current command
  STEP=0
  STEPS="$1"
}
step() { # announce the next numbered step
  STEP=$((STEP + 1))
  printf '\n\033[1;34m[%s/%s]\033[0m \033[1m%s\033[0m\n' "$STEP" "$STEPS" "$*"
}
say() { printf '      %s\n' "$*"; }
ok() { printf '      \033[32m✓\033[0m %s\n' "$*"; }
die() {
  printf '\n\033[1;31m✗ Step %s failed:\033[0m %s\n' "${STEP:-?}" "$*" >&2
  exit 1
}

running() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
stop_pid() { # pid-file label
  if running "$1"; then
    kill "$(cat "$1")" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      running "$1" || break
      sleep 0.5
    done
    ok "Stopped $2"
  fi
  rm -f "$1"
}
port_pid() { { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; } | head -1; }
free_port() { # port command-pattern: wait for the port; stop a leftover server of ours
  local port="$1" pattern="$2" pid i
  for i in $(seq 1 10); do
    pid="$(port_pid "$port")"
    [ -z "$pid" ] && return 0
    if ps -o command= -p "$pid" | grep -q -- "$pattern"; then
      kill "$pid" 2>/dev/null || true
    fi
    sleep 0.5
  done
  die "Port $port is used by another program (pid $(port_pid "$port")): $(ps -o command= -p "$(port_pid "$port")" | cut -c1-80)"
}

wait_for() { # url seconds [curl-args...]  → 0 when the URL answers 2xx
  local url="$1" seconds="$2" i
  shift 2
  for i in $(seq 1 $((seconds * 2))); do
    curl -fsS "$@" "$url" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

NODE_BIN=""
find_node() { # Vite needs Node 20+; README asks for 22. nvm's default may be older.
  local candidate major
  for candidate in "$(command -v node || true)" "$HOME"/.nvm/versions/node/v2*/bin/node \
    /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$candidate" ] || continue
    major="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 20 ]; then
      NODE_BIN="$(dirname "$candidate")"
      return 0
    fi
  done
  die "Node.js 20+ is required (README asks for 22). Install it with: nvm install 22"
}

require_uv() { command -v uv >/dev/null || die "uv is required: https://docs.astral.sh/uv/"; }

run_logged() { # log-file description command...  → shows the log tail on failure
  local log="$1" what="$2"
  shift 2
  if ! "$@" >"$log" 2>&1; then
    tail -25 "$log" >&2
    die "$what failed. Full log: $log"
  fi
}

backend_sync() { # log-dir
  (cd "$ROOT/backend" && run_logged "$1/sync.log" "Installing backend dependencies" uv sync --frozen)
  ok "Backend dependencies installed"
}
backend_migrate() { # log-dir
  (cd "$ROOT/backend" && run_logged "$1/migrate.log" "Database setup (check DATABASE_URL in .env)" \
    uv run --frozen python -m app.migrate)
  ok "$(tail -1 "$1/migrate.log")"
}
frontend_install() { # log-dir
  if [ ! -d "$ROOT/frontend/node_modules" ] ||
    [ "$ROOT/frontend/package-lock.json" -nt "$ROOT/frontend/node_modules/.package-lock.json" ]; then
    (cd "$ROOT/frontend" && PATH="$NODE_BIN:$PATH" run_logged "$1/npm-install.log" "npm ci" npm ci)
    ok "Frontend dependencies installed"
  else
    ok "Frontend dependencies up to date"
  fi
}
frontend_build() { # log-dir
  (cd "$ROOT/frontend" && PATH="$NODE_BIN:$PATH" run_logged "$1/build.log" "Frontend build" npm run build)
  [ -f "$ROOT/frontend/dist/index.html" ] || die "Build finished without frontend/dist/index.html."
  ok "Built frontend/dist with Node $("$NODE_BIN/node" -v)"
}
show_version() {
  local branch commit dirty
  branch="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "?")"
  commit="$(git -C "$ROOT" log -1 --format='%h %s' 2>/dev/null || echo "?")"
  dirty="$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  say "Branch: $branch"
  say "Commit: $commit"
  [ "$dirty" = "0" ] && ok "No uncommitted changes" ||
    say "Note: $dirty uncommitted file(s) will be included as they are on disk"
}
