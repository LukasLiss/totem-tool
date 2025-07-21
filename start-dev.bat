@echo off
echo Starting TOTeM-Tool Development Environment...
echo.

echo Setting development environment...
set NODE_ENV=development

echo Starting backend, frontend, and Electron concurrently...
echo This will open 3 services:
echo   - Django backend (port 8000)
echo   - React frontend (port 3000) 
echo   - Electron desktop app
echo.

npm run electron-dev