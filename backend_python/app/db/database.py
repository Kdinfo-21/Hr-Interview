from sqlalchemy import create_engine, text
from app.config import DATABASE_URL

def _sqlalchemy_url(url: str) -> str:
    # SQLAlchemy otherwise tries the old psycopg2 driver for plain
    # postgresql:// URLs. This project installs psycopg (v3), so explicitly
    # select the psycopg driver.
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


if not DATABASE_URL:
    engine = None
else:
    engine = create_engine(_sqlalchemy_url(DATABASE_URL), pool_pre_ping=True)

def require_engine():
    if engine is None:
        raise RuntimeError("DATABASE_URL is not configured. Copy .env.example to .env and set it.")
    return engine

def fetch_all(sql, params=None):
    with require_engine().connect() as conn:
        return [dict(r._mapping) for r in conn.execute(text(sql), params or {})]

def fetch_one(sql, params=None):
    with require_engine().connect() as conn:
        row = conn.execute(text(sql), params or {}).mappings().first()
        return dict(row) if row else None

def _clean_db_value(value):
    """Remove PostgreSQL-incompatible NUL bytes from values before binding."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, bytes):
        return value.replace(b"\x00", b"")
    if isinstance(value, dict):
        return {k: _clean_db_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean_db_value(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_clean_db_value(v) for v in value)
    return value


def execute(sql, params=None):
    # PostgreSQL text/json values cannot contain the NUL character (0x00).
    # Resume extraction can occasionally produce it, so sanitize all bound
    # values at the final database boundary. This also covers future resume
    # fields without requiring every route to remember the cleanup.
    clean_params = _clean_db_value(params or {})
    with require_engine().begin() as conn:
        result = conn.execute(text(sql), clean_params)
        try:
            return result.mappings().first()
        except Exception:
            return None

def _split_sql_statements(sql: str):
    """
    Splits a SQL script into individual statements on ';', but treats
    dollar-quoted strings (e.g. `DO $$ ... END $$;`, used by PL/pgSQL blocks
    for the schema's idempotent migration blocks) as atomic — semicolons
    inside a $$...$$ (or $tag$...$tag$) region never split the statement.
    A naive `sql.split(";")` breaks any DO/function block that contains
    internal semicolons, which is exactly the shape of this schema's
    conditional ALTER/DROP CONSTRAINT migration guards.
    """
    statements = []
    buf = []
    dollar_tag = None  # None when not inside a dollar-quoted string, else the tag (e.g. "$$", "$foo$")
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if dollar_tag is None and ch == "$":
            # Look for a dollar-quote opening tag: $ [tag] $
            j = sql.find("$", i + 1)
            if j != -1 and all(c.isalnum() or c == "_" for c in sql[i + 1:j]):
                dollar_tag = sql[i:j + 1]
                buf.append(dollar_tag)
                i = j + 1
                continue
        elif dollar_tag is not None and sql.startswith(dollar_tag, i):
            buf.append(dollar_tag)
            i += len(dollar_tag)
            dollar_tag = None
            continue

        if dollar_tag is None and ch == ";":
            statement = "".join(buf).strip()
            if statement:
                statements.append(statement)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def init_db(schema_path):
    # Strip SQL line comments before splitting. Some schema comments contain
    # semicolons (for example "e.g. ...; ..."), so splitting first can create
    # broken statements such as a standalone "hidden_tests" or "NULL".
    raw_sql = open(schema_path, encoding="utf-8").read()
    sql_lines = []
    for line in raw_sql.splitlines():
        # This schema does not use -- inside quoted SQL strings, so removing
        # everything after -- is safe and keeps the initializer simple.
        sql_lines.append(line.split("--", 1)[0])
    sql = "\n".join(sql_lines)

    statements = _split_sql_statements(sql)

    with require_engine().begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
