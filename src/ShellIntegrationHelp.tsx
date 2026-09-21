import { useRef, useState } from 'react'
import { ClipboardCopy, X } from 'lucide-react'

type RemoteShell = 'bash' | 'zsh' | 'fish'

const snippets: Record<RemoteShell, string> = {
  bash: [
    '__conexum_osc7() {',
    '  printf \'\\e]7;file://%s%s\\e\\\\\' "$HOSTNAME" "$PWD"',
    '}',
    'PROMPT_COMMAND="__conexum_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  ].join('\n'),
  zsh: [
    'function _conexum_osc7_precmd() {',
    '  printf \'\\e]7;file://%s%s\\e\\\\\' "$HOST" "$PWD"',
    '}',
    'autoload -Uz add-zsh-hook',
    'add-zsh-hook precmd _conexum_osc7_precmd',
  ].join('\n'),
  fish: [
    'function __conexum_osc7 --on-event fish_prompt',
    '  printf \'\\e]7;file://%s%s\\e\\\\\' (hostname) $PWD',
    'end',
  ].join('\n'),
}

const startupFiles: Record<RemoteShell, string> = {
  bash: '~/.bashrc',
  zsh: '~/.zshrc',
  fish: '~/.config/fish/config.fish',
}

export function ShellIntegrationHelp({ currentDirectory, onClose, onOpenHome, onOpenCurrent }: {
  currentDirectory: string | null
  onClose(): void
  onOpenHome?: () => void
  onOpenCurrent?: () => void
}) {
  const [shell, setShell] = useState<RemoteShell>('bash')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'selected'>('idle')
  const codeRef = useRef<HTMLTextAreaElement>(null)

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippets[shell])
      setCopyState('copied')
    } catch {
      codeRef.current?.focus()
      codeRef.current?.select()
      setCopyState('selected')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="shell-help-modal" role="dialog" aria-modal="true" aria-labelledby="shell-help-title">
        <div className="modal-heading"><div><small>DIRECTORIO REMOTO</small><h2 id="shell-help-title">Sincronizar la carpeta actual</h2></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="shell-help-content">
          <p>La terminal aún no informó su ruta. Una conexión SSH aparte sólo puede ver su propio directorio, no el de esta pestaña. Por eso SFTP y Editor no pueden adivinarla al abrirse.</p>
          <p>Pegá este bloque en el shell remoto para activarlo ahora. Para conservarlo en futuras sesiones, agregalo también a <code>{startupFiles[shell]}</code> en el servidor.</p>
          <div className="shell-help-tabs" role="group" aria-label="Shell remoto">
            {(['bash', 'zsh', 'fish'] as const).map((name) => <button key={name} className={shell === name ? 'active' : ''} aria-pressed={shell === name} onClick={() => { setShell(name); setCopyState('idle') }}>{name}</button>)}
          </div>
          <textarea ref={codeRef} readOnly value={snippets[shell]} aria-label={`Integración para ${shell}`} rows={shell === 'zsh' ? 5 : shell === 'bash' ? 4 : 3} onFocus={(event) => event.currentTarget.select()} />
          <div className="shell-help-copy"><button className="secondary-button" onClick={() => void copySnippet()}><ClipboardCopy size={14} />{copyState === 'copied' ? 'Copiado' : 'Copiar bloque'}</button>{copyState === 'selected' && <span>Texto seleccionado: presioná ⌘C.</span>}</div>
          <small>Cuando aparezca la ruta abajo, abrí SFTP o Editor de nuevo. Conexum nunca ejecuta este bloque por vos.</small>
        </div>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button>{onOpenHome && <button className="secondary-button" onClick={onOpenHome}>Abrir en home</button>}{currentDirectory && onOpenCurrent && <button className="primary-button" onClick={onOpenCurrent} title={currentDirectory}>Abrir en carpeta actual</button>}</div>
      </section>
    </div>
  )
}
