# Changelog

Todos los cambios relevantes de Conexum se documentan en este archivo.

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

