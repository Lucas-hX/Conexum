# Changelog

Todos los cambios relevantes de Conexum se documentan en este archivo.

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
