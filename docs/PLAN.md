# Plan

<sub><b>Answers</b> · what this repo does next, in order · rows leave when their release ships · <a href="../README.md">README</a></sub>

## Evidence — 2026-10-13

| ID | Finding | Source |
|---|---|---|
| E01 | 14,372 shell calls in 30 days; 1.23 held 56: 55 recursive deletes, 1 git wipe; most were tracked, clean folders or temp paths behind a variable | replay of `~/.claude/projects/*/*.jsonl` through `judgeShell` |
| E02 | Since 1.22: 3 holds, all in the release session; fan-out cap fired 4 times in total, last on 2026-09-24 | `audit/2026-09.jsonl`, `audit/2026-10.jsonl` |
| E03 | `SERIO_SCRATCH_DIR` and `SERIO_PROJECT_DIR` are set in no user or repository settings | `~/.claude/settings.json`, `~/Repos/*/.claude/settings*.json` |
| E04 | Claude: hook `ask` shows the native prompt; `-p` turns it into deny; plugin hooks do not run in cloud sessions | <https://code.claude.com/docs/en/hooks.md>, <https://code.claude.com/docs/en/cloud-environments.md> |
| E05 | Codex: `ask` fails open and the tool runs; `deny` with a reason blocks; stdin carries `turn_id`; SessionStart stdout becomes developer context | `codex-rs/hooks/src/engine/output_parser.rs`, <https://learn.chatgpt.com/docs/hooks> |
| E06 | Another installed coding-method plugin injects its rules into every subagent at SubagentStart | its `hooks/claude-codex-hooks.json` |
| E07 | Reply rules for ADHD readers: answer first, short chunks, one action with its values, warnings in full sentences | <https://www.w3.org/TR/coga-usable/>, <https://github.com/JuliusBrussee/caveman> |
| E08 | The suite fails 4 cases when the shell exports `SERIO_GIT_WRITE=1` | `npm test` on `main` |

## Session 2026-10-13 · 1.24.0

| # | WHAT | WHERE | WHY | DONE |
|---|---|---|---|---|
| T01 | Commit and push run; drop the git lock, its env switch and the settings unlock | `scripts/lib/shell-danger.mjs`, `tooling/settings/policy.json`, `tooling/cli/serio.mjs` | owner request; E08 | suite: `git commit`, `git push` allowed |
| T02 | Recursive delete runs when every target is in temp, an ignored build folder, or tracked and clean; otherwise `ask` in Claude, `deny` elsewhere. `git reset --hard` and `git clean -f` ask | `scripts/lib/shell-danger.mjs`, `scripts/guard.mjs` | E01, E04, E05 | `npm run prove` fails on HEAD, passes on tree |
| T03 | Remove dead and special-case code: scratch env, project-dir env, legacy session sweep | `scripts/lib/*.mjs`, `scripts/card.mjs` | E03 | suite green; no reference left |
| T04 | Session card carries the reply rules | `scripts/card.mjs` | E07 | suite: startup context under budget |
| T05 | `tester` agent on; `deliver` adds an optional red step, parallel coders on disjoint paths, ships the branch; agents defer to injected coding rules without naming them | `agents/`, `skills/` | owner request; E06 | suite lists 4 agents; Codex roles written |
| T06 | README: demo and agents first; drop flood figure, tiles, score badges and `scores.json` | `README.md`, `docs/`, `tooling/` | owner request; rule 1 | `npm run upkeep:check` exits 0 |
| T07 | Facts and docs follow the code | `docs/HOST_FACTS.md`, `docs/WORKFLOW.md`, `SECURITY.md`, `CONTRIBUTING.md` | rule 1 | no stale claim |
| T08 | Review, fix, release 1.24.0; sync the owner's settings | native CLI, `~/.claude/settings.json`, `~/.codex/AGENTS.md` | owner approval 2026-10-13 | reviewer verdict `ready`; settings read back |

## Backlog

| # | WHAT | WHERE | WHY | WHEN | DONE |
|---|---|---|---|---|---|
| B01 | Add Codex as the cross-model reviewer from Claude through `openai/codex-plugin-cc` (`/codex:review --base <default>`) in `deliver` step 4 | `plugins/serio-focus/skills/deliver/SKILL.md` | known bug: no OpenAI integration; Codex PR review hit usage limits on 38 of 40 PRs | after 1.24.0 merges | one PR shows a Codex finding raised from a Claude session |
| B02 | Prove `@codex fix` pushes to the same PR branch | throwaway PR | cloud fix path is UNVERIFIED | next PR with a P2 finding | commit by Codex on the PR head |
| B03 | Prove Codex automatic review fires on a second push | throwaway PR | "On every push" is UNVERIFIED | next PR | a review whose "Reviewed commit" is the second head |
| B05 | Prove the Codex role agents spawn by name | Codex app | Codex runtime is UNVERIFIED | first Codex session after `setup --host codex` | `spawn_agent` with `serio-architect` returns a plan |
| B06 | Prove hook `ask` prompts under `bypassPermissions` | Claude desktop | docs imply it, no live test | first session on 1.24.0 | prompt shown for `rm -rf` of an untracked folder |
| B07 | Resolve `NAME="literal"` set earlier in the same command before judging a delete | `plugins/serio-focus/scripts/lib/shell-danger.mjs` | 35 of 44 replayed 1.24 holds are temp paths behind a variable | after 1.24.0 merges | replay asks drop; corpus `D="$TEMP/probe"; rm -rf "$D"` stays held when `D` is reassigned |
