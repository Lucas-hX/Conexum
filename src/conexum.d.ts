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
  updatedAt: number
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
        onData(callback: (event: { sessionId: string; data: string }) => void): () => void
        onExit(callback: (event: { sessionId: string; exitCode: number; signal?: number }) => void): () => void
      }
      profiles: {
        chooseIdentityFile(): Promise<string | null>
        importSshConfig(): Promise<ConnectionProfile[]>
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
        cancelTransfer(transferId: string): void
        onTransferProgress(callback: (event: SftpTransferProgress) => void): () => void
      }
    }
  }
}

export {}
