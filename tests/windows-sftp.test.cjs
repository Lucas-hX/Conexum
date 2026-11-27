const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { buildSftpSubsystemArgs } = require('../electron/ssh-core.cjs')
const { SftpSession, validDownloadName } = require('../electron/windows-sftp.cjs')

test('uses the saved OpenSSH profile for an interactive-auth SFTP subsystem', () => {
  const args = buildSftpSubsystemArgs({
    host: 'example.invalid', username: 'qa', port: 2222,
    configFile: 'C:\\Test Folder\\config', identityFile: 'C:\\Test Folder\\key', sshAlias: 'box',
  })
  assert.deepEqual(args.slice(args.indexOf('-F')), ['-F', 'C:\\Test Folder\\config', '-o', 'HostName=example.invalid', '-p', '2222',
    '-l', 'qa', '-i', 'C:\\Test Folder\\key', '-o', 'IdentitiesOnly=yes', 'box', 'sftp'])
  assert.ok(args.includes('-T') && args.includes('-s') && args.includes('BatchMode=no'))
  assert.ok(!args.some(arg => arg.includes('StrictHostKeyChecking') || arg.includes('ControlPath')))
})

test('validates remote basenames before placing a download in a Windows folder', () => {
  for (const name of ['..\\escape', 'a/b', 'name:stream', 'NUL', 'lpt1.txt', 'CoM¹', 'CONOUT$', 'bad.', 'bad ', '?', '']) {
    assert.equal(validDownloadName(name), false, name)
  }
  assert.equal(validDownloadName('café notes.md'), true)
})

const gitRoot = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr')
const server = path.join(gitRoot, 'lib', 'ssh', 'sftp-server.exe')
test('Windows SFTP browses, edits with conflict detection, transfers and mutates real files', {
  skip: process.platform !== 'win32' || !fs.existsSync(server),
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conexum-sftp-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const env = { ...process.env }
  // The Git for Windows test server needs its MSYS2 DLLs. The production
  // client uses Windows OpenSSH and has no dependency on Git.
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'Path'
  env[pathKey] = path.join(gitRoot, 'bin') + ';' + env[pathKey]
  const child = spawn(server, [], { cwd: dir, env, windowsHide: true })
  const files = new SftpSession(child)
  t.after(() => files.close())
  const filename = 'hello ñ [qa].md'
  fs.writeFileSync(path.join(dir, filename), 'original\r\n')
  const { entries, directory } = await files.list('')
  const entry = entries.find(item => item.name === filename)
  assert.equal(entry.type, 'file')
  assert.equal(entry.size, 10)
  const source = await files.readText(entry.path)
  assert.equal(source.content, 'original\r\n')
  const content = 'línea nueva\n'.repeat(5000)
  const saved = await files.writeText({ remotePath: entry.path, baselineFingerprint: source.fingerprint, content })
  assert.equal(saved.conflict, false)
  assert.equal(fs.readFileSync(path.join(dir, filename), 'utf8'), content)
  assert.ok((await files.writeText({ remotePath: entry.path, baselineFingerprint: source.fingerprint, content: 'stale' })).conflict)
  const rename = files.codec.ext_openssh_rename
  files.codec.ext_openssh_rename = () => { throw new Error('Server does not support this extended request') }
  await assert.rejects(files.writeText({ remotePath: entry.path, baselineFingerprint: saved.file.fingerprint, content: 'replacement' }), /preserved/)
  assert.equal(fs.readFileSync(path.join(dir, filename), 'utf8'), content)
  assert.ok(!fs.readdirSync(dir).some(name => name.startsWith('.conexum-')))
  files.codec.ext_openssh_rename = rename
  fs.writeFileSync(path.join(dir, 'binary'), Buffer.from([0]))
  await assert.rejects(files.readText(directory + '/binary'), /binary/i)
  fs.writeFileSync(path.join(dir, 'too-large'), Buffer.alloc(2 * 1024 * 1024 + 1))
  await assert.rejects(files.readText(directory + '/too-large'), /limit/i)
  const folder = directory + '/storage space'
  await files.mutate('mkdir', folder)
  const upload = folder + '/first copy.md'
  const abort = new AbortController()
  await files.transfer({ direction: 'upload', localPath: path.join(dir, filename), remotePath: upload }, abort.signal, () => {})
  const next = folder + '/second.md'
  await files.mutate('rename', upload, next)
  const localPath = path.join(dir, 'downloaded.txt')
  await files.transfer({ direction: 'download', localPath, remotePath: next }, abort.signal, () => {})
  assert.equal(fs.readFileSync(localPath, 'utf8'), content)
  await files.mutate('remove-file', next)
  await files.mutate('remove-directory', folder)
  assert.ok(!fs.existsSync(path.join(dir, 'storage space')))
  files.close()
  await assert.rejects(files.list(''), /closed/)
})
