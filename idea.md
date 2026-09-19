# Conexum

## Visión

Conexum será una aplicación de escritorio para macOS centrada en administrar conexiones SSH de forma visual, rápida y segura. La terminal es el espacio de trabajo principal. El gestor de conexiones, SFTP, el editor remoto y las transferencias son herramientas auxiliares que pueden abrirse, cerrarse, acoplarse o separarse sin interrumpir las sesiones.

La referencia funcional es la claridad de herramientas como mRemoteNG y MobaXterm, con una interfaz moderna, compacta y propia de macOS. Conexum no busca reemplazar un IDE completo ni incorporar todos los protocolos posibles.

## Principios del producto

1. **Terminal primero:** la terminal debe ocupar la mayor parte de la ventana y nunca quedar relegada por paneles secundarios.
2. **Complejidad progresiva:** las herramientas aparecen cuando se necesitan y permanecen ocultas el resto del tiempo.
3. **Una conexión, varias herramientas:** terminal, SFTP y editor comparten el mismo perfil y la configuración SSH del sistema.
4. **Seguridad local:** secretos en Keychain, validación de huellas y ninguna contraseña en archivos o registros.
5. **Interfaz compacta:** alta densidad de información, atajos de teclado y poco espacio desperdiciado.
6. **Base reutilizable:** delegar SSH, claves, agentes y huellas en OpenSSH de macOS; Conexum no implementará protocolos criptográficos.

## Alcance aprobado para la versión 1

### Conexiones

- Crear, editar, duplicar y eliminar conexiones SSH.
- Organizar conexiones en carpetas o grupos.
- Contraer, expandir y redimensionar el árbol de conexiones.
- Conectar mediante doble clic sobre un servidor.
- Buscar y marcar favoritos.
- Importar configuraciones desde `~/.ssh/config`.
- Crear una carpeta individual por cada entrada `Host` importada.
- Editar perfiles mediante un menú contextual, incluso cuando proceden de un archivo SSH config.
- Autenticación por contraseña, clave privada y `ssh-agent`.
- Selección visual de `IdentityFile` sin copiar ni almacenar la clave privada.
- Solicitud guiada de IdentityFile cuando OpenSSH informa un fallo de autenticación por clave.
- Puertos personalizados y soporte básico para jump hosts.
- Recordar conexiones recientes.

### Terminal

- Varias sesiones en pestañas.
- Divisiones horizontales y verticales.
- Copiar, pegar, buscar y seleccionar texto.
- Reconexión manual y automática.
- Colores, tipografía, tamaño y cursor configurables.
- Compatibilidad con programas interactivos como `vim`, `tmux`, `top` y `htop`.
- Terminal a pantalla completa ocultando todos los paneles.

### SFTP

- Panel opcional lateral, inferior o en una pestaña.
- Abrirlo en una ventana independiente.
- Navegación remota y local.
- Subir, descargar, mover, renombrar y eliminar.
- Arrastrar y soltar.
- Cola de transferencias en segundo plano.
- Progreso, reintentos y mensajes de error claros.

### Editor remoto

- Abrir archivos remotos desde SFTP.
- Resaltado de sintaxis y numeración de líneas.
- Buscar y reemplazar.
- Guardar mediante la conexión SFTP activa.
- Detectar modificaciones externas.
- Confirmar antes de sobrescribir cambios remotos.

### Seguridad

- Contraseñas y frases secretas almacenadas en macOS Keychain.
- Verificación estricta de la huella del servidor.
- Advertencia bloqueante cuando una huella conocida cambia.
- Integración con `ssh-agent`.
- Uso de `UseKeychain=yes` y `AddKeysToAgent=yes` para que OpenSSH recuerde de forma segura la passphrase verificada de una clave.
- Registros sin contraseñas, claves ni contenido sensible.
- Procesos de interfaz y sistema separados mediante una API mínima y validada.

### Aplicación macOS

- Apple Silicon como plataforma inicial; Intel como objetivo de compatibilidad.
- Tema oscuro y claro.
- Atajos de teclado configurables.
- Restaurar pestañas y distribución de paneles.
- Aplicación firmada y notarizada.
- Actualizaciones automáticas en una etapa posterior de la versión 1.

## Fuera del alcance inicial

- RDP, VNC, Telnet, FTP y conexiones seriales.
- Sincronización de credenciales en la nube.
- Colaboración multiusuario.
- Inteligencia artificial integrada.
- Sistema completo de extensiones.
- Reemplazar a Visual Studio Code como IDE.

## Experiencia de usuario

### Ventana principal

- Barra superior compacta con Nueva conexión, Dividir, SFTP, Editor y Ajustes.
- Panel de conexiones plegable a la izquierda, con aproximadamente 18% del ancho.
- Terminal central ocupando alrededor del 80% del espacio útil.
- Pestañas de sesiones sobre la terminal.
- Barra inferior con estado, usuario, host, latencia y transferencias.
- SFTP y Editor cerrados de manera predeterminada.

### Comportamiento de paneles

Cada herramienta secundaria podrá mostrarse como:

- panel lateral;
- panel inferior;
- pestaña del área principal;
- ventana independiente;
- herramienta oculta que continúa trabajando en segundo plano.

La aplicación recordará el último diseño utilizado globalmente y, más adelante, por espacio de trabajo.

## Arquitectura propuesta

### Tecnologías

- **Electron:** contenedor de escritorio y acceso controlado a capacidades del sistema.
- **React + TypeScript:** interfaz y estado visual.
- **xterm.js:** emulación y representación de terminal.
- **OpenSSH de macOS (`/usr/bin/ssh`):** conexión, cifrado, autenticación, claves, agentes, huellas y configuración existente.
- **node-pty:** terminal pseudo-interactiva entre OpenSSH y xterm.js.
- **Monaco o CodeMirror:** editor remoto; se decidirá mediante una prueba de tamaño y rendimiento.
- **Keychain de macOS:** almacenamiento seguro mediante una integración nativa.
- **Vite:** desarrollo y compilación de la interfaz.

### Separación de responsabilidades

```text
Interfaz React
    │ API validada mediante preload
Proceso principal Electron
    ├── Gestor de procesos /usr/bin/ssh mediante node-pty
    ├── Servicio SFTP
    ├── Cola de transferencias
    ├── Keychain
    └── Persistencia de configuración
```

La interfaz no tendrá acceso directo a Node.js, al sistema de archivos ni a secretos. Toda operación privilegiada pasará por comandos explícitos y validados.

### Entidades principales

- `ConnectionProfile`: servidor, puerto, usuario, autenticación, grupo y preferencias.
- `Session`: conexión viva, terminales abiertas, estado y métricas.
- `TerminalPane`: terminal asociada a una sesión y a una división visual.
- `TransferJob`: origen, destino, progreso, estado y reintentos.
- `RemoteDocument`: ruta, versión remota, contenido local y estado de guardado.
- `WorkspaceLayout`: pestañas, divisiones, paneles visibles y tamaños.

## Etapas de construcción

### Etapa 0 — Base visual

- Crear la estructura React, TypeScript y Electron.
- Implementar la ventana principal según el mockup aprobado.
- Integrar xterm.js en modo demostración.
- Añadir árbol de conexiones, pestañas y paneles SFTP/Editor con datos simulados.
- Confirmar compilación y comportamiento adaptable.

### Etapa 1 — Conexión SSH real

- Proceso de sesiones basado en OpenSSH de macOS y `node-pty`.
- Comunicación segura entre Electron y la interfaz.
- Autenticación con clave y contraseña.
- Verificación de huellas.
- Redimensionamiento PTY y cierre limpio de sesiones.

### Etapa 2 — Perfiles y Keychain

- Persistencia local de conexiones sin secretos.
- Integración con Keychain.
- Formularios de alta y edición.
- Importación de `~/.ssh/config`.

### Etapa 3 — SFTP y transferencias

- Explorador remoto.
- Operaciones de archivos.
- Cola persistente y progreso.
- Arrastrar y soltar.

### Etapa 4 — Editor remoto

- Pestañas de documentos.
- Apertura y guardado SFTP.
- Conflictos y cambios externos.
- Preferencias de editor.

### Etapa 5 — Paneles y pulido

- Divisiones de terminal.
- Paneles acoplables y ventanas independientes.
- Restauración de la distribución.
- Atajos, accesibilidad, temas y rendimiento.

### Etapa 6 — Distribución

- Pruebas automatizadas y manuales.
- Empaquetado universal cuando sea viable.
- Firma y notarización.
- Canal de versiones y actualizaciones.

## Criterios de aceptación de la versión 1

La primera versión estará completa cuando el usuario pueda:

1. Crear una conexión y guardar sus secretos de forma segura.
2. Abrir varias sesiones SSH estables en pestañas y divisiones.
3. Ejecutar aplicaciones de terminal interactivas sin problemas visuales.
4. Transferir archivos por SFTP y observar su progreso.
5. Editar y guardar un archivo remoto con protección ante conflictos.
6. Ocultar todos los paneles y trabajar únicamente con la terminal.
7. Cerrar y volver a abrir Conexum conservando conexiones y distribución.
8. Instalar una aplicación macOS firmada sin pasos técnicos adicionales.

## Estado actual

- Alcance de versión 1 aprobado.
- Mockup “terminal primero” aprobado.
- Etapa 0 iniciada.
- Conexión SSH real funcionando mediante OpenSSH de macOS.
- Perfiles agrupados, carpetas plegables, panel lateral redimensionable y conexión por doble clic.
- Selección de IdentityFile e importación inicial de archivos SSH config implementadas.
- Importación por carpeta, edición contextual y recuperación guiada ante claves faltantes implementadas.
- Inicio visual con conexiones recientes e identidad propia implementado.
- Sesiones SSH independientes por pestaña, incluyendo varias instancias del mismo servidor, implementadas.
- Las carpetas se inician contraídas y las sesiones continúan activas al visitar Inicio.
