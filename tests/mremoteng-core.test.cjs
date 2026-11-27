const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMRemoteConnections } = require('../electron/mremoteng-core.cjs')
const { buildFolderTree, profileFolders, mergeMRemoteProfiles, renameProfileFolder } = require('../src/profile-folders.ts')

const parse = (xml) => parseMRemoteConnections(Buffer.from(xml), 'local-user')
const wrap = (nodes) => '<mrng:Connections xmlns:mrng="http://mremoteng.org">' + nodes + '</mrng:Connections>'
const single = '<Node Type="Connection" Protocol="SSH2" Hostname="example.test"/>'

test('imports the SSH metadata and resolves per-field inheritance across nested folders', () => {
  const xml = wrap(`
    <Node Type="Container" Name="Lab &amp; QA" Protocol="SSH2" Username="alice" Port="2222">
      <Node Type="Container" Name="West" InheritProtocol="True" InheritUsername="true" Port="2200">
        <Node Type="Connection" Name="Build" Hostname="example.test" InheritProtocol="True" Protocol="RDP"
          InheritUsername="True" Username="wrong" InheritPort="True" Port="99"
          Password="IGNORED-ATTRIBUTE" PuttySession="IGNORED-ATTRIBUTE" UserField="IGNORED-ATTRIBUTE"/>
        <Node Type="Connection" Name="Second" Hostname="example.test" Protocol="SSH2" Username="bob"/>
      </Node>
      <Node Type="Connection" Protocol="RDP" Hostname="other.example"/>
      <Node Type="Connection" Protocol="SSH1" Hostname="other.example"/>
    </Node>`)
  const { profiles, unsupported, invalid, defaultedUsers } = parse(xml)
  assert.deepEqual([unsupported, invalid, defaultedUsers], [2, 0, 0])
  assert.deepEqual(profiles.map(({ id, ...profile }) => profile), [
    { name: 'Build', group: 'Lab & QA / West', folderPath: ['Lab & QA', 'West'], host: 'example.test', username: 'alice', port: 2200 },
    { name: 'Second', group: 'Lab & QA / West', folderPath: ['Lab & QA', 'West'], host: 'example.test', username: 'bob', port: 22 },
  ])
  assert.deepEqual(parse(xml).profiles, profiles)
  assert.doesNotMatch(JSON.stringify(profiles), /IGNORED-ATTRIBUTE/)
})

test('retains usable entries and reports missing usernames, other protocols and invalid endpoints', () => {
  const { profiles, unsupported, invalid, defaultedUsers } = parse(wrap(single + `
    <Node Type="Connection" Protocol="VNC"/>
    <Node Type="Connection" Protocol="SSH2" Hostname="example.test" Port="0"/>
    <Node Type="Connection" Protocol="SSH2" Hostname="bad host"/>
    <Node Type="Connection" Protocol="SSH2" Hostname="user@other"/>
    <Node Type="Connection" Protocol="SSH2" Hostname="example.test" Username="-invalid"/>
    <Node Type="Connection" Protocol="SSH2" Hostname="2001:db8::1" Username="test"/>
  `))
  assert.deepEqual([profiles.length, unsupported, invalid, defaultedUsers], [2, 1, 4, 1])
  assert.equal(profiles[0].username, 'local-user')
  assert.equal(profiles[1].host, '2001:db8::1')
})

test('accepts UTF-16 XML and keeps source IDs stable when the profile is renamed', () => {
  const id = 'bcde4321-1234-1234-1234-fedcab123456'
  const file = (name) => Buffer.from('\ufeff<Connections><Node Type="Connection" Protocol="SSH2" Hostname="example.test" Name="' + name + '" Id="' + id + '"/></Connections>', 'utf16le')
  const [first] = parseMRemoteConnections(file('Málaga'), 'user').profiles
  assert.equal(first.name, 'Málaga')
  assert.equal(first.id, parseMRemoteConnections(file('Prueba'), 'user').profiles[0].id)
})

test('rejects full-file encryption, malformed XML and DTDs without exposing file contents', () => {
  assert.throws(() => parse('<Connections FullFileEncryption="True">ignored</Connections>'), /Export the connections as XML/)
  for (const xml of ['<Other/>', '', wrap(single) + '<Connections/>', wrap('<Node>'), '<!DOCTYPE Connections><Connections/>', wrap('<Node Type="IGNORED-ATTRIBUTE" &#xBAD; />')]) {
    assert.throws(() => parse(xml), { message: 'Choose a valid mRemoteNG connections XML file.' })
  }
})

test('renders existing flat imports as shared parents and keeps literal slashes in folder names', () => {
  const sample = { name: 'Build', host: 'example.test', username: 'test', port: 22 }
  const profiles = [
    { ...sample, id: 'mrng-1', group: 'Lab / VM / East' },
    { ...sample, id: 'mrng-2', group: 'Lab / VM / West' },
    { ...sample, id: 'mrng-3', group: 'Lab / rack/blue' },
    { ...sample, id: 'manual', group: 'Ops / archive' },
    { ...sample, id: 'mrng-4', group: 'Lab 2 / VM' },
  ]
  const tree = buildFolderTree(profiles, '')
  assert.deepEqual([...tree.keys()], ['Lab', 'Ops / archive', 'Lab 2'])
  assert.equal(tree.get('Lab').count, 3)
  assert.deepEqual([...tree.get('Lab').children.keys()], ['VM', 'rack/blue'])
  assert.deepEqual([...tree.get('Lab').children.get('VM').children.keys()], ['East', 'West'])
  const filtered = buildFolderTree(profiles, 'WEST')
  assert.equal(filtered.size, 1)
  assert.equal(filtered.get('Lab').count, 1)
  const renamed = profiles.map((profile) => renameProfileFolder(profile, ['Lab', 'VM'], 'Machines'))
  assert.deepEqual(renamed.map((profile) => profile.group), ['Lab / Machines / East', 'Lab / Machines / West', 'Lab / rack/blue', 'Ops / archive', 'Lab 2 / VM'])
})

test('repairs legacy flattened paths from XML, preserving user edits and repeat import identity', () => {
  const connection = '<Node Type="Connection" Protocol="SSH2" Hostname="example.test" Name="Same"/>'
  const literal = '<Node Type="Container" Name="Root / Sub">' + connection + '</Node>'
  const nested = '<Node Type="Container" Name="Root"><Node Type="Container" Name="Sub">' + connection + '</Node></Node>'
  const first = parse(wrap(literal))
  const both = parse(wrap(literal + nested))
  const legacy = { ...first.profiles[0], id: first.legacyIds[first.profiles[0].id], folderPath: undefined, name: 'Edited' }
  assert.deepEqual(profileFolders(legacy), ['Root', 'Sub'])
  const repaired = mergeMRemoteProfiles([legacy], first.profiles, first.legacyIds)
  assert.equal(repaired.length, 1)
  assert.equal(repaired[0].name, 'Edited')
  assert.deepEqual(profileFolders(repaired[0]), ['Root / Sub'])
  const merged = mergeMRemoteProfiles(repaired, both.profiles, both.legacyIds)
  assert.equal(merged.length, 2)
  assert.deepEqual([...buildFolderTree(merged, '').keys()], ['Root / Sub', 'Root'])
  assert.deepEqual(mergeMRemoteProfiles(merged, both.profiles, both.legacyIds), merged)
})
