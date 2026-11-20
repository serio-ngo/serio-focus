---
name: tooling-cli
description: Use when editing tooling/cli/serio.mjs or tooling/cli/generate.mjs, the repository CLI behind the npm scripts. Covers commands, the shared JSON reader and Claude binary lookup.
---

| Command | npm script |
|---|---|
| `serio.mjs prove/setup/sync/doctor/release` | `prove`, `setup`, `sync`, `doctor`, `release` |
| `serio.mjs install` | `install:plugin` |
| `serio.mjs upkeep [--check]` | `upkeep`, `upkeep:check` |
| `serio.mjs archive <session id> [--repo <owner/name>]`: archives through the plugin's `publish.mjs --session`; prints `no session <id>` and exits 1 for an unknown session | none |

## generate.mjs exports

| Export | Contract |
|---|---|
| `read(...parts)` | repo-relative path to UTF-8 text |
| `readJsonFile(file, fallback?)` | absolute path to parsed JSON; see rules |
| `skills`, `agents`, `codexRoles`, `startupChars`, `inventory`, `manifest` | generated artefact data from a root |

## Rules

| Rule | Detail |
|---|---|
| One JSON reader | `readJsonFile` in generate.mjs; empty text returns the fallback or `{}` |
| Missing or bad file | missing file returns the fallback when given; otherwise throws Error `cannot read <file>`; invalid JSON throws `failed to parse <file>` |
| All JSON reads use it | marketplace.json, settings.json, plugin.json, package.json, hooks.json, ownership file |
| No other parse | no `JSON.parse` of file content in tooling/cli |
| Claude binary | one helper in serio.mjs for install and doctor: `CLAUDE_CODE_EXECPATH`, else `~/.local/bin/claude` (`claude.exe` on win32) if it exists, else `claude` |
| Plugin version | see the plugin-lib skill |
