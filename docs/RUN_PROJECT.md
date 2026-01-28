# How to Run the Project

This guide provides the steps to run the Django backend, the React frontend, and the `totem_lib` (in development mode).

## Prerequisites

- Python 3.11 or higher
- Node.js 20 or higher
- `pip` and `npm` package managers

## Installation

1.  **Set up a virtual environment (recommended):**
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows, use `venv\Scripts\activate`
    ```

2.  **Install Python dependencies:**
    ```bash
    pip install -e totem_lib
    pip install -r backend/requirements.txt
    ```
    The first command installs `totem_lib` in "editable" mode, which means any changes you make to the library's source code will be immediately available to the backend without needing to reinstall. It also installs all of `totem_lib`'s own dependencies.

4.  **Install frontend dependencies:**
    ```bash
    cd frontend
    npm install
    cd ..
    ```

## Running the Application

1.  **Run the backend server:**
    ```bash
    python backend/manage.py migrate
    python backend/manage.py loaddata initial_user.json
    python backend/manage.py runserver
    ```
    The backend will be running at `http://127.0.0.1:8000`.

2.  **Run the frontend development server:**
    ```bash
    cd frontend
    npm run dev
    ```
    The frontend will be running at `http://localhost:5173`.
