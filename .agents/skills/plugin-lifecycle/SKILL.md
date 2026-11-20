---
name: plugin-lifecycle
description: Use when editing plugins/serio-focus/scripts/lifecycle/ (publish.mjs, route.mjs, acceptance.mjs, lock.mjs), the scripts the lifecycle workflows run. Covers the spec-review result, its criteria table, the acceptance report, the test lock and the run archive.
---

## Exports

| Script | Export | Contract |
|---|---|---|
| publish.mjs | `comment(out, sha, extra?)` | spec-review result to the review comment body; `null` for an invalid result |
| publish.mjs | `logText(rows, isPrivate)` | the redacted trace lines; in a private repository also every transcript row, redacted |
| publish.mjs | `transcriptFile(rows)` | one redacted JSON row per line |
| publish.mjs | `archive({ repo, run, attempt, stage, at, transcript, evaluation, artifact, isPrivate, to }, io)` | `io` is `{ one, send, drop }`: `one(path)` returns the existing file `{ sha }`, and throws when missing, so a new file is written without `sha`; `send(method, path, body)` as in `lib/lifecycle.mjs`, each write a `PUT` to `repos/<to>/contents/<path>` with base64 `content` and the existing `sha`; `drop(artifact)` deletes the run's transcript artifact, and a public repository calls it after the writes; writes `runs/<repo>/<YYYY-MM-DD of at, UTC>/<run>-<attempt>-<stage>.jsonl.gz` (gzipped `transcript`) and `….eval.json` to repository `to`, replacing a file of that path; returns `{ ok, note }` and never throws |
| publish.mjs | `evalOf(file)` | the eval file parsed, every string redacted |
| route.mjs | `route(name, event, state)` | `{ stage, issue, … }` starts a run, `{ stop, tell }` does not; a code owner's `spec-ok` that accepts reviewed criteria adds `accept`, the ready review to post |
| acceptance.mjs | `cases(xml)` | JUnit XML to `[{ name, result }]`, result `passed`, `skipped` or `failed` |
| acceptance.mjs | `report({ issue, review, tests, sha, lock?, link?, files?, size? })` | `review` is the body of the trusted spec-review comment, `tests` the output of `cases`; returns `{ ok, body }` |
| acceptance.mjs | `accept({ repo, number, dir, tested, lock, link, post }, io?)` | `io` is `{ one, all, send, raw }`, the real `gh` calls by default; builds the report for `tested`, or for the current head when `tested` is empty, and with `post` writes or edits the one report comment; when `tested` is not the current head it sends nothing and returns `ok: true` with a one-line body; reads no environment; `main()` passes `TESTED_SHA`, `LOCK_NOTE` and the run link, prints `body` and exits 1 when `ok` is false |
| lock.mjs | `check({ pr, issue, comments, reviews, own, changed })` | `{ ok, locked, note }`; `changed(lock)` returns the paths changed after the lock, or `null` when the lock is not in the branch history |
| lock.mjs | `load(repo, number, io?)` | `io` is `{ one, all, raw }`, the real `gh` calls by default; returns the input of `check` |

## Data

| Data | Lives in |
|---|---|
| Spec-review result shape | `scripts/lib/spec-review.schema.json`; each criterion has `id`, `text`, `level` and `test`; the test is in the Test column of the criteria table in the spec-review comment |
| Run result hand-off | `eval.json` in the `eval-*` artifact, written by `publish.mjs --outcome`, holds `structured`, `note` and `reason`; the publish job reads them there, never from job outputs |
| Transcript hand-off | artifact `transcript` |
| Archive repository | `to` of `archive`; the archive token step of the publish job in `lifecycle-agent.yml` names its owner and repository |
| Trusted spec review | the comment `specComment` in `scripts/lib/lifecycle.mjs` returns |
