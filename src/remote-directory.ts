type Sftp = NonNullable<Window['conexum']>['sftp']

// OSC 7 may report a path the SFTP subsystem cannot see (for example in a
// chroot). Fall back to home for that case without retrying a canceled sign-in.
export async function listRemoteDirectory(api: Sftp, sessionId: string, path?: string, fallbackToHome = false) {
  try {
    return await api.list(sessionId, path)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const inaccessible = message.endsWith('The remote path does not exist or is no longer available.')
      || message.endsWith('Permiso denegado por el servidor SFTP.')
    if (!path || !fallbackToHome || !inaccessible) throw error
    return api.list(sessionId)
  }
}
