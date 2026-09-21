const path = require('node:path')
const { validateControlPath } = require('./ssh-core.cjs')

function validateRemotePath(value, { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096 || /[\r\n\0]/.test(value)) {
    throw new Error('The remote path is not valid.')
  }
  if (!value.startsWith('/')) throw new Error('The remote path must be absolute.')
  return path.posix.normalize(value)
}

function quoteSftpPath(value) {
  return `"${value.replace(/([\\"*?\[])/g, '\\$1')}"`
}

function appendSftpConnectionArgs(args, connection) {
  if (connection.configFile && connection.sshAlias) {
    args.push(
      '-F', connection.configFile,
      '-o', `HostName=${connection.host}`,
      '-P', String(connection.port),
      '-o', `User=${connection.username}`,
    )
    if (connection.identityFile) args.push('-i', connection.identityFile, '-o', 'IdentitiesOnly=yes')
    return connection.sshAlias
  }

  args.push('-P', String(connection.port))
  if (connection.identityFile) args.push('-i', connection.identityFile, '-o', 'IdentitiesOnly=yes')
  return `${connection.username}@${connection.host}`
}

function buildSftpArgs(connection, controlPath, { batch = true } = {}) {
  validateControlPath(controlPath)
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'ControlMaster=no',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'RemoteCommand=none',
    '-o', `ControlPath=${controlPath}`,
  ]
  // Batch mode enables quiet mode implicitly. `-N` restores diagnostics while
  // commands themselves are hidden with the `@` prefix below.
  if (batch) args.unshift('-N')
  if (batch) args.push('-b', '-')
  args.push(appendSftpConnectionArgs(args, connection))
  return args
}

function buildListBatch(remotePath = '') {
  const validated = validateRemotePath(remotePath, { allowEmpty: true })
  // Listing an absolute path makes OpenSSH prefix every returned name with
  // that path. Change directory first so names remain relative and parseable.
  return `${validated ? `@cd ${quoteSftpPath(validated)}\n` : ''}@pwd\n@ls -lan\n`
}

function buildMutationBatch(operation, sourcePath, destinationPath) {
  const source = validateRemotePath(sourcePath)
  if (operation === 'mkdir') return `mkdir ${quoteSftpPath(source)}\n`
  if (operation === 'remove-file') return `rm ${quoteSftpPath(source)}\n`
  if (operation === 'remove-directory') return `rmdir ${quoteSftpPath(source)}\n`
  if (operation === 'rename') {
    const destination = validateRemotePath(destinationPath)
    return `rename ${quoteSftpPath(source)} ${quoteSftpPath(destination)}\n`
  }
  throw new Error('SFTP operation not allowed.')
}

function parseSftpListing(output, requestedPath = '') {
  if (typeof output !== 'string' || output.length > 4_000_000) throw new Error('The SFTP response is too large.')
  const pwdMatch = output.match(/^Remote working directory:\s*(.+)$/m)
  const directory = validateRemotePath(pwdMatch?.[1] || requestedPath || '/')
  const entries = []
  const longEntry = /^([bcdlps-][rwxStTs-]{9})\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d{1,2})\s+(\S+)\s+(.+)$/

  for (const rawLine of output.split(/\r?\n/)) {
    const match = rawLine.match(longEntry)
    if (!match) continue
    const rawName = match[8]
    const name = match[1].startsWith('l') ? rawName.split(' -> ')[0] : rawName
    if (name === '.' || name === '..' || /[\r\n\0/]/.test(name)) continue
    entries.push({
      name,
      path: path.posix.join(directory, name),
      type: match[1].startsWith('d') ? 'directory' : match[1].startsWith('l') ? 'symlink' : 'file',
      size: Number(match[4]),
      permissions: match[1],
      owner: match[2],
      modified: `${match[5]} ${match[6]} ${match[7]}`,
      hidden: name.startsWith('.'),
    })
  }

  entries.sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') return -1
    if (left.type !== 'directory' && right.type === 'directory') return 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
  return { directory, entries }
}

function formatSftpError(stderr = '', stdout = '', { timedOut = false } = {}) {
  if (timedOut) return 'The SFTP server took too long to respond.'
  const detail = `${stderr}\n${stdout}`.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim()
  if (/subsystem request failed|subsystem.*not found|unknown subsystem/i.test(detail)) {
    return 'El servidor SSH no tiene habilitado el subsistema SFTP.'
  }
  if (/control socket connect.*no such file|mux_client_request_session.*master/i.test(detail)) {
    return 'The SSH connection is not ready for SFTP yet. Wait a few seconds and try again.'
  }
  if (/permission denied/i.test(detail)) return 'Permiso denegado por el servidor SFTP.'
  if (/no such file|couldn.t stat|stat remote/i.test(detail)) return 'The remote path does not exist or is no longer available.'
  if (/connection refused/i.test(detail)) return 'The server refused the SFTP connection.'
  if (/timed out|operation timed out/i.test(detail)) return 'The SFTP connection timed out.'
  const lastLine = detail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)
  return lastLine && lastLine.length <= 500 ? lastLine : 'The SFTP operation could not be completed.'
}

function buildTransferCommand(direction, localPath, remotePath) {
  if (typeof localPath !== 'string' || !path.isAbsolute(localPath) || localPath.length > 4_096 || /[\r\n\0]/.test(localPath)) {
    throw new Error('The local path is not valid.')
  }
  const remote = validateRemotePath(remotePath)
  if (direction === 'upload') return `put ${quoteSftpPath(localPath)} ${quoteSftpPath(remote)}`
  if (direction === 'download') return `get ${quoteSftpPath(remote)} ${quoteSftpPath(localPath)}`
  throw new Error('Invalid transfer direction.')
}

function buildReadFileBatch(remotePath, localPath) {
  const remote = validateRemotePath(remotePath)
  if (typeof localPath !== 'string' || !path.isAbsolute(localPath) || localPath.length > 4_096 || /[\r\n\0]/.test(localPath)) {
    throw new Error('The temporary local path is not valid.')
  }
  return `get ${quoteSftpPath(remote)} ${quoteSftpPath(localPath)}\n`
}

function decodeEditorText(content) {
  if (!Buffer.isBuffer(content)) throw new Error('The remote content is not valid.')
  if (content.includes(0)) throw new Error('The file appears to be binary and cannot be opened in the text editor.')
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content)
  } catch {
    throw new Error('The file does not appear to be UTF-8 encoded.')
  }
}

function permissionsToMode(permissions) {
  if (typeof permissions !== 'string' || !/^[bcdlps-][rwxStTs-]{9}$/.test(permissions)) return null
  const triplets = [permissions.slice(1, 4), permissions.slice(4, 7), permissions.slice(7, 10)]
  const ordinary = triplets.map((triplet) => {
    let value = 0
    if (triplet[0] === 'r') value += 4
    if (triplet[1] === 'w') value += 2
    if (/[xst]/i.test(triplet[2])) value += 1
    return value
  }).join('')
  const special = (/[sS]/.test(permissions[3]) ? 4 : 0) + (/[sS]/.test(permissions[6]) ? 2 : 0) + (/[tT]/.test(permissions[9]) ? 1 : 0)
  return special ? `${special}${ordinary}` : ordinary
}

function buildWriteFileBatch(localPath, remotePath, temporaryRemotePath, permissions) {
  if (typeof localPath !== 'string' || !path.isAbsolute(localPath) || localPath.length > 4_096 || /[\r\n\0]/.test(localPath)) {
    throw new Error('The temporary local path is not valid.')
  }
  const remote = validateRemotePath(remotePath)
  const temporary = validateRemotePath(temporaryRemotePath)
  if (path.posix.dirname(remote) !== path.posix.dirname(temporary)) throw new Error('The temporary remote file must be in the same folder.')
  const mode = permissionsToMode(permissions)
  return [
    `put ${quoteSftpPath(localPath)} ${quoteSftpPath(temporary)}`,
    ...(mode ? [`chmod ${mode} ${quoteSftpPath(temporary)}`] : []),
    `rename ${quoteSftpPath(temporary)} ${quoteSftpPath(remote)}`,
    '',
  ].join('\n')
}

class TransferQueue {
  constructor(run) {
    this.run = run
    this.pending = []
    this.active = null
  }

  enqueue(job) {
    this.pending.push(job)
    this.drain()
  }

  cancel(id) {
    const pendingIndex = this.pending.findIndex((job) => job.id === id)
    if (pendingIndex >= 0) {
      const [job] = this.pending.splice(pendingIndex, 1)
      job.onCanceled?.()
      return true
    }
    if (this.active?.id === id) {
      this.active.cancel?.()
      return true
    }
    return false
  }

  drain() {
    if (this.active || this.pending.length === 0) return
    const job = this.pending.shift()
    this.active = job
    Promise.resolve(this.run(job)).finally(() => {
      if (this.active?.id === job.id) this.active = null
      this.drain()
    })
  }

  clear() {
    for (const job of this.pending.splice(0)) job.onCanceled?.()
    this.active?.cancel?.()
  }
}

module.exports = {
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
  permissionsToMode,
  quoteSftpPath,
  validateRemotePath,
}
