# Developer Guide

Welcome to the TOTeM-Tool development guide! This document covers everything you need to know to set up your environment, manage dependencies, and build the application.

## 🛠️ Prerequisites

- **Node.js** (v18 or v20 recommended)
- **Python** (3.10 or higher)

## ⚡ Quick Start (The "Magic" Command)

We have a unified setup script that handles:
1.  Creating the Python Virtual Environment (`backend/.venv`).
2.  Installing **Backend** dependencies.
3.  Installing **Build** tools (`pyinstaller`).
4.  Linking **Totem Lib** in "Editable Mode".
5.  Applying Django **migrations** (creates `db.sqlite3` and seeds the `Guest` user used for local-mode auto-login).
6.  Installing **Frontend** & **Electron** dependencies.

Just run:

```bash
npm run setup-env
```

If prompted, type `y` to proceed.

---

## 🐍 Python Environment Strategy

We use a **Unified Development Environment** strategy to avoid confusion.

- **Location**: `backend/.venv` on **all** operating systems (Windows, macOS, Linux).
- **Purpose**: This SINGLE virtual environment is used for:
    - Running the Django Backend.
    - Developing `totem_lib`.
    - Running Tests (`pytest`).
    - Building the App (`pyinstaller`).

The folder name is identical across OSes — only the path *inside* the venv differs (`Scripts\python.exe` on Windows vs `bin/python` elsewhere). All npm scripts go through `scripts/run-python.js`, which resolves the correct interpreter for the host platform, so you usually don't need to activate the venv at all.

### Running an arbitrary python command

```bash
node scripts/run-python.js <args...>
# e.g.
node scripts/run-python.js -m pytest totem_lib/tests
node scripts/run-python.js backend/manage.py migrate
```

### Activating the Environment manually (optional)

**Windows (PowerShell):**
```powershell
.\backend\.venv\Scripts\Activate.ps1
```

**Mac/Linux:**
```bash
source backend/.venv/bin/activate
```

---

## 📦 Dependency Management

This project consists of two Python components that live together.

### 1. `totem_lib` (The Algorithm Library)
This is a standalone library. Its source of truth is **`totem_lib/pyproject.toml`**.

**To add a dependency to the library:**
1.  Edit `totem_lib/pyproject.toml` and add the package to the `dependencies` list.
2.  Update your environment:
    ```bash
    npm run setup-env
    ```
    (Or manually with `backend/.venv` active: `pip install -e totem_lib`)

### 2. `backend` (The Django App)
This is the application server. Its source of truth is **`backend/requirements.txt`**.

**To add a dependency to the backend:**
1.  Edit `backend/requirements.txt`.
2.  Update your environment:
    ```bash
    npm run setup-env
    ```

### 3. Build & Test Tools
Tools like `pyinstaller` and `pytest` are listed in **`backend/requirements-dev.txt`**.

---

## 🧪 Running Tests

Since `totem_lib` is installed in editable mode, you can test it directly from the root using the unified environment.

```bash
# Cross-platform — no activation needed
npm run test-backend
# or, equivalently:
node scripts/run-python.js -m pytest totem_lib/tests

# Single test:
node scripts/run-python.js -m pytest totem_lib/tests/test_foo.py::test_bar
```

---

## 🏗️ Building the Application

To create the standalone Windows Executable (`.exe`), pyinstaller needs to be in the active environment (e.g. by installing `backend/requirements-dev.txt`). Run the following from root:

```bash
# This script builds Backend (PyInstaller), Frontend (Vite), and packages them with Electron.
npm run build-all
```

The output will be in `electron/dist/`.

---

## 🚀 Running the Application locally for Development

**Option 1: Electron Dev Mode (Recommended)**
```bash
npm run electron-dev
```
Starts everything: Backend (Port 8000), Frontend (Port 3000), and Electron Window.

**Option 2: Manual Start**
If you want to run components separately:

1.  **Backend** (cross-platform):
    ```bash
    npm run start-backend
    # or:
    node scripts/run-python.js backend/manage.py runserver 8000
    ```
2.  **Frontend**:
    ```bash
    cd frontend
    npm start
    ```
3.  **Electron**:
    ```bash
    cd electron
    npm start
    ```

---

## 👤 Local Mode vs. Server Mode (Authentication)

The app ships in two flavors. By default it runs in **local mode** — intended for the desktop install where one operating-system user owns one machine and shouldn't have to deal with accounts.

### Local mode (default)

When the migrations run (as part of `npm run setup-env`), Django seeds a single shared account:

- **Username:** `Guest`
- **Password:** `guest`

The frontend then auto-logs-in as `Guest` on every startup and skips the login/title screens. The backend additionally extends JWT lifetimes to 8 h access / 7 days refresh so the user never gets bounced mid-session on their own machine.

The Guest seed lives in `backend/authentification/migrations/0001_seed_guest_user.py` and is idempotent (`get_or_create`), so re-running migrations never duplicates or overwrites it.

### Server mode (multi-user install)

For a hosted/shared deployment you want the normal login flow: each visitor gets their own account, short-lived tokens, and no shared `Guest` identity. Local mode is controlled by **two independent flags** — disable both:

| Flag | Where | Effect when set | How to disable |
| --- | --- | --- | --- |
| `LOCAL_MODE` | **Backend** environment variable, read in [`backend/totem_backend/settings.py`](backend/totem_backend/settings.py) | Extends JWT access token lifetime to 8 h and refresh to 7 days. | Do **not** set the env var (or set `LOCAL_MODE=0`). Tokens fall back to the short hosted-mode lifetimes (~1 min access / ~2 min refresh). |
| `VITE_LOCAL_MODE` | **Frontend** build-time variable, baked in by Vite | Frontend auto-POSTs `Guest`/`guest` to `/token/` on startup, skips the login screen, and silently re-auths as Guest on token expiry. | Build the frontend without the variable: use `npm run build-frontend-server` instead of `npm run build-frontend`. The login screen will appear normally. |

#### Building for a server deployment

```bash
# Frontend WITHOUT auto-Guest-login
npm run build-frontend-server

# Backend: just don't set LOCAL_MODE in the environment that runs Django.
# For example, with a systemd unit or Docker, simply omit the variable.
```

If you also want to remove the seeded Guest account from a server DB, delete the row manually after migrating — the migration won't recreate it on subsequent runs.

#### Quick reference: how each script sets the flags

- `npm run setup-env` — runs `migrate`, which seeds the Guest user. No flag toggling.
- `npm run electron-dev` — sets `LOCAL_MODE=1` for the backend and `VITE_LOCAL_MODE=1` for the frontend dev server (local mode).
- `npm run dev` — does **not** set either flag. Useful for testing the server-mode login flow against your local backend.
- `npm run build-frontend` — bakes `VITE_LOCAL_MODE=1` into the bundle (local-mode desktop build).
- `npm run build-frontend-server` — builds the same bundle **without** the flag (server-mode build).
- Electron's `main.js` injects `LOCAL_MODE=1` when it spawns its own backend in a packaged desktop install.
