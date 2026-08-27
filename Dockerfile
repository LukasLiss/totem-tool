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

WORKDIR /app/backend

# Create runtime directories for user uploads, results cache, and static files
RUN mkdir -p /app/backend/user_files /app/backend/cache/results /app/backend/staticfiles

# Collect static files for WhiteNoise
RUN python manage.py collectstatic --noinput

EXPOSE 8000

# Run migrations, seed default Guest user if not present, and launch Gunicorn
CMD sh -c "python manage.py migrate --noinput && python manage.py loaddata initial_user.json && gunicorn totem_backend.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3 --timeout 300"
