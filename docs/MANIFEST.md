# Manifest

<sub><b>Answers</b> · everything the plugin loads at version 1.18.0 · generated, `npm run upkeep` rewrites it · <a href="../README.md">README</a></sub>

## Skills

| Skill | Description chars, always in context | Body lines, on use |
|---|---|---|
| `plan-session` | 85 | 59 |
| `research-budget` | 84 | 76 |

## Agents

| Agent | model | Tools |
|---|---|---|
| `runner` | haiku | Bash, Read, Grep, Glob |
| `scout` | haiku | Read, Grep, Glob, WebFetch |
| `worker` | sonnet | Read, Grep, Glob, Bash, Edit, Write, WebSearch, WebFetch |

## Hooks

| Event | Matcher | Script |
|---|---|---|
| `PreToolUse` | `^(Read\|Bash\|PowerShell\|Task\|Agent\|Workflow\|WebSearch\|WebFetch)$` | `scripts/guard.mjs` |
| `SessionStart` | `startup\|resume\|clear\|compact\|fork` | `scripts/card.mjs` |
| `StopFailure` | `*` | `scripts/rescue.mjs` |
| `Stop` | `*` | `scripts/verify.mjs` |

## Inventory

| What ships | Count |
|---|---|
| Guard logic, agent-affecting only | **891** lines across 11 flow files |
| Stats, receipts, adapters (`audit`, `card`, `ledger`, `transcript`) | excluded from the count |
| Pattern rules | **43** |
| Hooks | **4** handlers on 4 events |
| Skills | **2** |
| Subagents | **3** |
| Third-party packages | **0** |
| Network calls, API keys, model calls | **0** |
