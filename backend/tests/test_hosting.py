import base64

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.hosting import configure_hosting


def hosted(tmp_path, password="s3cret"):
    (tmp_path / "index.html").write_text("<title>Minutes</title>")
    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    configure_hosting(
        app, Settings(app_password=password, frontend_dist=str(tmp_path), app_user="reviewer")
    )
    return TestClient(app)


def basic(user, password):
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}


def test_password_gates_api_and_frontend(tmp_path):
    client = hosted(tmp_path)
    for path in ("/", "/api/health"):
        response = client.get(path)
        assert response.status_code == 401
        assert response.headers["www-authenticate"].startswith("Basic")
    assert client.get("/api/health", headers=basic("reviewer", "wrong")).status_code == 401
    assert client.get("/", headers={"Authorization": "Basic !!!"}).status_code == 401
    ok = basic("reviewer", "s3cret")
    assert client.get("/api/health", headers=ok).json() == {"status": "ok"}
    assert "Minutes" in client.get("/", headers=ok).text


def test_hosting_is_off_by_default():
    app = FastAPI()
    configure_hosting(app, Settings())
    assert app.user_middleware == [] and len(app.routes) == len(FastAPI().routes)
