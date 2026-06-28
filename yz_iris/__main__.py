"""Entry point: python -m yz_iris"""
import uvicorn
from .server import app

uvicorn.run(app, host="127.0.0.1", port=9007, log_level="info")
