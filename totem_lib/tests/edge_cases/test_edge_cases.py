"""
Edge-case corpus tests (Epic #200, Sub-issue #198).

Runs every core miner (dual-path, Polars + DuckDB, where both exist) against every
edge-case log in ``test_data/edge_cases/`` and asserts the expected behavior from the
taxonomy (``docs/EDGE_CASE_TAXONOMY.md``). The default assertion is "the miner does
not raise"; a handful of targeted oracle tests assert specific structural results.

Auto-pickup: the corpus is discovered by globbing the directory, so dropping a new
``<name>.json`` into ``test_data/edge_cases/`` is picked up automatically. If the new
log makes a miner crash, add an entry to the relevant ``XFAIL_*`` map below.

Known crashes are marked ``xfail(strict=True)`` with the exact exception pinned via
``raises=``. ``strict=True`` means that once a miner is hardened the test turns into an
XPASS failure, forcing us to remove the stale entry (and pin `raises` so an *unrelated*
new crash surfaces as a real failure, not a silent xfail). Each entry names a follow-up
to file under Epic #200.
"""

import sys
from contextlib import contextmanager
from pathlib import Path

import polars as pl
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.totem.totem import totemDiscovery
from totem_lib.totem.totem_db import totemDiscovery_db
from totem_lib.dfg.ocdfg import OCDFG
from totem_lib.dfg.ocdfg_db import OCDFGDb, NewOCDFGDb
from totem_lib.ocpn.ocpn import discover_oc_petri_net_polars
from totem_lib.occn.discover import discover_occn
from totem_lib.occn.precision import occn_precision
from totem_lib.variants.ocvariants_db import find_variants as find_variants_db
from totem_lib.variants.ocvariants import find_variants as find_variants_polars

EDGE_CASES_DIR = Path(__file__).parent.parent.parent / "test_data" / "edge_cases"

# Auto-discovered corpus. Sorted for deterministic test ordering/ids.
JSON_FIXTURES = sorted(EDGE_CASES_DIR.glob("*.json"))

# OCCN discovery threshold: 0.0 keeps every dependency (we want maximum behavior
# on tiny logs, not a filtered model).
OCCN_THRESHOLD = 0.0


def _params():
    """pytest.param per fixture, using the filename stem as the test id."""
    return [pytest.param(p, id=p.stem) for p in JSON_FIXTURES]


@contextmanager
def _load_db(path: Path):
    db = import_ocel_db(str(path))
    try:
        yield db
    finally:
        db.close()


def _apply_xfail(request, stem, xmap):
    """If `stem` is a known crasher for this miner, mark the test xfail(strict)."""
    if stem in xmap:
        reason, raises = xmap[stem]
        request.applymarker(pytest.mark.xfail(reason=reason, strict=True, raises=raises))


# ---------------------------------------------------------------------------
# Known-crash maps: fixture stem -> (reason, expected exception type).
# Every entry is a documented bug tracked as a follow-up under Epic #200.
# ---------------------------------------------------------------------------

# The Polars importer cannot load a zero-event log (the timestamp column comes
# out null-typed). This blocks every Polars-path miner for the `empty` fixture.
_EMPTY_POLARS = (
    "import_ocel raises SchemaError on a zero-event log (null-typed timestamp "
    "column); the DuckDB path handles it. Follow-up under Epic #200.",
    pl.exceptions.SchemaError,
)

XFAIL_IMPORT_POLARS = {"empty": _EMPTY_POLARS}
XFAIL_TOTEM_POLARS = {"empty": _EMPTY_POLARS}
XFAIL_OCDFG_POLARS = {"empty": _EMPTY_POLARS}
XFAIL_VARIANTS_POLARS = {"empty": _EMPTY_POLARS}

XFAIL_OCPN_POLARS = {
    "empty": _EMPTY_POLARS,
    "duplicate_event_ids": (
        "pm4py OCPN discovery raises KeyError on duplicate event ids (two events "
        "share id 'e1' with different activities). Follow-up under Epic #200.",
        KeyError,
    ),
}

XFAIL_OCCN = {
    "empty": _EMPTY_POLARS,
    "cyclic": (
        "discover_occn raises TypeError on cyclic control flow (empty marker list). "
        "Follow-up under Epic #200.",
        TypeError,
    ),
    "duplicate_event_ids": (
        "discover_occn raises on duplicate event ids ('Invalid marker groups ... "
        "max() empty'). Follow-up under Epic #200.",
        Exception,
    ),
}
# occn_precision is computed from the discovered OCCN, so it inherits the same
# discovery crashes (the test raises inside discover_occn before precision runs).
XFAIL_OCCN_PRECISION = XFAIL_OCCN

XFAIL_VARIANTS_DB = {
    "unicode_names": (
        "DuckDB find_variants raises UnicodeEncodeError on non-ASCII activity/type "
        "names (en-dash / emoji). Follow-up under Epic #200.",
        UnicodeEncodeError,
    ),
}


# ---------------------------------------------------------------------------
# Corpus sanity
# ---------------------------------------------------------------------------

def test_corpus_is_non_empty():
    """Guard against the glob silently matching nothing (e.g. wrong path)."""
    assert JSON_FIXTURES, f"No edge-case fixtures found under {EDGE_CASES_DIR}"


@pytest.mark.parametrize("json_path", _params())
def test_duckdb_fixture_exists(json_path):
    """Every JSON fixture has a committed, derived .duckdb sibling."""
    assert json_path.with_suffix(".duckdb").exists(), (
        f"Missing {json_path.stem}.duckdb — run tests/edge_cases/generate_edge_cases.py"
    )


# ---------------------------------------------------------------------------
# Import (both paths must load, or fail with the documented exception)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("json_path", _params())
def test_import_polars(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_IMPORT_POLARS)
    import_ocel(str(json_path))


@pytest.mark.parametrize("json_path", _params())
def test_import_duckdb(json_path):
    # DuckDB import is expected to be robust across the whole corpus.
    with _load_db(json_path) as db:
        assert db.query("SELECT COUNT(*) AS c FROM events")["c"][0] >= 0


# ---------------------------------------------------------------------------
# TOTeM (Polars + DuckDB)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("json_path", _params())
def test_totem_polars(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_TOTEM_POLARS)
    totemDiscovery(import_ocel(str(json_path)))


@pytest.mark.parametrize("json_path", _params())
def test_totem_db(json_path):
    with _load_db(json_path) as db:
        totemDiscovery_db(db)


# ---------------------------------------------------------------------------
# OCDFG (Polars + two DuckDB variants)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("json_path", _params())
def test_ocdfg_polars(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_OCDFG_POLARS)
    OCDFG.from_ocel(import_ocel(str(json_path)))


@pytest.mark.parametrize("json_path", _params())
def test_ocdfg_db(json_path):
    with _load_db(json_path) as db:
        OCDFGDb.from_ocel_db(db)


@pytest.mark.parametrize("json_path", _params())
def test_new_ocdfg_db(json_path):
    with _load_db(json_path) as db:
        NewOCDFGDb.from_ocel_db(db)


# ---------------------------------------------------------------------------
# OCPN (Polars only; delegates to pm4py)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("json_path", _params())
def test_ocpn_polars(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_OCPN_POLARS)
    discover_oc_petri_net_polars(import_ocel(str(json_path)))


# ---------------------------------------------------------------------------
# OCCN discovery + precision (Polars only)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("json_path", _params())
def test_occn_discovery(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_OCCN)
    discover_occn(import_ocel(str(json_path)), OCCN_THRESHOLD)


@pytest.mark.parametrize("json_path", _params())
def test_occn_precision(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_OCCN_PRECISION)
    ocel = import_ocel(str(json_path))
    occn = discover_occn(ocel, OCCN_THRESHOLD)
    occn_precision(ocel, occn)


# ---------------------------------------------------------------------------
# Variants (Polars + DuckDB)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("json_path", _params())
def test_variants_polars(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_VARIANTS_POLARS)
    ocel = import_ocel(str(json_path))
    types = list(ocel.object_types)
    if not types:
        pytest.skip("log has no object types — nothing to lead a variant")
    find_variants_polars(ocel, types[0])


@pytest.mark.parametrize("json_path", _params())
def test_variants_db(json_path, request):
    _apply_xfail(request, json_path.stem, XFAIL_VARIANTS_DB)
    with _load_db(json_path) as db:
        # "connected" extraction needs no leading type, so it works uniformly
        # across the corpus (including the empty log -> zero variants).
        find_variants_db(db, extraction="connected")


# ---------------------------------------------------------------------------
# Targeted oracles: specific expected results for specific edge cases.
# ---------------------------------------------------------------------------

def test_empty_log_yields_empty_totem():
    """The empty log produces an empty TOTeM (no nodes) via the DuckDB path."""
    with _load_db(EDGE_CASES_DIR / "empty.json") as db:
        assert db.query("SELECT COUNT(*) AS c FROM events")["c"][0] == 0
        assert db.query("SELECT COUNT(*) AS c FROM objects")["c"][0] == 0
        totem = totemDiscovery_db(db)
        assert totem.tempgraph["nodes"] == set()


def test_dead_object_dropped_by_polars_import():
    """The dead object (referenced by no event) is filtered out on Polars import."""
    ocel = import_ocel(str(EDGE_CASES_DIR / "dead_object.json"))
    assert "o_dead" not in ocel.objects["_objId"].to_list()


def test_duplicate_event_ids_deduped_by_duckdb_import():
    """graceful_import drops the second event that reuses an existing id."""
    with _load_db(EDGE_CASES_DIR / "duplicate_event_ids.json") as db:
        assert db.query("SELECT COUNT(*) AS c FROM events")["c"][0] == 1
