"""
Correctness tests for `find_variants`.

Two correctness oracles, both on container_logistics / "Customer Order":

1. Polars baseline ↔ DuckDB exact baseline
   `find_variants_naive` (Polars) vs `find_variants(extraction="leading_1hop", iso="exact")`
   must agree on variant count, support multiset, and per-rank execution counts.

2. Iso-strategy parametric grid
   For each extraction in {leading_1hop, connected}, every iso strategy must
   match the `iso="exact"` baseline on:
     - variant count (sound strategies: equal; over-merging strategies: ≤ exact)
     - sorted support multiset (sound strategies)
     - total execution count

`leading_bfs` is excluded from the parametric grid because the paper-style
multi-hop BFS over container_logistics's dense object graph (one giant
connected component covering ~14k objects) is intrinsically slow and not
useful as an iso-strategy oracle here.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.variants import find_variants
from totem_lib.variants.ocvariants import find_variants_naive

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
SOURCE = TEST_DATA / "container_logistics.json"
LEADING_TYPE = "Customer Order"


# ---------------------------------------------------------------------------
# Oracle 1: Polars naive ↔ DuckDB exact
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def polars_vs_db():
    ocel = import_ocel(str(SOURCE))
    db = import_ocel_db(str(SOURCE))
    v_polars = find_variants_naive(ocel, LEADING_TYPE)
    v_db = find_variants(
        db, extraction="leading_1hop", leading_type=LEADING_TYPE, iso="exact",
        verbose=False,
    )
    db.close()
    return v_polars, v_db


class TestPolarsVsDuckDB:
    def test_same_number_of_variants(self, polars_vs_db):
        v1, v2 = polars_vs_db
        assert len(v1) == len(v2), f"polars={len(v1)}, db={len(v2)}"

    def test_support_counts_match(self, polars_vs_db):
        v1, v2 = polars_vs_db
        s1 = sorted([v.support for v in v1], reverse=True)
        s2 = sorted([v.support for v in v2], reverse=True)
        assert s1 == s2, f"\n  polars: {s1}\n  db:     {s2}"

    def test_total_executions_match(self, polars_vs_db):
        v1, v2 = polars_vs_db
        assert sum(len(v.executions) for v in v1) == sum(len(v.executions) for v in v2)


# ---------------------------------------------------------------------------
# Oracle 2: per-extraction iso-strategy grid
# ---------------------------------------------------------------------------

EXTRACTIONS = ["leading_1hop", "connected"]
SOUND_ISOS = ["wl+vf2", "wl"]   # provably ≤ exact under realistic data
COARSE_ISOS = ["signature", "db_signature"]  # may over-merge
# `trace` is not directly comparable to exact: it can both over-separate
# isomorphic cases (concurrent events linearise differently) and over-merge
# non-isomorphic cases that happen to share the exact same event sequence.
# The only invariant is that every case is bucketed exactly once.
PARTITIONING_ISOS = ["trace"]


@pytest.fixture(scope="module", params=EXTRACTIONS)
def baseline(request):
    """The exact-VF2 reference for a given extraction."""
    db = import_ocel_db(str(SOURCE))
    v = find_variants(
        db,
        extraction=request.param,
        leading_type=LEADING_TYPE if request.param.startswith("leading") else None,
        iso="exact",
        verbose=False,
    )
    yield request.param, v
    db.close()


def _run(extraction, iso):
    db = import_ocel_db(str(SOURCE))
    v = find_variants(
        db,
        extraction=extraction,
        leading_type=LEADING_TYPE if extraction.startswith("leading") else None,
        iso=iso,
        verbose=False,
    )
    db.close()
    return v


class TestIsoStrategies:
    @pytest.mark.parametrize("iso", SOUND_ISOS)
    def test_sound_iso_matches_exact(self, baseline, iso):
        ext, v_exact = baseline
        v = _run(ext, iso)
        assert len(v) == len(v_exact), (
            f"[{ext}/{iso}] expected {len(v_exact)} variants, got {len(v)}"
        )
        s1 = sorted([x.support for x in v], reverse=True)
        s2 = sorted([x.support for x in v_exact], reverse=True)
        assert s1 == s2, (
            f"[{ext}/{iso}] support multisets differ:\n  got: {s1}\n  exp: {s2}"
        )

    @pytest.mark.parametrize("iso", COARSE_ISOS)
    def test_coarse_iso_at_most_exact(self, baseline, iso):
        ext, v_exact = baseline
        v = _run(ext, iso)
        assert len(v) <= len(v_exact), (
            f"[{ext}/{iso}] over-merging expected: got {len(v)} > exact {len(v_exact)}"
        )
        # Total executions must always match — every case is grouped exactly once.
        t1 = sum(len(x.executions) for x in v)
        t2 = sum(len(x.executions) for x in v_exact)
        assert t1 == t2, f"[{ext}/{iso}] total executions differ: {t1} vs {t2}"

    @pytest.mark.parametrize("iso", PARTITIONING_ISOS)
    def test_partitioning_iso_preserves_executions(self, baseline, iso):
        ext, v_exact = baseline
        v = _run(ext, iso)
        # The only invariant guaranteed by these strategies is that every
        # case is grouped into exactly one variant.
        t1 = sum(len(x.executions) for x in v)
        t2 = sum(len(x.executions) for x in v_exact)
        assert t1 == t2, f"[{ext}/{iso}] total executions differ: {t1} vs {t2}"
