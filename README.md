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

- [DEVELOPMENT.md](DEVELOPMENT.md) - Development setup
- [GIT_GUIDE.md](docs/GIT_GUIDE.md) - Git management guidelines
- [MODEL_ASSETS.md](docs/MODEL_ASSETS.md) - Project model asset formats and upload behavior
- [MODEL_EDITORS.md](docs/MODEL_EDITORS.md) - Visual editors for TOTeM models, OC causal nets and OC Petri nets (incl. JSON formats)
- [OCCN_REPLAY_FITNESS.md](docs/OCCN_REPLAY_FITNESS.md) - OCCN replay strategies, API and UI behavior, result interpretation, examples, and limitations
- [PLAYOUT.md](docs/PLAYOUT.md) - Object-centric playout: enumerate and export all variants an OCPN/OCCN allows
