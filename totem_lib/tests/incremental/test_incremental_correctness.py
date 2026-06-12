"""
Incremental maintenance must be indistinguishable from full recomputation.

A source log is replayed as a base batch plus append batches; after the
replay (and, for the cheap synthetic case, after every batch) the
incrementally maintained OC-DFG / TOTeM model is compared against a full
recomputation over the complete database.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.dfg.ocdfg_db import OCDFGDb
from totem_lib.generator import generate_synthetic_ocel
from totem_lib.incremental import (
    IncrementalOCDFG,
    IncrementalTotem,
    empty_ocel_db,
    split_batches,
)
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.totem.totem_db import totemDiscovery_db

from ..dfg.test_ocdfg_naive import assert_same_graph
from ..totem.test_totem_naive import assert_same_totem

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"


@pytest.fixture(scope="module")
def real_source():
    db = import_ocel_db(str(TEST_DATA / "container_logistics.json"))
    yield db
    db.close()


@pytest.fixture(scope="module")
def synthetic_source():
    with generate_synthetic_ocel(
        n_types=3, objects_per_type=120, events_per_object=8, seed=31
    ) as db:
        yield db


class TestIncrementalOCDFG:
    def test_replay_real_log(self, real_source):
        batches = split_batches(real_source, n_batches=5, base_fraction=0.4)
        target = empty_ocel_db()
        inc = IncrementalOCDFG(target, validate=True)
        for b in batches:
            inc.append_batch(b.events, b.event_object, b.objects, b.object_relations)
        assert_same_graph(OCDFGDb.from_ocel_db(real_source), inc.get_ocdfg())
        target.close()

    def test_replay_synthetic_log_every_batch(self, synthetic_source):
        batches = split_batches(synthetic_source, n_batches=4, base_fraction=0.3)
        target = empty_ocel_db()
        inc = IncrementalOCDFG(target, validate=True)
        for b in batches:
            inc.append_batch(b.events, b.event_object, b.objects, b.object_relations)
            # full recomputation over everything appended so far
            assert_same_graph(OCDFGDb.from_ocel_db(target), inc.get_ocdfg())
        target.close()

    def test_bootstrap_then_append(self, synthetic_source):
        """State can be initialized from a pre-populated database."""
        batches = split_batches(synthetic_source, n_batches=2, base_fraction=0.5)
        target = empty_ocel_db()
        warmup = IncrementalOCDFG(target)
        warmup.append_batch(
            batches[0].events, batches[0].event_object,
            batches[0].objects, batches[0].object_relations,
        )
        # drop the maintained state, then bootstrap a fresh instance from data
        for tbl in ("inc_dfg_edge", "inc_node_freq", "inc_starts",
                    "inc_ends", "inc_obj_state"):
            target.conn.execute(f"DELETE FROM {tbl}")
        inc = IncrementalOCDFG(target, validate=True)
        for b in batches[1:]:
            inc.append_batch(b.events, b.event_object, b.objects, b.object_relations)
        assert_same_graph(OCDFGDb.from_ocel_db(target), inc.get_ocdfg())
        target.close()

    def test_out_of_order_append_rejected(self):
        import polars as pl

        target = empty_ocel_db()
        inc = IncrementalOCDFG(target, validate=True)
        objects = pl.DataFrame({"obj_id": ["A"], "obj_type": ["ot0"]})
        late = pl.DataFrame(
            {"event_id": ["e1"], "activity": ["a"], "timestamp_unix": [100]}
        )
        early = pl.DataFrame(
            {"event_id": ["e2"], "activity": ["b"], "timestamp_unix": [50]}
        )
        eo = lambda eid: pl.DataFrame(
            {"event_id": [eid], "obj_id": ["A"], "qualifier": [None]},
            schema={"event_id": pl.Utf8, "obj_id": pl.Utf8, "qualifier": pl.Utf8},
        )
        inc.append_batch(late, eo("e1"), objects)
        with pytest.raises(ValueError, match="Out-of-order"):
            inc.append_batch(early, eo("e2"))
        target.close()


class TestIncrementalTotem:
    def test_replay_real_log(self, real_source):
        batches = split_batches(real_source, n_batches=5, base_fraction=0.4)
        target = empty_ocel_db()
        inc = IncrementalTotem(target)
        for b in batches:
            inc.append_batch(b.events, b.event_object, b.objects, b.object_relations)
        assert_same_totem(totemDiscovery_db(real_source), inc.refresh())
        target.close()

    def test_replay_synthetic_log_every_batch(self, synthetic_source):
        batches = split_batches(synthetic_source, n_batches=4, base_fraction=0.3)
        target = empty_ocel_db()
        inc = IncrementalTotem(target)
        for b in batches:
            inc.append_batch(b.events, b.event_object, b.objects, b.object_relations)
            assert_same_totem(totemDiscovery_db(target), inc.refresh())
        target.close()

    def test_bootstrap_then_append(self, synthetic_source):
        batches = split_batches(synthetic_source, n_batches=2, base_fraction=0.5)
        target = empty_ocel_db()
        warmup = IncrementalTotem(target)
        warmup.append_batch(
            batches[0].events, batches[0].event_object,
            batches[0].objects, batches[0].object_relations,
        )
        for tbl in ("inc_lifetimes", "inc_pair", "inc_lc", "inc_ec_pair",
                    "inc_src_totals", "inc_act_type", "inc_type_rel"):
            target.conn.execute(f"DELETE FROM {tbl}")
        inc = IncrementalTotem(target)
        for b in batches[1:]:
            inc.append_batch(b.events, b.event_object, b.objects, b.object_relations)
        assert_same_totem(totemDiscovery_db(target), inc.refresh())
        target.close()

    def test_order_independence(self, synthetic_source):
        """TOTeM summaries are order-independent: appending the batches in
        reverse temporal order yields the same model (objects and o2o
        relations are provided up front)."""
        batches = split_batches(synthetic_source, n_batches=3, base_fraction=0.25)
        target = empty_ocel_db()
        inc = IncrementalTotem(target)
        # all objects and o2o relations with the first append
        import polars as pl

        all_objects = pl.concat([b.objects for b in batches])
        all_o2o = pl.concat([b.object_relations for b in batches])
        first = batches[-1]
        inc.append_batch(first.events, first.event_object, all_objects, all_o2o)
        for b in reversed(batches[:-1]):
            inc.append_batch(b.events, b.event_object)
        assert_same_totem(totemDiscovery_db(synthetic_source), inc.refresh())
        target.close()
