const test = require('node:test')
const assert = require('node:assert/strict')

const {
  TransferQueue,
  buildListBatch,
  buildMutationBatch,
  buildSftpArgs,
  buildTransferCommand,
  parseSftpListing,
  quoteSftpPath,
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

  const interactiveArgs = buildSftpArgs(connection, '/tmp/conexum-control', { batch: false })
  assert.equal(interactiveArgs.includes('-q'), false)
  assert.equal(interactiveArgs.includes('-b'), false)
})

test('builds safe list, mutation, and transfer commands', () => {
  assert.equal(buildListBatch('/srv/app'), 'pwd\nls -la "/srv/app"\n')
  assert.equal(buildMutationBatch('mkdir', '/srv/new folder'), 'mkdir "/srv/new folder"\n')
  assert.equal(buildMutationBatch('rename', '/srv/old', '/srv/new'), 'rename "/srv/old" "/srv/new"\n')
  assert.equal(buildTransferCommand('upload', '/Users/test/file.txt', '/srv/file.txt'), 'put "/Users/test/file.txt" "/srv/file.txt"')
  assert.throws(() => buildMutationBatch('execute', '/srv/app'), /no permitida/i)
})

test('parses and sorts OpenSSH long listings', () => {
  const listing = parseSftpListing(`Remote working directory: /srv/app
-rw-r--r--    1 deploy staff        120 Jan 03 12:30 notes file.txt
drwxr-xr-x    3 deploy staff       4096 Feb 11 2025 src
lrwxr-xr-x    1 deploy staff          8 Mar 01 09:00 current -> releases/1
-rw-------    1 deploy staff         12 Apr 02 08:00 .env
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
