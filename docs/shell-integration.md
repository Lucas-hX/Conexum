# Integración del directorio remoto

Conexum puede mostrar el directorio actual de cada pestaña cuando el shell remoto emite la secuencia estándar **OSC 7**. La integración es opcional, no ejecuta consultas periódicas y Conexum no inspecciona el texto renderizado de la terminal.

Es posible que el servidor ya emita OSC 7. En ese caso no hace falta modificar nada. Si la barra inferior continúa mostrando `Ruta —`, agregá el fragmento correspondiente en el servidor remoto.

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

