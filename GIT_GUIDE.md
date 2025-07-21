# Git Management for TOTeM-Tool

## ✅ Files to Commit (Source Code)

### Root Level
- `package.json` - Project scripts and metadata
- `README.md`, `LICENSE` - Documentation
- `*.md` files - Documentation and guides
- `*.bat` files - Development scripts

### Backend (Django)
- `backend/manage.py`
- `backend/requirements.txt`
- `backend/totem_backend/` - Django project files
- `backend/api/` - API app files
- **Include migrations:** `backend/api/migrations/`

### Frontend (React)
- `frontend/package.json` - Dependencies and scripts
- `frontend/src/` - React source code
- `frontend/public/` - Static files

### Electron
- `electron/main.js` - Electron main process
- `electron/package.json` - Electron dependencies

## ❌ Files NOT to Commit (Generated/Build)

### Dependencies
- `node_modules/` (all locations)
- `backend/venv/` - Python virtual environment
- `package-lock.json` files

### Build Artifacts
- `frontend/build/` - React production build
- `electron/dist/` - Electron executable
- `electron/resources/` - Copied build resources

### Runtime Files
- `backend/db.sqlite3` - Database file
- `backend/__pycache__/` - Python cache
- `*.log` files

### IDE/System Files
- `.vscode/`, `.idea/` - IDE settings
- `.DS_Store`, `Thumbs.db` - OS files

## 🚀 Recommended Git Workflow

1. **Initial Setup:**
   ```bash
   git add .gitignore
   git add README.md LICENSE *.md
   git add package.json backend/ frontend/ electron/
   git commit -m "Initial TOTeM-Tool project setup"
   ```

2. **Development:**
   ```bash
   # Before committing, check what's staged
   git status
   
   # Add source files only
   git add backend/api/ frontend/src/ electron/main.js
   git commit -m "Add new feature"
   ```

3. **Clean Repository:**
   ```bash
   # Remove accidentally committed files
   git rm -r --cached node_modules/
   git rm --cached backend/db.sqlite3
   git commit -m "Remove build artifacts from tracking"
   ```

## 📊 Current Ignore Rules

The `.gitignore` covers:
- All `node_modules/` directories
- Python virtual environments
- Build outputs (`build/`, `dist/`)
- Database files
- IDE configurations
- OS-specific files
- Temporary files

## 💡 Tips

- **Never commit build artifacts** - They can be regenerated
- **Always commit source code** - The files you edit
- **Include documentation** - README, guides, etc.
- **Check before pushing** - Use `git status` to verify