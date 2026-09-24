import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ITheme } from '@xterm/xterm'

export type ThemeId = 'conexum-dark' | 'midnight-blue' | 'graphite'

type EditorTheme = {
  base: 'vs-dark'
  rules: Array<{ token: string; foreground: string }>
  colors: Record<string, string>
}

export type ThemeDefinition = {
  id: ThemeId
  terminal: ITheme
  editor: EditorTheme
  ui: Record<string, string>
}

const THEME_KEY = 'conexum.theme.v1'

export const themes: Record<ThemeId, ThemeDefinition> = {
  'conexum-dark': {
    id: 'conexum-dark',
    ui: {
      canvas: '#080c11', shell: '#0b1016', titlebarTop: '#171e26', titlebarBottom: '#141a21', sidebarTop: '#171d24', sidebarBottom: '#141a21',
      panel: '#141b22', panelAlt: '#111820', raised: '#1a222a', input: '#10161c', terminal: '#080d12', terminalGlow: '#0e151c',
      border: '#2b3540', borderStrong: '#3b4650', text: '#d9e0e8', textStrong: '#eef5fb', muted: '#aebac4', faint: '#71808d',
      accent: '#55aef0', accentStrong: '#258ed5', accentText: '#8bd0ff', accentSurface: '#132433', selection: '#1b446166',
      hover: '#ffffff0b', hoverStrong: '#ffffff12', scrim: '#020509b8', shadow: '#0009', danger: '#d98a8f', success: '#55b4f5',
      welcomeSolid: '#0b1119', welcomeFade: '#0b1119ec', welcomeClear: '#0b111966',
    },
    terminal: {
      background: '#080d12', foreground: '#d6dde7', cursor: '#73c8ff', selectionBackground: '#1c72c955',
      black: '#111820', red: '#ff6b72', green: '#55e276', yellow: '#f3c969', blue: '#53a9ff', magenta: '#c68cff', cyan: '#52d6de', white: '#d6dde7',
      brightBlack: '#66717c', brightRed: '#ff8990', brightGreen: '#78ec93', brightYellow: '#f8d98b', brightBlue: '#79bdff', brightMagenta: '#d8a9ff', brightCyan: '#7ce5eb', brightWhite: '#f2f6fa',
    },
    editor: {
      base: 'vs-dark',
      rules: [
        { token: 'comment', foreground: '697783' }, { token: 'keyword', foreground: 'C990C0' }, { token: 'string', foreground: 'D9A568' },
        { token: 'number', foreground: '7BC7B1' }, { token: 'type', foreground: '63B3ED' },
      ],
      colors: {
        'editor.background': '#0b1015', 'editor.foreground': '#d7dfe7', 'editorLineNumber.foreground': '#53606b',
        'editorLineNumber.activeForeground': '#9ba8b3', 'editor.lineHighlightBackground': '#348fce12', 'editor.selectionBackground': '#2a83bd55',
        'editorCursor.foreground': '#79c7ff', 'editorIndentGuide.background1': '#26303a', 'editorIndentGuide.activeBackground1': '#465766',
      },
    },
  },
  'midnight-blue': {
    id: 'midnight-blue',
    ui: {
      canvas: '#040816', shell: '#060b1b', titlebarTop: '#111a36', titlebarBottom: '#0b132b', sidebarTop: '#0d1732', sidebarBottom: '#091127',
      panel: '#0b1429', panelAlt: '#081124', raised: '#111d38', input: '#070e20', terminal: '#030817', terminalGlow: '#09152c',
      border: '#1d3156', borderStrong: '#2a4674', text: '#dce7ff', textStrong: '#f3f7ff', muted: '#a7b9dc', faint: '#7084a9',
      accent: '#5aa7ff', accentStrong: '#2f7eea', accentText: '#91c5ff', accentSurface: '#102a52', selection: '#17468199',
      hover: '#7ba8ff10', hoverStrong: '#8eb8ff1c', scrim: '#01030cbf', shadow: '#000b', danger: '#ee8998', success: '#56c9e8',
      welcomeSolid: '#050b20', welcomeFade: '#050b20ee', welcomeClear: '#07112c73',
    },
    terminal: {
      background: '#030817', foreground: '#d8e4ff', cursor: '#72b7ff', selectionBackground: '#215ca866',
      black: '#0a1126', red: '#ff6f91', green: '#69e0a5', yellow: '#e9cf78', blue: '#629dff', magenta: '#bd8cff', cyan: '#55d8ee', white: '#d8e4ff',
      brightBlack: '#657aa3', brightRed: '#ff91aa', brightGreen: '#8ce9bc', brightYellow: '#f3de9a', brightBlue: '#87b7ff', brightMagenta: '#d0a8ff', brightCyan: '#7ee5f4', brightWhite: '#f4f7ff',
    },
    editor: {
      base: 'vs-dark',
      rules: [
        { token: 'comment', foreground: '7185A9' }, { token: 'keyword', foreground: 'C69AFF' }, { token: 'string', foreground: 'E8B97B' },
        { token: 'number', foreground: '74D5C4' }, { token: 'type', foreground: '78B4FF' },
      ],
      colors: {
        'editor.background': '#050a1a', 'editor.foreground': '#dce7ff', 'editorLineNumber.foreground': '#4e6188',
        'editorLineNumber.activeForeground': '#9db2d8', 'editor.lineHighlightBackground': '#2d63a61b', 'editor.selectionBackground': '#2869ba66',
        'editorCursor.foreground': '#72b7ff', 'editorIndentGuide.background1': '#1a2948', 'editorIndentGuide.activeBackground1': '#38557f',
      },
    },
  },
  graphite: {
    id: 'graphite',
    ui: {
      canvas: '#111315', shell: '#151719', titlebarTop: '#292c2f', titlebarBottom: '#222528', sidebarTop: '#24272a', sidebarBottom: '#1e2123',
      panel: '#202326', panelAlt: '#1a1d1f', raised: '#292d30', input: '#17191b', terminal: '#101214', terminalGlow: '#181b1e',
      border: '#363b3f', borderStrong: '#4a5055', text: '#e0e3e5', textStrong: '#f7f8f8', muted: '#b7bdc1', faint: '#7d858a',
      accent: '#78a9c5', accentStrong: '#527f99', accentText: '#a3c7db', accentSurface: '#26343b', selection: '#41617380',
      hover: '#ffffff0a', hoverStrong: '#ffffff14', scrim: '#08090abf', shadow: '#000a', danger: '#d68d91', success: '#72aeb4',
      welcomeSolid: '#17191b', welcomeFade: '#17191bee', welcomeClear: '#17191b70',
    },
    terminal: {
      background: '#101214', foreground: '#dadddf', cursor: '#9cc4d6', selectionBackground: '#54778a66',
      black: '#1a1d1f', red: '#d9797e', green: '#8fbe91', yellow: '#c9b77a', blue: '#7fa7c2', magenta: '#aa8db6', cyan: '#79adb1', white: '#dadddf',
      brightBlack: '#6e7478', brightRed: '#e4979a', brightGreen: '#a8cda9', brightYellow: '#d7c993', brightBlue: '#9bbbcf', brightMagenta: '#bda7c7', brightCyan: '#96c0c3', brightWhite: '#f3f4f4',
    },
    editor: {
      base: 'vs-dark',
      rules: [
        { token: 'comment', foreground: '737A7E' }, { token: 'keyword', foreground: 'B8A0BE' }, { token: 'string', foreground: 'C6AE82' },
        { token: 'number', foreground: '91B8A8' }, { token: 'type', foreground: '8EB1C4' },
      ],
      colors: {
        'editor.background': '#121416', 'editor.foreground': '#dadddf', 'editorLineNumber.foreground': '#5b6266',
        'editorLineNumber.activeForeground': '#a8afb3', 'editor.lineHighlightBackground': '#ffffff08', 'editor.selectionBackground': '#58788a55',
        'editorCursor.foreground': '#9cc4d6', 'editorIndentGuide.background1': '#2b3033', 'editorIndentGuide.activeBackground1': '#50585d',
      },
    },
  },
}

export const themeIds = Object.keys(themes) as ThemeId[]

type ThemeContextValue = {
  theme: ThemeDefinition
  themeId: ThemeId
  setThemeId(themeId: ThemeId): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function initialThemeId(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored && stored in themes ? stored as ThemeId : 'conexum-dark'
  } catch {
    return 'conexum-dark'
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId)
  const theme = themes[themeId]

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = themeId
    root.style.colorScheme = 'dark'
    for (const [token, value] of Object.entries(theme.ui)) root.style.setProperty(`--theme-${token}`, value)
    try {
      localStorage.setItem(THEME_KEY, themeId)
    } catch {
      // The selected built-in theme still applies for this session when storage is unavailable.
    }
  }, [theme, themeId])

  const value = useMemo<ThemeContextValue>(() => ({ theme, themeId, setThemeId }), [theme, themeId])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
