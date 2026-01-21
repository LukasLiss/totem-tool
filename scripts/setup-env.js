const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

// CONFIGURATION
const ROOT_DIR = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const VENV_DIR = path.join(BACKEND_DIR, '.venv'); // Unified venv in backend/.venv
const LIB_DIR = path.join(ROOT_DIR, 'totem_lib');

// DETECT PLATFORM & PATHS
const isWin = process.platform === 'win32';
const systemPython = isWin ? 'python' : 'python3';
// Path to the python executable INSIDE the venv
const venvPython = isWin
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python');

// HELPER: Run Command
function run(command, args, cwd = ROOT_DIR) {
    console.log(`> ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
        console.error(`❌ Command failed with code ${result.status}`);
        process.exit(1);
    }
}

// HELPER: Ask for Confirmation
function confirm(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase().startsWith('y'));
        });
    });
}

(async () => {
    console.log('🚀 Starting Project Bootstrap...');
    console.log(`   Target VENV: ${VENV_DIR}`);

    // 1. CHECK FOR SYSTEM PYTHON
    const checkPython = spawnSync(systemPython, ['--version']);
    if (checkPython.status !== 0) {
        console.error('❌ System Python is not installed or not in PATH.');
        process.exit(1);
    }

    // 2. DETECT EXISTING VENV & ASK FOR CONFIRMATION
    const venvExists = fs.existsSync(VENV_DIR);
    let promptMsg = '';

    if (venvExists) {
        promptMsg = `⚠️  Found existing .venv at ${VENV_DIR}.\n   This will perform a sync/update.\n   Proceed? [y/N] `;
    } else {
        promptMsg = `🆕 No .venv found. I will create one at ${VENV_DIR}.\n   Proceed? [y/N] `;
    }

    // Skip confirmation if CI environment or flag passed (optional improvement)
    if (!process.argv.includes('--yes')) {
        const shouldProceed = await confirm(promptMsg);
        if (!shouldProceed) {
            console.log('🛑 Aborted by user.');
            process.exit(0);
        }
    }

    // 3. CREATE VIRTUAL ENVIRONMENT (If missing)
    if (!venvExists) {
        console.log('📦 Creating .venv...');
        run(systemPython, ['-m', 'venv', VENV_DIR]);
    }

    // 4. UPGRADE PIP
    console.log('⬆️  Upgrading pip...');
    run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

    // 5. INSTALL BACKEND REQUIREMENTS
    const backendReqs = path.join(BACKEND_DIR, 'requirements.txt');
    if (fs.existsSync(backendReqs)) {
        console.log('🐍 Installing backend requirements...');
        run(venvPython, ['-m', 'pip', 'install', '-r', backendReqs]);
    }

    // 6. INSTALL BACKEND DEV REQUIREMENTS (PyInstaller, Pytest)
    const backendDevReqs = path.join(BACKEND_DIR, 'requirements-dev.txt');
    if (fs.existsSync(backendDevReqs)) {
        console.log('🔨 Installing backend DEV requirements...');
        run(venvPython, ['-m', 'pip', 'install', '-r', backendDevReqs]);
    }

    // 7. INSTALL TOTEM LIB (Editable + Test deps)
    if (fs.existsSync(LIB_DIR)) {
        console.log('📚 Installing totem_lib (editable + test)...');
        // Installs editable (-e) and the [test] optional dependencies
        run(venvPython, ['-m', 'pip', 'install', '-e', 'totem_lib[test]']);
    }

    // 8. NPM INSTALL
    console.log('📦 Installing Frontend Dependencies...');
    run('npm', ['install'], path.join(ROOT_DIR, 'frontend'));

    console.log('📦 Installing Electron Dependencies...');
    run('npm', ['install'], path.join(ROOT_DIR, 'electron'));


    console.log('\n✅ Setup Complete!');
    console.log(`   To activate manually: source backend/.venv/Scripts/activate`);
    console.log(`   (or backend/.venv/bin/activate on Mac/Linux)`);
})();