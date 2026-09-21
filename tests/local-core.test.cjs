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
  assert.throws(() => validateLocalConnection({ sessionId: '../bad', profile: { id: LOCAL_PROFILE_ID, kind: 'local' } }), /invalid local session/i)
  assert.throws(() => validateLocalConnection({ sessionId: 'local-123', profile: { id: 'other', kind: 'local' } }), /invalid local profile/i)
})

test('provides a safe machine label and reads only the cwd from lsof output', () => {
  assert.deepEqual(machineInfo('MacBook-Pro.local', 'example', '/Users/example'), {
    name: 'MacBook-Pro', username: 'example', homeDirectory: '/Users/example',
  })
  assert.equal(machineInfo('bad\nname', '', '/Users/example').name, 'Esta Mac')
  assert.equal(parseLsofCwd('p12345\nfcwd\nn/Users/example/My Project\n'), '/Users/example/My Project')
  assert.equal(parseLsofCwd('p12345\nnrelative/path\n'), null)
})
