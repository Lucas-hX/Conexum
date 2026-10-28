const path = require('node:path')

function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096 || /[\r\n\0]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function validateBrowserPreference(value) {
  return value === 'chrome' ? 'chrome' : 'default'
}

function chromeLaunchCandidates(platform, environment = process.env) {
  if (platform === 'darwin') return [{ command: '/usr/bin/open', argsPrefix: ['-b', 'com.google.Chrome'] }]
  if (platform === 'win32') {
    const roots = [environment.PROGRAMFILES, environment['PROGRAMFILES(X86)'], environment.LOCALAPPDATA]
      .filter((value) => typeof value === 'string' && path.win32.isAbsolute(value))
    return roots.map((root) => ({ command: path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), argsPrefix: [] }))
  }
  return [
    { command: '/usr/bin/google-chrome', argsPrefix: [] },
    { command: '/usr/bin/google-chrome-stable', argsPrefix: [] },
    { command: '/usr/bin/chromium', argsPrefix: [] },
  ]
}

module.exports = { chromeLaunchCandidates, validateBrowserPreference, validateExternalUrl }
