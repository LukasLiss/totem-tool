# -*- mode: python ; coding: utf-8 -*-
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

simplejwt_hidden_imports = collect_submodules('rest_framework_simplejwt')
# settings.py only imports the top-level package; the middleware and storage
# classes are referenced by dotted-path strings, which PyInstaller cannot see.
whitenoise_hidden_imports = collect_submodules('whitenoise')

# PuLP ships its CBC solver as a platform binary under pulp/solverdir/; without
# it mlpaDiscovery / process areas fail in the frozen app with "solver not found".
# It ships CBC for every OS; keep only the current platform's. Foreign ELF / PE
# executables inside the macOS bundle break code signing and notarization.
_cbc_platform = {'darwin': 'osx', 'win32': 'win'}.get(sys.platform, 'linux')
pulp_solver_files = [
    (src, dest)
    for src, dest in collect_data_files('pulp', includes=['solverdir/**'])
    if '/cbc/' not in dest.replace('\\', '/') + '/'
    or f'/cbc/{_cbc_platform}/' in dest.replace('\\', '/') + '/'
]

a = Analysis(
    ['backend/manage.py'],
    pathex=[],
    binaries=[],
    datas=[('backend/initial_user.json', '.')] + pulp_solver_files,
    hiddenimports=simplejwt_hidden_imports + whitenoise_hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
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
    upx=False,  # UPX breaks Authenticode on some DLLs and triggers AV false positives
    # Keep a console subsystem so backend stdout/stderr reach electron/main.js;
    # it spawns the process with windowsHide so no window is shown.
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
    upx=False,
    upx_exclude=[],
    name='totem_backend',
)
