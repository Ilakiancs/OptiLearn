/**
 * electron/main.js — OptiLearn desktop entry point.
 *
 * Responsibilities:
 *  1. On first launch: show setup wizard (API keys, Ollama, model download)
 *  2. Find the bundled Python runtime and optilearn source
 *  3. Spawn the FastAPI server as a child process
 *  4. Poll until the server is ready, then open the app window
 *  5. Kill the server cleanly on window close / app quit
 */

const { app, BrowserWindow, shell, dialog, Tray, Menu, nativeImage, ipcMain } = require('electron')
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
  ? null
  : path.join(RES, 'python-runtime')

const USER_DATA = app.getPath('userData')
const ENV_FILE = path.join(USER_DATA, '.env')
const SETUP_DONE_FILE = path.join(USER_DATA, '.setup-done')

// ── Pick Python executable ────────────────────────────────────────────────────
function getPythonExe() {
  if (!IS_DEV && PYTHON_RUNTIME_DIR) {
    const winExe = path.join(PYTHON_RUNTIME_DIR, 'python.exe')
    const macExe = path.join(PYTHON_RUNTIME_DIR, 'bin', 'python3')
    if (process.platform === 'win32' && fs.existsSync(winExe)) return winExe
    if (process.platform !== 'win32' && fs.existsSync(macExe)) return macExe
  }
  const venvWin = path.join(OPTILEARN_DIR, '.venv', 'Scripts', 'python.exe')
  const venvMac = path.join(OPTILEARN_DIR, '.venv', 'bin', 'python3')
  if (process.platform === 'win32' && fs.existsSync(venvWin)) return venvWin
  if (process.platform !== 'win32' && fs.existsSync(venvMac)) return venvMac
  return process.platform === 'win32' ? 'python' : 'python3'
}

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let setupWindow = null
let tray = null
let serverProcess = null
let serverPort = 8000
let serverReady = false
let quitting = false

const LOG_PATH = path.join(USER_DATA, 'optilearn-server.log')
let logStream = null

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  if (!logStream) {
    try { logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' }) } catch (_) {}
  }
  if (logStream) logStream.write(line)
}

// ── .env helpers ──────────────────────────────────────────────────────────────
function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  const result = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return result
}

function writeEnvFile(filePath, vars) {
  // Start from template in optilearn dir so we preserve all defaults
  const templatePath = path.join(OPTILEARN_DIR, '.env.example')
  let base = {}
  if (fs.existsSync(templatePath)) {
    base = readEnvFile(templatePath)
  }
  // Layer in existing user env
  if (fs.existsSync(filePath)) {
    Object.assign(base, readEnvFile(filePath))
  }
  // Apply the new vars
  Object.assign(base, vars)

  // Write back — preserve template comments for readability
  let content = ''
  if (fs.existsSync(templatePath)) {
    const templateLines = fs.readFileSync(templatePath, 'utf8').split('\n')
    const written = new Set()
    for (const line of templateLines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || !trimmed) {
        content += line + '\n'
        continue
      }
      const eq = trimmed.indexOf('=')
      if (eq === -1) { content += line + '\n'; continue }
      const key = trimmed.slice(0, eq).trim()
      const val = base[key] !== undefined ? base[key] : trimmed.slice(eq + 1).trim()
      content += `${key}=${val}\n`
      written.add(key)
    }
    // Append any keys not in template
    for (const [k, v] of Object.entries(base)) {
      if (!written.has(k)) content += `${k}=${v}\n`
    }
  } else {
    for (const [k, v] of Object.entries(base)) {
      content += `${k}=${v}\n`
    }
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

// ── Ollama helpers ────────────────────────────────────────────────────────────
function checkOllamaRunning() {
  return new Promise((resolve) => {
    http.get('http://localhost:11434/api/version', (res) => {
      resolve(res.statusCode === 200)
    }).on('error', () => resolve(false))
    setTimeout(() => resolve(false), 3000)
  })
}

function startOllamaIfNeeded() {
  return new Promise((resolve) => {
    checkOllamaRunning().then((running) => {
      if (running) { resolve(true); return }
      // Try to start it (it auto-starts on both Mac and Windows if installed)
      const ollamaCmd = process.platform === 'win32' ? 'ollama' : 'ollama'
      const proc = spawn(ollamaCmd, ['serve'], {
        detached: true, stdio: 'ignore',
        windowsHide: true,
      })
      proc.unref()
      // Wait up to 5s for it to come up
      let tries = 0
      const check = setInterval(async () => {
        tries++
        const ok = await checkOllamaRunning()
        if (ok || tries >= 10) {
          clearInterval(check)
          resolve(ok)
        }
      }, 500)
    })
  })
}

// ── Setup wizard IPC ──────────────────────────────────────────────────────────
function registerSetupIpc() {
  ipcMain.handle('setup:saveEnv', (_e, vars) => {
    try {
      writeEnvFile(ENV_FILE, vars)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('setup:checkOllama', async () => {
    // First check if it's running; if not, try to start it
    const running = await checkOllamaRunning()
    if (running) return true
    const started = await startOllamaIfNeeded()
    return started
  })

  ipcMain.handle('setup:openOllamaDownload', () => {
    const url = process.platform === 'win32'
      ? 'https://ollama.com/download/windows'
      : 'https://ollama.com/download/mac'
    shell.openExternal(url)
  })

  ipcMain.handle('setup:pullModel', async (event, modelName) => {
    const send = (data) => {
      try { event.sender.send('setup:pullProgress', data) } catch (_) {}
    }

    // Ensure ollama is running
    const running = await startOllamaIfNeeded()
    if (!running) {
      send({ status: 'error', error: 'Ollama is not running. Install it first.' })
      return
    }

    // Call ollama pull via CLI (streams progress to stdout as JSON lines)
    return new Promise((resolve) => {
      const proc = spawn('ollama', ['pull', modelName], {
        windowsHide: true,
      })

      let lastPct = 0

      proc.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const obj = JSON.parse(line)
            // ollama pull outputs {"status":"...","completed":N,"total":N}
            if (obj.total && obj.completed) {
              const pct = Math.round((obj.completed / obj.total) * 100)
              if (pct !== lastPct) {
                lastPct = pct
                const mb = (obj.completed / 1024 / 1024).toFixed(0)
                const total = (obj.total / 1024 / 1024).toFixed(0)
                send({ pct, label: `${mb} MB / ${total} MB`, log: obj.status })
              }
            } else if (obj.status) {
              send({ log: obj.status })
            }
          } catch (_) {
            send({ log: line.trim() })
          }
        }
      })

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim()
        if (text) send({ log: text, type: 'err' })
      })

      proc.on('close', (code) => {
        if (code === 0) {
          send({ pct: 100, label: 'Done!', status: 'done' })
        } else {
          send({ status: 'error', error: `ollama pull exited with code ${code}` })
        }
        resolve()
      })

      proc.on('error', (err) => {
        send({ status: 'error', error: err.message })
        resolve()
      })
    })
  })

  ipcMain.handle('setup:launchApp', () => {
    // Mark setup as done and proceed to start the server
    fs.mkdirSync(path.dirname(SETUP_DONE_FILE), { recursive: true })
    fs.writeFileSync(SETUP_DONE_FILE, new Date().toISOString(), 'utf8')
    if (setupWindow) {
      setupWindow.close()
      setupWindow = null
    }
    proceedToLaunch()
  })
}

// ── Server management ─────────────────────────────────────────────────────────
function startServer() {
  const python = getPythonExe()
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PORT: String(serverPort),
    HOST: '127.0.0.1',
    FRONTEND_DIST: path.join(OPTILEARN_DIR, 'frontend', 'dist'),
  }

  env.DB_PATH = path.join(USER_DATA, 'optilearn.db')
  env.FAISS_INDEX_PATH = path.join(USER_DATA, 'curriculum.index')
  env.FAISS_META_PATH = path.join(USER_DATA, 'curriculum_meta.json')
  env.CURRICULUM_DIR = path.join(OPTILEARN_DIR, 'data', 'curriculum')
  env.MATERIALS_DIR = path.join(USER_DATA, 'materials')
  env.SSL_CERT_PATH = path.join(USER_DATA, 'ssl', 'cert.pem')
  env.SSL_KEY_PATH = path.join(USER_DATA, 'ssl', 'key.pem')

  // Copy .env from optilearn source only if we have no user .env yet
  const envSrc = path.join(OPTILEARN_DIR, '.env')
  if (fs.existsSync(envSrc) && !fs.existsSync(ENV_FILE)) {
    try { fs.copyFileSync(envSrc, ENV_FILE) } catch (_) {}
  }
  if (fs.existsSync(ENV_FILE)) env.ENV_FILE = ENV_FILE

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

// ── Wait for server ───────────────────────────────────────────────────────────
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

// ── Windows ───────────────────────────────────────────────────────────────────
function createMainWindow() {
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

function showSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 480,
    minHeight: 600,
    resizable: true,
    center: true,
    title: 'OptiLearn Setup',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#0f2730',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-setup.js'),
    },
  })
  setupWindow.loadFile(path.join(__dirname, 'setup.html'))
  setupWindow.on('closed', () => { setupWindow = null })
}

// ── Launch flow ───────────────────────────────────────────────────────────────
async function proceedToLaunch() {
  createTray()
  const loader = showLoadingWindow()
  startServer()

  try {
    await waitForServer(`http://127.0.0.1:${serverPort}/api/auth/setup-required`)
    log('Server ready')
    serverReady = true
    createMainWindow()
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
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  log('App ready')
  registerSetupIpc()

  const needsSetup = !fs.existsSync(SETUP_DONE_FILE)
  if (needsSetup) {
    log('First launch — showing setup wizard')
    showSetupWindow()
  } else {
    proceedToLaunch()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow) mainWindow.show()
  else if (!setupWindow && fs.existsSync(SETUP_DONE_FILE)) proceedToLaunch()
})

app.on('before-quit', () => {
  quitting = true
  stopServer()
})

app.on('will-quit', () => stopServer())
