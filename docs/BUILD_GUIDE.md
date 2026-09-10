# Building the TOTeM-Tool Installers

How to produce the desktop installers: a `.dmg` for macOS and a `.exe` for Windows.

Tracked under [#41](https://github.com/LukasLiss/totem-tool/issues/41). Both installers are
currently **unsigned** — see [Code signing](#code-signing) for what that means for users.

---

## What the app actually is

The desktop app is the same code as the web deployment, delivered differently:

- **Frontend** — React, built by Vite into static files
- **Backend** — Django, frozen by PyInstaller into a self-contained executable
- **Electron** — a Chrome window that starts both locally and points at `localhost`

Users need neither Python nor Node installed. The app runs entirely offline; no data leaves
the machine.

## Prerequisites

```bash
npm run setup-env                                       # one-time
./backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt   # PyInstaller
cd electron && npm install && cd ..
```

On Windows use `backend\.venv\Scripts\python.exe` instead.

## Building

```bash
npm run build-all-mac     # → electron/dist/TOTeM-Tool-<version>.dmg
npm run build-all         # → electron/dist/TOTeM-Tool-Setup-<version>.exe
```

Roughly 4–5 minutes, most of it PyInstaller.

> **You cannot cross-compile.** PyInstaller bundles a platform-specific Python interpreter,
> so the macOS build must run on macOS and the Windows build on Windows. There is no flag
> for this — it needs two machines, or two CI runners.

The chain is: PyInstaller (backend) → Vite (frontend) → copy into `electron/resources/` →
electron-builder (package). Individual steps are separate npm scripts if you need them.

### Rebuilding after a change

Only backend changes need the slow path:

| Changed | Command | Time |
|---|---|---|
| `electron/main.js`, `electron/package.json` | `npm run build-electron-mac` | ~30 s |
| Frontend code | `build-frontend` + `copy:frontend` + `build-electron-mac` | ~1 min |
| `totem_backend.spec`, backend, `totem_lib` | `npm run build-all-mac` | ~4 min |

Before installing a new build, remove the old app — dragging over an existing one merges
rather than replaces, and stale files survive:

```bash
rm -rf /Applications/TOTeM-Tool.app
```

## Where the app stores data

The app writes **outside** its installation directory, in the per-user data folder:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/TOTeM-Tool/` |
| Windows | `%APPDATA%\TOTeM-Tool\` |

That folder holds `db.sqlite3`, `user_files/` (uploaded logs) and `cache/`. Electron passes
the path to the backend as `TOTEM_DATA_DIR`; `settings.py` falls back to `BASE_DIR` when it
is unset, so development and the Railway deployment are unaffected.

**This matters more than it looks.** Writing inside the bundle fails for a non-admin user on
Windows, breaks entirely for a second user account, and — once the app is signed — invalidates
the macOS code signature, so Gatekeeper refuses to launch it. The database is created and
seeded on **first launch**, not at build time.

To test a first run, delete that folder and relaunch.

## Testing a build

Always on a clean machine or a fresh user account. Every packaging bug found so far was
invisible on the machine that built the app.

1. Install to `/Applications` (macOS) or as a **standard, non-admin user** (Windows)
2. Upload an OCEL log, run a miner
3. Quit and relaunch — the project must still be there
4. Confirm nothing was written inside the app bundle:
   ```bash
   find /Applications/TOTeM-Tool.app -newer /Applications/TOTeM-Tool.app/Contents/Info.plist
   ```
   Any output is a bug.
5. Log in as a different user — the app must start with its own empty database

## Code signing

Both installers are unsigned today, so users see a warning:

- **macOS** — *"TOTeM-Tool is damaged and can't be opened."* Not a trust prompt; it reads as
  a corrupt download. Right-click → **Open** bypasses it.
- **Windows** — *"Windows protected your PC"* → **More info** → **Run anyway**.

Fixing this needs an Apple Developer Program membership and a Windows signing service.
Costs, vendors and setup are documented in [`cert_svc_prov.md`](../cert_svc_prov.md).
Tracked separately in [#42](https://github.com/LukasLiss/totem-tool/issues/42) and
[#43](https://github.com/LukasLiss/totem-tool/issues/43).

## Packaging pitfalls

Every one of these was a real bug. None reproduce under `npm run electron-dev` — they exist
only in packaged builds, which is why the app must be tested as an installed app.

**PyInstaller cannot see modules referenced by string.** Django loads middleware and apps by
name (`'whitenoise.middleware.WhiteNoiseMiddleware'`), and PyInstaller only follows real
`import` statements. Anything loaded by string must be declared in `hiddenimports` in
`totem_backend.spec`. Symptom: the app builds fine, `migrate` works, and only `runserver`
dies — because that is the first thing to load the middleware stack.

**Bundled dylibs can shadow Python's own.** `psycopg2-binary` ships its own OpenSSL, which
overrode the copy Python's `_ssl` links against and broke *all* SSL — surfacing as a 500 on
`/token/`. It is excluded in the spec, since the desktop build only ever uses SQLite. Watch
for this whenever a dependency ships `.dylibs/`.

**Port 5000 is taken on macOS.** AirPlay Receiver listens there and answers every request
with `403 Forbidden`. The frontend server uses `listen(0)` for an OS-assigned free port —
don't hardcode one.

**`files` and `extraResources` land in different places.** electron-builder puts `files`
under `Resources/app/` and `extraResources` directly under `Resources/`. The frontend uses
the first, the backend the second, so `__dirname` is correct for one and
`process.resourcesPath` for the other. Mixing them serves a directory that does not exist:
a blank white window.

**Icons live in `electron/build/`,** which the root `.gitignore` excludes via `build/`. There
is an explicit negation for `electron/build/icon.png`; without it the icon stays on one
developer's machine and every other build silently ships the default Electron logo.

## Troubleshooting

**Blank white window** — the frontend was not found or did not load. Press <kbd>⌥⌘I</kbd>
(<kbd>Ctrl+Shift+I</kbd>) for DevTools; the Console and Network tabs show whether
`index.html` and the JS bundle resolve.

**App starts, no window ever appears** — the backend died during startup. It should now
report this in a dialog. To see the underlying error, run the bundled backend by hand:

```bash
cd /Applications/TOTeM-Tool.app/Contents/Resources/backend
LOCAL_MODE=1 ./totem_backend runserver 8000 --noreload
```

**`Port already in use`** — something else holds 8000. The app refuses to adopt a foreign
server (its health check requires TOTeM's own response), so it will not start silently
misconfigured.
