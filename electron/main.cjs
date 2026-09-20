const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFile, execFileSync } = require('node:child_process')
const { promisify } = require('node:util')
const pty = require('node-pty')
const {
  SessionRegistry,
  buildTelemetrySshArgs,
  buildSshArgs,
  calculateTelemetry,
  expandHome,
  isValidSessionId,
  processEnvForSsh,
  parseTelemetrySample,
  readHostAliases,
  validateConnection,
  validateFilePath,
  validateResize,
  validateTerminalInput,
} = require('./ssh-core.cjs')

app.setName('Conexum')

const sessions = new SessionRegistry()
const sessionConnections = new Map()
const telemetryCache = new Map()
const appIconPath = path.join(__dirname, '..', 'public', 'brand', 'conexum-icon.png')
const controlDirectory = path.join(os.tmpdir(), `conexum-ssh-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`)
const execFileAsync = promisify(execFile)

fs.mkdirSync(controlDirectory, { recursive: true, mode: 0o700 })
fs.chmodSync(controlDirectory, 0o700)

function connectionCacheKey(connection) {
  return crypto.createHash('sha256').update(JSON.stringify({
    host: connection.host,
    port: connection.port,
    username: connection.username,
    sshAlias: connection.sshAlias,
    configFile: connection.configFile,
    identityFile: connection.identityFile,
  })).digest('hex')
}

function controlPathForConnection(cacheKey) {
  return path.join(controlDirectory, cacheKey.slice(0, 24))
}

async function collectTelemetry(context) {
  const cached = telemetryCache.get(context.cacheKey)
  const now = Date.now()
  if (cached?.metrics && now - cached.fetchedAt < 7_500) return cached.metrics
  if (cached?.inFlight) return cached.inFlight

  const inFlight = (async () => {
    try {
      const args = buildTelemetrySshArgs(context.connection, context.controlPath)
      const { stdout } = await execFileAsync('/usr/bin/ssh', args, {
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 32_000,
        env: processEnvForSsh(),
      })
      const sample = parseTelemetrySample(stdout)
      const calculated = calculateTelemetry(cached?.sample, sample, Date.now())
      if (!calculated) return null
      telemetryCache.set(context.cacheKey, {
        sample: calculated.sample,
        metrics: calculated.metrics,
        fetchedAt: calculated.metrics.updatedAt,
        inFlight: null,
      })
      return calculated.metrics
    } catch {
      return null
    } finally {
      const current = telemetryCache.get(context.cacheKey)
      if (current) telemetryCache.set(context.cacheKey, { ...current, inFlight: null })
    }
  })()

  telemetryCache.set(context.cacheKey, { ...cached, inFlight })
  return inFlight
}

function resolveSshAlias(alias, configFile) {
  const output = execFileSync('/usr/bin/ssh', ['-G', '-F', configFile, alias], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 2_000_000,
  })
  const values = new Map()
  const identityFiles = []
  for (const line of output.split(/\r?\n/)) {
    const space = line.indexOf(' ')
    if (space < 1) continue
    const key = line.slice(0, space).toLowerCase()
    const value = line.slice(space + 1).trim()
    if (key === 'identityfile') identityFiles.push(value)
    if (!values.has(key)) values.set(key, value)
  }
  const identityFile = identityFiles.map(expandHome).find((candidate) => fs.existsSync(candidate)) || ''
  const host = values.get('hostname') || alias
  const username = values.get('user') || os.userInfo().username
  return {
    id: crypto.randomUUID(),
    name: `${username}@${host}`,
    group: alias,
    host,
    port: Number(values.get('port') || 22),
    username,
    identityFile,
    sshAlias: alias,
    configFile,
  }
}

function registerProfileHandlers() {
  ipcMain.handle('profiles:choose-identity', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar clave privada SSH',
      defaultPath: path.join(os.homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('profiles:import-config', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Importar archivo de configuración SSH',
      defaultPath: path.join(os.homedir(), '.ssh', 'config'),
      properties: ['openFile', 'showHiddenFiles'],
    })
    if (result.canceled) return []

    const configFile = validateFilePath(result.filePaths[0], 'El archivo de configuración')
    const aliases = readHostAliases(fs.readFileSync(configFile, 'utf8'))
    return aliases.map((alias) => resolveSshAlias(alias, configFile))
  })

  ipcMain.handle('profiles:forget-identity', (_event, filePath) => {
    const identityFile = validateFilePath(String(filePath || ''), 'El archivo de identidad')
    execFileSync('/usr/bin/ssh-add', ['--apple-use-keychain', '-d', identityFile], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1_000_000,
      env: processEnvForSsh(),
    })
    return true
  })
}

function registerSshHandlers() {
  ipcMain.handle('ssh:connect', (event, request) => {
    const connection = validateConnection(request)
    if (sessions.has(connection.sessionId)) throw new Error('La sesión ya existe.')
    const sender = event.sender

    const cacheKey = connectionCacheKey(connection)
    const controlPath = controlPathForConnection(cacheKey)
    const args = buildSshArgs(connection, { controlPath })

    const sshProcess = pty.spawn('/usr/bin/ssh', args, {
      name: 'xterm-256color',
      cols: connection.cols,
      rows: connection.rows,
      cwd: os.homedir(),
      env: {
        ...processEnvForSsh(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    })

    sessions.add(connection.sessionId, sshProcess)
    sessionConnections.set(connection.sessionId, { connection, cacheKey, controlPath })

    sshProcess.onData((data) => {
      if (!sender.isDestroyed()) {
        sender.send('ssh:data', { sessionId: connection.sessionId, data })
      }
    })

    sshProcess.onExit(({ exitCode, signal }) => {
      sessions.remove(connection.sessionId)
      sessionConnections.delete(connection.sessionId)
      if (!sender.isDestroyed()) {
        sender.send('ssh:exit', {
          sessionId: connection.sessionId,
          exitCode,
          signal,
        })
      }
    })

    return { sessionId: connection.sessionId, pid: sshProcess.pid }
  })

  ipcMain.on('ssh:input', (_event, { sessionId, data } = {}) => {
    const input = validateTerminalInput({ sessionId, data })
    if (!input) return
    sessions.get(input.sessionId)?.write(input.data)
  })

  ipcMain.on('ssh:resize', (_event, { sessionId, cols, rows } = {}) => {
    const resize = validateResize({ sessionId, cols, rows })
    if (!resize) return
    sessions.get(resize.sessionId)?.resize(resize.cols, resize.rows)
  })

  ipcMain.on('ssh:disconnect', (_event, { sessionId } = {}) => {
    if (!isValidSessionId(sessionId)) return
    sessionConnections.delete(sessionId)
    sessions.close(sessionId)
  })

  ipcMain.handle('ssh:telemetry', async (_event, { sessionId } = {}) => {
    if (!isValidSessionId(sessionId)) return null
    const context = sessionConnections.get(sessionId)
    if (!context || !sessions.has(sessionId)) return null
    return collectTelemetry(context)
  })
}

function closeAllSessions() {
  sessionConnections.clear()
  sessions.closeAll()
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'Conexum',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#0b1016',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.on('closed', closeAllSessions)
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

registerSshHandlers()
registerProfileHandlers()

app.whenReady().then(() => {
  app.setAppUserModelId('com.lucashx.conexum')
  app.setAboutPanelOptions({
    applicationName: 'Conexum',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    iconPath: appIconPath,
  })
  installApplicationMenu()
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(appIconPath))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeAllSessions()
  if (process.platform !== 'darwin') app.quit()
})
