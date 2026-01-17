# TOTeM-Tool

The TOTeM Tool is an object-centric Process Analysis Tool that enables easy to use process import, discovery, conformance checking, and filtering capabilities.

## 🚀 Quick Start

This is a complete desktop application built with:
- **Frontend:** React.js
- **Backend:** Django REST API  
- **TOTeM Library:** Python implementation of algorithms and data structures
- **Desktop executable:** Electron wrapper
- **Database:** SQLite

## 📁 Project Structure

```
totem-tool/
├── backend/          # Django REST API
├── frontend/         # React application
├── electron/         # Electron desktop wrapper
├── docs/            # Documentation files
└── package.json     # Root project management
```

## 🔧 Development Setup

See [QUICK_START.md](QUICK_START.md) for detailed setup instructions.

**Quick commands:**
```bash
# Install all dependencies
npm run install-all

# Start development environment
npm run electron-dev

# Build Windows executable
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