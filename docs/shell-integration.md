# Integración del directorio remoto

Conexum puede mostrar el directorio actual de cada pestaña cuando el shell remoto emite la secuencia estándar **OSC 7**. La integración es opcional, no ejecuta consultas periódicas y Conexum no inspecciona el texto renderizado de la terminal.

Es posible que el servidor ya emita OSC 7. En ese caso no hace falta modificar nada. Si la barra inferior continúa mostrando `Ruta —`, hacé clic en ese texto dentro de Conexum: la aplicación muestra los bloques para Bash, Zsh y Fish, listos para copiar. Pegá el bloque en la terminal SSH para probarlo en esa sesión; después agregalo al archivo de inicio indicado para conservarlo.

Una consulta SSH nueva no puede leer de forma confiable el directorio de otra terminal interactiva. Por eso abrir SFTP o Editor no puede «forzar» un `pwd` de la pestaña sin cooperación del shell remoto. Cuando no hay ruta informada, ambos se abren directamente en el home remoto y podés cambiar de carpeta escribiendo una ruta absoluta en su explorador. Conexum no envía comandos a tu terminal: la integración es voluntaria y visible.

## Zsh

Agregar a `~/.zshrc`:

```zsh
function _conexum_osc7_precmd() {
  printf '\e]7;file://%s%s\e\\' "$HOST" "$PWD"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _conexum_osc7_precmd
```

## Bash

Agregar a `~/.bashrc`:

```bash
__conexum_osc7() {
  printf '\e]7;file://%s%s\e\\' "$HOSTNAME" "$PWD"
}
PROMPT_COMMAND="__conexum_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
```

## Fish

Agregar a `~/.config/fish/config.fish`:

```fish
function __conexum_osc7 --on-event fish_prompt
  printf '\e]7;file://%s%s\e\\' (hostname) $PWD
end
```

Abrí una sesión SSH nueva después de modificar la configuración. Cada cambio de directorio aparecerá en la barra inferior después de dibujarse el siguiente prompt.

## Privacidad y seguridad

- La ruta se recibe como un evento semántico del emulador de terminal.
- No se registran pulsaciones ni se analiza el contenido visible de xterm.
- La ruta sólo vive en memoria mientras la pestaña permanece abierta.
- Una ruta recibida se limita a un URI `file://` absoluto y nunca se ejecuta como comando.
