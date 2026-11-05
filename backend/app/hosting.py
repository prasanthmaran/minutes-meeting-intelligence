"""Optional single-port review hosting: shared-password gate and built frontend.

Both are off unless APP_PASSWORD / FRONTEND_DIST are set (scripts/cloudflare-host.sh).
"""

import base64
import binascii
import hmac
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles


class BasicAuth:
    """Raw ASGI middleware, so HTTP and WebSocket requests are both gated."""

    def __init__(self, app, username: str, password: str):
        self.app = app
        self.expected = f"{username}:{password}".encode()

    def allowed(self, scope) -> bool:
        for name, value in scope.get("headers", []):
            if name == b"authorization" and value[:6].lower() == b"basic ":
                try:
                    supplied = base64.b64decode(value[6:].strip(), validate=True)
                except (binascii.Error, ValueError):
                    return False
                return hmac.compare_digest(supplied, self.expected)
        return False

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or self.allowed(scope):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"www-authenticate", b'Basic realm="Minutes review", charset="UTF-8"'),
                    (b"content-type", b"text/plain; charset=utf-8"),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": b"Sign in to view Minutes."})


def configure_hosting(app: FastAPI, settings) -> None:
    password = settings.app_password.get_secret_value()
    if password:
        app.add_middleware(BasicAuth, username=settings.app_user, password=password)
    if settings.frontend_dist:
        dist = Path(settings.frontend_dist)
        if not (dist / "index.html").is_file():
            raise RuntimeError(f"FRONTEND_DIST has no index.html: {dist}")
        # Mounted last so every /api route keeps priority. The UI uses hash routes.
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
