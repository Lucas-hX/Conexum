import { useCallback, useEffect, useState } from 'react'
import { GitBranch, RefreshCw, X } from 'lucide-react'
import type { GitSummary } from './conexum'
import { useI18n } from './i18n'

export function GitPanel({ sessionId, directory, profileName, onClose }: {
  sessionId: string
  directory: string | null
  profileName: string
  onClose(): void
}) {
  const { text } = useI18n()
  const [summary, setSummary] = useState<GitSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.conexum) return
    setLoading(true)
    try {
      setSummary(await window.conexum.git.summary(sessionId, directory))
    } finally {
      setLoading(false)
    }
  }, [directory, sessionId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 8_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const unavailableMessage = summary && !summary.available
    ? summary.reason === 'directory-unavailable'
      ? text('Current directory unavailable.', 'No se pudo conocer el directorio actual.')
      : summary.reason === 'not-repository'
        ? text('This directory is not inside a Git repository.', 'Este directorio no pertenece a un repositorio Git.')
        : text('Git summary is not available for this session.', 'El resumen Git no está disponible para esta sesión.')
    : null

  return (
    <aside className="git-panel" aria-label={text('Git changes', 'Cambios Git')}>
      <header>
        <div><GitBranch size={15} /><span><strong>{text('Git changes', 'Cambios Git')}</strong><small>{profileName}</small></span></div>
        <button onClick={() => void refresh()} disabled={loading} title={text('Refresh', 'Actualizar')} aria-label={text('Refresh Git summary', 'Actualizar resumen Git')}><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button>
        <button onClick={onClose} title={text('Close', 'Cerrar')} aria-label={text('Close Git panel', 'Cerrar panel Git')}><X size={15} /></button>
      </header>
      {loading && !summary && <div className="git-panel-message">{text('Reading repository status…', 'Leyendo estado del repositorio…')}</div>}
      {unavailableMessage && <div className="git-panel-message">{unavailableMessage}</div>}
      {summary?.available && <>
        <div className="git-summary-heading">
          <span><GitBranch size={13} /><strong>{summary.branch || 'HEAD'}</strong></span>
          <small title={summary.root}>{summary.root}</small>
        </div>
        <div className="git-diff-stats">
          <span><b>{text('Staged', 'Preparados')}</b> {summary.staged.files} files <i>+{summary.staged.insertions}</i> <em>−{summary.staged.deletions}</em></span>
          <span><b>{text('Unstaged', 'Sin preparar')}</b> {summary.unstaged.files} files <i>+{summary.unstaged.insertions}</i> <em>−{summary.unstaged.deletions}</em></span>
        </div>
        <div className="git-file-list">
          {summary.files.length === 0
            ? <div className="git-panel-message clean">{text('Working tree clean.', 'Árbol de trabajo limpio.')}</div>
            : summary.files.map((file) => <div key={`${file.code}:${file.path}`} className={file.conflicted ? 'conflicted' : ''} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}>
                <code>{file.code}</code><span>{file.path}</span>{file.staged && <small>S</small>}{file.unstaged && <small>U</small>}
              </div>)}
          {summary.truncated && <div className="git-panel-message">{text('Showing the first 200 changed files.', 'Mostrando los primeros 200 archivos modificados.')}</div>}
        </div>
      </>}
    </aside>
  )
}
