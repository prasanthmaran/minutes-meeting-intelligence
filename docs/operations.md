# Running and updating Minutes

Two scripts handle everything. Each prints numbered steps (`[2/5] Building the frontend`)
and stops at the first failed step, showing the end of the relevant log.

| | Development | Production (POC) |
|---|---|---|
| Script | `scripts/dev.sh` | `scripts/prod.sh` |
| Address | http://localhost:5173 (API on :8000) | `https://<random>.trycloudflare.com` (app on :8787) |
| Login | none | `reviewer` + password printed by the script |
| Logs | `.dev/` | `.cloudflare/` |

Both use `DATABASE_URL` from the project-root `.env` (SQLite file or Supabase).
Requirements: [uv](https://docs.astral.sh/uv/), Node.js 22 (`nvm install 22`), and Homebrew
for `cloudflared` (installed automatically on first production start).

## Before you start (once)

1. Copy the settings file: `cp .env.example .env`.
2. Edit `.env`:
   - `DATABASE_URL`: keep the SQLite default, or use your Supabase Session pooler URI.
   - Claude and ElevenLabs keys: enter them once in **Settings**. They are saved encrypted
     in the database (key file `.secrets/settings.key`) and survive restarts. Keys in
     `.env` (`AI_MODE`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`) also work.

## Development

### Start
```bash
./scripts/dev.sh start        # or: make dev
```
1. Checks uv and Node, shows the branch and commit.
2. Installs backend and frontend dependencies.
3. Prepares the database (`python -m app.migrate`).
4. Starts the backend on http://127.0.0.1:8000.
5. Starts the frontend on http://localhost:5173.

### While you work
- **Frontend edits** reload in the browser automatically.
- **Backend edits**: `./scripts/dev.sh restart backend`
- **After `git pull` or dependency changes**: `./scripts/dev.sh start`
- Check: `./scripts/dev.sh status`
- Logs: `./scripts/dev.sh logs backend` or `./scripts/dev.sh logs frontend`
- Stop: `./scripts/dev.sh stop`

### Before shipping
```bash
make test                      # backend + frontend tests
git add -A && git commit       # production runs the code on disk in this folder
```

## Production (POC)

### First start (new URL)
```bash
./scripts/prod.sh start       # or: make prod-start
```
1. Checks tools (installs `cloudflared` if missing).
2. Prepares the login (keeps the same password across restarts).
3. Builds the frontend.
4. Installs backend dependencies and applies database migrations.
5. Opens the Cloudflare tunnel and gets a **new** URL.
6. Starts the app on 127.0.0.1:8787.
7. Checks the public URL needs the login and loads with it.

It prints the URL, username and password to share.

### Ship code changes (same URL)
Pick the smallest option that covers your change:

| Changed | Command | Restart | URL |
|---|---|---|---|
| Only `frontend/` | `./scripts/prod.sh deploy frontend` | none | same |
| Anything in `backend/`, dependencies or migrations | `./scripts/prod.sh deploy` (or `make prod-deploy`) | app only, ~5 s | same |

`deploy` steps:
1. Shows the branch and commit being deployed (warns about uncommitted files).
2. Builds the frontend.
3. Installs backend dependencies and applies database migrations.
4. Restarts the app; the tunnel keeps running.
5. Checks the public URL.

Keys saved in Settings stay connected across deploys. Back up `.secrets/settings.key`;
without it, saved keys cannot be read and must be entered again.

### Check, logs, stop
```bash
./scripts/prod.sh status          # version on disk, URL, health, login
./scripts/prod.sh logs app        # or: logs tunnel   (Ctrl+C to exit)
./scripts/prod.sh stop            # takes the site offline; data is kept
```

### Roll back
1. `git log --oneline` and pick the last good commit.
2. `git switch -c rollback <commit>` (or `git revert <bad-commit>` on your branch).
3. `./scripts/prod.sh deploy`.
4. `./scripts/prod.sh status` to confirm the commit and health.

Database migrations are not undone automatically. They only add tables and settings, so
older code keeps working with them.

## Things to know
- The URL changes only on `prod.sh start` or if the tunnel stops (Mac restart, sleep,
  network loss). `deploy` keeps it. Keep the Mac awake during reviews: `caffeinate -d`.
- Development and production share the database when `.env` points both at the same
  `DATABASE_URL`. A restart marks a meeting that was mid-processing as "retry".
- Production serves the code currently checked out in this folder, including uncommitted
  edits. `status` and `deploy` show which branch and commit that is.
