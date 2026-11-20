---
name: plugin-lib
description: Use when editing plugins/serio-focus/scripts/lib/ (runtime.mjs, lifecycle.mjs), the shared helpers of hooks and lifecycle scripts. Covers exports, the version reader and size limits.
---

## runtime.mjs exports

| Export | Contract |
|---|---|
| `rootOf()` | state directory from `SERIO_OS_DIR` or `CLAUDE_PLUGIN_DATA` |
| `sessionOf(payload)` | sanitised `session_id`, else `unknown` |
| `version()` | `version` of `.claude-plugin/plugin.json` |

## lifecycle.mjs exports

| Group | Exports |
|---|---|
| GitHub API | `one(path)`, `all(path)`, `send(method, path, body)`, `raw(path)` |
| Actors | `person`, `robot`, `owns(user, own)`, `owners(text)`, `ownersOf(repo)` |
| Spec | `specSha(issue)`, `specComment`, `specMarker` |
| Tests lock | `testsOk(body)`, `lockReview`, `lockOf` |
| Redaction | `redact(text)` — text to text, each secret and e-mail address becomes `[redacted:<kind>]` |
| Status | `statusLog(body)`, `isStatus(comment, own)`, `status(repo, target, update, io)` with `io` `{ all, send, raw }`, `park(repo, number, why)` |

## Rules

| Rule | Detail |
|---|---|
| Version reader | `version` in runtime.mjs is the only reader of plugin.json's version in plugins/ and tooling/ |
| Exports | each export is imported by another file; `statusBody` in lifecycle.mjs is module-private |
