import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderPlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { SftpEntry, SftpTransferProgress } from './conexum'

type Props = {
  sessionId: string
  profileName: string
  initialDirectory: string | null
  onClose(): void
}

function joinRemote(directory: string, name: string) {
  const base = directory === '/' ? '' : directory.replace(/\/+$/, '')
  return `${base}/${name}`
}

function parentRemote(directory: string) {
  if (directory === '/') return '/'
  const parts = directory.replace(/\/+$/, '').split('/')
  parts.pop()
  return parts.join('/') || '/'
}

function validRemoteName(name: string) {
  return name.length > 0 && name.length <= 255 && !/[\/\r\n\0]/.test(name) && name !== '.' && name !== '..'
}

function formatSize(size: number) {
  if (!Number.isFinite(size) || size < 0) return '—'
  if (size < 1_024) return `${size} B`
  if (size < 1_048_576) return `${(size / 1_024).toFixed(1)} KB`
  if (size < 1_073_741_824) return `${(size / 1_048_576).toFixed(1)} MB`
  return `${(size / 1_073_741_824).toFixed(1)} GB`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : 'La operación SFTP no pudo completarse.'
}

const transferStatusLabel: Record<SftpTransferProgress['status'], string> = {
  queued: 'en cola',
  active: 'activo',
  completed: 'listo',
  canceled: 'cancelado',
  error: 'error',
}

export function SftpPanel({ sessionId, profileName, initialDirectory, onClose }: Props) {
  const [directory, setDirectory] = useState(initialDirectory ?? '')
  const [pathDraft, setPathDraft] = useState(initialDirectory ?? '')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<SftpTransferProgress[]>([])
  const [transfersExpanded, setTransfersExpanded] = useState(false)
  const directoryRef = useRef(directory)
  const selected = entries.find((entry) => entry.path === selectedPath) ?? null

  const visibleEntries = useMemo(
    () => showHidden ? entries : entries.filter((entry) => !entry.hidden),
    [entries, showHidden],
  )

  useEffect(() => {
    directoryRef.current = directory
  }, [directory])

  const loadDirectory = useCallback(async (remotePath?: string) => {
    const api = window.conexum?.sftp
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.list(sessionId, remotePath)
      setDirectory(result.directory)
      setPathDraft(result.directory)
      setEntries(result.entries)
      setSelectedPath(null)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void loadDirectory(initialDirectory ?? undefined)
  }, [sessionId])

  useEffect(() => {
    const api = window.conexum?.sftp
    if (!api) return
    let mounted = true
    void api.transfers(sessionId).then((items) => {
      if (mounted) {
        setTransfers(items)
        setTransfersExpanded(items.some((item) => item.status === 'queued' || item.status === 'active'))
      }
    })
    const removeListener = api.onTransferProgress((progress) => {
      if (progress.sessionId !== sessionId) return
      if (progress.status === 'queued' || progress.status === 'active') setTransfersExpanded(true)
      setTransfers((current) => {
        const next = current.some((item) => item.transferId === progress.transferId)
          ? current.map((item) => item.transferId === progress.transferId ? progress : item)
          : [progress, ...current]
        return next.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 6)
      })
      if (progress.status === 'completed') void loadDirectory(directoryRef.current || undefined)
    })
    return () => {
      mounted = false
      removeListener()
    }
  }, [loadDirectory, sessionId])

  const enqueueUpload = async (file: { path: string; name: string }) => {
    const api = window.conexum?.sftp
    if (!api || !directory) return
    const remotePath = joinRemote(directory, file.name)
    if (entries.some((entry) => entry.name === file.name) && !window.confirm(`Ya existe ${file.name}. ¿Sobrescribirlo?`)) return
    try {
      await api.enqueueTransfer({ sessionId, direction: 'upload', localPath: file.path, remotePath, name: file.name })
    } catch (uploadError) {
      setError(errorMessage(uploadError))
    }
  }

  const chooseUpload = async () => {
    const file = await window.conexum?.sftp.chooseUpload()
    if (file) await enqueueUpload(file)
  }

  const downloadSelected = async () => {
    const api = window.conexum?.sftp
    if (!api || !selected || selected.type === 'directory') return
    const localPath = await api.chooseDownload(selected.name)
    if (!localPath) return
    try {
      await api.enqueueTransfer({ sessionId, direction: 'download', localPath, remotePath: selected.path, name: selected.name })
    } catch (downloadError) {
      setError(errorMessage(downloadError))
    }
  }

  const createFolder = async () => {
    const name = window.prompt('Nombre de la carpeta nueva:')?.trim()
    if (!name) return
    if (!validRemoteName(name)) {
      setError('El nombre de la carpeta no es válido.')
      return
    }
    try {
      await window.conexum?.sftp.mutate(sessionId, 'mkdir', joinRemote(directory, name))
      await loadDirectory(directory)
    } catch (mutationError) {
      setError(errorMessage(mutationError))
    }
  }

  const renameSelected = async () => {
    if (!selected) return
    const value = window.prompt('Nuevo nombre o ruta remota absoluta:', selected.name)?.trim()
    if (!value || value === selected.name || value === selected.path) return
    if (!value.startsWith('/') && !validRemoteName(value)) {
      setError('El nombre o la ruta nueva no es válida.')
      return
    }
    try {
      await window.conexum?.sftp.mutate(sessionId, 'rename', selected.path, value.startsWith('/') ? value : joinRemote(directory, value))
      await loadDirectory(directory)
    } catch (mutationError) {
      setError(errorMessage(mutationError))
    }
  }

  const removeSelected = async () => {
    if (!selected) return
    try {
      const removed = await window.conexum?.sftp.mutate(sessionId, selected.type === 'directory' ? 'remove-directory' : 'remove-file', selected.path)
      if (removed) await loadDirectory(directory)
    } catch (mutationError) {
      setError(errorMessage(mutationError))
    }
  }

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const api = window.conexum?.sftp
    if (!api) return
    for (const file of Array.from(event.dataTransfer.files)) {
      try {
        const granted = await api.grantDroppedUpload(file)
        if (granted) await enqueueUpload(granted)
      } catch (dropError) {
        setError(errorMessage(dropError))
      }
    }
  }

  return (
    <aside
      className={`utility-panel sftp-panel ${dragging ? 'dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
      onDrop={(event) => void handleDrop(event)}
    >
      <div className="panel-heading">
        <div><small>SFTP</small><strong>{profileName}</strong></div>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar explorador SFTP"><X size={17} /></button>
      </div>

      <form className="sftp-pathbar" onSubmit={(event) => { event.preventDefault(); void loadDirectory(pathDraft) }}>
        <button type="button" onClick={() => void loadDirectory(parentRemote(directory || '/'))} disabled={loading || directory === '/'} aria-label="Subir una carpeta"><ChevronUp size={15} /></button>
        <input value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} aria-label="Ruta remota" spellCheck={false} />
        <button type="button" onClick={() => void loadDirectory(directory || undefined)} disabled={loading} aria-label="Actualizar"><RefreshCw size={14} /></button>
      </form>

      <div className="sftp-actions">
        <button onClick={() => void chooseUpload()}><ArrowUpFromLine size={14} />Subir</button>
        <button onClick={() => void downloadSelected()} disabled={!selected || selected.type === 'directory'}><ArrowDownToLine size={14} />Bajar</button>
        <button onClick={() => void createFolder()}><FolderPlus size={14} /></button>
        <button onClick={() => void renameSelected()} disabled={!selected}><Pencil size={13} /></button>
        <button className="danger" onClick={() => void removeSelected()} disabled={!selected}><Trash2 size={13} /></button>
        <span />
        <button onClick={() => setShowHidden((current) => !current)} title={showHidden ? 'Ocultar archivos ocultos' : 'Mostrar archivos ocultos'}>{showHidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
      </div>

      {error && <div className="sftp-error"><span>{error}</span><button onClick={() => setError(null)}><X size={13} /></button></div>}

      <div className="sftp-list" role="list" aria-busy={loading}>
        {loading ? (
          <div className="sftp-empty"><LoaderCircle className="spin" size={20} /><span>Leyendo carpeta…</span></div>
        ) : visibleEntries.length === 0 ? (
          <div className="sftp-empty"><Folder size={21} /><span>Carpeta vacía</span></div>
        ) : visibleEntries.map((entry) => (
          <button
            key={entry.path}
            className={selectedPath === entry.path ? 'selected' : ''}
            onClick={() => setSelectedPath(entry.path)}
            onDoubleClick={() => { if (entry.type === 'directory') void loadDirectory(entry.path) }}
            role="listitem"
            title={`${entry.permissions} · ${entry.owner} · ${entry.modified}`}
          >
            {entry.type === 'directory' ? <Folder size={15} /> : <File size={15} />}
            <span>{entry.name}</span>
            <small>{entry.type === 'directory' ? '—' : formatSize(entry.size)}</small>
          </button>
        ))}
      </div>

      {dragging && <div className="sftp-dropzone"><ArrowUpFromLine size={24} /><strong>Soltá para subir</strong><span>{directory}</span></div>}

      {transfers.length > 0 && (
        <div className={`transfer-queue ${transfersExpanded ? 'expanded' : 'collapsed'}`}>
          <button className="transfer-heading" onClick={() => setTransfersExpanded((current) => !current)} aria-expanded={transfersExpanded}>
            <span><ChevronDown size={12} />TRANSFERENCIAS</span>
            <small>{transfers.filter((item) => item.status === 'queued' || item.status === 'active').length} activas</small>
          </button>
          {transfersExpanded && <div className="transfer-items">{transfers.map((transfer) => (
            <div className={`transfer-row ${transfer.status}`} key={transfer.transferId} title={transfer.error}>
              {transfer.direction === 'upload' ? <ArrowUpFromLine size={12} /> : <ArrowDownToLine size={12} />}
              <span>{transfer.name}</span>
              <div className="transfer-progress"><i style={{ width: `${transfer.progress}%` }} /></div>
              <small>{transfer.status === 'active' ? `${transfer.progress}%` : transferStatusLabel[transfer.status]}</small>
              {(transfer.status === 'queued' || transfer.status === 'active') && <button onClick={() => window.conexum?.sftp.cancelTransfer(transfer.transferId)} aria-label={`Cancelar ${transfer.name}`}><X size={11} /></button>}
            </div>
          ))}</div>}
        </div>
      )}
    </aside>
  )
}
