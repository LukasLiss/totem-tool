#!/usr/bin/env node
/**
 * Cross-platform launcher for the project's Python venv.
 *
 * Resolves backend/.venv/{Scripts,bin}/python and execs it with the
 * arguments passed to this script. Forwards stdio so it behaves like
 * a direct python invocation.
 *
 * Usage (from package.json scripts):
 *   node scripts/run-python.js <args...>
 *
 * Examples:
 *   node scripts/run-python.js backend/manage.py runserver 8000
 *   node scripts/run-python.js -m pytest totem_lib/tests
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const VENV_DIR = path.join(ROOT_DIR, 'backend', '.venv');

const isWin = process.platform === 'win32';
const venvPython = isWin
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python');

if (!fs.existsSync(venvPython)) {
    console.error(`❌ Python venv not found at: ${venvPython}`);
    console.error(`   Run 'npm run setup-env' to create it.`);
    process.exit(1);
}

const args = process.argv.slice(2);
// Force UTF-8 for the Python process. Without this, print()s containing
// non-ASCII characters (e.g. the checkmark/progress markers in totem_lib)
// crash with a UnicodeEncodeError on Windows, where stdout defaults to cp1252.
const result = spawnSync(venvPython, args, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
});

if (result.error) {
    console.error(`❌ Failed to launch python: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
