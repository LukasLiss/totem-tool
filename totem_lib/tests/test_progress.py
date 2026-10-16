"""Progress reporting and cooperative cancellation (``totem_lib.progress``)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from totem_lib.dfg import NewOCDFGDb
from totem_lib.ocel import import_ocel_db
from totem_lib.process_areas import prepare_db
from totem_lib.progress import Progress, as_progress
from totem_lib.totem import totemDiscovery_db

TEST_DATA = Path(__file__).parent.parent / "test_data" / "small"


class Cancelled(Exception):
    pass


def test_progress_maps_sub_ranges_onto_overall_range():
    seen = []
    progress = Progress(lambda f, m: seen.append((f, m)))
    progress.report(0.0, "start")
    sub = progress.sub(0.5, 1.0, "second half")
    sub.report(0.5)
    sub.report(None, "unknown")
    progress.report(1.0, "done")
    assert seen == [(0.0, "start"), (0.75, "second half"), (None, "unknown"), (1.0, "done")]


def test_progress_without_callback_is_a_noop():
    progress = as_progress(None)
    assert not progress.enabled
    progress.report(0.3, "x")
    progress.check()
    assert not progress.sub(0, 1).enabled


def test_raising_callback_aborts_a_computation():
    def callback(fraction, message):
        if fraction is not None and fraction >= 0.5:
            raise Cancelled(message)

    progress = Progress(callback)
    progress.report(0.2)
    with pytest.raises(Cancelled):
        progress.report(0.6)


@pytest.fixture(scope="module")
def db():
    db = import_ocel_db(str(TEST_DATA / "order-management.sqlite"))
    yield db
    db.close()


def test_importer_reports_monotone_progress_up_to_done(tmp_path):
    seen = []
    import_ocel_db(
        str(TEST_DATA / "order-management.json"),
        progress=lambda f, m: seen.append((f, m)),
    ).close()
    fractions = [f for f, _ in seen]
    assert fractions == sorted(fractions)
    assert fractions[-1] == 1.0
    assert any("events" in m.lower() for _, m in seen)


def test_importer_can_be_cancelled_through_progress(tmp_path):
    target = tmp_path / "cancelled.duckdb"

    def callback(fraction, message):
        if fraction >= 0.5:
            raise Cancelled()

    with pytest.raises(Cancelled):
        import_ocel_db(str(TEST_DATA / "order-management.json"), db_path=str(target), progress=callback)
    assert not target.exists()


def test_algorithms_report_and_can_be_cancelled(db):
    for run in (
        lambda p: NewOCDFGDb.from_ocel_db_with_variant_ranks(db, progress=p),
        lambda p: totemDiscovery_db(db, progress=p),
        lambda p: prepare_db(db, progress=p),
    ):
        seen = []
        run(lambda f, m: seen.append((f, m)))
        fractions = [f for f, _ in seen if f is not None]
        assert fractions and fractions[-1] == 1.0
        assert fractions == sorted(fractions)

        def cancel_at_start(fraction, message):
            raise Cancelled(message)

        with pytest.raises(Cancelled):
            run(cancel_at_start)
