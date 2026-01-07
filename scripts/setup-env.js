const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

// CONFIGURATION
const ROOT_DIR = path.join(__dirname, '..');
const VENV_DIR = path.join(ROOT_DIR, '.venv');
const LIB_DIR = path.join(ROOT_DIR, 'totem_lib');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');

// DETECT PLATFORM & PATHS
const isWin = process.platform === 'win32';
// This is the "Base" python (from your system PATH) used to CREATE the venv
const systemPython = isWin ? 'python' : 'python3'; 
// This is the "Venv" python used to INSTALL packages
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
        promptMsg = `⚠️  Found existing .venv at ${VENV_DIR}.\n   This will try to upgrade pip and install dependencies into it.\n   Proceed? [y/N] `;
    } else {
        promptMsg = `🆕 No .venv found. I will create one at ${VENV_DIR}.\n   Proceed? [y/N] `;
    }

    const shouldProceed = await confirm(promptMsg);
    if (!shouldProceed) {
        console.log('🛑 Aborted by user.');
        process.exit(0);
    }

    // 3. CREATE VIRTUAL ENVIRONMENT (If missing)
    if (!venvExists) {
        console.log('📦 Creating .venv...');
        run(systemPython, ['-m', 'venv', '.venv']);
    }

    // 4. UPGRADE PIP
    // Note: We explicitly use 'venvPython' here. This effectively "activates" it for this command.
    console.log('⬆️  Upgrading pip...');
    run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

    // 5. INSTALL SHARED LIBRARY (Editable Mode)
    if (fs.existsSync(LIB_DIR)) {
        console.log('📚 Installing totem_lib (editable)...');
        run(venvPython, ['-m', 'pip', 'install', '-e', 'totem_lib']);
    }

    // 6. INSTALL BACKEND REQUIREMENTS
    const backendReqs = path.join(BACKEND_DIR, 'requirements.txt');
    if (fs.existsSync(backendReqs)) {
        console.log('🐍 Installing backend requirements...');
        run(venvPython, ['-m', 'pip', 'install', '-r', backendReqs]);
    }
    
    // 7. INSTALL PYINSTALLER (For Building)
    console.log('🔨 Installing build tools...');
    // Best practice: Use a pinned version or a requirements file here
    run(venvPython, ['-m', 'pip', 'install', 'pyinstaller']);

    console.log('\n✅ Setup Complete!');
    console.log(`   To activate manually in terminal: source .venv/Scripts/activate`);
    console.log(`From this venv, you can build the electron app with "npm run build-all"`);
})();