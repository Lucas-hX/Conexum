# Remote directory integration

Conexum can show the current directory of each tab when the remote shell emits the standard **OSC 7** sequence. This integration is optional, does not run periodic queries, and never inspects the text rendered in the terminal.

Your server may already emit OSC 7. If so, no changes are necessary. If the status bar still shows `Path —`, select that text in Conexum to open ready-to-copy snippets for Bash, Zsh, and Fish. Paste the matching snippet into the SSH terminal to try it in that session, then add it to the indicated startup file to keep it.

A new SSH process cannot reliably read the directory of another interactive terminal. Therefore, opening SFTP or Editor cannot force a `pwd` request in the tab without help from the remote shell. When no path is reported, both tools open directly in the remote home directory, and you can navigate elsewhere by entering an absolute path. Conexum never sends commands to your terminal: the integration is voluntary and visible.

## Zsh

Add to `~/.zshrc`:

```zsh
function _conexum_osc7_precmd() {
  printf '\e]7;file://%s%s\e\\' "$HOST" "$PWD"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _conexum_osc7_precmd
```

## Bash

Add to `~/.bashrc`:

```bash
__conexum_osc7() {
  printf '\e]7;file://%s%s\e\\' "$HOSTNAME" "$PWD"
}
PROMPT_COMMAND="__conexum_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
```

## Fish

Add to `~/.config/fish/config.fish`:

```fish
function __conexum_osc7 --on-event fish_prompt
  printf '\e]7;file://%s%s\e\\' (hostname) $PWD
end
```

Open a new SSH session after changing the configuration. Each directory change will appear in the status bar after the next prompt is drawn.

## Privacy and security

- The path is received as a semantic event from the terminal emulator.
- Conexum does not record keystrokes or inspect visible xterm content.
- The path exists only in memory while the tab remains open.
- A received path is limited to an absolute `file://` URI and is never executed as a command.
