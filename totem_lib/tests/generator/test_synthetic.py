"""Tests for the set-based synthetic OCEL generator."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.generator import generate_synthetic_ocel, SyntheticLogConfig


def _counts(db):
    return {
        tbl: db.conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
        for tbl in ("events", "objects", "event_object", "object_relations")
    }


class TestVolume:
    def test_event_and_object_counts_match_config(self):
        cfg = SyntheticLogConfig(
            n_types=3, objects_per_type=200, events_per_object=8, seed=1
        )
        with generate_synthetic_ocel(cfg) as db:
            c = _counts(db)
            assert c["events"] == cfg.total_events == 3 * 200 * 8
            assert c["objects"] == 3 * 200
            # every event references its owner; child events may add the parent
            assert c["event_object"] >= c["events"]
            # all child objects have an o2o edge at o2o_pct=100
            assert c["object_relations"] == 2 * 200

    def test_objects_per_type_list(self):
        cfg = SyntheticLogConfig(
            n_types=2, objects_per_type=[100, 300], events_per_object=5, seed=1
        )
        with generate_synthetic_ocel(cfg) as db:
            assert _counts(db)["events"] == (100 + 300) * 5


class TestDeterminism:
    def test_same_seed_same_log(self):
        kw = dict(n_types=3, objects_per_type=100, events_per_object=6, seed=99)
        with generate_synthetic_ocel(**kw) as a, generate_synthetic_ocel(**kw) as b:
            for tbl in ("events", "objects", "event_object", "object_relations"):
                ra = a.conn.execute(f"SELECT * FROM {tbl} ORDER BY ALL").fetchall()
                rb = b.conn.execute(f"SELECT * FROM {tbl} ORDER BY ALL").fetchall()
                assert ra == rb

    def test_different_seed_different_log(self):
        with (
            generate_synthetic_ocel(objects_per_type=100, seed=1) as a,
            generate_synthetic_ocel(objects_per_type=100, seed=2) as b,
        ):
            ra = a.conn.execute("SELECT * FROM events ORDER BY ALL").fetchall()
            rb = b.conn.execute("SELECT * FROM events ORDER BY ALL").fetchall()
            assert ra != rb


class TestIntegrity:
    def test_no_dangling_references(self):
        with generate_synthetic_ocel(objects_per_type=150, seed=3) as db:
            dangling_eo = db.conn.execute("""
                SELECT COUNT(*) FROM event_object eo
                WHERE eo.event_id NOT IN (SELECT event_id FROM events)
                   OR eo.obj_id   NOT IN (SELECT obj_id FROM objects)
            """).fetchone()[0]
            dangling_o2o = db.conn.execute("""
                SELECT COUNT(*) FROM object_relations r
                WHERE r.source_obj_id NOT IN (SELECT obj_id FROM objects)
                   OR r.target_obj_id NOT IN (SELECT obj_id FROM objects)
            """).fetchone()[0]
            assert dangling_eo == 0
            assert dangling_o2o == 0

    def test_types_interact(self):
        """Shared events must connect adjacent types so that discovery
        algorithms see type-level interaction."""
        with generate_synthetic_ocel(
            n_types=3, objects_per_type=150, share_pct=30, seed=4
        ) as db:
            pairs = db.conn.execute("""
                SELECT DISTINCT o1.obj_type, o2.obj_type
                FROM event_object a
                JOIN event_object b ON a.event_id = b.event_id
                JOIN objects o1 ON a.obj_id = o1.obj_id
                JOIN objects o2 ON b.obj_id = o2.obj_id
                WHERE o1.obj_type < o2.obj_type
            """).fetchall()
            assert ("ot0", "ot1") in pairs
            assert ("ot1", "ot2") in pairs


class TestAlgorithmsRun:
    def test_discovery_on_synthetic_log(self):
        from totem_lib.dfg.ocdfg_db import OCDFGDb
        from totem_lib.totem.totem_db import totemDiscovery_db

        with generate_synthetic_ocel(objects_per_type=100, seed=5) as db:
            totem = totemDiscovery_db(db)
            assert totem.tempgraph["nodes"] == {"ot0", "ot1", "ot2"}
            graph = OCDFGDb.from_ocel_db(db)
            assert graph.number_of_nodes() > 0
            assert graph.number_of_edges() > 0
