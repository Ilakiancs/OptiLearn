"""
OptiLearn Desktop Launcher
Opens OptiLearn as a native desktop app using PyWebView.
Run this file to launch OptiLearn without a browser.
"""

import sys
import os
import threading
import time

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Only webview is imported at the top level. Everything else (uvicorn, fastapi,
# app config) is lazy-loaded inside functions so the window appears immediately
# without competing for Python's import lock during webview initialisation.
import webview

_MUTEX_NAME = "OptiLearn_SingleInstance_Mutex"

_LOGO_B64 = "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"

_LOADING_HTML = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background-color: #ffffff;
      background-image:
        radial-gradient(circle at top right, rgba(93,181,222,0.08), transparent 50%),
        radial-gradient(circle at bottom left, rgba(85,180,157,0.08), transparent 45%),
        radial-gradient(circle, rgba(42,141,191,0.12) 1px, transparent 1.4px);
      background-size: auto, auto, 22px 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      flex-direction: column;
      gap: 20px;
    }}
    .logo {{
      width: 128px; height: 128px;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(21,101,192,0.25);
      flex-shrink: 0;
    }}
    .logo img {{ width: 100%; height: 100%; display: block; }}
    .title {{ color: #0f2730; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }}
    .subtitle {{ color: #55707b; font-size: 14px; }}
    .spinner {{
      width: 40px; height: 40px;
      border: 3px solid rgba(42,141,191,0.2);
      border-top-color: #2a8dbf;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }}
    @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  </style>
</head>
<body>
  <div class="logo"><img src="data:image/png;base64,{_LOGO_B64}" alt="OptiLearn"></div>
  <div class="title">OptiLearn</div>
  <div class="subtitle">Starting up…</div>
  <div class="spinner"></div>
</body>
</html>
"""

_NO_WINDOW = getattr(__import__('subprocess'), 'CREATE_NO_WINDOW', 0)


def _acquire_single_instance_lock():
    try:
        import ctypes
        handle = ctypes.windll.kernel32.CreateMutexW(None, True, _MUTEX_NAME)
        if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            return None
        return handle
    except Exception:
        return object()  # non-Windows: always allow


def _read_port() -> int:
    """Read PORT from .env directly — avoids importing the full settings stack."""
    import re
    try:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
        m = re.search(r'^PORT\s*=\s*(\d+)', open(env_path).read(), re.MULTILINE)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 8000


def _start_https_after_http():
    """Wait for HTTP server to be ready (and cert to exist), then start HTTPS."""
    import time
    from pathlib import Path as _Path
    from app.core.config import settings as _s
    deadline = time.time() + 60
    while time.time() < deadline:
        if _Path(_s.SSL_CERT_PATH).exists() and _Path(_s.SSL_KEY_PATH).exists():
            break
        time.sleep(1)
    start_https_server()


def start_https_server():
    """Start a second uvicorn server on HTTPS port for student microphone access."""
    import uvicorn
    import subprocess as _sp
    from app.core.config import settings as _s
    from pathlib import Path as _Path

    cert = _s.SSL_CERT_PATH
    key  = _s.SSL_KEY_PATH
    if not (_Path(cert).exists() and _Path(key).exists()):
        return
    # Open Windows Firewall port (best-effort, non-blocking)
    try:
        _sp.run(
            ['netsh', 'advfirewall', 'firewall', 'add', 'rule',
             f'name=OptiLearn HTTPS {_s.HTTPS_PORT}', 'protocol=TCP',
             f'localport={_s.HTTPS_PORT}', 'dir=in', 'action=allow'],
            capture_output=True, timeout=5, creationflags=_NO_WINDOW,
        )
    except Exception:
        pass
    config = uvicorn.Config(
        "app.main:app",
        host=_s.HOST,
        port=_s.HTTPS_PORT,
        ssl_keyfile=key,
        ssl_certfile=cert,
        log_level="info",
        access_log=True,
    )
    uvicorn.Server(config).run()


def start_server():
    import uvicorn
    import logging
    from app.core.config import settings as _s

    _log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'optilearn.log')

    # Uvicorn uses stdlib logging — attach a file handler so logs survive pythonw
    _fh = logging.FileHandler(_log_path, mode='w', encoding='utf-8')
    _fh.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
    for _name in ('uvicorn', 'uvicorn.error', 'uvicorn.access'):
        logging.getLogger(_name).addHandler(_fh)

    # App services use loguru — add a matching sink
    try:
        from loguru import logger as _loguru
        _loguru.add(_log_path, mode='a', format='{time:HH:mm:ss} {level} {name}: {message}')
    except ImportError:
        pass

    config = uvicorn.Config(
        "app.main:app",
        host=_s.HOST,
        port=_s.PORT,
        log_level="info",
        access_log=True,
    )
    uvicorn.Server(config).run()


def wait_for_server(url: str, timeout: int = 30) -> bool:
    import httpx
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = httpx.get(f"{url}/api/health", timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def _register_start_menu_shortcut(base_dir: str, ico_path: str, vbs_path: str) -> None:
    import subprocess
    try:
        start_menu = os.path.join(
            os.getenv('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs'
        )
        shortcut_path = os.path.join(start_menu, 'OptiLearn.lnk')
        # Point to wscript + VBS so the Start Menu shortcut launches with no flash
        ps = (
            f"$sh = New-Object -COM WScript.Shell; "
            f"$lnk = $sh.CreateShortcut('{shortcut_path}'); "
            f"$lnk.TargetPath = 'wscript.exe'; "
            f"$lnk.Arguments = '//nologo \"{vbs_path}\"'; "
            f"$lnk.WorkingDirectory = '{base_dir}'; "
            f"$lnk.IconLocation = '{ico_path},0'; "
            f"$lnk.Description = 'OptiLearn — Offline AI Tutor'; "
            f"$lnk.Save()"
        )
        subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps],
            capture_output=True, timeout=10,
            creationflags=_NO_WINDOW,
        )
    except Exception:
        pass


def main():
    import platform
    base_dir = os.path.dirname(os.path.abspath(__file__))
    ico_path = os.path.join(base_dir, 'optilearn.ico')
    vbs_path = os.path.join(base_dir, 'OptiLearn.vbs')

    port = _read_port()
    local_url = f"http://localhost:{port}"

    if platform.system() == 'Windows':
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('OptiLearn.App.1.0')

    window = webview.create_window(
        title='OptiLearn',
        html=_LOADING_HTML,
        width=1400,
        height=900,
        min_size=(1024, 700),
        resizable=True,
        text_select=True,
        zoomable=True,
    )

    def on_loaded():
        # Start the server here, after webview is fully initialised.
        # Deferring to this point means uvicorn/FastAPI imports don't compete
        # with webview's own imports for Python's import lock, which speeds
        # up the time to first visible frame significantly.
        if not wait_for_server(local_url, timeout=1):
            threading.Thread(target=start_server, daemon=True).start()
        # HTTPS server for student microphone access over LAN (port 8443).
        # Starts after HTTP is up so SSL cert is already generated by lifespan().
        threading.Thread(target=_start_https_after_http, daemon=True).start()

        # Shortcut registration is non-critical — run in background
        if platform.system() == 'Windows':
            threading.Thread(
                target=_register_start_menu_shortcut,
                args=(base_dir, ico_path, vbs_path),
                daemon=True,
            ).start()

        if wait_for_server(local_url):
            window.load_url(f"{local_url}?desktop=1")
        else:
            window.load_html("""
            <html><body style="font-family:sans-serif;padding:40px;color:#d93025">
              <h2>OptiLearn needs a restart</h2>
              <p>Could not connect to the local server. Please restart the app.</p>
            </body></html>
            """)

    start_kwargs = dict(debug=False, private_mode=False)
    if os.path.exists(ico_path):
        start_kwargs['icon'] = ico_path

    webview.start(on_loaded, **start_kwargs)


if __name__ == '__main__':
    lock = _acquire_single_instance_lock()
    if lock is None:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            "OptiLearn is already running.\n\nCheck your taskbar or system tray.",
            "OptiLearn",
            0x40,  # MB_ICONINFORMATION
        )
        sys.exit(0)
    main()
