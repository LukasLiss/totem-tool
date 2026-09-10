const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const express = require('express');
const treeKill = require('tree-kill'); // Run: npm install tree-kill

let mainWindow;
let backendProcess = null;
let frontendServer = null;
let frontendPort = null;
const isDev = process.env.NODE_ENV === 'development';
const isWin = process.platform === 'win32';

// How to invoke the backend: the venv interpreter + manage.py in development,
// the PyInstaller executable in a packaged build.
function backendTarget(commandArgs) {
  if (isDev) {
    const venvBin = isWin ? ['Scripts', 'python.exe'] : ['bin', 'python'];
    const backendDir = path.join(__dirname, '..', 'backend');
    return {
      executable: path.join(backendDir, '.venv', ...venvBin),
      args: [path.join(backendDir, 'manage.py'), ...commandArgs],
      cwd: backendDir,
    };
  }
  const backendDir = path.join(process.resourcesPath, 'backend');
  return {
    executable: path.join(backendDir, isWin ? 'totem_backend.exe' : 'totem_backend'),
    args: commandArgs,
    cwd: backendDir,
  };
}

// Environment for every backend invocation.
//
// TOTEM_DATA_DIR and DEBUG are deliberately packaged-only. In development the
// backend keeps using its own directory and Django's debug pages, so nothing
// about the dev workflow changes; settings.py falls back to BASE_DIR when
// TOTEM_DATA_DIR is unset.
function backendEnv() {
  const env = { ...process.env, LOCAL_MODE: '1' };
  if (!isDev) {
    env.TOTEM_DATA_DIR = app.getPath('userData');
    env.DEBUG = '0';
  }
  return env;
}

// Run a one-shot management command (migrate, loaddata) to completion.
function runBackendCommand(commandArgs) {
  return new Promise((resolve, reject) => {
    const { executable, args, cwd } = backendTarget(commandArgs);
    const proc = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: 'pipe',
      env: backendEnv(),
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`"${commandArgs.join(' ')}" failed with code ${code}\n${stderr.trim()}`));
    });
  });
}

// Create and seed the database on first launch.
//
// This used to happen at *build* time (npm run db:migrate / db:seed), which
// baked a database into the app bundle. That cannot work once the database
// lives in the user's own directory, and it also meant every install shared one
// pre-made database. Now the first run creates it where the user can write.
async function ensureDatabase() {
  if (isDev) return; // dev keeps its own backend/db.sqlite3, managed by hand

  const fs = require('fs');
  const dbPath = path.join(app.getPath('userData'), 'db.sqlite3');
  if (fs.existsSync(dbPath)) return;

  console.log(`First launch: creating database at ${dbPath}`);
  await runBackendCommand(['migrate', '--noinput']);
  // The fixture is bundled next to the executable, under _internal/.
  await runBackendCommand(['loaddata', path.join('_internal', 'initial_user.json')]);
}

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

    const { executable, args, cwd } = backendTarget(['runserver', '8000', '--noreload']);

    console.log(`Spawning Backend: ${executable} ${args.join(' ')}`);

    backendProcess = spawn(executable, args, {
      cwd: cwd,
      shell: false, // CRITICAL: Keep false to allow direct signal handling
      stdio: 'pipe',
      env: backendEnv(),
    });

    backendProcess.stdout.on('data', (data) => {
      console.log(`[Backend]: ${data}`);
      // Resolve promise when Django says it's ready
      if (data.toString().includes('Starting development server') || data.toString().includes('Quit the server')) {
        resolve();
      }
    });

    let stderrBuffer = '';
    backendProcess.stderr.on('data', (data) => {
      stderrBuffer += data;
      console.error(`[Backend Error]: ${data}`);
    });

    backendProcess.on('error', (err) => {
      console.error('Failed to start backend:', err);
      reject(err);
    });

    // Without this the promise never settles when the backend dies during
    // startup: it only resolves on a specific stdout line, so a crashed backend
    // leaves the app running with no window and no error — it just hangs.
    backendProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(
          `Backend exited with code ${code} before becoming ready.\n${stderrBuffer.trim()}`
        ));
      }
    });
  });
}

// 2. HEALTH CHECK HELPER
function checkBackendHealth() {
  return new Promise((resolve) => {
    // Verify the responder is actually our backend. Accepting any 200 (or any
    // response at all) means an unrelated service on port 8000 gets adopted as
    // the backend, and the app silently talks to a stranger.
    const req = http.get('http://127.0.0.1:8000/api/health-check/', (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 && JSON.parse(body).status === 'ok');
        } catch {
          resolve(false);
        }
      });
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
  
  return new Promise((resolve, reject) => {
    const expressApp = express();
    // The frontend ships via electron-builder's `files`, so it lands next to
    // main.js under Resources/app/resources/frontend-build — NOT directly under
    // Resources/ (that is `extraResources`, which is where backend/ and
    // totem_lib/ go). Using process.resourcesPath here serves a directory that
    // does not exist, which renders as a blank white window.
    const frontendPath = path.join(__dirname, 'resources', 'frontend-build');

    if (!require('fs').existsSync(path.join(frontendPath, 'index.html'))) {
      reject(new Error(`Frontend build not found at ${frontendPath}`));
      return;
    }

    expressApp.use(express.static(frontendPath));
    expressApp.use((req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
    
    // Port 0 = let the OS pick a free port. Do NOT hardcode 5000: on macOS the
    // AirPlay Receiver (ControlCenter) listens there by default and answers 403
    // Forbidden, so the window would load AirPlay instead of the app.
    frontendServer = expressApp.listen(0, '127.0.0.1', () => {
      frontendPort = frontendServer.address().port;
      console.log(`Frontend serving on port ${frontendPort}`);
      resolve();
    });

    frontendServer.on('error', (err) => {
      reject(new Error(`Frontend server failed to start: ${err.message}`));
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  const url = isDev
    ? 'http://localhost:3000'
    : `http://127.0.0.1:${frontendPort}`;
  mainWindow.loadURL(url);

  if (isDev) mainWindow.webContents.openDevTools();
}

// 4. APP LIFECYCLE & CLEANUP
app.whenReady().then(async () => {
  try {
    await ensureDatabase();
    await startBackend();
    await startFrontendServer();
    createWindow();
  } catch (e) {
    // In a packaged app console output goes nowhere, so surface the failure.
    console.error('Startup failed:', e);
    dialog.showErrorBox('TOTeM-Tool failed to start', String(e && e.message ? e.message : e));
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