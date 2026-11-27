// Run after building: pnpm exec electron tests/windows-terminal-smoke.cjs
// Exercises the real renderer and xterm against a synthetic session and clipboard.
const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

function installFixture() {
  window.fixture = { writes: [] }
  window.conexum = {
    isWindows: true,
    ssh: {
      connect: async ({ sessionId }) => { window.fixture.sessionId = sessionId },
      write: (id, data) => window.fixture.writes.push({ id, data }),
      resize() {}, disconnect() {},
      onData(listener) { window.fixture.receive = listener; return () => {} },
      onExit() { return () => {} },
    },
    local: { getMachineInfo: async () => ({ name: 'Test PC', username: 'demo', homeDirectory: '' }) },
    editor: { setState() {} },
  }
}

async function exerciseTerminal() {
  async function waitFor(read) {
    for (let tries = 0; tries < 100; tries++) {
      const value = read()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('Timed out waiting for the terminal fixture.')
  }
  const local = await waitFor(() => document.querySelector('.server-shortcut'))
  local.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await waitFor(() => window.fixture.sessionId)
  const { sessionId, receive, writes } = window.fixture
  receive({ sessionId, data: '\x1b[?2004h\x1b[?1000h\r\nPASTE-READY\r\n' })
  const row = await waitFor(() => [...document.querySelectorAll('.xterm-rows > div')].find((line) => line.textContent.includes('PASTE-READY')))
  const textarea = document.querySelector('.xterm-helper-textarea')
  textarea.focus()
  writes.length = 0
  const firstLine = 'a'.repeat(63_993)
  const prompt = firstLine + '🙂\r\nsegunda línea'
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', prompt)
  textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  const expected = '\x1b[200~' + prompt.replace('\r\n', '\r') + '\x1b[201~'
  const result = {
    multiline: writes.map(({ data }) => data).join('') === expected,
    validChunks: writes.length > 1 && writes.every(({ id, data }) =>
      id === sessionId && data.length <= 64_000 && data.isWellFormed()),
  }
  // Shift overrides the application's mouse capture. A triple click selects the line.
  const rect = row.getBoundingClientRect()
  const mouse = { bubbles: true, cancelable: true, detail: 3, shiftKey: true, clientX: rect.left + 5, clientY: rect.top + 3 }
  row.dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 }))
  document.dispatchEvent(new MouseEvent('mouseup', mouse))
  const copy = new DataTransfer()
  document.execCommand = (command) => {
    if (command !== 'copy') return false
    textarea.dispatchEvent(new ClipboardEvent('copy', { clipboardData: copy, bubbles: true, cancelable: true }))
    return true
  }
  const controlC = () => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true }))
  writes.length = 0
  controlC()
  const selectedText = copy.getData('text/plain').trim() === 'PASTE-READY' && writes.length === 0
  controlC()
  return { ...result, selectedText, interrupt: writes.length === 1 && writes[0].data === '\x03' }
}

const watchdog = setTimeout(() => { console.error('Terminal smoke test timed out.'); app.exit(1) }, 20_000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { partition: 'terminal-regression', backgroundThrottling: false } })
  const contents = win.webContents
  await win.loadURL('about:blank')
  contents.debugger.attach()
  await contents.debugger.sendCommand('Page.enable')
  await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixture})()` })
  await win.loadFile(path.resolve(__dirname, '../dist/index.html'))
  const result = await contents.executeJavaScript(`(${exerciseTerminal})()`)
  assert.deepEqual(result, { multiline: true, validChunks: true, selectedText: true, interrupt: true })
  console.log('Windows terminal clipboard and Ctrl+C regression passed.')
  clearTimeout(watchdog)
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
