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
    }
  }
}

export {}
