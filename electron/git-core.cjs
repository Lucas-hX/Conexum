const path = require('node:path')

const MAX_GIT_DIRECTORY_LENGTH = 4_096
const MAX_GIT_FILES = 200

function validateGitDirectory(value, flavor = 'posix') {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_GIT_DIRECTORY_LENGTH || /[\r\n\0]/.test(value)) {
    throw new Error('The Git directory is not valid.')
  }
  const implementation = flavor === 'win32' ? path.win32 : path.posix
  if (!implementation.isAbsolute(value)) throw new Error('The Git directory must be absolute.')
  return implementation.normalize(value)
}

function quoteRemoteShellArg(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('The remote argument is not valid.')
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function buildRemoteGitCommand(directory, operation) {
  const validated = validateGitDirectory(directory)
  const gitDirectory = quoteRemoteShellArg(validated)
  const commands = {
    root: `LC_ALL=C git -C ${gitDirectory} rev-parse --show-toplevel`,
    branch: `LC_ALL=C git -C ${gitDirectory} symbolic-ref --quiet --short HEAD || LC_ALL=C git -C ${gitDirectory} rev-parse --short HEAD`,
    status: `LC_ALL=C git -C ${gitDirectory} status --porcelain=v1 -z --untracked-files=all`,
    unstaged: `LC_ALL=C git -C ${gitDirectory} diff --shortstat --no-ext-diff`,
    staged: `LC_ALL=C git -C ${gitDirectory} diff --cached --shortstat --no-ext-diff`,
  }
  if (!Object.hasOwn(commands, operation)) throw new Error('The Git operation is not allowed.')
  return commands[operation]
}

function parsePorcelainStatus(output, limit = MAX_GIT_FILES) {
  if (typeof output !== 'string' || output.length > 2_000_000) throw new Error('The Git status response is too large.')
  const records = output.split('\0')
  const files = []
  let truncated = false

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.length < 4 || record[2] !== ' ') continue
    const code = record.slice(0, 2)
    const filePath = record.slice(3)
    if (!filePath || /[\r\n\0]/.test(filePath)) continue
    const renamed = /[RC]/.test(code)
    const originalPath = renamed ? records[++index] || null : null
    if (files.length >= limit) {
      truncated = true
      continue
    }
    files.push({
      path: filePath,
      originalPath: originalPath && !/[\r\n\0]/.test(originalPath) ? originalPath : null,
      code,
      staged: code[0] !== ' ' && code[0] !== '?',
      unstaged: code[1] !== ' ',
      untracked: code === '??',
      conflicted: code === 'DD' || code === 'AU' || code === 'UD' || code === 'UA' || code === 'DU' || code === 'AA' || code === 'UU',
    })
  }
  return { files, truncated }
}

function parseShortStat(output) {
  if (typeof output !== 'string' || output.length > 4_096) throw new Error('The Git diff summary is invalid.')
  const text = output.trim()
  const files = Number(text.match(/(\d+) files? changed/)?.[1] ?? 0)
  const insertions = Number(text.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0)
  const deletions = Number(text.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0)
  return { files, insertions, deletions }
}

module.exports = {
  MAX_GIT_FILES,
  buildRemoteGitCommand,
  parsePorcelainStatus,
  parseShortStat,
  quoteRemoteShellArg,
  validateGitDirectory,
}
