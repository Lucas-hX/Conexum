const { createHash } = require('node:crypto')
const { isIP } = require('node:net')
const sax = require('sax')
const { sanitizeProfile } = require('./profile-core.cjs')
const { validateConnection } = require('./ssh-core.cjs')

const MAX_MREMOTE_BYTES = 32 * 1024 * 1024
const SIZE_ERROR = 'The mRemoteNG XML must be a file of 32 MB or less.'
const XML_ERROR = 'Choose a valid mRemoteNG connections XML file.'

function parseMRemoteConnections(bytes, defaultUsername) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_MREMOTE_BYTES) throw new Error(SIZE_ERROR)
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  let xml
  try {
    xml = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new Error(XML_ERROR)
  }

  const result = { profiles: [], unsupported: 0, invalid: 0, defaultedUsers: 0, legacyIds: {} }
  const stack = []
  const parser = sax.parser(true, { strictEntities: true })
  let sawRoot = false
  // Parser diagnostics may contain fragments of file contents. Return fixed errors only.
  const invalidXml = () => { throw new Error(XML_ERROR) }
  parser.onerror = invalidXml
  parser.ondoctype = invalidXml
  parser.onopentag = ({ name, attributes }) => {
    const element = name.split(':').pop()
    const parent = stack.at(-1)
    if (!parent) {
      if (sawRoot || element !== 'Connections') invalidXml()
      if (attributes.FullFileEncryption?.toLowerCase() === 'true') {
        throw new Error('This mRemoteNG file is encrypted. Export the connections as XML from mRemoteNG with Password unchecked.')
      }
      sawRoot = true
    }
    if (stack.length >= 128) invalidXml()
    if (parent && (parent.leaf || element !== 'Node')) {
      stack.push({ leaf: true })
      return
    }

    // A child inherits each property independently, and folders can inherit in turn.
    const value = (key) => attributes['Inherit' + key]?.toLowerCase() === 'true'
      ? parent?.[key] ?? attributes[key]
      : attributes[key]
    const node = {
      Protocol: value('Protocol'), Port: value('Port'), Username: value('Username'),
      folderPath: parent?.folderPath ?? [],
      leaf: false,
    }
    stack.push(node)
    if (!parent) return
    if (attributes.Type === 'Container') {
      if (attributes.Name) node.folderPath = [...node.folderPath, attributes.Name]
      return
    }
    node.leaf = true
    if (attributes.Type !== 'Connection') return
    if (!['SSH', 'SSH2'].includes(node.Protocol?.toUpperCase())) {
      result.unsupported++
      return
    }
    if (result.profiles.length >= 5000) throw new Error('The file contains too many SSH connections.')
    try {
      const host = (attributes.Hostname ?? '').trim()
      if (!isIP(host) && !/^[\da-z_][\da-z._-]*$/i.test(host)) throw new Error('Invalid hostname')
      if (node.Port && !/^\d+$/.test(node.Port)) throw new Error('Invalid port')
      const folderPath = node.folderPath.length ? node.folderPath : ['mRemoteNG']
      const group = folderPath.join(' / ')
      const name = attributes.Name || host
      const port = Number(node.Port || 22)
      const username = node.Username || defaultUsername
      // Retain previous identifiers, except when a literal separator would
      // collide with another folder path in an export without a source GUID.
      const guid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(attributes.Id ?? '') ? attributes.Id.toLowerCase() : null
      const legacyKey = JSON.stringify([group, name, host, port, username])
      const structuredKey = !guid && folderPath.some((part) => part.includes(' / ')) ? JSON.stringify([folderPath, name, host, port, username]) : null
      const id = importId(guid ?? structuredKey ?? legacyKey)
      const profile = sanitizeProfile({ id, group, folderPath, name, host, port, username })
      validateConnection({ sessionId: id, profile })
      if (!node.Username) result.defaultedUsers++
      result.profiles.push(profile)
      if (structuredKey) result.legacyIds[id] = importId(legacyKey)
    } catch {
      result.invalid++
    }
  }
  parser.onclosetag = () => { stack.pop() }
  parser.write(xml).close()
  if (!sawRoot) invalidXml()
  return result
}

function importId(key) {
  return 'mrng-' + createHash('sha256').update(key).digest('hex')
}

module.exports = { parseMRemoteConnections, MAX_MREMOTE_BYTES, SIZE_ERROR }
