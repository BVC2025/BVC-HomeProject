"""
Test fixtures shared across the BVC24 test suite.

Strategy:
  - Use SQLite in-memory so tests are fast + isolated and don't
    require a running MySQL.
  - Override the FastAPI `get_db` dependency to hand each test a
    fresh session bound to a per-test SQLite database.
  - Provide a `seeded_client` fixture that runs the BVC24 demo
    seed once so tests can exercise realistic data.

Production code stays unchanged — only the dependency injection
is swapped at test time.
"""

import os
import sys
from datetime import date, datetime, time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Make the app importable when running pytest from backend/
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Set up environment vars BEFORE importing the app so it doesn't
# choke on missing .env values during import.
os.environ.setdefault("MY_SQL", "sqlite://")
os.environ.setdefault("DB_NAME", "")
os.environ.setdefault("APPROVER_EMAIL", "test@example.com")
os.environ.setdefault("SMTP_HOST", "localhost")
os.environ.setdefault("SMTP_PORT", "1025")
os.environ.setdefault("SMTP_USER", "test")
os.environ.setdefault("SMTP_PASSWORD", "test")
os.environ.setdefault("SMTP_FROM", "test@example.com")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")
os.environ.setdefault("BACKEND_URL", "http://localhost:8001")

from app.database.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="function")
def engine():
    """A fresh SQLite in-memory engine per test."""

    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )

    Base.metadata.create_all(bind=eng)

    yield eng

    Base.metadata.drop_all(bind=eng)


@pytest.fixture(scope="function")
def db_session(engine):

    TestingSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine
    )

    session = TestingSessionLocal()

    try:

        yield session

    finally:

        session.close()


@pytest.fixture(scope="function")
def client(engine):
    """A TestClient with the app's get_db overridden to use SQLite."""

    TestingSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine
    )

    def override_get_db():

        db = TestingSessionLocal()

        try:

            yield db

        finally:

            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as c:

        yield c

    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def seeded_client(client):
    """Run the BVC24 seed endpoint once so tests have realistic data:
    7 depts, 6 employees with fingerprints 1001-1006, 6 projects,
    5 machine models, 7 suppliers, 5 work orders, QC checklists.
    """

    res = client.post("/demo/seed-bvc24")

    assert res.status_code == 200, f"Seed failed: {res.text}"

    return client


@pytest.fixture
def fingerprint_ids():
    """Canonical demo fingerprint IDs seeded by /demo/seed-bvc24."""

    return ["1001", "1002", "1003", "1004", "1005", "1006"]
