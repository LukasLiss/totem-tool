const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const express = require('express');
const treeKill = require('tree-kill');

let mainWindow = null;
let backendProcess = null;
let frontendServer = null;
let frontendPort = null;
let quitting = false;

const isDev = process.env.NODE_ENV === 'development';
const isWin = process.platform === 'win32';

// The frontend bundle is built with VITE_LOCAL_MODE=1 and talks to the backend
// on this fixed port (see frontend/src/config/api.ts).
const BACKEND_PORT = 8000;
const BACKEND_HOST = '127.0.0.1';
const BACKEND_STARTUP_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

function backendLocation() {
  if (isDev) {
    const venvBin = isWin ? ['Scripts', 'python.exe'] : ['bin', 'python'];
    const backendDir = path.join(__dirname, '..', 'backend');
    return {
      executable: path.join(backendDir, '.venv', ...venvBin),
      // manage.py is the first argument for the venv python
      prefixArgs: [path.join(backendDir, 'manage.py')],
      cwd: backendDir,
    };
  }
  const backendDir = path.join(process.resourcesPath, 'backend');
  return {
    executable: path.join(backendDir, isWin ? 'totem_backend.exe' : 'totem_backend'),
    prefixArgs: [],
    cwd: backendDir,
  };
}

function backendEnv() {
  const env = {
    ...process.env,
    LOCAL_MODE: '1',
    PYTHONUNBUFFERED: '1',
    // Only the bundled frontend origin may call the local API from a browser
    // context; every other website the user has open is refused by CORS.
    CORS_ORIGIN_ALLOW_ALL: '0',
    CORS_ALLOWED_ORIGINS: frontendOrigin(),
  };
  if (!isDev) {
    // Keep the SQLite DB, uploads and result cache out of the (read-only,
    // code-signed) app bundle. Django reads this in settings.py.
    env.TOTEM_DATA_DIR = app.getPath('userData');
    env.DEBUG = '0';
  }
  return env;
}

function frontendOrigin() {
  if (isDev) return 'http://localhost:3000';
  return `http://127.0.0.1:${frontendPort}`;
}

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://${BACKEND_HOST}:${BACKEND_PORT}/api/health-check/`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Run a one-off manage.py command (migrate, ...) and throw on failure. */
function runManagementCommand(args) {
  const { executable, prefixArgs, cwd } = backendLocation();
  console.log(`[Backend] ${executable} ${[...prefixArgs, ...args].join(' ')}`);
  const result = spawnSync(executable, [...prefixArgs, ...args], {
    cwd,
    env: backendEnv(),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.stdout) console.log(`[Backend] ${result.stdout}`);
  if (result.stderr) console.error(`[Backend] ${result.stderr}`);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`"${args.join(' ')}" exited with code ${result.status}:\n${result.stderr || result.stdout}`);
  }
}

async function startBackend() {
  if (await checkBackendHealth()) {
    console.log('Backend already running on port 8000, reusing it.');
    return;
  }

  // Apply schema migrations against the per-user database. This also seeds
  // the local Guest account (authentification/migrations/0001_seed_guest_user).
  runManagementCommand(['migrate', '--noinput']);

  const { executable, prefixArgs, cwd } = backendLocation();
  const args = [...prefixArgs, 'runserver', `${BACKEND_HOST}:${BACKEND_PORT}`, '--noreload'];
  console.log(`Spawning backend: ${executable} ${args.join(' ')}`);

  backendProcess = spawn(executable, args, {
    cwd,
    env: backendEnv(),
    shell: false,
    stdio: 'pipe',
    windowsHide: true,
  });

  let stderrTail = '';
  backendProcess.stdout.on('data', (data) => console.log(`[Backend] ${data}`));
  backendProcess.stderr.on('data', (data) => {
    stderrTail = (stderrTail + data.toString()).slice(-4000);
    console.error(`[Backend] ${data}`);
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      fn(value);
    };

    backendProcess.on('error', (err) => finish(reject, err));
    backendProcess.on('exit', (code, signal) => {
      backendProcess = null;
      finish(reject, new Error(`Backend exited during startup (code ${code}, signal ${signal}).\n${stderrTail}`));
    });

    const poll = setInterval(async () => {
      if (await checkBackendHealth()) finish(resolve);
    }, 250);
    const timer = setTimeout(() => {
      finish(reject, new Error(`Backend did not become healthy within ${BACKEND_STARTUP_TIMEOUT_MS / 1000}s.\n${stderrTail}`));
    }, BACKEND_STARTUP_TIMEOUT_MS);
  });
}

// ---------------------------------------------------------------------------
// Frontend (static bundle served on a random free loopback port)
// ---------------------------------------------------------------------------

function startFrontendServer() {
  if (isDev) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const expressApp = express();
    const frontendPath = path.join(process.resourcesPath, 'frontend-build');

    expressApp.use(express.static(frontendPath));
    // SPA fallback for client-side routes
    expressApp.use((req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

    // Port 0 = let the OS pick a free port. A fixed 5000 collides with the
    // macOS AirPlay Receiver and any other local dev server.
    frontendServer = expressApp.listen(0, '127.0.0.1', () => {
      frontendPort = frontendServer.address().port;
      console.log(`Frontend serving on http://127.0.0.1:${frontendPort}`);
      resolve();
    });
    frontendServer.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'TOTeM-Tool',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(isDev ? 'http://localhost:3000' : `${frontendOrigin()}/`);
  if (isDev) mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try {
    await startFrontendServer();
    await startBackend();
    createWindow();
  } catch (e) {
    console.error('Startup failed:', e);
    dialog.showErrorBox(
      'TOTeM-Tool failed to start',
      `${e && e.message ? e.message : e}\n\nIf another program is using port ${BACKEND_PORT}, close it and try again.`
    );
    app.exit(1);
  }
});

// macOS: re-create the window when the Dock icon is clicked and no window is open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && frontendPort !== null) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  if (frontendServer) frontendServer.close();
  if (backendProcess && !backendProcess.killed) {
    e.preventDefault();
    const pid = backendProcess.pid;
    backendProcess = null;
    console.log('Killing backend process tree...');
    treeKill(pid, 'SIGKILL', () => app.exit());
  }
});
