import { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

const EditorApp = lazy(() => import('./EditorApp'))

const isEditorWindow = new URLSearchParams(window.location.search).get('view') === 'editor'

ReactDOM.createRoot(document.getElementById('root')!).render(
  isEditorWindow ? <Suspense fallback={null}><EditorApp /></Suspense> : <App />,
)
