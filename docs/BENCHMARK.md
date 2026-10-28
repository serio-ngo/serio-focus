# Benchmark

<sub><b>Answers</b> · how the guard is scored and its last result · <a href="../README.md">README</a></sub>

## Method

| Step | Rule |
|---|---|
| Corpus | `tooling/corpus/guard-corpus.jsonl`: one labelled call per line; `want` is `block` or `allow`; `origin` is `spec`, `probe` or `regression` |
| Run | Each case goes through `plugins/serio-focus/scripts/guard.mjs` in one shared git repository with untracked, tracked and ignored fixtures |
| Score | Recall = held blocks ÷ all blocks; false blocks = held allows ÷ all allows |
| Gate | `npm test` and the CI job `guard eval` fail on any miss |
| Publish | `npm run upkeep` rewrites the result table below |

## Result

<!-- serio-scores -->
| Measure | Value |
|---|---|
| Labelled cases | 56 |
| Known gaps held out | 9 |
| Recall: blocks held | 100% |
| False blocks: allows held | 0% |
| Startup context | ~478 tokens |
<!-- /serio-scores -->

## Cost and limits

| Limit | Detail |
|---|---|
| Corpus | Proves the listed calls only; not a claim of complete coverage |
| Cloud sessions | Claude cloud sessions do not install plugins, so the hooks do not run |
| Codex | Hook trust is per hash; review it in `/hooks` after every update. The guard sends only `deny`, so Codex and Claude behave the same |
| Known gaps | [SECURITY.md](../SECURITY.md) |
