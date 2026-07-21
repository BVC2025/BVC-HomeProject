from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
import os
import warnings

load_dotenv()

MY_SQL  = os.getenv("MY_SQL",  "mysql+pymysql://root:@localhost")
DB_NAME = os.getenv("DB_NAME", "vending_erp")

# ── Bootstrap ──────────────────────────────────────────────────────────────────
# Connect to the MySQL *server* (no database name in the URL) and create the
# target database if it does not yet exist.  This must happen before the main
# engine is created so that the very first inspect() / create_all() call in
# main.py never hits OperationalError 1049 "Unknown database".
try:
    _boot_engine = create_engine(MY_SQL, pool_pre_ping=True)
    with _boot_engine.connect() as _conn:
        _safe = DB_NAME.replace("`", "``")          # escape any stray backtick
        _conn.execute(
            text(
                f"CREATE DATABASE IF NOT EXISTS `{_safe}` "
                f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
        _conn.commit()
    _boot_engine.dispose()
except Exception as _exc:
    # If MySQL is not reachable at all, let the main engine surface the error
    # with a more informative connection-refused / timeout message instead.
    warnings.warn(f"[db-bootstrap] Could not auto-create database '{DB_NAME}': {_exc}")
# ──────────────────────────────────────────────────────────────────────────────

DATABASE_URL = f"{MY_SQL}/{DB_NAME}"

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()