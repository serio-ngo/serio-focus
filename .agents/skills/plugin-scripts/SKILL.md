---
name: plugin-scripts
description: Use when editing plugins/serio-focus/scripts/trace.mjs or receipt.mjs, the transcript reader and the Stop hook that reports from it.
---

## Record

`trace(file)` takes a transcript path (one JSON row per line; a line that is not JSON is skipped) and returns this record; a missing or empty file gives zero turns and empty lists.

| Field | Shape |
|---|---|
| `turns`, `durationMs` | numbers |
| `calls` | `{ <tool>: n }` |
| `tokens` | `{ input, output, cacheRead, cacheWrite }` |
| `models` | list of model names |
| `errors`, `denied` | list of `{ tool, input }` |
| `repeats` | list of `{ tool, input, times }` |
| `agents` | list of `{ type, model, turns, calls, tokens }` |
| `totals` | `{ turns, calls, tokens }` |

## Rules

| Rule | Detail |
|---|---|
| Command | `node trace.mjs <transcript>` prints the record as JSON |
| Agent files | `agent-<id>.jsonl` and `agent-<id>.meta.json` (`agentType`, `model`, `effort`, `parentAgentId`) lie beside the parent transcript |
| Listed agent | an agent is in `agents` when its meta file's `parentAgentId` is the read transcript's id |
| One reader | trace.mjs is the only transcript reader in plugins/ |
| Receipt | receipt.mjs (Stop hook) takes its calls and tokens from trace.mjs |
| Tests | trace.mjs has no `--self-test`; its tests are suite cases |
