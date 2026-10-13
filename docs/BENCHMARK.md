# Benchmark

<sub><b>Answers</b> · how the guard is scored and its last result · <a href="../README.md">README</a></sub>

<img src="tiles-wins.svg" width="720" alt="Wins: corpus recall; false blocks; labelled cases">

## Method

| Step | Rule |
|---|---|
| Corpus | `tooling/corpus/guard-corpus.jsonl`: one labelled call per line; `want` is `block` or `allow`; `origin` is `spec`, `probe` or `regression` |
| Run | Each case goes through `plugins/serio-focus/scripts/guard.mjs` in a fresh git repository |
| Score | Recall = held blocks ÷ all blocks; false blocks = held allows ÷ all allows |
| Gate | `npm test` and the CI job `guard eval` fail on any miss |
| Publish | `npm run upkeep` writes `tooling/results/scores.json`, which the README badges read |

## Result

<!-- serio-scores -->
| Measure | Value |
|---|---|
| Labelled cases | 48 |
| Recall: blocks held | 100% |
| False blocks: allows held | 0% |
| Startup context | ~270 tokens |
<!-- /serio-scores -->

## Static figures

| Figure | Source |
|---|---|
| `docs/flood.svg` | Guard replay 2026-09-23, plugin 1.15.0: 20 `Agent` dispatches in one wave, 3 start, 17 held for the next wave. The cap is unchanged since. Static, not regenerated. |

## Cost and limits

<img src="tiles-cost.svg" width="720" alt="Cost: startup context; cloud sessions; OpenCode subagents">

| Limit | Detail |
|---|---|
| Corpus | Proves the listed calls only; not a claim of complete coverage |
| Cloud sessions | Plugin hooks do not run there |
| OpenCode | The bridge judges shell calls; its subagents bypass the guard |
| Codex | Hook trust is per hash; review it in `/hooks` after every update |
| Known gaps | [SECURITY.md](../SECURITY.md) |
