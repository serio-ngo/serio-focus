---
name: plugin-solo
description: Use when editing plugins/serio-focus/scripts/lifecycle/solo.mjs, the solo-owner lane: start, advance, gate, confine, resume, jobEnv, publicRecord.
---

## Exports

| Export | Contract |
|---|---|
| `io` | `{ one, all, send, raw, push, start }`, real `gh` by default, all synchronous; `one(path)` returns `repos/<r>/issues/<n>`, `repos/<r>/commits/HEAD` `{ sha }` (base) or `repos/<r>/pulls/<n>` `{ number, head: { sha, ref } }`; `raw(path)` CODEOWNERS text; `all(path)` comments `{ user: { login, type }, body }`; `send(method, path, body)` with `body.body` the comment text; `push(ref)`; `start(stage, head)` |
| `start({ repo, issue, owner }, io)` | `criteria_sha` digests the `AC<n>` lines of the issue body; returns `auth` `{ repo, issue, owner, spec_sha, criteria_sha, base_sha, branch }`; sends one `<!-- solo v1 spec=<sha> criteria=<sha> base=<sha> owner=<login> -->` comment; throws `solo: <actor> is not a code owner` |
| `advance(auth, { criteria: [{ ac, test }], red: { sha, ok }, locked: { sha, ok }, reviewed: { head, ok }, verified: { head, verifier, run, attempt, tests } })` | no `io`, sends nothing; `tests` are `cases()` rows `{ name, result }`; returns `{ records }` of stages `spec`, `red`, `locked`, `reviewed`, `verified` in order, stopping at the first not-ok one; `verified` holds `head_sha`, `verifier` and criteria `[{ ac, test, result }]` |
| `gate({ auth, criteria, actor, head, reviewed, lock: { ok }, source, tests, superseded }, io)` | returns `{ ok, line, record }`; first failing code of `actor` (not `auth.owner`), `head` (not `reviewed`), `lock` (`!lock.ok`), `source` (not `verifier`), `missing` (criterion test absent), `skipped`, `failed`, `superseded` gives `verification: reject — <code>`, `record` null, `io.send` and `io.push` never called; else `verification: pass` and `record` |
| `confine(auth, io)` | returns an `io` that passes an allowed `send` or `push` through and returns its result unchanged; allows only comments on the task issue or pull request and PATCH of the task pull request, any other call throws `solo: publisher refused <METHOD> <path>` (including `pulls/<n>/reviews` and `pulls/<n>/merge`); `push` of a ref other than `auth.branch` throws `solo: publisher refused push <ref>` |
| `resume({ repo, number }, io)` | `number` is the pull request number; the task issue comes from its `head.ref` `agent/<n>-…`; returns `{ started, stage }`; reads the `solo v1` marker and `<!-- solo-proof stage=<stage> sha=<sha> run=<url> -->` comments, trusted only from the owner or `github-actions[bot]`; writes `status()` with run links, `Now: <stage>` and `Next: <actor> — <action>`; calls `io.start` once with the next incomplete stage and records `<!-- solo-start stage=<s> head=<sha> -->`; an identical repeat starts nothing (`started: null`); a changed spec or criteria digest throws `solo: intent changed; run solo.mjs start <issue> again` |
| `jobEnv(role, env)` | no `io`; `role` is `worker` or `test`; drops every name matching `/TOKEN\|KEY\|SECRET/`; `worker` keeps only `ANTHROPIC_API_KEY` |
| `publicRecord(raw)` | no `io`; keeps only repository, issue, pr, spec_sha, base_sha, head_sha, lock_sha, stage, verifier, run, attempt, outcome and criteria rows `{ ac, test, result }` |

## Rules

| Rule | Detail |
|---|---|
| `io` argument | only `start`, `gate`, `confine`, `resume` take a last `io` |
| CLI | `solo.mjs start\|resume <issue>` |
| Self-test | `solo.mjs --self-test` is listed in `npm test` |
| Router | `route()` of route.mjs is unchanged; the interactive lane still needs a code owner's `spec-ok` and `tests-ok` |
