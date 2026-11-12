---
name: gate
description: Use to check a task pull request by script before asking for review. Runs the test lock and builds the acceptance report from JUnit results - one row per criterion - without a model deciding the result.
disable-model-invocation: true
argument-hint: "<PR number>"
---

Check pull request $ARGUMENTS with the lifecycle scripts. Requires an authenticated `gh` and Node. The scripts decide; report their output unchanged.

| Step | Command | Pass |
|---|---|---|
| 1. Lock | `node "${CLAUDE_PLUGIN_ROOT}/scripts/lifecycle/lock.mjs" <PR>` | `test lock: pass`; a draft without `tests-ok` passes as `not locked` |
| 2. Results | Run the repository's unit and e2e commands with their JUnit reporters into one directory, such as `junit/` | One `.xml` file per runner |
| 3. Report | `node "${CLAUDE_PLUGIN_ROOT}/scripts/lifecycle/acceptance.mjs" <PR> junit` | `Acceptance: pass`: every criterion has a passing test titled `#<issue> AC<n>` |

| Lock rule | Value |
|---|---|
| Lock | The commit of the newest review by a code owner whose text starts with `tests-ok`. `CODEOWNERS` must name people: a team entry is not resolved |
| Locked paths | `tests/`, `test/`, `__tests__/`, `e2e/`, `*.test.*`, `*.spec.*`, `*-test.*`, `*_test.*`, `test-*`, `.claude/skills/`, Playwright, Vitest and Jest config files |
| Spec freeze | The issue carries `spec-ok` and its text matches the hash in the newest `ready` spec review |
| Changing a locked path | A person pushes the change and gives a new `tests-ok` |

- Add `--repo <owner>/<name>` when the checkout is not the pull request's repository.
- Add `--post` to step 3 only inside the repository's own trusted workflow; a local run prints the report.
- Without a ruleset that restricts updates of the default branch, a local run's lock and freeze are advisory: the agent shares the developer's login.
- A failed step is a finding to report, never something to repair by editing a test, the spec or a script.
