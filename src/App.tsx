import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SftpPanel } from './SftpPanel'
import { ShellIntegrationHelp } from './ShellIntegrationHelp'
import {
  ChevronDown,
  ClipboardCopy,
  Columns2,
  FileCode2,
  FileDown,
  FileUp,
  Folder,
  FolderOpen,
  Home,
  Import,
  KeyRound,
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'
import type { ConnectionProfile, RemoteTelemetry, SshDiagnostics } from './conexum'

type ToolPanel = 'sftp' | null
type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
type MainView = 'home' | 'terminal'
type SplitMode = 0 | 2 | 4
type DirectoryHelpAction = 'sftp' | 'editor' | 'help'
type ContextMenuState =
  | { x: number; y: number; kind: 'profile'; profileId: string }
  | { x: number; y: number; kind: 'group'; group: string }

type SshSessionTab = {
  id: string
  profile: ConnectionProfile
  status: SessionStatus
  currentDirectory: string | null
  telemetry: RemoteTelemetry | null
  telemetryStatus: 'idle' | 'loading' | 'available' | 'unavailable'
}

type TerminalHandle = {
  connect(profile: ConnectionProfile, options?: { preserveHistory?: boolean }): Promise<void>
  disconnect(): void
}

const STORAGE_KEY = 'conexum.connectionProfiles.v2'
const LEGACY_STORAGE_KEYS = ['conexum.connectionProfiles.v1']
const SIDEBAR_WIDTH_KEY = 'conexum.sidebarWidth.v1'
const RECENT_CONNECTIONS_KEY = 'conexum.recentConnections.v1'
const BRAND_ICON = './brand/conexum-icon.png'
const BRAND_BANNER = './brand/conexum-welcome-banner.png'
const LOCAL_PROFILE_ID = 'conexum-local'
const DEFAULT_LOCAL_PROFILE: ConnectionProfile = {
  id: LOCAL_PROFILE_ID,
  kind: 'local',
  name: 'Terminal local',
  group: 'Esta Mac',
  host: 'localhost',
  port: 0,
  username: '',
}

function parseOsc7Directory(value: string) {
  if (!value || value.length > 4_096 || /[\r\n\0]/.test(value)) return null
  try {
    const location = new URL(value)
    if (location.protocol !== 'file:') return null
    let directory = location.pathname
    try {
      directory = decodeURIComponent(directory)
    } catch {
      // Keep the encoded path visible when a shell emits a literal percent sign.
    }
    return directory.startsWith('/') ? directory : null
  } catch {
    return null
  }
}

function compactDirectory(directory: string, username: string) {
  const homes = [`/home/${username}`, `/Users/${username}`]
  const home = homes.find((candidate) => directory === candidate || directory.startsWith(`${candidate}/`))
  return home ? `~${directory.slice(home.length)}` : directory
}

function loadProfiles(): ConnectionProfile[] {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
    const value = localStorage.getItem(STORAGE_KEY)
    if (!value) return []
    const profiles = JSON.parse(value)
    return Array.isArray(profiles) ? profiles : []
  } catch {
    return []
  }
}

function loadRecentConnections(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_CONNECTIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const TerminalView = forwardRef<TerminalHandle, {
  sessionId: string
  onStatusChange(status: SessionStatus): void
  onDirectoryChange(directory: string): void
  onIdentityNeeded(profile: ConnectionProfile): void
}>(function TerminalView({ sessionId, onStatusChange, onDirectoryChange, onIdentityNeeded }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const activeProfileRef = useRef<ConnectionProfile | null>(null)
  const authenticationFailedRef = useRef(false)

  useEffect(() => {
    if (!hostRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"SFMono-Regular", "Cascadia Code", Menlo, monospace',
      fontSize: 14,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: {
        background: '#080d12',
        foreground: '#d6dde7',
        cursor: '#73c8ff',
        selectionBackground: '#1c72c955',
        black: '#111820', red: '#ff6b72', green: '#55e276', yellow: '#f3c969',
        blue: '#53a9ff', magenta: '#c68cff', cyan: '#52d6de', white: '#d6dde7',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(hostRef.current)
    terminalRef.current = terminal
    fitRef.current = fitAddon

    terminal.write('\x1b[90m[Conexum] Iniciando terminal…\x1b[0m')

    const inputDisposable = terminal.onData((data) => {
      if (sessionIdRef.current) window.conexum?.ssh.write(sessionIdRef.current, data)
    })
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) window.conexum?.ssh.resize(sessionIdRef.current, cols, rows)
    })
    const directoryDisposable = terminal.parser.registerOscHandler(7, (value) => {
      const directory = parseOsc7Directory(value)
      if (directory) onDirectoryChange(directory)
      return true
    })
    const removeDataListener = window.conexum?.ssh.onData(({ sessionId, data }) => {
      if (sessionId !== sessionIdRef.current) return
      terminal.write(data)
      if (/Permission denied[^\r\n]*publickey/i.test(data)) authenticationFailedRef.current = true
    })
    const removeExitListener = window.conexum?.ssh.onExit(({ sessionId, exitCode }) => {
      if (sessionId !== sessionIdRef.current) return
      sessionIdRef.current = null
      terminal.writeln(`\r\n\x1b[90m[Conexum] La sesión ${activeProfileRef.current?.kind === 'local' ? 'local' : 'SSH'} finalizó con código ${exitCode}.\x1b[0m`)
      onStatusChange('disconnected')
      if (authenticationFailedRef.current && activeProfileRef.current?.kind !== 'local' && activeProfileRef.current && !activeProfileRef.current.identityFile) {
        onIdentityNeeded(activeProfileRef.current)
      }
    })

    const observer = new ResizeObserver(() => fitAddon.fit())
    observer.observe(hostRef.current)
    fitAddon.fit()

    return () => {
      if (sessionIdRef.current) window.conexum?.ssh.disconnect(sessionIdRef.current)
      removeDataListener?.()
      removeExitListener?.()
      inputDisposable.dispose()
      resizeDisposable.dispose()
      directoryDisposable.dispose()
      observer.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [onDirectoryChange, onIdentityNeeded, onStatusChange])

  useImperativeHandle(ref, () => ({
    async connect(profile, options = {}) {
      const terminal = terminalRef.current
      const fitAddon = fitRef.current
      if (!terminal || !fitAddon) return

      if (!window.conexum) {
        terminal.writeln('\r\n\x1b[31m[Conexum] La terminal real sólo está disponible en la aplicación de escritorio.\x1b[0m')
        terminal.writeln('Ejecutá: pnpm run desktop')
        onStatusChange('error')
        return
      }

      if (sessionIdRef.current) window.conexum.ssh.disconnect(sessionIdRef.current)
      activeProfileRef.current = profile
      authenticationFailedRef.current = false
      if (options.preserveHistory) {
        terminal.writeln('')
        terminal.writeln(`\x1b[90m[Conexum] Reabriendo ${profile.kind === 'local' ? 'la terminal local' : `${profile.username}@${profile.host}:${profile.port}`}…\x1b[0m`)
      } else {
        terminal.reset()
        terminal.writeln(`\x1b[90m[Conexum] Abriendo ${profile.kind === 'local' ? 'la terminal de esta Mac' : `${profile.username}@${profile.host}:${profile.port}`}…\x1b[0m`)
      }
      onStatusChange('connecting')

      sessionIdRef.current = sessionId
      try {
        await window.conexum.ssh.connect({
          sessionId,
          profile,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        onStatusChange('connected')
        terminal.focus()
      } catch (error) {
        sessionIdRef.current = null
        const message = error instanceof Error ? error.message : 'No se pudo iniciar la terminal.'
        terminal.writeln(`\r\n\x1b[31m[Conexum] ${message}\x1b[0m`)
        onStatusChange('error')
        if (/archivo de identidad/i.test(message)) onIdentityNeeded(profile)
      }
    },
    disconnect() {
      const terminal = terminalRef.current
      if (!sessionIdRef.current) return
      window.conexum?.ssh.disconnect(sessionIdRef.current)
      sessionIdRef.current = null
      terminal?.writeln('\r\n\x1b[90m[Conexum] Desconectado por el usuario.\x1b[0m')
      onStatusChange('disconnected')
    },
  }), [onIdentityNeeded, onStatusChange, sessionId])

  return <div className="terminal-host" ref={hostRef} aria-label="Terminal" />
})

function ManagedTerminalSession({ session, onHandle, onStatusChange, onDirectoryChange, onIdentityNeeded }: {
  session: SshSessionTab
  onHandle(sessionId: string, handle: TerminalHandle | null): void
  onStatusChange(sessionId: string, status: SessionStatus): void
  onDirectoryChange(sessionId: string, directory: string): void
  onIdentityNeeded(profile: ConnectionProfile): void
}) {
  const terminalRef = useRef<TerminalHandle>(null)
  const handleStatusChange = useCallback((status: SessionStatus) => onStatusChange(session.id, status), [onStatusChange, session.id])
  const handleDirectoryChange = useCallback((directory: string) => onDirectoryChange(session.id, directory), [onDirectoryChange, session.id])
  const handleIdentityNeeded = useCallback((profile: ConnectionProfile) => onIdentityNeeded(profile), [onIdentityNeeded])

  useEffect(() => {
    const handle = terminalRef.current
    if (!handle) return
    onHandle(session.id, handle)
    void handle.connect(session.profile)
    return () => onHandle(session.id, null)
  }, [])

  return <TerminalView ref={terminalRef} sessionId={session.id} onStatusChange={handleStatusChange} onDirectoryChange={handleDirectoryChange} onIdentityNeeded={handleIdentityNeeded} />
}

function ToolButton({ label, icon, active, disabled, accent, onClick }: {
  label: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  accent?: boolean
  onClick?: () => void
}) {
  return (
    <button className={`tool-button ${active ? 'active' : ''} ${accent ? 'accent' : ''}`} disabled={disabled} onClick={onClick} aria-label={label} title={label}>
      <span className="tool-icon" aria-hidden="true">{icon}</span>
    </button>
  )
}

function WelcomeHome({ profiles, recentIds, selectedId, onSelect, onConnect }: {
  profiles: ConnectionProfile[]
  recentIds: string[]
  selectedId: string | null
  onSelect(profile: ConnectionProfile): void
  onConnect(profile: ConnectionProfile): void
}) {
  const recentProfiles = recentIds
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is ConnectionProfile => Boolean(profile))
  const featuredProfiles = [
    ...profiles.filter((profile) => profile.kind === 'local'),
    ...recentProfiles.filter((profile) => profile.kind !== 'local'),
    ...profiles.filter((profile) => profile.kind !== 'local' && !recentIds.includes(profile.id)),
  ].slice(0, 4)

  return (
    <div className="welcome-home">
      <section className="welcome-banner" style={{ backgroundImage: `linear-gradient(90deg, #0b1119 0%, #0b1119ec 42%, #0b111966 76%), url(${BRAND_BANNER})` }}>
        <div className="welcome-copy">
          <div className="welcome-brand"><img src={BRAND_ICON} alt="" /><span>Conexum</span></div>
          <p>Terminal local y conexiones SSH, en un solo lugar.</p>
        </div>
      </section>

      <div className="welcome-content">
        <section className="home-section">
          <div className="home-section-heading"><div><h2>Acceso rápido</h2></div><span>Doble clic para abrir</span></div>
          <div className="server-shortcuts">
            {featuredProfiles.map((profile) => (
              <button
                key={profile.id}
                className={`server-shortcut ${selectedId === profile.id ? 'selected' : ''}`}
                onClick={() => onSelect(profile)}
                onDoubleClick={() => onConnect(profile)}
                title={`Doble clic para abrir ${profile.name}`}
              >
                <span className="shortcut-icon">{profile.kind === 'local' ? <Monitor size={17} /> : <Server size={17} />}</span>
                <span className="shortcut-copy"><strong>{profile.name}</strong><small>{profile.kind === 'local' ? profile.group : `${profile.username}@${profile.host}`}</small></span>
                {profile.identityFile || profile.sshAlias ? <KeyRound size={13} className="shortcut-key" /> : null}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function ConnectionModal({ profile, identityRequired, onClose, onSave }: {
  profile?: ConnectionProfile | null
  identityRequired?: boolean
  onClose(): void
  onSave(profile: ConnectionProfile): void
}) {
  const [name, setName] = useState(profile?.name ?? '')
  const [group, setGroup] = useState(profile?.group ?? 'Mis servidores')
  const [host, setHost] = useState(profile?.host ?? '')
  const [port, setPort] = useState(String(profile?.port ?? 22))
  const [username, setUsername] = useState(profile?.username ?? '')
  const [identityFile, setIdentityFile] = useState(profile?.identityFile ?? '')
  const [keychainMessage, setKeychainMessage] = useState('')

  const chooseIdentityFile = async () => {
    const selected = await window.conexum?.profiles.chooseIdentityFile()
    if (selected) setIdentityFile(selected)
  }

  const forgetPassphrase = async () => {
    if (!identityFile || !window.conexum) return
    try {
      await window.conexum.profiles.forgetIdentityPassphrase(identityFile)
      setKeychainMessage('La passphrase fue eliminada de ssh-agent y Keychain.')
    } catch {
      setKeychainMessage('No se encontró una passphrase guardada para esta clave.')
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !host.trim() || !username.trim()) return
    onSave({
      id: profile?.id ?? crypto.randomUUID(),
      name: name.trim(),
      group: group.trim() || 'Mis servidores',
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      identityFile: identityFile.trim() || undefined,
      sshAlias: profile?.sshAlias,
      configFile: profile?.configFile,
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="connection-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div><small>{profile ? 'EDITAR PERFIL' : 'NUEVO PERFIL'}</small><h2>Conexión SSH</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        {identityRequired && <div className="identity-warning"><strong>OpenSSH no encontró una clave válida</strong><span>Seleccioná el IdentityFile correspondiente y guardá el perfil para volver a conectar.</span></div>}
        <div className="form-grid">
          <label className="full-field"><span>Nombre</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Servidor web" required /></label>
          <label className="full-field"><span>Grupo</span><input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Producción" /></label>
          <label className="host-field"><span>Servidor o IP</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.20" required /></label>
          <label><span>Puerto</span><input type="number" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} required /></label>
          <label className="full-field"><span>Usuario</span><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ubuntu" required /></label>
          <label className="full-field"><span>Identity file (opcional)</span><div className="file-picker"><input value={identityFile} onChange={(e) => setIdentityFile(e.target.value)} placeholder="~/.ssh/id_ed25519" /><button type="button" onClick={chooseIdentityFile}><FolderOpen size={14} />Seleccionar…</button></div></label>
        </div>
        <div className="security-note">
          <ShieldCheck size={18} /><div><strong>Protegido por OpenSSH y Keychain</strong>
          <span>Conexum guarda solamente la ruta. OpenSSH puede recordar la passphrase de la clave mediante ssh-agent y el llavero de macOS.</span></div>
        </div>
        {profile && identityFile && <div className="keychain-actions"><button type="button" onClick={forgetPassphrase}>Olvidar passphrase guardada</button>{keychainMessage && <span>{keychainMessage}</span>}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary-button">{profile ? 'Guardar cambios' : 'Guardar conexión'}</button>
        </div>
      </form>
    </div>
  )
}

function DiagnosticsModal({ diagnostics, onClose }: { diagnostics: SshDiagnostics; onClose(): void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const success = await window.conexum?.ssh.copyDiagnostics(diagnostics.sessionId)
    setCopied(Boolean(success))
  }
  const status = diagnostics.status === 'connected' ? 'Conectado' : diagnostics.status === 'error' ? 'Error' : 'Desconectado'
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="diagnostics-modal">
        <div className="modal-heading"><div><small>SESIÓN SSH</small><h2>Diagnóstico de conexión</h2></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <dl className="diagnostics-grid">
          <dt>Host</dt><dd>{diagnostics.host}</dd>
          <dt>Puerto</dt><dd>{diagnostics.port}</dd>
          <dt>Usuario</dt><dd>{diagnostics.username}</dd>
          <dt>Identity file</dt><dd title={diagnostics.identityFile ?? undefined}>{diagnostics.identityFile || 'No especificado'}</dd>
          <dt>Alias SSH</dt><dd>{diagnostics.sshAlias || 'No especificado'}</dd>
          <dt>Estado</dt><dd><span className={`diagnostic-state ${diagnostics.status}`}>{status}</span></dd>
          <dt>Último error</dt><dd>{diagnostics.lastError || 'Ninguno'}</dd>
        </dl>
        <div className="diagnostics-note"><ShieldCheck size={15} /><span>El diagnóstico no incluye contraseñas, claves privadas ni contenido de la terminal.</span></div>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button><button className="primary-button" onClick={() => void copy()}><ClipboardCopy size={14} />{copied ? 'Copiado' : 'Copiar diagnóstico'}</button></div>
      </section>
    </div>
  )
}

const statusLabels: Record<SessionStatus, string> = {
  idle: 'Sin conexión',
  connecting: 'Conectando…',
  connected: 'Sesión activa',
  disconnected: 'Desconectado',
  error: 'Error',
}

export function App() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(loadProfiles)
  const [localProfile, setLocalProfile] = useState<ConnectionProfile>(DEFAULT_LOCAL_PROFILE)
  const [localHomeDirectory, setLocalHomeDirectory] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(() => loadProfiles()[0]?.id ?? LOCAL_PROFILE_ID)
  const [mainView, setMainView] = useState<MainView>('home')
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentConnections)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(stored) ? Math.min(Math.max(stored, 180), 420) : 270
  })
  const [utilityPanelWidth, setUtilityPanelWidth] = useState(480)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(loadProfiles().map((profile) => profile.group)))
  const [localGroupCollapsed, setLocalGroupCollapsed] = useState(false)
  const [activeTool, setActiveTool] = useState<ToolPanel>(null)
  const [sftpStart, setSftpStart] = useState<{ sessionId: string; directory: string | null } | null>(null)
  const [directoryHelp, setDirectoryHelp] = useState<{ sessionId: string; action: DirectoryHelpAction } | null>(null)
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [identityRequiredProfileId, setIdentityRequiredProfileId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<SshDiagnostics | null>(null)
  const [sessions, setSessions] = useState<SshSessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState<SplitMode>(0)
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map())
  const latestDirectories = useRef<Map<string, string>>(new Map())

  const selected = selectedId === LOCAL_PROFILE_ID ? localProfile : profiles.find((profile) => profile.id === selectedId) ?? null
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null
  const activeSessionCount = sessions.filter((session) => session.status === 'connected' || session.status === 'connecting').length
  const splitSessions = useMemo(() => {
    if (!splitMode) return []
    const active = sessions.find((session) => session.id === activeSessionId)
    const others = sessions.filter((session) => session.id !== activeSessionId)
    return (active ? [active, ...others] : sessions).slice(0, splitMode)
  }, [activeSessionId, sessions, splitMode])
  const splitSessionIds = useMemo(() => new Set(splitSessions.map((session) => session.id)), [splitSessions])
  const groupedProfiles = useMemo(() => {
    const filtered = profiles.filter((profile) => profile.name.toLowerCase().includes(query.toLowerCase()))
    const groups = new Map<string, ConnectionProfile[]>()
    for (const profile of filtered) {
      groups.set(profile.group, [...(groups.get(profile.group) ?? []), profile])
    }
    return [...groups.entries()]
  }, [profiles, query])
  const showLocalProfile = `${localProfile.name} ${localProfile.group}`.toLowerCase().includes(query.toLowerCase())

  useEffect(() => {
    void window.conexum?.local.getMachineInfo().then((machine) => {
      const next = { ...DEFAULT_LOCAL_PROFILE, group: machine.name, username: machine.username }
      setLocalProfile(next)
      setLocalHomeDirectory(machine.homeDirectory)
      setSessions((current) => current.map((session) => session.profile.id === LOCAL_PROFILE_ID ? { ...session, profile: next } : session))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
  }, [profiles])

  useEffect(() => {
    const validIds = new Set([LOCAL_PROFILE_ID, ...profiles.map((profile) => profile.id)])
    setRecentIds((current) => {
      const next = current.filter((id) => validIds.has(id)).slice(0, 8)
      return next
    })
  }, [profiles])

  useEffect(() => {
    localStorage.setItem(RECENT_CONNECTIONS_KEY, JSON.stringify(recentIds))
  }, [recentIds])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  useEffect(() => {
    const api = window.conexum
    if (mainView !== 'terminal' || !activeSessionId || activeSession?.status !== 'connected' || activeSession.profile.kind === 'local' || !api) return
    let disposed = false

    const refreshTelemetry = async () => {
      setSessions((current) => current.map((session) => session.id === activeSessionId && !session.telemetry
        ? { ...session, telemetryStatus: 'loading' }
        : session))
      const telemetry = await api.ssh.getTelemetry(activeSessionId)
      if (disposed) return
      setSessions((current) => current.map((session) => session.id === activeSessionId
        ? { ...session, telemetry, telemetryStatus: telemetry ? 'available' : 'unavailable' }
        : session))
    }

    void refreshTelemetry()
    const timer = window.setInterval(() => void refreshTelemetry(), 9_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeSessionId, activeSession?.status, mainView])

  useEffect(() => {
    if (mainView !== 'terminal' || !activeSessionId || activeSession?.status !== 'connected' || activeSession.profile.kind !== 'local') return
    const api = window.conexum?.local
    if (!api) return
    let disposed = false
    const refreshDirectory = async () => {
      const directory = await api.getCurrentDirectory(activeSessionId)
      if (disposed || !directory) return
      setSessions((current) => current.map((session) => session.id === activeSessionId && session.currentDirectory !== directory
        ? { ...session, currentDirectory: directory }
        : session))
    }
    void refreshDirectory()
    const timer = window.setInterval(() => void refreshDirectory(), 2_000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [activeSessionId, activeSession?.status, mainView])

  useEffect(() => {
    if (activeTool && (activeSession?.status !== 'connected' || activeSession.profile.kind === 'local')) setActiveTool(null)
  }, [activeSession?.profile.kind, activeSession?.status, activeTool])

  useEffect(() => {
    if (splitMode && sessions.length < 2) setSplitMode(0)
  }, [sessions.length, splitMode])

  const openNewProfile = () => {
    setEditingProfile(null)
    setIdentityRequiredProfileId(null)
    setModalOpen(true)
  }

  const openProfileEditor = (profile: ConnectionProfile, identityRequired = false) => {
    setSelectedId(profile.id)
    setEditingProfile(profile)
    setIdentityRequiredProfileId(identityRequired ? profile.id : null)
    setModalOpen(true)
    setContextMenu(null)
  }

  const handleIdentityNeeded = useCallback((profile: ConnectionProfile) => {
    setSelectedId(profile.id)
    setEditingProfile(profile)
    setIdentityRequiredProfileId(profile.id)
    setModalOpen(true)
  }, [])

  const registerTerminalHandle = useCallback((sessionId: string, handle: TerminalHandle | null) => {
    if (handle) terminalRefs.current.set(sessionId, handle)
    else terminalRefs.current.delete(sessionId)
  }, [])

  const updateSessionStatus = useCallback((sessionId: string, status: SessionStatus) => {
    if (status === 'connecting') latestDirectories.current.delete(sessionId)
    setSessions((current) => current.map((session) => session.id === sessionId
      ? {
          ...session,
          status,
          ...(status === 'connecting' ? { currentDirectory: null, telemetry: null, telemetryStatus: 'idle' as const } : {}),
          ...(status === 'disconnected' || status === 'error' ? { telemetryStatus: 'idle' as const } : {}),
        }
      : session))
  }, [])

  const updateSessionDirectory = useCallback((sessionId: string, currentDirectory: string) => {
    latestDirectories.current.set(sessionId, currentDirectory)
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, currentDirectory } : session))
  }, [])

  const saveProfile = (profile: ConnectionProfile) => {
    setProfiles((current) => {
      const isNewGroup = !current.some((item) => item.group === profile.group)
      if (isNewGroup) setCollapsedGroups((groups) => new Set(groups).add(profile.group))
      return current.some((item) => item.id === profile.id)
        ? current.map((item) => item.id === profile.id ? profile : item)
        : [...current, profile]
    })
    setSessions((current) => current.map((session) => session.profile.id === profile.id ? { ...session, profile } : session))
    setSelectedId(profile.id)
    setEditingProfile(null)
    setIdentityRequiredProfileId(null)
    setModalOpen(false)
  }

  const openSession = (profile: ConnectionProfile) => {
    const sessionId = crypto.randomUUID()
    setSessions((current) => [...current, {
      id: sessionId,
      profile,
      status: 'connecting',
      currentDirectory: profile.kind === 'local' ? localHomeDirectory || null : null,
      telemetry: null,
      telemetryStatus: 'idle',
    }])
    setActiveSessionId(sessionId)
    setSelectedId(profile.id)
    setMainView('terminal')
    setRecentIds((current) => [profile.id, ...current.filter((id) => id !== profile.id)].slice(0, 8))
  }

  const connectOrDisconnect = () => {
    if (mainView === 'terminal' && activeSession) {
      const handle = terminalRefs.current.get(activeSession.id)
      if (activeSession.status === 'connected' || activeSession.status === 'connecting') handle?.disconnect()
      else void handle?.connect(activeSession.profile, { preserveHistory: true })
      return
    }
    if (selected) openSession(selected)
  }

  const closeSessionTab = (session: SshSessionTab) => {
    const active = session.status === 'connected' || session.status === 'connecting'
    const message = active
      ? `¿Cerrar la pestaña de ${session.profile.name} y finalizar esta sesión activa?`
      : `¿Cerrar la pestaña de ${session.profile.name}?`
    if (!window.confirm(message)) return
    if (active) terminalRefs.current.get(session.id)?.disconnect()

    const closingIndex = sessions.findIndex((item) => item.id === session.id)
    const remaining = sessions.filter((item) => item.id !== session.id)
    setSessions(remaining)
    terminalRefs.current.delete(session.id)
    latestDirectories.current.delete(session.id)
    if (directoryHelp?.sessionId === session.id) setDirectoryHelp(null)

    if (activeSessionId === session.id) {
      const next = remaining[Math.min(closingIndex, remaining.length - 1)] ?? null
      setActiveSessionId(next?.id ?? null)
      setSelectedId(next?.profile.id ?? selectedId)
      if (!next) {
        setActiveTool(null)
        setMainView('home')
      }
    }
  }

  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const renameGroup = (group: string) => {
    const value = window.prompt('Nuevo nombre del grupo:', group)?.trim()
    if (!value || value === group) {
      setContextMenu(null)
      return
    }
    if (value.length > 100 || /[\r\n\0]/.test(value)) return
    setProfiles((current) => current.map((profile) => profile.group === group ? { ...profile, group: value } : profile))
    setCollapsedGroups((current) => {
      const next = new Set(current)
      const wasCollapsed = next.delete(group)
      if (wasCollapsed) next.add(value)
      return next
    })
    setContextMenu(null)
  }

  const deleteGroup = (group: string) => {
    const groupProfiles = profiles.filter((profile) => profile.group === group)
    if (!groupProfiles.length) return
    const activeCount = sessions.filter((session) => groupProfiles.some((profile) => profile.id === session.profile.id)).length
    const detail = activeCount ? ` Las ${activeCount} pestaña${activeCount === 1 ? '' : 's'} abierta${activeCount === 1 ? '' : 's'} seguirá${activeCount === 1 ? '' : 'n'} funcionando hasta que la cierres.` : ''
    if (!window.confirm(`¿Eliminar el grupo “${group}” y sus ${groupProfiles.length} conexiones?${detail}`)) return
    setProfiles((current) => {
      const remaining = current.filter((profile) => profile.group !== group)
      setSelectedId((selectedProfileId) => selectedProfileId === LOCAL_PROFILE_ID || remaining.some((profile) => profile.id === selectedProfileId) ? selectedProfileId : remaining[0]?.id ?? LOCAL_PROFILE_ID)
      return remaining
    })
    setCollapsedGroups((current) => {
      const next = new Set(current)
      next.delete(group)
      return next
    })
    setContextMenu(null)
  }

  const cycleSplitMode = () => {
    if (sessions.length < 2) return
    setMainView('terminal')
    setActiveTool(null)
    setSplitMode((current) => current === 0 ? 2 : current === 2 ? 4 : 0)
  }

  const importSshConfig = async () => {
    const imported = await window.conexum?.profiles.importSshConfig()
    if (!imported?.length) return
    setProfiles((current) => {
      const existing = new Set(current.map((profile) => `${profile.configFile ?? ''}:${profile.sshAlias ?? profile.id}`))
      return [...current, ...imported.filter((profile) => !existing.has(`${profile.configFile ?? ''}:${profile.sshAlias ?? profile.id}`))]
    })
    setCollapsedGroups((current) => {
      const next = new Set(current)
      for (const profile of imported) next.add(profile.group)
      return next
    })
    setSelectedId(imported[0].id)
  }

  const exportBackup = async () => {
    setSettingsMessage(null)
    try {
      const destination = await window.conexum?.profiles.exportBackup(profiles)
      if (destination) setSettingsMessage('Respaldo exportado correctamente.')
    } catch (backupError) {
      setSettingsMessage(backupError instanceof Error ? backupError.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : 'No se pudo exportar el respaldo.')
    }
  }

  const importBackup = async () => {
    setSettingsMessage(null)
    try {
      const imported = await window.conexum?.profiles.importBackup()
      if (!imported?.length) return
      const signatures = new Set(profiles.map((profile) => `${profile.username}\0${profile.host}\0${profile.port}\0${profile.identityFile ?? ''}`))
      const ids = new Set([LOCAL_PROFILE_ID, ...profiles.map((profile) => profile.id)])
      const additions = imported.flatMap((profile) => {
        const signature = `${profile.username}\0${profile.host}\0${profile.port}\0${profile.identityFile ?? ''}`
        if (signatures.has(signature)) return []
        signatures.add(signature)
        const next = ids.has(profile.id) ? { ...profile, id: crypto.randomUUID() } : profile
        ids.add(next.id)
        return [next]
      })
      setProfiles((current) => [...current, ...additions])
      setCollapsedGroups((current) => new Set([...current, ...imported.map((profile) => profile.group)]))
      setSettingsMessage(`${additions.length} ${additions.length === 1 ? 'conexión importada' : 'conexiones importadas'}.`)
    } catch (backupError) {
      setSettingsMessage(backupError instanceof Error ? backupError.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : 'No se pudo importar el respaldo.')
    }
  }

  const openDiagnostics = async () => {
    if (!activeSession || !window.conexum) return
    const result = await window.conexum.ssh.getDiagnostics(activeSession.id)
    if (result) setDiagnostics(result)
    setSettingsOpen(false)
  }

  const directoryForSession = (session: SshSessionTab) => latestDirectories.current.get(session.id) ?? session.currentDirectory

  const openEditorWindow = async (remotePath?: string, directoryOverride?: string | null) => {
    if (!activeSession || activeSession.status !== 'connected' || activeSession.profile.kind === 'local' || !window.conexum) return
    await window.conexum.editor.openWindow({
      sessionId: activeSession.id,
      profileName: activeSession.profile.name,
      initialDirectory: remotePath ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/' : directoryOverride === undefined ? directoryForSession(activeSession) : directoryOverride,
      ...(remotePath ? { remotePath } : {}),
    })
  }

  const openSftpAt = (directory: string | null) => {
    if (!activeSession) return
    setSftpStart({ sessionId: activeSession.id, directory })
    setMainView('terminal')
    setActiveTool('sftp')
  }

  const requestSftp = () => {
    if (activeTool === 'sftp') { setActiveTool(null); return }
    if (!activeSession || activeSession.status !== 'connected' || activeSession.profile.kind === 'local') return
    const directory = directoryForSession(activeSession)
    if (directory) openSftpAt(directory)
    else setDirectoryHelp({ sessionId: activeSession.id, action: 'sftp' })
  }

  const requestEditor = () => {
    if (!activeSession || activeSession.status !== 'connected' || activeSession.profile.kind === 'local') return
    const directory = directoryForSession(activeSession)
    if (directory) void openEditorWindow(undefined, directory)
    else setDirectoryHelp({ sessionId: activeSession.id, action: 'editor' })
  }

  const resolveDirectoryHelp = (useHome: boolean) => {
    if (!directoryHelp || activeSession?.id !== directoryHelp.sessionId || activeSession.status !== 'connected') { setDirectoryHelp(null); return }
    const directory = useHome ? null : directoryForSession(activeSession)
    if (!useHome && !directory) return
    if (directoryHelp.action === 'sftp') openSftpAt(directory)
    if (directoryHelp.action === 'editor') void openEditorWindow(undefined, directory)
    setDirectoryHelp(null)
  }

  const startSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const move = (moveEvent: PointerEvent) => setSidebarWidth(Math.min(Math.max(startWidth + moveEvent.clientX - startX, 180), 420))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const startUtilityResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = utilityPanelWidth
    const move = (moveEvent: PointerEvent) => setUtilityPanelWidth(Math.min(Math.max(startWidth + startX - moveEvent.clientX, 300), 620))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const activeDirectory = activeSession?.currentDirectory
    ? compactDirectory(activeSession.currentDirectory, activeSession.profile.username)
    : null
  const telemetryStale = Boolean(activeSession?.telemetry && Date.now() - activeSession.telemetry.updatedAt > 25_000)

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand"><img className="brand-logo" src={BRAND_ICON} alt="" /><span>Conexum</span></div>
        <nav className="toolbar" aria-label="Herramientas principales">
          <ToolButton icon={<Plus size={16} />} label="Nueva conexión" onClick={openNewProfile} />
          <ToolButton
            icon={mainView === 'terminal' && activeSession && (activeSession.status === 'connected' || activeSession.status === 'connecting') ? <Square size={14} /> : <Play size={15} />}
            label={mainView === 'terminal' && activeSession && (activeSession.status === 'connected' || activeSession.status === 'connecting') ? 'Desconectar' : mainView === 'terminal' && activeSession ? 'Reconectar' : 'Conectar'}
            disabled={mainView === 'terminal' ? !activeSession : !selected}
            accent
            onClick={connectOrDisconnect}
          />
          <ToolButton icon={splitMode === 2 ? <LayoutGrid size={16} /> : <Columns2 size={16} />} label={splitMode === 4 ? 'Vista única' : splitMode === 2 ? 'Cuadrícula 4' : 'Dividir'} disabled={sessions.length < 2} active={splitMode !== 0} onClick={cycleSplitMode} />
          <span className="toolbar-separator" aria-hidden="true" />
          <ToolButton icon={<FolderOpen size={16} />} label={activeSession?.profile.kind === 'local' ? 'SFTP sólo para sesiones SSH' : 'SFTP'} active={activeTool === 'sftp'} disabled={!activeSession || activeSession.status !== 'connected' || activeSession.profile.kind === 'local'} onClick={requestSftp} />
          <ToolButton icon={<FileCode2 size={16} />} label={activeSession?.profile.kind === 'local' ? 'Editor remoto sólo para sesiones SSH' : 'Editor'} disabled={!activeSession || activeSession.status !== 'connected' || activeSession.profile.kind === 'local'} onClick={requestEditor} />
          <div className="settings-wrapper">
            <button className="icon-button" aria-label="Ajustes" title="Ajustes" aria-expanded={settingsOpen} onClick={() => { setSettingsOpen((current) => !current); setSettingsMessage(null) }}><Settings2 size={17} /></button>
            {settingsOpen && <div className="settings-menu">
              <button onClick={() => void exportBackup()}><FileDown size={14} /><span><strong>Exportar conexiones</strong><small>Sin secretos ni claves privadas</small></span></button>
              <button onClick={() => void importBackup()}><FileUp size={14} /><span><strong>Importar conexiones</strong><small>Desde un respaldo de Conexum</small></span></button>
              <i />
              <button disabled={!activeSession || activeSession.profile.kind === 'local'} onClick={() => void openDiagnostics()}><Stethoscope size={14} /><span><strong>Diagnóstico SSH</strong><small>{activeSession?.profile.kind === 'local' ? 'No aplica a la terminal local' : activeSession ? activeSession.profile.name : 'Abrí una sesión primero'}</small></span></button>
              {settingsMessage && <p>{settingsMessage}</p>}
            </div>}
          </div>
        </nav>
      </header>

      <section className={`workspace ${sidebarOpen ? '' : 'sidebar-closed'}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-heading"><span>CONEXIONES</span><button className="icon-button subtle" onClick={() => setSidebarOpen(false)} aria-label="Ocultar conexiones"><PanelLeftClose size={17} /></button></div>
            <label className="search-box"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar conexiones…" /></label>
            <div className="connection-tree">
              {showLocalProfile && <div className="connection-group local-group">
                <button className="group-title" aria-expanded={!localGroupCollapsed} onClick={() => setLocalGroupCollapsed((current) => !current)}>
                  <ChevronDown size={13} className={`folder-chevron ${localGroupCollapsed ? 'collapsed' : ''}`} /><Monitor size={14} /><span>{localProfile.group}</span><small>1</small>
                </button>
                {!localGroupCollapsed && <button className={`connection-row ${selectedId === LOCAL_PROFILE_ID ? 'selected' : ''}`} onClick={() => setSelectedId(LOCAL_PROFILE_ID)} onDoubleClick={() => openSession(localProfile)} title="Doble clic para abrir una terminal de esta Mac">
                  <SquareTerminal size={15} className="server-icon" /><span className={`status-dot ${sessions.some((session) => session.profile.id === LOCAL_PROFILE_ID && session.status === 'connected') ? 'online' : ''}`} /><span>{localProfile.name}</span>
                </button>}
              </div>}
              {groupedProfiles.length === 0 && !showLocalProfile && <div className="empty-connections"><Search size={22} /><strong>Sin resultados</strong></div>}
              {groupedProfiles.map(([group, connections]) => (
                <div className="connection-group" key={group}>
                  <button className="group-title" aria-expanded={!collapsedGroups.has(group)} onClick={() => toggleGroup(group)} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, kind: 'group', group }) }} title="Clic derecho para renombrar o eliminar el grupo">
                    <ChevronDown size={13} className={`folder-chevron ${collapsedGroups.has(group) ? 'collapsed' : ''}`} /><Folder size={14} /><span>{group}</span><small>{connections.length}</small>
                  </button>
                  {!collapsedGroups.has(group) && connections.map((connection) => (
                    <button key={connection.id} className={`connection-row ${selectedId === connection.id ? 'selected' : ''}`} onClick={() => setSelectedId(connection.id)} onDoubleClick={() => openSession(connection)} onContextMenu={(event) => { event.preventDefault(); setSelectedId(connection.id); setContextMenu({ x: event.clientX, y: event.clientY, kind: 'profile', profileId: connection.id }) }} title="Doble clic para abrir otra sesión · Clic derecho para editar">
                      <Server size={15} className="server-icon" /><span className={`status-dot ${sessions.some((session) => session.profile.id === connection.id && session.status === 'connected') ? 'online' : ''}`} /><span>{connection.name}</span>{connection.identityFile || connection.sshAlias ? <KeyRound size={13} className="key-indicator" aria-label="Usa clave SSH" /> : selectedId === connection.id && <MoreHorizontal size={15} className="more" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="sidebar-actions">
              <button className="import-connections" onClick={importSshConfig} title="Importar SSH config" aria-label="Importar SSH config"><Import size={13} />Importar</button>
              <button className="add-connection" onClick={openNewProfile} title="Agregar conexión SSH" aria-label="Agregar conexión SSH"><Plus size={13} />Agregar</button>
            </div>
          </aside>
        )}

        {sidebarOpen && <button className="sidebar-resizer" aria-label="Cambiar ancho del panel de conexiones" onPointerDown={startSidebarResize} onDoubleClick={() => setSidebarWidth(270)} />}

        <section className="main-area">
          <div className="tabs-row">
            {!sidebarOpen && <button className="sidebar-reveal" onClick={() => setSidebarOpen(true)} aria-label="Mostrar conexiones"><PanelLeftOpen size={17} /></button>}
            <button className={`session-tab home-tab ${mainView === 'home' ? 'active' : ''}`} onClick={() => { setMainView('home'); setActiveTool(null) }} aria-label="Inicio" title="Inicio"><Home size={15} /></button>
            <div className="session-tabs-scroll">
              {sessions.map((session) => {
                const sameProfileSessions = sessions.filter((item) => item.profile.id === session.profile.id)
                const ordinal = sameProfileSessions.findIndex((item) => item.id === session.id) + 1
                return (
                  <button key={session.id} className={`session-tab ${mainView === 'terminal' && activeSessionId === session.id ? 'active' : ''}`} onClick={() => {
                    if (activeTool === 'sftp' && activeSessionId !== session.id) {
                      const directory = latestDirectories.current.get(session.id) ?? session.currentDirectory
                      if (directory && session.profile.kind !== 'local') setSftpStart({ sessionId: session.id, directory })
                      else setActiveTool(null)
                    }
                    setActiveSessionId(session.id)
                    setSelectedId(session.profile.id)
                    setMainView('terminal')
                  }} onDoubleClick={() => closeSessionTab(session)} title={`${session.profile.kind === 'local' ? 'Terminal de esta Mac' : `${session.profile.username}@${session.profile.host}:${session.profile.port}`} · Doble clic para cerrar`}>
                    {session.profile.kind === 'local' ? <Monitor size={15} /> : <SquareTerminal size={15} />}<span className="tab-title">{session.profile.name}</span>{sameProfileSessions.length > 1 && <small>#{ordinal}</small>}<i className={`status-dot ${session.status === 'connected' ? 'online' : ''}`} />
                  </button>
                )
              })}
            </div>
            <div className="tab-spacer" />
          </div>

          <div className={`content-row ${activeTool && mainView === 'terminal' ? 'panel-open' : ''}`} style={{ '--utility-width': `${utilityPanelWidth}px` } as CSSProperties}>
            <div className={`primary-view ${mainView === 'terminal' && splitMode ? `split-view split-${splitMode}` : ''}`}>
              <div className={`home-layer ${mainView === 'home' ? 'visible' : ''}`}>
                <WelcomeHome profiles={[localProfile, ...profiles]} recentIds={recentIds} selectedId={selectedId} onSelect={(profile) => setSelectedId(profile.id)} onConnect={openSession} />
              </div>
              {sessions.map((session) => {
                const splitVisible = mainView === 'terminal' && splitSessionIds.has(session.id)
                const singleVisible = mainView === 'terminal' && !splitMode && activeSessionId === session.id
                return <div key={session.id} className={`terminal-panel terminal-layer ${splitVisible || singleVisible ? 'visible' : ''} ${splitMode ? (splitVisible ? 'split-pane' : 'split-hidden') : ''}`} onMouseDown={() => setActiveSessionId(session.id)}>
                  <ManagedTerminalSession session={session} onHandle={registerTerminalHandle} onStatusChange={updateSessionStatus} onDirectoryChange={updateSessionDirectory} onIdentityNeeded={handleIdentityNeeded} />
                  {(session.status === 'disconnected' || session.status === 'error') && (
                    <button className="terminal-reconnect" onClick={(event) => { event.stopPropagation(); void terminalRefs.current.get(session.id)?.connect(session.profile, { preserveHistory: true }) }}>
                      <RefreshCw size={13} />Reconectar
                    </button>
                  )}
                </div>
              })}
            </div>
            {mainView === 'terminal' && activeTool && <button className="utility-resizer" aria-label="Cambiar ancho del panel de herramientas" onPointerDown={startUtilityResize} onDoubleClick={() => setUtilityPanelWidth(480)} />}
            {mainView === 'terminal' && activeTool === 'sftp' && activeSession && (
              <SftpPanel key={activeSession.id} sessionId={activeSession.id} profileName={activeSession.profile.name} initialDirectory={sftpStart?.sessionId === activeSession.id ? sftpStart.directory : directoryForSession(activeSession)} onClose={() => setActiveTool(null)} onOpenEditor={(remotePath) => void openEditorWindow(remotePath)} />
            )}
          </div>

          <footer className="statusbar">
            <div className="status-left">
              <span className={`status-dot ${activeSessionCount > 0 ? 'online' : ''}`} />
              <span>{mainView === 'terminal' && activeSession ? statusLabels[activeSession.status] : activeSessionCount > 0 ? `${activeSessionCount} ${activeSessionCount === 1 ? 'sesión activa' : 'sesiones activas'}` : 'Sin conexión'}</span>
              <span className="divider" />
              <span>{mainView === 'terminal' && activeSession ? activeSession.profile.kind === 'local' ? activeSession.profile.group : `${activeSession.profile.username}@${activeSession.profile.host}` : selected ? selected.kind === 'local' ? selected.group : `${selected.username}@${selected.host}` : 'Seleccioná una conexión'}</span>
              {mainView === 'terminal' && activeSession?.status === 'connected' && (
                !activeDirectory && activeSession.profile.kind !== 'local'
                  ? <button className="session-directory unavailable directory-help-trigger" title="Configurar detección de la carpeta remota" onClick={() => setDirectoryHelp({ sessionId: activeSession.id, action: 'help' })}>Ruta —</button>
                  : <span className={`session-directory ${activeDirectory ? '' : 'unavailable'}`} title={activeSession.currentDirectory ?? 'Directorio local no disponible'}>{activeDirectory ?? 'Ruta —'}</span>
              )}
            </div>
            <div className={`status-right ${telemetryStale ? 'stale' : ''}`}>
              {mainView === 'terminal' && activeSession?.status === 'connected' && activeSession.profile.kind !== 'local' && (
                <>
                  <span title="Uso aproximado de CPU del servidor">CPU {activeSession.telemetry?.cpuPercent ?? '—'}{activeSession.telemetry?.cpuPercent !== null && activeSession.telemetry?.cpuPercent !== undefined ? '%' : ''}</span>
                  <span title="Uso aproximado de memoria del servidor">RAM {activeSession.telemetry?.memoryPercent ?? '—'}{activeSession.telemetry ? '%' : ''}</span>
                </>
              )}
            </div>
          </footer>
        </section>
      </section>
      {contextMenu && contextMenu.kind === 'profile' && (() => {
        const profile = profiles.find((item) => item.id === contextMenu.profileId)
        if (!profile) return null
        return (
          <div className="server-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={() => openSession(profile)}><Play size={14} />Abrir nueva sesión</button>
            <button onClick={() => openProfileEditor(profile)}><Pencil size={14} />Editar configuración…</button>
          </div>
        )
      })()}
      {contextMenu && contextMenu.kind === 'group' && (
        <div className="server-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => renameGroup(contextMenu.group)}><Pencil size={14} />Renombrar grupo…</button>
          <button className="danger-item" onClick={() => deleteGroup(contextMenu.group)}><Trash2 size={14} />Eliminar grupo…</button>
        </div>
      )}
      {modalOpen && <ConnectionModal
        profile={editingProfile}
        identityRequired={Boolean(editingProfile && identityRequiredProfileId === editingProfile.id)}
        onClose={() => { setModalOpen(false); setEditingProfile(null); setIdentityRequiredProfileId(null) }}
        onSave={saveProfile}
      />}
      {diagnostics && <DiagnosticsModal diagnostics={diagnostics} onClose={() => setDiagnostics(null)} />}
      {directoryHelp && <ShellIntegrationHelp
        currentDirectory={activeSession?.id === directoryHelp.sessionId ? directoryForSession(activeSession) : null}
        onClose={() => setDirectoryHelp(null)}
        onOpenHome={directoryHelp.action === 'help' ? undefined : () => resolveDirectoryHelp(true)}
        onOpenCurrent={directoryHelp.action === 'help' ? undefined : () => resolveDirectoryHelp(false)}
      />}
    </main>
  )
}
