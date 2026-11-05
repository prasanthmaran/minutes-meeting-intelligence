.PHONY: setup migrate backend frontend test build dev dev-stop prod-start prod-deploy prod-status
setup:
	cd backend && uv sync --frozen
	cd frontend && npm ci
migrate:
	cd backend && uv run python -m app.migrate
backend: migrate
	cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
frontend:
	cd frontend && npm run dev
test:
	cd backend && uv run pytest -q
	cd frontend && npm test
build:
	cd frontend && npm run build
# Step-by-step helpers: see docs/operations.md
dev:
	./scripts/dev.sh start
dev-stop:
	./scripts/dev.sh stop
prod-start:
	./scripts/prod.sh start
prod-deploy:
	./scripts/prod.sh deploy
prod-status:
	./scripts/prod.sh status
