// HeyVoice Electron main process — hosts the UI and auto-starts the Python backend.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

const BACKEND_URL = 'http://127.0.0.1:17300'
const UI_DEV_URL = 'http://127.0.0.1:5173'
let backendProc = null
let win = null

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(BACKEND_URL + '/health', { timeout: 1500 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function backendPaths() {
  if (app.isPackaged) {
    const resDir = process.resourcesPath
    return {
      exe: path.join(resDir, 'backend', 'heyvoice-backend.exe'),
      cwd: path.join(resDir, 'backend'),
    }
  }
  const root = path.join(__dirname, '..', '..')
  return {
    exe: path.join(root, 'backend', '.venv', 'Scripts', 'python.exe'),
    cwd: path.join(root, 'backend'),
  }
}

async function ensureBackend() {
  if (await checkHealth()) return
  const { exe, cwd } = backendPaths()
  try {
    backendProc = spawn(exe, ['-m', 'heyvoice'], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' },
      stdio: 'ignore',
      windowsHide: true,
    })
    backendProc.on('exit', (code) => { backendProc = null })
  } catch (err) {
    console.error('Failed to spawn backend:', err)
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0B0E14',
    autoHideMenuBar: true,
    title: 'HeyVoice',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())

  if (!app.isPackaged) {
    win.loadURL(UI_DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('open-path', async (_e, p) => shell.openPath(p))
ipcMain.handle('show-item', async (_e, p) => shell.showItemInFolder(p))
ipcMain.handle('backend-url', () => BACKEND_URL)

app.whenReady().then(async () => {
  await ensureBackend()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (backendProc) {
    try { backendProc.kill() } catch {}
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backendProc) {
    try { backendProc.kill() } catch {}
  }
})
