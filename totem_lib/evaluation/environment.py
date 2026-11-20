"""
Describe the machine and software a benchmark ran on.

Runtimes mean little without the hardware and library versions behind them, and a
results file that does not say which commit it measured cannot be reproduced. The
export writes this next to the numbers.

Everything is best effort: a value that cannot be read is None, never an error.
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys
from datetime import datetime
from importlib import metadata
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent.parent

# Libraries whose version can change the numbers.
PACKAGES = ("totem_lib", "polars", "duckdb", "numpy", "pandas", "networkx", "PuLP", "highspy")


def _run(*command: str) -> str | None:
    try:
        out = subprocess.run(command, capture_output=True, text=True, timeout=5,
                             cwd=_REPO, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None


def cpu_model() -> str | None:
    if sys.platform == "darwin":
        return _run("sysctl", "-n", "machdep.cpu.brand_string")
    if sys.platform.startswith("linux"):
        try:
            for line in Path("/proc/cpuinfo").read_text().splitlines():
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
        except OSError:
            return None
    return platform.processor() or None


def total_ram_gb() -> float | None:
    if sys.platform == "darwin":
        value = _run("sysctl", "-n", "hw.memsize")
        return round(int(value) / 1024**3, 1) if value else None
    if sys.platform.startswith("linux"):
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal:"):
                    return round(int(line.split()[1]) / 1024**2, 1)
        except (OSError, ValueError):
            return None
    return None


def package_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for name in PACKAGES:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def git_state() -> dict[str, object]:
    commit = _run("git", "rev-parse", "HEAD")
    status = _run("git", "status", "--porcelain", "--untracked-files=no")
    return {
        "commit": commit,
        "branch": _run("git", "rev-parse", "--abbrev-ref", "HEAD"),
        # Uncommitted changes to tracked files mean the commit alone does not
        # reproduce the run.
        "dirty": None if commit is None else bool(status),
    }


def collect_environment() -> dict[str, object]:
    """Everything above, as one JSON-ready mapping."""
    return {
        "recorded_at": datetime.now().isoformat(timespec="seconds"),
        "os": platform.platform(),
        "machine": platform.machine(),
        "cpu": cpu_model(),
        "cpu_count": os.cpu_count(),
        "ram_gb": total_ram_gb(),
        "python": platform.python_version(),
        "packages": package_versions(),
        "git": git_state(),
    }


def describe(environment: dict) -> str:
    """One readable line for terminal output and the Markdown summary."""
    git = environment.get("git") or {}
    commit = (git.get("commit") or "unknown")[:10]
    if git.get("dirty"):
        commit += " (uncommitted changes)"
    ram = environment.get("ram_gb")
    return (
        f"{environment.get('cpu') or environment.get('machine') or 'unknown CPU'}, "
        f"{environment.get('cpu_count') or '?'} cores, "
        f"{f'{ram} GB RAM' if ram else 'unknown RAM'}, "
        f"{environment.get('os')}, Python {environment.get('python')}, commit {commit}"
    )
