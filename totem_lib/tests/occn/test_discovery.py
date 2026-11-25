from pathlib import Path

from totem_lib import import_ocel, discover_occn
from totem_lib.ocel import schema_base_filtering, propagate_filtering
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
EXAMPLE_DATA = Path(__file__).parent.parent.parent / "example_data"


def test_ocfhm():
    # import ocel
    ocel = import_ocel(str(EXAMPLE_DATA / "ContainerLogistics.json"))
    # discover occn
    occn = discover_occn(ocel, relativeOccuranceThreshold=0)
    print(occn)


def test_discover_occn_db():
    """discover_occn accepts an OcelDuckDB and returns a valid OCCausalNet."""
    ocel_db = import_ocel_db(str(TEST_DATA / "container_logistics.duckdb"))
    occn = discover_occn(ocel_db, relativeOccuranceThreshold=0)
    assert len(occn.activities) > 0
    assert len(occn.object_types) > 0


def test_discover_occn_db_matches_polars():
    """DuckDB path yields an OCCausalNet equal to the Polars path on the same log.

    Both paths start from the same ObjectCentricEventLog so the underlying data
    is identical — the only difference is which OCEL type discover_occn receives.
    """
    from totem_lib.ocel.importer import import_ocel
    from totem_lib.ocel.ocel_duckdb import OcelDuckDB

    ocel_polars = import_ocel(str(TEST_DATA / "container_logistics.json"))
    ocel_db = OcelDuckDB(ocel_polars)

    occn_polars = discover_occn(ocel_polars, relativeOccuranceThreshold=0)
    occn_db = discover_occn(ocel_db, relativeOccuranceThreshold=0)

    assert occn_db == occn_polars

def _resource_log_duckdb(tmp_path):
    """order/worker log where `worker` attends only two activities per order.

    Restricted to the `worker` type alone, the flattened case is a strict
    alternation `confirm ship confirm ship confirm ship`. Neither direction
    clears the plain dependency threshold ((3-2)/(3+2+1) = 0.17), so the
    Heuristics Miner admits no arc at all — which used to leave both activities isolated and
    produce a binding with zero obligations, handed to
    `OCCausalNet.MarkerGroup` and rejected as an empty marker list.

    Since #296 that alternation is recognised as a length-2 loop, so the pair
    is discovered as a cycle instead. Kept as the regression fixture for both
    guards: no empty `MarkerGroup` is ever constructed, and the loop arcs are
    restored rather than dropped.
    """
    import duckdb
    from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema

    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    events, objects, rels = [], [("w1", "worker")], []
    t = 0
    for oi in range(3):
        o = f"o{oi}"
        objects.append((o, "order"))
        for act in ["place", "confirm", "pay", "ship"]:
            t += 1
            e = f"e{oi}_{act}"
            events.append((e, act, t))
            rels.append((e, o))
            if act in ("confirm", "ship"):
                rels.append((e, "w1"))
    conn.executemany("INSERT INTO events VALUES (?, ?, ?)", events)
    conn.executemany("INSERT INTO objects VALUES (?, ?)", objects)
    conn.executemany("INSERT INTO event_object VALUES (?, ?, NULL)", rels)
    return OcelDuckDB._from_prepared_connection(conn, [], [])


def test_discover_occn_with_alternating_resource(tmp_path):
    """A resource alternating between two activities must not abort discovery.

    Regression: restricting discovery to a type whose activities are isolated
    in the dependency graph raised
    `TypeError: markers must be a non-empty list of OCCausalNet.Marker`.

    Two guards keep that from happening. A binding with no obligations is
    dropped rather than turned into an empty `MarkerGroup` (the invariant
    asserted below, which holds for every log). And for this particular log the
    isolation was itself an artefact: `confirm`/`ship` strictly alternate, so
    since #296 they are discovered as a length-2 loop rather than left
    unconnected. See `test_discover_occn_obligation_free_groups_are_dropped`
    for the empty-group path on a log that stays isolated.
    """
    ocel_db = _resource_log_duckdb(tmp_path)

    occn = discover_occn(
        ocel_db, relativeOccuranceThreshold=0.0, parameters={"object_types": ["worker"]}
    )

    assert "confirm" in occn.activities
    assert "ship" in occn.activities
    # No marker group may ever be empty — this is the original crash guard.
    for groups in (*occn.input_marker_groups.values(), *occn.output_marker_groups.values()):
        for group in groups:
            assert len(group.markers) > 0

    # The alternation is discovered as a cycle: START -> confirm <-> ship -> END.
    def _related(groups):
        return {m.related_activity for g in groups for m in g.markers}

    assert _related(occn.output_marker_groups["confirm"]) == {"ship"}
    assert _related(occn.input_marker_groups["ship"]) == {"confirm"}
    assert _related(occn.input_marker_groups["confirm"]) == {"ship", "START_worker"}
    assert _related(occn.output_marker_groups["ship"]) == {"confirm", "END_worker"}


def test_discover_occn_obligation_free_groups_are_dropped(tmp_path):
    """A binding with no obligations is dropped, not turned into a MarkerGroup.

    Exercises the guard on its own by disabling length-2 loop detection, which
    is what would otherwise connect this particular log: a loop value is
    n / (n + 1), so a threshold of 1 is never reached. Without the loop the
    worker's activities stay isolated in the dependency graph, which is the
    shape that used to raise
    `TypeError: markers must be a non-empty list of OCCausalNet.Marker`.
    """
    ocel_db = _resource_log_duckdb(tmp_path)
    occn = discover_occn(
        ocel_db,
        relativeOccuranceThreshold=0.0,
        parameters={"object_types": ["worker"], "loop_two_threshold": 1.0},
    )

    assert "confirm" in occn.activities
    assert "ship" in occn.activities
    for groups in (*occn.input_marker_groups.values(), *occn.output_marker_groups.values()):
        for group in groups:
            assert len(group.markers) > 0
    # "No obligations" is represented as an empty list of groups.
    assert occn.output_marker_groups["confirm"] == []
    assert occn.input_marker_groups["ship"] == []


def test_discover_occn_unrestricted_still_binds_obligations(tmp_path):
    """The empty-binding guard must not strip real obligations."""
    ocel_db = _resource_log_duckdb(tmp_path)
    occn = discover_occn(ocel_db, relativeOccuranceThreshold=0.0)
    assert any(occn.output_marker_groups.get(act) for act in occn.activities)
    assert any(occn.input_marker_groups.get(act) for act in occn.activities)


# ---------------------------------------------------------------------------
# extract_occn_input
# ---------------------------------------------------------------------------

EDGE_CASES = Path(__file__).parent.parent.parent / "test_data" / "edge_cases"


def _sorted(df):
    return df.sort_values(list(df.columns), ignore_index=True)


def test_extract_occn_input_duckdb_matches_polars():
    """Both log backends yield the same tables (row order aside: DuckDB does
    not guarantee one, the miner orders by timestamp itself)."""
    import pandas as pd
    from totem_lib import extract_occn_input

    path = str(TEST_DATA / "resource_aware_orders.json")
    from_polars = extract_occn_input(import_ocel(path))
    ocel_db = import_ocel_db(path)
    from_db = extract_occn_input(ocel_db)
    ocel_db.close()

    for name in ("event_log", "event_log_for_miner"):
        pd.testing.assert_frame_equal(
            _sorted(getattr(from_polars, name)), _sorted(getattr(from_db, name))
        )
    relations = from_db.event_log_for_miner
    assert list(relations.columns) == [
        "event_activity", "event_timestamp", "object", "object_type", "event_id",
    ]
    assert relations["event_timestamp"].is_monotonic_increasing


def test_extract_occn_input_leaves_out_dead_objects_and_objectless_events():
    from totem_lib import extract_occn_input

    for load in (import_ocel, import_ocel_db):
        dead = extract_occn_input(load(str(EDGE_CASES / "dead_object.json")))
        assert set(dead.event_log_for_miner["object"]) == {"o1"}

        objectless = extract_occn_input(load(str(EDGE_CASES / "event_no_objects.json")))
        assert set(objectless.event_log_for_miner["event_id"]) == {"e1"}


def test_discover_occn_accepts_extracted_input():
    from totem_lib import extract_occn_input

    ocel_db = import_ocel_db(str(TEST_DATA / "resource_aware_orders.json"))
    occn_from_input = discover_occn(extract_occn_input(ocel_db), relativeOccuranceThreshold=0)
    occn_from_db = discover_occn(ocel_db, relativeOccuranceThreshold=0)
    ocel_db.close()
    assert occn_from_input == occn_from_db
