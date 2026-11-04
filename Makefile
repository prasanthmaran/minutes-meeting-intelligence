.PHONY: setup backend frontend test build
setup:
	cd backend && uv sync --frozen
	cd frontend && npm ci
backend:
	cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
frontend:
	cd frontend && npm run dev
test:
	cd backend && uv run pytest -q
	cd frontend && npm test
build:
	cd frontend && npm run build
