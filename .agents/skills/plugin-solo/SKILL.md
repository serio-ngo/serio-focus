---
name: plugin-solo
description: Use when editing plugins/serio-focus/scripts/lifecycle/solo.mjs, the solo-owner lane: start, advance, gate, confine, resume, launch, publicRecord.
---

## Exports

| Export | Contract |
|---|---|
| `io` | `{ one, all, send, raw, push, start, spawn }`, real `gh` by default, all synchronous; `one(path)` returns `repos/<r>/issues/<n>`, `repos/<r>/commits/HEAD` `{ sha }` (base) or `repos/<r>/pulls/<n>` `{ number, head: { sha, ref } }`; `raw(path)` CODEOWNERS text; `all(path)` comments `{ user: { login, type }, body }`; `send(method, path, body)` with `body.body` the comment text; `push(ref)`; `start(stage, head)`; `spawn(cmd, args, opts)` is `spawnSync` |
| `start({ repo, issue, owner }, io)` | `criteria_sha` digests the `AC<n>` lines of the issue body; returns `auth` `{ repo, issue, owner, spec_sha, criteria_sha, base_sha, branch }`; sends one `<!-- solo v1 spec=<sha> criteria=<sha> base=<sha> owner=<login> -->` comment; throws `solo: <actor> is not a code owner` |
| `advance(auth, criteria, events, trusted)` | no `io`, sends nothing; `criteria` `[{ ac, test }]`; `events` are host events in arrival order `{ stage: 'red', sha }`, `{ stage: 'locked', sha }`, `{ stage: 'reviewed', head }`, `{ stage: 'verified', actor, source, verifier, run, attempt, tests }`; `trusted` `{ owner, head, app, verifier, run }` comes from the host, never from an event; `tests` are `cases()` rows `{ name, result }`; returns `{ records }` of stages `spec`, `red`, `locked`, `reviewed`, `verified` in order, stopping before the first stage whose evidence fails: `locked.sha` not the `red` sha, `reviewed.head` not `trusted.head`, or `verified` rejected by `gate` with `lock` = the red sha; `verified` holds `head_sha`, `verifier` and criteria `[{ ac, test, result }]` |
| `gate(candidate, trusted, io)` | returns `{ ok, line, record }`; `candidate` `{ criteria, actor, reviewed, lock, source, verifier, run, tests }` is what the result claims; `trusted` `{ owner, head, lock, app, verifier, run }` is host data supplied separately; first failing code of `actor` (not `trusted.owner`), `head` (`reviewed` not `trusted.head`), `lock` (not `trusted.lock`), `source` (`source` not `trusted.app` or `verifier` not `trusted.verifier`), `missing` (criterion test absent), `skipped`, `failed`, `superseded` (`run` not `trusted.run`) gives `verification: reject — <code>`, `record` null, `io.send` and `io.push` never called; else `verification: pass` and a `record` whose `head_sha`, `lock_sha` and `verifier` come from `trusted` |
| `confine(auth, io)` | returns an `io` that passes an allowed `send` or `push` through and returns its result unchanged; allows only comments on the task issue or pull request and PATCH of the task pull request, any other call throws `solo: publisher refused <METHOD> <path>` (including `pulls/<n>/reviews`, `pulls/<n>/merge` and `issues/<n>/labels`); `push` of a ref other than `auth.branch` throws `solo: publisher refused push <ref>` |
| `resume({ repo, number }, io)` | `number` is the pull request number; the task issue comes from its `head.ref` `agent/<n>-…`; returns `{ started, stage }`; reads the `solo v1` marker and `<!-- solo-proof stage=<stage> sha=<sha> run=<url> -->` comments, trusted only from the owner or `github-actions[bot]`; writes `status()` with run links, `Now: <stage>` naming the stage it starts and `Next: <actor> — <action>`; calls `io.start` once with the next incomplete stage and records `<!-- solo-start stage=<s> head=<sha> -->`; an identical repeat starts nothing (`started: null`); a changed spec or criteria digest throws `solo: intent changed; run solo.mjs start <issue> again` |
| `launch(role, task, env, io)` | `role` `worker` or `test`; `task` `{ repo, issue, stage }`; calls `io.spawn(cmd, args, { env })` once and returns its result; the child env holds only `HOME` and `PATH` from `env`, so the worker uses the local `claude` login; an `ANTHROPIC_API_KEY` in `env` leaves the call unchanged; no credential value of `env` reaches `cmd`, `args` or the child env |
| `publicRecord(raw)` | no `io`; keeps only repository, issue, pr, spec_sha, base_sha, head_sha, lock_sha, stage, verifier, run, attempt, outcome and criteria rows `{ ac, test, result }` |

## Rules

| Rule | Detail |
|---|---|
| `io` argument | only `start`, `gate`, `confine`, `resume`, `launch` take a last `io` |
| CLI | `solo.mjs start\|resume <issue>` |
| Self-test | `solo.mjs --self-test` is listed in `npm test` |
| Router | `route()` of route.mjs is unchanged; the interactive lane still needs a code owner's `spec-ok` and `tests-ok` |
