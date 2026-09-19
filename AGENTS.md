# AGENTS.md

This file defines how coding agents should work in the Conexum repository. It applies to the entire repository unless a more specific `AGENTS.md` is added inside a subdirectory.

## Product mission

Conexum is a terminal-first SSH connection manager for macOS. It should feel focused, native, and quiet: the terminal is the primary workspace, while connection management, SFTP, remote editing, telemetry, and agent context remain secondary tools that appear only when requested.

The project should reuse mature system tools and maintained libraries instead of implementing security-sensitive protocols from scratch.

## Product principles

1. Keep the terminal responsive and visually dominant.
2. Reduce visual noise outside the terminal.
3. Reuse macOS OpenSSH, `ssh-agent`, and Keychain where possible.
4. Never store passwords or private-key contents in application data, source files, logs, fixtures, or issues.
5. Prefer progressive, optional features over permanent panels or background work.
6. Treat remote systems and their files as sensitive user data.
7. Make all destructive remote-file operations explicit and confirmable.
8. Keep the application understandable for contributors who are new to Electron.

## Current architecture

- **Electron** provides the macOS desktop shell and privileged main process.
- **React + TypeScript** implement the renderer UI.
- **Vite** builds the renderer.
- **xterm.js** renders each interactive terminal.
- **node-pty** hosts `/usr/bin/ssh` in a pseudo-terminal.
- **OpenSSH from macOS** handles transport, encryption, authentication, host verification, config files, and agents.
- **Electron preload IPC** is the only bridge between the renderer and privileged capabilities.

Important files:

- `src/App.tsx` — application state, profiles, tabs, sessions, and primary UI.
- `src/styles.css` — visual system and layout.
- `src/conexum.d.ts` — typed preload API available to the renderer.
- `electron/main.cjs` — validated profile operations and SSH process lifecycle.
- `electron/preload.cjs` — minimal renderer-facing API.
- `ROADMAP.md` — planned milestones and issue source.
- `idea.md` — original product vision and broader version-one scope.

## Local setup

Use Node.js 22 or later and pnpm.

```bash
pnpm install
pnpm run rebuild:native
pnpm run build
pnpm run desktop
```

The browser development server is useful for UI work, but real SSH is available only in Electron.

## How to make changes

1. Read `README.md`, `ROADMAP.md`, and the relevant implementation before editing.
2. Check the current Git state and preserve unrelated or user-owned changes.
3. Keep each change focused on one issue or coherent feature.
4. Reuse existing components, colors, spacing, and icon conventions.
5. Add privileged operations to the main process and expose only the smallest required preload method.
6. Validate every value that crosses IPC before using it in a process, command, or file operation.
7. Never build shell command strings from user input. Prefer argument arrays and fixed executable paths.
8. Keep a terminal instance mounted while its tab is open so background sessions remain alive.
9. Scope session-specific state by the unique session ID, not only by connection profile ID. Multiple tabs may use the same profile simultaneously.
10. Update public documentation when behavior, setup, security, or roadmap status changes.

## UI and UX guidance

- Use native macOS typography for application chrome and a monospaced font for terminals and paths.
- Use Lucide icons already included in the project instead of adding unrelated icon styles.
- Avoid persistent large labels, decorative controls, and saturated selection colors.
- New side panels must be optional, closable, and must not interrupt active terminals.
- Prefer a small status value or tooltip over a permanent chart.
- Ensure the sidebar can remain collapsed and that common actions work with double-click or clear buttons.
- Preserve keyboard accessibility, labels, focus states, and useful empty states.

## SSH and security rules

- Do not implement a custom SSH or SFTP protocol.
- Do not copy private keys into the repository or application storage.
- Do not add automatic password entry or log terminal input.
- Keep `contextIsolation` enabled and `nodeIntegration` disabled in the renderer.
- Maintain an allowlisted environment for spawned SSH processes.
- Validate hosts, ports, usernames, paths, session IDs, dimensions, and IPC payload sizes.
- Do not weaken host-key checking to make a connection easier.
- Background telemetry must use a separate or multiplexed SSH channel; it must never inject commands into the user's interactive terminal.
- Agent-awareness features must not capture keystrokes or infer activity by scraping rendered terminal content.

## Validation expectations

For every code change, run:

```bash
pnpm run build
```

For changes involving Electron, SSH, `node-pty`, IPC, window metadata, or session lifecycle, also run:

```bash
pnpm run rebuild:native
pnpm run desktop
```

Test the smallest relevant scenarios, including failure paths. Session-related changes should cover:

- two simultaneous profiles;
- two sessions using the same profile;
- switching to Home without disconnecting;
- reconnecting one failed session;
- closing one tab without affecting another;
- application shutdown with live sessions.

Do not connect to production systems merely to test a change unless an authorized maintainer explicitly requests it.

## Issues, branches, commits, and pull requests

- Use an existing issue when one matches the work; otherwise create a focused issue from `ROADMAP.md`.
- Prefer short branches named by intent, such as `feature/sftp-browser` or `fix/session-cleanup`.
- Write concise imperative commit subjects.
- Pull requests should explain the user-visible result, architecture decisions, security impact, and tests performed.
- Include screenshots for meaningful visual changes.
- Link the relevant issue and update the roadmap when a milestone materially advances.
- Do not combine broad refactors with unrelated product features.

## Repository authority

Authorized maintainers and collaborators may push branches, open pull requests, review, merge, and update `main`. Coding agents acting under an authorized maintainer's explicit direction may also create commits, push branches, open pull requests, and merge them after required checks pass.

Even when authorized:

- do not force-push `main`;
- do not rewrite published history without explicit approval;
- do not merge with failing required checks;
- do not delete branches, releases, issues, projects, or user data unless explicitly requested;
- do not publish credentials, private server details, logs, or local profile data;
- do not make a release, sign binaries, or change repository visibility without explicit approval.

Direct commits to `main` are acceptable for initial repository setup, documentation, and small maintainer-approved changes. Feature development should normally use a pull request so another person or agent can review it.

## Definition of done

A change is complete when:

- the requested behavior works in the intended Electron environment;
- existing connection and session behavior remains intact;
- TypeScript and the production build pass;
- relevant failure and cleanup paths were checked;
- no secrets or local-only artifacts were added;
- documentation and roadmap status are accurate;
- the commit or pull request clearly describes what changed.
