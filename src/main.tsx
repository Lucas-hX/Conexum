import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <I18nProvider><ThemeProvider><App /></ThemeProvider></I18nProvider>,
)
