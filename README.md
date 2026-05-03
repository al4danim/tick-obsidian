# Tick — Obsidian plugin

Quick to-do capture inside your vault. One markdown file, plain text, no server.

Companion to [tick-tui](https://github.com/al4danim/tick-tui) — both clients read and write the same `tasks.md`, so a row added on Obsidian mobile shows up in the Mac terminal and vice versa. Works on Obsidian desktop and mobile.

## Why a "Today" panel + a CLI

`tick-tui` (Go, terminal-only, Mac) owns the heavy lifting:

- assigns IDs to new rows
- runs the 7-day rolling sweep that moves old done rows from `tasks.md` → `archive.md`
- shows long-window stats (streaks beyond 30 days, archive history)

`tick-obsidian` (this plugin) is the **fast-capture / quick-toggle surface** for the same data, optimised for the device you actually have in your hand. It only touches `tasks.md` — never `archive.md`. Rows added here pick up an ID on the Obsidian side too (random 8-char hex), so the two clients can both write without colliding.

If you only use Obsidian (no Mac, no terminal), this plugin works on its own — you just won't see archived rows. Most users don't notice.

## Features

- **Pending list, grouped by `@project`** by default (largest groups first; tasks without a project go last). Toggle off in settings for a flat list.
- **Inline add** — `+` in the header. Sticky: hit Enter to save, the row clears and another phantom appears immediately. Empty Enter or Esc exits.
- **Inline edit** — tap any row's text. Type `something @work` to retag in one shot.
- **Toggle done** — tap the circle. Done rows move to a "Done today" section below the divider. Yesterday's done rows show up underneath, marked `-1d`, so you can un-tick something you finished late.
- **Swipe-to-delete (mobile)** — left-swipe a row past ~40px to reveal a red `Delete`. Tap it to remove the row; a 5-second `Undo` toast lets you take it back. Off in settings if you don't want it.
- **Streak chip** — flame + count of consecutive days with at least one done task (capped at `30+`). Goes dim on a zero-completion day. Long-window streak lives in `tick-tui`'s stats panel.
- **Auto-refresh** — when `tasks.md` changes (Obsidian Sync delta from another device, manual editor edit, this plugin's own writes), the panel re-renders.
- **iOS keyboard avoidance** — the row you're editing stays above the keyboard, even when it's the bottom row of a long list.

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
| `@project` | optional project (last `@xxx` at end of line wins; mid-title `@` stays as text) |
| `+YYYY-MM-DD` | created date |
| `*YYYY-MM-DD` | done date (only present when `[x]`) |
| `[hex]` | 8-char hex ID — **must be at the end of the line** |

Apart from the trailing `[id]`, token order is parser-insensitive — both clients reorder them on save into the canonical form above.

Non-task lines in the file (blank lines, headings, free text) are preserved on save. The plugin only edits the `- [ ]` / `- [x]` lines it recognises.

## Installation

### BRAT (recommended for now)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat).
2. BRAT → Add Beta Plugin → `al4danim/tick-obsidian`.
3. Enable Tick under Settings → Community plugins.

BRAT auto-updates as new versions land. Stable versions also surface in Obsidian's standard plugin gallery once approved.

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

## Settings

**Settings → Community plugins → Tick**:

| Setting | Default | Description |
|---|---|---|
| Tasks file | `tick/tasks.md` | Vault-relative path. Match this in your `tick-tui` config so both clients see the same file. |
| Hide tasks folder from file tree | on | Hides the parent folder of `tasks.md` (e.g. `tick/`) from Obsidian's file explorer, so you can't accidentally edit it. The folder still exists on disk; turn off to see it. |
| Group pending tasks by project | on | Pending list groups by `@project`, largest first; null project last. Off = flat list in insertion order. |
| Swipe row to toggle (mobile) | on | Left-swipe a row past threshold to reveal Delete. Has no effect on desktop. |

> Why the path isn't dot-prefixed: a `.tick/` folder would be hidden by name, but **Obsidian Sync silently skips dot-prefixed folders** — your tasks would never sync. The plugin uses a normal folder + a CSS rule to hide it from the file tree (the "Hide tasks folder" toggle).

## Commands

| Command | Default binding | What it does |
|---|---|---|
| `Tick: List` | none — assign in Hotkeys | Opens (or focuses) the Tick panel in the right sidebar. |

There's also a ribbon icon (check-square) that does the same thing.

## License

MIT
