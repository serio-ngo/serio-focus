# Workflow

<sub><b>Answers</b> · how a change moves from task to merge with this plugin · <a href="../README.md">README</a></sub>

## Roles

| Role | Runs as | Writes | Returns |
|---|---|---|---|
| Orchestrator | The main session running `deliver`, then `pr-loop` | the plan and the evidence | Status to the owner |
| Architect | `architect`: Read, Grep and Glob only in Claude; canonical role instructions and parent permissions in Codex | nothing | One plan: tasks, paths, acceptance commands, risks |
| Coder | `coder` agent, one task per dispatch, fresh context | code and tests, never commits | Changed lines, check output, what was not done |
| Reviewer | `reviewer`: read-only instructions; Bash remains available; Codex inherits parent permissions | nothing | P0–P2 findings at `file:line`, verdict `ready` or `changes needed` |
| Tester | `tester` agent, only when behaviour changes and the repository has tests | one failing test | Test path and its failing line for the coder |
| Owner | A person | merges | The merge |

## Lifecycle

Spec review, Tests and Gate apply only to an issue that is a task spec. Auto starts run in the target repository through `lifecycle-agent.yml`.

| Step | Role | Do | Manual start | Auto start | Exit evidence |
|---|---|---|---|---|---|
| 1. Spec review | Reviewer | Read the issue, the product contract and the code it names; verdict, questions, criteria AC1…ACn | `/serio-focus:spec-review <N>` | A person labels the issue `spec-review`: stage `spec-review` | `Spec review: ready` comment; the owner adds `spec-ok` |
| 2. Tests | Tester | One failing test per criterion; draft pull request with the criterion-to-test table | `/serio-focus:write-tests <N>` | `spec-ok` from a person, with a ready review of the current issue text: stage `write-tests`; a `changes_requested` review before the lock reruns it | Draft pull request; a code owner review `tests-ok` on the head locks the tests |
| 3. Plan | Architect | Plan unless the change is one file with an obvious fix | `/serio-focus:deliver <goal>` | A code owner `tests-ok` review on the head: stage `deliver` | Plan with runnable checks |
| 4. Red | Tester | One failing test when the task changes behaviour; skipped when repository test rules forbid it or the tests are locked | as step 3 | as step 3 | Failing line |
| 5. Build | Coder | One task per dispatch; disjoint paths may run in parallel; locked tests are never edited | as step 3 | as step 3 | Green task checks |
| 6. Review | Reviewer | Review each task's diff; the coder fixes every P0 and P1; three rounds per finding at most | as step 3 | as step 3 | Verdict `ready` |
| 7. Publish | Orchestrator | Commit, push, open the pull request; on a task branch also the card in the body and ready; repository rules or permissions may hold a step | as step 3 | as step 3 | PR URL and head SHA |
| 8. Gate | Script | Test lock and acceptance report from JUnit results | `/serio-focus:gate <PR>` | `lifecycle-gate.yml` on the pull request | `test lock: pass`; one report row per criterion |
| 9. PR review | CI and Codex review | Required checks run; Codex reviews on open and on push; comment `@codex review` when a head has none | Open the pull request | Pull request events | Checks and a review that name the head |
| 10. Fix | Orchestrator with `pr-loop` | Verify each finding on the head; coder fixes, reviewer re-checks, publish, request re-review | `/serio-focus:pr-loop <PR>` | After the lock: a code owner `changes_requested` review or a failed CI run: stage `pr-loop`, one round; CI parks after 2 fix runs | Next head; repeat from step 9 |
| 11. Merge | Owner | Merge when checks pass, threads are resolved and the newest review covers the head | Merge | Merge | Merge commit |

## Where the loop runs

| Mode | Claude Code | Codex | Use |
|---|---|---|---|
| Local app | PR status bar: "Auto-fix CI & address comments" wakes the session; the session follows `pr-loop` | Code Review plugin: open the PR, "Fix" failing checks, run `$pr-loop` | Default |
| Local CLI | `/serio-focus:deliver <goal>`, `/serio-focus:pr-loop <PR>` | `$deliver`, `$pr-loop` | Terminal only |
| Cloud | `/autofix-pr` in Claude Code on the web | Not used | Away from the machine; opt in per PR |
| CI bot | `lifecycle-agent.yml` and `lifecycle-gate.yml` reusable workflows, called from the target repository; Claude seat token; plugin pinned at `focus_ref` | None | Unattended runs on an issue that is a task spec |

## Choices

| Area | Choice | Why |
|---|---|---|
| Roles | Agent files for roles, skills for the procedures | Each role gets its own context and tool limits; one agent file per role feeds both hosts |
| Coder | A separate agent, one task per dispatch | Fresh context per task keeps the main window small; the main session stays the orchestrator |
| Parallel coders | Disjoint paths only | Two writers never touch the same file |
| Gate before a PR | `reviewer` agent | Codex PR review can stop on usage limits; the local gate always runs |
| Second model | Codex review on the PR | A different model family finds different faults |
| Fix location | The session that owns the branch: local, or the `pr-loop` stage of `lifecycle-agent.yml` | Hooks and the real checks run there; the seat token is a secret of the target repository |
| Cloud fixes | Opt in per PR | Cloud sessions run without local hooks |
| Pushes | The session, unless repository rules hold them | Cloud and local sessions finish the loop without a manual step |
| Merge | Owner, with auto-merge off by default | Merge authority stays with a person |
| TDD | `write-tests` for a task spec, locked by `tests-ok`; `tester` otherwise, optional | Locked tests make Red a skip; repository test rules decide the rest |

## Merge gate

| GitHub ruleset rule | Setting |
|---|---|
| Pull request before merge | required |
| Required status checks | every CI job name |
| Conversation resolution | required |
| Stale approvals | dismissed on push |
| Force push and deletion of the default branch | blocked |
