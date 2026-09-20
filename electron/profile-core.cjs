const crypto = require('node:crypto')

const BACKUP_FORMAT = 'conexum-connections'
const BACKUP_VERSION = 1

function cleanText(value, label, { required = true, max = 512 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label} es obligatorio.`)
    return ''
  }
  if (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`${label} no es válido.`)
  const cleaned = value.trim()
  if (required && !cleaned) throw new Error(`${label} es obligatorio.`)
  return cleaned
}

function sanitizeProfile(profile, { regenerateId = false } = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('El perfil exportado no es válido.')
  const port = Number(profile.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('El puerto SSH no es válido.')
  const id = regenerateId ? crypto.randomUUID() : cleanText(profile.id, 'El identificador', { max: 128 })
  return {
    id,
    name: cleanText(profile.name, 'El nombre', { max: 200 }),
    group: cleanText(profile.group, 'El grupo', { max: 200 }),
    host: cleanText(profile.host, 'El servidor', { max: 253 }),
    port,
    username: cleanText(profile.username, 'El usuario', { max: 128 }),
    ...(profile.identityFile ? { identityFile: cleanText(profile.identityFile, 'IdentityFile', { max: 4_096 }) } : {}),
    ...(profile.sshAlias ? { sshAlias: cleanText(profile.sshAlias, 'El alias SSH', { max: 512 }) } : {}),
    ...(profile.configFile ? { configFile: cleanText(profile.configFile, 'El archivo de configuración', { max: 4_096 }) } : {}),
  }
}

function createBackup(profiles, now = new Date()) {
  if (!Array.isArray(profiles) || profiles.length > 5_000) throw new Error('La lista de conexiones no es válida.')
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    profiles: profiles.map((profile) => sanitizeProfile(profile)),
  }
}

function parseBackup(input) {
  const backup = typeof input === 'string' ? JSON.parse(input) : input
  if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || !Array.isArray(backup.profiles)) {
    throw new Error('El archivo no es un respaldo compatible de Conexum.')
  }
  if (backup.profiles.length > 5_000) throw new Error('El respaldo contiene demasiadas conexiones.')
  return backup.profiles.map((profile) => sanitizeProfile(profile))
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  parseBackup,
  sanitizeProfile,
}
