---
name: tooling-cli
description: Use when editing tooling/cli/serio.mjs or tooling/cli/generate.mjs, the repository CLI behind the npm scripts. Covers commands, the shared JSON reader and Claude binary lookup.
---

| Command | npm script |
|---|---|
| `serio.mjs prove/setup/sync/doctor/release` | `prove`, `setup`, `sync`, `doctor`, `release` |
| `serio.mjs install` | `install:plugin` |
| `serio.mjs upkeep [--check]` | `upkeep`, `upkeep:check` |

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
| `serio.mjs setup\|doctor --host claude --adopter <dir>` | `setup` adds `--owner <login>` and skips the native plugin install; writes into `<dir>` only missing files `.github/ISSUE_TEMPLATE/spec.yml`, `.github/CODEOWNERS` (`* @<login>`), `.github/workflows/serio-verify.yml` (`uses:` and trusted script refs pinned `@<release sha>`); prints `wrote <path>` or `kept <path>` per file and `created label <name>` per missing label of `spec-review`, `spec-ok`, `needs-human`; a second run exits 0, changes nothing, creates no label; `doctor` takes the owner from `--owner` when given, else the first owner in the adopter's CODEOWNERS, and a missing owner is a `NO` line, never a usage error; `doctor` checks adopter only: `spec.yml present`, `CODEOWNERS names @<owner>`, `serio-verify.yml pinned to <sha>`, `label <name> exists`; each failure prints the unindented line `NO <check> — <next action>`, exit 1; never rewrites a file or prints a credential value; env `SERIO_GH` is a node script run instead of `gh` with cwd `<dir>` and gh argv (`label list --json name` prints a JSON array of `{name}`; `label create <name>`); env `SERIO_RELEASE_SHA` is 40 hex used instead of `git rev-parse HEAD` |
