"""
Startup migrations.

The live database already exists (Neon), so schema changes have to reach it
without someone remembering to paste SQL by hand — otherwise deploying code
that reads a new column before the column exists would take the site down.
Each file listed here is idempotent (IF NOT EXISTS / guarded DO blocks), so
running it on every boot is harmless.
"""

import logging
from pathlib import Path

from app.db import database

logger = logging.getLogger("uvicorn.error")

_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
_STARTUP_MIGRATIONS = ["002_add_owner_scoping.sql"]


def run_startup_migrations() -> None:
    if database.engine is None:
        logger.warning("DATABASE_URL is not configured — skipping startup migrations.")
        return
    for name in _STARTUP_MIGRATIONS:
        path = _MIGRATIONS_DIR / name
        if not path.exists():
            logger.error("Migration file %s not found — skipping.", path)
            continue
        try:
            database.init_db(path)
            logger.info("Applied migration %s", name)
        except Exception:
            # Don't take the whole API down (e.g. DB briefly unreachable at
            # boot) — requests will surface the real database error instead.
            logger.exception("Migration %s failed", name)
