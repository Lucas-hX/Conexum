import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, File, Folder, Home, LoaderCircle, RefreshCw, Save, X } from 'lucide-react'
import type { RemoteTextFile, SftpEntry } from './conexum'
import { useI18n } from './i18n'

loader.config({ monaco })

const BRAND_ICON = './brand/conexum-icon.png'

type EditorContext = {
  sessionId: string
}

export type EditorRequest = { requestId: number; initialDirectory: string | null; remotePath?: string }
type EditorPaneProps = EditorContext & {
  profileName: string
  request: EditorRequest
  visible: boolean
  connected: boolean
  onHide(): void
  onClose(sessionId: string, state: { dirty: boolean; saving: boolean }): void
  onStateChange(sessionId: string, state: { dirty: boolean; saving: boolean }): void
}

type DocumentTab = RemoteTextFile & {
  draft: string
  saving: boolean
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : fallback
}

function languageForPath(filePath: string) {
  const extension = filePath.split('.').pop()?.toLowerCase()
  return ({
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json',
    css: 'css', scss: 'scss', html: 'html', md: 'markdown', py: 'python', rb: 'ruby',
    php: 'php', go: 'go', rs: 'rust', sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', toml: 'ini', env: 'ini',
  } as Record<string, string>)[extension ?? ''] ?? 'plaintext'
}

function baseName(filePath: string) {
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath
}

function RemoteDirectory({ context, directory, depth, initiallyOpen = false, onOpenFile, selectedPath, onSelect }: {
  context: EditorContext
  directory: string
  depth: number
  initiallyOpen?: boolean
  onOpenFile(path: string): void
  selectedPath?: string | null
  onSelect?(path: string): void
}) {
  const { text, error: localizeError } = useI18n()
  const [open, setOpen] = useState(initiallyOpen)
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const api = window.conexum?.sftp
    if (!api) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await api.list(context.sessionId, directory)
      setEntries(result.entries.filter((entry) => !entry.hidden))
      setLoaded(true)
    } catch (directoryError) {
      setLoadError(localizeError(errorMessage(directoryError, text('The remote operation could not be completed.', 'No se pudo completar la operación remota.'))))
    } finally {
      setLoading(false)
    }
  }, [context.sessionId, directory])

  useEffect(() => {
    if (open && !loaded) void load()
  }, [load, loaded, open])

  const toggle = () => {
    setOpen((current) => !current)
  }

  return (
    <div className="editor-tree-directory">
      <button className="editor-tree-row directory" style={{ paddingLeft: 12 + depth * 16 }} onClick={toggle} title={directory}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Folder size={14} />
        <span>{depth === 0 ? baseName(directory) || '/' : baseName(directory)}</span>
        {loading && <LoaderCircle className="spin tree-loader" size={12} />}
      </button>
      {open && loadError && <div className="editor-tree-error" style={{ paddingLeft: 30 + depth * 16 }}>{loadError}</div>}
      {open && entries.map((entry) => entry.type === 'directory' ? (
        <RemoteDirectory key={entry.path} context={context} directory={entry.path} depth={depth + 1} onOpenFile={onOpenFile} selectedPath={selectedPath} onSelect={onSelect} />
      ) : (
        <button key={entry.path} className={`editor-tree-row file ${selectedPath === entry.path ? 'selected' : ''}`} style={{ paddingLeft: 29 + depth * 16 }} onDoubleClick={() => entry.type === 'file' && onOpenFile(entry.path)} onClick={() => onSelect?.(entry.path)} title={`${entry.path} · ${text('Double-click to open', 'Doble clic para abrir')}`}>
          <File size={13} /><span>{entry.name}</span>
        </button>
      ))}
    </div>
  )
}

export function EditorPane({ sessionId, profileName, request, visible, connected, onHide, onClose, onStateChange }: EditorPaneProps) {
  const { text, error: localizeError } = useI18n()
  const context = useMemo(() => ({ sessionId }), [sessionId])
  const [documents, setDocuments] = useState<DocumentTab[]>([])
  const documentsRef = useRef<DocumentTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [treeKey, setTreeKey] = useState(0)
  const [treeSelectedPath, setTreeSelectedPath] = useState<string | null>(null)
  const [rootDirectory, setRootDirectory] = useState<string | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const navigationId = useRef(0)
  const activeDocument = documents.find((document) => document.path === activePath) ?? null
  const dirty = documents.some((document) => document.draft !== document.content)
  const saving = documents.some((document) => document.saving)
  documentsRef.current = documents

  const openFile = useCallback(async (remotePath: string) => {
    if (!window.conexum) return
    const existing = documentsRef.current.find((document) => document.path === remotePath)
    if (existing) {
      setActivePath(remotePath)
      return
    }
    setLoadingPath(remotePath)
    setError(null)
    try {
      const file = await window.conexum.editor.readText(context.sessionId, remotePath)
      setDocuments((current) => current.some((document) => document.path === file.path) ? current : [...current, { ...file, draft: file.content, saving: false }])
      setActivePath(file.path)
    } catch (openError) {
      setError(localizeError(errorMessage(openError, text('The remote operation could not be completed.', 'No se pudo completar la operación remota.'))))
    } finally {
      setLoadingPath(null)
    }
  }, [sessionId])

  const navigateDirectory = useCallback(async (nextContext: EditorContext, directory: string | null, fallbackToHome = false) => {
    const requestId = ++navigationId.current
    const api = window.conexum?.sftp
    if (!api) return
    setError(null)
    try {
      let result
      try {
        result = await api.list(nextContext.sessionId, directory ?? undefined)
      } catch (initialError) {
        if (!fallbackToHome || !directory) throw initialError
        result = await api.list(nextContext.sessionId)
      }
      if (requestId !== navigationId.current) return
      setRootDirectory(result.directory)
      setPathDraft(result.directory)
      setTreeKey((current) => current + 1)
    } catch (directoryError) {
      if (requestId === navigationId.current) setError(localizeError(errorMessage(directoryError, text('The remote operation could not be completed.', 'No se pudo completar la operación remota.'))))
    }
  }, [])

  useEffect(() => {
    void navigateDirectory(context, request.initialDirectory, true)
    if (request.remotePath) void openFile(request.remotePath)
    return () => { navigationId.current++ }
  }, [context, navigateDirectory, openFile, request.requestId])

  useEffect(() => {
    onStateChange(sessionId, { dirty, saving })
  }, [dirty, onStateChange, saving, sessionId])

  const saveDocument = useCallback(async (documentToSave: DocumentTab) => {
    if (!window.conexum || documentToSave.saving || documentToSave.draft === documentToSave.content) return
    if (!connected) { setError(text('Reconnect the SSH session before saving. Your changes remain in the editor.', 'Reconectá la sesión SSH antes de guardar. Los cambios permanecen en el editor.')); return }
    const savedDraft = documentToSave.draft
    setDocuments((current) => current.map((document) => document.path === documentToSave.path ? { ...document, saving: true } : document))
    setError(null)
    try {
      const result = await window.conexum.editor.writeText({
        sessionId: context.sessionId,
        remotePath: documentToSave.path,
        content: savedDraft,
        baselineFingerprint: documentToSave.fingerprint,
      })
      if (result.conflict) {
        setDocuments((current) => current.map((document) => document.path === documentToSave.path ? { ...document, saving: false } : document))
        if (window.confirm(text('The file changed on the server after you opened it. Overwrite the remote version with your changes?', 'El archivo cambió en el servidor desde que lo abriste. ¿Sobrescribir la versión remota con tus cambios?'))) {
          await saveDocument({ ...documentToSave, saving: false, fingerprint: result.current.fingerprint })
        }
        return
      }
      setDocuments((current) => current.map((document) => document.path === documentToSave.path ? {
        ...document,
        content: savedDraft,
        fingerprint: result.file.fingerprint,
        size: result.file.size,
        modified: result.file.modified,
        permissions: result.file.permissions,
        saving: false,
      } : document))
    } catch (saveError) {
      setDocuments((current) => current.map((document) => document.path === documentToSave.path ? { ...document, saving: false } : document))
      setError(localizeError(errorMessage(saveError, text('The remote operation could not be completed.', 'No se pudo completar la operación remota.'))))
    }
  }, [connected, context])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (visible && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && activeDocument) {
        event.preventDefault()
        void saveDocument(activeDocument)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [activeDocument, saveDocument, visible])

  const closeDocument = (document: DocumentTab) => {
    if (document.saving) return
    if (document.draft !== document.content && !window.confirm(text(`Close ${document.name} without saving changes?`, `¿Cerrar ${document.name} sin guardar los cambios?`))) return
    setDocuments((current) => current.filter((item) => item.path !== document.path))
    if (activePath === document.path) {
      const index = documents.findIndex((item) => item.path === document.path)
      const remaining = documents.filter((item) => item.path !== document.path)
      setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null)
    }
  }

  const closeEditor = useCallback(() => onClose(sessionId, { dirty, saving }), [dirty, onClose, saving, sessionId])

  useEffect(() => {
    const closeWithShortcut = (event: KeyboardEvent) => {
      if (!visible || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'w') return
      event.preventDefault()
      event.stopPropagation()
      closeEditor()
    }
    window.addEventListener('keydown', closeWithShortcut, true)
    return () => window.removeEventListener('keydown', closeWithShortcut, true)
  }, [closeEditor, visible])

  const statusLanguage = activeDocument ? languageForPath(activeDocument.path) : 'plaintext'
  const emptyMessage = useMemo(() => loadingPath
    ? text(`Opening ${baseName(loadingPath)}…`, `Abriendo ${baseName(loadingPath)}…`)
    : text('Select a server file to get started.', 'Seleccioná un archivo del servidor para comenzar.'), [loadingPath, text])

  return (
    <main className="editor-shell editor-embedded">
      <header className="editor-titlebar">
        <button className="editor-return-button" type="button" onClick={onHide} title={text('Hide the editor and expand the terminal; open files are preserved', 'Ocultar editor y ampliar terminal; conserva los archivos abiertos')}><ArrowLeft size={14} /><span>{text('Full terminal', 'Terminal completa')}</span></button>
        <div className="editor-window-brand"><img src={BRAND_ICON} alt="" /><strong>Editor</strong><span>— {profileName}</span></div>
        <div className="editor-window-actions">
          <button className="editor-save-button" disabled={!connected || !activeDocument || activeDocument.draft === activeDocument.content || activeDocument.saving} onClick={() => activeDocument && void saveDocument(activeDocument)} aria-label={text('Save file', 'Guardar archivo')} title={connected ? text('Save file (⌘S)', 'Guardar archivo (⌘S)') : text('Reconnect the session to save', 'Reconectá la sesión para guardar')}><Save size={15} /></button>
          <button className="editor-close-button" onClick={closeEditor} aria-label={text('Close editor', 'Cerrar editor')} title={text('Close editor (⌘W)', 'Cerrar editor (⌘W)')}><X size={14} /></button>
        </div>
      </header>
      <section className="editor-workspace">
        <aside className="editor-explorer">
          <form className="editor-explorer-heading" onSubmit={(event) => { event.preventDefault(); if (context) void navigateDirectory(context, pathDraft.trim() || null) }}>
            <span className="editor-path-label">{text('EXPLORER', 'EXPLORADOR')}</span>
            <input value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setPathDraft(rootDirectory ?? '') }} placeholder={rootDirectory ? undefined : text('Loading folder…', 'Cargando carpeta…')} aria-label={text('Editor remote path', 'Ruta remota del editor')} title={text('Enter an absolute path and press Enter', 'Escribí una ruta absoluta y presioná Enter')} spellCheck={false} />
            <button className="editor-path-go" type="submit" aria-label={text('Go to entered path', 'Ir a la ruta escrita')} title={text('Go to path', 'Ir a la ruta')}><ArrowRight size={13} /></button>
            <button className="editor-path-home" type="button" onClick={() => void navigateDirectory(context, null)} aria-label={text('Go to remote home', 'Ir al home remoto')} title={text('Remote home', 'Home remoto')}><Home size={13} /></button>
            <button className="editor-path-refresh" type="button" disabled={!rootDirectory} onClick={() => setTreeKey((current) => current + 1)} aria-label={text('Refresh tree', 'Actualizar árbol')} title={text('Refresh tree', 'Actualizar árbol')}><RefreshCw size={13} /></button>
          </form>
          {rootDirectory && <div className="editor-tree"><RemoteDirectory key={`${rootDirectory}:${treeKey}`} context={context} directory={rootDirectory} depth={0} initiallyOpen onOpenFile={(filePath) => void openFile(filePath)} selectedPath={treeSelectedPath} onSelect={setTreeSelectedPath} /></div>}
        </aside>
        <section className="editor-main">
          <div className="editor-tabs">
            {documents.map((document) => (
              <div key={document.path} className={`editor-tab ${activePath === document.path ? 'active' : ''}`}>
                <button className="editor-tab-select" onClick={() => setActivePath(document.path)} title={document.path} aria-label={text(`Open ${document.name} tab`, `Abrir pestaña ${document.name}`)}>
                  <File size={12} /><span>{document.name}</span>{document.draft !== document.content && <i />}
                </button>
                <button className="editor-tab-close" disabled={document.saving} onClick={() => closeDocument(document)} aria-label={text(`Close ${document.name} tab`, `Cerrar pestaña ${document.name}`)} title={text('Close file', 'Cerrar archivo')}><X size={12} /></button>
              </div>
            ))}
          </div>
          {error && <div className="editor-error"><span>{error}</span><button onClick={() => setError(null)}><X size={13} /></button></div>}
          <div className="editor-canvas">
            {activeDocument ? (
              <Editor
                path={activeDocument.path}
                language={languageForPath(activeDocument.path)}
                value={activeDocument.draft}
                theme="conexum-dark"
                beforeMount={(instance) => instance.editor.defineTheme('conexum-dark', {
                  base: 'vs-dark',
                  inherit: true,
                  rules: [
                    { token: 'comment', foreground: '697783' },
                    { token: 'keyword', foreground: 'C990C0' },
                    { token: 'string', foreground: 'D9A568' },
                    { token: 'number', foreground: '7BC7B1' },
                    { token: 'type', foreground: '63B3ED' },
                  ],
                  colors: {
                    'editor.background': '#0b1015',
                    'editor.foreground': '#d7dfe7',
                    'editorLineNumber.foreground': '#53606b',
                    'editorLineNumber.activeForeground': '#9ba8b3',
                    'editor.lineHighlightBackground': '#348fce12',
                    'editor.selectionBackground': '#2a83bd55',
                    'editorCursor.foreground': '#79c7ff',
                    'editorIndentGuide.background1': '#26303a',
                    'editorIndentGuide.activeBackground1': '#4b5864',
                  },
                })}
                onChange={(value) => setDocuments((current) => current.map((document) => document.path === activeDocument.path ? { ...document, draft: value ?? '' } : document))}
                options={{
                  automaticLayout: true,
                  fontFamily: 'SFMono-Regular, Menlo, Monaco, monospace',
                  fontSize: 13,
                  lineHeight: 21,
                  minimap: { enabled: false },
                  padding: { top: 14, bottom: 20 },
                  smoothScrolling: true,
                  scrollBeyondLastLine: false,
                  renderWhitespace: 'selection',
                  wordWrap: 'off',
                  bracketPairColorization: { enabled: true },
                  guides: { indentation: true, bracketPairs: false },
                }}
              />
            ) : (
              <div className="editor-empty"><img src={BRAND_ICON} alt="" /><strong>{emptyMessage}</strong><span>{text('Double-click to open · ⌘S to save', 'Doble clic para abrir · ⌘S para guardar')}</span></div>
            )}
          </div>
        </section>
      </section>
      <footer className="editor-statusbar">
        <span><i className={connected ? '' : 'offline'} />{profileName}{connected ? '' : text(' · Offline', ' · Sin conexión')}</span>
        <div><span>UTF-8</span><span>{statusLanguage === 'plaintext' ? text('Text', 'Texto') : statusLanguage}</span><span>{activeDocument?.saving ? text('Saving…', 'Guardando…') : dirty ? text('Unsaved changes', 'Cambios sin guardar') : text('Saved', 'Guardado')}</span></div>
      </footer>
    </main>
  )
}

export default EditorPane
