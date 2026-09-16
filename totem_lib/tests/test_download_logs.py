"""
Contract for the log downloader (evaluation/download_logs.py).

The network is injected as the `opener` argument, so every test here runs offline. The
point of most of them is the failure path: a download that is interrupted or corrupted
must never leave behind something that later looks like a valid log.
"""

import hashlib
import io
from pathlib import Path

import pytest

from evaluation.datasets import EvaluationLog
from evaluation.download_logs import (
    download_log,
    fetch,
    file_md5,
    plan_downloads,
)

PAYLOAD = b"totem" * 1000
PAYLOAD_MD5 = hashlib.md5(PAYLOAD).hexdigest()


class FakeOpener:
    """Stands in for urllib.request.urlopen and records how often it was called."""

    def __init__(self, payload: bytes = PAYLOAD):
        self.payload = payload
        self.calls = 0

    def __call__(self, request):
        self.calls += 1
        return io.BytesIO(self.payload)


def _log(path: Path, **overrides) -> EvaluationLog:
    fields = {
        "name": "fake-log",
        "source_url": "https://example.org/record",
        "path": path,
        "download_url": "https://example.org/file/content",
        "md5": PAYLOAD_MD5,
        "size_bytes": len(PAYLOAD),
    }
    fields.update(overrides)
    return EvaluationLog(**fields)


# ---------------------------------------------------------------------------
# plan_downloads
# ---------------------------------------------------------------------------

def test_plan_selects_downloadable_logs_that_are_missing(tmp_path):
    log = _log(tmp_path / "missing.sqlite")
    to_fetch, skipped = plan_downloads([log])
    assert to_fetch == [log]
    assert skipped == []


def test_plan_skips_a_log_that_is_already_present(tmp_path):
    path = tmp_path / "present.sqlite"
    path.write_bytes(PAYLOAD)
    log = _log(path)
    to_fetch, skipped = plan_downloads([log])
    assert to_fetch == []
    assert skipped == [log]


def test_plan_refetches_a_present_log_when_forced(tmp_path):
    path = tmp_path / "present.sqlite"
    path.write_bytes(PAYLOAD)
    log = _log(path)
    to_fetch, _ = plan_downloads([log], force=True)
    assert to_fetch == [log]


def test_plan_ignores_bundled_logs_by_default(tmp_path):
    """With no names given, only downloadable logs are in scope at all."""
    log = _log(tmp_path / "bundled.json", download_url=None, md5=None, size_bytes=None)
    to_fetch, skipped = plan_downloads([log])
    assert to_fetch == []
    assert skipped == []


def test_plan_skips_a_bundled_log_that_was_named_explicitly(tmp_path):
    log = _log(tmp_path / "bundled.json", name="b", download_url=None, md5=None,
               size_bytes=None)
    to_fetch, skipped = plan_downloads([log], ["b"])
    assert to_fetch == []
    assert skipped == [log]


def test_plan_can_select_a_subset_by_name(tmp_path):
    wanted = _log(tmp_path / "a.sqlite", name="a")
    other = _log(tmp_path / "b.sqlite", name="b")
    to_fetch, _ = plan_downloads([wanted, other], ["a"])
    assert to_fetch == [wanted]


def test_plan_rejects_an_unknown_name(tmp_path):
    with pytest.raises(ValueError):
        plan_downloads([_log(tmp_path / "a.sqlite", name="a")], ["nope"])


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------

def test_fetch_writes_the_payload_and_verifies_it(tmp_path):
    dest = tmp_path / "out.sqlite"
    opener = FakeOpener()
    result = fetch("https://example.org/f", dest, expected_md5=PAYLOAD_MD5,
                   expected_size=len(PAYLOAD), opener=opener)
    assert result == dest
    assert dest.read_bytes() == PAYLOAD
    assert opener.calls == 1


def test_fetch_leaves_no_partial_file_behind(tmp_path):
    dest = tmp_path / "out.sqlite"
    fetch("https://example.org/f", dest, opener=FakeOpener())
    assert list(tmp_path.glob("*.part")) == []


def test_fetch_creates_the_destination_directory(tmp_path):
    dest = tmp_path / "nested" / "dir" / "out.sqlite"
    fetch("https://example.org/f", dest, opener=FakeOpener())
    assert dest.exists()


def test_fetch_rejects_a_checksum_mismatch_and_writes_nothing(tmp_path):
    dest = tmp_path / "out.sqlite"
    with pytest.raises(OSError, match="checksum mismatch"):
        fetch("https://example.org/f", dest, expected_md5="0" * 32, opener=FakeOpener())
    assert not dest.exists()
    assert list(tmp_path.glob("*.part")) == []


def test_fetch_rejects_a_size_mismatch_before_checking_the_checksum(tmp_path):
    dest = tmp_path / "out.sqlite"
    with pytest.raises(OSError, match="size mismatch"):
        fetch("https://example.org/f", dest, expected_md5=PAYLOAD_MD5,
              expected_size=len(PAYLOAD) + 1, opener=FakeOpener())
    assert not dest.exists()


def test_fetch_does_not_overwrite_the_destination_when_verification_fails(tmp_path):
    dest = tmp_path / "out.sqlite"
    dest.write_bytes(b"original")
    with pytest.raises(OSError):
        fetch("https://example.org/f", dest, expected_md5="0" * 32, opener=FakeOpener())
    assert dest.read_bytes() == b"original"


def test_fetch_reports_progress_monotonically(tmp_path):
    seen: list[int] = []
    fetch("https://example.org/f", tmp_path / "out.sqlite", expected_size=len(PAYLOAD),
          opener=FakeOpener(), chunk_bytes=512, on_progress=lambda d, t: seen.append(d))
    assert seen == sorted(seen)
    assert seen[-1] == len(PAYLOAD)


# ---------------------------------------------------------------------------
# download_log and file_md5
# ---------------------------------------------------------------------------

def test_download_log_writes_to_the_manifest_path(tmp_path):
    log = _log(tmp_path / "aoe.sqlite")
    assert download_log(log, opener=FakeOpener()) == log.path
    assert log.path.read_bytes() == PAYLOAD


def test_download_log_refuses_a_bundled_log(tmp_path):
    log = _log(tmp_path / "b.json", download_url=None, md5=None, size_bytes=None)
    with pytest.raises(ValueError, match="ships with the repo"):
        download_log(log, opener=FakeOpener())


def test_file_md5_matches_hashlib(tmp_path):
    path = tmp_path / "f.bin"
    path.write_bytes(PAYLOAD)
    assert file_md5(path) == PAYLOAD_MD5
