# Manifest

<sub><b>Answers</b> · everything the plugin loads at version 1.27.0 · generated, `npm run upkeep` rewrites it · <a href="../README.md">README</a></sub>

## Hooks

| Event | Matcher | Script | Native host |
|---|---|---|---|
| `PreToolUse` | `^(Bash\|PowerShell\|Agent\|spawn_agent\|Workflow\|EnterWorktree\|mcp__.+__(?!.*(?:draft\|(?:get\|list\|read\|search\|fetch)[_-]))(?:.*[_-])?(?:send\|reply\|forward\|post\|publish\|schedule\|share\|submit\|invite\|respond)(?:[_-].*)?)$` | `scripts/guard.mjs` | Claude, Codex |
| `SessionStart` | `startup\|resume\|clear\|compact` | `scripts/card.mjs` | Claude, Codex |
| `Stop` | `*` | `scripts/receipt.mjs` | Claude, Codex |

## Agents

| Agent | Tools | Description |
|---|---|---|
| `architect` | Read, Grep, Glob | Use when a change spans several files, needs a design choice or has unclear scope. Read-only planner that returns one plan with tasks, paths and acceptance checks. |
| `coder` | Read, Grep, Glob, Bash, Edit, Write | Use to implement one planned task in a fresh context. Makes the smallest complete change with its tests, runs the checks and returns what changed. |
| `reviewer` | Read, Grep, Glob, Bash, Skill | Use when a diff is ready - after each coder task, before a pull request, after each fix round. Read-only fresh-context review that returns ranked findings with file:line and evidence. |
| `tester` | Read, Grep, Glob, Bash, Edit, Write | Use before the coder when a task changes behaviour and the repository has tests. Writes one failing test through a public boundary and proves it fails for the expected reason. |

## Skills

| Skill | Description |
|---|---|
| `deliver` | Use when asked to build or change something end to end. Runs the role agents in order - architect plans, tester writes a failing test, coder builds each task, reviewer checks each diff - then opens the pull request. |
| `pr-loop` | Use when a pull request has failing checks or unresolved review feedback from any reviewer, person or bot. Verifies each finding, has the coder fix it, reruns checks and requests re-review until the head is clean. |

## Inventory

| What ships | Count |
|---|---|
| Script lines | **383** across 9 files |
| Hook events | **3** |
| Skills | **2** |
| Subagents | **4** |
| Startup context: card, agent and skill descriptions | **~478** tokens |
| Third-party packages | **0** |
| Network calls, API keys, model calls | **0** |
