import type { ConnectionProfile } from './conexum'

export function profileFolders(profile: ConnectionProfile): string[] {
  if (profile.folderPath?.length) return profile.folderPath
  // The initial Windows import joined XML nodes with this exact delimiter.
  // An ordinary slash in a name such as "rack/blue" stays in that node.
  if (profile.id.startsWith('mrng-')) return profile.group.split(' / ')
  return [profile.group]
}

export function inFolder(path: string[], ancestor: string[]) {
  return ancestor.every((name, index) => name === path[index])
}

export type ProfileFolder = {
  path: string[]
  key: string
  count: number
  children: Map<string, ProfileFolder>
  connections: ConnectionProfile[]
}

export function buildFolderTree(profiles: ConnectionProfile[], search: string) {
  const roots = new Map<string, ProfileFolder>()
  const query = search.trim().toLowerCase()
  for (const profile of profiles) {
    if (query && ![profile.name, profile.group, profile.host, profile.username].some((value) => value.toLowerCase().includes(query))) continue
    const path = profileFolders(profile)
    let level = roots
    for (const [index, name] of path.entries()) {
      let folder = level.get(name)
      if (!folder) {
        const prefix = path.slice(0, index + 1)
        folder = { path: prefix, key: JSON.stringify(prefix), count: 0, connections: [], children: new Map() }
        level.set(name, folder)
      }
      folder.count++
      if (index === path.length - 1) folder.connections.push(profile)
      level = folder.children
    }
  }
  return roots
}

export function renameProfileFolder(profile: ConnectionProfile, source: string[], name: string) {
  const path = profileFolders(profile)
  if (!inFolder(path, source)) return profile
  const folderPath = [...path]
  folderPath[source.length - 1] = name
  return { ...profile, folderPath, group: folderPath.join(' / ') }
}

// Keep edits to existing profiles. An XML reimport can disambiguate a legacy
// flattened path when a folder name itself contained the old separator.
export function mergeMRemoteProfiles(current: ConnectionProfile[], imported: ConnectionProfile[], legacyIds: Record<string, string> = {}) {
  const byId = new Map(current.map((profile) => [profile.id, profile]))
  const incomingIds = new Set(imported.map((profile) => profile.id))
  for (const profile of imported) {
    // Some old exports had no GUID and could describe multiple paths with the
    // same flattened spelling. Give the exact ID priority when both appear.
    const legacyId = legacyIds[profile.id]
    let existing = byId.get(profile.id)
    if (!existing && legacyId && !incomingIds.has(legacyId) && byId.has(legacyId)) {
      existing = { ...byId.get(legacyId)!, id: profile.id }
      byId.delete(legacyId)
      byId.set(profile.id, existing)
    }
    if (!existing) byId.set(profile.id, profile)
    else if (!existing.folderPath && profile.folderPath && existing.group === profile.group) {
      byId.set(profile.id, { ...existing, folderPath: profile.folderPath })
    }
  }
  return [...byId.values()]
}
