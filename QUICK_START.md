# TOTeM-Tool Quick Start

## Quick Environment Setup
Run the bootstrap script
```bash
npm run setup-env
```

## ✅ What's Done
Your TOTeM-Tool project is completely set up with:
- Django backend with virtual environment (contains PyInstaller and totem_lib)
- React frontend 
- Electron desktop wrapper
- Build scripts for Windows executable

## 🚀 Start Development

### Option 1: One-click start (Windows)
```bash
# Double-click or run:
start-dev.bat
```

### Option 2: Automated start (Cross-platform)
```bash
npm run electron-dev
```

### Option 3: Manual start (3 terminals)

**Terminal 1 - Backend:**
```bash
cd backend
source venv/Scripts/activate
# OR: venv\Scripts\activate   # On Windows CMD
# OR: source ./venv/bin/activate # On Unix Systems, e.g. Linux or MacOS
python manage.py runserver 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm start
```

**Terminal 3 - Electron:**
```bash
cd electron
NODE_ENV=development npm start
```

> **Note:** The Electron app will automatically detect if the backend is already running and won't try to start another instance. This prevents port conflicts during development.

### 2. Test the API
```bash
curl http://localhost:8000/api/greeting/
# Should return: {"message":"Hello, greetings from the backend!"}
```

### 3. View the App
- Frontend: http://localhost:3000
- Electron window should open automatically
- Both should show: "Hello, greetings from the backend!"

## 📦 Build Executable
```bash
npm run build-all
```
Creates Windows .exe in `electron/dist/`

## ⚡ Next Steps
Your foundation is ready! Now you can:
1. Add more API endpoints in `backend/api/views.py`
2. Build React components in `frontend/src/`
3. Extend the Electron wrapper as needed

The virtual environment is properly configured and all dependencies are installed!