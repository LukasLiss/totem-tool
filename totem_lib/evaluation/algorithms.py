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
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, Callable, Sequence

# Run either as a script or imported as `evaluation.algorithms`, so both totem_lib/src
# and totem_lib itself go on the path.
_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

import polars as pl

from evaluation.datasets import EvaluationLog, import_args
from totem_lib import (
    CCDFG,
    OCDFG,
    discover_occn,
    discover_oc_petri_net_polars,
    import_ocel,
    mlpaDiscovery,
    totemDiscovery,
)
from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.totem import totemDiscovery_db
from totem_lib.variants import find_variants

# Every call site in this repo discovers an OCCN with a threshold of 0. The threshold is
# applied after the mining, so it does not change what is being measured.
OCCN_THRESHOLD = 0


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

    def __init__(self, log: EvaluationLog):
        self.log = log
        self._ocel = None
        self._ocel_db = None
        self._totem = None
        self._base_df = None

    @property
    def ocel(self):
        """The log, imported with the Polars importer."""
        if self._ocel is None:
            self._ocel = import_ocel(*import_args(self.log))
        return self._ocel

    @property
    def ocel_db(self) -> OcelDuckDB:
        """The DuckDB copy of the log, for the `_db` algorithms."""
        if self._ocel_db is None:
            if not self.log.has_duckdb:
                raise MissingInput(
                    f"{self.log.name} has no DuckDB copy at {self.log.duckdb_path}"
                )
            self._ocel_db = OcelDuckDB.load(str(self.log.duckdb_path))
        return self._ocel_db

    @property
    def totem(self):
        """A discovered Totem, which mlpaDiscovery takes instead of a log."""
        if self._totem is None:
            self._totem = totemDiscovery(self.ocel)
        return self._totem

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


# ---------------------------------------------------------------------------
# The algorithms
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Algorithm:
    """
    One benchmarked algorithm.

    `make_call` turns a context into a function of no arguments. It runs before timing
    starts, so preparing the input is not counted.
    """

    name: str
    make_call: Callable[[LogContext], Callable[[], Any]]


ALGORITHMS: tuple[Algorithm, ...] = (
    Algorithm("import_ocel", lambda c: partial(import_ocel, *import_args(c.log))),
    Algorithm("totemDiscovery", lambda c: partial(totemDiscovery, c.ocel)),
    Algorithm("totemDiscovery_db", lambda c: partial(totemDiscovery_db, c.ocel_db)),
    Algorithm("mlpaDiscovery", lambda c: partial(mlpaDiscovery, c.totem)),
    Algorithm(
        "discover_oc_petri_net_polars",
        lambda c: partial(discover_oc_petri_net_polars, c.ocel),
    ),
    Algorithm("discover_occn", lambda c: partial(discover_occn, c.ocel, OCCN_THRESHOLD)),
    Algorithm("OCDFG.from_ocel", lambda c: partial(OCDFG.from_ocel, c.ocel)),
    Algorithm(
        "CCDFG.from_ocel",
        lambda c: partial(CCDFG.from_ocel, c.ocel, c.leading_object_type, c.base_df),
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
    ),
)

ALGORITHM_NAMES = tuple(algorithm.name for algorithm in ALGORITHMS)


def get_algorithm(name: str, algorithms: Sequence[Algorithm] = ALGORITHMS) -> Algorithm:
    """Return the algorithm with this name, or raise ValueError listing the valid ones."""
    for algorithm in algorithms:
        if algorithm.name == name:
            return algorithm
    known = ", ".join(candidate.name for candidate in algorithms)
    raise ValueError(f"unknown algorithm {name!r}; available: {known}")
