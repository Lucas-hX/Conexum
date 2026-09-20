const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFile, execFileSync, spawn } = require('node:child_process')
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
const {
  TransferQueue,
  buildListBatch,
  buildMutationBatch,
  buildSftpArgs,
  buildTransferCommand,
  parseSftpListing,
  validateRemotePath,
} = require('./sftp-core.cjs')

app.setName('Conexum')

const sessions = new SessionRegistry()
const sessionConnections = new Map()
const telemetryCache = new Map()
const transferJobs = new Map()
const transferSnapshots = new Map()
const localFileGrants = new Map()
const appIconPath = path.join(__dirname, '..', 'public', 'brand', 'conexum-icon.png')
// `/tmp` intentionally keeps the Unix socket path short. macOS exposes a much
// longer per-user temp path and OpenSSH adds a temporary suffix while binding.
const controlDirectory = fs.mkdtempSync(path.join('/tmp', 'cx-'))
const execFileAsync = promisify(execFile)

fs.chmodSync(controlDirectory, 0o700)

function sendToRenderer(sender, channel, payload) {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function publishTransfer(job, update) {
  const snapshot = {
    transferId: job.id,
    sessionId: job.sessionId,
    direction: job.direction,
    name: job.name,
    progress: update.progress ?? job.progress,
    status: update.status,
    error: update.error,
    updatedAt: Date.now(),
  }
  transferSnapshots.set(job.id, snapshot)
  if (transferSnapshots.size > 100) {
    const oldest = [...transferSnapshots.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0]
    if (oldest) transferSnapshots.delete(oldest.transferId)
  }
  sendToRenderer(job.sender, 'sftp:transfer-progress', snapshot)
}

function sessionContext(sessionId) {
  if (!isValidSessionId(sessionId)) throw new Error('Identificador de sesión inválido.')
  const context = sessionConnections.get(sessionId)
  if (!context || !sessions.has(sessionId)) throw new Error('La sesión SSH ya no está activa.')
  return context
}

function validateLocalPath(localPath, mode) {
  if (typeof localPath !== 'string' || !path.isAbsolute(localPath) || localPath.length > 4_096 || /[\r\n\0]/.test(localPath)) {
    throw new Error('La ruta local no es válida.')
  }
  const grant = localFileGrants.get(localPath)
  if (!grant || grant.mode !== mode || grant.expiresAt < Date.now()) throw new Error('Volvé a seleccionar el archivo local.')
  if (mode === 'upload' && !fs.statSync(localPath).isFile()) throw new Error('El archivo local no es válido.')
  if (mode === 'download' && !fs.existsSync(path.dirname(localPath))) throw new Error('La carpeta local no existe.')
  return localPath
}

function grantLocalPath(localPath, mode) {
  for (const [grantedPath, grant] of localFileGrants) {
    if (grant.expiresAt < Date.now()) localFileGrants.delete(grantedPath)
  }
  localFileGrants.set(localPath, { mode, expiresAt: Date.now() + 10 * 60_000 })
  return localPath
}

function runSftpBatch(context, batch) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sftp', buildSftpArgs(context.connection, context.controlPath), {
      cwd: os.homedir(),
      env: { ...processEnvForSsh(), LC_ALL: 'C' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 10_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > 4_000_000) child.kill('SIGTERM')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 128_000) child.kill('SIGTERM')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || 'La operación SFTP no pudo completarse.'))
    })
    child.stdin.end(batch)
  })
}

function cancelSessionTransfers(sessionId) {
  for (const [transferId, job] of transferJobs) {
    if (job.sessionId === sessionId) transferQueue.cancel(transferId)
  }
}

async function runTransfer(job) {
  const context = sessionContext(job.sessionId)
  const args = buildSftpArgs(context.connection, context.controlPath, { batch: false })
  const command = buildTransferCommand(job.direction, job.localPath, job.remotePath)

  return new Promise((resolve) => {
    let phase = 'opening'
    let outputBuffer = ''
    let finished = false
    let canceled = false
    const process = pty.spawn('/usr/bin/sftp', args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 24,
      cwd: os.homedir(),
      env: { ...processEnvForSsh(), LC_ALL: 'C', TERM: 'xterm-256color' },
    })

    const finish = (status, error) => {
      if (finished) return
      finished = true
      transferJobs.delete(job.id)
      publishTransfer(job, {
        progress: status === 'completed' ? 100 : job.progress,
        status,
        error,
      })
      resolve()
    }

    job.cancel = () => {
      canceled = true
      try { process.kill() } catch {}
    }
    publishTransfer(job, { progress: 0, status: 'active' })

    process.onData((data) => {
      outputBuffer = `${outputBuffer}${data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')}`.slice(-8_192)
      for (const match of data.matchAll(/(\d{1,3})%/g)) {
        const progress = Math.min(100, Number(match[1]))
        if (progress > job.progress) {
          job.progress = progress
          publishTransfer(job, { progress, status: 'active' })
        }
      }

      if (/sftp>\s*$/.test(outputBuffer)) {
        if (phase === 'opening') {
          outputBuffer = ''
          phase = 'transferring'
          process.write(`${command}\r`)
        } else if (phase === 'transferring') {
          const transferError = /(?:^|\r?\n)(?:Couldn't|Failure|No such file|Permission denied|not found|not a regular file)/i.test(outputBuffer)
          outputBuffer = ''
          phase = 'closing'
          process.write('bye\r')
          finish(transferError ? 'error' : 'completed', transferError ? 'El servidor rechazó la transferencia.' : undefined)
        }
      }
    })

    process.onExit(({ exitCode }) => {
      if (finished) return
      if (canceled) finish('canceled')
      else finish('error', exitCode === 0 ? 'La transferencia terminó antes de completarse.' : 'La transferencia SFTP falló.')
    })
  })
}

const transferQueue = new TransferQueue(async (job) => {
  try {
    await runTransfer(job)
  } catch (error) {
    transferJobs.delete(job.id)
    publishTransfer(job, {
      progress: job.progress,
      status: 'error',
      error: error instanceof Error ? error.message : 'No se pudo iniciar la transferencia.',
    })
  }
})

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
  return path.join(controlDirectory, cacheKey.slice(0, 16))
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

function registerSftpHandlers() {
  ipcMain.handle('sftp:list', async (_event, { sessionId, remotePath } = {}) => {
    const context = sessionContext(sessionId)
    const validatedPath = validateRemotePath(remotePath, { allowEmpty: true })
    const output = await runSftpBatch(context, buildListBatch(validatedPath))
    return parseSftpListing(output, validatedPath)
  })

  ipcMain.handle('sftp:mutate', async (event, { sessionId, operation, sourcePath, destinationPath } = {}) => {
    const context = sessionContext(sessionId)
    const batch = buildMutationBatch(operation, sourcePath, destinationPath)
    if (operation === 'remove-file' || operation === 'remove-directory') {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options = {
        type: 'warning',
        buttons: ['Eliminar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Confirmar eliminación remota',
        message: `¿Eliminar ${path.posix.basename(validateRemotePath(sourcePath))}?`,
        detail: operation === 'remove-directory'
          ? 'La carpeta sólo se eliminará si está vacía. Esta acción no se puede deshacer.'
          : 'El archivo remoto se eliminará permanentemente. Esta acción no se puede deshacer.',
      }
      const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
      if (result.response !== 0) return false
    }
    await runSftpBatch(context, batch)
    return true
  })

  ipcMain.handle('sftp:choose-upload', async () => {
    const result = await dialog.showOpenDialog({ title: 'Seleccionar archivo para subir', properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) return null
    const localPath = result.filePaths[0]
    const stats = fs.statSync(localPath)
    if (!stats.isFile()) return null
    grantLocalPath(localPath, 'upload')
    return { path: localPath, name: path.basename(localPath), size: stats.size }
  })

  ipcMain.handle('sftp:grant-dropped-upload', (_event, localPath) => {
    if (typeof localPath !== 'string' || !path.isAbsolute(localPath) || /[\r\n\0]/.test(localPath)) return null
    const stats = fs.statSync(localPath)
    if (!stats.isFile()) return null
    grantLocalPath(localPath, 'upload')
    return { path: localPath, name: path.basename(localPath), size: stats.size }
  })

  ipcMain.handle('sftp:choose-download', async (_event, suggestedName) => {
    const safeName = typeof suggestedName === 'string' ? path.basename(suggestedName).replace(/[\r\n\0]/g, '') : 'download'
    const result = await dialog.showSaveDialog({ title: 'Guardar archivo remoto', defaultPath: path.join(os.homedir(), 'Downloads', safeName || 'download') })
    if (result.canceled || !result.filePath) return null
    grantLocalPath(result.filePath, 'download')
    return result.filePath
  })

  ipcMain.handle('sftp:transfers', (_event, { sessionId } = {}) => {
    if (!isValidSessionId(sessionId)) return []
    return [...transferSnapshots.values()]
      .filter((transfer) => transfer.sessionId === sessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 6)
  })

  ipcMain.handle('sftp:enqueue-transfer', (event, { sessionId, direction, localPath, remotePath, name } = {}) => {
    sessionContext(sessionId)
    if (direction !== 'upload' && direction !== 'download') throw new Error('Dirección de transferencia inválida.')
    const validatedLocalPath = validateLocalPath(localPath, direction)
    const validatedRemotePath = validateRemotePath(remotePath)
    const safeName = typeof name === 'string' && name.length <= 512 && !/[\r\n\0]/.test(name) ? name : path.basename(direction === 'upload' ? validatedLocalPath : validatedRemotePath)
    const transferId = crypto.randomUUID()
    const job = {
      id: transferId,
      sessionId,
      direction,
      localPath: validatedLocalPath,
      remotePath: validatedRemotePath,
      name: safeName,
      progress: 0,
      sender: event.sender,
      cancel: null,
      onCanceled: () => {
        transferJobs.delete(transferId)
        publishTransfer(job, { progress: 0, status: 'canceled' })
      },
    }
    transferJobs.set(transferId, job)
    publishTransfer(job, { progress: 0, status: 'queued' })
    transferQueue.enqueue(job)
    return { transferId }
  })

  ipcMain.on('sftp:cancel-transfer', (_event, { transferId } = {}) => {
    if (isValidSessionId(transferId)) transferQueue.cancel(transferId)
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
      cancelSessionTransfers(connection.sessionId)
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
    cancelSessionTransfers(sessionId)
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
  transferQueue.clear()
  transferJobs.clear()
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
registerSftpHandlers()

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

app.on('will-quit', () => {
  try {
    fs.rmSync(controlDirectory, { recursive: true, force: true })
  } catch {
    // The OS will eventually clean an abandoned temporary directory.
  }
})
