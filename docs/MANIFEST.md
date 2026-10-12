# Manifest

<sub><b>Answers</b> · everything the plugin loads at version 1.21.0 · generated, `npm run upkeep` rewrites it · <a href="../README.md">README</a></sub>

## Hooks

| Event | Matcher | Script | Native host |
|---|---|---|---|
| `PreToolUse` | `^(Read\|Bash\|PowerShell\|Task\|Agent\|spawn_agent\|WebSearch\|WebFetch)$` | `scripts/guard.mjs` | Claude, Codex |
| `SessionStart` | `startup\|resume\|clear\|compact\|fork` | `scripts/card.mjs` | Claude, Codex |
| `StopFailure` | `*` | `scripts/rescue.mjs` | Claude |
| `Stop` | `*` | `scripts/verify.mjs` | Claude, Codex |

## Inventory

| What ships | Count |
|---|---|
| Guard logic, agent-affecting only | **693** lines across 9 flow files |
| Stats, receipts, adapters (`audit`, `card`, `ledger`, `transcript`) | excluded from the count |
| Pattern rules | **29** |
| Claude hooks | **4** handlers on 4 events |
| Skills | **0** |
| Subagents | **0** |
| Third-party packages | **0** |
| Network calls, API keys, model calls | **0** |
