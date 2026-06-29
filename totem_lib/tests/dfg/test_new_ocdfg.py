import sys
from pathlib import Path
import pytest
import networkx as nx

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.dfg.ocdfg_db import NewOCDFGDb, OCDFGDb
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
DATASET = TEST_DATA / "container_logistics.json"


def test_new_ocdfg_multigraph_properties():
    db = import_ocel_db(str(DATASET))
    try:
        # Build both old and new graphs to compare structure
        g_old = OCDFGDb.from_ocel_db(db)
        g_new = NewOCDFGDb.from_ocel_db(db)

        # Verify graph type
        assert isinstance(g_new, nx.MultiDiGraph)
        assert g_new.graph.get("kind") == "new_ocdfg"

        # Verify node set is identical
        assert set(g_old.nodes()) == set(g_new.nodes())

        # Verify node types, labels, roles are correct
        for node in g_new.nodes():
            old_types = g_old.nodes[node].get("types")
            new_types = g_new.nodes[node].get("types")
            assert old_types == new_types
            assert g_old.nodes[node].get("label") == g_new.nodes[node].get("label")
            assert g_old.nodes[node].get("role") == g_new.nodes[node].get("role")

        # Verify that for each edge in the old graph, there are corresponding edges in the new graph
        # with separate parallel edges for each object type (owner)
        for u, v in g_old.edges():
            old_edge_data = g_old.edges[u, v]
            old_owners = old_edge_data.get("owners", [])
            old_weights = old_edge_data.get("weights", {})

            # For each owner (object type), there must be a corresponding key in the multigraph
            for otype in old_owners:
                assert g_new.has_edge(u, v, key=otype)
                new_edge_data = g_new.edges[u, v, otype]
                assert new_edge_data.get("objtype") == otype
                assert new_edge_data.get("weight") == old_weights.get(otype)
                if old_edge_data.get("role"):
                    assert new_edge_data.get("role") == old_edge_data.get("role")

    finally:
        db.close()
