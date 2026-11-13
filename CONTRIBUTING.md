# Contributing

## Scope

| Rule | Value |
|---|---|
| Applies | every repository the plugin runs in |
| Local rules | that codebase's own `AGENTS.md` or `CLAUDE.md`, never here |
| Reuse | check Claude Code built-ins and public plugins first |
| New skill | on second occurrence of the pattern only |
| Product description | Edit `plugins/serio-focus/.claude-plugin/plugin.json`; `npm run upkeep` copies it to package, marketplace and Codex metadata |

## Code

- Rules: [AGENTS.md](AGENTS.md). Scripts do deterministic work, never models.

## Layout

| Path | Contents |
|---|---|
| `plugins/serio-focus/` | the plugin, the only shipped tree; inventory in `docs/MANIFEST.md` |
| `.agents/plugins/marketplace.json` | Generated native Codex marketplace; canonical source in `.claude-plugin/marketplace.json` |
| `tooling/` | never ships; [tooling/README.md](tooling/README.md) |
| `docs/` | generated manifest and workflow |
| `audit/` | `YYYY-MM.jsonl`, fields in `scripts/audit.mjs` as `FIELDS`; append-only; cumulative `action: session` rows from `receipt.mjs` on every `Stop` with at least one API call, the last row per session wins; lands in `SERIO_OS_DIR`, else the plugin data dir (`CLAUDE_PLUGIN_DATA`, `PLUGIN_DATA`), else `~/.serio-focus`; never the project |

| Command | Effect |
|---|---|
| `claude --plugin-dir plugins/serio-focus` | run this checkout as the plugin for one session; hooks load once at start |
| `npm run setup -- --host codex` | Register the local marketplace and install through native Codex commands; review hook trust |
| `npm run setup -- --host claude` | Register the local marketplace and install through native Claude commands |
| `npm run install:plugin -- --host codex` | Install this checkout through the native host CLI; restart to load |
| `npm run upkeep` | regenerate `docs/MANIFEST.md` and the manifests |
| `npm run upkeep:check` | Fail when generation changes saved artifacts; allow unrelated existing diffs |
| `npm run verify` | The checks to run before a push; workflow and Markdown lint run in CI only |

## Tests

| Suite | Runner |
|---|---|
| One file, `tooling/test/guard.test.mjs` | `npm test`, Node built-in runner |

## Releases

```bash
npm run release patch "one-line note"
```

| Rule | Value |
|---|---|
| Steps | suite runs, version bumps, manifests and MANIFEST regenerate, changelog updates |
| `patch` | a guard bug only |
| `minor` | any behaviour or default change: new hook, new matcher, new host |
| Frequency | one release per week at most, batched from `main` |
| Every release | `npm run release`, then merge to `main`; CI tags `v<version>` and publishes the GitHub Release from the CHANGELOG row after every check passes |
| Setup | `--host claude` by default, `--host codex` for Codex; `npm run sync` merges the `.claude/settings.json` permissions into user settings, only when requested |
| Reports | [SECURITY.md](SECURITY.md) |
