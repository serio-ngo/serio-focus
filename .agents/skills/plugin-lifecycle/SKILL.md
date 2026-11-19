---
name: plugin-lifecycle
description: Use when editing plugins/serio-focus/scripts/lifecycle/ (publish.mjs, push.mjs, route.mjs, acceptance.mjs, lock.mjs), the scripts the lifecycle workflows run. Covers the spec-review result, its criteria table, the acceptance report and the test lock.
---

## Exports

| Script | Export | Contract |
|---|---|---|
| publish.mjs | `comment(out, sha, extra?)` | spec-review result to the review comment body; `null` for an invalid result |
| publish.mjs | `pushed({ repo, number, stage, before, note, reason }, io?)` | `io` is `{ one, all, send, raw }`, the real `gh` calls by default, and `status` and `park` take the same `io`; when the head of the task's open pull request differs from `before` it removes `needs-human`; when it equals `before` it parks with `the run ended without a new push`, unless `stage` is `deliver` and the pull request is ready; reads no environment but the run link; `main()` passes the environment and argv |
| push.mjs | `publishCard({ repo, out, issue, ref, stage }, io?)` | the run without a commit bundle; same `io`; for `stage` `deliver` with `pr.md` in `out`, sets the open pull request of `ref` to the issue title and the card and marks it ready; otherwise sends nothing; reads no environment |
| route.mjs | `route(name, event, state)` | `{ stage, issue, … }` starts a run, `{ stop, tell }` does not; a code owner's `spec-ok` that accepts reviewed criteria adds `accept`, the ready review to post |
| acceptance.mjs | `cases(xml)` | JUnit XML to `[{ name, result }]`, result `passed`, `skipped` or `failed` |
| acceptance.mjs | `report({ issue, review, tests, sha, lock?, link?, files?, size? })` | `review` is the body of the trusted spec-review comment, `tests` the output of `cases`; returns `{ ok, body }` |
| acceptance.mjs | `accept({ repo, number, dir, tested, lock, link, post }, io?)` | `io` is `{ one, all, send, raw }`, the real `gh` calls by default; builds the report for `tested`, or for the current head when `tested` is empty, and with `post` writes or edits the one report comment; when `tested` is not the current head it sends nothing and returns `ok: true` with a one-line body; reads no environment; `main()` passes `TESTED_SHA`, `LOCK_NOTE` and the run link, prints `body` and exits 1 when `ok` is false |
| lock.mjs | `check({ pr, issue, comments, reviews, own, changed })` | `{ ok, locked, note }`; `changed(lock)` returns the paths changed after the lock, or `null` when the lock is not in the branch history |
| lock.mjs | `load(repo, number, io?)` | `io` is `{ one, all, raw }`, the real `gh` calls by default; returns the input of `check` |

## Data

| Data | Lives in |
|---|---|
| Spec-review result shape | `scripts/lib/spec-review.schema.json`; each criterion has `id`, `text`, `level` and `test` |
| Test of a criterion | the Test column of the criteria table in the spec-review comment |
| Trusted spec review | the comment `specComment` in `scripts/lib/lifecycle.mjs` returns |
