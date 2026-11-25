#!/usr/bin/env bash
# One array task = one log, measured with every algorithm into its own run folder.
# Submitted by submit.sh, which sets SIF, BATCH_DIR and EXTRA_ARGS; do not sbatch directly.
#
#SBATCH --job-name=totem-eval
#SBATCH --time=24:00:00
# A whole node per log: no other job competes for cores, cache or memory bandwidth,
# so the runtimes stay comparable. This costs the node's full core-hours from your
# contingent; drop it (and ask for e.g. --cpus-per-task=8 --mem=64G) to save quota at
# the price of noisier numbers.
#SBATCH --exclusive
# Pick one partition and keep it for the whole evaluation, so every log runs on the
# same CPU type (run.json records the CPU either way):
##SBATCH --partition=<partition>
##SBATCH --account=<project>

set -euo pipefail

LOG=$(sed -n "$((SLURM_ARRAY_TASK_ID + 1))p" "$BATCH_DIR/logs.txt")
if [ -z "$LOG" ]; then
    echo "no log for array index $SLURM_ARRAY_TASK_ID in $BATCH_DIR/logs.txt" >&2
    exit 1
fi
echo "log $LOG  node $(hostname)  job ${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID}  $(date -Is)"

# --run-dir starts the run on the first attempt and resumes it after a resubmit, so a
# task that hits --time loses at most the measurement it was in.
# shellcheck disable=SC2086  # EXTRA_ARGS is meant to split into separate options
apptainer exec --bind "$HPCWORK" "$SIF" \
    totem-eval run --logs "$LOG" --run-dir "$BATCH_DIR/$LOG" --no-figures $EXTRA_ARGS
