const test = require('node:test')
const assert = require('node:assert/strict')
const { createBackup, parseBackup } = require('../electron/profile-core.cjs')

const profile = {
  id: 'server-one',
  name: 'Producción',
  group: 'Servidores',
  host: 'example.com',
  port: 22,
  username: 'deploy',
  identityFile: '/Users/test/.ssh/id_ed25519',
}

test('creates a versioned backup without credential fields', () => {
  const backup = createBackup([{ ...profile, password: 'must-not-leak', privateKey: 'must-not-leak' }], new Date('2026-01-01T00:00:00Z'))
  assert.equal(backup.format, 'conexum-connections')
  assert.equal(backup.version, 1)
  assert.equal(backup.exportedAt, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(backup.profiles, [profile])
  assert.equal(JSON.stringify(backup).includes('must-not-leak'), false)
})

test('parses valid backups and rejects incompatible or unsafe data', () => {
  assert.deepEqual(parseBackup(JSON.stringify(createBackup([profile]))), [profile])
  assert.throws(() => parseBackup('{"format":"other","version":1,"profiles":[]}'), /compatible/i)
  assert.throws(() => parseBackup(JSON.stringify({ format: 'conexum-connections', version: 1, profiles: [{ ...profile, host: 'bad\nhost' }] })), /servidor no es válido/i)
  assert.throws(() => parseBackup(JSON.stringify({ format: 'conexum-connections', version: 1, profiles: [{ ...profile, port: 99999 }] })), /puerto/i)
})
