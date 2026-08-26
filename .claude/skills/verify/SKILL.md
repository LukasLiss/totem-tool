---
name: verify
description: Build, launch, and drive the TOTeM tool (Django backend + Vite frontend) to verify a change end-to-end in a headless environment.
---

# Verifying changes in the TOTeM tool

## One-time setup (fresh container)

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/pip install -e "totem_lib[test]"
backend/.venv/bin/python backend/manage.py migrate --no-input   # seeds Guest/guest user
cd frontend && npm install
```

## Launch

```bash
# Backend (port 8000). LOCAL_MODE=1 extends JWT lifetimes.
LOCAL_MODE=1 backend/.venv/bin/python backend/manage.py runserver 8000 --noreload

# Frontend (port 3000). VITE_LOCAL_MODE=1 auto-logs-in as Guest.
cd frontend && VITE_LOCAL_MODE=1 npx vite --port 3000 --strictPort
```

Health checks: `GET :8000/api/health-check/` and `GET :3000/`.

## Drive (Playwright)

- Chromium is pre-installed at `/opt/pw-browsers/chromium`; install the
  `playwright` npm package in a scratch dir, then
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] })`.
- **Gotcha:** the container routes HTTP through a proxy; without
  `--no-proxy-server` the browser cannot reach `localhost:8000`
  (ERR_CONNECTION_RESET). Same for curl: use `curl --noproxy '*'`.
- In LOCAL_MODE the app lands on `/upload`; the sidebar views live at
  `/overview` — navigate there first, then click sidebar entries
  (e.g. "Playout").
- Auth for direct API probes: `POST :8000/token/` with
  `{"username": "Guest", "password": "guest"}` → `Authorization: Bearer <access>`.

## Flows worth driving

- Playout: `/overview` → sidebar "Playout" → "Example OCPN"/"Example OCCN" →
  "Run playout" → `[data-testid=playout-summary]`; exports fire browser
  downloads (capture with `page.waitForEvent('download')`).
- Uploads and dashboards need an OCEL file; samples in `backend/user_files/`.

## Test suites (CI-equivalent, not verification)

- Lib: `cd totem_lib && ../backend/.venv/bin/python -m pytest tests/ -q` (~4 min)
- Backend: `backend/.venv/bin/python backend/manage.py test api`
- Frontend: `cd frontend && npx vitest run && npm run build`
  (`npx tsc -b --noEmit` has ~138 pre-existing errors in unrelated files — compare counts, not zero.)
