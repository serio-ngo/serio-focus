---
name: plugin-lifecycle
description: Use when editing plugins/serio-focus/scripts/lifecycle/ (publish.mjs, route.mjs, acceptance.mjs), the scripts the lifecycle workflows run. Covers the spec-review result, its criteria table and the acceptance report.
---

## Exports

| Script | Export | Contract |
|---|---|---|
| publish.mjs | `comment(out, sha, extra?)` | spec-review result to the review comment body; `null` for an invalid result |
| route.mjs | `route(name, event, state)` | `{ stage, issue, … }` starts a run, `{ stop, tell }` does not; a code owner's `spec-ok` that accepts reviewed criteria adds `accept`, the ready review to post |
| acceptance.mjs | `cases(xml)` | JUnit XML to `[{ name, result }]`, result `passed`, `skipped` or `failed` |
| acceptance.mjs | `report({ issue, review, tests, sha, lock?, link?, files?, size? })` | `review` is the body of the trusted spec-review comment, `tests` the output of `cases`; returns `{ ok, body }` |

## Data

| Data | Lives in |
|---|---|
| Spec-review result shape | `scripts/lib/spec-review.schema.json`; each criterion has `id`, `text`, `level` and `test` |
| Test of a criterion | the Test column of the criteria table in the spec-review comment |
| Trusted spec review | the comment `specComment` in `scripts/lib/lifecycle.mjs` returns |
