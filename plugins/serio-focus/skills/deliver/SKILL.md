---
name: deliver
description: Use when asked to build or change something end to end. Runs the role agents in order - architect plans, coder builds each task, reviewer checks each diff - until the work is ready for a pull request.
argument-hint: "<goal>"
---

Deliver $ARGUMENTS. Agents: `serio-focus:<role>` in Claude, `serio-<role>` in Codex after `npm run setup -- --host codex`; elsewhere read `../../agents/<role>.md` and apply it inline.

| Step | Agent | Do | Evidence |
|---|---|---|---|
| 1. Plan | architect | Skip only for a one-file change with an obvious fix | Plan with tasks and checks |
| 2. Build | coder | One task per dispatch, in plan order, with its row, paths and check | Changed lines and green checks |
| 3. Review | reviewer | Review each task's diff | Verdict `ready` |
| 4. Fix | coder | Send every P0 and P1 back with its `file:line`, then review again. Stop after three rounds on one finding and report it | Verdict `ready` |
| 5. Hand over | none | Run the repository checks on the whole diff. List the exact commit, push and PR commands for the owner, or run them when `SERIO_GIT_WRITE=1` delegates publishing | Check output and commands |

- One coder at a time per branch; agents never edit the same files in parallel.
- The main session keeps the plan and the evidence; agents return only their sections.
- After the pull request opens, continue with `pr-loop`.
