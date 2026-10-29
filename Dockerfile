# TOTeM in one container: the built React frontend is served by Django
# (WhiteNoise + an index.html catch-all), so frontend and API share one origin.
# See docs/DOCKER.md.

# ---- Frontend build ---------------------------------------------------------
FROM node:22-slim AS frontend

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
# Type-checked test files import example models from docs/examples.
COPY docs/examples /app/docs/examples
# "/" makes the API base URL empty, so every request goes to the same origin.
RUN VITE_API_URL=/ npm run build

# ---- Runtime ----------------------------------------------------------------
FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# Install system dependencies (including graphviz C-library and build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    graphviz \
    graphviz-dev \
    gcc \
    g++ \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy totem_lib first to leverage Docker layer caching
COPY totem_lib /app/totem_lib
RUN pip install --no-cache-dir -e /app/totem_lib

# Copy backend requirements and install
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend application
COPY backend /app/backend
COPY --from=frontend /app/frontend/dist /app/frontend_dist
COPY docker/entrypoint.sh /app/entrypoint.sh

WORKDIR /app/backend

# Collect static files for WhiteNoise (build-time only key; DEBUG is still
# the default here, so no real secret is needed)
RUN python manage.py collectstatic --noinput

# Server mode: no Guest auto-login, no debug pages. Uploads, the SQLite
# database and the generated secret key live in /data (mount a volume there).
ENV DEBUG=0 \
    TOTEM_DATA_DIR=/data \
    TOTEM_FRONTEND_DIR=/app/frontend_dist
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/auth/login-options/" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
