#!/bin/sh
# Container start: derive same-origin defaults from PUBLIC_URL, make sure a
# SECRET_KEY exists, migrate, seed the optional password-login account, and
# run Gunicorn. Every derived value can still be overridden explicitly.
set -e

# Railway publishes its generated domain; elsewhere PUBLIC_URL is set by hand.
if [ -z "${PUBLIC_URL:-}" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    PUBLIC_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
fi
if [ -n "${PUBLIC_URL:-}" ]; then
    PUBLIC_URL="${PUBLIC_URL%/}"
    public_host=$(printf '%s' "$PUBLIC_URL" | sed -E 's#^[a-zA-Z]+://##; s#[:/].*$##')
    export ALLOWED_HOSTS="${ALLOWED_HOSTS:-$public_host,localhost,127.0.0.1}"
    export CSRF_TRUSTED_ORIGINS="${CSRF_TRUSTED_ORIGINS:-$PUBLIC_URL}"
else
    # settings.py's default ALLOWED_HOSTS already cover localhost.
    PUBLIC_URL="http://localhost:${PORT:-8000}"
fi

# Frontend and API share one origin, so OAuth sends the browser back to it.
export FRONTEND_URL="${FRONTEND_URL:-$PUBLIC_URL}"
export OAUTH_REDIRECT_BASE_URL="${OAUTH_REDIRECT_BASE_URL:-$PUBLIC_URL}"

# Show the email/password form when a password account is configured.
if [ -z "${DEV_LOGIN:-}" ] && [ -n "${TOTEM_USER_EMAIL:-}" ]; then
    export DEV_LOGIN=1
fi

# JWTs are signed with SECRET_KEY: generate one per installation and keep it
# in the data volume so logins survive restarts.
if [ -z "${SECRET_KEY:-}" ]; then
    key_file="${TOTEM_DATA_DIR:-/data}/.secret_key"
    if [ ! -s "$key_file" ]; then
        python -c 'import secrets; print(secrets.token_urlsafe(50))' > "$key_file"
        chmod 600 "$key_file"
    fi
    SECRET_KEY=$(cat "$key_file")
    export SECRET_KEY
fi

python manage.py migrate --noinput
python manage.py ensure_initial_user

if [ -z "${TOTEM_USER_EMAIL:-}" ] && [ -z "${GITHUB_OAUTH_CLIENT_ID:-}" ] && [ -z "${GOOGLE_OAUTH_CLIENT_ID:-}" ]; then
    echo "WARNING: no login method is configured. Set TOTEM_USER_EMAIL/TOTEM_USER_PASSWORD" >&2
    echo "         and/or GitHub/Google OAuth credentials; see docs/DOCKER.md." >&2
fi

echo "TOTeM is starting on ${PUBLIC_URL}"

# One worker with threads: the OCEL cache and the job registry
# (api/jobs.py) live in process memory, so several workers would each hold
# their own copy and could not cancel each other's computations.
exec gunicorn totem_backend.wsgi:application \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${GUNICORN_WORKERS:-1}" \
    --threads "${GUNICORN_THREADS:-8}" \
    --timeout "${GUNICORN_TIMEOUT:-300}"
