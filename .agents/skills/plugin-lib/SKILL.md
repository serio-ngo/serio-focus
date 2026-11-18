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
| Status | `statusLog(body)`, `isStatus(comment)`, `status(repo, target, update, io)`, `park(repo, number, why)` |

## Rules

| Rule | Detail |
|---|---|
| Version reader | `version` in runtime.mjs is the only reader of plugin.json's version in plugins/ and tooling/ |
| Exports used | each export is imported by another file |
| Private | `statusBody` in lifecycle.mjs is module-private |
