const path = require('node:path')
const { isValidSessionId } = require('./ssh-core.cjs')

const LOCAL_PROFILE_ID = 'conexum-local'

function validateLocalConnection(request) {
  if (!request || typeof request !== 'object' || !isValidSessionId(request.sessionId)) {
    throw new Error('Invalid local session identifier.')
  }
  if (request.profile?.kind !== 'local' || request.profile.id !== LOCAL_PROFILE_ID) {
    throw new Error('Invalid local profile.')
  }
  return {
    sessionId: request.sessionId,
    cols: Number.isInteger(request.cols) ? Math.min(Math.max(request.cols, 20), 500) : 100,
    rows: Number.isInteger(request.rows) ? Math.min(Math.max(request.rows, 5), 200) : 30,
  }
}

function localShell(platform = process.platform, windowsRoot = process.env.SystemRoot) {
  if (platform === 'win32') {
    return {
      executable: path.win32.join(windowsRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo'],
    }
  }
  return { executable: '/bin/zsh', args: ['-l', '-i'] }
}

function machineInfo(hostname, username, homeDirectory, platform = process.platform) {
  const shortName = String(hostname || '').split('.')[0]
  return {
    name: shortName && shortName.length <= 80 && !/[\r\n\0]/.test(shortName) ? shortName : (platform === 'win32' ? 'Windows' : 'Esta Mac'),
    username: typeof username === 'string' && username.length <= 80 && !/[\r\n\0]/.test(username) ? username : '',
    homeDirectory: typeof homeDirectory === 'string' && path.isAbsolute(homeDirectory) ? homeDirectory : '/',
  }
}

function parseLsofCwd(output) {
  if (typeof output !== 'string' || output.length > 16_384) return null
  const match = output.match(/^n(\/[^\r\n\0]*)$/m)
  return match && match[1].length <= 4_096 ? match[1] : null
}

module.exports = { LOCAL_PROFILE_ID, localShell, machineInfo, parseLsofCwd, validateLocalConnection }
