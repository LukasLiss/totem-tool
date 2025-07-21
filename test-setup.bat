@echo off
echo Starting TOTeM-Tool Test Setup...
echo.

echo 1. Starting Django backend...
cd backend
call venv\Scripts\activate
start /b python manage.py runserver 8000
cd ..

echo 2. Waiting for backend to start...
timeout /t 5 /nobreak >nul

echo 3. Testing API endpoint...
curl http://localhost:8000/api/greeting/
echo.

echo 4. Starting Electron app...
cd electron
start electron .
cd ..

echo.
echo Setup complete! The Electron app should open and display the greeting from the backend.
echo Press any key to continue...
pause