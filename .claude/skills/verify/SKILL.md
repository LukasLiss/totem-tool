---
name: verify
description: Launch and drive the TOTeM-Tool web app (Django backend + Vite frontend) headlessly to verify frontend/backend changes end-to-end.
---

# Verifying TOTeM-Tool changes in the running app

## Launch (no-auth guest mode)

```bash
# backend (own venv lives in backend/.venv)
cd backend && LOCAL_MODE=1 .venv/bin/python manage.py runserver 8000
# frontend — serves on http://localhost:3000
cd frontend && VITE_LOCAL_MODE=1 npm run dev
```

`LOCAL_MODE=1` + `VITE_LOCAL_MODE=1` = guest auto-login (what `npm run electron-dev` uses).
Backend edits under `totem_lib/` do NOT trigger Django autoreload — restart manually.

## Drive (Playwright)

No Playwright in the repo; install `playwright` in a scratch dir (`npm i playwright`) —
Chromium is usually already in `~/Library/Caches/ms-playwright`. Headless works.

Boot flow that reaches the main app:

1. `goto http://localhost:3000/` → wait ~2.5s → press `Escape` (splash)
2. Click text `Select OCEL File` → click a file (e.g. `order-management`) → button `Open File`
3. Lands on `/overview`. Sidebar: **Analysis** group (Process Area, OC-DFG, Variants,
   OC Dotted Chart, OCCN), **Dashboards**, **Editor** group (TOTeM Model, OC Causal Net,
   OC Petri Net).

Gotchas:
- Sidebar group *labels* and nav *buttons* share text — click `getByRole('button', {name})`,
  not the first text match (e.g. "Dashboards").
- OCCN discovery for order-management takes ~50s uncached; warm the cache first with
  `curl 'http://127.0.0.1:8000/api/occn/?file_id=1&relativeOccuranceThreshold=0'`
  (endpoint is AllowAny; threshold changes are then ~instant). File ids:
  `sqlite3 backend/db.sqlite3 "SELECT id, file FROM api_eventlog"`.
- Visualizer threshold sliders are uncontrolled with commit-per-interaction and disable
  while loading — set them with a single track click, not keyboard stepping.
- OCCN marker overlay = the SVG with inline `z-index: 900`; editor markers carry
  `data-occn-marker` attributes (JSON `[activity, side, groupIndex]`).
- `tsc -b` has many pre-existing errors (componentMap/gridstack); grep tsc output for the
  files you touched instead. `/api/totem/`-backed views 500 for logs without Totem
  discovery — pre-existing, unrelated noise in the console.

## Known-good visual checks

- Analysis → OCCN: markers on arcs, "+N in/out" chips on dense activities, threshold
  prunes, LR/TB toggle relayouts.
- Dashboards → "OCCN Test" (guest db) has two persisted OCCN widgets; the second is
  intentionally stale (threshold 1.0 + orders filter) and hits a pre-existing backend
  validation error — useful as an error-path check.
- Editor → OC Causal Net → `Example` button loads the shipping example; markers are
  click-selectable and drag-mergeable; `Meta+Z` undoes.
