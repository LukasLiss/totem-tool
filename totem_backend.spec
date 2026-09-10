# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

# Modules Django loads by *string* name (MIDDLEWARE, INSTALLED_APPS, DRF settings)
# are invisible to PyInstaller's import analysis, so they must be declared here.
#
# whitenoise in particular fails in a way that is easy to misread: settings.py
# guards on `import whitenoise` (HAS_WHITENOISE), which succeeds because the
# top-level package is collected — but the middleware it then appends lives in
# the `whitenoise.middleware` submodule, which is not. The app therefore builds
# and even runs `migrate`/`loaddata` fine, and only dies on `runserver`, when
# Django loads the middleware stack.
simplejwt_hidden_imports = collect_submodules('rest_framework_simplejwt')
whitenoise_hidden_imports = collect_submodules('whitenoise')
corsheaders_hidden_imports = collect_submodules('corsheaders')

hidden_imports = (
    simplejwt_hidden_imports
    + whitenoise_hidden_imports
    + corsheaders_hidden_imports
)

a = Analysis(
    ['backend/manage.py'],
    pathex=[],
    binaries=[],
    datas=[('backend/initial_user.json', '.')],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # psycopg2-binary ships its own libcrypto/libssl under psycopg2/.dylibs.
        # PyInstaller collects those, and they shadow the OpenSSL that Python's
        # own _ssl extension links against — importing ssl then dies with
        # "Symbol not found: _X509_STORE_get1_objects", which surfaces as a 500
        # on /token/ (JWT auth needs ssl).
        #
        # The desktop build never touches PostgreSQL: settings.py only selects it
        # when DATABASE_URL is set, which happens on the cloud deployment, not
        # here. Excluding it removes the conflicting dylibs entirely.
        'psycopg2',
        'psycopg2cffi',
    ],
    noarchive=False,
    optimize=0,
)
# PyInstaller's Django hook sweeps the project directory into the bundle, which
# drags in whatever local state the developer happens to have: their own
# db.sqlite3 (projects, uploaded logs, user accounts) and anything under
# user_files/. Shipping that to every user is both a data leak and pointless —
# the app creates a fresh database in the user's own data directory on first
# launch (see ensureDatabase() in electron/main.js).
_LOCAL_STATE = {'db.sqlite3', 'user_files', 'cache', 'staticfiles'}


def _is_local_state(dest_path):
    return any(part in _LOCAL_STATE for part in Path(dest_path).parts)


a.datas = [entry for entry in a.datas if not _is_local_state(entry[0])]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='totem_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='totem_backend',
)
