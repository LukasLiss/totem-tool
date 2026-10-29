# Running TOTeM with Docker

The Docker image runs TOTeM as a multi-user **server**: one container holds the
Django backend, the TOTeM library and the built React frontend, all served on
one port. Unlike the desktop app there is no automatic Guest login — users sign
in with an email/password account you configure, or register themselves with
GitHub or Google.

## Quick start

```bash
cp docker/.env.example .env      # then fill in at least one login method
docker compose up -d
```

Open http://localhost:8000. Data (SQLite database, uploaded logs, result cache
and the generated secret key) lives in the `totem-data` volume, so it survives
`docker compose down` and image updates. `docker compose down -v` deletes it.

Without cloning the repository, the image published by the
`Docker image` workflow can be run directly:

```bash
docker run -d -p 8000:8000 -v totem-data:/data \
  -e TOTEM_USER_EMAIL=admin@example.org -e TOTEM_USER_PASSWORD=change-me \
  ghcr.io/lukasliss/totem-tool:latest
```

`latest` is the newest release; pin a version such as `:0.9.1` to control
upgrades, or use `:main` for the unreleased development state. Images are
published for both `linux/amd64` and `linux/arm64` (e.g. Apple Silicon, ARM
servers).

## Logins

You need at least one of the following; the container logs a warning if none is set.

### Email/password account

| Variable | Meaning |
|---|---|
| `TOTEM_USER_EMAIL` | Email of the account; also its username unless `TOTEM_USER_USERNAME` is set. |
| `TOTEM_USER_PASSWORD` | Its password. Reset to this value on **every** start, so the environment stays the source of truth. |
| `TOTEM_USER_USERNAME` | Optional username, if it should differ from the email. |

When this account is configured the login page shows the email/password form
(override with `DEV_LOGIN=0` / `DEV_LOGIN=1`). The account is a normal user,
not a Django admin. If someone later signs in with GitHub or Google using the
same (provider-verified) email, that login is linked to this account.

Other people cannot register with a password; new accounts are created only
through OAuth.

### GitHub / Google OAuth

| Variable | |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app (Settings → Developer settings → OAuth Apps) |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client (Cloud Console → Credentials → OAuth client ID, type "Web application") |

A provider button appears only when both its id and secret are set. Register
these callback URLs with the provider:

```
<PUBLIC_URL>/auth/oauth/github/callback/
<PUBLIC_URL>/auth/oauth/google/callback/
```

The first OAuth sign-in creates the user; anyone with an account at the
provider can register this way.

## Hosting on a real domain

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8000` | Address users open. Builds the OAuth callback URL and the allowed host name. |
| `TOTEM_PORT` | `8000` | Host port (docker compose only). |

Put the container behind a reverse proxy that terminates HTTPS and set
`PUBLIC_URL=https://your.domain`. OAuth needs HTTPS on anything but
`localhost`: its login cookie is marked Secure and browsers drop it on plain
http.

## Advanced settings

| Variable | Default | Meaning |
|---|---|---|
| `SECRET_KEY` | generated into `/data/.secret_key` | Signs login tokens. Set it to manage it yourself. |
| `DATABASE_URL` | SQLite in `/data` | e.g. `postgres://…` to use PostgreSQL. |
| `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL`, `OAUTH_REDIRECT_BASE_URL` | derived from `PUBLIC_URL` | Override only for unusual proxy setups. |
| `GUNICORN_WORKERS` | `1` | Keep at 1: the OCEL cache and cancellable jobs live in process memory. |
| `GUNICORN_THREADS` | `8` | Concurrent requests. |
| `GUNICORN_TIMEOUT` | `300` | Seconds before a long request is killed. |
| `ENABLE_ADMIN` | off | `1` mounts the Django admin at `/admin/` (create a superuser with `docker compose exec totem python manage.py createsuperuser`). |

## How it is put together

- `Dockerfile` — builds the frontend with `VITE_API_URL=/` (same-origin API),
  then installs `totem_lib` and the backend into a Python image.
- `docker/entrypoint.sh` — derives settings from `PUBLIC_URL`, creates the
  secret key, runs migrations and `manage.py ensure_initial_user`, starts Gunicorn.
- Django serves the frontend: WhiteNoise serves the build's files from
  `TOTEM_FRONTEND_DIR`, and every path outside `api/`, `token/`, `auth/`,
  `admin/`, `static/` and `files/` returns `index.html` for client-side routing.
  Uploaded images under `/files/` are served; uploaded event logs are not.
