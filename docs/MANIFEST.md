# Manifest

<sub><b>Answers</b> · everything the plugin loads at version 1.12.5 · generated, `npm run upkeep` rewrites it · <a href="../README.md">README</a></sub>

## Skills

| Skill | Description chars, always in context | Body lines, on use |
|---|---|---|
| `plan-session` | 85 | 60 |
| `research-budget` | 84 | 70 |

## Agents

| Agent | model | Tools |
|---|---|---|
| `runner` | haiku | Bash, Read, Grep, Glob |
| `scout` | haiku | Read, Grep, Glob, WebFetch |

## Hooks

| Event | Matcher | Script |
|---|---|---|
| `PreToolUse` | `^(Read\|Bash\|PowerShell\|Task\|Agent\|Workflow)` | `scripts/guard.mjs` |
| `SessionStart` | `startup\|resume\|clear\|compact\|fork` | `scripts/card.mjs` |
| `Stop` | `*` | `scripts/verify.mjs` |

## Inventory

| What ships | Count |
|---|---|
| Guard logic, agent-affecting only | **755** lines across 10 flow files |
| Stats, receipts, adapters (`audit`, `card`, `ledger`, `transcript`) | excluded from the count |
| Pattern rules | **34** |
| Hooks | **3** handlers on 3 events |
| Skills | **2** |
| Subagents | **2** |
| Third-party packages | **0** |
| Network calls, API keys, model calls | **0** |
