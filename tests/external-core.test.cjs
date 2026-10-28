const test = require('node:test')
const assert = require('node:assert/strict')
const { chromeLaunchCandidates, validateBrowserPreference, validateExternalUrl } = require('../electron/external-core.cjs')

test('allows only credential-free HTTP and HTTPS links', () => {
  assert.equal(validateExternalUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1')
  assert.equal(validateExternalUrl('http://localhost:3000/path'), 'http://localhost:3000/path')
  assert.equal(validateExternalUrl('javascript:alert(1)'), null)
  assert.equal(validateExternalUrl('file:///etc/passwd'), null)
  assert.equal(validateExternalUrl('https://user:secret@example.com'), null)
  assert.equal(validateExternalUrl('https://example.com\nmalicious'), null)
})

test('builds platform-specific Chrome candidates without a command shell', () => {
  assert.deepEqual(chromeLaunchCandidates('darwin'), [{ command: '/usr/bin/open', argsPrefix: ['-b', 'com.google.Chrome'] }])
  assert.deepEqual(chromeLaunchCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local' }), [
    { command: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', argsPrefix: [] },
    { command: 'C:\\Users\\demo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', argsPrefix: [] },
  ])
  assert.equal(validateBrowserPreference('chrome'), 'chrome')
  assert.equal(validateBrowserPreference('unknown'), 'default')
})
