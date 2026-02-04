# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_all

simplejwt_hidden_imports = collect_submodules('rest_framework_simplejwt')

# Collect all resources for pulp and totem_lib
datas = []
binaries = []
hiddenimports = simplejwt_hidden_imports

for package in ['pulp', 'totem_lib']:
    tmp_ret = collect_all(package)
    datas += tmp_ret[0]
    binaries += tmp_ret[1]
    hiddenimports += tmp_ret[2]

a = Analysis(
    ['backend\\manage.py'],
    pathex=[],
    binaries=binaries,
    datas=[('backend/initial_user.json', '.')] + datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

# Filter out db.sqlite3 if it was accidentally collected
a.datas = [x for x in a.datas if not x[0].endswith('db.sqlite3')]

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
