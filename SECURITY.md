# Security

| Review before install | Command |
|---|---|
| Hooks | `cat plugins/serio-focus/hooks/hooks.json` |
| Scripts | `cat plugins/serio-focus/scripts/*.mjs plugins/serio-focus/scripts/lib/*.mjs` |
| Suite | `npm test` |

| Report | Rule |
|---|---|
| Channel | GitHub private vulnerability reporting (Security, then Report a vulnerability) |
| Ban | no public issue; no live credentials |
| First response | within 7 days |

## Scope

| Boundary | Rule |
|---|---|
| Surface | Runs only where Claude Code or Codex executes plugin hooks (`SessionStart`, `PreToolUse`), and in OpenCode through `.opencode/`. Claude cloud sessions do not install plugins; Codex cloud tasks are undocumented. |
| Shape | A seatbelt on the agent's tool calls: deletes git cannot restore ask first in Claude and are held in Codex and OpenCode. It is not a sandbox. It does not confine code that was already written, processes the agent spawned, or network calls made by a connector itself. |
| Strength | Shell matching is pattern-based and does not hold against a determined adversary. Use it together with operating system permissions and Claude Code `permissions.deny` rules, not instead of them. |

## Known gaps

<!-- measured 2026-10-13 against `plugins/serio-focus/scripts/guard.mjs`; each row is reproducible with the command below -->

| Gap | Probe | Verdict |
|---|---|---|
| No connector coverage. `judge()` has no `mcp__` branch, so every MCP call passes. | `mcp__gmail__send_message` | Allowed. |
| No read, edit, write, search or web coverage. The `PreToolUse` matcher admits `Bash`, `PowerShell` and spawn tools only. | `Read`, `Write`, `Edit`, `Grep`, `WebFetch` | Allowed. |
| A binary name held in a shell variable is not resolved. | `X=rm; $X -rf docs` | Allowed. |
| A payload decoded inside a pipeline is not followed. | `echo … \| base64 -d \| bash` | Allowed. |
| PowerShell here-string data can be mistaken for shell commands. | Here-string containing `rm -rf node_modules` | May be blocked. |
| Non-recursive and scripted deletes are not judged. | `rm file`, `find . -delete`, `node -e "fs.rmSync(...)"` | Allowed. |
| Nested shells with backslash-escaped quotes, or a third nesting level, are not followed. | `bash -c "bash -c \"rm -rf docs\""` | Allowed. |
| Hook `ask` under `bypassPermissions` is undocumented. | untracked `rm -rf` in a bypass session | Prompt expected, unproven. |

| Gap | Rule behind it |
|---|---|
| Connector calls | `guard.mjs` judges shell and spawn tools only. Connector egress is left to native permission rules; `tooling/settings/policy.json` ships none for `mcp__`. |
| Preview flags | Only narrowly recognized Git previews bypass the locks; ambiguous preview syntax may be held. |

| Check | Command |
|---|---|
| Reproduce a gap | pipe the probe as a `PreToolUse` payload into `plugins/serio-focus/scripts/guard.mjs`; empty stdout means allowed |
| Score the corpus | `npm run eval` |
| Method, last run | [docs/BENCHMARK.md](docs/BENCHMARK.md) |
| After every host update | `npm test` runs the guard on synthetic payloads and checks the hook events and matcher; a changed host field needs a fresh-session check |
