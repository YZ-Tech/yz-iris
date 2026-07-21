"""Entry point: python -m yz_iris"""
from yz_satellite_common import run_server

from .server import app

# YZ_PORT (core-resolved, settings.ports) wins; default serves standalone runs.
run_server(app, 9007)
