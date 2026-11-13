<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
  <img src="docs/logo.svg" width="240" alt="Serio">
</picture>

# serio-focus

**An AI dev lifecycle for Claude Code: a spec, locked tests, code and fixes by four role agents, with three human gates.**

[![version](https://img.shields.io/github/package-json/v/serio-ngo/serio-focus?label=version&color=1f6feb)](plugins/serio-focus/.claude-plugin/plugin.json)
[![verify](https://github.com/serio-ngo/serio-focus/actions/workflows/verify.yml/badge.svg)](https://github.com/serio-ngo/serio-focus/actions/workflows/verify.yml)
[![license](https://img.shields.io/github/license/serio-ngo/serio-focus?color=1f6feb)](LICENSE)

</div>

## One task

| Step | Who | Does |
|---|---|---|
| 1 | you | Write the spec as an issue |
| 2 | agent | `spec-review`: a verdict, questions and criteria `AC1…ACn` |
| 3 | you | Label the issue `spec-ok` |
| 4 | agent | `write-tests`: the repository skill and one failing test per criterion, as a draft pull request |
| 5 | you | Submit a review that starts with `tests-ok`: it locks the tests and the skill |
| 6 | agent | `deliver`: code until the locked tests pass, a fresh-context review, the pull request marked ready |
| 7 | script | The test lock and the acceptance report: one row per criterion |
| 8 | you | Approve and merge |

Scripts route, lock, report and publish; models only write. Every run leaves a note on the task, and the next run starts from one brief built from those notes. Roles, hand-offs and caps: [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Use

| For | Run |
|---|---|
| Any change, by hand | `/serio-focus:deliver <goal>`, then `/serio-focus:pr-loop <PR>` |
| One stage of a task, by hand | `/serio-focus:spec-review <issue>` · `/serio-focus:write-tests <issue>` · `/serio-focus:deliver task issue #<N> on pull request #<PR>` · `/serio-focus:gate <PR>` |
| Unattended, in GitHub Actions | Start from [lifecycle-sandbox](https://github.com/serio-ngo/lifecycle-sandbox): its two workflows call `lifecycle-agent.yml` and `lifecycle-gate.yml` of this repository |

Agents: `architect` plans and edits nothing, `tester` writes one failing test per behaviour, `coder` builds one task per dispatch, `reviewer` reviews the diff in a fresh context. The main session orchestrates on the model you chose and names a cheaper model for every agent.

Every session also starts with reply rules for a neurodivergent reader: the result first, short bullets, one recommended action.

## Install

In Claude Code: `/plugin marketplace add serio-ngo/serio-focus`, then `/plugin install serio-focus@serio-ngo`, and restart.

From a checkout, also for Codex: `npm run setup -- --host claude` or `--host codex`, then `npm run doctor -- --host claude`.

No API key is needed: a run uses the developer's own Claude login, or their token from `claude setup-token` in Actions.

<div align="center">
<sub>

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [docs/WORKFLOW.md](docs/WORKFLOW.md) · [docs/MANIFEST.md](docs/MANIFEST.md) · [Apache-2.0](LICENSE) · Built by [Serio NGO](https://serio.org.pl)

</sub>
</div>
