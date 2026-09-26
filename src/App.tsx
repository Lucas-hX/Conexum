import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SftpPanel } from './SftpPanel'
import { ShellIntegrationHelp } from './ShellIntegrationHelp'
import type { EditorRequest } from './EditorApp'
import {
  ChevronDown,
  ClipboardCopy,
  Columns2,
  Copy,
  FileCode2,
  FileDown,
  FileUp,
  Folder,
  FolderOpen,
  Languages,
  Import,
  KeyRound,
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Pencil,
  Pin,
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
import { useI18n } from './i18n'
import { themes, useTheme } from './theme'

type ToolPanel = 'sftp' | 'editor' | null
type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
type MainView = 'home' | 'terminal'
type SplitMode = 0 | 2 | 4
type ProfileModalMode = 'create' | 'edit' | 'duplicate'
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
const RIVER_BANNER_HEIGHT_KEY = 'conexum.riverBannerHeight.v1'
const RECENT_CONNECTIONS_KEY = 'conexum.recentConnections.v1'
const BRAND_ICON = './brand/conexum-icon.png'
const BRAND_BANNER = './brand/conexum-welcome-banner.png'
const THEME_912_BANNER = new URL('./brand/theme-river-plate-banner-v2.jpg', document.baseURI).href
const THEME_912_EMBLEM = new URL('./brand/theme-river-plate-emblem.png', document.baseURI).href
const RIVER_BANNER_DEFAULT_HEIGHT = 72
const RIVER_BANNER_MIN_HEIGHT = 56
const RIVER_BANNER_MAX_HEIGHT = 168
const LOCAL_PROFILE_ID = 'conexum-local'
const DEFAULT_LOCAL_PROFILE: ConnectionProfile = {
  id: LOCAL_PROFILE_ID,
  kind: 'local',
  name: 'Local terminal',
  group: 'This Mac',
  host: 'localhost',
  port: 0,
  username: '',
}
const EditorPane = lazy(() => import('./EditorApp'))
type EditorPanel = { sessionId: string; profileName: string; request: EditorRequest }
type EditorState = { dirty: boolean; saving: boolean }
type SessionPreview = { sessionId: string; left: number; top: number }
type TabDropTarget = { sessionId: string; position: 'before' | 'after' }
type TabPointerDrag = { sourceId: string; pointerId: number; startX: number; moved: boolean; target: TabDropTarget | null }

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
  const { text, error: localizeError } = useI18n()
  const { theme } = useTheme()
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
      theme: theme.terminal,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(hostRef.current)
    terminalRef.current = terminal
    fitRef.current = fitAddon

    terminal.write(`\x1b[90m[Conexum] ${text('Starting terminal…', 'Iniciando terminal…')}\x1b[0m`)

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
      terminal.writeln(`\r\n\x1b[90m[Conexum] ${text(
        `The ${activeProfileRef.current?.kind === 'local' ? 'local' : 'SSH'} session ended with exit code ${exitCode}.`,
        `La sesión ${activeProfileRef.current?.kind === 'local' ? 'local' : 'SSH'} finalizó con código ${exitCode}.`,
      )}\x1b[0m`)
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

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = theme.terminal
  }, [theme])

  useImperativeHandle(ref, () => ({
    async connect(profile, options = {}) {
      const terminal = terminalRef.current
      const fitAddon = fitRef.current
      if (!terminal || !fitAddon) return

      if (!window.conexum) {
        terminal.writeln(`\r\n\x1b[31m[Conexum] ${text('The real terminal is only available in the desktop app.', 'La terminal real sólo está disponible en la aplicación de escritorio.')}\x1b[0m`)
        terminal.writeln(text('Run: pnpm run desktop', 'Ejecutá: pnpm run desktop'))
        onStatusChange('error')
        return
      }

      if (sessionIdRef.current) window.conexum.ssh.disconnect(sessionIdRef.current)
      activeProfileRef.current = profile
      authenticationFailedRef.current = false
      if (options.preserveHistory) {
        terminal.writeln('')
        terminal.writeln(`\x1b[90m[Conexum] ${text('Reopening', 'Reabriendo')} ${profile.kind === 'local' ? text('the local terminal', 'la terminal local') : `${profile.username}@${profile.host}:${profile.port}`}…\x1b[0m`)
      } else {
        terminal.reset()
        terminal.writeln(`\x1b[90m[Conexum] ${text('Opening', 'Abriendo')} ${profile.kind === 'local' ? text('this Mac’s terminal', 'la terminal de esta Mac') : `${profile.username}@${profile.host}:${profile.port}`}…\x1b[0m`)
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
        const message = error instanceof Error ? localizeError(error.message) : text('Could not start the terminal.', 'No se pudo iniciar la terminal.')
        terminal.writeln(`\r\n\x1b[31m[Conexum] ${message}\x1b[0m`)
        onStatusChange('error')
        if (/archivo de identidad|identity file/i.test(message)) onIdentityNeeded(profile)
      }
    },
    disconnect() {
      const terminal = terminalRef.current
      if (!sessionIdRef.current) return
      window.conexum?.ssh.disconnect(sessionIdRef.current)
      sessionIdRef.current = null
      terminal?.writeln(`\r\n\x1b[90m[Conexum] ${text('Disconnected by user.', 'Desconectado por el usuario.')}\x1b[0m`)
      onStatusChange('disconnected')
    },
  }), [localizeError, onIdentityNeeded, onStatusChange, sessionId, text])

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
  const { text } = useI18n()
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
      <section className="welcome-banner" style={{ backgroundImage: `linear-gradient(90deg, var(--theme-welcomeSolid, #0b1119) 0%, var(--theme-welcomeFade, #0b1119ec) 42%, var(--theme-welcomeClear, #0b111966) 76%), url(${BRAND_BANNER})` }}>
        <div className="welcome-copy">
          <div className="welcome-brand"><img src={BRAND_ICON} alt="" /><span>Conexum</span></div>
          <p>{text('Local terminal and SSH connections, all in one place.', 'Terminal local y conexiones SSH, en un solo lugar.')}</p>
        </div>
      </section>

      <div className="welcome-content">
        <section className="home-section">
          <div className="home-section-heading"><div><h2>{text('Quick access', 'Acceso rápido')}</h2></div><span>{text('Double-click to open', 'Doble clic para abrir')}</span></div>
          <div className="server-shortcuts">
            {featuredProfiles.map((profile) => (
              <button
                key={profile.id}
                className={`server-shortcut ${selectedId === profile.id ? 'selected' : ''}`}
                onClick={() => onSelect(profile)}
                onDoubleClick={() => onConnect(profile)}
                title={text(`Double-click to open ${profile.name}`, `Doble clic para abrir ${profile.name}`)}
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

function ConnectionModal({ profile, mode, identityRequired, onClose, onSave }: {
  profile?: ConnectionProfile | null
  mode: ProfileModalMode
  identityRequired?: boolean
  onClose(): void
  onSave(profile: ConnectionProfile): void
}) {
  const { text } = useI18n()
  const editing = mode === 'edit'
  const [name, setName] = useState(profile?.name ?? '')
  const [group, setGroup] = useState(profile?.group ?? text('My servers', 'Mis servidores'))
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
      setKeychainMessage(text('The passphrase was removed from ssh-agent and Keychain.', 'La passphrase fue eliminada de ssh-agent y Keychain.'))
    } catch {
      setKeychainMessage(text('No saved passphrase was found for this key.', 'No se encontró una passphrase guardada para esta clave.'))
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !host.trim() || !username.trim()) return
    onSave({
      id: profile?.id ?? crypto.randomUUID(),
      name: name.trim(),
      group: group.trim() || text('My servers', 'Mis servidores'),
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
          <div><small>{mode === 'edit' ? text('EDIT PROFILE', 'EDITAR PERFIL') : mode === 'duplicate' ? text('DUPLICATE PROFILE', 'DUPLICAR PERFIL') : text('NEW PROFILE', 'NUEVO PERFIL')}</small><h2>{text('SSH connection', 'Conexión SSH')}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={text('Close', 'Cerrar')}><X size={18} /></button>
        </div>
        {identityRequired && <div className="identity-warning"><strong>{text('OpenSSH could not find a valid key', 'OpenSSH no encontró una clave válida')}</strong><span>{text('Select the matching IdentityFile and save the profile to reconnect.', 'Seleccioná el IdentityFile correspondiente y guardá el perfil para volver a conectar.')}</span></div>}
        <div className="form-grid">
          <label className="full-field"><span>{text('Name', 'Nombre')}</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={text('Web server', 'Servidor web')} required /></label>
          <label className="full-field"><span>{text('Group', 'Grupo')}</span><input value={group} onChange={(e) => setGroup(e.target.value)} placeholder={text('Production', 'Producción')} /></label>
          <label className="host-field"><span>{text('Host or IP', 'Servidor o IP')}</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.20" required /></label>
          <label><span>{text('Port', 'Puerto')}</span><input type="number" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} required /></label>
          <label className="full-field"><span>{text('Username', 'Usuario')}</span><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ubuntu" required /></label>
          <label className="full-field"><span>{text('Identity file (optional)', 'Identity file (opcional)')}</span><div className="file-picker"><input value={identityFile} onChange={(e) => setIdentityFile(e.target.value)} placeholder="~/.ssh/id_ed25519" /><button type="button" onClick={chooseIdentityFile}><FolderOpen size={14} />{text('Choose…', 'Seleccionar…')}</button></div></label>
        </div>
        <div className="security-note">
          <ShieldCheck size={18} /><div><strong>{text('Protected by OpenSSH and Keychain', 'Protegido por OpenSSH y Keychain')}</strong>
          <span>{text('Conexum stores only the path. OpenSSH can remember the key passphrase through ssh-agent and macOS Keychain.', 'Conexum guarda solamente la ruta. OpenSSH puede recordar la passphrase de la clave mediante ssh-agent y el llavero de macOS.')}</span></div>
        </div>
        {editing && profile && identityFile && <div className="keychain-actions"><button type="button" onClick={forgetPassphrase}>{text('Forget saved passphrase', 'Olvidar passphrase guardada')}</button>{keychainMessage && <span>{keychainMessage}</span>}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>{text('Cancel', 'Cancelar')}</button>
          <button type="submit" className="primary-button">{mode === 'edit' ? text('Save changes', 'Guardar cambios') : mode === 'duplicate' ? text('Save duplicate', 'Guardar duplicado') : text('Save connection', 'Guardar conexión')}</button>
        </div>
      </form>
    </div>
  )
}

function DiagnosticsModal({ diagnostics, onClose }: { diagnostics: SshDiagnostics; onClose(): void }) {
  const { text } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const success = await window.conexum?.ssh.copyDiagnostics(diagnostics.sessionId)
    setCopied(Boolean(success))
  }
  const status = diagnostics.status === 'connected' ? text('Connected', 'Conectado') : diagnostics.status === 'error' ? text('Error', 'Error') : text('Disconnected', 'Desconectado')
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="diagnostics-modal">
        <div className="modal-heading"><div><small>{text('SSH SESSION', 'SESIÓN SSH')}</small><h2>{text('Connection diagnostics', 'Diagnóstico de conexión')}</h2></div><button className="icon-button" onClick={onClose} aria-label={text('Close', 'Cerrar')}><X size={18} /></button></div>
        <dl className="diagnostics-grid">
          <dt>Host</dt><dd>{diagnostics.host}</dd>
          <dt>{text('Port', 'Puerto')}</dt><dd>{diagnostics.port}</dd>
          <dt>{text('Username', 'Usuario')}</dt><dd>{diagnostics.username}</dd>
          <dt>Identity file</dt><dd title={diagnostics.identityFile ?? undefined}>{diagnostics.identityFile || text('Not specified', 'No especificado')}</dd>
          <dt>SSH alias</dt><dd>{diagnostics.sshAlias || text('Not specified', 'No especificado')}</dd>
          <dt>{text('Status', 'Estado')}</dt><dd><span className={`diagnostic-state ${diagnostics.status}`}>{status}</span></dd>
          <dt>{text('Last error', 'Último error')}</dt><dd>{diagnostics.lastError || text('None', 'Ninguno')}</dd>
        </dl>
        <div className="diagnostics-note"><ShieldCheck size={15} /><span>{text('Diagnostics never include passwords, private keys, or terminal content.', 'El diagnóstico no incluye contraseñas, claves privadas ni contenido de la terminal.')}</span></div>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>{text('Close', 'Cerrar')}</button><button className="primary-button" onClick={() => void copy()}><ClipboardCopy size={14} />{copied ? text('Copied', 'Copiado') : text('Copy diagnostics', 'Copiar diagnóstico')}</button></div>
      </section>
    </div>
  )
}

export function App() {
  const { language, setLanguage, text, error: localizeError } = useI18n()
  const { themeId, setThemeId } = useTheme()
  const statusLabels: Record<SessionStatus, string> = {
    idle: text('Not connected', 'Sin conexión'),
    connecting: text('Connecting…', 'Conectando…'),
    connected: text('Active session', 'Sesión activa'),
    disconnected: text('Disconnected', 'Desconectado'),
    error: text('Error', 'Error'),
  }
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(loadProfiles)
  const [localProfile, setLocalProfile] = useState<ConnectionProfile>(() => ({
    ...DEFAULT_LOCAL_PROFILE,
    name: text('Local terminal', 'Terminal local'),
    group: text('This Mac', 'Esta Mac'),
  }))
  const [localHomeDirectory, setLocalHomeDirectory] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(() => loadProfiles()[0]?.id ?? LOCAL_PROFILE_ID)
  const [mainView, setMainView] = useState<MainView>('home')
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentConnections)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(stored) ? Math.min(Math.max(stored, 180), 420) : 270
  })
  const [riverBannerHeight, setRiverBannerHeight] = useState(() => {
    const storedValue = localStorage.getItem(RIVER_BANNER_HEIGHT_KEY)
    const stored = storedValue === null ? Number.NaN : Number(storedValue)
    return Number.isFinite(stored)
      ? Math.min(Math.max(stored, RIVER_BANNER_MIN_HEIGHT), RIVER_BANNER_MAX_HEIGHT)
      : RIVER_BANNER_DEFAULT_HEIGHT
  })
  const [utilityPanelWidth, setUtilityPanelWidth] = useState(480)
  const [editorWidth, setEditorWidth] = useState(58)
  const [editorHeight, setEditorHeight] = useState(63)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(loadProfiles().map((profile) => profile.group)))
  const [localGroupCollapsed, setLocalGroupCollapsed] = useState(false)
  const [activeTool, setActiveTool] = useState<ToolPanel>(null)
  const [editorPanels, setEditorPanels] = useState<EditorPanel[]>([])
  const [editorStates, setEditorStates] = useState<Record<string, EditorState>>({})
  const [sftpStart, setSftpStart] = useState<{ sessionId: string; directory: string | null } | null>(null)
  const [directoryHelp, setDirectoryHelp] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [profileModalMode, setProfileModalMode] = useState<ProfileModalMode>('create')
  const [identityRequiredProfileId, setIdentityRequiredProfileId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<SshDiagnostics | null>(null)
  const [sessions, setSessions] = useState<SshSessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState<SplitMode>(0)
  const [tabsOverflowing, setTabsOverflowing] = useState(false)
  const [tabsMenuOpen, setTabsMenuOpen] = useState(false)
  const [sessionPreview, setSessionPreview] = useState<SessionPreview | null>(null)
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const [tabDropTarget, setTabDropTarget] = useState<TabDropTarget | null>(null)
  const terminalRefs = useRef<Map<string, TerminalHandle>>(new Map())
  const latestDirectories = useRef<Map<string, string>>(new Map())
  const sessionTabsRef = useRef<HTMLDivElement>(null)
  const tabsMenuRef = useRef<HTMLDivElement>(null)
  const riverBannerLastPointerDownRef = useRef(0)
  const previewTimerRef = useRef<number | null>(null)
  const tabPointerDragRef = useRef<TabPointerDrag | null>(null)
  const suppressedTabClickRef = useRef<string | null>(null)

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
      const next = { ...DEFAULT_LOCAL_PROFILE, name: text('Local terminal', 'Terminal local'), group: machine.name, username: machine.username }
      setLocalProfile(next)
      setLocalHomeDirectory(machine.homeDirectory)
      setSessions((current) => current.map((session) => session.profile.id === LOCAL_PROFILE_ID ? { ...session, profile: next } : session))
    }).catch(() => {})
  }, [language, text])

  useEffect(() => {
    const name = text('Local terminal', 'Terminal local')
    const fallbackGroup = text('This Mac', 'Esta Mac')
    setLocalProfile((current) => ({
      ...current,
      name,
      group: current.group === 'This Mac' || current.group === 'Esta Mac' ? fallbackGroup : current.group,
    }))
    setSessions((current) => current.map((session) => session.profile.id === LOCAL_PROFILE_ID ? {
      ...session,
      profile: {
        ...session.profile,
        name,
        group: session.profile.group === 'This Mac' || session.profile.group === 'Esta Mac' ? fallbackGroup : session.profile.group,
      },
    } : session))
  }, [language, text])

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
    localStorage.setItem(RIVER_BANNER_HEIGHT_KEY, String(riverBannerHeight))
  }, [riverBannerHeight])

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
    if (activeTool && (!activeSession || activeSession.profile.kind === 'local'
      || (activeTool === 'sftp' && activeSession.status !== 'connected')
      || (activeTool === 'editor' && !editorPanels.some((panel) => panel.sessionId === activeSessionId)))) setActiveTool(null)
  }, [activeSession?.profile.kind, activeSession?.status, activeSessionId, activeTool, editorPanels])

  useEffect(() => {
    window.conexum?.editor.setState({
      dirty: editorPanels.some((panel) => editorStates[panel.sessionId]?.dirty),
      saving: editorPanels.some((panel) => editorStates[panel.sessionId]?.saving),
    })
  }, [editorPanels, editorStates])

  const updateEditorState = useCallback((sessionId: string, state: EditorState) => {
    setEditorStates((current) => current[sessionId]?.dirty === state.dirty && current[sessionId]?.saving === state.saving
      ? current
      : { ...current, [sessionId]: state })
  }, [])

  const closeEditor = useCallback((sessionId: string, state: EditorState) => {
    if (state.saving) { window.alert(text('Wait for the remote save to finish before closing the editor.', 'Esperá a que termine el guardado remoto antes de cerrar el editor.')); return }
    if (state.dirty && !window.confirm(text('The editor has unsaved changes. Close it and discard them?', 'Hay cambios sin guardar en el editor. ¿Cerrarlo y descartarlos?'))) return
    setEditorPanels((current) => current.filter((panel) => panel.sessionId !== sessionId))
    setEditorStates((current) => {
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    setActiveTool(null)
  }, [text])

  useEffect(() => {
    if (splitMode && sessions.length < 2) setSplitMode(0)
  }, [sessions.length, splitMode])

  useEffect(() => {
    const tabs = sessionTabsRef.current
    if (!tabs) return
    const update = () => setTabsOverflowing(tabs.scrollWidth > tabs.clientWidth + 2)
    const observer = new ResizeObserver(update)
    observer.observe(tabs)
    const frame = window.requestAnimationFrame(update)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [sessions.length])

  useEffect(() => {
    if (mainView !== 'terminal' || !activeSessionId) return
    const frame = window.requestAnimationFrame(() => {
      sessionTabsRef.current?.querySelector<HTMLElement>(`[data-session-id="${activeSessionId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSessionId, mainView, sessions.length])

  useEffect(() => {
    if (!tabsMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!tabsMenuRef.current?.contains(event.target as Node)) setTabsMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [tabsMenuOpen])

  useEffect(() => {
    if (!tabsOverflowing) setTabsMenuOpen(false)
  }, [tabsOverflowing])

  useEffect(() => () => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
  }, [])

  const openNewProfile = () => {
    setEditingProfile(null)
    setProfileModalMode('create')
    setIdentityRequiredProfileId(null)
    setModalOpen(true)
  }

  const openProfileEditor = (profile: ConnectionProfile, identityRequired = false) => {
    setSelectedId(profile.id)
    setEditingProfile(profile)
    setProfileModalMode('edit')
    setIdentityRequiredProfileId(identityRequired ? profile.id : null)
    setModalOpen(true)
    setContextMenu(null)
  }

  const duplicateProfile = (profile: ConnectionProfile) => {
    setEditingProfile({
      ...profile,
      id: crypto.randomUUID(),
      name: text(`${profile.name} copy`, `${profile.name} copia`),
    })
    setProfileModalMode('duplicate')
    setIdentityRequiredProfileId(null)
    setModalOpen(true)
    setContextMenu(null)
  }

  const handleIdentityNeeded = useCallback((profile: ConnectionProfile) => {
    setSelectedId(profile.id)
    setEditingProfile(profile)
    setProfileModalMode('edit')
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
    setProfileModalMode('create')
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
    setActiveTool(null)
    setSidebarOverlayOpen(false)
    setRecentIds((current) => [profile.id, ...current.filter((id) => id !== profile.id)].slice(0, 8))
  }

  const showHome = () => {
    setMainView('home')
    setActiveTool(null)
    setTabsMenuOpen(false)
  }

  const activateSession = (session: SshSessionTab) => {
    if (activeTool === 'editor' && activeSessionId !== session.id) setActiveTool(editorPanels.some((panel) => panel.sessionId === session.id) ? 'editor' : null)
    if (activeTool === 'sftp' && activeSessionId !== session.id) {
      const directory = latestDirectories.current.get(session.id) ?? session.currentDirectory
      if (directory && session.profile.kind !== 'local') setSftpStart({ sessionId: session.id, directory })
      else setActiveTool(null)
    }
    setActiveSessionId(session.id)
    setSelectedId(session.profile.id)
    setMainView('terminal')
    setTabsMenuOpen(false)
    setSessionPreview(null)
  }

  const scheduleSessionPreview = (event: React.MouseEvent, sessionId: string) => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
    const bounds = event.currentTarget.getBoundingClientRect()
    previewTimerRef.current = window.setTimeout(() => {
      setSessionPreview({ sessionId, left: Math.max(12, Math.min(bounds.left, window.innerWidth - 282)), top: bounds.bottom + 8 })
    }, 450)
  }

  const hideSessionPreview = () => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = null
    setSessionPreview(null)
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

  const reconnectSession = (session: SshSessionTab) => {
    activateSession(session)
    void terminalRefs.current.get(session.id)?.connect(session.profile, { preserveHistory: true })
  }

  const reorderSession = (sourceId: string, targetId: string, position: TabDropTarget['position']) => {
    if (sourceId === targetId) return
    setSessions((current) => {
      const source = current.find((session) => session.id === sourceId)
      if (!source) return current
      const remaining = current.filter((session) => session.id !== sourceId)
      const targetIndex = remaining.findIndex((session) => session.id === targetId)
      if (targetIndex < 0) return current
      remaining.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source)
      return remaining
    })
  }

  const finishTabDrag = () => {
    setDraggedSessionId(null)
    setTabDropTarget(null)
  }

  const startTabPointerDrag = (event: React.PointerEvent<HTMLButtonElement>, sourceId: string) => {
    if (event.button !== 0) return
    tabPointerDragRef.current = { sourceId, pointerId: event.pointerId, startX: event.clientX, moved: false, target: null }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveTabPointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = tabPointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 6) return
    event.preventDefault()
    if (!drag.moved) {
      drag.moved = true
      setDraggedSessionId(drag.sourceId)
      hideSessionPreview()
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-session-id]')
    const targetId = target?.dataset.sessionId
    if (!target || !targetId || targetId === drag.sourceId) {
      drag.target = null
      setTabDropTarget(null)
      return
    }
    const bounds = target.getBoundingClientRect()
    drag.target = { sessionId: targetId, position: event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after' }
    setTabDropTarget(drag.target)
  }

  const endTabPointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = tabPointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      event.preventDefault()
      suppressedTabClickRef.current = drag.sourceId
      if (drag.target) reorderSession(drag.sourceId, drag.target.sessionId, drag.target.position)
    }
    tabPointerDragRef.current = null
    finishTabDrag()
  }

  const cancelTabPointerDrag = () => {
    tabPointerDragRef.current = null
    finishTabDrag()
  }

  const closeSessionTab = (session: SshSessionTab) => {
    const editorState = editorStates[session.id]
    if (editorState?.saving) { window.alert(text('Wait for the remote save to finish before closing this session.', 'Esperá a que termine el guardado remoto antes de cerrar esta sesión.')); return }
    const active = session.status === 'connected' || session.status === 'connecting'
    const message = (active
      ? text(`Close the ${session.profile.name} tab and end this active session?`, `¿Cerrar la pestaña de ${session.profile.name} y finalizar esta sesión activa?`)
      : text(`Close the ${session.profile.name} tab?`, `¿Cerrar la pestaña de ${session.profile.name}?`)) + (editorState?.dirty ? text(' Unsaved editor changes will be lost.', ' Se perderán los cambios sin guardar del editor.') : '')
    if (!window.confirm(message)) return
    if (active) terminalRefs.current.get(session.id)?.disconnect()

    const closingIndex = sessions.findIndex((item) => item.id === session.id)
    const remaining = sessions.filter((item) => item.id !== session.id)
    setSessions(remaining)
    terminalRefs.current.delete(session.id)
    latestDirectories.current.delete(session.id)
    setEditorPanels((current) => current.filter((panel) => panel.sessionId !== session.id))
    setEditorStates((current) => {
      const next = { ...current }
      delete next[session.id]
      return next
    })
    if (activeSessionId === session.id && activeTool === 'editor') setActiveTool(null)
    if (directoryHelp === session.id) setDirectoryHelp(null)

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
    const value = window.prompt(text('New group name:', 'Nuevo nombre del grupo:'), group)?.trim()
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
    const detail = activeCount ? text(
      ` The ${activeCount} open tab${activeCount === 1 ? '' : 's'} will keep running until you close ${activeCount === 1 ? 'it' : 'them'}.`,
      ` Las ${activeCount} pestaña${activeCount === 1 ? '' : 's'} abierta${activeCount === 1 ? '' : 's'} seguirá${activeCount === 1 ? '' : 'n'} funcionando hasta que la cierres.`,
    ) : ''
    if (!window.confirm(text(`Delete the “${group}” group and its ${groupProfiles.length} connections?${detail}`, `¿Eliminar el grupo “${group}” y sus ${groupProfiles.length} conexiones?${detail}`))) return
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
      if (destination) setSettingsMessage(text('Backup exported successfully.', 'Respaldo exportado correctamente.'))
    } catch (backupError) {
      setSettingsMessage(backupError instanceof Error ? localizeError(backupError.message.replace(/^Error invoking remote method '[^']+':\s*/, '')) : text('Could not export the backup.', 'No se pudo exportar el respaldo.'))
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
      setSettingsMessage(text(`${additions.length} ${additions.length === 1 ? 'connection' : 'connections'} imported.`, `${additions.length} ${additions.length === 1 ? 'conexión importada' : 'conexiones importadas'}.`))
    } catch (backupError) {
      setSettingsMessage(backupError instanceof Error ? localizeError(backupError.message.replace(/^Error invoking remote method '[^']+':\s*/, '')) : text('Could not import the backup.', 'No se pudo importar el respaldo.'))
    }
  }

  const openDiagnostics = async () => {
    if (!activeSession || !window.conexum) return
    const result = await window.conexum.ssh.getDiagnostics(activeSession.id)
    if (result) setDiagnostics(result)
    setSettingsOpen(false)
  }

  const directoryForSession = (session: SshSessionTab) => latestDirectories.current.get(session.id) ?? session.currentDirectory

  const openEditor = (remotePath?: string, directoryOverride?: string | null) => {
    if (!activeSession || activeSession.status !== 'connected' || activeSession.profile.kind === 'local' || !window.conexum) return
    const sessionId = activeSession.id
    const initialDirectory = remotePath ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/' : directoryOverride === undefined ? directoryForSession(activeSession) : directoryOverride
    setEditorPanels((current) => {
      const existing = current.find((panel) => panel.sessionId === sessionId)
      const requestId = (existing?.request.requestId ?? 0) + 1
      const next = { sessionId, profileName: activeSession.profile.name, request: { requestId, initialDirectory, ...(remotePath ? { remotePath } : {}) } }
      return existing ? current.map((panel) => panel.sessionId === sessionId ? next : panel) : [...current, next]
    })
    setMainView('terminal')
    setActiveTool('editor')
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
    openSftpAt(directoryForSession(activeSession))
  }

  const requestEditor = () => {
    if (!activeSession || activeSession.profile.kind === 'local') return
    if (activeTool === 'editor') { setActiveTool(null); return }
    if (activeSession.status !== 'connected') {
      if (editorPanels.some((panel) => panel.sessionId === activeSession.id)) setActiveTool('editor')
      return
    }
    openEditor(undefined, directoryForSession(activeSession))
  }

  const startEditorResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const row = event.currentTarget.parentElement
    if (!row) return
    const vertical = window.matchMedia('(max-width: 1050px)').matches
    const startPosition = vertical ? event.clientY : event.clientX
    const startExtent = vertical ? editorHeight : editorWidth
    const rowExtent = vertical ? row.getBoundingClientRect().height : row.getBoundingClientRect().width
    const move = (moveEvent: PointerEvent) => {
      const position = vertical ? moveEvent.clientY : moveEvent.clientX
      const next = Math.min(Math.max(startExtent + (position - startPosition) / rowExtent * 100, 35), 75)
      if (vertical) setEditorHeight(next)
      else setEditorWidth(next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
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

  const startRiverBannerResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const now = performance.now()
    if (now - riverBannerLastPointerDownRef.current < 400) {
      riverBannerLastPointerDownRef.current = 0
      setRiverBannerHeight(RIVER_BANNER_DEFAULT_HEIGHT)
      return
    }
    riverBannerLastPointerDownRef.current = now
    const startY = event.clientY
    const startHeight = riverBannerHeight
    const move = (moveEvent: PointerEvent) => setRiverBannerHeight(Math.min(Math.max(
      startHeight + moveEvent.clientY - startY,
      RIVER_BANNER_MIN_HEIGHT,
    ), RIVER_BANNER_MAX_HEIGHT))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const resizeRiverBannerWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 12 : 4
    let nextHeight: number | null = null
    if (event.key === 'ArrowUp') nextHeight = riverBannerHeight - step
    if (event.key === 'ArrowDown') nextHeight = riverBannerHeight + step
    if (event.key === 'Home') nextHeight = RIVER_BANNER_MIN_HEIGHT
    if (event.key === 'End') nextHeight = RIVER_BANNER_MAX_HEIGHT
    if (nextHeight === null) return
    event.preventDefault()
    setRiverBannerHeight(Math.min(Math.max(nextHeight, RIVER_BANNER_MIN_HEIGHT), RIVER_BANNER_MAX_HEIGHT))
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

  const connectionsSidebar = (overlay = false) => (
    <aside className={`sidebar ${overlay ? 'sidebar-overlay' : ''}`} aria-label={text('Connections', 'Conexiones')}>
      <div className="sidebar-heading">
        <span>{text('CONNECTIONS', 'CONEXIONES')}</span>
        <div className="sidebar-heading-actions">
          {overlay && <button className="icon-button subtle" onClick={() => { setSidebarOpen(true); setSidebarOverlayOpen(false) }} aria-label={text('Keep connections panel open', 'Mantener abierto el panel de conexiones')} title={text('Keep panel open', 'Mantener panel abierto')}><Pin size={15} /></button>}
          <button className="icon-button subtle" onClick={() => overlay ? setSidebarOverlayOpen(false) : setSidebarOpen(false)} aria-label={text('Hide connections', 'Ocultar conexiones')}><PanelLeftClose size={17} /></button>
        </div>
      </div>
      <label className="search-box"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={text('Search connections…', 'Buscar conexiones…')} /></label>
      <div className="connection-tree">
        {showLocalProfile && <div className="connection-group local-group">
          <button className="group-title" aria-expanded={!localGroupCollapsed} onClick={() => setLocalGroupCollapsed((current) => !current)}>
            <ChevronDown size={13} className={`folder-chevron ${localGroupCollapsed ? 'collapsed' : ''}`} /><Monitor size={14} /><span>{localProfile.group}</span><small>1</small>
          </button>
          {!localGroupCollapsed && <button className={`connection-row ${selectedId === LOCAL_PROFILE_ID ? 'selected' : ''}`} onClick={() => setSelectedId(LOCAL_PROFILE_ID)} onDoubleClick={() => openSession(localProfile)} title={text('Double-click to open a terminal on this Mac', 'Doble clic para abrir una terminal de esta Mac')}>
            <SquareTerminal size={15} className="server-icon" /><span className={`status-dot ${sessions.some((session) => session.profile.id === LOCAL_PROFILE_ID && session.status === 'connected') ? 'online' : ''}`} /><span>{localProfile.name}</span>
          </button>}
        </div>}
        {groupedProfiles.length === 0 && !showLocalProfile && <div className="empty-connections"><Search size={22} /><strong>{text('No results', 'Sin resultados')}</strong></div>}
        {groupedProfiles.map(([group, connections]) => (
          <div className="connection-group" key={group}>
            <button className="group-title" aria-expanded={!collapsedGroups.has(group)} onClick={() => toggleGroup(group)} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, kind: 'group', group }) }} title={text('Right-click to rename or delete the group', 'Clic derecho para renombrar o eliminar el grupo')}>
              <ChevronDown size={13} className={`folder-chevron ${collapsedGroups.has(group) ? 'collapsed' : ''}`} /><Folder size={14} /><span>{group}</span><small>{connections.length}</small>
            </button>
            {!collapsedGroups.has(group) && connections.map((connection) => (
              <button key={connection.id} className={`connection-row ${selectedId === connection.id ? 'selected' : ''}`} onClick={() => setSelectedId(connection.id)} onDoubleClick={() => openSession(connection)} onContextMenu={(event) => { event.preventDefault(); setSelectedId(connection.id); setContextMenu({ x: event.clientX, y: event.clientY, kind: 'profile', profileId: connection.id }) }} title={text('Double-click to open another session · Right-click for actions', 'Doble clic para abrir otra sesión · Clic derecho para ver acciones')}>
                <Server size={15} className="server-icon" /><span className={`status-dot ${sessions.some((session) => session.profile.id === connection.id && session.status === 'connected') ? 'online' : ''}`} /><span>{connection.name}</span>{connection.identityFile || connection.sshAlias ? <KeyRound size={13} className="key-indicator" aria-label={text('Uses an SSH key', 'Usa clave SSH')} /> : selectedId === connection.id && <MoreHorizontal size={15} className="more" />}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-actions">
        <button className="import-connections" onClick={importSshConfig} title={text('Import SSH config', 'Importar SSH config')} aria-label={text('Import SSH config', 'Importar SSH config')}><Import size={13} />{text('Import', 'Importar')}</button>
        <button className="add-connection" onClick={openNewProfile} title={text('Add SSH connection', 'Agregar conexión SSH')} aria-label={text('Add SSH connection', 'Agregar conexión SSH')}><Plus size={13} />{text('Add', 'Agregar')}</button>
      </div>
    </aside>
  )

  const activeDirectory = activeSession?.currentDirectory
    ? compactDirectory(activeSession.currentDirectory, activeSession.profile.username)
    : null
  const telemetryStale = Boolean(activeSession?.telemetry && Date.now() - activeSession.telemetry.updatedAt > 25_000)
  const previewedSession = sessionPreview ? sessions.find((session) => session.id === sessionPreview.sessionId) ?? null : null

  return (
    <main className="app-shell">
      <header className="titlebar" style={themeId === '912' ? { '--river-banner-height': `${riverBannerHeight}px` } as CSSProperties : undefined}>
        {themeId === '912' && <><img className="theme-river-titlebar-photo" src={THEME_912_BANNER} alt="" aria-hidden="true" /><span className="theme-river-titlebar-overlay" aria-hidden="true" /></>}
        <button className={`brand ${mainView === 'home' ? 'active' : ''}`} onClick={showHome} aria-label={text('Home', 'Inicio')} title={text('Home', 'Inicio')}><img className="brand-logo" src={BRAND_ICON} alt="" /><span>Conexum</span></button>
        <button className={`header-sidebar-toggle ${sidebarOpen || sidebarOverlayOpen ? 'active' : ''}`} onClick={() => sidebarOpen ? setSidebarOpen(false) : setSidebarOverlayOpen((current) => !current)} aria-label={sidebarOpen || sidebarOverlayOpen ? text('Hide connections', 'Ocultar conexiones') : text('Show connections', 'Mostrar conexiones')} title={text('Connections', 'Conexiones')}>{sidebarOpen || sidebarOverlayOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button>
        <div className="session-tabs-region">
          <div className="session-tabs-scroll" ref={sessionTabsRef} role="tablist" aria-label={text('Open sessions', 'Sesiones abiertas')}>
            {sessions.map((session) => {
              const sameProfileSessions = sessions.filter((item) => item.profile.id === session.profile.id)
              const ordinal = sameProfileSessions.findIndex((item) => item.id === session.id) + 1
              const active = mainView === 'terminal' && activeSessionId === session.id
              return (
                <div
                  key={session.id}
                  data-session-id={session.id}
                  className={`session-tab ${active ? 'active' : ''} ${draggedSessionId === session.id ? 'dragging' : ''} ${tabDropTarget?.sessionId === session.id ? `drop-${tabDropTarget.position}` : ''}`}
                  onMouseEnter={(event) => scheduleSessionPreview(event, session.id)}
                  onMouseLeave={hideSessionPreview}
                >
                  <button className="session-tab-main" role="tab" aria-selected={active} onPointerDown={(event) => startTabPointerDrag(event, session.id)} onPointerMove={moveTabPointerDrag} onPointerUp={endTabPointerDrag} onPointerCancel={cancelTabPointerDrag} onClick={() => { if (suppressedTabClickRef.current === session.id) { suppressedTabClickRef.current = null; return }; activateSession(session) }} onDoubleClick={(event) => { event.stopPropagation(); hideSessionPreview(); closeSessionTab(session) }} title={`${session.profile.kind === 'local' ? text('This Mac’s terminal', 'Terminal de esta Mac') : `${session.profile.username}@${session.profile.host}:${session.profile.port}`} · ${text('Double-click to close', 'Doble clic para cerrar')}`}>
                    {session.profile.kind === 'local' ? <Monitor size={14} /> : <SquareTerminal size={14} />}<span className="tab-title">{session.profile.name}</span>{sameProfileSessions.length > 1 && <small>#{ordinal}</small>}<i className={`status-dot ${session.status === 'connected' ? 'online' : ''}`} />
                  </button>
                  {(session.status === 'disconnected' || session.status === 'error') && <button className="session-tab-reconnect" onClick={(event) => { event.stopPropagation(); hideSessionPreview(); reconnectSession(session) }} aria-label={text(`Reconnect ${session.profile.name}`, `Reconectar ${session.profile.name}`)} title={text('Reconnect session', 'Reconectar sesión')}>R</button>}
                  <button className="session-tab-close" onClick={() => { hideSessionPreview(); closeSessionTab(session) }} aria-label={text(`Close ${session.profile.name}`, `Cerrar ${session.profile.name}`)} title={text('Close session', 'Cerrar sesión')}><X size={12} /></button>
                </div>
              )
            })}
          </div>
        </div>
        {tabsOverflowing && <div className="tabs-overflow" ref={tabsMenuRef}>
          <button className={`tabs-overflow-trigger ${tabsMenuOpen ? 'active' : ''}`} onClick={() => setTabsMenuOpen((current) => !current)} aria-expanded={tabsMenuOpen} aria-label={text('Show all sessions', 'Mostrar todas las sesiones')} title={text('All sessions', 'Todas las sesiones')}><MoreHorizontal size={16} /></button>
          {tabsMenuOpen && <div className="tabs-overflow-menu">
            {sessions.map((session) => {
              const matches = sessions.filter((item) => item.profile.id === session.profile.id)
              const ordinal = matches.findIndex((item) => item.id === session.id) + 1
              return <div key={session.id} className={`${mainView === 'terminal' && activeSessionId === session.id ? 'active' : ''} ${session.status === 'disconnected' || session.status === 'error' ? 'can-reconnect' : ''}`}>
                <button onClick={() => activateSession(session)}>{session.profile.kind === 'local' ? <Monitor size={14} /> : <SquareTerminal size={14} />}<span>{session.profile.name}{matches.length > 1 ? ` #${ordinal}` : ''}</span><i className={`status-dot ${session.status === 'connected' ? 'online' : ''}`} /></button>
                {(session.status === 'disconnected' || session.status === 'error') && <button className="overflow-reconnect" onClick={() => reconnectSession(session)} aria-label={text(`Reconnect ${session.profile.name}`, `Reconectar ${session.profile.name}`)} title={text('Reconnect session', 'Reconectar sesión')}>R</button>}
                <button className="overflow-close" onClick={() => closeSessionTab(session)} aria-label={text(`Close ${session.profile.name}`, `Cerrar ${session.profile.name}`)}><X size={12} /></button>
              </div>
            })}
          </div>}
        </div>}
        <nav className="toolbar" aria-label={text('Main tools', 'Herramientas principales')}>
          <ToolButton icon={<Plus size={16} />} label={text('New connection', 'Nueva conexión')} onClick={openNewProfile} />
          <ToolButton
            icon={mainView === 'terminal' && activeSession && (activeSession.status === 'connected' || activeSession.status === 'connecting') ? <Square size={14} /> : <Play size={15} />}
            label={mainView === 'terminal' && activeSession && (activeSession.status === 'connected' || activeSession.status === 'connecting') ? text('Disconnect', 'Desconectar') : mainView === 'terminal' && activeSession ? text('Reconnect', 'Reconectar') : text('Connect', 'Conectar')}
            disabled={mainView === 'terminal' ? !activeSession : !selected}
            accent
            onClick={connectOrDisconnect}
          />
          <ToolButton icon={splitMode === 2 ? <LayoutGrid size={16} /> : <Columns2 size={16} />} label={splitMode === 4 ? text('Single view', 'Vista única') : splitMode === 2 ? text('4-pane grid', 'Cuadrícula 4') : text('Split', 'Dividir')} disabled={sessions.length < 2} active={splitMode !== 0} onClick={cycleSplitMode} />
          <span className="toolbar-separator" aria-hidden="true" />
          <ToolButton icon={<FolderOpen size={16} />} label={activeSession?.profile.kind === 'local' ? text('SFTP is only available for SSH sessions', 'SFTP sólo para sesiones SSH') : 'SFTP'} active={activeTool === 'sftp'} disabled={!activeSession || activeSession.status !== 'connected' || activeSession.profile.kind === 'local'} onClick={requestSftp} />
          <ToolButton icon={<FileCode2 size={16} />} label={activeSession?.profile.kind === 'local' ? text('The remote editor is only available for SSH sessions', 'Editor remoto sólo para sesiones SSH') : text('Editor', 'Editor')} active={activeTool === 'editor'} disabled={!activeSession || activeSession.profile.kind === 'local' || (activeSession.status !== 'connected' && !editorPanels.some((panel) => panel.sessionId === activeSession.id))} onClick={requestEditor} />
          <div className="settings-wrapper">
            <button className="icon-button" aria-label={text('Settings', 'Ajustes')} title={text('Settings', 'Ajustes')} aria-expanded={settingsOpen} onClick={() => { setSettingsOpen((current) => !current); setSettingsMessage(null) }}><Settings2 size={17} /></button>
            {settingsOpen && <div className="settings-menu">
              <label className="settings-language"><Languages size={14} /><span><strong>{text('Language', 'Idioma')}</strong><small>{text('Interface language', 'Idioma de la interfaz')}</small></span><select value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'es')} aria-label={text('Language', 'Idioma')}><option value="en">English</option><option value="es">Español</option></select></label>
              <label className="settings-theme"><Palette size={14} /><span><strong>{text('Theme', 'Tema')}</strong><small>{text('App, terminal, and editor', 'Aplicación, terminal y editor')}</small></span><select value={themeId} onChange={(event) => setThemeId(event.target.value as keyof typeof themes)} aria-label={text('Theme', 'Tema')}><option value="conexum-dark">Conexum Dark</option><option value="midnight-blue">Midnight Blue</option><option value="graphite">Graphite</option><option value="912">River Plate</option></select></label>
              <i />
              <button onClick={() => void exportBackup()}><FileDown size={14} /><span><strong>{text('Export connections', 'Exportar conexiones')}</strong><small>{text('No secrets or private keys', 'Sin secretos ni claves privadas')}</small></span></button>
              <button onClick={() => void importBackup()}><FileUp size={14} /><span><strong>{text('Import connections', 'Importar conexiones')}</strong><small>{text('From a Conexum backup', 'Desde un respaldo de Conexum')}</small></span></button>
              <i />
              <button disabled={!activeSession || activeSession.profile.kind === 'local'} onClick={() => void openDiagnostics()}><Stethoscope size={14} /><span><strong>{text('SSH diagnostics', 'Diagnóstico SSH')}</strong><small>{activeSession?.profile.kind === 'local' ? text('Not available for the local terminal', 'No aplica a la terminal local') : activeSession ? activeSession.profile.name : text('Open a session first', 'Abrí una sesión primero')}</small></span></button>
              {settingsMessage && <p>{settingsMessage}</p>}
            </div>}
          </div>
        </nav>
        {themeId === '912' && <button
          className="river-banner-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={text('Resize River Plate banner', 'Cambiar tamaño del banner River Plate')}
          aria-valuemin={RIVER_BANNER_MIN_HEIGHT}
          aria-valuemax={RIVER_BANNER_MAX_HEIGHT}
          aria-valuenow={Math.round(riverBannerHeight)}
          title={text('Drag to resize · Double-click to reset', 'Arrastrá para cambiar el tamaño · Doble clic para restablecer')}
          onPointerDown={startRiverBannerResize}
          onKeyDown={resizeRiverBannerWithKeyboard}
          onDoubleClick={() => setRiverBannerHeight(RIVER_BANNER_DEFAULT_HEIGHT)}
        />}
      </header>

      {previewedSession && sessionPreview && <div className="session-preview-card" style={{ left: sessionPreview.left, top: sessionPreview.top }}>
        <div><span className={`status-dot ${previewedSession.status === 'connected' ? 'online' : ''}`} /><strong>{previewedSession.profile.name}</strong><small>{statusLabels[previewedSession.status]}</small></div>
        <p>{previewedSession.profile.kind === 'local' ? previewedSession.profile.group : `${previewedSession.profile.username}@${previewedSession.profile.host}:${previewedSession.profile.port}`}</p>
        <footer><span>{previewedSession.currentDirectory ? compactDirectory(previewedSession.currentDirectory, previewedSession.profile.username) : text('Path unavailable', 'Ruta no disponible')}</span>{previewedSession.telemetry && <b>CPU {previewedSession.telemetry.cpuPercent ?? '—'}% · RAM {previewedSession.telemetry.memoryPercent}%</b>}</footer>
      </div>}

      <section className={`workspace ${sidebarOpen ? '' : 'sidebar-closed'}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
        {sidebarOpen && connectionsSidebar()}
        {!sidebarOpen && sidebarOverlayOpen && <button className="sidebar-overlay-scrim" onClick={() => setSidebarOverlayOpen(false)} aria-label={text('Close connections panel', 'Cerrar panel de conexiones')} />}
        {!sidebarOpen && sidebarOverlayOpen && connectionsSidebar(true)}

        {sidebarOpen && <button className="sidebar-resizer" aria-label={text('Resize connections panel', 'Cambiar ancho del panel de conexiones')} onPointerDown={startSidebarResize} onDoubleClick={() => setSidebarWidth(270)} />}

        <section className="main-area">
          <div className={`content-row ${activeTool === 'sftp' && mainView === 'terminal' ? 'panel-open' : ''} ${activeTool === 'editor' && mainView === 'terminal' ? 'editor-open' : ''}`} style={{ '--utility-width': `${utilityPanelWidth}px`, '--editor-width': `${editorWidth}%`, '--editor-height': `${editorHeight}%` } as CSSProperties}>
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
                    <button className="terminal-reconnect" onClick={(event) => { event.stopPropagation(); reconnectSession(session) }}>
                      <RefreshCw size={13} />{text('Reconnect', 'Reconectar')}
                    </button>
                  )}
                </div>
              })}
            </div>
            {mainView === 'terminal' && activeTool === 'sftp' && <button className="utility-resizer" aria-label={text('Resize tools panel', 'Cambiar ancho del panel de herramientas')} onPointerDown={startUtilityResize} onDoubleClick={() => setUtilityPanelWidth(480)} />}
            {mainView === 'terminal' && activeTool === 'sftp' && activeSession && (
              <SftpPanel key={activeSession.id} sessionId={activeSession.id} profileName={activeSession.profile.name} initialDirectory={sftpStart?.sessionId === activeSession.id ? sftpStart.directory : directoryForSession(activeSession)} onClose={() => setActiveTool(null)} onOpenEditor={openEditor} />
            )}
            {editorPanels.length > 0 && <div className={`editor-dock ${mainView === 'terminal' && activeTool === 'editor' ? 'visible' : ''}`}>
              {editorPanels.map((panel) => <div key={panel.sessionId} className={`editor-dock-layer ${mainView === 'terminal' && activeTool === 'editor' && activeSessionId === panel.sessionId ? 'visible' : ''}`}>
                <Suspense fallback={<div className="editor-loading">{text('Opening editor…', 'Abriendo editor…')}</div>}><EditorPane sessionId={panel.sessionId} profileName={panel.profileName} request={panel.request} visible={mainView === 'terminal' && activeTool === 'editor' && activeSessionId === panel.sessionId} connected={sessions.find((session) => session.id === panel.sessionId)?.status === 'connected'} onHide={() => setActiveTool(null)} onClose={closeEditor} onStateChange={updateEditorState} /></Suspense>
              </div>)}
            </div>}
            {mainView === 'terminal' && activeTool === 'editor' && <button className="editor-resizer" aria-label={text('Resize editor', 'Cambiar tamaño del editor')} onPointerDown={startEditorResize} onDoubleClick={() => { setEditorWidth(58); setEditorHeight(63) }} />}
          </div>

          <footer className="statusbar">
            <div className="status-left">
              <span className={`status-dot ${activeSessionCount > 0 ? 'online' : ''}`} />
              <span>{mainView === 'terminal' && activeSession ? statusLabels[activeSession.status] : activeSessionCount > 0 ? text(`${activeSessionCount} active ${activeSessionCount === 1 ? 'session' : 'sessions'}`, `${activeSessionCount} ${activeSessionCount === 1 ? 'sesión activa' : 'sesiones activas'}`) : text('Not connected', 'Sin conexión')}</span>
              <span className="divider" />
              <span>{mainView === 'terminal' && activeSession ? activeSession.profile.kind === 'local' ? activeSession.profile.group : `${activeSession.profile.username}@${activeSession.profile.host}` : selected ? selected.kind === 'local' ? selected.group : `${selected.username}@${selected.host}` : text('Select a connection', 'Seleccioná una conexión')}</span>
              {mainView === 'terminal' && activeSession?.status === 'connected' && (
                !activeDirectory && activeSession.profile.kind !== 'local'
                  ? <button className="session-directory unavailable directory-help-trigger" title={text('Enable remote directory tracking (optional)', 'Activar seguimiento de la carpeta remota (opcional)')} onClick={() => setDirectoryHelp(activeSession.id)}>{text('Path —', 'Ruta —')}</button>
                  : <span className={`session-directory ${activeDirectory ? '' : 'unavailable'}`} title={activeSession.currentDirectory ?? text('Local directory unavailable', 'Directorio local no disponible')}>{activeDirectory ?? text('Path —', 'Ruta —')}</span>
              )}
            </div>
            <div className={`status-right ${telemetryStale ? 'stale' : ''}`}>
              {themeId === '912' && <img className="theme-912-emblem" src={THEME_912_EMBLEM} alt="" aria-hidden="true" />}
              {mainView === 'terminal' && activeSession?.status === 'connected' && activeSession.profile.kind !== 'local' && (
                <>
                  <span title={text('Approximate server CPU usage', 'Uso aproximado de CPU del servidor')}>CPU {activeSession.telemetry?.cpuPercent ?? '—'}{activeSession.telemetry?.cpuPercent !== null && activeSession.telemetry?.cpuPercent !== undefined ? '%' : ''}</span>
                  <span title={text('Approximate server memory usage', 'Uso aproximado de memoria del servidor')}>RAM {activeSession.telemetry?.memoryPercent ?? '—'}{activeSession.telemetry ? '%' : ''}</span>
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
            <button onClick={() => openSession(profile)}><Play size={14} />{text('Open new session', 'Abrir nueva sesión')}</button>
            <button onClick={() => duplicateProfile(profile)}><Copy size={14} />{text('Duplicate…', 'Duplicar…')}</button>
            <button onClick={() => openProfileEditor(profile)}><Pencil size={14} />{text('Edit settings…', 'Editar configuración…')}</button>
          </div>
        )
      })()}
      {contextMenu && contextMenu.kind === 'group' && (
        <div className="server-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => renameGroup(contextMenu.group)}><Pencil size={14} />{text('Rename group…', 'Renombrar grupo…')}</button>
          <button className="danger-item" onClick={() => deleteGroup(contextMenu.group)}><Trash2 size={14} />{text('Delete group…', 'Eliminar grupo…')}</button>
        </div>
      )}
      {modalOpen && <ConnectionModal
        profile={editingProfile}
        mode={profileModalMode}
        identityRequired={Boolean(editingProfile && identityRequiredProfileId === editingProfile.id)}
        onClose={() => { setModalOpen(false); setEditingProfile(null); setProfileModalMode('create'); setIdentityRequiredProfileId(null) }}
        onSave={saveProfile}
      />}
      {diagnostics && <DiagnosticsModal diagnostics={diagnostics} onClose={() => setDiagnostics(null)} />}
      {directoryHelp && <ShellIntegrationHelp onClose={() => setDirectoryHelp(null)} />}
    </main>
  )
}
