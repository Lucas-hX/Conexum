const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ALLOWED_SSH_ENVIRONMENT_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'LANG',
  'LC_ALL',
  'SSH_AUTH_SOCK',
  'TMPDIR',
]

function isSafeText(value, maxLength = 255) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\r\n\0]/.test(value)
}

function isValidSessionId(sessionId) {
  return isSafeText(sessionId, 80) && /^[a-zA-Z0-9-]+$/.test(sessionId)
}

function expandHome(filePath, homeDirectory = os.homedir()) {
  if (!filePath) return ''
  if (filePath === '~') return homeDirectory
  if (filePath.startsWith('~/')) return path.join(homeDirectory, filePath.slice(2))
  return path.resolve(filePath)
}

function validateFilePath(filePath, label) {
  if (!isSafeText(filePath, 2048)) throw new Error(`${label} no es válido.`)
  const resolved = expandHome(filePath)
  if (!path.isAbsolute(resolved) || !fs.existsSync(resolved)) throw new Error(`${label} no existe.`)
  return resolved
}

function validateConnection(request) {
  if (!request || typeof request !== 'object') throw new Error('Solicitud de conexión inválida.')

  const { sessionId, profile, cols, rows } = request
  if (!isValidSessionId(sessionId)) throw new Error('Identificador de sesión inválido.')
  if (!profile || typeof profile !== 'object') throw new Error('Perfil SSH inválido.')

  const host = String(profile.host || '').trim()
  const username = String(profile.username || '').trim()
  const port = Number(profile.port)
  const sshAlias = profile.sshAlias ? String(profile.sshAlias).trim() : ''
  const configFile = profile.configFile ? validateFilePath(String(profile.configFile), 'El archivo de configuración') : ''
  const identityFile = profile.identityFile ? validateFilePath(String(profile.identityFile), 'El archivo de identidad') : ''

  if (!isSafeText(host) || host.startsWith('-') || /\s/.test(host)) throw new Error('El servidor no es válido.')
  if (!isSafeText(username, 64) || username.startsWith('-') || !/^[a-zA-Z0-9._-]+$/.test(username)) {
    throw new Error('El usuario SSH no es válido.')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('El puerto SSH debe estar entre 1 y 65535.')
  }
  if (sshAlias && (sshAlias.startsWith('-') || /\s/.test(sshAlias))) throw new Error('El alias SSH no es válido.')

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

function processEnvForSsh(environment = process.env) {
  return Object.fromEntries(ALLOWED_SSH_ENVIRONMENT_KEYS.flatMap((key) => environment[key] ? [[key, environment[key]]] : []))
}

function buildSshArgs(connection) {
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

  return args
}

function validateTerminalInput(payload) {
  if (!payload || typeof payload !== 'object') return null
  const { sessionId, data } = payload
  if (!isValidSessionId(sessionId) || typeof data !== 'string' || data.length > 64_000) return null
  return { sessionId, data }
}

function validateResize(payload) {
  if (!payload || typeof payload !== 'object') return null
  const { sessionId, cols, rows } = payload
  if (!isValidSessionId(sessionId) || !Number.isInteger(cols) || !Number.isInteger(rows)) return null
  return {
    sessionId,
    cols: Math.min(Math.max(cols, 20), 500),
    rows: Math.min(Math.max(rows, 5), 200),
  }
}

class SessionRegistry {
  constructor() {
    this.sessions = new Map()
  }

  add(sessionId, process) {
    if (this.sessions.has(sessionId)) throw new Error('La sesión ya existe.')
    this.sessions.set(sessionId, process)
  }

  get(sessionId) {
    return this.sessions.get(sessionId)
  }

  has(sessionId) {
    return this.sessions.has(sessionId)
  }

  remove(sessionId) {
    return this.sessions.delete(sessionId)
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    this.sessions.delete(sessionId)
    try {
      session.kill()
    } catch {
      // The process may already have exited between lookup and cleanup.
    }
    return true
  }

  closeAll() {
    const activeSessions = [...this.sessions.values()]
    this.sessions.clear()
    for (const session of activeSessions) {
      try {
        session.kill()
      } catch {
        // Continue closing the other sessions if one process already exited.
      }
    }
  }

  get size() {
    return this.sessions.size
  }
}

module.exports = {
  SessionRegistry,
  buildSshArgs,
  expandHome,
  isSafeText,
  isValidSessionId,
  processEnvForSsh,
  readHostAliases,
  validateConnection,
  validateFilePath,
  validateResize,
  validateTerminalInput,
}
