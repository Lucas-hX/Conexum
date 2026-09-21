import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Language = 'en' | 'es'

const LANGUAGE_KEY = 'conexum.language.v1'

type I18nContextValue = {
  language: Language
  setLanguage(language: Language): void
  text(english: string, spanish: string): string
  error(message: string): string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const spanishErrors: Record<string, string> = {
  'Invalid local session identifier.': 'Identificador de sesión local inválido.',
  'Invalid local profile.': 'Perfil local inválido.',
  'Invalid connection request.': 'Solicitud de conexión inválida.',
  'Invalid session identifier.': 'Identificador de sesión inválido.',
  'Invalid SSH profile.': 'Perfil SSH inválido.',
  'The host is not valid.': 'El servidor no es válido.',
  'The SSH username is not valid.': 'El usuario SSH no es válido.',
  'The SSH port must be between 1 and 65535.': 'El puerto SSH debe estar entre 1 y 65535.',
  'The SSH alias is not valid.': 'El alias SSH no es válido.',
  'The session already exists.': 'La sesión ya existe.',
  'The SSH session is no longer active.': 'La sesión SSH ya no está activa.',
  'The remote path is not valid.': 'La ruta remota no es válida.',
  'The remote path must be absolute.': 'La ruta remota debe ser absoluta.',
  'SFTP operation not allowed.': 'Operación SFTP no permitida.',
  'The SFTP response is too large.': 'La respuesta SFTP es demasiado grande.',
  'The SFTP server took too long to respond.': 'El servidor SFTP tardó demasiado en responder.',
  'The SSH connection is not ready for SFTP yet. Wait a few seconds and try again.': 'La conexión SSH todavía no está lista para SFTP. Esperá unos segundos y volvé a intentar.',
  'The remote path does not exist or is no longer available.': 'La ruta remota no existe o ya no está disponible.',
  'The server refused the SFTP connection.': 'El servidor rechazó la conexión SFTP.',
  'The SFTP connection timed out.': 'La conexión SFTP agotó el tiempo de espera.',
  'The SFTP operation could not be completed.': 'La operación SFTP no pudo completarse.',
  'The local path is not valid.': 'La ruta local no es válida.',
  'Invalid transfer direction.': 'Dirección de transferencia inválida.',
  'The temporary local path is not valid.': 'La ruta temporal local no es válida.',
  'The remote content is not valid.': 'El contenido remoto no es válido.',
  'The file appears to be binary and cannot be opened in the text editor.': 'El archivo parece ser binario y no puede abrirse en el editor de texto.',
  'The file does not appear to be UTF-8 encoded.': 'El archivo no parece estar codificado como UTF-8.',
  'The temporary remote file must be in the same folder.': 'El archivo temporal remoto debe estar en la misma carpeta.',
  'The remote file no longer exists.': 'El archivo remoto ya no existe.',
  'The editor can currently open regular files only.': 'Por ahora el editor sólo puede abrir archivos regulares.',
  'The file exceeds the editor’s safe 2 MB limit.': 'El archivo supera el límite seguro de 2 MB para el editor.',
  'The content is invalid or exceeds the 2 MB limit.': 'El contenido no es válido o supera el límite de 2 MB.',
  'Could not verify the original file version.': 'No se pudo verificar la versión original del archivo.',
  'The backup is too large or is not a valid file.': 'El respaldo es demasiado grande o no es un archivo válido.',
  'Invalid transfer.': 'Transferencia inválida.',
  'This transfer can no longer be retried.': 'Esta transferencia ya no se puede reintentar.',
}

function localizeError(message: string, language: Language) {
  if (language === 'en') return message
  return spanishErrors[message]
    ?? message.replace(/^OpenSSH exited with code (\d+)\.$/, 'OpenSSH finalizó con código $1.')
}

function initialLanguage(): Language {
  return localStorage.getItem(LANGUAGE_KEY) === 'es' ? 'es' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage)

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    text: (english, spanish) => language === 'es' ? spanish : english,
    error: (message) => localizeError(message, language),
  }), [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
