// Exercise the file:// production renderer. All remote data lives in this test.
const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

function installFixture() {
  localStorage.setItem('conexum.connectionProfiles.v2', JSON.stringify([{
    id: 'fixture-files', name: 'Test files', group: 'Test', host: 'example.invalid', port: 22, username: 'demo',
  }]))
  const file = { name: 'sample.json', path: '/sample.json', type: 'file', content: '{}', size: 2, permissions: '-rw-------', owner: 'demo', modified: '', fingerprint: 'original' }
  const fixture = window.fixture = { saved: '', workers: [], workerErrors: [] }
  const NativeWorker = window.Worker
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      const info = { url: String(url), messages: 0 }
      fixture.workers.push(info)
      this.addEventListener('message', () => info.messages++)
      this.addEventListener('error', (error) => fixture.workerErrors.push(error.message || 'Worker failed to load'))
    }
  }
  window.conexum = {
    isWindows: true,
    local: { getMachineInfo: async () => ({ name: 'Test PC', username: 'demo', homeDirectory: '' }) },
    ssh: { connect: async () => ({}), write() {}, resize() {}, disconnect() {}, onData: () => () => {}, onExit: () => () => {} },
    sftp: { list: async () => ({ directory: '/', entries: [file] }), transfers: async () => [], onFileSaved: () => () => {}, onTransferProgress: () => () => {} },
    editor: {
      setState() {},
      readText: async () => file,
      writeText: async ({ content }) => {
        fixture.saved = content
        await new Promise(resolve => { fixture.finishSave = resolve })
        return { conflict: false, file: { ...file, fingerprint: 'saved' } }
      },
    },
  }
}

async function run() {
  const window = new BrowserWindow({ show: false, webPreferences: { partition: 'editor-regression', backgroundThrottling: false } })
  const contents = window.webContents
  await window.loadURL('about:blank')
  contents.debugger.attach()
  await contents.debugger.sendCommand('Page.enable')
  await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: '(' + installFixture + ')()' })
  await window.loadFile(path.resolve(__dirname, '../dist/index.html'))
  const evaluate = expression => contents.executeJavaScript(expression, true)
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await evaluate('Boolean(' + expression + ')')) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for ' + expression + ': ' + await evaluate('JSON.stringify(fixture)'))
  }
  async function shortcut(key, code) {
    for (const type of ['keyDown', 'keyUp']) {
      await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: code, modifiers: 2 })
    }
  }
  const write = text => contents.debugger.sendCommand('Input.insertText', { text })
  await waitFor("document.querySelector('[title=\"Double-click to open Test files\"]')")
  await evaluate("document.querySelector('[title=\"Double-click to open Test files\"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  await waitFor("document.querySelector('[title=\"SFTP\"]:not(:disabled)')")
  await evaluate("document.querySelector('[title=\"SFTP\"]').click()")
  await waitFor("document.querySelector('.sftp-entry-row')")
  await evaluate("document.querySelector('.sftp-entry-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  const input = ".monaco-editor .native-edit-context, .monaco-editor textarea"
  await waitFor("document.querySelector(" + JSON.stringify(input) + ")")
  await evaluate("document.querySelector(" + JSON.stringify(input) + ").focus()")
  await shortcut('a', 65)
  // Use characters unaffected by Monaco's auto-closing brackets and quotes.
  const draft = 'á quick edit in a JSON buffer'
  for (const char of draft) await write(char)
  await shortcut('s', 83)
  await waitFor('fixture.finishSave')
  assert.equal(await evaluate('fixture.saved'), draft)
  await write(' ')
  await evaluate('fixture.finishSave()')
  await waitFor("document.querySelector('.editor-statusbar').textContent.includes('Unsaved changes')")
  await waitFor("fixture.workers.some(w => w.url.includes('json.worker') && w.messages > 0)")
  assert.deepEqual(await evaluate('fixture.workerErrors'), [])
  console.log('Windows editor saved the full buffer, preserved newer edits and loaded its packaged JSON worker.')
}

setTimeout(() => { console.error('Editor smoke test exceeded 45 seconds.'); app.exit(1) }, 45000).unref()
app.whenReady().then(run).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
