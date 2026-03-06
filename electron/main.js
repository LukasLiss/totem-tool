const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const express = require('express');
const treeKill = require('tree-kill'); // Run: npm install tree-kill

let mainWindow;
let backendProcess = null;
let frontendServer = null;
const isDev = process.env.NODE_ENV === 'development';

// 1. ROBUST BACKEND SPAWNER
function startBackend() {
  return new Promise(async (resolve, reject) => {
    // Check if port 8000 is taken (backend might be running externally)
    const isRunning = await checkBackendHealth();
    if (isRunning) {
      console.log('Backend found running independently.');
      resolve();
      return;
    }

    let executable;
    let args = [];
    let cwd;

    if (isDev) {
      // DEV: Use global/root python venv
      // Adjust this path to point to your ROOT .venv
      executable = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
      // Point to manage.py in the backend folder
      const scriptPath = path.join(__dirname, '..', 'backend', 'manage.py');
      args = [scriptPath, 'runserver', '8000', '--noreload'];
      cwd = path.join(__dirname, '..', 'backend');
    } else {
      // PROD: Use the compiled EXE inside resources
      // process.resourcesPath points to the 'resources' folder in the installed app
      const backendDir = path.join(process.resourcesPath, 'backend');
      executable = path.join(backendDir, 'totem_backend.exe');
      
      // The EXE handles 'runserver' internally if you configured your spec entry point correctly, 
      // otherwise pass the args your exe expects.
      args = ['runserver', '8000', '--noreload']; 
      cwd = backendDir;
    }

    console.log(`Spawning Backend: ${executable} ${args.join(' ')}`);

    backendProcess = spawn(executable, args, {
      cwd: cwd,
      shell: false, // CRITICAL: Keep false to allow direct signal handling
      stdio: 'pipe'
    });

    backendProcess.stdout.on('data', (data) => {
      console.log(`[Backend]: ${data}`);
      // Resolve promise when Django says it's ready
      if (data.toString().includes('Starting development server') || data.toString().includes('Quit the server')) {
        resolve();
      }
    });

    backendProcess.stderr.on('data', (data) => console.error(`[Backend Error]: ${data}`));
    
    backendProcess.on('error', (err) => {
      console.error('Failed to start backend:', err);
      reject(err);
    });
  });
}

// 2. HEALTH CHECK HELPER
function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8000/api/health-check/', (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 3. FRONTEND SERVER (Express is fine, but consider serving file:// in prod)
function startFrontendServer() {
  if (isDev) return Promise.resolve();
  
  return new Promise((resolve) => {
    const expressApp = express();
    // In prod, frontend is in resources/app/resources/frontend-build
    const frontendPath = path.join(process.resourcesPath, '/app/resources/frontend-build');
    
    expressApp.use(express.static(frontendPath));
    expressApp.use((req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
    
    frontendServer = expressApp.listen(5000, '127.0.0.1', () => {
      console.log('Frontend serving on port 5000');
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // Optional but recommended
    }
  });

  const url = isDev ? 'http://localhost:3000' : 'http://localhost:5000';
  mainWindow.loadURL(url);

  if (isDev) mainWindow.webContents.openDevTools();
}

// 4. APP LIFECYCLE & CLEANUP
app.whenReady().then(async () => {
  try {
    await startBackend();
    await startFrontendServer();
    createWindow();
  } catch (e) {
    console.error('Startup failed:', e);
    app.quit();
  }
});

// CRITICAL: Robust cleanup
app.on('before-quit', (e) => {
  // We intercept the quit to ensure child processes are dead
  if (backendProcess && !backendProcess.killed) {
    console.log('Killing backend process tree...');
    e.preventDefault(); // Delay quit
    
    // tree-kill ensures subprocesses (like Django spawns) die too
    treeKill(backendProcess.pid, 'SIGKILL', (err) => {
      backendProcess = null;
      if (frontendServer) frontendServer.close();
      app.exit(); // Force exit now that we are clean
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});