<div align="center">
  <img src="public/brand/conexum-icon.png" width="104" alt="Conexum logo" />
  <h1>Conexum</h1>
  <p><strong>A simple SSH connection manager for macOS.</strong></p>
  <p>Una interfaz visual, discreta y centrada en la terminal para organizar y utilizar conexiones SSH sin reemplazar las herramientas del sistema.</p>
</div>

![Conexum welcome banner](public/brand/conexum-welcome-banner.png)

> [!IMPORTANT]
> Conexum está en una etapa **alpha temprana**. Ya es posible generar una aplicación local para pruebas, pero todavía no está firmada ni notarizada para distribución pública.

## Qué es Conexum

Conexum es un gestor de conexiones SSH inspirado en la claridad de mRemoteNG y MobaXterm, diseñado específicamente para macOS. La terminal es siempre el espacio principal; el explorador SFTP, el editor remoto y las herramientas de observabilidad aparecerán únicamente cuando sean necesarias.

El proyecto evita reinventar protocolos sensibles: las conexiones, claves, agentes y validación de servidores se delegan en el OpenSSH incluido en macOS.

## Estado actual

- Conexiones SSH reales mediante `/usr/bin/ssh` y `node-pty`.
- Varias sesiones independientes en pestañas, incluso hacia el mismo servidor.
- Pantalla de Inicio con conexiones recientes y listado completo.
- Perfiles organizados en carpetas contraídas de manera predeterminada.
- Creación y edición visual de perfiles.
- Importación de entradas desde un archivo SSH config.
- Soporte para usuario, host, puerto, alias e `IdentityFile`.
- Integración con `ssh-agent` y macOS Keychain para las passphrases.
- Panel lateral plegable y redimensionable.
- Cierre individual de sesiones con confirmación.
- Identidad nativa de Conexum en la ventana, el Dock, los menús y el diálogo Acerca de.
- Pruebas automatizadas para argumentos SSH, validación de IPC y limpieza de sesiones.
- Empaquetado local reproducible como `Conexum.app`.
- Validación y paquete de prueba automáticos en GitHub Actions.

Todavía están pendientes el explorador SFTP, el editor remoto, la telemetría del servidor, la firma y notarización para distribución pública y otras mejoras descritas en el [roadmap](ROADMAP.md).

## Requisitos

- macOS en Apple Silicon o Intel.
- Node.js 22 o posterior.
- pnpm.
- OpenSSH, incluido de fábrica en macOS.

La forma más sencilla de instalar Node.js y pnpm es mediante Homebrew:

```bash
brew install node pnpm
```

## Instalación para desarrollo

```bash
git clone https://github.com/Lucas-hX/Conexum.git
cd Conexum
pnpm install
pnpm run rebuild:native
pnpm run desktop
```

`rebuild:native` recompila `node-pty` para la versión de Electron utilizada por el proyecto. Normalmente sólo hace falta ejecutarlo después de instalar o actualizar dependencias.

## Comandos útiles

```bash
# Compilar y validar TypeScript
pnpm run build

# Ejecutar las pruebas automatizadas
pnpm run test

# Ejecutar pruebas y build de producción
pnpm run check

# Abrir la interfaz en un navegador, sin conexiones SSH reales
pnpm run dev

# Compilar y ejecutar la aplicación Electron completa
pnpm run desktop

# Generar una aplicación local sin firma
pnpm run package:mac
```

La conexión SSH real sólo está disponible dentro de Electron. La versión del navegador se utiliza para desarrollar y revisar la interfaz.

El paquete local se genera en `release/mac-arm64/Conexum.app` en Apple Silicon o en el directorio equivalente de Intel. Al no estar firmado, macOS puede pedir una confirmación adicional antes de abrirlo. Los pull requests y cambios en `main` también ejecutan estas comprobaciones en GitHub Actions y producen un ZIP de prueba descargable durante 14 días.

## Primer uso

1. Ejecutá `pnpm run desktop`.
2. Creá una conexión o importá tu archivo `~/.ssh/config`.
3. Hacé doble clic sobre un servidor para abrir una sesión.
4. Repetí el doble clic para abrir otra sesión independiente del mismo servidor.
5. Hacé doble clic sobre una pestaña para cerrarla con confirmación.

## Seguridad

- Conexum no guarda contraseñas SSH.
- Las claves privadas no se copian: solamente se conserva la ruta del `IdentityFile`.
- Las passphrases pueden ser administradas por `ssh-agent` y macOS Keychain.
- Las contraseñas, huellas nuevas y advertencias de OpenSSH aparecen directamente en la terminal.
- El renderer de Electron no tiene acceso directo a Node.js ni al sistema de archivos.
- Toda comunicación privilegiada pasa por una API de preload pequeña y validada.

No incluyas contraseñas, claves privadas ni información sensible en reportes de errores.

## Cómo colaborar y probar

Antes de enviar cambios:

```bash
pnpm install
pnpm run rebuild:native
pnpm run check
pnpm run desktop
```

Al probar una funcionalidad, indicá:

- modelo de Mac y versión de macOS;
- arquitectura Apple Silicon o Intel;
- versión de Node.js y pnpm;
- shell remoto utilizado;
- pasos para reproducir el comportamiento;
- resultado esperado y resultado observado.

La matriz mínima para cambios de escritorio es:

| Área | Apple Silicon | Intel |
| --- | --- | --- |
| Inicio y navegación | Obligatorio antes de publicar | Verificación de colaborador |
| Dos sesiones del mismo perfil | Obligatorio antes de publicar | Verificación de colaborador |
| Cierre de una pestaña sin afectar otra | Obligatorio antes de publicar | Verificación de colaborador |
| Importación de SSH config e IdentityFile | Obligatorio antes de publicar | Verificación de colaborador |
| Generación y apertura de `Conexum.app` | Automático y manual | Verificación de colaborador |

El workflow automático verifica el entorno macOS hospedado por GitHub. Antes de una publicación pública, Apple Silicon e Intel deberán validarse también de forma manual en hardware real.

Las contribuciones deberían mantener los principios centrales del proyecto: terminal primero, poco ruido visual, reutilización de herramientas maduras y ningún secreto almacenado de forma insegura.

## Tecnologías

- Electron
- React + TypeScript
- Vite
- xterm.js
- node-pty
- OpenSSH de macOS
- Lucide Icons

## Documentación

- [Roadmap y backlog propuesto](ROADMAP.md)
- [Visión y especificación original](idea.md)

## Estado de distribución

`pnpm run package:mac` genera un bundle local identificado como Conexum. Este paquete sirve para desarrollo y pruebas entre colaboradores; aún no está firmado, notarizado ni acompañado por un instalador. Esos pasos permanecen planificados antes de una distribución pública.
