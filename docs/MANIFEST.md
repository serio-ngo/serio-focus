# Manifest

<sub><b>Answers</b> · everything the plugin loads at version 1.22.0 · generated, `npm run upkeep` rewrites it · <a href="../README.md">README</a></sub>

## Hooks

| Event | Matcher | Script | Native host |
|---|---|---|---|
| `PreToolUse` | `^(Bash\|PowerShell\|Agent\|Task\|spawn_agent)$` | `scripts/guard.mjs` | Claude, Codex |
| `SessionStart` | `startup\|resume\|clear\|compact` | `scripts/card.mjs` | Claude, Codex |

## Agents

| Agent | Tools | Description |
|---|---|---|
| `architect` | Read, Grep, Glob, Bash | Use when a change spans several files, needs a design choice or has unclear scope. Read-only planner that returns one plan with tasks, paths and acceptance checks. |
| `coder` | Read, Grep, Glob, Bash, Edit, Write | Use to implement one planned task in a fresh context. Makes the smallest complete change with its tests, runs the checks and returns what changed. |
| `reviewer` | Read, Grep, Glob, Bash, Skill | Use when a diff is ready - after each coder task, before a pull request, after each fix round. Read-only fresh-context review that returns ranked findings with file:line and evidence. |

## Skills

| Skill | Description |
|---|---|
| `deliver` | Use when asked to build or change something end to end. Runs the role agents in order - architect plans, coder builds each task, reviewer checks each diff - until the work is ready for a pull request. |
| `pr-loop` | Use when a pull request has failing checks or unresolved review comments, Codex review findings included. Verifies each finding, has the coder fix it, reruns checks and requests re-review until the head is clean. |

## Inventory

| What ships | Count |
|---|---|
| Script lines | **334** across 8 files |
| Hook events | **2** |
| Skills | **2** |
| Subagents | **3** |
| Startup context: card, agent and skill descriptions | **~270** tokens |
| Third-party packages | **0** |
| Network calls, API keys, model calls | **0** |
