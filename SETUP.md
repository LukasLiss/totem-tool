# TOTeM-Tool Setup Guide

## Project Structure
```
totem-tool/
├── backend/           # Django REST API
├── frontend/         # React application  
├── electron/         # Electron wrapper
├── totem_lib/        # TOTeM library
└── package.json      # Root package management
```

## Installation

1. **Set up Python virtual environment and install dependencies:**
   ```bash
   cd backend
   python -m venv venv
   source venv/Scripts/activate  # On Windows Git Bash
   # OR: venv\Scripts\activate   # On Windows CMD
   # OR: source ./venv/bin/activate # On Unix Systems, e.g. Linux or MacOS
   pip install -r requirements.txt
   pip install -e ../totem_lib
   python manage.py migrate #create db.sqlite3 file (the database)
   python manage.py loaddata initial_user.json #Loads a Guest User

   cd ..
   ```

2. **Install Node.js dependencies:**
   ```bash
   cd frontend && npm install && cd ..
   cd electron && npm install && cd ..
   npm install
   ```

## Development

### Method 1: Manual startup (Recommended for testing)
1. **Start Backend:**
   ```bash
   cd backend
   source venv/Scripts/activate  # Activate virtual environment
   # source ./venv/bin/activate  # On Unix
   python manage.py runserver 8000
   ```

2. **Start Frontend:** (in another terminal)
   ```bash
   cd frontend
   npm start
   ```

3. **Start Electron:** (in another terminal)
   ```bash
   cd electron
   NODE_ENV=development npm start
   ```

### Method 2: Automated startup
```bash
npm run electron-dev
```

## Testing the Setup

1. **Test Backend API:**
   ```bash
   curl http://localhost:8000/api/greeting/
   ```
   Should return: `{"message":"Hello, greetings from the backend!"}`

2. **Test Frontend:**
   Open http://localhost:3000 in browser
   Should display: "Hello, greetings from the backend!"

3. **Test Electron App:**
   The Electron window should open and display the same greeting.

## Building for Production

1. **Build Frontend:**
   ```bash
   npm run build-frontend
   ```

2. **Build Executable:**
   ```bash
   npm run build-electron-win
   ```

The executable will be created in `electron/dist/`

## API Endpoints

- `GET /api/greeting/` - Returns a greeting message from the backend

## Current Status
✅ Django backend with REST API
✅ React frontend with API integration  
✅ Electron wrapper with backend auto-start
✅ Build process for Windows executable
✅ CORS configuration for frontend-backend communication