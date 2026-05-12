"""
Create a desktop shortcut to OptiLearn.bat on Windows.
Run from the optilearn/ directory: python scripts/create_shortcut.py
Requires: pip install pywin32 winshell
"""
import os
import sys


def _pythonw_path(base_dir):
    venv_pythonw = os.path.join(base_dir, ".venv", "Scripts", "pythonw.exe")
    if os.path.exists(venv_pythonw):
        return venv_pythonw
    return None


def create_desktop_shortcut():
    import winshell
    from win32com.client import Dispatch

    desktop = winshell.desktop()
    shortcut_path = os.path.join(desktop, "OptiLearn.lnk")
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pythonw = _pythonw_path(base_dir)

    shell = Dispatch('WScript.Shell')
    shortcut = shell.CreateShortCut(shortcut_path)
    if pythonw:
        # Direct pythonw launch — zero CMD flash
        shortcut.TargetPath = pythonw
        shortcut.Arguments = f'"{os.path.join(base_dir, "desktop.py")}"'
    else:
        # VBScript launcher — zero CMD flash (avoids the BAT window)
        shortcut.TargetPath = "wscript.exe"
        shortcut.Arguments = f'//nologo "{os.path.join(base_dir, "OptiLearn.vbs")}"'
    shortcut.WorkingDirectory = base_dir
    shortcut.IconLocation = os.path.join(base_dir, "optilearn.ico") + ",0"
    shortcut.Description = "OptiLearn - Offline AI Tutor"
    shortcut.save()
    print(f"Desktop shortcut created: {shortcut_path}")


if __name__ == '__main__':
    try:
        create_desktop_shortcut()
    except ImportError:
        print("Install pywin32 and winshell: pip install pywin32 winshell")
        print("Then run this script again to create the desktop shortcut.")
        sys.exit(1)
