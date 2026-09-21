const test = require('node:test')
const assert = require('node:assert/strict')
const { LOCAL_PROFILE_ID, machineInfo, parseLsofCwd, validateLocalConnection } = require('../electron/local-core.cjs')

test('accepts only the built-in local profile and clamps terminal size', () => {
  assert.deepEqual(validateLocalConnection({
    sessionId: 'local-123',
    profile: { id: LOCAL_PROFILE_ID, kind: 'local' },
    cols: 1,
    rows: 900,
  }), { sessionId: 'local-123', cols: 20, rows: 200 })
  assert.throws(() => validateLocalConnection({ sessionId: '../bad', profile: { id: LOCAL_PROFILE_ID, kind: 'local' } }), /sesión local inválido/i)
  assert.throws(() => validateLocalConnection({ sessionId: 'local-123', profile: { id: 'other', kind: 'local' } }), /perfil local inválido/i)
})

test('provides a safe machine label and reads only the cwd from lsof output', () => {
  assert.deepEqual(machineInfo('MacBook-Pro.local', 'lexus', '/Users/lexus'), {
    name: 'MacBook-Pro', username: 'lexus', homeDirectory: '/Users/lexus',
  })
  assert.equal(machineInfo('bad\nname', '', '/Users/lexus').name, 'Esta Mac')
  assert.equal(parseLsofCwd('p12345\nfcwd\nn/Users/lexus/My Project\n'), '/Users/lexus/My Project')
  assert.equal(parseLsofCwd('p12345\nnrelative/path\n'), null)
})
