"""
Boot Django for the evaluation in an isolated sandbox.

Everything runs against a throwaway SQLite test database and a temporary
MEDIA_ROOT holding *copies* of the sample event logs, so an eval run can never
touch real users, projects or files. The test database is a file (not the
default in-memory one) so worker threads share it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SAMPLE_LOGS = BACKEND / "user_files"

_ready = False


def setup(sandbox: Path) -> None:
    """Configure Django once per process: test DB and MEDIA_ROOT inside ``sandbox``."""
    global _ready
    if _ready:
        return
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "totem_backend.settings")

    import django
    from django.db import connections
    from django.test.utils import override_settings, setup_test_environment

    django.setup()
    media = sandbox / "media"
    media.mkdir(parents=True, exist_ok=True)
    override_settings(MEDIA_ROOT=str(media)).enable()
    setup_test_environment()  # also allows the "testserver" host for API calls

    from django.conf import settings

    db = settings.DATABASES["default"]
    db.setdefault("TEST", {})["NAME"] = str(sandbox / "eval.sqlite3")
    # Worker threads write concurrently (workspaces, approvals): wait for locks instead of failing.
    db.setdefault("OPTIONS", {})["timeout"] = 60
    conn = connections["default"]
    conn.settings_dict.update({"TEST": db["TEST"], "OPTIONS": db["OPTIONS"]})
    conn.creation.create_test_db(verbosity=0, autoclobber=True, keepdb=False)
    with conn.cursor() as cur:
        cur.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
    _ready = True


def media_root() -> Path:
    from django.conf import settings

    return Path(settings.MEDIA_ROOT)
