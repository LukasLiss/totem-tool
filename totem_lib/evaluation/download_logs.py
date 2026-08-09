"""
Download the large evaluation logs that are too big to keep in git.

Small logs ship with the repo; anything in `test_data/large/` is gitignored and has to be
fetched. Files are verified against the size and MD5 published by the source repository,
and a download is only moved into place once it has been verified in full, so an
interrupted transfer can never leave behind a file that looks valid.

Run from the totem_lib/ directory:
    python evaluation/download_logs.py --list
    python evaluation/download_logs.py
    python evaluation/download_logs.py --logs age-of-empires
    python evaluation/download_logs.py --logs age-of-empires --force

If a download fails, each log's source URL points at its record page, from where the file
can be placed into `test_data/large/` by hand.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import urllib.request
from pathlib import Path
from typing import Callable, Iterable, Sequence

# Run either as a script or imported as `evaluation.download_logs`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evaluation.datasets import LOGS, EvaluationLog, downloadable_logs, get_log

DEFAULT_CHUNK_BYTES = 1 << 20
# Zenodo rejects the default Python-urllib user agent.
USER_AGENT = "totem-tool-evaluation/1.0"

ProgressFn = Callable[[int, int | None], None]


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

def plan_downloads(
    logs: Sequence[EvaluationLog] = LOGS,
    names: Iterable[str] | None = None,
    *,
    force: bool = False,
) -> tuple[list[EvaluationLog], list[EvaluationLog]]:
    """
    Split the requested logs into (to_fetch, skipped).

    Pure: decides what would happen without touching the network. `names` selects a
    subset by name; None means every downloadable log.
    """
    if names is None:
        requested = downloadable_logs(logs)
    else:
        requested = [get_log(name, logs) for name in names]

    to_fetch, skipped = [], []
    for log in requested:
        if log.bundled or (log.available and not force):
            skipped.append(log)
        else:
            to_fetch.append(log)
    return to_fetch, skipped


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

def file_md5(path: Path, chunk_bytes: int = DEFAULT_CHUNK_BYTES) -> str:
    """MD5 of a file, read in chunks so large logs do not land in memory."""
    digest = hashlib.md5()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_bytes), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(
    url: str,
    dest: Path,
    *,
    expected_md5: str | None = None,
    expected_size: int | None = None,
    opener: Callable = urllib.request.urlopen,
    chunk_bytes: int = DEFAULT_CHUNK_BYTES,
    on_progress: ProgressFn | None = None,
) -> Path:
    """
    Stream `url` into `dest`, verifying it before putting it in place.

    Downloads to a sibling `.part` file and hashes while writing, then checks size and
    MD5 and only then renames into place. Any failure removes the partial file and
    raises, so `dest` either does not exist or is a fully verified download.

    `opener` is injectable so tests never touch the network.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    digest = hashlib.md5()
    downloaded = 0

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener(request) as response, open(part, "wb") as handle:
            while chunk := response.read(chunk_bytes):
                handle.write(chunk)
                digest.update(chunk)
                downloaded += len(chunk)
                if on_progress is not None:
                    on_progress(downloaded, expected_size)

        if expected_size is not None and downloaded != expected_size:
            raise OSError(
                f"size mismatch for {dest.name}: expected {expected_size} bytes, got {downloaded}"
            )
        actual_md5 = digest.hexdigest()
        if expected_md5 is not None and actual_md5 != expected_md5:
            raise OSError(
                f"checksum mismatch for {dest.name}: expected {expected_md5}, got {actual_md5}"
            )
    except BaseException:
        part.unlink(missing_ok=True)
        raise

    os.replace(part, dest)
    return dest


def download_log(
    log: EvaluationLog,
    *,
    opener: Callable = urllib.request.urlopen,
    on_progress: ProgressFn | None = None,
) -> Path:
    """Fetch one log into the location the manifest specifies."""
    if log.bundled:
        raise ValueError(f"{log.name} ships with the repo and is not downloadable")
    return fetch(
        log.download_url,
        log.path,
        expected_md5=log.md5,
        expected_size=log.size_bytes,
        opener=opener,
        on_progress=on_progress,
    )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def _mb(num_bytes: int | None) -> str:
    return "?" if num_bytes is None else f"{num_bytes / 1024 / 1024:.1f} MB"


def _print_progress(done: int, total: int | None) -> None:
    if total:
        print(f"\r    {done / total:6.1%}  {_mb(done)} / {_mb(total)}", end="", flush=True)
    else:
        print(f"\r    {_mb(done)}", end="", flush=True)


def print_manifest(logs: Sequence[EvaluationLog] = LOGS) -> None:
    """Show every log, where it belongs and whether it is present."""
    for log in logs:
        status = "present" if log.available else ("in git" if log.bundled else "MISSING")
        events = "?" if log.event_count is None else f"{log.event_count:,}"
        print(f"\n{log.name}  [{status}]")
        print(f"  events:   {events}")
        print(f"  path:     {log.path}")
        print(f"  source:   {log.source_url}")
        if not log.bundled:
            print(f"  download: {_mb(log.size_bytes)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--logs", type=_csv, default=None,
                        help="comma-separated log names (default: all downloadable logs)")
    parser.add_argument("--force", action="store_true",
                        help="re-download even if the file is already present")
    parser.add_argument("--list", action="store_true",
                        help="show the manifest and exit without downloading")
    args = parser.parse_args()

    if args.list:
        print_manifest()
        return

    try:
        to_fetch, skipped = plan_downloads(LOGS, args.logs, force=args.force)
    except ValueError as exc:
        raise SystemExit(str(exc))

    for log in skipped:
        reason = "ships with the repo" if log.bundled else "already downloaded"
        print(f"{log.name}: skipped, {reason}")

    if not to_fetch:
        print("Nothing to download.")
        return

    failed: list[str] = []
    for log in to_fetch:
        print(f"\n{log.name}: downloading {_mb(log.size_bytes)} -> {log.path}")
        try:
            download_log(log, on_progress=_print_progress)
            print(f"\n  verified and saved to {log.path}")
        except Exception as exc:
            print(f"\n  FAILED: {type(exc).__name__}: {exc}")
            print(f"  download manually from {log.source_url}")
            print(f"  and place {log.path.name} in {log.path.parent}")
            failed.append(log.name)

    if failed:
        raise SystemExit(f"\n{len(failed)} download(s) failed: {', '.join(failed)}")
    print(f"\nDownloaded {len(to_fetch)} log(s).")


if __name__ == "__main__":
    main()
