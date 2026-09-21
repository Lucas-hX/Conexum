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

const TELEMETRY_COMMAND = `LC_ALL=C
os=$(uname -s 2>/dev/null || printf unknown)
printf 'os=%s\n' "$os"
case "$os" in
  Linux)
    awk '/^cpu / { idle=$5+$6; total=0; for (i=2; i<=NF; i++) total+=$i; printf "cpu_total=%.0f\\ncpu_idle=%.0f\\n", total, idle }' /proc/stat
    awk '/^MemTotal:/ { total=$2 } /^MemAvailable:/ { available=$2 } /^MemFree:/ { free=$2 } /^Buffers:/ { buffers=$2 } /^Cached:/ { cached=$2 } END { if (!available) available=free+buffers+cached; printf "mem_total_bytes=%.0f\\nmem_available_bytes=%.0f\\n", total*1024, available*1024 }' /proc/meminfo
    ;;
  Darwin)
    top -l 2 -n 0 -s 0.2 2>/dev/null | awk '/^CPU usage:/ { idle=$7; gsub(/%/, "", idle); cpu=100-idle } END { if (cpu >= 0) printf "cpu_percent=%.0f\\n", cpu }'
    vm_stat 2>/dev/null | awk '
      /page size of/ { page=$8 }
      /^Pages free:/ { gsub(/\\./, "", $3); free=$3 }
      /^Pages active:/ { gsub(/\\./, "", $3); active=$3 }
      /^Pages inactive:/ { gsub(/\\./, "", $3); inactive=$3 }
      /^Pages speculative:/ { gsub(/\\./, "", $3); speculative=$3 }
      /^Pages wired down:/ { gsub(/\\./, "", $4); wired=$4 }
      /^Pages occupied by compressor:/ { gsub(/\\./, "", $5); compressed=$5 }
      /^Pages purgeable:/ { gsub(/\\./, "", $3); purgeable=$3 }
      END { printf "mem_total_bytes=%.0f\\nmem_available_bytes=%.0f\\n", (free+active+inactive+speculative+wired+compressed)*page, (free+inactive+speculative+purgeable)*page }
    '
    ;;
esac`

// OpenSSH appends a temporary suffix while creating a multiplexing socket.
// Keeping the configured path below this limit leaves enough room for that
// suffix on macOS, whose Unix-domain socket paths are especially short.
const MAX_CONTROL_PATH_BYTES = 72

function isSafeText(value, maxLength = 255) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\r\n\0]/.test(value)
}

function isValidSessionId(sessionId) {
  return isSafeText(sessionId, 80) && /^[a-zA-Z0-9-]+$/.test(sessionId)
}

function validateControlPath(controlPath) {
  if (!isSafeText(controlPath, 512) || !path.isAbsolute(controlPath) || Buffer.byteLength(controlPath) > MAX_CONTROL_PATH_BYTES) {
    throw new Error('The multiplexing path is invalid or too long.')
  }
  return controlPath
}

function expandHome(filePath, homeDirectory = os.homedir()) {
  if (!filePath) return ''
  if (filePath === '~') return homeDirectory
  if (filePath.startsWith('~/')) return path.join(homeDirectory, filePath.slice(2))
  return path.resolve(filePath)
}

function validateFilePath(filePath, label) {
  if (!isSafeText(filePath, 2048)) throw new Error(`${label} is not valid.`)
  const resolved = expandHome(filePath)
  if (!path.isAbsolute(resolved) || !fs.existsSync(resolved)) throw new Error(`${label} does not exist.`)
  return resolved
}

function validateConnection(request) {
  if (!request || typeof request !== 'object') throw new Error('Invalid connection request.')

  const { sessionId, profile, cols, rows } = request
  if (!isValidSessionId(sessionId)) throw new Error('Invalid session identifier.')
  if (!profile || typeof profile !== 'object') throw new Error('Invalid SSH profile.')

  const host = String(profile.host || '').trim()
  const username = String(profile.username || '').trim()
  const port = Number(profile.port)
  const sshAlias = profile.sshAlias ? String(profile.sshAlias).trim() : ''
  const configFile = profile.configFile ? validateFilePath(String(profile.configFile), 'The configuration file') : ''
  const identityFile = profile.identityFile ? validateFilePath(String(profile.identityFile), 'The identity file') : ''

  if (!isSafeText(host) || host.startsWith('-') || /\s/.test(host)) throw new Error('The host is not valid.')
  if (!isSafeText(username, 64) || username.startsWith('-') || !/^[a-zA-Z0-9._-]+$/.test(username)) {
    throw new Error('The SSH username is not valid.')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The SSH port must be between 1 and 65535.')
  }
  if (sshAlias && (sshAlias.startsWith('-') || /\s/.test(sshAlias))) throw new Error('The SSH alias is not valid.')

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

function appendConnectionArgs(args, connection) {
  if (connection.configFile && connection.sshAlias) {
    args.push(
      '-F', connection.configFile,
      '-o', `HostName=${connection.host}`,
      '-p', String(connection.port),
      '-l', connection.username,
    )
    if (connection.identityFile) args.push('-i', connection.identityFile, '-o', 'IdentitiesOnly=yes')
    return connection.sshAlias
  }

  args.push('-p', String(connection.port))
  if (connection.identityFile) args.push('-i', connection.identityFile, '-o', 'IdentitiesOnly=yes')
  return `${connection.username}@${connection.host}`
}

function buildSshArgs(connection, options = {}) {
  const args = [
    '-tt',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'AddKeysToAgent=yes',
    '-o', 'UseKeychain=yes',
  ]

  if (options.controlPath) {
    const controlPath = validateControlPath(options.controlPath)
    args.push(
      '-S', controlPath,
      '-o', 'ControlMaster=auto',
      '-o', 'ControlPersist=60',
    )
  }

  args.push(appendConnectionArgs(args, connection))

  return args
}

function buildTelemetrySshArgs(connection, controlPath) {
  validateControlPath(controlPath)

  const args = [
    '-T',
    '-S', controlPath,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=3',
    '-o', 'ControlMaster=no',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'RemoteCommand=none',
  ]
  args.push(appendConnectionArgs(args, connection))
  args.push(TELEMETRY_COMMAND)
  return args
}

function parseTelemetrySample(output) {
  if (typeof output !== 'string' || output.length > 32_000) return null
  const values = new Map()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+)=([^\r\n]+)$/)
    if (match) values.set(match[1], match[2])
  }

  const platform = values.get('os')?.toLowerCase()
  const cpuTotal = Number(values.get('cpu_total'))
  const cpuIdle = Number(values.get('cpu_idle'))
  const directCpuPercent = Number(values.get('cpu_percent'))
  const memoryTotalBytes = Number(values.get('mem_total_bytes'))
  const memoryAvailableBytes = Number(values.get('mem_available_bytes'))
  const hasCpuCounters = Number.isFinite(cpuTotal) && Number.isFinite(cpuIdle) && cpuTotal > 0 && cpuIdle >= 0
  const hasDirectCpu = Number.isFinite(directCpuPercent) && directCpuPercent >= 0 && directCpuPercent <= 100
  if (!platform || (!hasCpuCounters && !hasDirectCpu)) return null
  if (!Number.isFinite(memoryTotalBytes) || !Number.isFinite(memoryAvailableBytes) || memoryTotalBytes <= 0 || memoryAvailableBytes < 0) return null

  return {
    platform,
    cpuTotal: hasCpuCounters ? cpuTotal : null,
    cpuIdle: hasCpuCounters ? cpuIdle : null,
    directCpuPercent: hasDirectCpu ? directCpuPercent : null,
    memoryTotalBytes,
    memoryAvailableBytes,
  }
}

function calculateTelemetry(previous, current, updatedAt = Date.now()) {
  if (!current) return null
  const memoryUsed = current.memoryTotalBytes - Math.min(current.memoryAvailableBytes, current.memoryTotalBytes)
  const memoryPercent = Math.min(100, Math.max(0, (memoryUsed / current.memoryTotalBytes) * 100))
  let cpuPercent = current.directCpuPercent

  if (cpuPercent === null && previous && previous.platform === current.platform && previous.cpuTotal !== null && previous.cpuIdle !== null && current.cpuTotal !== null && current.cpuIdle !== null) {
    const totalDelta = current.cpuTotal - previous.cpuTotal
    const idleDelta = current.cpuIdle - previous.cpuIdle
    if (totalDelta > 0 && idleDelta >= 0) {
      cpuPercent = Math.min(100, Math.max(0, ((totalDelta - idleDelta) / totalDelta) * 100))
    }
  }

  return {
    sample: current,
    metrics: {
      cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent),
      memoryPercent: Math.round(memoryPercent),
      platform: current.platform,
      updatedAt,
    },
  }
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
    if (this.sessions.has(sessionId)) throw new Error('The session already exists.')
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
  buildTelemetrySshArgs,
  buildSshArgs,
  calculateTelemetry,
  expandHome,
  isSafeText,
  isValidSessionId,
  processEnvForSsh,
  parseTelemetrySample,
  readHostAliases,
  validateConnection,
  validateControlPath,
  validateFilePath,
  validateResize,
  validateTerminalInput,
}
