# TOTeM-Tool

The TOTeM Tool is an object-centric Process Analysis Tool that enables easy to use process import, discovery, conformance checking, and filtering capabilities.

## 🚀 Quick Start

To run the application locally or contribute, please see our **[Developer Guide](DEVELOPMENT.md)**.

**One-time Setup:**
```bash
npm run setup-env
```

**Start App:**
```bash
npm run electron-dev
```

**Build Windows Executable:**
```bash
npm run build-all
```

## 📦 Distribution

The Windows executable is built using Electron and includes everything needed to run the application:
- Backend server and TOTeM library (built with PyInstaller)
- Frontend (served with Express.js)

## 📚 Documentation

- [QUICK_START.md](QUICK_START.md) - Development setup
- [BUILD_GUIDE.md](docs/BUILD_GUIDE.md) - Building executables
- [SETUP.md](docs/SETUP.md) - Detailed setup instructions
- [GIT_GUIDE.md](docs/GIT_GUIDE.md) - Git management guidelines