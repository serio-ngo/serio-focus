---
name: plugin-scripts
description: Use when editing plugins/serio-focus/scripts/trace.mjs or receipt.mjs, the transcript reader and the Stop hook that reports from it.
---

## Record

`trace(file)` takes a transcript path (one JSON row per line) and returns this record.

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
| Receipt | receipt.mjs (Stop hook) writes `calls` as the record's `turns` and `tokens` as the sum of its four `tokens` kinds; it reads `files` from the transcript itself |
