const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

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
  permissionsToMode,
  validateRemotePath,
} = require('../electron/sftp-core.cjs')

const connection = {
  host: 'example.com',
  port: 2222,
  username: 'deploy',
  identityFile: '',
  configFile: '',
  sshAlias: '',
}

test('validates and quotes remote SFTP paths', () => {
  assert.equal(validateRemotePath('/srv/app/../logs'), '/srv/logs')
  assert.equal(quoteSftpPath('/srv/a "quoted" file'), '"/srv/a \\"quoted\\" file"')
  assert.equal(quoteSftpPath('/srv/report[1]*?.txt'), '"/srv/report\\[1]\\*\\?.txt"')
  assert.throws(() => validateRemotePath('relative/path'), /absoluta/i)
  assert.throws(() => validateRemotePath('/tmp/bad\npath'), /no es válida/i)
})

test('builds SFTP arguments over the existing multiplexed connection', () => {
  const args = buildSftpArgs(connection, '/tmp/conexum-control')
  assert.ok(args.includes('BatchMode=yes'))
  assert.ok(args.includes('ControlMaster=no'))
  assert.ok(args.includes('ClearAllForwardings=yes'))
  assert.ok(args.includes('RemoteCommand=none'))
  assert.ok(args.includes('ControlPath=/tmp/conexum-control'))
  assert.deepEqual(args.slice(-5), ['-b', '-', '-P', '2222', 'deploy@example.com'])
  assert.ok(args.includes('-N'))

  const interactiveArgs = buildSftpArgs(connection, '/tmp/conexum-control', { batch: false })
  assert.equal(interactiveArgs.includes('-q'), false)
  assert.equal(interactiveArgs.includes('-b'), false)
})

test('builds safe list, mutation, and transfer commands', () => {
  assert.equal(buildListBatch('/srv/app'), '@cd "/srv/app"\n@pwd\n@ls -lan\n')
  assert.equal(buildMutationBatch('mkdir', '/srv/new folder'), 'mkdir "/srv/new folder"\n')
  assert.equal(buildMutationBatch('rename', '/srv/old', '/srv/new'), 'rename "/srv/old" "/srv/new"\n')
  assert.equal(buildTransferCommand('upload', '/Users/test/file.txt', '/srv/file.txt'), 'put "/Users/test/file.txt" "/srv/file.txt"')
  assert.throws(() => buildMutationBatch('execute', '/srv/app'), /no permitida/i)
})

test('builds safe remote editor read and atomic write batches', () => {
  assert.equal(buildReadFileBatch('/srv/app/file.ts', '/tmp/conexum/file.ts'), 'get "/srv/app/file.ts" "/tmp/conexum/file.ts"\n')
  assert.equal(permissionsToMode('-rw-r-----'), '640')
  assert.equal(permissionsToMode('-rwsr-xr-t'), '5755')
  assert.equal(buildWriteFileBatch('/tmp/conexum/file.ts', '/srv/app/file.ts', '/srv/app/.file.ts.conexum.tmp', '-rw-r-----'), [
    'put "/tmp/conexum/file.ts" "/srv/app/.file.ts.conexum.tmp"',
    'chmod 640 "/srv/app/.file.ts.conexum.tmp"',
    'rename "/srv/app/.file.ts.conexum.tmp" "/srv/app/file.ts"',
    '',
  ].join('\n'))
  assert.throws(() => buildWriteFileBatch('/tmp/file', '/srv/app/file', '/tmp/file', '-rw-r--r--'), /misma carpeta/i)
})

test('decodes only valid UTF-8 text without rejecting a literal replacement character', () => {
  assert.equal(decodeEditorText(Buffer.from('café \uFFFD')), 'café \uFFFD')
  assert.equal(decodeEditorText(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), '\uFEFFa')
  assert.throws(() => decodeEditorText(Buffer.from([0xc3, 0x28])), /UTF-8/i)
  assert.throws(() => decodeEditorText(Buffer.from([0x61, 0x00, 0x62])), /binario/i)
})

test('parses and sorts the current macOS OpenSSH long-list format', () => {
  const listing = parseSftpListing(`Remote working directory: /srv/app
-rw-r--r--    ? deploy staff        120 Jan 03 12:30 notes file.txt
drwxr-xr-x    ? deploy staff       4096 Feb 11 2025 src
lrwxr-xr-x    ? deploy staff          8 Mar 01 09:00 current -> releases/1
-rw-------    ? deploy staff         12 Apr 02 08:00 .env
`, '/srv/app')

  assert.equal(listing.directory, '/srv/app')
  assert.deepEqual(listing.entries.map((entry) => [entry.name, entry.type]), [
    ['src', 'directory'],
    ['.env', 'file'],
    ['current', 'symlink'],
    ['notes file.txt', 'file'],
  ])
  assert.equal(listing.entries[3].path, '/srv/app/notes file.txt')
  assert.equal(listing.entries[1].hidden, true)
})

test('turns common SFTP failures into actionable messages', () => {
  assert.match(formatSftpError('subsystem request failed on channel 0'), /subsistema SFTP/i)
  assert.match(formatSftpError('Control socket connect(/tmp/cx/socket): No such file or directory'), /todavía no está lista/i)
  assert.match(formatSftpError('remote open("/root/file"): Permission denied'), /permiso denegado/i)
  assert.match(formatSftpError('', '', { timedOut: true }), /tardó demasiado/i)
})

test('parses a real listing from the macOS OpenSSH SFTP client', {
  skip: !fs.existsSync('/usr/bin/sftp') || !fs.existsSync('/usr/libexec/sftp-server'),
}, () => {
  const batch = buildListBatch(process.cwd())
  const result = spawnSync('/usr/bin/sftp', ['-N', '-b', '-', '-D', '/usr/libexec/sftp-server'], {
    encoding: 'utf8',
    input: batch,
    timeout: 5_000,
  })

  assert.equal(result.status, 0, result.stderr)
  const listing = parseSftpListing(result.stdout, process.cwd())
  assert.ok(listing.entries.some((entry) => entry.name === 'package.json' && entry.type === 'file'))
})

test('replaces an existing remote file through the macOS SFTP server', {
  skip: !fs.existsSync('/usr/bin/sftp') || !fs.existsSync('/usr/libexec/sftp-server'),
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conexum-editor-test-'))
  const localPath = path.join(directory, 'draft.txt')
  const destination = path.join(directory, 'remote.txt')
  const temporaryRemote = path.join(directory, '.remote.txt.conexum-test.tmp')
  try {
    fs.writeFileSync(localPath, 'new version')
    fs.writeFileSync(destination, 'old version')
    const result = spawnSync('/usr/bin/sftp', ['-N', '-b', '-', '-D', '/usr/libexec/sftp-server'], {
      encoding: 'utf8',
      input: buildWriteFileBatch(localPath, destination, temporaryRemote, '-rw-r-----'),
      timeout: 5_000,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(destination, 'utf8'), 'new version')
    assert.equal(fs.statSync(destination).mode & 0o777, 0o640)
    assert.equal(fs.existsSync(temporaryRemote), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('runs one transfer at a time and cancels queued work', async () => {
  const started = []
  const resolvers = []
  const canceled = []
  const queue = new TransferQueue((job) => new Promise((resolve) => {
    started.push(job.id)
    resolvers.push(resolve)
  }))

  queue.enqueue({ id: 'one' })
  queue.enqueue({ id: 'two', onCanceled: () => canceled.push('two') })
  queue.enqueue({ id: 'three' })
  assert.deepEqual(started, ['one'])
  assert.equal(queue.cancel('two'), true)
  assert.deepEqual(canceled, ['two'])

  resolvers.shift()()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(started, ['one', 'three'])
  resolvers.shift()()
  await new Promise((resolve) => setImmediate(resolve))
})
