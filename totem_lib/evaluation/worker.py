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
import sys
from pathlib import Path

_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation.algorithms import LogContext, get_algorithm  # noqa: E402
from evaluation.datasets import get_log  # noqa: E402
from evaluation.harness import BenchmarkResult, benchmark  # noqa: E402


def measure_in_this_process(log_name: str, algorithm_name: str, repeats: int,
                            warmup: int) -> BenchmarkResult:
    """Prepare the input, then time the algorithm. Errors come back in the result."""
    algorithm = get_algorithm(algorithm_name)
    context = LogContext(get_log(log_name))
    try:
        try:
            call = algorithm.make_call(context)
        except Exception as exc:
            return BenchmarkResult.failed(algorithm.name, repeats, exc, warmup=warmup)
        return benchmark(algorithm.name, call, repeats=repeats, warmup=warmup, memory=True)
    finally:
        context.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log", required=True)
    parser.add_argument("--algorithm", required=True)
    parser.add_argument("--repeats", type=int, required=True)
    parser.add_argument("--warmup", type=int, default=0)
    parser.add_argument("--result-file", type=Path, required=True)
    args = parser.parse_args()

    result = measure_in_this_process(args.log, args.algorithm, args.repeats, args.warmup)
    args.result_file.write_text(json.dumps(result.as_dict()), encoding="utf-8")


if __name__ == "__main__":
    main()
