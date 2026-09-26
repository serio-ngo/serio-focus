# Benchmark

<sub><b>Answers</b> · what the guard refused, would refuse and blocks — ledger · replay · track A · <a href="../README.md">README</a></sub>

<!-- ledger · replay · track A -->

| Track | Question | Status |
|---|---|---|
| Ledger | what the guard refused in live sessions | runs on every Stop hook |
| Replay | what the guard would refuse on recorded real traffic | `npm run benchmark:replay` |
| Track A | does the guard block what it claims to | `npm run benchmark:eval`, gated in CI |

## Static figures

| Figure | Source |
|---|---|
| `docs/flood.svg` | Guard replay 2026-09-23, plugin 1.15.0 working tree: 20 `Agent` dispatches in one wave, 3 start, 17 held for the next wave. Without the hook nothing is held, so all 20 start. Static, not regenerated. |

## Cost and limits

| Limit | Detail |
|---|---|
| Ordinary tasks | cost more tokens, not fewer — the guard buys a ceiling on the tail, not an average saving |
| Cowork | hooks do not fire there |
| OpenCode | its subagents bypass the guard |
| Known bypasses | four, listed open in [Track A](#track-a) |

## Context savings — what `npm run benchmark` prints

| Figure | Definition |
|---|---|
| `read volume` | every byte the session asked to put in the main thread |
| `kept out` | the part refused before entry |
| Share | `kept / read volume` |

| Line | Counter | Credited |
|---|---|---|
| re-read dedup | `bytes` | full file size — already in context, byte-identical |
| whole-file cap | `deferred` | full file size at refusal |
| trimmed | `trimmed` | bytes cut from a read over 24KB |
| read by subagents | `offload` | bytes read under a non-`main` actor; shown, never counted as kept out |
| admitted | `read` | bytes let into the main thread |
| dispatched scout / runner | `scouts`, `runners` | counted only |
| plugin footprint | — | session card + skill and agent descriptions, chars / 4, always in context |

| Share rule | Why |
|---|---|
| `net` is kept-out tokens minus footprint | the window cost in tokens; negative when the window did no whole-file reads |
| a retried refusal credits once | first refusal stamps `actor + path + mtime:size + rule`; repeats skip the byte credit |
| the follow-up read lands in the denominator | a slice read after a cap counts as `admitted` |
| session receipt | `kept out` as a share of the main thread's context: last request's input + cache write + cache read tokens |

- Only the current ledger format parses; older lines skip, never guessed.
- Bytes / 4 estimates tokens; never billing.

| Denominator | Scope |
|---|---|
| Counts | unsliced main-thread `Read` calls; shell-spotted whole-file reads |
| Misses | slices, `Grep` output, `Bash` output, subagent returns |
| Read as | share of whole-file read volume, not of the window |

## Billing — measured, not estimated

| Field | Source |
|---|---|
| `fresh` | `input_tokens` + `output_tokens` + `cache_creation_input_tokens`, from transcript `usage` |
| `cache-read` | `cache_read_input_tokens`, from transcript `usage` |
| Fallback | every transcript under `~/.claude/projects/<slug>/` when no ledger line carries billing |
| `context re-send ratio` | `cache-read / fresh`; the mechanism exploited, not the plugin |

## Replay — the guard against recorded traffic

```bash
npm run benchmark:replay
```

- Input: this project's transcripts under `~/.claude/projects/<slug>/`; every `Read` and `Bash` call, in order, one sandbox ledger per session.

| Property | Value |
|---|---|
| Input | real tool calls from real sessions, not fixtures |
| Isolation | one temp `SERIO_OS_DIR` per session, matching that session's dedup state |
| Loop | open — a refusal cannot change what the agent did next |
| Misses | shell pipelines and `$(...)`, which the read budget cannot size |
| Bias | guarded sessions produce fewer hits, so the count is a floor |

- Answers what the guard catches on this stream.

<!-- serio-replay -->
| The maintainer's 7 sessions — run it on yours | Count | Share of judged |
|---|---|---|
| Tool calls recorded | 742 | — |
| Judged by the guard | 553 | 100% |
| **Refused** | **10** | **2%** |
| — git and delete lock | 7 | 1% |
| — re-read dedup | 2 | 0% |
| — whole-file cap | 1 | 0% |

Every `Read` and `Bash` call from this machine's Claude Code transcripts, re-fed to the guard in order, one sandbox per session. Open-loop: a refusal cannot change what the agent did next, so this is what the guard catches on that exact stream, not a counterfactual. Reproduce with `npm run benchmark:replay`.
<!-- /serio-replay -->

## Live ledger — what the guard did on this machine

<!-- serio-stats -->
| Measured over 206 ledger lines | Tokens | Share |
|---|---|---|
| Read volume the session asked for | ~3.7M | 100% |
| **Kept out** | **~1.8M** | **47%** |
| — re-read dedup | ~58.8k | 2% |
| — whole-file cap | ~184.4k | 5% |
| — trimmed | ~1.5M | 41% |
| Admitted to the main thread | ~2.0M | 53% |
| Read by subagents, not counted as kept out | ~1.6M | — |

| Context tax — the plugin's own footprint | Tokens |
|---|---|
| Session card, always in context | ~153 |
| Skill descriptions, always in context | ~42 |
| Agent descriptions, always in context | ~68 |
| **Total footprint** | **~263** |
| Per turn, on top of that | **0** |
| **Net kept out minus footprint** | **~1.8M** |

| Measured billing | Tokens |
|---|---|
| Fresh — input + output + cache write | 53,650,107 |
| Cache-read | 2,959,831,139 |
| **Context re-send ratio** | **55.2×** — cache mechanism, not the guard |

Guard actions: 208 (used 14 scout, 1 runner). Token counts are file bytes / 4 from this repo's own local ledger, an estimate; the billing figures are measured. Method: [Billing](#billing--measured-not-estimated).
<!-- /serio-stats -->

## Track A

| Item | Value |
|---|---|
| Corpus | `tooling/corpus/guard-corpus.jsonl`, labelled; case counts in the `<!-- eval-results -->` block below |
| Runner | `npm run benchmark:eval`, exits 1 on a miss, gated in CI |
| Verdict | ask = held (exit 2 counts too) |
| `origin` field | `spec` = derived from the rule table, self-confirming · `probe` = found by adversarial probing · `regression` = reproduces a shipped bug |
| Scoring | recall never without false-positive rate; `known_gap` cases scored apart |

- Same corpus, same scoring, any `PreToolUse` guard on stdin:

```bash
SERIO_EVAL_GUARD="node ../other-guard/hook.mjs" npm run benchmark:eval
```

- No third-party guard run here. Self-test with published method.

## Comparison

```bash
npm run benchmark:compare
```

| Comparator | What it models | Fair to it |
|---|---|---|
| `none` | no guard, permission prompts only | The floor. Shows the corpus is not satisfiable by doing nothing. |
| `policy` | Claude Code `permissions.deny` globs, read from `tooling/settings/policy.json` | The real built-in alternative. Loses on connector and file-content cases because a glob cannot express them. |
| `keyword` | a pattern-list `PreToolUse` hook, ~35 dangerous-pattern regexes | The shape most published guard hooks ship. Graded on the same cases, including the safe ones. |
| `denyall` | block every tool call | The ceiling. Perfect recall, useless in practice — this is why recall is never reported alone. |

<!-- guard-scores -->
| Guard | Caught | Wrongly blocked | F1 |
|---|---|---|---|
| no guard, permission prompts only | 0% | 0% | 0.00 |
| Claude Code permissions.deny globs | 10% | 4% | 0.17 |
| a pattern-list PreToolUse hook | 25% | 13% | 0.36 |
| block every tool call | 100% | 100% | 0.63 |
| **serio-focus** | 100% | 0% | 1.00 |

43 cases, 2026-09-26; the comparators are mechanism baselines in `tooling/benchmark/baselines.mjs`, not vendor code.

26 of 43 scored cases are `spec` (rule-derived), 5 `probe`, 12 `regression`; recall here is a regression check, not a detection rate.
<!-- /guard-scores -->

- Mechanism baselines from published rule shapes, not vendor code; no product named.
- Same case list, same scoring; `tooling/benchmark/baselines.mjs` committed for repeat or dispute.
- `tooling/results/scores.json` written by the same run; feeds the README badges.
- Cost is context tax: the plugin's own footprint against the rot it keeps out, per window, in the ledger report.
- Spawn milliseconds print on `--latency` runs only; machine-specific, never published, never in `scores.json`.
- Multiple roots aggregate: `node tooling/benchmark/benchmark.mjs <repo…> [--write]`; combined totals print, outputs land in the first root.

<!-- eval-results -->
Run 2026-09-26 · 43 cases · guard `plugins/serio-focus/scripts/guard.mjs` · ask = held.

| Metric | Value |
|---|---|
| Recall | 20/20 (100%) |
| Precision | 20/20 (100%) |
| False-positive rate | 0/23 (0%) |
| F1 | 1.00 |
| Recall 95% CI (Wilson) | 83–100% — n=20 |
| FP-rate 95% CI (Wilson) | 0–15% — n=23 |
| Recall by origin | spec 14/14 (100%) · probe 3/3 (100%) · regression 3/3 (100%) |
| Known bypasses caught | n/a |

Confusion: TP 20 · FN 0 · FP 0 · TN 23. Bypasses scored apart.

26 of 43 scored cases are `spec` (rule-derived), 5 `probe`, 12 `regression`; recall here is a regression check, not a detection rate.
<!-- /eval-results -->
