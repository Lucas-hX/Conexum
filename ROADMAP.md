# Roadmap de Conexum

Este documento transforma la visión del producto en entregas concretas. También funciona como fuente para crear los próximos issues y organizar un GitHub Project sin perder el contexto de cada decisión.

## Principios

1. La terminal es el centro de la experiencia.
2. Las herramientas secundarias permanecen ocultas hasta que el usuario las necesita.
3. SSH, SFTP, claves y agentes deben apoyarse en herramientas existentes y auditadas.
4. Ninguna mejora debe introducir latencia perceptible en la terminal.
5. La interfaz debe conservar una identidad macOS sencilla y con poco ruido visual.
6. Los secretos nunca deben almacenarse como texto plano ni aparecer en registros.

## Disponible actualmente

- Perfiles SSH persistentes y organizados en carpetas.
- Importación de archivos SSH config.
- Edición contextual de perfiles e IdentityFile.
- OpenSSH real mediante una pseudo-terminal.
- Sesiones simultáneas e independientes en pestañas.
- Varias sesiones del mismo servidor identificadas como `#1`, `#2`, etc.
- Vista dividida para comparar hasta cuatro sesiones abiertas.
- Gestión contextual de grupos de conexiones.
- Inicio con conexiones recientes.
- Panel de conexiones plegable y redimensionable.
- Identidad visual inicial, íconos y banner.
- Identidad nativa de Conexum en macOS y paquete `.app` local sin firma.
- Pruebas automatizadas del núcleo SSH, mensajes de terminal y limpieza de sesiones.
- Validación automática y paquete de prueba mediante GitHub Actions.
- Directorio remoto por pestaña mediante integración OSC 7 opcional.
- CPU y RAM de la pestaña activa mediante un canal SSH multiplexado de sólo lectura.
- Actualizador local seguro para builds alpha.
- Explorador SFTP opcional con navegación y cola de transferencias.
- Respaldo/importación segura de perfiles y diagnóstico sanitizado de sesiones.
- Ventana independiente de edición remota con Monaco y árbol SFTP.
- Terminal local predeterminada agrupada bajo el nombre de la Mac, con sesiones independientes.
- Inicio y controles visuales compactos para reducir el ruido fuera de la terminal.
- SFTP y Editor abiertos en la última ruta informada por la pestaña cuando OSC 7 está disponible; si no, comienzan directamente en el home remoto y permiten cambiar de ruta manualmente.

## Entrega 0.2 — Identidad macOS y base para colaboradores

Objetivo: que Conexum deje de presentarse como Electron y pueda probarse como una aplicación reconocible.

- [x] Quitar la etiqueta visual “OPENSSH DE macOS” de la barra de pestañas.
- [x] Definir nombre de producto, bundle identifier y metadatos de aplicación.
- [x] Aplicar el nombre Conexum al Dock, menús, ventana, diálogo Acerca de y procesos visibles.
- [x] Configurar el ícono de la aplicación para el bundle macOS.
- [x] Incorporar una herramienta de empaquetado para generar un `.app` local.
- [x] Agregar scripts de instalación, compilación y empaquetado reproducibles.
- [x] Documentar la matriz inicial de pruebas para Apple Silicon e Intel.
- [x] Añadir comprobaciones automáticas de pruebas, TypeScript, build y empaquetado en GitHub Actions.

### Criterio de salida

Un colaborador puede clonar el repositorio, ejecutar la aplicación y generar un bundle local identificado completamente como Conexum.

**Estado:** completada para pruebas locales. La firma y notarización permanecen en la Entrega 0.7.

## Entrega 0.3 — Contexto de sesión y observabilidad ligera

Objetivo: mostrar información útil del servidor sin afectar la experiencia de la terminal.

- [x] Crear un canal SSH auxiliar y multiplexado por conexión.
- [x] Obtener CPU y RAM mediante comandos remotos de sólo lectura.
- [x] Actualizar la pestaña visible aproximadamente cada 8–10 segundos.
- [x] Pausar las consultas de pestañas en segundo plano.
- [x] Compartir métricas entre sesiones del mismo servidor para evitar trabajo duplicado.
- [x] Mostrar valores compactos en la barra inferior, sin gráficos permanentes.
- [x] Marcar métricas antiguas o no disponibles sin presentar errores invasivos.
- [x] Detectar el sistema remoto y adaptar la lectura para Linux y macOS.
- [x] Implementar integración de shell para recibir el directorio activo mediante OSC 7.
- [x] Mantener un directorio independiente para cada pestaña.
- [x] Hacer optativa la integración de shell y documentar Bash, Zsh y Fish.

### Presentación prevista

```text
● Sesión activa    ~/projects/api    CPU 12%    RAM 41%
```

### Criterio de salida

La pestaña activa muestra directorio, CPU y RAM con una sobrecarga imperceptible, y la terminal no recibe texto ni comandos de telemetría.

**Estado:** implementada. Pendiente de validación adicional en servidores macOS remotos y distribuciones Linux variadas.

## Entrega 0.4 — Explorador SFTP y transferencias

Objetivo: navegar y mover archivos sin abandonar la sesión SSH.

- [x] Utilizar el cliente SFTP de macOS sin implementar el protocolo desde cero.
- [x] Reutilizar perfil, clave, host, puerto y configuración SSH existentes.
- [x] Navegar por el sistema de archivos remoto.
- [x] Mostrar archivos ocultos de forma opcional.
- [x] Subir y descargar archivos.
- [x] Crear carpetas, mover, renombrar y eliminar con confirmación.
- [x] Incorporar arrastrar y soltar.
- [x] Mostrar una cola de transferencias compacta con progreso y cancelación.
- [x] Permitir el reintento manual y seguro de transferencias interrumpidas.
- [x] Permitir que el panel se abra, cierre y redimensione sin afectar la terminal.

### Criterio de salida

El usuario puede transferir archivos de forma confiable y observar el progreso sin bloquear una sesión interactiva.

**Estado:** implementada para pruebas locales, incluido el reintento manual de transferencias fallidas o canceladas.

## Entrega 0.5 — Editor remoto

Objetivo: revisar y editar archivos remotos con una experiencia similar a un editor liviano de VS Code.

- [x] Evaluar CodeMirror y Monaco según tamaño, rendimiento y facilidad de integración.
- [x] Abrir archivos desde el explorador SFTP.
- [x] Pestañas de documentos separadas de las pestañas SSH.
- [x] Resaltado de sintaxis, números de línea y búsqueda.
- [x] Guardado remoto mediante la conexión SFTP activa.
- [x] Detección de modificaciones remotas y conflictos.
- [x] Confirmación antes de sobrescribir una versión más reciente.
- [x] Indicadores claros de archivo modificado, guardando y error.
- [x] Límites seguros para archivos grandes o binarios.

### Criterio de salida

El usuario puede abrir, modificar y guardar un archivo de texto remoto sin riesgo de sobrescribir silenciosamente cambios externos.

**Estado:** primera versión funcional implementada para pruebas locales. Autocompletado mediante servidores de lenguaje, Git visual y edición con privilegios elevados quedan fuera de este alcance inicial.

## Entrega 0.6 — Contexto de agentes

Objetivo: reconocer herramientas de agentes ejecutadas en una terminal mediante una arquitectura agnóstica, comenzando por Codex y dejando adaptadores previstos para OpenCode y Claude.

- Definir una interfaz común de adaptadores de agentes, sin acoplar la UI a un proveedor.
- Incorporar eventos semánticos del shell, como OSC 133 o hooks equivalentes.
- Implementar primero el adaptador de Codex.
- Detectar el inicio y finalización de `codex`, `opencode` y `claude` sin analizar visualmente la terminal.
- Mostrar un indicador discreto con agente, estado y directorio de trabajo.
- Identificar el repositorio activo de forma segura.
- Mostrar archivos creados o modificados mediante el estado de Git.
- Permitir abrir esos archivos en el editor remoto.
- Investigar una fuente de eventos estructurados de Codex para estados más precisos.
- Diferenciar claramente archivos modificados de archivos simplemente leídos.
- Agregar adaptadores de OpenCode y Claude cuando sus fuentes de eventos puedan validarse.
- Hacer la observación explícita, visible y configurable por perfil.

### Presentación prevista

```text
✦ Codex activo · ~/projects/api · 3 archivos modificados
```

### Criterio de salida

Conexum puede indicar que Codex está activo y abrir los archivos modificados, sin capturar pulsaciones ni inferir actividad a partir de la pantalla de la terminal.

## Entrega 0.7 — Distribución y estabilidad

Objetivo: producir una versión instalable para pruebas más amplias.

- Pruebas unitarias para validación de perfiles y argumentos SSH.
- Pruebas de integración para procesos, reconexión y cierre.
- Pruebas visuales de los estados principales.
- Confirmar el cierre explícito de todas las conexiones y vistas al salir; no persistir sesiones por diseño.
- Recuperación limpia después de un cierre inesperado.
- Bundle universal cuando las dependencias nativas lo permitan.
- Firma con Developer ID y notarización de Apple.
- Imagen DMG o mecanismo de instalación equivalente.
- Política de versiones, changelog y proceso de publicación.
- Evaluación de actualizaciones automáticas para una etapa posterior.

## Backlog de issues sugeridos

Estos títulos están preparados para convertirse en issues y tarjetas del GitHub Project:

1. `Remove the OPENSSH DE macOS badge from the tab bar`
2. `Configure Conexum product name, bundle identifier and application metadata`
3. `Generate the macOS app icon set and apply it to packaged builds`
4. `Add a reproducible local macOS packaging workflow`
5. `Add a GitHub Actions build check for macOS`
6. `Design the remote telemetry transport over multiplexed SSH`
7. `Add low-frequency remote CPU and memory metrics`
8. `Implement OSC 7 shell integration for the active remote directory`
9. `Design the dockable SFTP file explorer`
10. `Implement remote directory listing and navigation over SFTP`
11. `Implement upload, download and transfer progress`
12. `Evaluate CodeMirror versus Monaco for the remote editor`
13. `Open and save remote text files through SFTP`
14. `Detect remote file conflicts before saving`
15. `Detect Codex command lifecycle through shell integration`
16. `Show Git-modified files produced during an agent session`
17. `Open agent-modified files in the remote editor`
18. `Add contributor setup and macOS testing documentation`
19. `Add automated tests for SSH argument validation and session cleanup`
20. `Prepare signed and notarized macOS test releases`

## Estructura sugerida para GitHub Project

Columnas iniciales:

- **Ideas** — propuestas todavía no priorizadas;
- **Ready** — tareas definidas y listas para comenzar;
- **In progress** — trabajo activo;
- **Review / Test** — esperando revisión o prueba en otro Mac;
- **Done** — incluido y verificado.

Campos recomendados:

- entrega o milestone;
- prioridad;
- área: Terminal, SSH, SFTP, Editor, UI, Agent integration, Packaging;
- plataforma o arquitectura;
- responsable;
- estado de prueba.

## Fuera de alcance por ahora

- RDP, VNC, Telnet y conexiones seriales.
- Sincronización de credenciales en la nube.
- Implementar un protocolo SSH o SFTP propio.
- Convertir Conexum en un IDE completo.
- Capturar el contenido o las pulsaciones de la terminal para inferir acciones de agentes.
