# Workflow

<sub><b>Answers</b> · how a change moves from task to merge with this plugin and Ponytail · facts and sources in <a href="HOST_FACTS.md">HOST_FACTS</a> · <a href="../README.md">README</a></sub>

## Roles

| Role | Runs as | Writes | Returns |
|---|---|---|---|
| Orchestrator | The main session running `deliver`, then `pr-loop` | the plan and the evidence | Status to the owner |
| Architect | `architect` agent: read-only tools in Claude, `sandbox_mode = "read-only"` in Codex | nothing | One plan: tasks, paths, acceptance commands, risks |
| Coder | `coder` agent, one task per dispatch, fresh context | code and tests, never commits | Changed lines, check output, what was not done |
| Reviewer | `reviewer` agent, read-only | nothing | P0–P2 findings at `file:line`, verdict `ready` or `changes needed` |
| Tester, draft | `plugins/serio-focus/drafts/tester.md`, loaded by no host | one failing test | Red evidence for the coder |
| Owner | A person | pushes when not delegated, merges | The merge |

## Loop

| Step | Role | Do | Exit evidence |
|---|---|---|---|
| 1. Plan | Architect | Plan unless the change is one file with an obvious fix | Plan with runnable checks |
| 2. Build | Coder | One task per dispatch, in plan order | Green task checks |
| 3. Review | Reviewer | Review each task's diff; the coder fixes every P0 and P1; three rounds per finding at most | Verdict `ready` |
| 4. Publish | Owner, or a session with `SERIO_GIT_WRITE=1` | Commit, push, open the pull request | PR URL and head SHA |
| 5. PR review | CI and Codex review | Required checks run; Codex reviews on open and on push; comment `@codex review` when a head has none | Checks and a review that name the head |
| 6. Fix | Orchestrator with `pr-loop` | Verify each finding on the head; coder fixes, reviewer re-checks, publish, request re-review | Next head; repeat from step 5 |
| 7. Merge | Owner | Merge when checks pass, threads are resolved and the newest review covers the head | Merge commit |

## Where the loop runs

| Mode | Claude Code | Codex | Use |
|---|---|---|---|
| Local app | PR status bar: "Auto-fix CI & address comments" wakes the session; the session follows `pr-loop` | Code Review plugin: open the PR, "Fix" failing checks, run `$pr-loop` | Default |
| Local CLI | `/serio-focus:deliver <goal>`, `/serio-focus:pr-loop <PR>` | `$deliver`, `$pr-loop` | Terminal only |
| Cloud | `/autofix-pr` in Claude Code on the web | `@codex <task>` comment on the PR | Away from the machine; opt in per PR |
| CI bot | Not used | Not used | Needs API keys in an open repository; bot commits skip CI |

## Choices

| Area | Choice | Why |
|---|---|---|
| Coding method | Ponytail Full | Maintained upstream for both hosts; this plugin copies none of it |
| Roles | Agent files for roles, skills for the procedures | Each role gets its own context and tool limits; one agent file per role feeds both hosts |
| Coder | A separate agent, one task per dispatch | Fresh context per task keeps the main window small; the main session stays the orchestrator |
| Parallel coders | No | One writer per branch avoids conflicting edits |
| Gate before a PR | `reviewer` agent | Codex PR review can stop on usage limits; the local gate always runs |
| Second model | Codex review on the PR | A different model family finds different faults |
| Fix location | The local session that owns the branch | Hooks, Ponytail and the real checks run there; no secrets in the repository |
| Cloud fixes | Opt in per PR | Cloud sessions run without local hooks |
| Pushes | Owner, or a session with `SERIO_GIT_WRITE=1` | Publishing stays with the owner unless delegated |
| Merge | Owner, with auto-merge off by default | Merge authority stays with a person |
| TDD | Draft agent, disabled | Enable per repository when its test policy permits |

## Merge gate

| GitHub ruleset rule | Setting |
|---|---|
| Pull request before merge | required |
| Required status checks | every CI job name |
| Conversation resolution | required |
| Stale approvals | dismissed on push |
| Force push and deletion of the default branch | blocked |
