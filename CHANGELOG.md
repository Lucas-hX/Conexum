# Changelog

Todos los cambios relevantes de Conexum se documentan en este archivo.

## Unreleased

### Added

- English is now the default interface language, with Spanish available from **Settings → Language** and the preference saved locally.
- The README, shell-integration guide, native dialogs, validation messages, Editor, SFTP browser, and terminal status messages now use English by default.
- Built-in Conexum Dark, Midnight Blue, and Graphite themes apply live to the application, terminal, and editor and persist locally.
- SSH connections can be duplicated from their context menu into a new editable profile without copying or storing credentials.

## 0.6.6 — 2026-09-20

### Mejorado

- El editor ahora se abre dentro de Conexum, a la izquierda de la terminal activa, con un divisor redimensionable. SFTP también abre los archivos en esta vista integrada.
- Cada pestaña SSH conserva sus documentos y borradores al cambiar de sesión, visitar Inicio, alternar con SFTP o ampliar la terminal. La X y ⌘W cierran el editor de esa sesión sin desconectarla.
- Se pide confirmación antes de descartar cambios al cerrar el editor, la pestaña SSH o Conexum; se bloquea el cierre durante un guardado remoto.

## 0.6.5 — 2026-09-20

### Corregido

- Los archivos de texto abiertos en Conexum Editor ya no aparecen en blanco: el área de edición ocupa el espacio disponible con o sin un aviso de error.
- Se verificó la lectura de archivos Markdown y Python mediante el cliente SFTP de macOS y una prueba visual local del editor.

## 0.6.4 — 2026-09-20

### Mejorado

- SFTP y Editor se abren directamente en la última ruta informada por la pestaña SSH o, si no existe o ya no es accesible, en el home remoto. La guía de OSC 7 queda opcional en la barra inferior.
- SFTP muestra botones visibles para ir al home y escribir una ruta absoluta; Editor incorpora una barra de ruta propia y un botón de home.
- Al abrir Editor desde SFTP se conserva la carpeta explorada, incluso si la terminal está situada en otra ruta.

### Corregido

- Una ruta manual inválida muestra un error sin reemplazar la carpeta que ya estaba abierta.
- Las respuestas de navegación antiguas no pueden sobrescribir una ruta elegida después.

## 0.6.3 — 2026-09-20

### Corregido

- SFTP y Editor ya no abren silenciosamente el home remoto cuando la terminal aún no informa su directorio. Muestran cómo activar OSC 7 y ofrecen abrir el home sólo por elección explícita.
- La ruta más reciente de cada pestaña se toma al pulsar SFTP o Editor, incluso si React todavía no actualizó la barra inferior.

### Mejorado

- Los acentos visuales de controles, selección, estado, editor y avisos usan únicamente tonos de azul.

## 0.6.2 — 2026-09-20

### Agregado

- Grupo predeterminado con el nombre de la Mac y pestañas de terminal local independientes.
- Directorio de la terminal local en la barra inferior, consultado sin modificar el shell.

### Mejorado

- Barra de herramientas con iconos discretos, botones de conexión más pequeños e Inicio simplificado.
- SFTP y Editor abren el directorio actual de la pestaña SSH cuando está disponible mediante OSC 7; de lo contrario, utilizan el home remoto.
- El editor actualiza el árbol al volver a abrirlo desde otra carpeta de la misma sesión.

## 0.5.3 — 2026-09-20

### Agregado

- Reconexión manual dentro de la misma pestaña, conservando el historial visible de la terminal.
- Reintento manual de transferencias SFTP fallidas o canceladas.

### Seguridad

- Los reintentos reutilizan únicamente rutas que el usuario seleccionó previamente y vuelven a comprobar que el archivo o carpeta local exista.
- No se reanudan archivos parciales automáticamente: cada reintento comienza de nuevo por decisión explícita del usuario.

## 0.5.2 — 2026-09-20

### Mejorado

- La cola de transferencias SFTP ocupa menos espacio, permanece al pie del panel y puede contraerse.
- La cola se abre automáticamente cuando comienza una transferencia y queda contraída al reabrir un historial inactivo.

## 0.5.1 — 2026-09-20

### Corregido

- El explorador ya no descarta los resultados cuando se abre una ruta absoluta.
- El parser acepta el formato real de listados producido por OpenSSH en macOS.
- Los caracteres especiales de glob en rutas remotas se escapan antes de enviarlos a SFTP.
- Los fallos de conexión, permisos, rutas y subsistema SFTP ahora muestran mensajes accionables.

## 0.5.0 — 2026-09-20

### Agregado

- Menú contextual para renombrar o eliminar grupos de conexiones.
- Vista dividida para dos sesiones y cuadrícula de hasta cuatro terminales independientes.
- La sesión activa siempre queda visible al cambiar entre pestañas mientras la vista dividida está activa.

## 0.4.1 — 2026-09-20

### Corregido

- El socket de multiplexación SSH ahora utiliza una ruta corta y privada bajo `/tmp`, evitando el límite de rutas Unix de macOS.

## 0.4.0 — 2026-09-20

### Agregado

- Explorador remoto acoplable y redimensionable mediante `/usr/bin/sftp`.
- Navegación, archivos ocultos, creación de carpetas, movimiento, renombrado y eliminación confirmada.
- Subida por selector o arrastrar y soltar, y descarga con destino elegido por el usuario.
- Cola serial de transferencias con progreso, cancelación e historial de la sesión.

### Seguridad

- SFTP reutiliza el socket OpenSSH existente con autenticación no interactiva y reenvíos desactivados.
- Las rutas remotas se validan y se envían como argumentos escapados del cliente SFTP.
- Las transferencias locales se limitan temporalmente a archivos elegidos explícitamente por el usuario.
- Las operaciones destructivas requieren confirmación y no eliminan carpetas con contenido.

### Corregido

- Las funciones auxiliares ahora utilizan el mismo identificador que la pestaña SSH, manteniendo telemetría, ruta y SFTP correctamente asociados.

## 0.3.0 — 2026-09-20

### Agregado

- Directorio remoto independiente por pestaña mediante OSC 7.
- Métricas de CPU y RAM de baja frecuencia para Linux y macOS remotos.
- Canal de telemetría no interactivo sobre multiplexación OpenSSH.
- Caché compartida de métricas para sesiones del mismo servidor.
- Script seguro para actualizar builds alpha instalados localmente.

### Seguridad

- La telemetría utiliza un comando fijo de sólo lectura y nunca escribe en la terminal interactiva.
- El proceso auxiliar usa `BatchMode=yes`, desactiva redirecciones y no puede solicitar credenciales.
- Las rutas OSC 7 se validan como URI `file://` absolutas y no se ejecutan.
