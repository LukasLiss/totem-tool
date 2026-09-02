#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

const DIST_DIR = path.join(__dirname, '..', 'dist', 'totem_backend');
const isWin = process.platform === 'win32';
const executable = path.join(DIST_DIR, isWin ? 'totem_backend.exe' : 'totem_backend');

const command = process.argv[2];
let args;
if (command === 'migrate') {
  args = ['migrate'];
} else if (command === 'seed') {
  args = ['loaddata', path.join('_internal', 'initial_user.json')];
} else {
  console.error(`Unknown command: ${command}. Use 'migrate' or 'seed'.`);
  process.exit(1);
}

console.log(`> ${executable} ${args.join(' ')}`);
const result = spawnSync(executable, args, { cwd: DIST_DIR, stdio: 'inherit' });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
