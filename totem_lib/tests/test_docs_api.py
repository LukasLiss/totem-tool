"""The API reference in docs/api/ must list every public name of totem_lib."""

import re
from pathlib import Path

import totem_lib

API_DIR = Path(__file__).resolve().parents[1] / "docs" / "api"


def names_in_api_reference() -> set[str]:
    """Return the names listed in the autosummary blocks of docs/api/*.rst."""
    names = set()
    for page in API_DIR.glob("*.rst"):
        for line in page.read_text(encoding="utf-8").splitlines():
            # An autosummary entry is an indented name, like "   import_ocel".
            match = re.fullmatch(r" {3}([\w.]+)", line)
            if match:
                # "ocel.OcelDuckDB" counts as "OcelDuckDB".
                names.add(match.group(1).split(".")[-1])
    return names


def test_every_public_name_is_in_the_api_reference():
    missing = sorted(set(totem_lib.__all__) - names_in_api_reference())
    assert not missing, f"Add these names to a page in totem_lib/docs/api/: {missing}"
