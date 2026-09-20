const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SessionRegistry,
  buildTelemetrySshArgs,
  buildSshArgs,
  calculateTelemetry,
  expandHome,
  processEnvForSsh,
  parseTelemetrySample,
  readHostAliases,
  validateConnection,
  validateControlPath,
  validateResize,
  validateTerminalInput,
} = require('../electron/ssh-core.cjs')

function connectionRequest(overrides = {}) {
  return {
    sessionId: 'session-123',
    profile: {
      host: 'example.com',
      port: 22,
      username: 'deploy',
    },
    cols: 120,
    rows: 40,
    ...overrides,
  }
}

test('validates and normalizes a basic connection request', () => {
  const connection = validateConnection(connectionRequest({ cols: 10, rows: 500 }))

  assert.deepEqual(connection, {
    sessionId: 'session-123',
    host: 'example.com',
    username: 'deploy',
    port: 22,
    sshAlias: '',
    configFile: '',
    identityFile: '',
    cols: 20,
    rows: 200,
  })
})

test('rejects unsafe session, host, username, and port values', () => {
  assert.throws(() => validateConnection(connectionRequest({ sessionId: '../session' })), /sesión inválido/i)
  assert.throws(() => validateConnection(connectionRequest({ profile: { host: '-oProxyCommand=bad', port: 22, username: 'deploy' } })), /servidor no es válido/i)
  assert.throws(() => validateConnection(connectionRequest({ profile: { host: 'example.com', port: 22, username: 'root user' } })), /usuario SSH no es válido/i)
  assert.throws(() => validateConnection(connectionRequest({ profile: { host: 'example.com', port: 70_000, username: 'deploy' } })), /puerto SSH/i)
})

test('builds OpenSSH arguments without invoking a shell', () => {
  const args = buildSshArgs({
    host: '10.0.0.12',
    port: 2222,
    username: 'admin',
    identityFile: '/Users/test/.ssh/id_ed25519',
    configFile: '',
    sshAlias: '',
  })

  assert.deepEqual(args.slice(-7), [
    '-p', '2222',
    '-i', '/Users/test/.ssh/id_ed25519',
    '-o', 'IdentitiesOnly=yes',
  ].concat('admin@10.0.0.12'))
  assert.equal(args.includes('ProxyCommand'), false)
})

test('builds arguments for an imported SSH config alias', () => {
  const args = buildSshArgs({
    host: 'server.internal',
    port: 5606,
    username: 'root',
    identityFile: '',
    configFile: '/Users/test/.ssh/config',
    sshAlias: 'production',
  })

  assert.deepEqual(args.slice(-9), [
    '-F', '/Users/test/.ssh/config',
    '-o', 'HostName=server.internal',
    '-p', '5606',
    '-l', 'root',
    'production',
  ])
})

test('adds a shared control socket to interactive SSH without changing the destination', () => {
  const args = buildSshArgs({
    host: 'example.com',
    port: 22,
    username: 'deploy',
    identityFile: '',
    configFile: '',
    sshAlias: '',
  }, { controlPath: '/tmp/conexum-control' })

  assert.equal(args.at(-1), 'deploy@example.com')
  assert.ok(args.includes('/tmp/conexum-control'))
  assert.ok(args.includes('ControlMaster=auto'))
  assert.ok(args.includes('ControlPersist=60'))
})

test('rejects control socket paths that leave no room for the OpenSSH temporary suffix', () => {
  const shortPath = '/tmp/cx-a1b2c3/1234567890abcdef'
  assert.equal(validateControlPath(shortPath), shortPath)
  assert.throws(() => validateControlPath(`/tmp/${'a'.repeat(80)}`), /demasiado larga/i)
  assert.throws(() => buildSshArgs({
    host: 'example.com',
    port: 22,
    username: 'deploy',
    identityFile: '',
    configFile: '',
    sshAlias: '',
  }, { controlPath: `/tmp/${'a'.repeat(80)}` }), /demasiado larga/i)
})

test('builds read-only telemetry arguments over the existing control socket', () => {
  const args = buildTelemetrySshArgs({
    host: 'example.com',
    port: 2222,
    username: 'deploy',
    identityFile: '',
    configFile: '',
    sshAlias: '',
  }, '/tmp/conexum-control')

  assert.ok(args.includes('BatchMode=yes'))
  assert.ok(args.includes('ControlMaster=no'))
  assert.ok(args.includes('ClearAllForwardings=yes'))
  assert.equal(args.at(-2), 'deploy@example.com')
  assert.match(args.at(-1), /\/proc\/stat/)
  assert.throws(() => buildTelemetrySshArgs({}, 'relative/socket'), /multiplexación inválida/i)
})

test('parses remote telemetry and calculates deltas without exposing raw output', () => {
  const previous = parseTelemetrySample('os=Linux\ncpu_total=1000\ncpu_idle=800\nmem_total_bytes=10000\nmem_available_bytes=4000\n')
  const current = parseTelemetrySample('os=Linux\ncpu_total=1100\ncpu_idle=860\nmem_total_bytes=10000\nmem_available_bytes=2500\n')
  const calculated = calculateTelemetry(previous, current, 1234)

  assert.deepEqual(calculated.metrics, {
    cpuPercent: 40,
    memoryPercent: 75,
    platform: 'linux',
    updatedAt: 1234,
  })
  assert.equal(calculateTelemetry(null, current, 1234).metrics.cpuPercent, null)
  assert.equal(parseTelemetrySample('not telemetry'), null)
})

test('accepts a direct CPU sample from a remote macOS host', () => {
  const sample = parseTelemetrySample('os=Darwin\ncpu_percent=18\nmem_total_bytes=16000\nmem_available_bytes=4000\n')
  assert.deepEqual(calculateTelemetry(null, sample, 5678).metrics, {
    cpuPercent: 18,
    memoryPercent: 75,
    platform: 'darwin',
    updatedAt: 5678,
  })
})

test('reads concrete aliases and ignores wildcard SSH config entries', () => {
  const aliases = readHostAliases(`
    # Shared defaults
    Host *
      ServerAliveInterval 30

    Host production staging !disabled
      User deploy

    Host production
      Port 2222

    Host app-?
      User root
  `)

  assert.deepEqual(aliases, ['production', 'staging'])
})

test('expands home paths and keeps only allowlisted SSH environment values', () => {
  assert.equal(expandHome('~/.ssh/id_ed25519', '/Users/test'), '/Users/test/.ssh/id_ed25519')
  assert.deepEqual(processEnvForSsh({
    HOME: '/Users/test',
    PATH: '/usr/bin',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    SECRET_TOKEN: 'must-not-leak',
  }), {
    HOME: '/Users/test',
    PATH: '/usr/bin',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
  })
})

test('validates terminal input and clamps resize messages', () => {
  assert.deepEqual(validateTerminalInput({ sessionId: 'one', data: 'ls\r' }), { sessionId: 'one', data: 'ls\r' })
  assert.equal(validateTerminalInput({ sessionId: '../one', data: 'ls' }), null)
  assert.equal(validateTerminalInput({ sessionId: 'one', data: 'x'.repeat(64_001) }), null)

  assert.deepEqual(validateResize({ sessionId: 'one', cols: 2, rows: 900 }), {
    sessionId: 'one',
    cols: 20,
    rows: 200,
  })
  assert.equal(validateResize({ sessionId: 'one', cols: 80.5, rows: 24 }), null)
})

test('keeps sessions independent and closes only the selected process', () => {
  const registry = new SessionRegistry()
  const first = { profileId: 'same-profile', kills: 0, kill() { this.kills += 1 } }
  const second = { profileId: 'same-profile', kills: 0, kill() { this.kills += 1 } }

  registry.add('session-one', first)
  registry.add('session-two', second)
  assert.equal(registry.size, 2)
  assert.throws(() => registry.add('session-one', {}), /sesión ya existe/i)

  assert.equal(registry.close('session-one'), true)
  assert.equal(first.kills, 1)
  assert.equal(second.kills, 0)
  assert.equal(registry.get('session-one'), undefined)
  assert.equal(registry.get('session-two'), second)
})

test('allows a failed or closed session to reconnect with the same session id', () => {
  const registry = new SessionRegistry()
  const failedProcess = { kills: 0, kill() { this.kills += 1 } }
  const reconnectedProcess = { kills: 0, kill() { this.kills += 1 } }

  registry.add('reconnect-session', failedProcess)
  registry.remove('reconnect-session')
  registry.add('reconnect-session', reconnectedProcess)

  assert.equal(registry.size, 1)
  assert.equal(registry.get('reconnect-session'), reconnectedProcess)
  assert.equal(failedProcess.kills, 0)
})

test('closes every remaining session during application shutdown', () => {
  const registry = new SessionRegistry()
  const processes = [
    { kills: 0, kill() { this.kills += 1 } },
    { kills: 0, kill() { this.kills += 1; throw new Error('already exited') } },
    { kills: 0, kill() { this.kills += 1 } },
  ]

  processes.forEach((process, index) => registry.add(`session-${index}`, process))
  registry.closeAll()

  assert.equal(registry.size, 0)
  assert.deepEqual(processes.map((process) => process.kills), [1, 1, 1])
})
