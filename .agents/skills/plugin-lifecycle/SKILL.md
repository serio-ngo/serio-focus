---
name: plugin-lifecycle
description: Use when editing plugins/serio-focus/scripts/lifecycle/ (publish.mjs, push.mjs, route.mjs, acceptance.mjs, lock.mjs), the scripts the lifecycle workflows run. Covers the spec-review result, its criteria table, the acceptance report, the test lock and the run archive.
---

## Exports

| Script | Export | Contract |
|---|---|---|
| publish.mjs | `comment(out, sha, extra?)` | spec-review result to the review comment body; `null` for an invalid result |
| publish.mjs | `logText(rows, isPrivate)`, `transcriptFile(rows)`, `evalOf(file)` | redacted trace lines, and in a private repository every transcript row; one redacted JSON row per line; the eval file parsed, every string redacted |
| publish.mjs | `archive({ repo, run, attempt, stage, at, transcript?, trace?, evaluation, gate?, artifact?, isPrivate, to }, io)` | `io` is `{ one, all, send, drop, upload, scan, sleep }`; `trace` is the record's `trace` when given, else `trace.mjs` of the transcript; one `PUT` to `repos/<to>/contents/runs/<repo>/<YYYY-MM-DD of at, UTC>/<run>-<attempt>-<stage>.json` holds the record `{ trace, eval, result, gate, transcript, revision, plugin, model, effort, dropped }`; the transcript is asset `<owner>-<repo>-<run>-<attempt>-<stage>.jsonl.gz` of release `raw-<YYYY-MM of at>`, recorded as `transcript: { release, asset }`; retention counts 90 days before `at`; `scan(dir)` of `lib/gitleaks.mjs` returns the flagged `<field>.json` names, `verified(name, buffer)` there checks a release archive against the pinned sha256; returns `{ ok, note }`, never throws |
| publish.mjs | `session({ projects, id, repo }, io)` | `io` as for `archive`; none found returns `{ ok: false, note: 'no session <id>' }`; else archives the session and each `<id>/subagents/agent-<x>.jsonl` as run `local-<id>`, attempt 1, stage `session` or `agent-<x>`, passing `trace(sourceFile)` as `trace` and the redacted `agent-<x>.meta.json` as `evaluation` (`null` for the session); returns `{ ok, note }` |
| publish.mjs | `--session <id> [--repo <owner/name>]`, `--gate <file>` | `--session`: projects = `<CLAUDE_CONFIG_DIR or ~/.claude>/projects`; prints `::error::<note>` and exits 1 when `ok` is false (`no session <id>` when none); `--gate` and `--archive` print `::error::<note>` and exit 1 (`--archive` also puts the note into the eval file); `--gate` archives the gate record as `gate` of stage `gate`, with run, attempt, repository and `at` from the record, no transcript |
| publish.mjs | `pushed({ repo, number, stage, before, note, reason }, io?)` | `io` is `{ one, all, send, raw }`, real `gh` by default, shared by `status` and `park`; a head differing from `before` removes `needs-human`; equal parks with `the run ended without a new push`, unless `stage` is `deliver` and the pull request is ready; `main()` passes environment and argv |
| push.mjs | `publishCard({ repo, out, issue, ref, stage }, io?)` | the run without a commit bundle; same `io`; for `stage` `deliver` with `pr.md` in `out`, sets the open pull request of `ref` to the issue title and the card and marks it ready; otherwise sends nothing; reads no environment |
| route.mjs | `route(name, event, state)` | `{ stage, issue, … }` starts a run, `{ stop, tell }` does not; a code owner's `spec-ok` that accepts reviewed criteria adds `accept`, the ready review to post |
| acceptance.mjs | `cases(xml)`, `report({ issue, review, tests, sha, lock?, link?, files?, size? })` | JUnit XML to `[{ name, result }]` (`passed`, `skipped`, `failed`); `review` is the trusted spec-review body, `tests` the `cases` output; `report` returns `{ ok, body }` |
| acceptance.mjs | `accept({ repo, number, dir, tested, lock, link, post }, io?)` | `io` is `{ one, all, send, raw }`, the real `gh` calls by default; builds the report for `tested`, or for the current head when `tested` is empty, and with `post` writes or edits the one report comment; when `tested` is not the current head it sends nothing and returns `ok: true` with a one-line body; reads no environment; `main()` passes `TESTED_SHA`, `LOCK_NOTE` and the run link, prints `body` and exits 1 when `ok` is false |
| acceptance.mjs | `record({ repo, number, dir, tested, lock, note, verifier, run, attempt, jobs }, io)` | `io` is `{ one, all, raw }`; `lock` is the lock step outcome; returns `{ repository, pr, run, attempt, at, head_sha, tested_sha, reported_sha, verifier, lock, acceptance, cases, jobs }`: `lock` is `test lock: <pass\|fail> - <note>`, `acceptance` the body `accept` builds without posting and without the run link (`null` unless the outcome is `success`), `reported_sha` the sha its marker names or `null`, `cases` the JUnit cases; `acceptance.mjs <PR> <dir> --record <file>` writes it from the gate job's environment |
| lock.mjs | `check({ pr, issue, comments, reviews, own, changed })`, `load(repo, number, io?)` | `check` returns `{ ok, locked, note }`; `changed(lock)` returns paths changed after the lock, or `null` when the lock is not in the branch history; `load` takes `io` `{ one, all, raw }` and returns the input of `check` |

## Data

| Data | Lives in |
|---|---|
| Spec-review result shape | `scripts/lib/spec-review.schema.json`; each criterion has `id`, `text`, `level` and `test`; the test is in the Test column of the criteria table in the spec-review comment |
| Run hand-off | `eval.json` in the `eval-*` artifact, written by `publish.mjs --outcome`, holds `structured`, `note` and `reason`, read by the publish job, never from job outputs; the transcript is artifact `transcript` |
| Archive | `to` of `archive`; record `runs/<repo>/<date>/<run>-<attempt>-<stage>.json`, gate record `…-gate.json` written by the control job of `lifecycle-gate.yml`; local session `…/local-<id>-1-<stage>.json`; raw transcripts release assets `raw-<YYYY-MM>`; gitleaks version and checksums `scripts/lib/gitleaks.mjs` |
| Trusted spec review | the comment `specComment` in `scripts/lib/lifecycle.mjs` returns |
