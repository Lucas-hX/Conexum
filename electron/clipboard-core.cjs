const MAX_OSC52_CLIPBOARD_BYTES = 1 * 1_024 * 1_024
const MAX_OSC52_BASE64_CHARS = Math.ceil(MAX_OSC52_CLIPBOARD_BYTES / 3) * 4

function windowsClipboardCommand(input) {
  if (input.type !== 'keyDown' || !input.shift || input.alt || input.meta || input.isComposing) return null
  const key = input.key.toLowerCase()
  if (input.control && key === 'c') return 'copy'
  if ((input.control && key === 'v') || (!input.control && key === 'insert')) return 'paste'
  return null
}

function decodeOsc52Clipboard(payload) {
  if (typeof payload !== 'string' || payload.length > MAX_OSC52_BASE64_CHARS + 2) return null

  const separator = payload.indexOf(';')
  if (separator < 0) return null

  const selection = payload.slice(0, separator)
  const encoded = payload.slice(separator + 1)
  if (selection !== '' && selection !== 'c') return null
  if (encoded === '?' || encoded.length > MAX_OSC52_BASE64_CHARS) return null
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null

  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length > MAX_OSC52_CLIPBOARD_BYTES) return null

  const text = decoded.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(decoded)) return null
  return text
}

module.exports = {
  MAX_OSC52_CLIPBOARD_BYTES,
  decodeOsc52Clipboard,
  windowsClipboardCommand,
}
