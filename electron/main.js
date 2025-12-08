const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const express = require('express');

let mainWindow;
let backendProcess;
let frontendServer;
const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (isDev) {
    // In development, load from development server
    console.log('Development mode: Loading from http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from local frontend server
    console.log('Production mode: Loading from http://localhost:5000');
    mainWindow.loadURL('http://localhost:5000');
  }

  // Add error handling for failed loads
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function checkBackendRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:8000/api/health-check/', (res) => {
      console.log('Backend already running on port 8000');
      resolve(true);
    });
    
    req.on('error', () => {
      console.log('Backend not running, will start it');
      resolve(false);
    });
    
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startBackend() {
  return new Promise(async (resolve) => {
    // Check if backend is already running
    const isRunning = await checkBackendRunning();
    if (isRunning) {
      resolve();
      return;
    }

    let backendPath;
    let pythonCommand;
    
    if (isDev) {
      backendPath = path.join(__dirname, '..', 'backend');
      // Use virtual environment python in development
      pythonCommand = path.join(backendPath, 'venv', 'Scripts', 'python');
    } else {
      // In production, backend is in local resources
      const appPath = app.getAppPath();
      backendPath = path.join(appPath, '..', 'backend');
      pythonCommand = path.join(backendPath, 'venv', 'Scripts', 'python.exe');
    }
    
    console.log('Starting Django backend...');
    // Start Django development server
    backendProcess = spawn(pythonCommand, ['manage.py', 'runserver', '8000'], {
      cwd: backendPath,
      stdio: 'pipe'
    });

    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend: ${data}`);
      if (data.toString().includes('Starting development server')) {
        resolve();
      }
    });

    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend Error: ${data}`);
    });

    backendProcess.on('error', (error) => {
      console.error('Failed to start backend:', error);
      resolve(); // Continue anyway, maybe backend is running elsewhere
    });

    backendProcess.on('exit', (code) => {
      console.log(`Backend process exited with code ${code}`);
    });
  });
}

function startFrontendServer() {
  return new Promise((resolve) => {
    if (isDev) {
      resolve();
      return;
    }

    const expressApp = express();
    const frontendPath = path.join(app.getAppPath(), '..', '..', 'frontend-build');
    
    console.log('Serving frontend from:', frontendPath);

    // Serve static files
    expressApp.use(express.static(frontendPath));

    // SPA fallback: redirect all requests to index.html for client-side routing
    expressApp.use((req, res) => {
      res.sendFile(path.join(frontendPath, 'index.html'));
    });

    frontendServer = expressApp.listen(5000, () => {
      console.log('Frontend server running on http://localhost:5000');
      resolve();
    });

    frontendServer.on('error', (error) => {
      console.error('Frontend server error:', error);
      resolve(); // Continue anyway
    });
  });
}

app.whenReady().then(async () => {
  console.log('Starting backend...');
  await startBackend();
  
  if (!isDev) {
    console.log('Starting frontend server...');
    await startFrontendServer();
  }
  
  console.log('Creating window...');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Kill backend if we started it (not in development mode)
  if (backendProcess && !isDev) {
      backendProcess.kill();
  }
  // Kill frontend server if it's running
  if (frontendServer && !isDev) {
      frontendServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Kill backend if we started it (not in development mode)
  if (backendProcess && !isDev) {
      backendProcess.kill();
  }
  // Kill frontend server if it's running
  if (frontendServer && !isDev) {
      frontendServer.close();
  }
});
