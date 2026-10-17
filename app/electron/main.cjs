// HeyVoice Electron main process â€” hosts the UI and auto-starts the Python backend.
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const http = require('http')

const BACKEND_URL = 'http://127.0.0.1:17300'
const UI_DEV_URL = 'http://127.0.0.1:5173'
// dev window/taskbar icon; in packaged builds the exe icon is embedded by electron-builder
const DEV_ICON = path.join(__dirname, '..', 'build', 'icon.png')
let backendProc = null
let win = null
let setupAborted = false

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

// Packaged layout: backend source ships in resources/backend; the Python env,
// models and data live under %APPDATA%\HeyVoice so updates never wipe them.
function packagedPaths() {
  const userRoot = app.getPath('userData')
  const backendDir = path.join(process.resourcesPath, 'backend')
  const venvDir = path.join(userRoot, 'venv')
  return {
    backendDir,
    venvDir,
    dataDir: path.join(userRoot, 'data'),
    modelsDir: path.join(userRoot, 'models'),
    python: path.join(venvDir, 'Scripts', 'python.exe'),
    setupScript: path.join(backendDir, 'scripts', 'setup.ps1'),
    setupLog: path.join(userRoot, 'setup.log'),
  }
}

function runFirstRunSetup(p) {
  // Visible PowerShell window (fresh console) so the user sees progress.
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', p.setupScript,
      '-VenvDir', p.venvDir, '-ModelsDir', p.modelsDir, '-LogFile', p.setupLog]
    let ps
    try {
      ps = spawn('powershell.exe', args, {
        cwd: p.backendDir,
        windowsHide: false,
        stdio: 'ignore',
        detached: false,
      })
    } catch {
      resolve(false)
      return
    }
    ps.on('exit', (code) => resolve(code === 0))
    ps.on('error', () => resolve(false))
  })
}

async function ensureBackend() {
  if (await checkHealth()) return

  if (app.isPackaged) {
    const p = packagedPaths()
    if (!fs.existsSync(p.python)) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'HeyVoice â€” first run',
        message: 'Setting up the voice engine',
        detail:
          'HeyVoice needs to install its Python environment and download the voice models ' +
          'on first launch.\n\nAbout 4 GB of downloads, 10â€“30 minutes, internet required. ' +
          'A PowerShell window will show the progress. This only happens once.\n\n' +
          `Environment: ${p.venvDir}\nModels: ${p.modelsDir}`,
        buttons: ['Set up now', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (response !== 0) {
        setupAborted = true
        return
      }
      const ok = await runFirstRunSetup(p)
      if (!ok || !fs.existsSync(p.python)) {
        dialog.showErrorBox(
          'HeyVoice setup failed',
          'The voice engine could not be installed.\n\n' +
          `Setup log: ${p.setupLog}\n\n` +
          'Common causes: no internet connection, or the PowerShell window was closed early.'
        )
        return
      }
    }
    try {
      backendProc = spawn(p.python, ['-m', 'heyvoice'], {
        cwd: p.backendDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONUTF8: '1',
          HEYVOICE_DATA_DIR: p.dataDir,
          HEYVOICE_MODELS_DIR: p.modelsDir,
        },
        stdio: 'ignore',
        windowsHide: true,
      })
      backendProc.on('exit', () => { backendProc = null })
    } catch (err) {
      console.error('Failed to spawn backend:', err)
    }
    return
  }

  const root = path.join(__dirname, '..', '..')
  const exe = path.join(root, 'backend', '.venv', 'Scripts', 'python.exe')
  const cwd = path.join(root, 'backend')
  try {
    backendProc = spawn(exe, ['-m', 'heyvoice'], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' },
      stdio: 'ignore',
      windowsHide: true,
    })
    backendProc.on('exit', () => { backendProc = null })
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
    backgroundColor: '#101114',
    icon: fs.existsSync(DEV_ICON) ? DEV_ICON : undefined,
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
  if (setupAborted) {
    app.quit()
    return
  }
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
