const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSftpSubsystemArgs, openSshExecutable, processEnvForSsh } = require('./ssh-core.cjs')
const { decodeEditorText, formatSftpError, validateRemotePath } = require('./sftp-core.cjs')

const CHUNK = 32 * 1024
const MAX_EDITOR_BYTES = 2 * 1024 * 1024
const SIZE_ERROR = 'The file exceeds the editor’s safe 2 MB limit.'
const CLOSED = 'The SFTP connection has closed.'
const UNSAFE_LOCAL_NAME = /[\\/:*?"<>|\x00-\x1f]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i

function validDownloadName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !UNSAFE_LOCAL_NAME.test(name)
}

function permissions(mode) {
  const letters = ['r', 'w', 'x']
  let result = ({ 4: 'd', 10: 'l', 1: 'p', 2: 'c', 6: 'b', 12: 's' })[mode >>> 12] || '-'
  for (let bit = 8; bit >= 0; --bit) {
    const ordinary = mode & (1 << bit)
    if (bit % 3 === 0 && (mode & (1 << (9 + bit / 3)))) {
      const special = bit === 0 ? 't' : 's'
      result += ordinary ? special : special.toUpperCase()
    } else {
      result += ordinary ? letters[(8 - bit) % 3] : '-'
    }
  }
  return result
}

function modified(attributes) {
  return Number.isInteger(attributes.mtime) ? new Date(attributes.mtime * 1000).toISOString() : ''
}

function connectionError(diagnostic) {
  if (/permission denied|authentication failed|askpass.*(?:failed|cannot|not found)/i.test(diagnostic)) {
    return new Error('SFTP sign-in failed. Open the files panel again to retry.')
  }
  return new Error(diagnostic ? formatSftpError(diagnostic) : CLOSED)
}

// OpenSSH owns encryption, host verification, ssh_config and user authentication.
// Only the SFTP subsystem's binary standard input/output reach the packet codec.
function openWindowsSftp(connection, askpass, onClose) {
  const child = spawn(openSshExecutable('ssh'), buildSftpSubsystemArgs(connection), {
    cwd: os.homedir(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...processEnvForSsh(), SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: 'Conexum',
      CONEXUM_SFTP_DESTINATION: connection.username + '@' + connection.host + ':' + connection.port,
    },
  })
  return new SftpSession(child, onClose)
}

class SftpSession {
  constructor(child, onClose = () => {}) {
    this.child = child
    const SFTPStream = require('ssh2-streams/lib/sftp')
    this.codec = new SFTPStream()
    this.pending = new Set()
    this.onClose = onClose
    this.error = null
    const ready = Promise.withResolvers()
    this.ready = ready.promise
    this.ready.catch(() => {}) // A tab can close while OpenSSH is prompting.
    this.pending.add(ready.reject)
    this.authTimer = setTimeout(() => this.close(new Error('SFTP authentication timed out.')), 180_000)
    this.codec.once('ready', () => {
      clearTimeout(this.authTimer)
      this.pending.delete(ready.reject)
      ready.resolve()
    })
    let diagnostic = ''
    child.stderr.setEncoding('utf8').on('data', data => { diagnostic = (diagnostic + data).slice(-4096) })
    child.on('error', (error) => this.close(error))
    child.on('close', () => this.close(connectionError(diagnostic)))
    this.codec.on('error', () => this.close(new Error('The server sent an invalid SFTP response.')))
    child.stdin.on('error', () => this.close(connectionError(diagnostic)))
    child.stdout.on('error', (error) => this.close(error))
    this.codec.pipe(child.stdin)
    child.stdout.pipe(this.codec)
  }

  close(error = new Error(CLOSED)) {
    if (this.error) return
    this.error = error
    clearTimeout(this.authTimer)
    for (const reject of this.pending) reject(error)
    this.pending.clear()
    this.child.stdout.unpipe(this.codec)
    this.codec.unpipe(this.child.stdin)
    this.child.stdin.destroy()
    this.codec.destroy()
    this.child.kill()
    this.onClose(this)
  }

  async call(method, ...args) {
    await this.ready
    if (this.error) throw this.error
    const request = Promise.withResolvers()
    this.pending.add(request.reject)
    const timer = setTimeout(() => this.close(new Error('The SFTP server took too long to respond.')), 30_000)
    try {
      this.codec[method](...args, (error, result) => {
        if (!error) return request.resolve(result)
        if (error.code === 2) error.message = 'The remote path does not exist or is no longer available.'
        if (error.code === 3) error.message = 'Permiso denegado por el servidor SFTP.'
        request.reject(error)
      })
      return await request.promise
    } finally {
      clearTimeout(timer)
      this.pending.delete(request.reject)
    }
  }

  async withHandle(method, args, work) {
    const handle = await this.call(method, ...args)
    try {
      return await work(handle)
    } finally {
      await this.call('close', handle)
    }
  }

  async list(remotePath) {
    const directory = validateRemotePath(await this.call('realpath', validateRemotePath(remotePath, { allowEmpty: true }) || '.'))
    const entries = []
    let bytes = 0
    await this.withHandle('opendir', [directory], async handle => {
      for (;;) {
        let batch
        try { batch = await this.call('readdir', handle, { full: true }) }
        catch (error) { if (error.code === 1) break; throw error }
        if (batch.length === 0) break
        for (const { filename: name, attrs } of batch) {
          if (!name || name === '.' || name === '..' || /[\x00-\x1f/]/.test(name)) continue
          const childPath = validateRemotePath(path.posix.join(directory, name))
          bytes += 128 + Buffer.byteLength(childPath) + Buffer.byteLength(name)
          if (bytes > 4_000_000) throw new Error('The SFTP response is too large.')
          entries.push({
            name, path: childPath, type: attrs.isDirectory() ? 'directory' : attrs.isSymbolicLink() ? 'symlink' : 'file',
            size: Number(attrs.size || 0), permissions: permissions(attrs.mode), owner: String(attrs.uid ?? ''),
            modified: modified(attrs), hidden: name.startsWith('.'),
          })
        }
      }
    })
    entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return { directory, entries }
  }

  async mutate(operation, source, destination) {
    const target = validateRemotePath(source)
    if (operation === 'rename') return this.call('rename', target, validateRemotePath(destination))
    const method = { mkdir: 'mkdir', 'remove-file': 'unlink', 'remove-directory': 'rmdir' }[operation]
    if (typeof method !== 'string') throw new Error('SFTP operation not allowed.')
    return this.call(method, target)
  }

  // Read until EOF, including when the file grows after lstat. Bound both the
  // buffer size per request and the accumulated size of an editor document.
  async readChunks(handle, consume, limit = Infinity, signal) {
    const buf = Buffer.alloc(CHUNK)
    let offset = 0
    for (;;) {
      signal?.throwIfAborted()
      const count = await this.call('readData', handle, buf, 0, CHUNK, offset)
      if (!count) break
      offset += count
      if (offset > limit) throw new Error(SIZE_ERROR)
      await consume(buf.subarray(0, count), offset)
    }
  }

  async readText(remotePath) {
    const file = validateRemotePath(remotePath)
    const attrs = await this.call('lstat', file)
    if (!attrs.isFile()) throw new Error('The editor can currently open regular files only.')
    if (attrs.size > MAX_EDITOR_BYTES) throw new Error(SIZE_ERROR)
    const chunks = []
    await this.withHandle('open', [file, 'r'], async handle => {
      await this.readChunks(handle, chunk => chunks.push(Buffer.from(chunk)), MAX_EDITOR_BYTES)
    })
    const content = Buffer.concat(chunks)
    return {
      path: file, name: path.posix.basename(file), content: decodeEditorText(content),
      size: content.length, modified: modified(attrs), permissions: permissions(attrs.mode),
      fingerprint: crypto.createHash('sha256').update(content).digest('hex'),
    }
  }

  async writeText(request) {
    const file = validateRemotePath(request.remotePath)
    if (typeof request.content !== 'string' || request.content.includes('\0') || Buffer.byteLength(request.content) > MAX_EDITOR_BYTES) {
      throw new Error('The content is invalid or exceeds the 2 MB limit.')
    }
    if (typeof request.baselineFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.baselineFingerprint)) {
      throw new Error('Could not verify the original file version.')
    }
    const current = await this.readText(file)
    const conflict = (version) => ({ conflict: true, current: { fingerprint: version.fingerprint, size: version.size, modified: version.modified } })
    if (current.fingerprint !== request.baselineFingerprint) return conflict(current)
    const temporary = path.posix.join(path.posix.dirname(file), '.conexum-' + crypto.randomUUID() + '.tmp')
    const content = Buffer.from(request.content)
    let created = false
    try {
      await this.withHandle('open', [temporary, 'wx', { mode: 0o600 }], async handle => {
        created = true
        for (let offset = 0; offset < content.length; offset += CHUNK) {
          await this.call('writeData', handle, content, offset, Math.min(CHUNK, content.length - offset), offset)
        }
      })
      const latest = await this.readText(file)
      if (latest.fingerprint !== current.fingerprint) return conflict(latest)
      const attrs = await this.call('lstat', file)
      if (!attrs.isFile() || !Number.isInteger(attrs.mode)) throw new Error('Could not verify remote file permissions.')
      await this.call('chmod', temporary, attrs.mode & 0o7777)
      // Standard SFTP v3 rename refuses to overwrite. Never unlink the user's
      // original to simulate an atomic replacement on unsupported servers.
      try {
        await this.call('ext_openssh_rename', temporary, file)
      } catch (error) {
        if (error.code === 8 || /does not support this extended request/i.test(error.message)) {
          throw new Error('This SFTP server does not support atomic replacement. The original file was preserved.')
        }
        throw error
      }
      created = false
      return { conflict: false, file: {
        path: file, name: current.name, size: content.length, permissions: permissions(attrs.mode),
        modified: new Date().toISOString(), fingerprint: crypto.createHash('sha256').update(content).digest('hex'),
      } }
    } finally {
      if (created) await this.call('unlink', temporary).catch(() => {})
    }
  }

  async transfer(job, signal, progress) {
    signal.throwIfAborted()
    const aborted = Promise.withResolvers()
    const onAbort = () => aborted.reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    try { await Promise.race([this.ready, aborted.promise]) }
    finally { signal.removeEventListener('abort', onAbort) }
    signal.throwIfAborted()
    const remotePath = validateRemotePath(job.remotePath)
    if (job.direction === 'upload') {
      const local = await fs.promises.open(job.localPath, 'r')
      try {
        const { size } = await local.stat()
        await this.withHandle('open', [remotePath, 'w'], async handle => {
          let offset = 0
          for await (const data of local.createReadStream({ autoClose: false, highWaterMark: CHUNK, signal })) {
            signal.throwIfAborted()
            await this.call('writeData', handle, data, 0, data.length, offset)
            offset += data.length
            progress(offset, size)
          }
        })
      } finally { await local.close() }
    } else {
      await this.withHandle('open', [remotePath, 'r'], async handle => {
        const attrs = await this.call('fstat', handle)
        if (!attrs.isFile()) throw new Error('Select a regular file to download.')
        signal.throwIfAborted()
        const local = await fs.promises.open(job.localPath, 'w')
        try {
          await this.readChunks(handle, async (chunk, offset) => {
            await local.writeFile(chunk)
            progress(offset, attrs.size)
          }, Infinity, signal)
        } finally { await local.close() }
      })
    }
  }
}

module.exports = { openWindowsSftp, SftpSession, validDownloadName }
