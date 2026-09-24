<div align="center">
  <img src="public/brand/conexum-icon.png" width="104" alt="Conexum logo" />
  <h1>Conexum</h1>
  <p><strong>A simple SSH connection manager for macOS.</strong></p>
  <p>A quiet, terminal-first visual interface for organizing and using SSH connections without replacing the system tools you already trust.</p>
</div>

![Conexum welcome banner](public/brand/conexum-welcome-banner.png)

> [!IMPORTANT]
> Conexum is in **early alpha**. You can build a local app for testing, but it is not yet signed or notarized for public distribution.

## What is Conexum?

Conexum is an SSH connection manager inspired by the clarity of mRemoteNG and MobaXterm, designed specifically for macOS. It can also open a local terminal on your Mac. The terminal remains the primary workspace; the SFTP browser, remote editor, and observability tools appear only when you need them.

The project does not reinvent security-sensitive protocols. Connections, keys, agents, and host verification are delegated to the OpenSSH installation included with macOS.

## Current status

- Real SSH connections through `/usr/bin/ssh` and `node-pty`.
- An integrated local terminal using the macOS shell, available by default in a group named after your Mac.
- Multiple independent sessions in compact tabs integrated into the macOS title bar, including multiple sessions to the same server.
- A two-terminal split view or a grid of up to four open sessions.
- A simplified Home screen with quick access to the local terminal and up to three SSH connections.
- A unified title bar with compact session tabs, connection controls, and accessible tool descriptions.
- Profiles organized into groups that start collapsed.
- Visual profile creation and editing.
- Connection duplication from the right-click menu for quickly reusing a server with another username or configuration.
- Import from an SSH config file.
- Support for username, host, port, alias, and `IdentityFile`.
- Integration with `ssh-agent` and macOS Keychain for passphrases.
- A collapsible, resizable sidebar that becomes a temporary overlay when hidden.
- Individual session closing with confirmation.
- Connection groups that can be renamed or deleted from their context menu.
- Native Conexum identity in the window, Dock, menus, and About dialog.
- Automated tests for SSH arguments, IPC validation, and session cleanup.
- Reproducible local packaging as `Conexum.app`.
- Automated validation and test packaging in GitHub Actions.
- A separate remote directory per tab through OSC 7.
- Discreet CPU and RAM metrics for the active tab every nine seconds.
- A safe local updater for alpha builds installed on macOS.
- A dockable SFTP browser with navigation, transfers, and safe file operations.
- Versioned profile backup and import that never includes passwords or private keys.
- Copyable connection diagnostics that never capture terminal content.
- An integrated, resizable editor beside the terminal with an SFTP tree, Monaco, tabs, and safe remote saving.
- English as the default interface language, with Spanish available from **Settings → Language**.
- Coordinated built-in themes for the interface, terminal, and editor: Conexum Dark, Midnight Blue, and Graphite.

Code signing and notarization, advanced editor features, and other improvements in the [roadmap](ROADMAP.md) are still pending.

## Requirements

- macOS on Apple Silicon or Intel.
- Node.js 22 or later.
- pnpm.
- OpenSSH, included with macOS.

The easiest way to install Node.js and pnpm is with Homebrew:

```bash
brew install node pnpm
```

## Development setup

```bash
git clone https://github.com/Lucas-hX/Conexum.git
cd Conexum
pnpm install
pnpm run rebuild:native
pnpm run desktop
```

`rebuild:native` recompiles `node-pty` for the Electron version used by the project. You normally need to run it only after installing or updating dependencies.

## Useful commands

```bash
# Build and validate TypeScript
pnpm run build

# Run automated tests
pnpm run test

# Run tests and the production build
pnpm run check

# Open the UI in a browser without real SSH connections
pnpm run dev

# Build and run the complete Electron app
pnpm run desktop

# Generate an unsigned local app
pnpm run package:mac

# Update, validate, package, and install the latest main branch
pnpm run update:local
```

Real SSH connections are available only in Electron. The browser version is intended for interface development and review.

The local package is generated at `release/mac-arm64/Conexum.app` on Apple Silicon or the corresponding Intel directory. Because the app is unsigned, macOS may request extra confirmation before opening it. Pull requests and changes to `main` run the same checks in GitHub Actions and produce a downloadable test ZIP for 14 days.

## Alpha updates

The `scripts/update-conexum.command` file automates local updates from source. Open it from Finder or run:

```bash
pnpm run update:local
```

The updater:

1. requires a clean `main` branch;
2. downloads only the latest fast-forward update from `origin/main`;
3. installs dependencies locked by `pnpm-lock.yaml`;
4. runs tests, builds, and packages `Conexum.app`;
5. verifies that Conexum is closed;
6. replaces `/Applications/Conexum.app` and restores the previous copy if installation fails;
7. opens the new version.

Profiles remain in Application Support and are not part of the replaced app bundle. To use another location, set `CONEXUM_APP_PATH` to an absolute path ending in `Conexum.app`.

This mechanism is intended for maintainers and contributors during the alpha stage. A future public updater will require signing, notarization, and versioned releases.

## Local terminal, directories, and remote metrics

The group named after your Mac can open any number of independent local terminals without creating an SSH profile or connecting to `localhost`. Each tab runs `/bin/zsh` in a pseudo-terminal. Conexum checks its directory locally at a low frequency without sending shell commands or recording what you type. The local profile is excluded from SSH backups. SFTP, the remote editor, and SSH diagnostics are available only for remote sessions.

The status bar shows the current directory when a remote shell emits OSC 7. See the [optional Bash, Zsh, and Fish setup](docs/shell-integration.md).

Conexum checks CPU and RAM about every nine seconds for the visible tab only. It reuses the session's multiplexed SSH socket, runs a fixed read-only command, and shares the result between tabs connected to the same server. It never injects commands into the interactive terminal. Linux and macOS hosts are supported; the first CPU reading is `—` until a second sample is available.

## SFTP browser

With an active SSH session, select the **SFTP** folder icon to open the side panel. The browser starts in the last path reported by that tab through OSC 7. If no path is available, it opens the remote home directory without interrupting you. The selected folder remains open while you browse, even if the terminal directory changes.

The panel can:

- navigate with breadcrumbs, double-click, the Home button, or an absolute path;
- sort by name, size, permissions, owner, or date;
- show or hide hidden files;
- create folders;
- rename or move files and folders;
- delete files or empty folders with confirmation;
- upload files through the picker or drag and drop from Finder;
- download files to a selected local destination;
- monitor and cancel transfers in a compact queue;
- open text files directly in Conexum Editor;
- close or resize without interrupting the terminal.

Conexum uses `/usr/bin/sftp` and the existing session's multiplexed socket. It neither stores credentials nor implements the SFTP protocol itself. Local files can be transferred only after you explicitly select them with Finder, a macOS dialog, or drag and drop.

Canceled transfers may leave a partial file on the server or in the local folder. Conexum leaves it visible so you can inspect, retry, or delete it; it never removes partial files automatically. Failed and canceled transfers include a retry button. Retrying validates the local path again and starts a new transfer without attempting to merge partial data.

## Backups and diagnostics

The Settings menu can export and import Conexum connections. A backup includes names, groups, destinations, ports, usernames, and configured paths, but never passwords, passphrases, or private-key contents. Exported files use restrictive local permissions.

With a tab selected, **SSH diagnostics** shows only sanitized profile and OpenSSH process data: destination, port, username, IdentityFile, status, and exit code. **Copy diagnostics** never includes terminal content or keystrokes.

## Themes and connection duplication

Choose **Settings → Theme** to switch between **Conexum Dark**, **Midnight Blue**, and **Graphite**. The selection is saved locally and applies immediately to the application chrome, open terminals, and Conexum Editor without reconnecting a session.

Right-click an SSH connection and choose **Duplicate…** to prepare a new profile with the same group, destination, port, username, and configured key path. The copy receives a new identifier and opens in the connection form so you can change its name, username, or other settings before saving. As with every Conexum profile, no password, passphrase, or private-key content is copied or stored.

## Conexum Editor

With an active SSH session, select **Editor** or open a file from SFTP. The editor appears inside Conexum beside the terminal, and you can drag the divider to resize it. Its tree starts at the most recent path reported through OSC 7 or at the remote home directory. You can enter another absolute path and press Enter or the arrow button; Home returns to the remote user's home directory. Opening Editor from SFTP preserves the browsed folder, and opening a file shows its parent folder. The editor reuses the existing multiplexed connection and does not request credentials again.

The first version includes:

- an on-demand remote SFTP tree;
- multi-file selection with queued uploads and downloads, including individual progress for each file;
- document tabs and Monaco syntax highlighting;
- search, replace, line numbers, and standard editing shortcuts;
- remote saving with `⌘S`;
- fingerprint verification before overwriting;
- confirmation if the server copy changed;
- replacement through a remote temporary file while preserving permissions;
- confirmation before closing documents, the editor, an SSH tab, or Conexum with pending changes;
- a **Full terminal** button that hides the editor without losing drafts, while X and `⌘W` close it with confirmation when necessary;
- rejection of binary, non-UTF-8, or larger-than-2-MB files.

The editor requires an active SSH session. If the session ends, open content remains visible, but you must reconnect before browsing or saving again.

## First use

1. Run `pnpm run desktop`.
2. Double-click **Local terminal** to use this Mac, or create/import an SSH connection.
3. Double-click a server to open an SSH session.
4. Double-click it again to open another independent session to the same server.
5. Hover a session tab for a safe status preview; use its close button or double-click the tab to end it with confirmation.

If a connection ends, use **Reconnect** in the terminal or toolbar. Conexum keeps the tab's visible history and opens a new SSH session with the same profile.

With two or more sessions open, **Split** shows two terminals side by side. Select it again for a grid of up to four sessions; a third selection returns to a single view. The active session always remains in the split view, and you can switch sessions from the title-bar tabs or by selecting another terminal. When tabs exceed the available width, they remain horizontally scrollable and are also available from the overflow menu.

Select the Conexum logo to return Home. When the connections sidebar is hidden, its title-bar button opens a temporary overlay without reducing the terminal width; use the pin button in the overlay to keep it open. Session hover previews show only connection metadata, status, current directory, and available CPU/RAM metrics—they never capture terminal content or keystrokes.

Right-click a connection to open a new session, duplicate it, or edit its settings. Right-click a group name to rename or delete it. Deleting a group removes its saved profiles but does not interrupt sessions that are already open.

## Security

- Conexum does not store SSH passwords.
- Private keys are never copied; only the `IdentityFile` path is retained.
- `ssh-agent` and macOS Keychain can manage passphrases.
- Password prompts, new fingerprints, and OpenSSH warnings appear directly in the terminal.
- The Electron renderer has no direct access to Node.js or the filesystem.
- All privileged communication goes through a small, validated preload API.
- Telemetry uses a separate non-interactive SSH process and cannot request credentials.
- Remote directories arrive through OSC 7; Conexum does not scrape the terminal screen or record keystrokes.
- The local directory is checked with `lsof` against the shell process every two seconds while the local tab is visible.
- SFTP runs in a separate process with `BatchMode=yes`, without forwarding ports or requesting new credentials.
- Deleting remote content always requires confirmation, and folders are removed only when empty.
- The editor checks for conflicts before saving and never silently overwrites a different remote version.

Never include passwords, private keys, or sensitive information in bug reports.

## Contributing and testing

Before submitting changes:

```bash
pnpm install
pnpm run rebuild:native
pnpm run check
pnpm run desktop
```

When testing a feature, include:

- Mac model and macOS version;
- Apple Silicon or Intel architecture;
- Node.js and pnpm versions;
- remote shell;
- reproduction steps;
- expected and observed results.

The minimum desktop test matrix is:

| Area | Apple Silicon | Intel |
| --- | --- | --- |
| Home and navigation | Required before release | Contributor verification |
| Two sessions using one profile | Required before release | Contributor verification |
| Close one tab without affecting another | Required before release | Contributor verification |
| SSH config and IdentityFile import | Required before release | Contributor verification |
| Build and open `Conexum.app` | Automated and manual | Contributor verification |

The automated workflow validates the GitHub-hosted macOS environment. Apple Silicon and Intel must also be tested manually on real hardware before a public release.

Contributions should preserve the project's core principles: terminal first, low visual noise, reuse mature tools, and never store secrets insecurely.

## Technology

- Electron
- React + TypeScript
- Vite
- xterm.js
- node-pty
- macOS OpenSSH
- Lucide Icons

## Documentation

- [Roadmap and proposed backlog](ROADMAP.md)
- [Original vision and specification](idea.md)
- [OSC 7 integration for Bash, Zsh, and Fish](docs/shell-integration.md)
- [Changelog](CHANGELOG.md)

## Distribution status

`pnpm run package:mac` generates a local bundle identified as Conexum. This package is intended for development and testing among contributors; it is not yet signed, notarized, or distributed with an installer. Those steps remain planned before public distribution.
