"""
The organizational mining algorithms must give identical results whether
they read a polars ``ObjectCentricEventLog`` or the relational ``OcelDuckDB``
the backend serves every request from.

Each test builds both representations from the same file and compares the
graphs / matrices produced by ``from_ocel`` and ``from_ocel_db``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import polars as pl
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel import OcelDuckDB, import_ocel_db  # noqa: E402
from totem_lib.ocel.importer import import_ocel  # noqa: E402
from totem_lib.ochandover import OCHANDOVER, EventObjectSource, ProfileMatrix  # noqa: E402

LIB_ROOT = Path(__file__).parent.parent.parent
RUNNING_EXAMPLE = LIB_ROOT / "src" / "totem_lib" / "ochandover" / "runningexample.json"
CONTAINER_LOGISTICS = LIB_ROOT / "test_data" / "small" / "container_logistics.json"


# ---------------------------------------------------------------------------
# Fixtures: one polars OCEL and one DuckDB built from the very same rows
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def running_example():
    ocel = import_ocel(str(RUNNING_EXAMPLE))
    db = OcelDuckDB(ocel)
    yield ocel, db
    db.close()


@pytest.fixture(scope="module")
def container_logistics():
    ocel = import_ocel(str(CONTAINER_LOGISTICS))
    # The streaming importer is what the backend uses for uploaded files.
    db = import_ocel_db(str(CONTAINER_LOGISTICS))
    yield ocel, db
    db.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _graph_signature(graph: OCHANDOVER) -> tuple[dict, dict]:
    nodes = {n: (d.get("object_type"), d.get("event_count")) for n, d in graph.nodes(data=True)}
    edges = {}
    for u, v, key, d in graph.edges(keys=True, data=True):
        edges[(u, v, key)] = (
            d.get("raw_weight"),
            round(d.get("weight", 0.0), 9),
            d.get("avg_time"),
            d.get("min_time"),
            d.get("max_time"),
        )
    return nodes, edges


def _assert_same_graph(a: OCHANDOVER, b: OCHANDOVER) -> None:
    nodes_a, edges_a = _graph_signature(a)
    nodes_b, edges_b = _graph_signature(b)
    assert nodes_a == nodes_b
    assert edges_a == edges_b


def _sorted_flows(graph: OCHANDOVER) -> list[tuple]:
    flows = (graph.graph.get("animation_flows") or {}).get("flows", [])
    return sorted(
        (f["source"], f["target"], f["bo_type"], tuple(sorted(f["bo_ids"])), f["start_time"], f["duration"])
        for f in flows
    )


def _sorted_bindings(graph: OCHANDOVER) -> list[tuple]:
    out = []
    for b in graph.graph.get("bindings", []):
        arcs = tuple(sorted((a["other_resource"], a["bo_type"], a["mark"], a["is_gapped"]) for a in b["arcs"]))
        out.append((b["type"], b["resource"], arcs, b["line_type"], b["count"]))
    return sorted(out)


# ---------------------------------------------------------------------------
# EventObjectSource
# ---------------------------------------------------------------------------

def test_source_reads_same_rows_from_both_representations(running_example):
    ocel, db = running_example
    types = ["employee", "item"]
    src_pl = EventObjectSource.from_ocel(ocel, types)
    src_db = EventObjectSource.from_ocel_db(db, types)

    assert src_pl.object_type_by_id == src_db.object_type_by_id
    assert src_pl.all_object_types == src_db.all_object_types == ["employee", "item", "machine", "package"]
    assert set(src_pl.object_type_by_id.values()) == set(types)

    order = ["_eventId", "_objId"]
    left = src_pl.event_objects.sort(order)
    right = src_db.event_objects.sort(order)
    assert left.schema == right.schema
    assert left.equals(right)
    # Every row belongs to one of the requested types — nothing else was read.
    assert set(right["_objId"].unique().to_list()) <= set(src_db.object_type_by_id)


def test_source_with_no_types_is_empty(running_example):
    _, db = running_example
    src = EventObjectSource.from_ocel_db(db, [])
    assert src.event_objects.is_empty()
    assert src.object_type_by_id == {}
    assert src.all_object_types == ["employee", "item", "machine", "package"]


def test_source_honours_a_filter_shadow(running_example):
    """A backend filter shadows ``objects``/``event_object``/``events`` with
    TEMP tables in front of ``main``; the DuckDB path must read those."""
    _, db = running_example
    conn = db.conn
    try:
        conn.execute("CREATE OR REPLACE TEMP TABLE objects AS SELECT * FROM main.objects WHERE obj_type <> 'machine'")
        conn.execute("CREATE OR REPLACE TEMP TABLE event_object AS SELECT eo.* FROM main.event_object eo WHERE eo.obj_id IN (SELECT obj_id FROM objects)")
        conn.execute("CREATE OR REPLACE TEMP TABLE events AS SELECT e.* FROM main.events e WHERE e.event_id IN (SELECT event_id FROM event_object)")
        src = EventObjectSource.from_ocel_db(db, ["employee", "machine"])
        assert "machine" not in set(src.object_type_by_id.values())
        assert "machine" not in src.all_object_types
        graph = OCHANDOVER.from_ocel_db(db, ["employee", "machine"], ["item", "package"])
        assert all(d["object_type"] == "employee" for _, d in graph.nodes(data=True))
    finally:
        for tbl in ("objects", "event_object", "events"):
            conn.execute(f"DROP TABLE IF EXISTS {tbl}")

    # And once the shadow is gone the full log is visible again.
    src = EventObjectSource.from_ocel_db(db, ["employee", "machine"])
    assert "machine" in set(src.object_type_by_id.values())


# ---------------------------------------------------------------------------
# Handover of work
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "kwargs",
    [
        {},
        {"max_gap": 0},
        {"normalization": "by_source"},
        {"normalization": "by_target", "normalization_scope": "per_bo_type"},
        {"normalization": "by_total_weight", "normalization_scope": "per_bo_type"},
        {"parallel_threshold": 0.5, "min_parallel_observations": 1},
        {"cluster_by_ot": True},
        {"cluster_map": {"Mike": "Cluster 1", "Anna": "Cluster 1"}},
    ],
    ids=["default", "max_gap_0", "by_source", "by_target_per_bo", "by_total_per_bo", "parallel", "cluster_by_ot", "cluster_map"],
)
def test_handover_parity_running_example(running_example, kwargs):
    ocel, db = running_example
    resources, business = ["employee", "machine"], ["item", "package"]
    g_pl = OCHANDOVER.from_ocel(ocel, resources, business, **kwargs)
    g_db = OCHANDOVER.from_ocel_db(db, resources, business, **kwargs)
    assert g_db.number_of_edges() > 0
    _assert_same_graph(g_pl, g_db)


def test_handover_flows_and_bindings_parity(running_example):
    ocel, db = running_example
    resources, business = ["employee", "machine"], ["item", "package"]
    g_pl = OCHANDOVER.from_ocel(ocel, resources, business, include_flows=True, include_bindings=True)
    g_db = OCHANDOVER.from_ocel_db(db, resources, business, include_flows=True, include_bindings=True)
    _assert_same_graph(g_pl, g_db)
    assert _sorted_flows(g_pl) == _sorted_flows(g_db)
    assert g_pl.graph["animation_flows"]["timeline"] == g_db.graph["animation_flows"]["timeline"]
    assert _sorted_bindings(g_pl) == _sorted_bindings(g_db)
    assert len(g_db.graph["bindings"]) > 0


def test_handover_db_graph_has_expected_shape(running_example):
    _, db = running_example
    graph = OCHANDOVER.from_ocel_db(db, ["employee", "machine"], ["item", "package"])
    node_types = {d["object_type"] for _, d in graph.nodes(data=True)}
    assert node_types <= {"employee", "machine"}
    edge_types = {d["businessobject_type"] for _, _, d in graph.edges(data=True)}
    assert edge_types <= {"item", "package"}
    for _, _, d in graph.edges(data=True):
        assert d["raw_weight"] >= 1
        assert 0.0 < d["weight"] <= 1.0


def test_flattened_parity(running_example):
    ocel, db = running_example
    for max_gap in (None, 0, 2):
        g_pl = OCHANDOVER.from_ocel_flattened(ocel, "item", "employee", max_gap=max_gap)
        g_db = OCHANDOVER.from_ocel_db_flattened(db, "item", "employee", max_gap=max_gap)
        _assert_same_graph(g_pl, g_db)


def test_footprint_parity(running_example):
    ocel, db = running_example
    fp_pl = OCHANDOVER.compute_footprint(ocel, ["item", "package"])
    fp_db = OCHANDOVER.compute_footprint_db(db, ["item", "package"])
    order = ["businessobject_type", "activity_a", "activity_b"]
    assert fp_pl.sort(order).equals(fp_db.sort(order))
    assert fp_db.height > 0


def test_handover_parity_container_logistics(container_logistics):
    """A realistic log, imported by the streaming importer the backend uses."""
    ocel, db = container_logistics
    resources, business = ["Forklift", "Truck"], ["Container", "Vehicle"]
    g_pl = OCHANDOVER.from_ocel(ocel, resources, business, max_gap=3)
    g_db = OCHANDOVER.from_ocel_db(db, resources, business, max_gap=3)
    assert g_db.number_of_edges() > 0
    _assert_same_graph(g_pl, g_db)


# ---------------------------------------------------------------------------
# Resource profiling
# ---------------------------------------------------------------------------

ALL_GROUPS = [
    "activity_fractions",
    "cooccurrence_fractions",
    "object_collaboration_fractions",
    "object_portfolio_fractions",
    "time_fractions",
    "weekday_fractions",
]


def _assert_same_profile_matrix(a: ProfileMatrix, b: ProfileMatrix) -> None:
    assert a.resources == b.resources
    assert a.resource_object_types == b.resource_object_types
    assert a.activities == b.activities
    assert a.cooccurring_resources == b.cooccurring_resources
    assert a.collaborating_resources == b.collaborating_resources
    assert a.time_bins == b.time_bins
    assert a.weekday_bins == b.weekday_bins
    assert a.portfolio_object_types == b.portfolio_object_types
    assert a.feature_groups == b.feature_groups
    np.testing.assert_allclose(a.to_numpy(), b.to_numpy(), rtol=0, atol=1e-12)


@pytest.mark.parametrize(
    "kwargs",
    [
        {},
        {"resource_types": ["employee"]},
        {"resource_types": ["employee", "machine"], "feature_groups": ALL_GROUPS},
        {"resource_types": ["employee"], "feature_groups": ["object_collaboration_fractions"], "business_object_types": ["item"]},
        {"resource_types": ["employee"], "feature_groups": ["activity_fractions", "object_portfolio_fractions"],
         "tooltip_only_groups": ["object_portfolio_fractions"]},
    ],
    ids=["defaults", "single_type", "all_groups", "explicit_business_objects", "tooltip_only"],
)
def test_profile_matrix_parity(running_example, kwargs):
    ocel, db = running_example
    pm_pl = ProfileMatrix.from_ocel(ocel, **kwargs)
    pm_db = ProfileMatrix.from_ocel_db(db, **kwargs)
    assert len(pm_db.resources) > 0
    _assert_same_profile_matrix(pm_pl, pm_db)


def test_profile_matrix_to_dict_parity(running_example):
    ocel, db = running_example
    kwargs = dict(resource_types=["employee", "machine"], feature_groups=["activity_fractions", "time_fractions"])
    d_pl = ProfileMatrix.from_ocel(ocel, **kwargs).to_dict(
        width=400, height=300, n_clusters=2, cluster_method="kmeans", distance_metric="hellinger",
    )
    d_db = ProfileMatrix.from_ocel_db(db, **kwargs).to_dict(
        width=400, height=300, n_clusters=2, cluster_method="kmeans", distance_metric="hellinger",
    )
    assert d_pl["resources"] == d_db["resources"]
    assert d_pl["activities"] == d_db["activities"]
    np.testing.assert_allclose(np.array(d_pl["values"]), np.array(d_db["values"]), atol=1e-12)
    assert d_db["n_clusters"] == 2
    assert len(d_db["mds_positions"]) == len(d_db["resources"])


def test_profile_matrix_only_reads_needed_types(running_example):
    """Without a business-object feature group, only the resource types are
    loaded — the source must not carry the whole log."""
    _, db = running_example
    pm = ProfileMatrix.from_ocel_db(db, resource_types=["employee"], feature_groups=["activity_fractions"])
    assert set(pm.resource_object_types.values()) == {"employee"}
    assert pm.portfolio_object_types == []
    assert pm.collaborating_resources == []
