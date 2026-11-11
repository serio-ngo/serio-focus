# Manifest

<sub><b>Answers</b> · everything the plugin loads at version 1.29.0 · generated, `npm run upkeep` rewrites it · <a href="../README.md">README</a></sub>

## Hooks

| Event | Matcher | Script | Native host |
|---|---|---|---|
| `PreToolUse` | `^(Bash\|PowerShell\|Edit\|Write\|MultiEdit\|NotebookEdit\|Agent\|spawn_agent\|Workflow\|EnterWorktree\|mcp__.+__(?:(?:.*[_-])?send[_-]draft\|(?!.*(?:draft\|(?:get\|list\|read\|search\|fetch)[_-]))(?:.*[_-])?(?:send\|reply\|forward\|post\|publish\|schedule\|share\|submit\|invite\|respond)(?:[_-].*)?))$` | `scripts/guard.mjs` | Claude, Codex |
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
| `gate` | Use to check a task pull request by script before asking for review. Runs the test lock and builds the acceptance report from JUnit results - one row per criterion - without a model deciding the result. |
| `pr-loop` | Use when a pull request has failing checks or unresolved review feedback from any reviewer, person or bot. Verifies each finding, has the coder fix it, reruns checks and requests re-review until the head is clean. |
| `spec-review` | Use before any test or code when an issue is a task spec. Reads the issue, the product contract and the code it names, then returns a verdict, questions with recommended answers and numbered Given, When, Then criteria. Changes no repository file. |
| `write-tests` | Use after a spec is approved and before any production code. Writes one failing test per acceptance criterion, proves the set is red and opens a draft pull request with the criterion-to-test table for a person to approve. |

## Inventory

| What ships | Count |
|---|---|
| Script lines | **773** across 14 files |
| Hook events | **3** |
| Skills | **5** |
| Subagents | **4** |
| Startup context: card, agent and skill descriptions | **~477** tokens |
| Third-party packages | **0** |
| Network calls, API keys, model calls | **0** |
