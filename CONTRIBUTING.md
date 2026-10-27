# Contributing

## First PR in 20 minutes

- Add a labelled corpus line for a refusal or missed refusal; preserve it as a permanent check.

| Step | Command or file |
|---|---|
| 1. Fork and clone | `git clone <your fork>` |
| 2. Prove the suite is green first | `npm test` |
| 3. Add one case | a line in `tooling/corpus/guard-corpus.jsonl`: `id`, `category`, `tool`, `input`, `want`, `origin`, `note` |
| 4. Add the same call to the suite | the matching list in `tooling/test/guard.test.mjs`, one entry, never a new `describe` |
| 5. Score it | `npm run eval` — exits 1 on a miss |
| 6. Open the PR | the checklist in `.github/PULL_REQUEST_TEMPLATE.md` |

| Corpus field | Value |
|---|---|
| `want` | `block` or `allow` — what the guard must do |
| `origin` | `spec` derived from a rule · `probe` found by probing · `regression` reproduces a shipped bug |
| `known_gap` | `true` only for a documented evasion; those score apart |

## Labels

| Label | Use |
|---|---|
| `good first issue` | one corpus line, one doc fact, or one pattern with a named example |
| `help wanted` | scoped, no owner |
| `false-block` | the guard stopped a safe call |
| `missed-block` | the guard let an outward or destructive call through |
| `docs` | a fact is wrong, stale, or has two homes |

## Credits

| Handle | First PR | What |
|---|---|---|
| — | — | — |

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
| `docs/` | generated manifest and demo, workflow, plan, benchmark method |
| `audit/` | `YYYY-MM.jsonl`, fields in `scripts/audit.mjs` as `FIELDS`; append-only; holds from `guard.mjs`, cumulative `action: session` rows from `receipt.mjs` on every `Stop` with at least one API call, the last row per session wins; lands in `SERIO_OS_DIR`, else the plugin data dir (`CLAUDE_PLUGIN_DATA`, `PLUGIN_DATA`), else `~/.serio-focus`; never the project |

| Command | Effect |
|---|---|
| `claude --plugin-dir plugins/serio-focus` | run this checkout as the plugin for one session; hooks load once at start |
| `npm run setup -- --host codex` | Register the local marketplace and install through native Codex commands; review hook trust |
| `npm run setup -- --host claude` | Register the local marketplace and install through native Claude commands |
| `npm run install:plugin -- --host codex` | Install this checkout through the native host CLI; restart to load |
| `npm run upkeep` | regenerate `docs/MANIFEST.md`, manifests, the BENCHMARK result block and the demo |
| `npm run upkeep:check` | Fail when generation changes saved artifacts; allow unrelated existing diffs |

## Tests

| Suite | Runner |
|---|---|
| One file, `tooling/test/guard.test.mjs` | `npm test`, Node built-in runner |
| Corpus case only | `npm run eval` |

## Releases

```bash
npm run release patch "one-line note"
```

| Release step | Effect |
|---|---|
| Suite | runs |
| Version | bumps |
| Manifests, MANIFEST, BENCHMARK block and demo | regenerate |
| Changelog | updates |

| Bump | Earns it |
|---|---|
| `patch` | a guard bug only — a false block or a missed block |
| `minor` | any behaviour or default change: new hook, new matcher, new host |

| Cadence | Rule |
|---|---|
| Frequency | one release per week at most, batched from `main` |
| Every release | `npm run release`, then merge to `main`; CI tags `v<version>` and publishes the GitHub Release from the CHANGELOG row after every check passes |

| Rule | Value |
|---|---|
| Setup | `--host claude` by default, `--host codex` for Codex; `npm run sync` merges the `.claude/settings.json` permissions into user settings, only when requested |
| Reports | [SECURITY.md](SECURITY.md) |
| Git | Commit and push run; deletes git cannot restore and git wipes ask first |
| Connectors | no connector rule ships |
