# Plan

<sub><b>Answers</b> · what this repo does next, in order · rows leave when their release ships · <a href="../README.md">README</a></sub>

## Evidence — 2026-10-12

| ID | Finding | Source |
|---|---|---|
| E01 | Codex PR review answered "You have reached your Codex usage limits" on 38 of 40 PRs; real reviews only on #44 and #45 | `gh api repos/serio-ngo/serio-focus/issues/<n>/comments`, PRs #11–#51 |
| E02 | Delete lock held 65 of 17,525 replayed shell calls; Git Bash `/c/...` temp paths resolve to `C:\c\...` and are held | replay of 30 days of Claude transcripts through `judgeShell` |
| E03 | Claude Code returns "File unchanged since last read" natively and caps reads with `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | Claude Code 2.1.296 binary strings |
| E04 | Codex receipts logged zero usage; quota and rescue read Claude transcripts only | `audit/2026-10.jsonl` session rows, `lib/transcript.mjs` |
| E05 | Codex plugins ship skills and hooks, not agents; Codex reads roles from `~/.codex/agents/*.toml` and ignores unknown SKILL.md fields | <https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/manifest.rs>, trailofbits/skills#139, retrieved 2026-10-12 |
| E06 | Proven role set: planner, implementer per task, read-only reviewer in a fresh context, TDD gate | anthropics/claude-plugins-official `feature-dev`, obra/superpowers `subagent-driven-development`, retrieved 2026-10-12 |
| E07 | `main` requires 7 named checks, resolved conversations, stale-review dismissal; job names must stay | `gh api repos/serio-ngo/serio-focus/rules/branches/main` |

## Session 2026-10-12

| # | WHAT | WHERE | WHY | WHEN | DONE |
|---|---|---|---|---|---|
| T01 | Delete read budget, web cap, journal note, quota note, receipt, rescue, ledger, stats | `plugins/serio-focus/scripts/` | E03, E04: native duplicates and unprovable estimates | this session | `npm test` green; `ls plugins/serio-focus/scripts/lib` lists guard libs only |
| T02 | Map Git Bash drive paths before delete checks | `plugins/serio-focus/scripts/lib/shell-danger.mjs` | E02 | this session | `npm run prove` fails on HEAD, passes on tree |
| T03 | One `hooks/hooks.json` for both hosts: SessionStart and PreToolUse | `plugins/serio-focus/hooks/hooks.json`, `.codex-plugin/plugin.json` | Ponytail layout; no generated inline copy | this session | `claude plugin validate plugins/serio-focus` passes |
| T04 | One-line session card | `plugins/serio-focus/scripts/card.mjs` | minimal startup context | this session | suite keeps card plus agent and skill descriptions under 1,500 chars |
| T05 | Agents `architect`, `coder`, `reviewer`; `tester` draft outside `agents/`; skills `deliver`, `pr-loop` | `plugins/serio-focus/agents/`, `drafts/`, `skills/` | requested roles; E05, E06 | this session | suite checks agents, skills and Codex role text; native details list 3 agents, 2 skills |
| T06 | Cut the OpenCode bridge to the shell guard | `.opencode/` | `verify.mjs` removed | this session | suite calls `verdictFor` with `git push` and gets a GIT WRITE reason |
| T07 | Replace the benchmark harness with one corpus case; keep job names | `tooling/`, `.github/workflows/verify.yml`, `package.json` | E07 | this session | `npm run eval` exits 0; job names unchanged |
| T08 | Regenerate demo and tiles from live guard runs; write `scores.json` from the corpus for the badges | `tooling/cli/figures.mjs`, `tooling/cli/generate.mjs` | README keeps its NGO layout | this session | `npm run upkeep:check` exits 0 |
| T09 | README on the `main` layout with current text; `docs/WORKFLOW.md`, `docs/BENCHMARK.md` | repo docs | features changed | this session | local links resolve; layout matches `main` |
| T10 | Write Codex role agents on `setup --host codex`; remove them on uninstall | `tooling/cli/serio.mjs` | E05 | this session | suite checks the TOML text; `npm run doctor -- --host codex` checks the files |
| T11 | Release 1.22.0 and install locally in Claude | `CHANGELOG.md`, native CLI | native proof, not manifest proof | this session | `claude plugin list --json` shows 1.22.0 |
| T12 | Owner report and global instruction line | private report, `~/.codex/AGENTS.md` | Part 2 of the request | this session | report link returned; file read back |

## Backlog

| # | WHAT | WHERE | WHY | WHEN | DONE |
|---|---|---|---|---|---|
| B01 | Add Codex as the cross-model reviewer from Claude through `openai/codex-plugin-cc` (`/codex:review --base <default>`) in `deliver` step 3 | `plugins/serio-focus/skills/deliver/SKILL.md` | known bug: no OpenAI integration; E01 leaves PRs unreviewed | after 1.22.0 merges | one PR shows a Codex finding raised from a Claude session |
| B02 | Prove `@codex fix` pushes to the same PR branch | throwaway PR | cloud fix path is UNVERIFIED | next PR with a P2 finding | commit by Codex on the PR head |
| B03 | Prove Codex automatic review fires on a second push | throwaway PR | "On every push" is UNVERIFIED | next PR | a review whose "Reviewed commit" is the second head |
| B04 | Enable `tester`: move `drafts/tester.md` to `agents/`, add a TDD step to `deliver` | `plugins/serio-focus/` | draft until a repo opts into test-first | first repo that asks for TDD | native details list 4 agents |
| B05 | Prove the Codex role agents spawn by name | Codex app | Codex runtime of 1.22.0 is UNVERIFIED | first Codex session after `setup --host codex` | `spawn_agent` with `serio-architect` returns a plan |
