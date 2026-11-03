from app.db.database import init_db
from app.db.migrations import run_startup_migrations
from pathlib import Path
init_db(Path(__file__).with_name('schema.sql'))
run_startup_migrations()  # per-recruiter ownership (migrations/002_add_owner_scoping.sql)
print('Database schema initialized.')
