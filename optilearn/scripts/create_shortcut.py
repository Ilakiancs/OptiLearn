"""
Create a desktop shortcut to the OptiLearn VBS launcher on Windows.
Run from the optilearn/ directory: python scripts/create_shortcut.py
Requires: pip install pywin32 winshell
"""
import os
import sys


def create_desktop_shortcut():
    import winshell
    from win32com.client import Dispatch

    desktop = winshell.desktop()
    shortcut_path = os.path.join(desktop, "OptiLearn.lnk")
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    vbs_path = os.path.join(base_dir, "OptiLearn.vbs")

    shell = Dispatch("WScript.Shell")
    shortcut = shell.CreateShortCut(shortcut_path)
    # Always route through VBS so interpreter selection and diagnostics stay in one place.
    shortcut.TargetPath = "wscript.exe"
    shortcut.Arguments = f'//nologo "{vbs_path}"'
    shortcut.WorkingDirectory = base_dir
    shortcut.IconLocation = os.path.join(base_dir, "optilearn.ico") + ",0"
    shortcut.Description = "OptiLearn - Offline AI Tutor"
    shortcut.save()
    print(f"Desktop shortcut created: {shortcut_path}")


if __name__ == "__main__":
    try:
        create_desktop_shortcut()
    except ImportError:
        print("Install pywin32 and winshell: pip install pywin32 winshell")
        print("Then run this script again to create the desktop shortcut.")
        sys.exit(1)
