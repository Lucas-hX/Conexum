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
- Vista dividida de dos terminales o cuadrícula de hasta cuatro sesiones abiertas.
- Pantalla de Inicio con conexiones recientes y listado completo.
- Perfiles organizados en carpetas contraídas de manera predeterminada.
- Creación y edición visual de perfiles.
- Importación de entradas desde un archivo SSH config.
- Soporte para usuario, host, puerto, alias e `IdentityFile`.
- Integración con `ssh-agent` y macOS Keychain para las passphrases.
- Panel lateral plegable y redimensionable.
- Cierre individual de sesiones con confirmación.
- Grupos de conexiones renombrables y eliminables desde su menú contextual.
- Identidad nativa de Conexum en la ventana, el Dock, los menús y el diálogo Acerca de.
- Pruebas automatizadas para argumentos SSH, validación de IPC y limpieza de sesiones.
- Empaquetado local reproducible como `Conexum.app`.
- Validación y paquete de prueba automáticos en GitHub Actions.
- Directorio remoto independiente por pestaña mediante OSC 7.
- Métricas discretas de CPU y RAM para la pestaña activa cada 9 segundos.
- Actualizador local seguro para builds alpha instalados en macOS.
- Explorador SFTP acoplable con navegación, transferencias y operaciones seguras.
- Respaldo e importación de perfiles en un formato versionado que nunca incluye contraseñas ni claves privadas.
- Diagnóstico de conexión copiable sin capturar contenido de la terminal.
- Ventana independiente Conexum Editor con árbol SFTP, Monaco, pestañas y guardado remoto seguro.

Todavía están pendientes la firma y notarización para distribución pública, funciones avanzadas del editor y otras mejoras descritas en el [roadmap](ROADMAP.md).

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

# Actualizar, validar, empaquetar e instalar la última versión de main
pnpm run update:local
```

La conexión SSH real sólo está disponible dentro de Electron. La versión del navegador se utiliza para desarrollar y revisar la interfaz.

El paquete local se genera en `release/mac-arm64/Conexum.app` en Apple Silicon o en el directorio equivalente de Intel. Al no estar firmado, macOS puede pedir una confirmación adicional antes de abrirlo. Los pull requests y cambios en `main` también ejecutan estas comprobaciones en GitHub Actions y producen un ZIP de prueba descargable durante 14 días.

## Actualizaciones durante la etapa alpha

El archivo `scripts/update-conexum.command` automatiza la actualización local desde el código fuente. Se puede abrir desde Finder o ejecutar con:

```bash
pnpm run update:local
```

El actualizador:

1. exige una rama `main` limpia;
2. descarga únicamente el avance lineal más reciente de `origin/main`;
3. instala las dependencias bloqueadas por `pnpm-lock.yaml`;
4. ejecuta las pruebas, compila y genera `Conexum.app`;
5. comprueba que Conexum esté cerrado;
6. reemplaza `/Applications/Conexum.app` y restaura la copia anterior si la instalación falla;
7. abre la versión nueva.

Los perfiles permanecen en Application Support y no forman parte del bundle reemplazado. Para utilizar otra ubicación se puede definir `CONEXUM_APP_PATH` con una ruta absoluta terminada en `Conexum.app`.

Este mecanismo está pensado para mantenedores y colaboradores durante la etapa alpha. El actualizador público futuro requerirá firma, notarización y releases versionadas.

## Directorio y métricas remotas

La barra inferior muestra el directorio actual de la pestaña cuando el shell remoto emite OSC 7. Consultá la [configuración opcional para Bash, Zsh y Fish](docs/shell-integration.md).

CPU y RAM se consultan aproximadamente cada 9 segundos únicamente para la pestaña visible. Conexum reutiliza el socket multiplexado de la sesión SSH, usa un comando remoto fijo de sólo lectura y comparte el resultado entre pestañas del mismo servidor. Nunca inserta comandos en la terminal interactiva. Linux y macOS remotos están soportados; la primera lectura de CPU aparece como `—` hasta disponer de una segunda muestra para calcular el intervalo.

## Explorador SFTP

Con una sesión activa, presioná **SFTP** para abrir el panel lateral. El explorador comienza en el directorio informado por OSC 7 o, si todavía no existe esa información, en el home remoto.

Desde el panel se puede:

- navegar con breadcrumbs, doble clic o escribiendo una ruta absoluta;
- ordenar por nombre, tamaño, permisos, propietario o fecha;
- mostrar u ocultar archivos ocultos;
- crear carpetas;
- renombrar o mover archivos y carpetas;
- eliminar archivos o carpetas vacías con confirmación;
- subir archivos mediante el selector o arrastrando desde Finder;
- descargar archivos eligiendo su destino local;
- observar y cancelar transferencias desde una cola compacta;
- abrir archivos de texto directamente en Conexum Editor;
- cerrar o redimensionar el panel sin interrumpir la terminal.

Conexum utiliza `/usr/bin/sftp` y el socket multiplexado de la sesión existente. No guarda credenciales ni implementa el protocolo SFTP. Los archivos locales sólo pueden transferirse después de seleccionarlos explícitamente mediante Finder, el diálogo de macOS o arrastrar y soltar.

Al cancelar una transferencia, el servidor o la carpeta local pueden conservar un archivo parcial. Conexum lo deja visible para que el usuario decida si desea inspeccionarlo, reintentar la operación o eliminarlo; nunca borra archivos automáticamente después de una interrupción.

Las transferencias fallidas o canceladas muestran un botón de reintento. El reintento vuelve a comprobar la ruta local y comienza una transferencia nueva; no intenta combinar automáticamente datos parciales.

## Respaldos y diagnóstico

El menú de ajustes permite exportar e importar conexiones de Conexum. El respaldo incluye nombres, grupos, destinos, puertos, usuarios y rutas configuradas, pero nunca contiene contraseñas, passphrases ni el contenido de una clave privada. Los archivos exportados se escriben con permisos locales restrictivos.

Con una pestaña seleccionada, **Diagnóstico** muestra únicamente datos sanitizados del perfil y del proceso OpenSSH: destino, puerto, usuario, IdentityFile, estado y código de salida. **Copiar diagnóstico** no incluye el contenido ni las pulsaciones de la terminal.

## Conexum Editor

Con una sesión activa, presioná **Editor** o abrí un archivo desde SFTP para lanzar una ventana independiente. El editor reutiliza la conexión multiplexada existente y no vuelve a solicitar credenciales.

La primera versión incluye:

- árbol remoto SFTP cargado bajo demanda;
- pestañas de documentos y resaltado de sintaxis mediante Monaco Editor;
- búsqueda, reemplazo, números de línea y atajos habituales de edición;
- guardado remoto con `⌘S`;
- comprobación de la huella del archivo antes de sobrescribirlo;
- confirmación si el archivo cambió en el servidor;
- reemplazo mediante un archivo temporal remoto y conservación de permisos;
- confirmación al cerrar documentos o la ventana con cambios pendientes;
- rechazo de archivos binarios, no UTF-8 o mayores a 2 MB.

El editor depende de una sesión SSH activa. Si la sesión termina, el contenido abierto permanece visible, pero es necesario reconectarla para volver a navegar o guardar.

## Primer uso

1. Ejecutá `pnpm run desktop`.
2. Creá una conexión o importá tu archivo `~/.ssh/config`.
3. Hacé doble clic sobre un servidor para abrir una sesión.
4. Repetí el doble clic para abrir otra sesión independiente del mismo servidor.
5. Hacé doble clic sobre una pestaña para cerrarla con confirmación.

Si una conexión finaliza, podés usar **Reconectar** en la terminal o en la barra superior. Conexum conserva el historial visible de esa pestaña y abre una sesión SSH nueva con el mismo perfil.

Con dos o más sesiones abiertas, **Dividir** muestra dos terminales lado a lado. Al presionarlo nuevamente se convierte en una cuadrícula de hasta cuatro sesiones; una tercera pulsación vuelve a la vista única. La sesión activa se mantiene siempre dentro de la vista dividida y podés cambiarla desde las pestañas superiores o haciendo clic en otra terminal.

Hacé clic derecho sobre el nombre de un grupo en la barra lateral para renombrarlo o eliminarlo. Eliminar un grupo borra sus perfiles guardados, pero no interrumpe las sesiones que ya estén abiertas.

## Seguridad

- Conexum no guarda contraseñas SSH.
- Las claves privadas no se copian: solamente se conserva la ruta del `IdentityFile`.
- Las passphrases pueden ser administradas por `ssh-agent` y macOS Keychain.
- Las contraseñas, huellas nuevas y advertencias de OpenSSH aparecen directamente en la terminal.
- El renderer de Electron no tiene acceso directo a Node.js ni al sistema de archivos.
- Toda comunicación privilegiada pasa por una API de preload pequeña y validada.
- La telemetría usa un proceso SSH auxiliar en modo no interactivo y no puede solicitar credenciales.
- El directorio remoto llega por OSC 7; Conexum no analiza la pantalla ni registra teclas.
- SFTP funciona en un proceso separado con `BatchMode=yes`, sin reenviar puertos ni solicitar credenciales nuevas.
- Eliminar contenido remoto siempre requiere confirmación y las carpetas sólo se eliminan cuando están vacías.
- El editor comprueba conflictos antes de guardar y nunca guarda silenciosamente sobre una versión remota diferente.

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
- [Integración OSC 7 para Bash, Zsh y Fish](docs/shell-integration.md)
- [Historial de cambios](CHANGELOG.md)

## Estado de distribución

`pnpm run package:mac` genera un bundle local identificado como Conexum. Este paquete sirve para desarrollo y pruebas entre colaboradores; aún no está firmado, notarizado ni acompañado por un instalador. Esos pasos permanecen planificados antes de una distribución pública.
