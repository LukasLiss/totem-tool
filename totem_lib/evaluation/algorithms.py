"""
The algorithms benchmarked by the runtime evaluation, and how to call each one.

The algorithms do not take the same input. Some want a Polars log, some want the DuckDB
copy, and `mlpaDiscovery` wants the output of `totemDiscovery` rather than a log at all.
`LogContext` builds each of those inputs once per log, and every algorithm says how to
turn a context into a call that takes no arguments.

That split matters for the measurement: building the input happens while the context is
being filled, so only the algorithm itself ends up inside the timed part. It also makes
repeated runs fair, since all repeats reuse one already-built input.

Run the benchmarks with:
    python evaluation/run_benchmarks.py
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from functools import partial
from itertools import count
from pathlib import Path
from typing import Any, Callable, Sequence

# Run either as a script or imported as `evaluation.algorithms`, so both totem_lib/src
# and totem_lib itself go on the path.
_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

import contextlib
import io
import os
import pickle
import shutil
import tempfile
import time

import polars as pl

from evaluation import outcomes
from evaluation.datasets import EvaluationLog, import_args
from totem_lib import (
    CCDFG,
    OCDFG,
    conformance_of_totem,
    discover_occn,
    discover_ocpn_db,
    extract_occn_replay_units,
    import_ocel,
    mlpaDiscovery,
    occn_replay_fitness,
    totemDiscovery,
)
from totem_lib.dfg import NewOCDFGDb
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.totem import totemDiscovery_db
from totem_lib.variants import find_variants

# Every call site in this repo discovers an OCCN with a threshold of 0. The threshold is
# applied after the mining, so it does not change what is being measured.
OCCN_THRESHOLD = 0

# The TOTeM threshold of the discovery paper and the tool's default.
DEFAULT_TAU = 0.9
# The conformance paper discovers models at tau = 0.0, 0.1, ..., 1.0.
TAU_SWEEP = tuple(round(i / 10, 1) for i in range(11))
# Marker groups used by fewer than this share of an activity's executions are dropped.
# The OCCN conformance paper used 10%, with further groups removed by hand; a sweep
# reproduces that without hand edits.
OCCN_THRESHOLD_SWEEP = (0.0, 0.05, 0.1, 0.2, 0.3)
# No cap on the replay states explored per execution: every execution is replayed to a
# definite fitting / non-fitting answer, and only the measurement's timeout stops it.
# (The library's default of 1000 states left 582 of 927 ocel2-p2p executions
# inconclusive against the unfiltered net.) A measurement that times out keeps no
# per-execution results.
OCCN_MAX_STATES = None

# OCCN conformance looks at a log's main object types only, and runs only on the logs
# listed here. Checking a whole log fails on most logs: long-lived objects (products,
# employees, repositories) connect nearly every event, so the connected components
# collapse into one giant execution.
#
# The types were chosen by hand, which the dissertation states. Choosing them
# automatically was tried first - the biggest process area on the lowest MLPA level,
# see main_area_types() - but on most logs that level holds a single short-lived type,
# which leaves executions of one to three events. The candidates per log, with their
# levels and sizes, are listed in evaluation/results/main_object_type_candidates.md.
# ocel2-p2p uses all its types, as the OCCN conformance paper did; container_logistics
# the paper's Container and Handling Unit. Names are as the DuckDB importer stores them.
MAIN_OBJECT_TYPES: dict[str, tuple[str, ...]] = {
    "ocel2-p2p": ("goods receipt", "invoice receipt", "material", "payment",
                  "purchase_order", "purchase_requisition", "quotation"),
    "container_logistics": ("Container", "Handling Unit"),
    "github-pm4py": ("Caseconceptname",),
    "recruiting": ("Applications",),
}

# Set by the worker: where this run keeps its artifacts, so the OCCN conformance
# experiments can reuse the OCCN that discovery already saved instead of mining it again.
ARTIFACT_DIR_ENV = "TOTEM_EVAL_ARTIFACTS"


class MissingInput(Exception):
    """A log does not have something an algorithm needs."""


# ---------------------------------------------------------------------------
# Per-log inputs
# ---------------------------------------------------------------------------

class LogContext:
    """
    The inputs an algorithm might need, built once per log and reused.

    Everything is built on first use, so benchmarking one cheap algorithm does not pay
    for inputs it never touches.
    """

    def __init__(self, log: EvaluationLog, artifact_dir: Path | str | None = None):
        self.log = log
        if artifact_dir is None and os.environ.get(ARTIFACT_DIR_ENV):
            artifact_dir = os.environ[ARTIFACT_DIR_ENV]
        self.artifact_dir = Path(artifact_dir) if artifact_dir else None
        self._ocel = None
        self._ocel_db = None
        self._db_dir = None
        self._totem = None
        self._totems_db: dict[float, Any] = {}
        self._occn = None
        self._main_occn = None
        self._main_types = None
        self._replay_units = None
        self._base_df = None

    @property
    def ocel(self):
        """The log, imported with the Polars importer."""
        if self._ocel is None:
            self._ocel = import_ocel(*import_args(self.log))
        return self._ocel

    @property
    def ocel_db(self) -> OcelDuckDB:
        """
        The log loaded into DuckDB, for the `_db` algorithms.

        Built from the same OCEL file the Polars side reads, so both families measure
        the same data. The `.duckdb` files in test_data are not used: they were built
        once from a normalised copy of the logs, with spaces stripped from object types
        and activities, so they hold different labels and slightly different rows.

        It is written to a temporary directory, not next to the log, because DuckDB
        leaves scratch files beside its database.
        """
        if self._ocel_db is None:
            db_path = Path(self._scratch_dir()) / f"{self.log.name}.duckdb"
            self._ocel_db = import_ocel_db(str(self.log.path), db_path=str(db_path))
        return self._ocel_db

    def _scratch_dir(self) -> str:
        """Where throwaway DuckDB files go. Removed by close()."""
        if self._db_dir is None:
            self._db_dir = tempfile.mkdtemp(prefix="totem-eval-")
        return self._db_dir

    def fresh_db_import(self) -> Callable[[], Any]:
        """
        A call that builds a new DuckDB copy every time it runs.

        `ocel_db` keeps its database and hands the same one to every algorithm, which
        is what those algorithms want. It is wrong for timing the conversion though:
        the second repeat would find the work already done and measure nothing. So
        each call here writes its own file.
        """
        counter = count()

        def convert():
            path = Path(self._scratch_dir()) / f"timed-{next(counter)}.duckdb"
            db = import_ocel_db(str(self.log.path), db_path=str(path))
            db.close()
            return path

        return convert

    @property
    def totem(self):
        """A discovered Totem, which mlpaDiscovery takes instead of a log."""
        if self._totem is None:
            self._totem = totemDiscovery(self.ocel)
        return self._totem

    def totem_db(self, tau: float):
        """A TOTeM discovered from the DuckDB log at this threshold, as the tool does."""
        if tau not in self._totems_db:
            self._totems_db[tau] = totemDiscovery_db(self.ocel_db, tau=tau)
        return self._totems_db[tau]

    @property
    def occn(self):
        """
        The unfiltered OCCN (threshold 0) of this log, mined from DuckDB like the tool.

        OCCN discovery is the most expensive step here, and every conformance
        measurement needs it again in its own process. So the model that
        `discover_occn_db` saved for this log is read back when it exists, and only
        mined when it does not.
        """
        if self._occn is None:
            saved = self.saved_occn(OCCN_DISCOVERY)
            if saved is not None:
                self._occn = saved
            else:
                with quiet():
                    self._occn = discover_occn(self.ocel_db, OCCN_THRESHOLD)
        return self._occn

    @property
    def main_object_types(self) -> tuple[str, ...]:
        """The object types OCCN conformance looks at; see MAIN_OBJECT_TYPES."""
        if self._main_types is None:
            if self.log.name in MAIN_OBJECT_TYPES:
                self._main_types = tuple(sorted(MAIN_OBJECT_TYPES[self.log.name]))
            else:  # the automatic choice, for a log run on explicitly
                with quiet():
                    areas = mlpaDiscovery(self.totem_db(DEFAULT_TAU))
                self._main_types = main_area_types(areas)
        return self._main_types

    @property
    def main_occn(self):
        """
        The unfiltered OCCN of the main object types only.

        Read back from what `discover_occn_main` saved for this log when it exists,
        mined otherwise - see `occn` for why.
        """
        if self._main_occn is None:
            saved = self.saved_occn(OCCN_MAIN_DISCOVERY)
            if saved is not None:
                self._main_occn = saved
            else:
                with quiet():
                    self._main_occn = discover_occn(
                        self.ocel_db, OCCN_THRESHOLD,
                        {"object_types": list(self.main_object_types)})
        return self._main_occn

    @property
    def replay_units(self):
        """
        The log's process executions on its main object types: every event is cut down
        to its objects of those types (events with none are dropped), then the
        connected components of what is left are the executions.
        """
        if self._replay_units is None:
            self._replay_units = extract_occn_replay_units(
                self.ocel_db, object_types=self.main_object_types)
        return self._replay_units

    def saved_occn(self, algorithm_name: str):
        """
        The OCCN an earlier measurement of this run saved for this log, or None.

        Read from the pickle next to its JSON artifact, which keeps the net exactly as
        discovered, including the order of its marker groups that the threshold filter
        depends on (see outcomes.occn_json). Only files this run wrote are read, so
        unpickling is safe.
        """
        if self.artifact_dir is None:
            return None
        path = artifact_path(self.artifact_dir, self.log.name, algorithm_name)
        path = path.with_suffix(".pickle")
        if not path.exists():
            return None
        with open(path, "rb") as handle:
            return pickle.load(handle)

    @property
    def leading_object_type(self) -> str:
        """The object type used as the case, for algorithms that need one."""
        if self.log.leading_object_type is None:
            raise MissingInput(f"{self.log.name} has no leading_object_type")
        return self.log.leading_object_type

    @property
    def base_df(self) -> pl.DataFrame:
        """
        The flattened event-to-object table CCDFG expects.

        Same shape OCDFG.from_ocel builds internally. Because it is prepared here, a
        CCDFG measurement leaves out this explode and sort - see the note in
        run_benchmarks.py.
        """
        if self._base_df is None:
            self._base_df = (
                self.ocel.events
                .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
                .explode("_objects")
                .rename({"_objects": "_objId"})
                .sort(["_objId", "_timestampUnix", "_eventId"])
            )
        return self._base_df

    def close(self) -> None:
        """Release the DuckDB connection, if one was opened."""
        if self._ocel_db is not None:
            self._ocel_db.close()
            self._ocel_db = None
        if self._db_dir is not None:
            shutil.rmtree(self._db_dir, ignore_errors=True)
            self._db_dir = None


# ---------------------------------------------------------------------------
# Chapter experiments: what is timed
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def quiet():
    """Swallow the progress prints and bars some algorithms write."""
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        yield


def check_totem_conformance(totem, ocel_db):
    """Conformance of one model; the model is returned too, so it can be saved."""
    return totem, conformance_of_totem(totem, ocel_db)


def replay_each(occn, units, max_states=OCCN_MAX_STATES):
    """
    Replay every process execution on its own, timing each one.

    The OCCN conformance paper reports the time per execution, plotted against the
    execution's events and objects. The per-unit clock adds one perf_counter pair per
    execution, which is negligible next to a replay.
    """
    replayed = []
    for unit in units:
        start = time.perf_counter()
        result = occn_replay_fitness(occn, (unit,), max_states=max_states).unit_results[0]
        seconds = time.perf_counter() - start
        objects = {
            (object_type, object_id)
            for event in unit.events
            for object_type, ids in event.objects_by_type  # (type, ids) pairs
            for object_id in ids
        }
        replayed.append(outcomes.ReplayedUnit(
            unit_id=unit.unit_id,
            events=len(unit.events),
            objects=len(objects),
            object_types=len({object_type for object_type, _ in objects}),
            seconds=seconds,
            status=result.status.value,
            explored_states=result.explored_state_count,
        ))
    return occn, replayed


def main_area_types(areas) -> tuple[str, ...]:
    """
    The object types of the biggest process area on the lowest level.

    Biggest means the most object types; ties go to the area with more activities,
    then to the alphabetically first set of type names, so the choice is deterministic.
    """
    lowest = min(areas)
    candidates = [(sorted(types), sorted(activities)) for types, activities in areas[lowest]]
    if not candidates:
        raise MissingInput("the lowest process-area level has no area")
    types, _ = min(candidates, key=lambda area: (-len(area[0]), -len(area[1]), area[0]))
    return tuple(types)


def discover_process_areas(ocel_db, tau: float) -> outcomes.ProcessAreaRun:
    """
    The process-area pipeline: TOTeM discovery, then the level-assignment ILP.

    Both steps are timed separately inside the call; the paper reports that TOTeM
    discovery takes about 99% of the time.
    """
    start = time.perf_counter()
    totem = totemDiscovery_db(ocel_db, tau=tau)
    middle = time.perf_counter()
    with quiet():  # mlpaDiscovery prints its intermediate results
        areas = mlpaDiscovery(totem)
    end = time.perf_counter()
    return outcomes.ProcessAreaRun(totem, areas, middle - start, end - middle)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

# The dissertation chapters with an evaluation. Each gets a figures/<chapter>/ folder.
CHAPTERS = (
    "totem-discovery",
    "totem-conformance",
    "occn-discovery",
    "occn-conformance",
    "process-area",
    "totem-tool",
)

OCCN_DISCOVERY = "discover_occn_db"
OCCN_MAIN_DISCOVERY = "discover_occn_main"


@dataclass(frozen=True)
class Algorithm:
    """
    One benchmarked algorithm, or one point of a chapter's parameter sweep.

    `make_call` turns a context into a function of no arguments. It runs before timing
    starts, so preparing the input is not counted.

    `requires` names the other benchmarked steps that produce this algorithm's input,
    in order. The end-to-end cost of an algorithm is their times plus its own.

    `chapters` are the dissertation chapters whose figures use this measurement.
    `params` are the parameters it ran with (e.g. {"tau": 0.3}); they are stored with
    every result, so figures never parse them out of the name. `describe` turns the
    output of the last timed call into properties and a saved artifact (see
    evaluation/outcomes.py); without it only time and memory are kept.
    """

    name: str
    make_call: Callable[[LogContext], Callable[[], Any]]
    requires: tuple[str, ...] = ()
    chapters: tuple[str, ...] = ("totem-tool",)
    params: dict = field(default_factory=dict, hash=False, compare=False)
    describe: Callable[[Any], "outcomes.Outcome"] | None = None
    # The algorithm this is a sweep point of, e.g. "totem_conformance".
    family: str = ""
    # Only these logs, or every log when None (OCCN conformance needs main types).
    logs: tuple[str, ...] | None = None

    def __post_init__(self):
        if not self.family:
            object.__setattr__(self, "family", self.name)

    def runs_on(self, log_name: str) -> bool:
        return self.logs is None or log_name in self.logs


def _swept(family: str, param: str, values, **kwargs) -> tuple[Algorithm, ...]:
    """One Algorithm per parameter value, named e.g. totem_conformance@tau=0.3."""
    make = kwargs.pop("make")
    return tuple(
        Algorithm(f"{family}@{param}={value:g}", make(value), family=family,
                  params={param: value}, **kwargs)
        for value in values
    )


# The library, side by side, and each Polars algorithm next to its DuckDB twin
# (named x and x_db). This is the tool chapter's comparison. Entries that are also a
# chapter's main measurement carry that chapter as well, so nothing runs twice.
TOOL_ALGORITHMS: tuple[Algorithm, ...] = (
    Algorithm("import_ocel", lambda c: partial(import_ocel, *import_args(c.log))),
    Algorithm("import_ocel_db", lambda c: c.fresh_db_import()),
    Algorithm("totemDiscovery", lambda c: partial(totemDiscovery, c.ocel),
              requires=("import_ocel",), describe=outcomes.describe_totem,
              params={"tau": DEFAULT_TAU}),
    Algorithm("totemDiscovery_db", lambda c: partial(totemDiscovery_db, c.ocel_db, tau=DEFAULT_TAU),
              requires=("import_ocel_db",), describe=outcomes.describe_totem,
              chapters=("totem-tool", "totem-discovery"), params={"tau": DEFAULT_TAU},
              family="totemDiscovery_db"),
    Algorithm("mlpaDiscovery", lambda c: partial(mlpaDiscovery, c.totem),
              requires=("import_ocel", "totemDiscovery")),
    Algorithm("discover_ocpn_db", lambda c: partial(discover_ocpn_db, c.ocel_db),
              requires=("import_ocel_db",)),
    Algorithm("discover_occn", lambda c: partial(discover_occn, c.ocel, OCCN_THRESHOLD),
              requires=("import_ocel",), describe=outcomes.describe_occn),
    Algorithm(OCCN_DISCOVERY, lambda c: partial(discover_occn, c.ocel_db, OCCN_THRESHOLD),
              requires=("import_ocel_db",), describe=outcomes.describe_occn,
              chapters=("totem-tool", "occn-discovery")),
    Algorithm("OCDFG.from_ocel", lambda c: partial(OCDFG.from_ocel, c.ocel),
              requires=("import_ocel",), describe=outcomes.describe_graph),
    Algorithm("OCDFG.from_ocel_db", lambda c: partial(NewOCDFGDb.from_ocel_db, c.ocel_db),
              requires=("import_ocel_db",), describe=outcomes.describe_graph),
    # The flattening CCDFG takes as input is not a benchmarked step, so its end-to-end
    # cost is understated - see run_benchmarks.print_summary.
    Algorithm(
        "CCDFG.from_ocel",
        lambda c: partial(CCDFG.from_ocel, c.ocel, c.leading_object_type, c.base_df),
        requires=("import_ocel",),
    ),
    Algorithm(
        "find_variants",
        lambda c: partial(
            find_variants,
            c.ocel_db,
            leading_type=c.leading_object_type,
            # The docstring asks for None in offline evaluation, so a slow log is
            # measured rather than cut off at the default 10s.
            timeout_s=None,
            verbose=False,
        ),
        requires=("import_ocel_db",),
    ),
)

CHAPTER_ALGORITHMS: tuple[Algorithm, ...] = (
    # TOTeM discovery at every threshold of the sweep (0.9 is totemDiscovery_db above).
    *_swept("totemDiscovery_db", "tau", [t for t in TAU_SWEEP if t != DEFAULT_TAU],
            make=lambda tau: (lambda c: partial(totemDiscovery_db, c.ocel_db, tau=tau)),
            requires=("import_ocel_db",), chapters=("totem-discovery",),
            describe=outcomes.describe_totem),
    # Conformance of the model discovered at each tau, against the same log. The model
    # is discovered before timing starts; only the check is timed.
    *_swept("totem_conformance", "tau", TAU_SWEEP,
            make=lambda tau: (lambda c: partial(check_totem_conformance, c.totem_db(tau),
                                                c.ocel_db)),
            requires=("import_ocel_db",), chapters=("totem-conformance",),
            describe=outcomes.describe_totem_conformance),
    # The OCCN of the main object types, which conformance checks against. Timed, so the
    # chapter can report what the model cost; choosing the types is not timed.
    Algorithm(OCCN_MAIN_DISCOVERY,
              lambda c: partial(discover_occn, c.ocel_db, OCCN_THRESHOLD,
                                {"object_types": list(c.main_object_types)}),
              requires=("import_ocel_db",), chapters=("occn-conformance",),
              describe=outcomes.describe_occn, logs=tuple(MAIN_OBJECT_TYPES)),
    # Replay of every process execution against that OCCN, filtered at each threshold.
    *_swept("occn_fitness", "threshold", OCCN_THRESHOLD_SWEEP,
            make=lambda th: (lambda c: partial(
                replay_each, c.main_occn.apply_relative_occurrence_threshold(th),
                c.replay_units)),
            requires=("import_ocel_db", OCCN_MAIN_DISCOVERY), chapters=("occn-conformance",),
            describe=outcomes.describe_occn_fitness, logs=tuple(MAIN_OBJECT_TYPES)),
    # The whole process-area pipeline, as the paper timed it.
    Algorithm("process_areas", lambda c: partial(discover_process_areas, c.ocel_db, DEFAULT_TAU),
              requires=("import_ocel_db",), chapters=("process-area",),
              params={"tau": DEFAULT_TAU}, describe=outcomes.describe_process_areas),
)

ALGORITHMS: tuple[Algorithm, ...] = TOOL_ALGORITHMS + CHAPTER_ALGORITHMS

ALGORITHM_NAMES = tuple(algorithm.name for algorithm in ALGORITHMS)

# Run only when asked for by name. find_variants exhausts memory on order-management;
# a timeout cannot stop that, and on macOS the swapping slows the whole machine down
# before the process is killed.
OPT_IN_ALGORITHMS = frozenset({"find_variants"})

# What a run covers when no --algorithms are given.
DEFAULT_ALGORITHMS: tuple[Algorithm, ...] = tuple(
    algorithm for algorithm in ALGORITHMS if algorithm.name not in OPT_IN_ALGORITHMS
)


def algorithms_for(chapters: Sequence[str]) -> tuple[Algorithm, ...]:
    """The default algorithms one or more chapters need, in registry order."""
    unknown = set(chapters) - set(CHAPTERS)
    if unknown:
        raise ValueError(f"unknown chapter(s) {sorted(unknown)}; available: {', '.join(CHAPTERS)}")
    return tuple(a for a in DEFAULT_ALGORITHMS if set(a.chapters) & set(chapters))


def planned_pairs(log_names: Sequence[str], algorithm_names: Sequence[str]) -> list[tuple[str, str]]:
    """Every (log, algorithm) a plan covers, leaving out algorithms not meant for a log."""
    registry = {a.name: a for a in ALGORITHMS}
    return [(log, name) for log in log_names for name in algorithm_names
            if name not in registry or registry[name].runs_on(log)]


def get_algorithm(name: str, algorithms: Sequence[Algorithm] = ALGORITHMS) -> Algorithm:
    """Return the algorithm with this name, or raise ValueError listing the valid ones."""
    for algorithm in algorithms:
        if algorithm.name == name:
            return algorithm
    known = ", ".join(candidate.name for candidate in algorithms)
    raise ValueError(f"unknown algorithm {name!r}; available: {known}")


def artifact_path(artifact_dir: Path, log_name: str, algorithm_name: str) -> Path:
    """Where a measurement's artifact goes: <artifacts>/<log>/<algorithm>.json."""
    safe = algorithm_name.replace("/", "_")
    return Path(artifact_dir) / log_name / f"{safe}.json"
