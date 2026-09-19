const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const pty = require('node-pty')

const sessions = new Map()
const appIconPath = path.join(__dirname, '..', 'public', 'brand', 'conexum-icon.png')

function isSafeText(value, maxLength = 255) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\r\n\0]/.test(value)
}

function expandHome(filePath) {
  if (!filePath) return ''
  if (filePath === '~') return os.homedir()
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2))
  return path.resolve(filePath)
}

function validateFilePath(filePath, label) {
  if (!isSafeText(filePath, 2048) || /[\r\n\0]/.test(filePath)) throw new Error(`${label} no es válido.`)
  const resolved = expandHome(filePath)
  if (!path.isAbsolute(resolved) || !fs.existsSync(resolved)) throw new Error(`${label} no existe.`)
  return resolved
}

function validateConnection(request) {
  if (!request || typeof request !== 'object') throw new Error('Solicitud de conexión inválida.')

  const { sessionId, profile, cols, rows } = request
  if (!isSafeText(sessionId, 80) || !/^[a-zA-Z0-9-]+$/.test(sessionId)) {
    throw new Error('Identificador de sesión inválido.')
  }
  if (!profile || typeof profile !== 'object') throw new Error('Perfil SSH inválido.')

  const host = String(profile.host || '').trim()
  const username = String(profile.username || '').trim()
  const port = Number(profile.port)
  const sshAlias = profile.sshAlias ? String(profile.sshAlias).trim() : ''
  const configFile = profile.configFile ? validateFilePath(String(profile.configFile), 'El archivo de configuración') : ''
  const identityFile = profile.identityFile ? validateFilePath(String(profile.identityFile), 'El archivo de identidad') : ''

  if (!isSafeText(host) || host.startsWith('-') || /\s/.test(host)) {
    throw new Error('El servidor no es válido.')
  }
  if (!isSafeText(username, 64) || username.startsWith('-') || !/^[a-zA-Z0-9._-]+$/.test(username)) {
    throw new Error('El usuario SSH no es válido.')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('El puerto SSH debe estar entre 1 y 65535.')
  }
  if (sshAlias && (sshAlias.startsWith('-') || /\s/.test(sshAlias))) {
    throw new Error('El alias SSH no es válido.')
  }

  return {
    sessionId,
    host,
    username,
    port,
    sshAlias,
    configFile,
    identityFile,
    cols: Number.isInteger(cols) ? Math.min(Math.max(cols, 20), 500) : 100,
    rows: Number.isInteger(rows) ? Math.min(Math.max(rows, 5), 200) : 30,
  }
}

function readHostAliases(configText) {
  const aliases = []
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^Host\s+(.+)$/i)
    if (!match) continue
    for (const alias of match[1].trim().split(/\s+/)) {
      if (!alias.startsWith('!') && !/[?*]/.test(alias) && !aliases.includes(alias)) aliases.push(alias)
    }
  }
  return aliases
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

function processEnvForSsh() {
  const allowed = ['HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', 'SSH_AUTH_SOCK', 'TMPDIR']
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []))
}

function registerSshHandlers() {
  ipcMain.handle('ssh:connect', (event, request) => {
    const connection = validateConnection(request)
    if (sessions.has(connection.sessionId)) throw new Error('La sesión ya existe.')
    const sender = event.sender

    const args = [
      '-tt',
      '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'AddKeysToAgent=yes',
      '-o', 'UseKeychain=yes',
    ]

    if (connection.configFile && connection.sshAlias) {
      args.push(
        '-F', connection.configFile,
        '-o', `HostName=${connection.host}`,
        '-p', String(connection.port),
        '-l', connection.username,
      )
      if (connection.identityFile) args.push('-i', connection.identityFile, '-o', 'IdentitiesOnly=yes')
      args.push(connection.sshAlias)
    } else {
      args.push('-p', String(connection.port))
      if (connection.identityFile) args.push('-i', connection.identityFile, '-o', 'IdentitiesOnly=yes')
      args.push(`${connection.username}@${connection.host}`)
    }

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

    sessions.set(connection.sessionId, sshProcess)

    sshProcess.onData((data) => {
      if (!sender.isDestroyed()) {
        sender.send('ssh:data', { sessionId: connection.sessionId, data })
      }
    })

    sshProcess.onExit(({ exitCode, signal }) => {
      sessions.delete(connection.sessionId)
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
    if (!isSafeText(sessionId, 80) || typeof data !== 'string' || data.length > 64_000) return
    sessions.get(sessionId)?.write(data)
  })

  ipcMain.on('ssh:resize', (_event, { sessionId, cols, rows } = {}) => {
    const session = sessions.get(sessionId)
    if (!session || !Number.isInteger(cols) || !Number.isInteger(rows)) return
    session.resize(Math.min(Math.max(cols, 20), 500), Math.min(Math.max(rows, 5), 200))
  })

  ipcMain.on('ssh:disconnect', (_event, { sessionId } = {}) => {
    const session = sessions.get(sessionId)
    if (!session) return
    session.kill()
    sessions.delete(sessionId)
  })
}

function closeAllSessions() {
  for (const session of sessions.values()) session.kill()
  sessions.clear()
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
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
  if (process.platform === 'darwin') app.dock?.setIcon(appIconPath)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeAllSessions()
  if (process.platform !== 'darwin') app.quit()
})
