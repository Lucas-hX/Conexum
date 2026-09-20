const path = require('node:path')
const { isValidSessionId } = require('./ssh-core.cjs')

const LOCAL_PROFILE_ID = 'conexum-local'

function validateLocalConnection(request) {
  if (!request || typeof request !== 'object' || !isValidSessionId(request.sessionId)) {
    throw new Error('Identificador de sesión local inválido.')
  }
  if (request.profile?.kind !== 'local' || request.profile.id !== LOCAL_PROFILE_ID) {
    throw new Error('Perfil local inválido.')
  }
  return {
    sessionId: request.sessionId,
    cols: Number.isInteger(request.cols) ? Math.min(Math.max(request.cols, 20), 500) : 100,
    rows: Number.isInteger(request.rows) ? Math.min(Math.max(request.rows, 5), 200) : 30,
  }
}

function machineInfo(hostname, username, homeDirectory) {
  const shortName = String(hostname || '').split('.')[0]
  return {
    name: shortName && shortName.length <= 80 && !/[\r\n\0]/.test(shortName) ? shortName : 'Esta Mac',
    username: typeof username === 'string' && username.length <= 80 && !/[\r\n\0]/.test(username) ? username : '',
    homeDirectory: typeof homeDirectory === 'string' && path.isAbsolute(homeDirectory) ? homeDirectory : '/',
  }
}

function parseLsofCwd(output) {
  if (typeof output !== 'string' || output.length > 16_384) return null
  const match = output.match(/^n(\/[^\r\n\0]*)$/m)
  return match && match[1].length <= 4_096 ? match[1] : null
}

module.exports = { LOCAL_PROFILE_ID, machineInfo, parseLsofCwd, validateLocalConnection }
