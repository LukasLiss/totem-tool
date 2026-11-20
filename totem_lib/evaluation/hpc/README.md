# Running the evaluation on an HPC cluster (RWTH CLAIX)

The evaluation ships as a Docker image. Clusters do not run Docker, but Apptainer turns
the same image into a `.sif` file, so one image serves a laptop and the cluster.

```
laptop                          cluster ($HPCWORK/totem-eval/)
------                          ------------------------------
docker build  ── image.tar ──►  totem-eval.sif        the code, frozen
                                logs/                 downloaded here, never in git
git clone (for the scripts)     runs/<batch>/<log>/   one run folder per log
                                runs/<batch>/combined/  tables + figures of all logs
```

Logs and results stay outside the image: the image holds the code and the three small
bundled logs only.

## 1. Build the image (on your laptop)

From the `totem_lib` folder. The cluster's CPUs are x86_64, so build for that platform
even on an Apple Silicon Mac:

```bash
docker buildx build --platform linux/amd64 -f evaluation/hpc/Dockerfile \
    --build-arg GIT_COMMIT=$(git rev-parse HEAD) \
    --build-arg GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD) \
    --build-arg GIT_DIRTY=$([ -n "$(git status --porcelain --untracked-files=no)" ] && echo 1 || echo 0) \
    -t totem-eval:latest --load .
docker save totem-eval:latest -o totem-eval.tar
```

The commit goes into the image, so every run records which code it measured. Commit
before building; `GIT_DIRTY=1` marks an image built from uncommitted changes.

## 2. Set up on the cluster (once per image)

```bash
ssh <your-tim-id>@login25-1.hpc.itc.rwth-aachen.de        # or another login node
mkdir -p $HPCWORK/totem-eval
git clone https://github.com/LukasLiss/totem-tool.git ~/totem-tool   # the scripts
```

From the laptop, copy the image over and convert it:

```bash
scp totem-eval.tar <your-tim-id>@login25-1.hpc.itc.rwth-aachen.de:'$HPCWORK/totem-eval/'
```

```bash
cd $HPCWORK/totem-eval
apptainer build totem-eval.sif docker-archive://totem-eval.tar
rm totem-eval.tar
```

Check the IT Center's Apptainer page first: using your own images may require
membership in an Apptainer group, requested through the ServiceDesk.

Instead of copying a tar, you can push the image to a registry (e.g. GitHub Container
Registry) and run `apptainer build totem-eval.sif docker://ghcr.io/<user>/totem-eval:<tag>`.

## 3. Download the logs (once)

Compute nodes may have no internet access, so download on a login node. Every file is
checked against its MD5 from Zenodo:

```bash
export TOTEM_EVAL_DATA=$HPCWORK/totem-eval/logs
apptainer exec --bind $HPCWORK $HPCWORK/totem-eval/totem-eval.sif totem-eval download
```

`totem-eval download --list` shows what is known and what is already on disk.

## 4. Submit

```bash
cd ~/totem-tool/totem_lib
evaluation/hpc/submit.sh thesis-v1
```

That submits a Slurm array with one task per log on disk, each on a whole node,
measuring every algorithm, plus one small job that draws the figures once all tasks are
done. Options after the batch name go to every task:

```bash
evaluation/hpc/submit.sh thesis-v1 --repeats 5 --algorithms totemDiscovery,totemDiscovery_db
```

Before the first real batch, edit `benchmark.sbatch`:

- set `--partition` and keep it for the whole evaluation, so every log runs on the
  same CPU type;
- set `--account` if you compute on a project rather than your personal quota;
- `--exclusive` books whole nodes for clean timings. That costs the full node's
  core-hours; the comment there shows the cheaper alternative.

**Timeouts.** Each log/algorithm measurement (import, warm-up and repeats together)
is killed after 1 hour (`--timeout`, in seconds) and recorded as failed; the task then
moves on. Each task gets 24 hours (`--time`).

**Restarts.** Run `submit.sh` again with the same batch name to continue a batch. Each
task resumes its run folder and skips what is done, so a task that hit its time limit
loses at most the measurement it was in. Add `--retry-failed` to measure failures
again. Do not resubmit while the first submission is still running: two jobs would
write to the same folders.

## 5. Watch it run

```bash
squeue --me                                    # which tasks are queued or running

apptainer exec --bind $HPCWORK $HPCWORK/totem-eval/totem-eval.sif \
    totem-eval status $HPCWORK/totem-eval/runs/thesis-v1 --watch 60
```

`status` reads only the files a run writes, so it works from a login node while the
tasks run on compute nodes:

```
age-of-empires        5/9    56%
                      running age-of-empires / discover_occn for 23m10s of 1h00m timeout on n23m0123
enron                 9/9   100%
hinge-production      8/9    89%, 1 failed
                      failed: hinge-production / discover_occn: Timeout: no result after 3600 s

All runs: 22/27 measured, 1 failed
```

A pair marked `STALE` has been "running" much longer than its timeout, which means its
job was killed; resubmit to resume. Each task's printed output is in
`runs/<batch>/slurm/`, e.g. `tail -f runs/thesis-v1/slurm/*.out`.

## 6. Results and figures

When the array is done, the figures job combines every log's run folder into
`runs/<batch>/combined/`:

```
combined/
    benchmark_results.csv / .json / .md    every measurement, one table
    scaling_exponents.csv / .md            fitted exponents and R^2
    figures/                               runtime and memory vs. log size, per-algorithm
                                           grids, exponent heatmap, Polars vs DuckDB,
                                           pipeline cost
```

Redraw at any time, e.g. after resubmitting failures, or before the batch is complete
to look at what is there so far:

```bash
apptainer exec --bind $HPCWORK $HPCWORK/totem-eval/totem-eval.sif \
    totem-eval figures $HPCWORK/totem-eval/runs/thesis-v1
```

Or copy the batch to your laptop and draw there; the raw measurements
(`measurements.jsonl`, `run.json`) are all the figures need:

```bash
rsync -a <your-tim-id>@login25-1.hpc.itc.rwth-aachen.de:'$HPCWORK/totem-eval/runs/thesis-v1' .
python evaluation/figures.py thesis-v1
```

## Locally, with Docker

The same image runs on any machine with Docker. Mount a folder at `/data`; logs go to
`/data/logs` and runs to `/data/runs`:

```bash
docker run --rm -v $PWD/eval-data:/data totem-eval:latest download
docker run --rm -v $PWD/eval-data:/data totem-eval:latest run --name laptop
docker run --rm -v $PWD/eval-data:/data totem-eval:latest status /data/runs
```

On an Apple Silicon Mac, build with `--platform linux/arm64` for local use; the
x86_64 image only runs there under emulation.

## Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `TOTEM_EVAL_DATA` | where downloaded logs are kept | `/data/logs` in the image, else `test_data/large` |
| `TOTEM_EVAL_RUNS` | where new run folders go | `/data/runs` in the image, else `evaluation/results/runs` |
| `SIF`, `TOTEM_EVAL_ROOT` | image and base folder for `submit.sh` | `$HPCWORK/totem-eval/...` |
