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
5.  Installing **Frontend** & **Electron** dependencies.

Just run:

```bash
npm run setup-env
```

If prompted, type `y` to proceed.

---

## 🐍 Python Environment Strategy

We use a **Unified Development Environment** strategy to avoid confusion.

- **Location**: `backend/.venv`
- **Purpose**: This SINGLE virtual environment is used for:
    - Running the Django Backend.
    - Developing `totem_lib`.
    - running Tests (`pytest`).
    - Building the App (`pyinstaller`).

### Activating the Environment manually

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
# Activate the environment first!
.\backend\.venv\Scripts\Activate.ps1  # Windows

# Run library tests
pytest totem_lib/tests
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

1.  **Backend**:
    ```bash
    cd backend
    ..\backend\.venv\Scripts\python manage.py runserver
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
