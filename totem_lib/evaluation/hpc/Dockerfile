# The runtime evaluation of totem_lib, packaged to run anywhere: a laptop with Docker,
# or an HPC cluster with Apptainer (which converts this image to a .sif file).
#
# Build from the totem_lib folder, for the cluster's CPU architecture:
#
#   docker buildx build --platform linux/amd64 -f evaluation/hpc/Dockerfile \
#       --build-arg GIT_COMMIT=$(git rev-parse HEAD) -t totem-eval:latest --load .
#
# The image holds the code and the three small bundled logs only. Large logs and run
# results live outside it, in the folders TOTEM_EVAL_DATA and TOTEM_EVAL_RUNS point to
# (default /data/logs and /data/runs, so mount something at /data). evaluation/hpc/README.md
# has the full workflow.

FROM python:3.13-slim

WORKDIR /opt/totem/totem_lib

# Dependencies first, in their own layer, so a code change does not reinstall them.
COPY pyproject.toml README.md LICENSE ./
COPY src ./src
RUN pip install --no-cache-dir . certifi

COPY evaluation ./evaluation
COPY test_data/small/*.json ./test_data/small/
RUN install -m 0755 evaluation/hpc/totem-eval /usr/local/bin/totem-eval

# The commit the image was built from. There is no .git inside, so the run metadata
# reads these instead (evaluation/environment.py).
ARG GIT_COMMIT=""
ARG GIT_BRANCH=""
ARG GIT_DIRTY="0"
ARG IMAGE_TAG="totem-eval"

# TOTEM_EVAL_DATA / TOTEM_EVAL_RUNS are deliberately not set here: Apptainer lets
# variables baked into an image override the host's, so a cluster job could not point
# them at $HPCWORK. The totem-eval script falls back to /data when they are unset.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib \
    TOTEM_EVAL_HOME=/opt/totem/totem_lib/evaluation \
    TOTEM_GIT_COMMIT=${GIT_COMMIT} \
    TOTEM_GIT_BRANCH=${GIT_BRANCH} \
    TOTEM_GIT_DIRTY=${GIT_DIRTY} \
    TOTEM_IMAGE=${IMAGE_TAG}

ENTRYPOINT ["totem-eval"]
CMD ["help"]
