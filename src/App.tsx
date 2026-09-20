import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SftpPanel } from './SftpPanel'
import {
  ChevronDown,
  Clock3,
  Columns2,
  FileCode2,
  Folder,
  FolderOpen,
  Home,
  Import,
  KeyRound,
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
  Square,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'
import type { ConnectionProfile, RemoteTelemetry } from './conexum'

type ToolPanel = 'sftp' | 'editor' | null
type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
type MainView = 'home' | 'terminal'
type SplitMode = 0 | 2 | 4
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
        cursor: '#55e276',
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

    terminal.writeln('\x1b[1;34mConexum\x1b[0m — gestor visual de conexiones SSH')
    terminal.writeln('')
    terminal.writeln('Creá o seleccioná una conexión y presioná \x1b[1mConectar\x1b[0m.')
    terminal.writeln('Conexum utilizará \x1b[1m/usr/bin/ssh\x1b[0m, el OpenSSH incluido en macOS.')
    terminal.writeln('Las contraseñas y huellas se gestionan directamente dentro de esta terminal.')
    terminal.writeln('')
    terminal.write('\x1b[90mEsperando una conexión…\x1b[0m')

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
      terminal.writeln(`\r\n\x1b[90m[Conexum] La sesión SSH finalizó con código ${exitCode}.\x1b[0m`)
      onStatusChange('disconnected')
      if (authenticationFailedRef.current && activeProfileRef.current && !activeProfileRef.current.identityFile) {
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
        terminal.writeln('\r\n\x1b[31m[Conexum] SSH real sólo está disponible dentro de la aplicación de escritorio.\x1b[0m')
        terminal.writeln('Ejecutá: pnpm run desktop')
        onStatusChange('error')
        return
      }

      if (sessionIdRef.current) window.conexum.ssh.disconnect(sessionIdRef.current)
      activeProfileRef.current = profile
      authenticationFailedRef.current = false
      if (options.preserveHistory) {
        terminal.writeln('')
        terminal.writeln(`\x1b[90m[Conexum] Reconectando con ${profile.username}@${profile.host}:${profile.port}…\x1b[0m`)
      } else {
        terminal.reset()
        terminal.writeln(`\x1b[90m[Conexum] Abriendo /usr/bin/ssh hacia ${profile.username}@${profile.host}:${profile.port}…\x1b[0m`)
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
        const message = error instanceof Error ? error.message : 'No se pudo iniciar OpenSSH.'
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

  return <div className="terminal-host" ref={hostRef} aria-label="Terminal SSH" />
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

function ToolButton({ label, icon, active, disabled, onClick }: {
  label: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button className={`tool-button ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="tool-icon" aria-hidden="true">{icon}</span><span>{label}</span>
    </button>
  )
}

function WelcomeHome({ profiles, recentIds, selectedId, onSelect, onConnect, onNew, onImport }: {
  profiles: ConnectionProfile[]
  recentIds: string[]
  selectedId: string | null
  onSelect(profile: ConnectionProfile): void
  onConnect(profile: ConnectionProfile): void
  onNew(): void
  onImport(): void
}) {
  const recentProfiles = recentIds
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is ConnectionProfile => Boolean(profile))
    .slice(0, 6)
  const featuredProfiles = recentProfiles.length ? recentProfiles : profiles.slice(0, 6)

  return (
    <div className="welcome-home">
      <section className="welcome-banner" style={{ backgroundImage: `linear-gradient(90deg, #0b1119 0%, #0b1119e8 42%, #0b111966 72%), url(${BRAND_BANNER})` }}>
        <div className="welcome-copy">
          <div className="welcome-brand"><img src={BRAND_ICON} alt="" /><span>Conexum</span></div>
          <h1>A simple SSH connection manager.</h1>
          <p>OpenSSH de macOS, organizado en un solo lugar.</p>
          <div className="welcome-actions">
            <button className="primary-button" onClick={onNew}><Plus size={16} />Nueva conexión</button>
            <button className="secondary-button" onClick={onImport}><Import size={16} />Importar SSH config</button>
          </div>
        </div>
      </section>

      <div className="welcome-content">
        {profiles.length === 0 ? (
          <section className="home-empty">
            <Server size={26} />
            <h2>Tu lista de conexiones está vacía</h2>
            <p>Creá un perfil o importá tu archivo SSH config para comenzar.</p>
          </section>
        ) : (
          <>
            <section className="home-section">
              <div className="home-section-heading">
                <div><Clock3 size={15} /><h2>{recentProfiles.length ? 'Conexiones recientes' : 'Listas para conectar'}</h2></div>
                <span>Doble clic para abrir</span>
              </div>
              <div className="server-shortcuts">
                {featuredProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    className={`server-shortcut ${selectedId === profile.id ? 'selected' : ''}`}
                    onClick={() => onSelect(profile)}
                    onDoubleClick={() => onConnect(profile)}
                  >
                    <span className="shortcut-icon"><Server size={18} /></span>
                    <span className="shortcut-copy"><strong>{profile.name}</strong><small>{profile.username}@{profile.host}:{profile.port}</small></span>
                    {profile.identityFile || profile.sshAlias ? <KeyRound size={14} className="shortcut-key" /> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="home-section all-connections">
              <div className="home-section-heading"><div><Folder size={15} /><h2>Todos los servidores</h2></div><span>{profiles.length} {profiles.length === 1 ? 'conexión' : 'conexiones'}</span></div>
              <div className="home-server-list">
                {profiles.map((profile) => (
                  <button key={profile.id} onClick={() => onSelect(profile)} onDoubleClick={() => onConnect(profile)}>
                    <span><Server size={15} /><strong>{profile.name}</strong></span>
                    <small>{profile.group}</small>
                    <code>{profile.username}@{profile.host}</code>
                    <Play size={13} />
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
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

const statusLabels: Record<SessionStatus, string> = {
  idle: 'Sin conexión',
  connecting: 'Conectando…',
  connected: 'Sesión activa',
  disconnected: 'Desconectado',
  error: 'Error',
}

export function App() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(loadProfiles)
  const [selectedId, setSelectedId] = useState<string | null>(() => loadProfiles()[0]?.id ?? null)
  const [mainView, setMainView] = useState<MainView>('home')
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentConnections)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(stored) ? Math.min(Math.max(stored, 180), 420) : 270
  })
  const [utilityPanelWidth, setUtilityPanelWidth] = useState(380)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(loadProfiles().map((profile) => profile.group)))
  const [activeTool, setActiveTool] = useState<ToolPanel>(null)
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [identityRequiredProfileId, setIdentityRequiredProfileId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [sessions, setSessions] = useState<SshSessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState<SplitMode>(0)
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map())

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
  }, [profiles])

  useEffect(() => {
    const validIds = new Set(profiles.map((profile) => profile.id))
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
    if (mainView !== 'terminal' || !activeSessionId || activeSession?.status !== 'connected' || !api) return
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
    if (activeTool && activeSession?.status !== 'connected') setActiveTool(null)
  }, [activeSession?.status, activeTool])

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
      currentDirectory: null,
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
      ? `¿Cerrar la pestaña de ${session.profile.name} y finalizar esta conexión activa?`
      : `¿Cerrar la pestaña de ${session.profile.name}?`
    if (!window.confirm(message)) return
    if (active) terminalRefs.current.get(session.id)?.disconnect()

    const closingIndex = sessions.findIndex((item) => item.id === session.id)
    const remaining = sessions.filter((item) => item.id !== session.id)
    setSessions(remaining)
    terminalRefs.current.delete(session.id)

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
      setSelectedId((selectedProfileId) => remaining.some((profile) => profile.id === selectedProfileId) ? selectedProfileId : remaining[0]?.id ?? null)
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

  const toggleTool = (tool: Exclude<ToolPanel, null>) => {
    setActiveTool((current) => current === tool ? null : tool)
  }

  const activeDirectory = activeSession?.currentDirectory
    ? compactDirectory(activeSession.currentDirectory, activeSession.profile.username)
    : null
  const telemetryStale = Boolean(activeSession?.telemetry && Date.now() - activeSession.telemetry.updatedAt > 25_000)

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="traffic-lights" aria-hidden="true"><i className="red" /><i className="yellow" /><i className="green" /></div>
        <div className="brand"><img className="brand-logo" src={BRAND_ICON} alt="" /><span>Conexum</span></div>
        <nav className="toolbar" aria-label="Herramientas principales">
          <ToolButton icon={<Plus size={16} />} label="Nueva conexión" onClick={openNewProfile} />
          <ToolButton
            icon={mainView === 'terminal' && activeSession && (activeSession.status === 'connected' || activeSession.status === 'connecting') ? <Square size={14} /> : <Play size={15} />}
            label={mainView === 'terminal' && activeSession && (activeSession.status === 'connected' || activeSession.status === 'connecting') ? 'Desconectar' : mainView === 'terminal' && activeSession ? 'Reconectar' : 'Conectar'}
            disabled={mainView === 'terminal' ? !activeSession : !selected}
            onClick={connectOrDisconnect}
          />
          <ToolButton icon={<Columns2 size={16} />} label={splitMode === 4 ? 'Vista única' : splitMode === 2 ? 'Cuadrícula 4' : 'Dividir'} disabled={sessions.length < 2} active={splitMode !== 0} onClick={cycleSplitMode} />
          <ToolButton icon={<FolderOpen size={16} />} label="SFTP" active={activeTool === 'sftp'} disabled={!activeSession || activeSession.status !== 'connected'} onClick={() => { setMainView('terminal'); toggleTool('sftp') }} />
          <ToolButton icon={<FileCode2 size={16} />} label="Editor" active={activeTool === 'editor'} disabled={!activeSession} onClick={() => { setMainView('terminal'); toggleTool('editor') }} />
          <button className="icon-button" aria-label="Ajustes"><Settings2 size={17} /></button>
        </nav>
      </header>

      <section className={`workspace ${sidebarOpen ? '' : 'sidebar-closed'}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-heading"><span>CONEXIONES</span><button className="icon-button subtle" onClick={() => setSidebarOpen(false)} aria-label="Ocultar conexiones"><PanelLeftClose size={17} /></button></div>
            <label className="search-box"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar conexiones…" /><kbd>⌘ K</kbd></label>
            <div className="connection-tree">
              {groupedProfiles.length === 0 ? (
                <div className="empty-connections"><Server size={28} /><strong>No hay conexiones</strong><p>Agregá tu primer servidor SSH.</p></div>
              ) : groupedProfiles.map(([group, connections]) => (
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
              <button className="import-connections" onClick={importSshConfig}><Import size={14} />Importar SSH config</button>
              <button className="add-connection" onClick={openNewProfile}><Plus size={14} />Agregar conexión</button>
            </div>
          </aside>
        )}

        {sidebarOpen && <button className="sidebar-resizer" aria-label="Cambiar ancho del panel de conexiones" onPointerDown={startSidebarResize} onDoubleClick={() => setSidebarWidth(270)} />}

        <section className="main-area">
          <div className="tabs-row">
            {!sidebarOpen && <button className="sidebar-reveal" onClick={() => setSidebarOpen(true)} aria-label="Mostrar conexiones"><PanelLeftOpen size={17} /></button>}
            <button className={`session-tab home-tab ${mainView === 'home' ? 'active' : ''}`} onClick={() => { setMainView('home'); setActiveTool(null) }}><Home size={15} />Inicio</button>
            <div className="session-tabs-scroll">
              {sessions.map((session) => {
                const sameProfileSessions = sessions.filter((item) => item.profile.id === session.profile.id)
                const ordinal = sameProfileSessions.findIndex((item) => item.id === session.id) + 1
                return (
                  <button key={session.id} className={`session-tab ${mainView === 'terminal' && activeSessionId === session.id ? 'active' : ''}`} onClick={() => { setActiveSessionId(session.id); setSelectedId(session.profile.id); setMainView('terminal') }} onDoubleClick={() => closeSessionTab(session)} title={`${session.profile.username}@${session.profile.host}:${session.profile.port} · Doble clic para cerrar`}>
                    <SquareTerminal size={15} /><span className="tab-title">{session.profile.name}</span>{sameProfileSessions.length > 1 && <small>#{ordinal}</small>}<i className={`status-dot ${session.status === 'connected' ? 'online' : ''}`} />
                  </button>
                )
              })}
            </div>
            <button className="new-tab" onClick={openNewProfile} aria-label="Nueva conexión"><Plus size={17} /></button>
            <div className="tab-spacer" />
          </div>

          <div className={`content-row ${activeTool && mainView === 'terminal' ? 'panel-open' : ''}`} style={{ '--utility-width': `${utilityPanelWidth}px` } as CSSProperties}>
            <div className={`primary-view ${mainView === 'terminal' && splitMode ? `split-view split-${splitMode}` : ''}`}>
              <div className={`home-layer ${mainView === 'home' ? 'visible' : ''}`}>
                <WelcomeHome profiles={profiles} recentIds={recentIds} selectedId={selectedId} onSelect={(profile) => setSelectedId(profile.id)} onConnect={openSession} onNew={openNewProfile} onImport={importSshConfig} />
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
            {mainView === 'terminal' && activeTool && <button className="utility-resizer" aria-label="Cambiar ancho del panel de herramientas" onPointerDown={startUtilityResize} onDoubleClick={() => setUtilityPanelWidth(380)} />}
            {mainView === 'terminal' && activeTool === 'sftp' && activeSession && (
              <SftpPanel key={activeSession.id} sessionId={activeSession.id} profileName={activeSession.profile.name} initialDirectory={activeSession.currentDirectory} onClose={() => setActiveTool(null)} />
            )}
            {mainView === 'terminal' && activeTool === 'editor' && (
              <aside className="utility-panel editor-panel">
                <div className="panel-heading"><div><small>EDITOR — PRÓXIMA ETAPA</small><strong>Archivos remotos</strong></div><button className="icon-button" onClick={() => setActiveTool(null)}><X size={17} /></button></div>
                <div className="panel-message"><FileCode2 size={32} /><strong>Editor opcional</strong><p>Los archivos se abrirán aquí únicamente cuando los selecciones desde SFTP.</p></div>
              </aside>
            )}
          </div>

          <footer className="statusbar">
            <div className="status-left">
              <span className={`status-dot ${activeSessionCount > 0 ? 'online' : ''}`} />
              <span>{mainView === 'terminal' && activeSession ? statusLabels[activeSession.status] : activeSessionCount > 0 ? `${activeSessionCount} ${activeSessionCount === 1 ? 'sesión activa' : 'sesiones activas'}` : 'Sin conexión'}</span>
              <span className="divider" />
              <span>{mainView === 'terminal' && activeSession ? `${activeSession.profile.username}@${activeSession.profile.host}` : selected ? `${selected.username}@${selected.host}` : 'Seleccioná una conexión'}</span>
              {mainView === 'terminal' && activeSession?.status === 'connected' && (
                <span className={`session-directory ${activeDirectory ? '' : 'unavailable'}`} title={activeSession.currentDirectory ?? 'Activá la integración OSC 7 para mostrar el directorio remoto'}>
                  {activeDirectory ?? 'Ruta —'}
                </span>
              )}
            </div>
            <div className={`status-right ${telemetryStale ? 'stale' : ''}`}>
              {mainView === 'terminal' && activeSession?.status === 'connected' && (
                <>
                  <span title="Uso aproximado de CPU del servidor">CPU {activeSession.telemetry?.cpuPercent ?? '—'}{activeSession.telemetry?.cpuPercent !== null && activeSession.telemetry?.cpuPercent !== undefined ? '%' : ''}</span>
                  <span title="Uso aproximado de memoria del servidor">RAM {activeSession.telemetry?.memoryPercent ?? '—'}{activeSession.telemetry ? '%' : ''}</span>
                </>
              )}
              <span className="system-ssh">/usr/bin/ssh</span>
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
    </main>
  )
}
