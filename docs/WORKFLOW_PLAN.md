# Workflow improvement plan

Source: promovid session 2026-09-25, owner verdict "slop", 1,142,376 subagent tokens in 2 workflows for 1 real finding (`audit/2026-09.jsonl` in promovid).

<!-- measured 2026-09-26 from 857 local transcripts: 56 workflow runs, median 352k, p90 825k, max 1.72M fresh tok; first turn of a workflow-subagent median 65k tok, serio-focus:scout 8k -->

## Guards — net LOC `+145/-17 net +128` in `plugins/`, `+34/-3` in `tooling/test/guard.test.mjs`

| WHAT | WHERE | WHY | STATUS | PROOF |
|---|---|---|---|---|
| Resolve read paths against a leading `cd <dir>` in the shell command | `lib/shell-reads.mjs` | 5 audit rows refused a same-named file in another repo | done | case `blocks a re-read … only bytes an earlier call delivered`; `npm run prove` |
| Refuse a re-read only when the earlier call delivered the bytes | `lib/read-budget.mjs`, `lib/transcript.mjs` (`failed`) | cause found: d5ad9b34 booked `voice.py` from a call a permission rule then denied | done | same case, denied-call assertion |
| Pass a read after the same command wrote the file | `lib/shell-reads.mjs` (`touched`) | `cat >> f <<EOF … cat f` and `sed -i … f && cat f` refused | done | same case |
| Pass a read past the 30,000-char shell output cap | `lib/read-budget.mjs` | 46935359 refused `package.json` cut from a truncated output | done | same case |
| Note near a usage limit: main documents all work per env and project instructions, subagents return | `lib/quota.mjs`, `guard.mjs` | limits hit with no warning; no hook carries usage percent | done | case `notes a near usage limit …`; replay: 22 of 22 five-hour hits noted first, median 53 min ahead |
| Run a subagent or workflow `agent()` with no type as `serio-focus:worker` | `lib/dispatch.mjs` (`slim`), `agents/worker.md` | a workflow-subagent boots at 65k tok, every connector schema included | done | case `routes a dispatch … one with no type to the worker`; worker boot UNVERIFIED until first run |
| Ask for results under 8 KB; re-read nothing the prompt quotes | `agents/worker.md` | 64 KB workflow result; agents re-read 15 files main had read | done | `grep -n "8 KB" plugins/serio-focus/agents/worker.md` |
| Cap one workflow at 200k subagent tokens | — | replay: cuts 75% of runs, the productive f6b9046e run used 712k | dropped | the worker boot saving replaces it |
| Deny `Workflow` after a prompt forbids it | — | needs a `UserPromptSubmit` hook and per-language phrases | deferred | — |
| Print `GITIGNORE` in the card when the host repo lacks the state lines | — | with `SERIO_OS_DIR` set, state lands in the OS dir; quota state reuses the ignored `.session-` prefix | deferred | — |

## Output style — net LOC `+2/-0`

| WHAT | WHERE | WHY | STATUS | PROOF |
|---|---|---|---|---|
| Ask one question naming the assumption and its default before changing a choice the owner made | `output-styles/focus.md` | Claude swapped the outro speaker and punctuation on inference and was reversed | done | `grep -n "choice the owner made" plugins/serio-focus/output-styles/focus.md` |
| A task list over 3 steps starts from a plan file with numbered AI tasks | `output-styles/focus.md` | the session drifted from the owner's intent | done | `grep -n "plan file" plugins/serio-focus/output-styles/focus.md` |
| Judge motion from a clip or 8 consecutive stills | — | project rule; belongs in promovid `AGENTS.md` | not shipped | — |
