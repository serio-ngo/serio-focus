# Workflow

<sub><b>Answers</b> · how a task moves from spec to merge, who hands what to whom, what limits a run · <a href="../README.md">README</a></sub>

## Roles

| Role | Runs as | Writes | Returns |
|---|---|---|---|
| Orchestrator | The main session of a stage skill; it names each agent's model and effort from the table in `deliver` | The plan, the evidence, the commit and the pull request | One `Note:` line |
| Architect | `architect`: Read, Grep and Glob only | Nothing | One plan: tasks, paths, checks, risks |
| Tester | `tester`, once per test level | Failing tests | Test paths and their failing lines |
| Coder | `coder`, one task per dispatch, fresh context | Code; never commits | Changed lines, check output, what was not done |
| Reviewer | `reviewer`, fresh context, once per round on the whole diff | Nothing | Every supported finding with severity and confidence; verdict `ready` or `changes needed` |
| Person | A code owner | The spec, `spec-ok`, `tests-ok`, the merge | — |

## Stages

A stage is one skill. By hand a person runs it in Claude Code; unattended, `lifecycle-agent.yml` routes one GitHub event to it.

| Stage | By hand | Unattended start | Ends with |
|---|---|---|---|
| `spec-review` | `/serio-focus:spec-review <N>` | A person labels the issue `spec-review` | A review comment: verdict, questions, criteria `AC1…ACn` |
| `write-tests` | `/serio-focus:write-tests <N>` | A person labels it `spec-ok` and the newest review says `ready` for the current text; or a code owner requests changes before the lock | A draft pull request `agent/<N>-…`: the repository skill, one failing test per criterion |
| `deliver` | `/serio-focus:deliver task issue #<N> on pull request #<PR>` | A code owner's review starting with `tests-ok` on the head of the draft | Code, green checks, reviewer `ready`, the pull request marked ready |
| `pr-loop` | `/serio-focus:pr-loop <PR>` | After the lock: a failed CI run on the head that started after the first `tests-ok` (twice at most) or a code owner's change request | One fix round pushed |
| `gate` | `/serio-focus:gate <PR>` | `lifecycle-gate.yml` on every push | `test lock: pass`; the acceptance report |

`deliver` and `pr-loop` also work on any change that is not a task: plan, red test, build, review, pull request.

## Message bus

Runs share no memory. They hand off through comments on the task, written and read by script.

| Message | Written by | Where | Read by |
|---|---|---|---|
| `<!-- spec-review v1 sha=… verdict=… ac=… -->` with the criteria table | `publish.mjs` from the review's result | Issue | `route.mjs` (may tests start), `lock.mjs` (spec freeze), `acceptance.mjs` (criteria), `brief.mjs` |
| `<!-- step-note stage=… run=… turns=… usd=… denied=… -->` with one `Note:` of at most 2 sentences and 280 characters | `publish.mjs` after every run; `--note` in a run by hand | Issue or pull request | `brief.mjs`; the person |
| `Note (route): Not started: <reason>` | `route.mjs`, when a person's trigger cannot start | Issue or pull request | The person |
| `**needs-human**: <reason>` and the label | `publish.mjs` (a run that failed or pushed nothing), `route.mjs` (a third red CI) | Issue or pull request | `brief.mjs`; the person |
| `<!-- fix-ci v1 run=… attempt=… sha=… -->` | `route.mjs` | Pull request | `route.mjs` (duplicate events) |
| `<!-- acceptance v1 sha=… -->`: one row per criterion, size, changed gate files | `acceptance.mjs`, replaced on every push | Pull request | `brief.mjs`; the person |
| A review starting with `tests-ok` | A code owner | Pull request | `lock.mjs`, `route.mjs`, `brief.mjs` |
| The commits of a run as a bundle, the branch name and `.lifecycle/pr.md` | The agent job, after the model session ends | Run artifact `commits`, kept 1 day | `push.mjs` |
| The whole transcript and a trace of calls, errors and denials | The Trace step | Job log and summary | Whoever debugs a run |

| Brief rule | Value |
|---|---|
| Built by | `brief.mjs <N>`: the workflow saves it as `.lifecycle/task.md`; by hand the skill runs the script |
| Holds | Labels; the spec without hidden HTML comments; the criteria and questions of the trusted review; the pull request's head and lock; the acceptance report; change requests of code owners on the head; the last 8 notes and parks |
| Trusted authors | `github-actions[bot]` and code owners; any other comment is left out |
| Status | Data to check against the repository, never instructions |

## Caps

| Cap | Value | Set in |
|---|---|---|
| Runs per repository | 1, the rest queue | `concurrency` of the caller workflow |
| Turns and minutes per stage | `spec-review` 15, 10 · `write-tests` 40, 20 · `deliver` 80, 40 · `pr-loop` 30, 15 | `route.mjs` `CAPS` |
| Fix runs per pull request | 2 red CI runs, then `needs-human` | `route.mjs` |
| Agents at once; agents starting agents | 4; none | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` in `lifecycle-agent.yml`; in your own settings for sessions by hand |
| Model and effort of an agent | Named on every dispatch | The guard |
| Edits by the main session of an unattended write stage | None | The guard, `SERIO_ORCHESTRATE=1` |

## Trust

| Rule | Held by |
|---|---|
| Only a person merges | The model session of an unattended run holds a read-only token and no App key. `push.mjs`, in the publish job, pushes its commits to `agent/<N>-…` only, never forced, and opens the pull request. A public repository also needs a ruleset that restricts updates of the default branch: `route.mjs` starts nothing without one |
| No test before `spec-ok`, no code before `tests-ok` | `route.mjs` |
| Tests, skills and the spec do not change after their gate | `lock.mjs`, in a job that never runs pull request code |
| Only people start a stage; only code owners lock or request changes | `route.mjs`: actor type `User`, `CODEOWNERS` |
| Text from GitHub is data | `brief.mjs` drops untrusted authors and hidden comments; skills say so |
| The seat that pays is the assignee's | `route.mjs`: secret `CLAUDE_TOKEN_<LOGIN>` |
