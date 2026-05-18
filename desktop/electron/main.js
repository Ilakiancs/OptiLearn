/**
 * electron/main.js — OptiLearn desktop entry point.
 *
 * Responsibilities:
 *  1. Find the bundled Python runtime and optilearn source
 *  2. Spawn the FastAPI server as a child process
 *  3. Poll until the server is ready, then open the app window
 *  4. Kill the server cleanly on window close / app quit
 */

const { app, BrowserWindow, shell, dialog, Tray, Menu, nativeImage } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

// ── Paths ─────────────────────────────────────────────────────────────────────
const IS_DEV = !app.isPackaged
const RES = IS_DEV
  ? path.join(__dirname, '..')          // desktop/ root when running dev
  : process.resourcesPath               // extraResources root in packaged app

const OPTILEARN_DIR = IS_DEV
  ? path.join(__dirname, '../../optilearn')
  : path.join(RES, 'optilearn')

const PYTHON_RUNTIME_DIR = IS_DEV
  ? null                                // dev: use system python / venv
  : path.join(RES, 'python-runtime')

// ── Pick Python executable ────────────────────────────────────────────────────
function getPythonExe() {
  if (!IS_DEV && PYTHON_RUNTIME_DIR) {
    // Packaged: use the bundled portable Python
    const winExe = path.join(PYTHON_RUNTIME_DIR, 'python.exe')
    const macExe = path.join(PYTHON_RUNTIME_DIR, 'bin', 'python3')
    if (process.platform === 'win32' && fs.existsSync(winExe)) return winExe
    if (process.platform !== 'win32' && fs.existsSync(macExe)) return macExe
  }
  // Dev or fallback: use venv python
  const venvWin = path.join(OPTILEARN_DIR, '.venv', 'Scripts', 'python.exe')
  const venvMac = path.join(OPTILEARN_DIR, '.venv', 'bin', 'python3')
  if (process.platform === 'win32' && fs.existsSync(venvWin)) return venvWin
  if (process.platform !== 'win32' && fs.existsSync(venvMac)) return venvMac
  return process.platform === 'win32' ? 'python' : 'python3'
}

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let serverProcess = null
let serverPort = 8000
let serverReady = false
let quitting = false

const LOG_PATH = path.join(app.getPath('userData'), 'optilearn-server.log')
let logStream = null

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  if (!logStream) {
    try { logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' }) } catch (_) {}
  }
  if (logStream) logStream.write(line)
}

// ── Server management ─────────────────────────────────────────────────────────
function startServer() {
  const python = getPythonExe()
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PORT: String(serverPort),
    HOST: '127.0.0.1',             // loopback only — not exposed on LAN from desktop app
    FRONTEND_DIST: path.join(OPTILEARN_DIR, 'frontend', 'dist'),
  }

  // Point DB/data paths to user data dir so they persist across updates
  const userData = app.getPath('userData')
  env.DB_PATH = path.join(userData, 'optilearn.db')
  env.FAISS_INDEX_PATH = path.join(userData, 'curriculum.index')
  env.FAISS_META_PATH = path.join(userData, 'curriculum_meta.json')
  env.CURRICULUM_DIR = path.join(OPTILEARN_DIR, 'data', 'curriculum')
  env.MATERIALS_DIR = path.join(userData, 'materials')
  env.SSL_CERT_PATH = path.join(userData, 'ssl', 'cert.pem')
  env.SSL_KEY_PATH = path.join(userData, 'ssl', 'key.pem')

  // Copy .env if it exists (carries API keys)
  const envSrc = path.join(OPTILEARN_DIR, '.env')
  const envDst = path.join(userData, '.env')
  if (fs.existsSync(envSrc) && !fs.existsSync(envDst)) {
    try { fs.copyFileSync(envSrc, envDst) } catch (_) {}
  }
  if (fs.existsSync(envDst)) env.ENV_FILE = envDst

  log(`Starting server: python=${python} cwd=${OPTILEARN_DIR}`)

  serverProcess = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app',
     '--host', '127.0.0.1',
     '--port', String(serverPort),
     '--no-access-log'],
    { cwd: OPTILEARN_DIR, env, windowsHide: true }
  )

  serverProcess.stdout.on('data', (d) => log(`[server] ${d.toString().trim()}`))
  serverProcess.stderr.on('data', (d) => log(`[server] ${d.toString().trim()}`))
  serverProcess.on('exit', (code) => {
    log(`Server exited with code ${code}`)
    if (!quitting) {
      // Unexpected exit — show error
      dialog.showErrorBox(
        'OptiLearn Server Stopped',
        `The background server exited unexpectedly (code ${code}).\n\nCheck logs at:\n${LOG_PATH}`
      )
    }
  })
}

function stopServer() {
  if (!serverProcess) return
  quitting = true
  log('Stopping server...')
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'])
    } else {
      serverProcess.kill('SIGTERM')
    }
  } catch (_) {}
  serverProcess = null
}

// ── Wait for server to be ready ───────────────────────────────────────────────
function waitForServer(url, maxWaitMs = 60000, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    function check() {
      http.get(url, (res) => {
        if (res.statusCode < 500) { resolve(); return }
        retry()
      }).on('error', retry)
    }
    function retry() {
      if (Date.now() - start > maxWaitMs) {
        reject(new Error(`Server did not start within ${maxWaitMs / 1000}s`))
        return
      }
      setTimeout(check, intervalMs)
    }
    check()
  })
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'OptiLearn',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#0f2730',
    show: false,
  })

  // Open external links in system browser, not in the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('close', (e) => {
    if (!quitting && process.platform === 'darwin') {
      // On Mac: hide to tray instead of quitting
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`)
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon-tray.png')
  if (!fs.existsSync(iconPath)) return
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('OptiLearn')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open OptiLearn', click: () => { mainWindow?.show() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', () => mainWindow?.show())
}

// ── Loading screen ────────────────────────────────────────────────────────────
function showLoadingWindow() {
  const loader = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#0f2730',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  loader.loadURL(`data:text/html,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        background: #0f2730; color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        height: 100vh; gap: 24px;
      }
      .logo { font-size: 2rem; font-weight: 800; color: #2a8dbf; letter-spacing: -1px; }
      .sub { font-size: 0.9rem; color: rgba(255,255,255,0.55); }
      .bar { width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden; }
      .fill {
        height: 100%; background: #2a8dbf; border-radius: 999px;
        animation: load 1.4s ease-in-out infinite;
        transform-origin: left;
      }
      @keyframes load {
        0%   { transform: scaleX(0) translateX(0); }
        50%  { transform: scaleX(1) translateX(0); }
        100% { transform: scaleX(0) translateX(200px); }
      }
    </style></head>
    <body>
      <div class="logo">OptiLearn</div>
      <div class="sub">Starting up, please wait…</div>
      <div class="bar"><div class="fill"></div></div>
    </body>
    </html>
  `)}`)
  return loader
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log('App ready')

  const loader = showLoadingWindow()
  createTray()

  startServer()

  try {
    await waitForServer(`http://127.0.0.1:${serverPort}/api/auth/setup-required`)
    log('Server ready')
    serverReady = true
    createWindow()
    loader.close()
  } catch (err) {
    log(`Server failed to start: ${err.message}`)
    loader.close()
    dialog.showErrorBox(
      'OptiLearn Failed to Start',
      `Could not start the background server.\n\n${err.message}\n\nCheck logs at:\n${LOG_PATH}`
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true
    app.quit()
  }
})

app.on('activate', () => {
  // Mac: re-show window when clicking dock icon
  if (mainWindow) mainWindow.show()
})

app.on('before-quit', () => {
  quitting = true
  stopServer()
})

app.on('will-quit', () => stopServer())
