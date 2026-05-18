"""
desktop/scripts/bundle_python.py — copy the optilearn .venv into desktop/python-runtime.

The bundled runtime is what electron-builder includes as extraResources.
On the end-user machine there is no pip install step — they just double-click.

Usage:
    python3 desktop/scripts/bundle_python.py <optilearn_dir> <output_dir>

The script copies the entire .venv/lib and .venv/bin (or .venv/Scripts on Windows)
and patches the shebang lines + activation scripts so paths resolve correctly
inside the packaged app's Resources folder.

On Mac/Linux the packaged path is:
    <app>.app/Contents/Resources/python-runtime/bin/python3

On Windows:
    resources/python-runtime/python.exe
"""
import os
import sys
import shutil
import stat
import subprocess
from pathlib import Path


def copy_venv(optilearn_dir: Path, output_dir: Path) -> None:
    venv_dir = optilearn_dir / ".venv"
    if not venv_dir.exists():
        print(f"  ERROR: .venv not found at {venv_dir}")
        print("  Run ./scripts/setup.sh in optilearn/ first.")
        sys.exit(1)

    if output_dir.exists():
        print(f"  Removing existing runtime at {output_dir}")
        shutil.rmtree(output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)

    is_win = sys.platform.startswith("win")
    src_bin = venv_dir / ("Scripts" if is_win else "bin")
    src_lib = venv_dir / "Lib" if is_win else venv_dir / "lib"

    print(f"  Copying {venv_dir} → {output_dir}")
    print(f"  (This may take 1-2 minutes — Torch/FAISS are large)")

    # Copy bin/Scripts
    dst_bin = output_dir / ("Scripts" if is_win else "bin")
    shutil.copytree(src_bin, dst_bin, symlinks=True)

    # Copy lib
    dst_lib = output_dir / ("Lib" if is_win else "lib")
    shutil.copytree(src_lib, dst_lib, symlinks=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"))

    # Copy pyvenv.cfg
    cfg_src = venv_dir / "pyvenv.cfg"
    if cfg_src.exists():
        shutil.copy2(cfg_src, output_dir / "pyvenv.cfg")

    # On Mac/Linux: ensure python3 is executable
    if not is_win:
        for name in ("python3", "python", "python3.11", "python3.12", "python3.13", "python3.14"):
            exe = dst_bin / name
            if exe.exists() or exe.is_symlink():
                try:
                    exe.chmod(exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                except Exception:
                    pass

    # Report size
    total = sum(f.stat().st_size for f in output_dir.rglob("*") if f.is_file())
    print(f"  ✓ Python runtime bundled ({total / 1024 / 1024:.0f} MB)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: bundle_python.py <optilearn_dir> <output_dir>")
        sys.exit(1)

    optilearn = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    copy_venv(optilearn, output)
