const test = require('node:test')
const assert = require('node:assert/strict')

const {
  MAX_OSC52_CLIPBOARD_BYTES,
  decodeOsc52Clipboard,
} = require('../electron/clipboard-core.cjs')

test('decodes OSC 52 clipboard writes with Unicode text', () => {
  const text = 'Copied from Codex\nconst greeting = "¡Hola! 👋"\n'
  const encoded = Buffer.from(text, 'utf8').toString('base64')

  assert.equal(decodeOsc52Clipboard(`c;${encoded}`), text)
  assert.equal(decodeOsc52Clipboard(`;${encoded}`), text)
})

test('rejects OSC 52 reads, unsupported selections, invalid Base64, and invalid UTF-8', () => {
  assert.equal(decodeOsc52Clipboard('c;?'), null)
  assert.equal(decodeOsc52Clipboard('p;Y29weQ=='), null)
  assert.equal(decodeOsc52Clipboard('c;not base64'), null)
  assert.equal(decodeOsc52Clipboard('c;YQ='), null)
  assert.equal(decodeOsc52Clipboard(`c;${Buffer.from([0xc3, 0x28]).toString('base64')}`), null)
  assert.equal(decodeOsc52Clipboard('missing-separator'), null)
})

test('enforces the OSC 52 clipboard size limit', () => {
  const allowed = Buffer.alloc(MAX_OSC52_CLIPBOARD_BYTES, 0x61).toString('base64')
  const oversized = Buffer.alloc(MAX_OSC52_CLIPBOARD_BYTES + 1, 0x61).toString('base64')

  assert.equal(decodeOsc52Clipboard(`c;${allowed}`)?.length, MAX_OSC52_CLIPBOARD_BYTES)
  assert.equal(decodeOsc52Clipboard(`c;${oversized}`), null)
})
