# -*- mode: python ; coding: utf-8 -*-
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(SPEC)))

a = Analysis(
    [os.path.join(root, "starter.py")],
    pathex=[root],
    binaries=[],
    datas=[(os.path.join(root, "frontend", "favicon.ico"), ".")],
    hiddenimports=[
        "backend.setup",
        "backend.instance",
        "backend.startup",
        "backend.storage",
        "backend.runtime",
        "backend.splash",
        "tkinter",
        "tkinter.filedialog",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="FinMaster",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[os.path.join(root, "frontend", "favicon.ico")],
)
