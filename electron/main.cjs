const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage } = require('electron')
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
  buildReadFileBatch,
  decodeEditorText,
  buildSftpArgs,
  buildTransferCommand,
  buildWriteFileBatch,
  formatSftpError,
  parseSftpListing,
  quoteSftpPath,
  validateRemotePath,
} = require('./sftp-core.cjs')
const { createBackup, parseBackup } = require('./profile-core.cjs')
const { machineInfo, parseLsofCwd, validateLocalConnection } = require('./local-core.cjs')

app.setName('Conexum')

const sessions = new SessionRegistry()
const sessionConnections = new Map()
const localSessions = new Map()
const sessionDiagnostics = new Map()
const editorState = { dirty: false, saving: false }
let mainWindowWebContentsId = null
const telemetryCache = new Map()
const transferJobs = new Map()
const transferSnapshots = new Map()
const transferRetrySources = new Map()
const localFileGrants = new Map()
const appIconPath = path.join(__dirname, '..', 'public', 'brand', 'conexum-icon.png')
// `/tmp` intentionally keeps the Unix socket path short. macOS exposes a much
// longer per-user temp path and OpenSSH adds a temporary suffix while binding.
const controlDirectory = fs.mkdtempSync(path.join('/tmp', 'cx-'))
const execFileAsync = promisify(execFile)
const MAX_EDITOR_FILE_BYTES = 2 * 1_024 * 1_024

fs.chmodSync(controlDirectory, 0o700)

function sendToRenderer(sender, channel, payload) {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function publishTransfer(job, update) {
  const canRetry = update.status === 'error' || update.status === 'canceled'
  if (canRetry) {
    transferRetrySources.set(job.id, {
      sessionId: job.sessionId,
      direction: job.direction,
      localPath: job.localPath,
      remotePath: job.remotePath,
      name: job.name,
    })
  } else if (update.status === 'completed') {
    transferRetrySources.delete(job.id)
  }
  const snapshot = {
    transferId: job.id,
    sessionId: job.sessionId,
    direction: job.direction,
    name: job.name,
    progress: update.progress ?? job.progress,
    status: update.status,
    error: update.error,
    canRetry,
    updatedAt: Date.now(),
  }
  transferSnapshots.set(job.id, snapshot)
  if (transferSnapshots.size > 100) {
    const oldest = [...transferSnapshots.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0]
    if (oldest) {
      transferSnapshots.delete(oldest.transferId)
      transferRetrySources.delete(oldest.transferId)
    }
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

function validateRetryLocalPath(localPath, mode) {
  if (typeof localPath !== 'string' || !path.isAbsolute(localPath) || localPath.length > 4_096 || /[\r\n\0]/.test(localPath)) {
    throw new Error('La ruta local guardada ya no es válida.')
  }
  try {
    if (mode === 'upload' && !fs.statSync(localPath).isFile()) throw new Error('missing')
    if (mode === 'download' && !fs.statSync(path.dirname(localPath)).isDirectory()) throw new Error('missing')
  } catch {
    throw new Error(mode === 'upload' ? 'El archivo local original ya no está disponible.' : 'La carpeta de descarga ya no está disponible.')
  }
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
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 15_000)
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
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code === 0 && !timedOut) resolve(stdout)
      else reject(new Error(formatSftpError(stderr, stdout, { timedOut })))
    })
    child.stdin.end(batch)
  })
}

async function readRemoteText(context, remotePath) {
  const validatedPath = validateRemotePath(remotePath)
  const parent = path.posix.dirname(validatedPath)
  const listing = parseSftpListing(await runSftpBatch(context, buildListBatch(parent)), parent)
  const entry = listing.entries.find((candidate) => candidate.path === validatedPath)
  if (!entry) throw new Error('El archivo remoto ya no existe.')
  if (entry.type !== 'file') throw new Error('Por ahora el editor sólo puede abrir archivos regulares.')
  if (entry.size > MAX_EDITOR_FILE_BYTES) throw new Error('El archivo supera el límite seguro de 2 MB para el editor.')

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'conexum-edit-'))
  const temporaryFile = path.join(temporaryDirectory, 'remote-file')
  try {
    await runSftpBatch(context, buildReadFileBatch(validatedPath, temporaryFile))
    const content = fs.readFileSync(temporaryFile)
    if (content.length > MAX_EDITOR_FILE_BYTES) throw new Error('El archivo supera el límite seguro de 2 MB para el editor.')
    const text = decodeEditorText(content)
    return {
      path: validatedPath,
      name: entry.name,
      content: text,
      size: content.length,
      modified: entry.modified,
      permissions: entry.permissions,
      fingerprint: crypto.createHash('sha256').update(content).digest('hex'),
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

async function writeRemoteText(context, request) {
  const remotePath = validateRemotePath(request.remotePath)
  if (typeof request.content !== 'string' || Buffer.byteLength(request.content, 'utf8') > MAX_EDITOR_FILE_BYTES || request.content.includes('\0')) {
    throw new Error('El contenido no es válido o supera el límite de 2 MB.')
  }
  if (typeof request.baselineFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.baselineFingerprint)) {
    throw new Error('No se pudo verificar la versión original del archivo.')
  }

  const current = await readRemoteText(context, remotePath)
  if (current.fingerprint !== request.baselineFingerprint) {
    return { conflict: true, current: { fingerprint: current.fingerprint, size: current.size, modified: current.modified } }
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'conexum-save-'))
  const temporaryFile = path.join(temporaryDirectory, 'remote-file')
  const temporaryRemote = path.posix.join(path.posix.dirname(remotePath), `.${path.posix.basename(remotePath)}.conexum-${crypto.randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporaryFile, request.content, { mode: 0o600 })
    await runSftpBatch(context, buildWriteFileBatch(temporaryFile, remotePath, temporaryRemote, current.permissions))
    const bytes = Buffer.from(request.content, 'utf8')
    return {
      conflict: false,
      file: {
        path: remotePath,
        name: path.posix.basename(remotePath),
        size: bytes.length,
        modified: new Date().toISOString(),
        permissions: current.permissions,
        fingerprint: crypto.createHash('sha256').update(bytes).digest('hex'),
      },
    }
  } catch (error) {
    try { await runSftpBatch(context, `@rm ${quoteSftpPath(temporaryRemote)}\n`) } catch {}
    throw error
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
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
          const transferError = /(?:^|[\r\n])(?:Couldn't|Failure|No such file|Permission denied|not found|not a regular file|stat remote)/i.test(outputBuffer)
          const errorMessage = transferError ? formatSftpError(outputBuffer) : undefined
          outputBuffer = ''
          phase = 'closing'
          process.write('bye\r')
          finish(transferError ? 'error' : 'completed', errorMessage)
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

function enqueueTransfer(sender, source) {
  const transferId = crypto.randomUUID()
  const job = {
    id: transferId,
    ...source,
    progress: 0,
    sender,
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
}

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

  ipcMain.handle('profiles:export-backup', async (event, profiles) => {
    const backup = createBackup(profiles)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(parent ?? undefined, {
      title: 'Exportar conexiones de Conexum',
      defaultPath: path.join(os.homedir(), 'Documents', `conexum-conexiones-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Respaldo de Conexum', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    const destination = path.resolve(result.filePath)
    const temporary = `${destination}.conexum-${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(backup, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(temporary, destination)
      fs.chmodSync(destination, 0o600)
      return destination
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  })

  ipcMain.handle('profiles:import-backup', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(parent ?? undefined, {
      title: 'Importar conexiones de Conexum',
      defaultPath: path.join(os.homedir(), 'Documents'),
      filters: [{ name: 'Respaldo de Conexum', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return []
    const source = validateFilePath(result.filePaths[0], 'El archivo de respaldo')
    const stats = fs.statSync(source)
    if (!stats.isFile() || stats.size > 2_000_000) throw new Error('El respaldo es demasiado grande o no es un archivo válido.')
    return parseBackup(fs.readFileSync(source, 'utf8'))
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
    return enqueueTransfer(event.sender, {
      sessionId,
      direction,
      localPath: validatedLocalPath,
      remotePath: validatedRemotePath,
      name: safeName,
    })
  })

  ipcMain.handle('sftp:retry-transfer', (event, { transferId } = {}) => {
    if (!isValidSessionId(transferId)) throw new Error('Transferencia inválida.')
    const source = transferRetrySources.get(transferId)
    if (!source) throw new Error('Esta transferencia ya no se puede reintentar.')
    sessionContext(source.sessionId)
    validateRetryLocalPath(source.localPath, source.direction)
    validateRemotePath(source.remotePath)

    transferRetrySources.delete(transferId)
    const previous = transferSnapshots.get(transferId)
    if (previous) {
      const updated = { ...previous, canRetry: false, updatedAt: Date.now() }
      transferSnapshots.set(transferId, updated)
      sendToRenderer(event.sender, 'sftp:transfer-progress', updated)
    }
    return enqueueTransfer(event.sender, source)
  })

  ipcMain.on('sftp:cancel-transfer', (_event, { transferId } = {}) => {
    if (isValidSessionId(transferId)) transferQueue.cancel(transferId)
  })

  ipcMain.handle('editor:read-text', async (_event, { sessionId, remotePath } = {}) => {
    return readRemoteText(sessionContext(sessionId), remotePath)
  })

  ipcMain.handle('editor:write-text', async (_event, request = {}) => {
    const result = await writeRemoteText(sessionContext(request.sessionId), request)
    if (!result.conflict) {
      for (const window of BrowserWindow.getAllWindows()) sendToRenderer(window.webContents, 'sftp:file-saved', { sessionId: request.sessionId, remotePath: request.remotePath })
    }
    return result
  })
}

function registerSshHandlers() {
  ipcMain.handle('ssh:connect', (event, request) => {
    if (request?.profile?.kind === 'local') {
      const local = validateLocalConnection(request)
      if (sessions.has(local.sessionId)) throw new Error('La sesión ya existe.')
      const sender = event.sender
      const shellProcess = pty.spawn('/bin/zsh', ['-l', '-i'], {
        name: 'xterm-256color',
        cols: local.cols,
        rows: local.rows,
        cwd: os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Conexum' },
      })
      sessions.add(local.sessionId, shellProcess)
      localSessions.set(local.sessionId, { pid: shellProcess.pid })
      shellProcess.onData((data) => sendToRenderer(sender, 'ssh:data', { sessionId: local.sessionId, data }))
      shellProcess.onExit(({ exitCode, signal }) => {
        sessions.remove(local.sessionId)
        localSessions.delete(local.sessionId)
        sendToRenderer(sender, 'ssh:exit', { sessionId: local.sessionId, exitCode, signal })
      })
      return { sessionId: local.sessionId, pid: shellProcess.pid }
    }

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
    sessionDiagnostics.set(connection.sessionId, {
      sessionId: connection.sessionId,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      identityFile: connection.identityFile || null,
      sshAlias: connection.sshAlias || null,
      configFile: connection.configFile || null,
      status: 'connected',
      pid: sshProcess.pid,
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      lastError: null,
    })

    sshProcess.onData((data) => {
      if (!sender.isDestroyed()) {
        sender.send('ssh:data', { sessionId: connection.sessionId, data })
      }
    })

    sshProcess.onExit(({ exitCode, signal }) => {
      sessions.remove(connection.sessionId)
      sessionConnections.delete(connection.sessionId)
      cancelSessionTransfers(connection.sessionId)
      const diagnostic = sessionDiagnostics.get(connection.sessionId)
      if (diagnostic) sessionDiagnostics.set(connection.sessionId, {
        ...diagnostic,
        status: exitCode === 0 ? 'disconnected' : 'error',
        endedAt: Date.now(),
        exitCode,
        signal: signal ?? null,
        lastError: exitCode === 0 ? null : `OpenSSH finalizó con código ${exitCode}.`,
      })
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
    localSessions.delete(sessionId)
    const diagnostic = sessionDiagnostics.get(sessionId)
    if (diagnostic) sessionDiagnostics.set(sessionId, { ...diagnostic, status: 'disconnected', endedAt: Date.now(), lastError: null })
    sessions.close(sessionId)
  })

  ipcMain.handle('ssh:telemetry', async (_event, { sessionId } = {}) => {
    if (!isValidSessionId(sessionId)) return null
    const context = sessionConnections.get(sessionId)
    if (!context || !sessions.has(sessionId)) return null
    return collectTelemetry(context)
  })

  ipcMain.handle('ssh:diagnostics', (_event, { sessionId } = {}) => {
    if (!isValidSessionId(sessionId)) return null
    return sessionDiagnostics.get(sessionId) ?? null
  })

  ipcMain.handle('ssh:copy-diagnostics', (_event, { sessionId } = {}) => {
    if (!isValidSessionId(sessionId)) return false
    const item = sessionDiagnostics.get(sessionId)
    if (!item) return false
    clipboard.writeText([
      'Conexum — Diagnóstico de conexión',
      `Estado: ${item.status}`,
      `Host: ${item.host}`,
      `Puerto: ${item.port}`,
      `Usuario: ${item.username}`,
      `IdentityFile: ${item.identityFile || 'No especificado'}`,
      `Alias SSH: ${item.sshAlias || 'No especificado'}`,
      `Config SSH: ${item.configFile || 'No especificado'}`,
      `PID: ${item.pid ?? '—'}`,
      `Inicio: ${item.startedAt ? new Date(item.startedAt).toISOString() : '—'}`,
      `Fin: ${item.endedAt ? new Date(item.endedAt).toISOString() : '—'}`,
      `Código de salida: ${item.exitCode ?? '—'}`,
      `Último error: ${item.lastError || 'Ninguno'}`,
    ].join('\n'))
    return true
  })
}

function registerLocalHandlers() {
  ipcMain.handle('local:machine-info', () => machineInfo(os.hostname(), os.userInfo().username, os.homedir()))

  ipcMain.handle('local:current-directory', async (_event, { sessionId } = {}) => {
    if (!isValidSessionId(sessionId) || !sessions.has(sessionId)) return null
    const local = localSessions.get(sessionId)
    if (!local) return null
    try {
      const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-a', '-p', String(local.pid), '-d', 'cwd', '-Fn'], {
        timeout: 1_800,
        maxBuffer: 16_384,
      })
      return parseLsofCwd(stdout)
    } catch {
      return null
    }
  })
}

function closeAllSessions() {
  transferQueue.clear()
  transferJobs.clear()
  transferRetrySources.clear()
  sessionConnections.clear()
  localSessions.clear()
  sessionDiagnostics.clear()
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
  editorState.dirty = false
  editorState.saving = false
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
  mainWindowWebContentsId = window.webContents.id

  let allowClose = false
  let closeDialogOpen = false
  window.on('close', (event) => {
    if (allowClose || (!editorState.dirty && !editorState.saving)) return
    event.preventDefault()
    if (closeDialogOpen) return
    closeDialogOpen = true
    if (editorState.saving) {
      void dialog.showMessageBox(window, {
        type: 'info', buttons: ['Entendido'], title: 'Guardado en curso',
        message: 'Esperá a que termine el guardado remoto antes de cerrar Conexum.',
      }).finally(() => { closeDialogOpen = false })
      return
    }
    void dialog.showMessageBox(window, {
      type: 'warning', buttons: ['Cerrar sin guardar', 'Cancelar'], defaultId: 1, cancelId: 1,
      title: 'Cambios sin guardar', message: 'Hay archivos remotos con cambios sin guardar.',
      detail: 'Si cerrás Conexum ahora, esos cambios locales se perderán.',
    }).then((result) => {
      if (result.response === 0) { allowClose = true; window.close() }
    }).finally(() => { closeDialogOpen = false })
  })
  window.on('closed', () => {
    mainWindowWebContentsId = null
    closeAllSessions()
  })
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

ipcMain.on('editor:set-state', (event, { dirty, saving } = {}) => {
  if (event.sender.id !== mainWindowWebContentsId) return
  editorState.dirty = dirty === true
  editorState.saving = saving === true
})

registerSshHandlers()
registerLocalHandlers()
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
