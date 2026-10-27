# Workflow

<sub><b>Answers</b> · how a change moves from task to merge with this plugin · <a href="../README.md">README</a></sub>

## Roles

| Role | Runs as | Writes | Returns |
|---|---|---|---|
| Orchestrator | The main session running `deliver`, then `pr-loop` | the plan and the evidence | Status to the owner |
| Architect | `architect`: Read, Grep and Glob only in Claude. Codex uses `sandbox_mode = "read-only"` | nothing | One plan: tasks, paths, acceptance commands, risks |
| Coder | `coder` agent, one task per dispatch, fresh context | code and tests, never commits | Changed lines, check output, what was not done |
| Reviewer | `reviewer`: read-only instructions in Claude; Bash remains available. Codex uses a read-only sandbox | nothing | P0–P2 findings at `file:line`, verdict `ready` or `changes needed` |
| Tester | `tester` agent, only when behaviour changes and the repository has tests | one failing test | Test path and its failing line for the coder |
| Owner | A person | merges | The merge |

## Loop

| Step | Role | Do | Exit evidence |
|---|---|---|---|
| 1. Plan | Architect | Plan unless the change is one file with an obvious fix | Plan with runnable checks |
| 2. Red | Tester | One failing test when the task changes behaviour; skipped when repository test rules forbid it | Failing line |
| 3. Build | Coder | One task per dispatch; disjoint paths may run in parallel | Green task checks |
| 4. Review | Reviewer | Review each task's diff; the coder fixes every P0 and P1; three rounds per finding at most | Verdict `ready` |
| 5. Publish | Orchestrator | Commit, push, open the pull request; repository rules or permissions may hold a step | PR URL and head SHA |
| 6. PR review | CI and Codex review | Required checks run; Codex reviews on open and on push; comment `@codex review` when a head has none | Checks and a review that name the head |
| 7. Fix | Orchestrator with `pr-loop` | Verify each finding on the head; coder fixes, reviewer re-checks, publish, request re-review | Next head; repeat from step 6 |
| 8. Merge | Owner | Merge when checks pass, threads are resolved and the newest review covers the head | Merge commit |

## Where the loop runs

| Mode | Claude Code | Codex | Use |
|---|---|---|---|
| Local app | PR status bar: "Auto-fix CI & address comments" wakes the session; the session follows `pr-loop` | Code Review plugin: open the PR, "Fix" failing checks, run `$pr-loop` | Default |
| Local CLI | `/serio-focus:deliver <goal>`, `/serio-focus:pr-loop <PR>` | `$deliver`, `$pr-loop` | Terminal only |
| Cloud | `/autofix-pr` in Claude Code on the web | Not used | Away from the machine; opt in per PR |
| CI bot | Not used | Not used | Needs API keys in an open repository; bot commits skip CI |

## Choices

| Area | Choice | Why |
|---|---|---|
| Roles | Agent files for roles, skills for the procedures | Each role gets its own context and tool limits; one agent file per role feeds both hosts |
| Coder | A separate agent, one task per dispatch | Fresh context per task keeps the main window small; the main session stays the orchestrator |
| Parallel coders | Disjoint paths only | Two writers never touch the same file |
| Gate before a PR | `reviewer` agent | Codex PR review can stop on usage limits; the local gate always runs |
| Second model | Codex review on the PR | A different model family finds different faults |
| Fix location | The local session that owns the branch | Hooks and the real checks run there; no secrets in the repository |
| Cloud fixes | Opt in per PR | Cloud sessions run without local hooks |
| Pushes | The session, unless repository rules hold them | Cloud and local sessions finish the loop without a manual step |
| Merge | Owner, with auto-merge off by default | Merge authority stays with a person |
| TDD | `tester`, optional step | Repository test rules decide when it runs |

## Merge gate

| GitHub ruleset rule | Setting |
|---|---|
| Pull request before merge | required |
| Required status checks | every CI job name |
| Conversation resolution | required |
| Stale approvals | dismissed on push |
| Force push and deletion of the default branch | blocked |
