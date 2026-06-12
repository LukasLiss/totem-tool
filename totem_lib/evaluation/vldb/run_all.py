"""
Run the complete VLDB benchmark suite and regenerate the paper figures.

Usage: python run_all.py [--quick]

--quick runs every benchmark on tiny inputs to verify the pipeline; the
full run takes a few hours on a 4-core machine and needs ~10 GB of disk
for the synthetic log cache (set TOTEM_BENCH_CACHE to relocate it).
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent

BENCHES = [
    "bench_scaling.py",
    "bench_ablation.py",
    "bench_ablation_tracelen.py",
    "bench_incremental.py",
    "bench_memory.py",
    "bench_real.py",
]


def main():
    args = [a for a in sys.argv[1:] if a == "--quick"]
    for bench in BENCHES:
        print(f"=== {bench} ===", flush=True)
        subprocess.run([sys.executable, str(HERE / bench), *args], check=True)
    subprocess.run([sys.executable, str(HERE / "plots.py")], check=True)


if __name__ == "__main__":
    main()
