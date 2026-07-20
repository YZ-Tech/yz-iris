"""Entry point: python -m yz_iris"""
import os

import uvicorn
from .server import app

# YZ_PORT = the port core resolved (settings.ports override) — wins so the
# bind always matches the client URL; the default serves standalone runs.
uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("YZ_PORT") or "9007"), log_level="info")
