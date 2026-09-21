const crypto = require('node:crypto')

const BACKUP_FORMAT = 'conexum-connections'
const BACKUP_VERSION = 1

function cleanText(value, label, { required = true, max = 512 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label} is required.`)
    return ''
  }
  if (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`${label} is not valid.`)
  const cleaned = value.trim()
  if (required && !cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function sanitizeProfile(profile, { regenerateId = false } = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('The exported profile is not valid.')
  const port = Number(profile.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('The SSH port is not valid.')
  const id = regenerateId ? crypto.randomUUID() : cleanText(profile.id, 'The identifier', { max: 128 })
  return {
    id,
    name: cleanText(profile.name, 'The name', { max: 200 }),
    group: cleanText(profile.group, 'The group', { max: 200 }),
    host: cleanText(profile.host, 'The host', { max: 253 }),
    port,
    username: cleanText(profile.username, 'The username', { max: 128 }),
    ...(profile.identityFile ? { identityFile: cleanText(profile.identityFile, 'IdentityFile', { max: 4_096 }) } : {}),
    ...(profile.sshAlias ? { sshAlias: cleanText(profile.sshAlias, 'The SSH alias', { max: 512 }) } : {}),
    ...(profile.configFile ? { configFile: cleanText(profile.configFile, 'The configuration file', { max: 4_096 }) } : {}),
  }
}

function createBackup(profiles, now = new Date()) {
  if (!Array.isArray(profiles) || profiles.length > 5_000) throw new Error('The connection list is not valid.')
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
    throw new Error('The file is not a compatible Conexum backup.')
  }
  if (backup.profiles.length > 5_000) throw new Error('The backup contains too many connections.')
  return backup.profiles.map((profile) => sanitizeProfile(profile))
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  parseBackup,
  sanitizeProfile,
}
