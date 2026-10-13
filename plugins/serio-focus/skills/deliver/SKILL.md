---
name: deliver
description: Use when asked to build or change something end to end. Runs the role agents in order - architect plans, tester writes a failing test, coder builds each task, reviewer checks each diff - then opens the pull request.
argument-hint: "<goal>"
---

Deliver $ARGUMENTS. Agents: `serio-focus:<role>` in Claude, `serio-<role>` in Codex; where neither exists, apply the role's rules inline.

| Step | Agent | Do | Evidence |
|---|---|---|---|
| 1. Plan | architect | Skip only for a one-file change with an obvious fix | Plan with tasks and checks |
| 2. Red | tester | Only when the task changes behaviour and the repository has tests; repository test rules win. Skip otherwise | Test path and its failing line |
| 3. Build | coder | One task per dispatch, with its row, paths, check and failing test. Tasks with disjoint paths may run in parallel, otherwise one at a time | Changed lines and green checks |
| 4. Review | reviewer | Review each task's diff | Verdict `ready` |
| 5. Fix | coder | Send every P0 and P1 back with its `file:line`, then review again. Stop after three rounds on one finding and report it | Verdict `ready` |
| 6. Ship | none | Run the repository checks on the whole diff, then commit, push the branch and open the pull request. When repository rules or permissions hold a step, list its exact command instead | Check output, then the pull request or the held commands |

- Run every step without asking. Ask only when a missing fact changes the design, with the default you would ship.
- Agents never edit the same files in parallel.
- The main session keeps the plan and the evidence; agents return only their sections.
- After the pull request opens, continue with `pr-loop`.
