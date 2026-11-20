#!/usr/bin/env bash
# Submit the evaluation to Slurm: one array task per log, then one small job that turns
# all results into tables and figures once every task has finished.
#
#   evaluation/hpc/submit.sh [BATCH_NAME] [run_benchmarks options...]
#
#   evaluation/hpc/submit.sh                       new batch named after the date
#   evaluation/hpc/submit.sh thesis-v1             new batch, or resume this one
#   evaluation/hpc/submit.sh thesis-v1 --repeats 5 options passed to every task
#
# Re-running with the same BATCH_NAME resumes: finished measurements are skipped.
# Run it on a login node, after downloading the logs (see README.md next to it).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${TOTEM_EVAL_ROOT:-$HPCWORK/totem-eval}"
export SIF="${SIF:-$ROOT/totem-eval.sif}"
export TOTEM_EVAL_DATA="${TOTEM_EVAL_DATA:-$ROOT/logs}"
export TOTEM_EVAL_RUNS="${TOTEM_EVAL_RUNS:-$ROOT/runs}"

BATCH="${1:-$(date +%Y-%m-%d_%H-%M)}"
[ $# -gt 0 ] && shift
export BATCH_DIR="$TOTEM_EVAL_RUNS/$BATCH"
export EXTRA_ARGS="$*"

[ -f "$SIF" ] || { echo "no image at $SIF (see README.md: apptainer build)" >&2; exit 1; }
mkdir -p "$BATCH_DIR/slurm"

# The log list is fixed on the first submit, so array indices keep meaning the same log.
if [ ! -s "$BATCH_DIR/logs.txt" ]; then
    apptainer exec --bind "$HPCWORK" "$SIF" totem-eval logs > "$BATCH_DIR/logs.txt"
fi
COUNT=$(wc -l < "$BATCH_DIR/logs.txt")
[ "$COUNT" -gt 0 ] || { echo "no logs on disk in $TOTEM_EVAL_DATA" >&2; exit 1; }

ARRAY=$(sbatch --parsable --array="0-$((COUNT - 1))" \
    --output="$BATCH_DIR/slurm/%x_%a_%A.out" --export=ALL \
    "$HERE/benchmark.sbatch")
FIGURES=$(sbatch --parsable --dependency="afterany:$ARRAY" --job-name=totem-eval-figures \
    --time=01:00:00 --ntasks=1 --cpus-per-task=2 --mem=16G \
    --output="$BATCH_DIR/slurm/%x_%A.out" --export=ALL \
    --wrap="apptainer exec --bind '$HPCWORK' '$SIF' totem-eval figures '$BATCH_DIR'")

cat <<INFO
Batch    $BATCH_DIR
Logs     $COUNT ($(paste -sd, "$BATCH_DIR/logs.txt"))
Jobs     measurements $ARRAY (array), figures $FIGURES (after the array)

Follow it:
  squeue --me
  apptainer exec --bind \$HPCWORK $SIF totem-eval status $BATCH_DIR --watch 60
  tail -f $BATCH_DIR/slurm/*.out
Figures appear in $BATCH_DIR/combined/ when every task is done.
INFO
