# Tick — Obsidian plugin

Quick to-do capture and toggle on a local markdown file inside your vault.
Companion to [tick-tui](https://github.com/al4danim/tick-tui) — both read/write the same `tasks.md`. Works on desktop and mobile.

No server. No HTTP. Direct vault file IO. The plugin auto-refreshes when the file changes (so Obsidian Sync deltas from another device show up immediately).

## Features

- **Tick: Add todo** — opens the today panel and starts an inline add row.
- **Tick: Open today** — side panel with pending list + today's done list. Tap checkbox to toggle. Tap row text to edit / delete inline.

## File format

Lines in `tasks.md`:

```
- [ ] buy milk @home +2026-05-01 [a3k7m2x9]
- [x] write report @work +2026-04-29 *2026-04-30 [b1d4e5f0]
```

| token | meaning |
|---|---|
| `- [ ]` / `- [x]` | status |
| description | task title |
| `@project` | optional project |
| `+YYYY-MM-DD` | created date |
| `*YYYY-MM-DD` | done date (only when `[x]`) |
| `[hex]` | 8-char hex ID, **must be at end of line** |

The `tick-tui` CLI owns the 7-day rolling archive sweep. This plugin only edits `tasks.md`; older done rows get moved to `archive.md` automatically next time you launch `tick-tui`.

## Installation

### BRAT (recommended for now)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat).
2. BRAT → Add Beta Plugin → `al4danim/tick-obsidian`.
3. Enable Tick under Settings → Community plugins.

### Manual

```sh
git clone https://github.com/al4danim/tick-obsidian
cd tick-obsidian
npm install
npm run build

mkdir -p /path/to/vault/.obsidian/plugins/tick
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/tick/
```

Then **Settings → Community plugins → enable "Tick"**.

### Development (live reload)

```sh
git clone https://github.com/al4danim/tick-obsidian
cd tick-obsidian
npm install
ln -s "$(pwd)" /path/to/vault/.obsidian/plugins/tick
npm run dev
```

## Configuration

**Settings → Tick**:

| Setting | Default | Description |
|---|---|---|
| Tasks file | `.tick/tasks.md` | Vault-relative path to the markdown file |

The default lives in a dot-prefixed folder so Obsidian's file browser hides it (avoids accidental edits). Match this path in your `tick-tui` CLI config so both clients read the same file.

## Commands

| Command | Description |
|---|---|
| `Tick: Add todo` | Open the today panel and start adding |
| `Tick: Open today` | Open today's panel in the right sidebar |

## License

MIT
