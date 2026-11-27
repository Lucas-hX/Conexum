const assert = require('node:assert/strict')
const { INTERACTIVE_PTY_OPTIONS } = require('../../electron/ssh-core.cjs')

const clipboard = '\x1b]52;c;cHJldmlldw==\x07'
const enterScreen = '\x1b[?1049h'
const enablePaste = '\x1b[?2004h'
const payload = '\x1b[200~primera línea\rsegunda línea\x1b[201~'

if (process.argv[2] === 'tui') {
  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  process.stdout.write(enterScreen + enablePaste + clipboard + 'READY')
  let received = ''
  process.stdin.on('data', (data) => {
    received += data
    if (received.endsWith('\x1b[201~')) {
      assert.equal(received, payload)
      process.stdout.write('PASTE_OK\x1b[?2004l\x1b[?1049l')
      process.exit(0)
    }
  })
} else {
  const pty = require('node-pty')
  async function runTab(closeTab) {
    const terminal = pty.spawn(process.execPath, [__filename, 'tui'], {
      ...INTERACTIVE_PTY_OPTIONS, cols: 100, rows: 30,
    })
    let output = ''
    let ready = false
    const result = new Promise((resolve) => terminal.onExit(resolve))
    terminal.onData((chunk) => {
      output += chunk
      if (ready || !output.includes('READY')) return
      ready = true
      if (closeTab) terminal.kill()
      else terminal.write(payload)
    })
    const { exitCode } = await result
    assert.ok(output.includes(enterScreen))
    assert.ok(output.includes(enablePaste))
    assert.ok(output.includes(clipboard))
    if (!closeTab) {
      assert.equal(exitCode, 0)
      assert.ok(output.includes('PASTE_OK'))
    }
  }
  // Let Node exit on its own so orphaned workers or pipes fail the parent timeout.
  runTab(false).then(() => runTab(true)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
