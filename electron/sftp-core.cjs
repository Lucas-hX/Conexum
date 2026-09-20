const path = require('node:path')

function validateRemotePath(value, { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096 || /[\r\n\0]/.test(value)) {
    throw new Error('La ruta remota no es válida.')
  }
  if (!value.startsWith('/')) throw new Error('La ruta remota debe ser absoluta.')
  return path.posix.normalize(value)
}

function quoteSftpPath(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
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
  if (typeof controlPath !== 'string' || !path.isAbsolute(controlPath) || /[\r\n\0]/.test(controlPath)) {
    throw new Error('Ruta de multiplexación inválida.')
  }
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'ControlMaster=no',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'RemoteCommand=none',
    '-o', `ControlPath=${controlPath}`,
  ]
  if (batch) args.unshift('-q')
  if (batch) args.push('-b', '-')
  args.push(appendSftpConnectionArgs(args, connection))
  return args
}

function buildListBatch(remotePath = '') {
  const validated = validateRemotePath(remotePath, { allowEmpty: true })
  return `pwd\nls -la${validated ? ` ${quoteSftpPath(validated)}` : ''}\n`
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
  throw new Error('Operación SFTP no permitida.')
}

function parseSftpListing(output, requestedPath = '') {
  if (typeof output !== 'string' || output.length > 4_000_000) throw new Error('La respuesta SFTP es demasiado grande.')
  const pwdMatch = output.match(/^Remote working directory:\s*(.+)$/m)
  const directory = validateRemotePath(requestedPath || pwdMatch?.[1] || '/')
  const entries = []
  const longEntry = /^([bcdlps-][rwxStTs-]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d{1,2})\s+(\S+)\s+(.+)$/

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

function buildTransferCommand(direction, localPath, remotePath) {
  if (typeof localPath !== 'string' || !path.isAbsolute(localPath) || localPath.length > 4_096 || /[\r\n\0]/.test(localPath)) {
    throw new Error('La ruta local no es válida.')
  }
  const remote = validateRemotePath(remotePath)
  if (direction === 'upload') return `put ${quoteSftpPath(localPath)} ${quoteSftpPath(remote)}`
  if (direction === 'download') return `get ${quoteSftpPath(remote)} ${quoteSftpPath(localPath)}`
  throw new Error('Dirección de transferencia inválida.')
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
  buildSftpArgs,
  buildTransferCommand,
  parseSftpListing,
  quoteSftpPath,
  validateRemotePath,
}
