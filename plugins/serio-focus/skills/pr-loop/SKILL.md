---
name: pr-loop
description: Use when a pull request has failing checks or unresolved review comments, Codex review findings included. Verifies each finding, has the coder fix it, reruns checks and requests re-review until the head is clean.
argument-hint: "[PR number]"
---

Bring pull request $ARGUMENTS (default: the current branch) to a clean head. Requires an authenticated `gh`. Agents are named as in `deliver`.

| Step | Do | Evidence |
|---|---|---|
| 1. Read | `gh pr view --json number,headRefOid,mergeStateStatus,statusCheckRollup`; list unresolved review threads through `gh api graphql` | Head SHA, failing checks, open threads |
| 2. Triage | Reproduce each failing check and thread finding on the current head. Real: fix it. Wrong or stale: answer with the evidence | One verdict per item |
| 3. Fix | Dispatch the coder with the finding, its `file:line` and the check that proves the fix | Diff touches only the cause |
| 4. Prove | Run the checks the repository requires, then the reviewer on this round's diff | Green output; verdict `ready` |
| 5. Publish | Commit, push, reply and resolve threads only where repository rules and the host allow it. Otherwise stop and list the exact commands for the owner | Pushed head SHA, or the held commands |
| 6. Re-review | Once checks finish, if no review names the new head and the repository uses Codex review, comment `@codex review` | A review whose reviewed commit is the head |
| 7. Repeat | Return to step 1. After three rounds on the same finding, stop and report it | Round count |

Done when required checks pass on the head, no review thread is unresolved and the newest review covers the head. The owner merges.
