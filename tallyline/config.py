"""Runtime settings, all overridable with environment variables."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = ROOT / "sql"
WEB_DIR = ROOT / "web"

DB_PATH = os.environ.get("TALLYLINE_DB", str(ROOT / "data" / "tallyline.duckdb"))
SEED = int(os.environ.get("TALLYLINE_SEED", "7"))
HISTORY_DAYS = int(os.environ.get("TALLYLINE_DAYS", "100"))  # enough for "last month" vs the month before
MEMORY_LIMIT = os.environ.get("TALLYLINE_MEMORY", "384MB")  # fits a 512 MB container
THREADS = int(os.environ.get("TALLYLINE_THREADS", "2"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

MAX_RANGE_DAYS = 31
MAX_FILTER_VALUES = 50
