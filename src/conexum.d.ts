export type ConnectionProfile = {
  id: string
  name: string
  group: string
  host: string
  port: number
  username: string
  identityFile?: string
  sshAlias?: string
  configFile?: string
}

type SshConnectRequest = {
  sessionId: string
  profile: ConnectionProfile
  cols: number
  rows: number
}

export type RemoteTelemetry = {
  cpuPercent: number | null
  memoryPercent: number
  platform: string
  updatedAt: number
}

export type SftpEntry = {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  permissions: string
  owner: string
  modified: string
  hidden: boolean
}

export type SftpTransferProgress = {
  transferId: string
  sessionId: string
  direction: 'upload' | 'download'
  name: string
  progress: number
  status: 'queued' | 'active' | 'completed' | 'canceled' | 'error'
  error?: string
  canRetry: boolean
  updatedAt: number
}

export type SshDiagnostics = {
  sessionId: string
  host: string
  port: number
  username: string
  identityFile: string | null
  sshAlias: string | null
  configFile: string | null
  status: 'connected' | 'disconnected' | 'error'
  pid: number | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  signal: number | null
  lastError: string | null
}

export type RemoteTextFile = {
  path: string
  name: string
  content: string
  size: number
  modified: string
  permissions: string
  fingerprint: string
}

declare global {
  interface Window {
    conexum?: {
      platform: 'desktop'
      ssh: {
        connect(request: SshConnectRequest): Promise<{ sessionId: string; pid: number }>
        write(sessionId: string, data: string): void
        resize(sessionId: string, cols: number, rows: number): void
        disconnect(sessionId: string): void
        getTelemetry(sessionId: string): Promise<RemoteTelemetry | null>
        getDiagnostics(sessionId: string): Promise<SshDiagnostics | null>
        copyDiagnostics(sessionId: string): Promise<boolean>
        onData(callback: (event: { sessionId: string; data: string }) => void): () => void
        onExit(callback: (event: { sessionId: string; exitCode: number; signal?: number }) => void): () => void
      }
      profiles: {
        chooseIdentityFile(): Promise<string | null>
        importSshConfig(): Promise<ConnectionProfile[]>
        exportBackup(profiles: ConnectionProfile[]): Promise<string | null>
        importBackup(): Promise<ConnectionProfile[]>
        forgetIdentityPassphrase(filePath: string): Promise<boolean>
      }
      sftp: {
        list(sessionId: string, remotePath?: string): Promise<{ directory: string; entries: SftpEntry[] }>
        mutate(sessionId: string, operation: 'mkdir' | 'rename' | 'remove-file' | 'remove-directory', sourcePath: string, destinationPath?: string): Promise<boolean>
        chooseUpload(): Promise<{ path: string; name: string; size: number } | null>
        grantDroppedUpload(file: File): Promise<{ path: string; name: string; size: number } | null>
        chooseDownload(suggestedName: string): Promise<string | null>
        transfers(sessionId: string): Promise<SftpTransferProgress[]>
        enqueueTransfer(request: { sessionId: string; direction: 'upload' | 'download'; localPath: string; remotePath: string; name: string }): Promise<{ transferId: string }>
        retryTransfer(transferId: string): Promise<{ transferId: string }>
        cancelTransfer(transferId: string): void
        onTransferProgress(callback: (event: SftpTransferProgress) => void): () => void
        onFileSaved(callback: (event: { sessionId: string; remotePath: string }) => void): () => void
      }
      editor: {
        openWindow(request: { sessionId: string; profileName: string; initialDirectory: string; remotePath?: string }): Promise<boolean>
        getContext(): Promise<{ sessionId: string; profileName: string; initialDirectory: string; initialPath: string | null }>
        readText(sessionId: string, remotePath: string): Promise<RemoteTextFile>
        writeText(request: { sessionId: string; remotePath: string; content: string; baselineFingerprint: string }): Promise<
          | { conflict: true; current: { fingerprint: string; size: number; modified: string } }
          | { conflict: false; file: Omit<RemoteTextFile, 'content'> }
        >
        setState(state: { dirty: boolean; saving: boolean }): void
        closeWindow(state: { dirty: boolean; saving: boolean }): Promise<void>
        onOpenFile(callback: (event: { remotePath: string }) => void): () => void
      }
    }
  }
}

export {}
