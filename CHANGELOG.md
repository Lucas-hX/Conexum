# Changelog

Todos los cambios relevantes de Conexum se documentan en este archivo.

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
