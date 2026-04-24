"""
Correctness tests: OCDFG.from_ocel() (Polars) vs OCDFGDb.from_ocel_db() (DuckDB).

Both algorithms are given the same source file so that activity names, object
types, and event orderings are identical going into both implementations.

Known limitation
---------------
The DuckDB event_object table has PRIMARY KEY (event_id, obj_id), which means
that when an event relates to the same object more than once (e.g. with two
different qualifiers, as in order-management.json where an employee can be both
"forwarder" and "shipper" of the same package), only one row is kept.  The
Polars path keeps all occurrences after explode("_objects"), so edge weights
can differ slightly for such datasets.

Weight and owner tests are therefore parameterised on WEIGHT_DATASETS (only
datasets where each object appears at most once per event), while structural
tests (node/edge set, roles, types) use the full DATASETS list.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.dfg.ocdfg import OCDFG
from totem_lib.dfg.ocdfg_db import OCDFGDb
from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"

# Full structural tests (node/edge sets, roles, object_types)
DATASETS = [
    pytest.param(TEST_DATA / "order-management.json", id="order-management"),
    pytest.param(TEST_DATA / "container_logistics.json", id="container_logistics"),
]

# Datasets without multi-qualifier (event, object) duplicates — weights will match exactly
WEIGHT_DATASETS = [
    pytest.param(TEST_DATA / "container_logistics.json", id="container_logistics"),
]


@pytest.fixture(scope="module", params=DATASETS)
def both_ocdfgs(request):
    source: Path = request.param
    ocel = import_ocel(str(source))
    db = import_ocel_db(str(source))
    g_polars = OCDFG.from_ocel(ocel)
    g_db = OCDFGDb.from_ocel_db(db)
    db.close()
    return g_polars, g_db


@pytest.fixture(scope="module", params=WEIGHT_DATASETS)
def both_ocdfgs_weight(request):
    source: Path = request.param
    ocel = import_ocel(str(source))
    db = import_ocel_db(str(source))
    g_polars = OCDFG.from_ocel(ocel)
    g_db = OCDFGDb.from_ocel_db(db)
    db.close()
    return g_polars, g_db


class TestNodes:
    def test_node_set(self, both_ocdfgs):
        g1, g2 = both_ocdfgs
        assert set(g1.nodes()) == set(g2.nodes())

    def test_node_labels(self, both_ocdfgs):
        g1, g2 = both_ocdfgs
        for node in g1.nodes():
            assert g1.nodes[node].get("label") == g2.nodes[node].get("label"), (
                f"label mismatch for node {node!r}"
            )

    def test_node_types(self, both_ocdfgs):
        g1, g2 = both_ocdfgs
        for node in g1.nodes():
            assert g1.nodes[node].get("types") == g2.nodes[node].get("types"), (
                f"types mismatch for node {node!r}: "
                f"polars={g1.nodes[node].get('types')}, db={g2.nodes[node].get('types')}"
            )

    def test_node_role(self, both_ocdfgs):
        g1, g2 = both_ocdfgs
        for node in g1.nodes():
            assert g1.nodes[node].get("role") == g2.nodes[node].get("role"), (
                f"role mismatch for node {node!r}"
            )

    def test_node_object_type(self, both_ocdfgs):
        g1, g2 = both_ocdfgs
        for node in g1.nodes():
            assert g1.nodes[node].get("object_type") == g2.nodes[node].get("object_type"), (
                f"object_type mismatch for node {node!r}"
            )


class TestEdges:
    def test_edge_set(self, both_ocdfgs):
        g1, g2 = both_ocdfgs
        assert set(g1.edges()) == set(g2.edges())

    def test_edge_role(self, both_ocdfgs):
        g1, g2 = both_ocdfgs
        for u, v in g1.edges():
            r1 = g1.edges[u, v].get("role")
            r2 = g2.edges[u, v].get("role")
            assert r1 == r2, f"role mismatch for edge ({u!r}, {v!r}): polars={r1}, db={r2}"

    # Weight/owner tests use the restricted fixture (no multi-qualifier datasets)
    # to avoid the known schema deduplication difference — see module docstring.
    def test_edge_weights(self, both_ocdfgs_weight):
        g1, g2 = both_ocdfgs_weight
        for u, v in g1.edges():
            w1 = g1.edges[u, v].get("weight")
            w2 = g2.edges[u, v].get("weight")
            assert w1 == w2, f"weight mismatch for edge ({u!r}, {v!r}): polars={w1}, db={w2}"

    def test_edge_weights_per_type(self, both_ocdfgs_weight):
        g1, g2 = both_ocdfgs_weight
        for u, v in g1.edges():
            wt1 = g1.edges[u, v].get("weights")
            wt2 = g2.edges[u, v].get("weights")
            assert wt1 == wt2, (
                f"weights dict mismatch for edge ({u!r}, {v!r}): polars={wt1}, db={wt2}"
            )

    def test_edge_owners(self, both_ocdfgs_weight):
        g1, g2 = both_ocdfgs_weight
        for u, v in g1.edges():
            o1 = g1.edges[u, v].get("owners")
            o2 = g2.edges[u, v].get("owners")
            assert o1 == o2, (
                f"owners mismatch for edge ({u!r}, {v!r}): polars={o1}, db={o2}"
            )
