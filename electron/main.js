const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const net = require('net');
const express = require('express');
const treeKill = require('tree-kill');

let mainWindow = null;
let backendProcess = null;
let frontendServer = null;
let frontendPort = null;
let backendPort = null;
let quitting = false;

const isDev = process.env.NODE_ENV === 'development';
const isWin = process.platform === 'win32';

// Dev mode (npm run electron-dev) starts Django itself on :8000 and the Vite
// dev server talks to it there. The packaged app picks a free port at launch
// and reaches the backend through the frontend server's same-origin proxy, so
// the port never has to be known by the frontend bundle.
const DEV_BACKEND_PORT = 8000;
const BACKEND_HOST = '127.0.0.1';
const BACKEND_STARTUP_TIMEOUT_MS = 60_000;
const BACKEND_START_ATTEMPTS = 3;

// URL prefixes Django owns; everything else is the SPA. Keep in sync with the
// frontend catch-all in backend/totem_backend/urls.py.
const BACKEND_PATH = /^\/(?:api|token|auth|admin|static|files)(?:\/|$)/;

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

function checkBackendHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://${BACKEND_HOST}:${port}/api/health-check/`, (res) => {
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

/** Ask the OS for a free loopback port. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, BACKEND_HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

class PortInUseError extends Error {}

/** Spawn `runserver` on `port` and resolve once it answers the health check. */
function spawnBackend(port) {
  const { executable, prefixArgs, cwd } = backendLocation();
  const args = [...prefixArgs, 'runserver', `${BACKEND_HOST}:${port}`, '--noreload'];
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

  return new Promise((resolve, reject) => {
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
      // Another program can grab the port between findFreePort() and the
      // bind; Django reports that as "That port is already in use."
      const Err = /already in use/i.test(stderrTail) ? PortInUseError : Error;
      finish(reject, new Err(`Backend exited during startup (code ${code}, signal ${signal}).\n${stderrTail}`));
    });

    const poll = setInterval(async () => {
      if (await checkBackendHealth(port)) finish(resolve);
    }, 250);
    const timer = setTimeout(() => {
      finish(reject, new Error(`Backend did not become healthy within ${BACKEND_STARTUP_TIMEOUT_MS / 1000}s.\n${stderrTail}`));
    }, BACKEND_STARTUP_TIMEOUT_MS);
  });
}

async function startBackend() {
  if (isDev) {
    // `npm run electron-dev` already runs Django on the fixed dev port.
    if (await checkBackendHealth(DEV_BACKEND_PORT)) {
      console.log(`Dev backend already running on port ${DEV_BACKEND_PORT}, reusing it.`);
      backendPort = DEV_BACKEND_PORT;
      return;
    }
  }

  // Apply schema migrations against the per-user database. This also seeds
  // the local Guest account (authentification/migrations/0001_seed_guest_user).
  runManagementCommand(['migrate', '--noinput']);

  // The packaged app never reuses a backend it did not start: whatever answers
  // on some port (a Docker TOTeM, a leftover instance with other CORS
  // settings, another Django project) is not this installation's backend.
  for (let attempt = 1; ; attempt++) {
    const port = isDev ? DEV_BACKEND_PORT : await findFreePort();
    try {
      await spawnBackend(port);
      backendPort = port;
      console.log(`Backend running on http://${BACKEND_HOST}:${port}`);
      return;
    } catch (e) {
      if (isDev || !(e instanceof PortInUseError) || attempt >= BACKEND_START_ATTEMPTS) throw e;
      console.warn(`Port ${port} was taken before the backend could bind it, retrying.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Frontend (static bundle served on a random free loopback port)
// ---------------------------------------------------------------------------

/**
 * Forward a request to the backend unchanged. The Host header is kept, so
 * Django builds absolute URLs (image assets, ...) against the frontend
 * origin, which routes them back through this proxy.
 */
function proxyToBackend(req, res) {
  const upstream = http.request(
    {
      host: BACKEND_HOST,
      port: backendPort,
      method: req.method,
      path: req.originalUrl,
      headers: req.headers,
    },
    (backendRes) => {
      res.writeHead(backendRes.statusCode, backendRes.rawHeaders);
      backendRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    console.error(`[Proxy] ${req.method} ${req.originalUrl}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'The local TOTeM backend is not reachable.' }));
    } else {
      res.destroy(err);
    }
  });
  // Aborted uploads / cancelled requests must not leave the upstream open.
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
}

function startFrontendServer() {
  if (isDev) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const expressApp = express();
    // Packaged via `files` in package.json, so it lives next to main.js
    // (Resources/app/resources/frontend-build), not in process.resourcesPath.
    const frontendPath = path.join(__dirname, 'resources', 'frontend-build');

    // Frontend and API share this origin (like the Docker image), so the
    // bundle is built with relative API URLs and needs no CORS.
    expressApp.use((req, res, next) => {
      if (BACKEND_PATH.test(req.path)) return proxyToBackend(req, res);
      return next();
    });
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

/** The only schemes a Text Box link may hand to the operating system. */
function isExternalOpenable(raw) {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

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

  // Text Box links carry target="_blank". Left alone, Electron opens a bare
  // second BrowserWindow at the external site instead of the user's browser.
  // The scheme is re-checked here even though the backend and renderer have:
  // shell.openExternal asks the OS to open whatever the URL names, so this is
  // the last gate before leaving the sandbox.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalOpenable(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // A mailto link carries no target, so it arrives here rather than through
  // the handler above. Following it would strand the user on a website inside
  // the app frame with no way back.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    // The port is picked at runtime, so compare against the window.
    const current = new URL(mainWindow.webContents.getURL());
    if (target.origin === current.origin) return;
    event.preventDefault();
    if (isExternalOpenable(url)) shell.openExternal(url);
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
      isDev
        ? `${e && e.message ? e.message : e}\n\nIf another program is using port ${DEV_BACKEND_PORT}, close it and try again.`
        : `${e && e.message ? e.message : e}`
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
