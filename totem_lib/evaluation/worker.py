"""
Measure one algorithm on one log, in a process of its own.

run_benchmarks.py starts this script once per (log, algorithm) pair. A fresh process
per measurement means:

- nothing an earlier algorithm left behind (caches on the log object, temporary DuckDB
  tables, a fragmented heap, garbage not yet collected) can change the next number;
- the process's peak memory describes exactly one input plus one algorithm, which is
  what makes the resident-set figures in harness.py meaningful;
- a run that hangs can be killed on a timeout, and one that runs out of memory takes
  down only itself.

The price is that every measurement prepares its input again (imports the log), which
is not timed.

The result is written as JSON to --result-file. Anything the algorithm prints goes to
this process's stdout/stderr, which the parent captures.

Not meant to be run by hand, but it works:
    python evaluation/worker.py --log ocel2-p2p --algorithm OCDFG.from_ocel \
        --repeats 3 --warmup 1 --result-file /tmp/result.json
"""

from __future__ import annotations

import argparse
import json
import pickle
import sys
from dataclasses import replace
from enum import Enum
from pathlib import Path

_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation.algorithms import Algorithm, LogContext, artifact_path, get_algorithm  # noqa: E402
from evaluation.datasets import get_log  # noqa: E402
from evaluation.harness import BenchmarkResult, benchmark  # noqa: E402


def measure_in_this_process(log_name: str, algorithm: "Algorithm | str", repeats: int,
                            warmup: int, artifact_dir: Path | None = None, *,
                            memory: bool = True,
                            context: LogContext | None = None) -> BenchmarkResult:
    """
    Prepare the input, time the algorithm, then describe and save what it produced.

    Errors come back in the result. Describing happens after timing and after memory is
    read (see harness.benchmark), and a failure there is recorded in the properties
    rather than failing a measurement whose numbers are fine.
    """
    if isinstance(algorithm, str):
        algorithm = get_algorithm(algorithm)
    own_context = context is None
    if own_context:
        context = LogContext(get_log(log_name), artifact_dir)
    described: dict = {}

    def keep(output):
        if algorithm.describe is None:
            return
        try:
            outcome = algorithm.describe(output)
        except Exception as exc:  # the measurement stands; say why nothing was kept
            described["properties"] = {"describe_error": f"{type(exc).__name__}: {exc}"}
            return
        described["properties"] = outcome.properties
        if outcome.artifact is not None and artifact_dir is not None:
            path = artifact_path(artifact_dir, log_name, algorithm.name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(outcome.artifact, default=_jsonable), encoding="utf-8")
            described["artifact"] = path.relative_to(Path(artifact_dir).parent).as_posix()
            if outcome.reuse is not None:
                with open(path.with_suffix(".pickle"), "wb") as handle:
                    pickle.dump(outcome.reuse, handle)

    try:
        try:
            call = algorithm.make_call(context)
        except Exception as exc:
            result = BenchmarkResult.failed(algorithm.name, repeats, exc, warmup=warmup)
        else:
            result = benchmark(algorithm.name, call, repeats=repeats, warmup=warmup,
                               memory=memory, keep_output=keep)
    finally:
        if own_context:
            context.close()
    properties = {"params": dict(algorithm.params), "family": algorithm.family,
                  **described.get("properties", {})}
    return replace(result, properties=properties, artifact=described.get("artifact"))


def _jsonable(value):
    """Sets and tuples become sorted lists; anything else is written as text."""
    if isinstance(value, (set, frozenset)):
        return sorted(value, key=str)
    if isinstance(value, Enum):
        return value.value
    return str(value)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log", required=True)
    parser.add_argument("--algorithm", required=True)
    parser.add_argument("--repeats", type=int, required=True)
    parser.add_argument("--warmup", type=int, default=0)
    parser.add_argument("--result-file", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, default=None,
                        help="the run's artifacts folder; models are saved here")
    args = parser.parse_args()

    result = measure_in_this_process(args.log, args.algorithm, args.repeats, args.warmup,
                                     args.artifact_dir)
    args.result_file.write_text(json.dumps(result.as_dict()), encoding="utf-8")


if __name__ == "__main__":
    main()
