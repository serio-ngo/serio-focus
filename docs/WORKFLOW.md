# Minimal development workflow

| Field | Value |
|---|---|
| Status | Implemented local Codex setup; native role contracts below; verification state in the session plan |
| Reviewed | 2026-10-12 |
| Implementation | [Session plan](sessions/session-02-minimal-workflow.md) |
| Scope | Shareable coding setup; no account data, credentials or organisation policy |

## Ownership

| ID | Recommendation | Why | Basis |
|---|---|---|---|
| W01 | Keep upstream Ponytail Full as the coding and review method. Do not copy its instructions. | One maintained workflow avoids conflicting advice. | P1; project `AGENTS.md` |
| W02 | Let each repository own commands, acceptance criteria and release authority. | A reusable setup cannot assume a language, framework or deployment method. | `CONTRIBUTING.md`, Scope |
| W03 | Limit Serio Focus to optional, deterministic controls with demonstrated native-host behavior. | Hooks must earn their maintenance cost with evidence beyond prompt advice. | P2; P5 |
| W04 | Keep one implementation writer. Use a separate reviewer only when the task needs independent scrutiny. | Sequential fixes preserve ownership and avoid competing branch edits. | P3; P4; design recommendation |
| W05 | Inherit the host's model and effort selection; remove model rewriting and model lists from shipped files. | The same setup must work with different providers and user choices. | Project `AGENTS.md`, rule 6; P3; P4 |
| W06 | Use native repository permissions and GitHub merge controls as the authority. Treat shell-pattern hooks as supplementary. | A command matcher is not a sandbox or a complete egress boundary. | P5; P6 |

## Startup and loading

| Layer | Load | Acceptance |
|---|---|---|
| Repository instructions | Native `AGENTS.md` or host-supported equivalent | Read the effective instructions; do not inject a second copy |
| Ponytail | Upstream native hook, once per relevant context | Confirm native loading; read the skill once only when its rules are absent |
| Serio Focus | Active controls and recovery pointer only | At most three lines and 600 UTF-8 bytes of added startup text; no copied workflow |
| Roles | On task demand | No automatic architect/reviewer/tester fan-out |
| Skills | Relevant description, then body on use | No generic planning or delegation skill alongside Ponytail |
| Host adapters | Only the selected host | No claim that Claude hooks also enforce Codex or cloud behavior |

- Use progressive disclosure from P7; enforce the startup size budget during package review.
- Keep organisation sources and personal reply preferences outside the shareable plugin.
- Report unsupported features explicitly; never count an installed manifest as a successful hook invocation.

## Roles

| Role | Recommended implementation | Input | Output | Boundary |
|---|---|---|---|---|
| Architect-planner | Main session in native planning mode; separate read-only agent only for an independent design question | Goal, affected callers, constraints, existing patterns | Smallest design, changed paths, acceptance checks, unresolved material facts | No implementation, dependency installation or external writes during the planning pass |
| Implementer | Main local Claude/Codex session under Ponytail Full | Accepted scope and current branch state | Smallest complete patch and observed check results | One writer; preserve unrelated edits |
| Reviewer | Existing Ponytail review skill in a fresh native context when needed; Codex review at the PR | Base/head revisions, diff, affected callers, repo rules | Prioritized actionable findings with location, consequence and evidence; or no findings plus limits | No fixes, merge or publication; restrict write-capable tools |
| Check runner | Existing project commands in the terminal or CI | Trusted commands from the repository | Exit status and concise failure evidence | No model agent for deterministic command execution; build outputs may be written |
| Test author | Disabled draft below | Approved failing behavior | One regression case in the existing suite | No automatic registration or invocation |

- Pass only goal, allowed paths/tools, current revision, evidence and expected output to a delegated role.
- Use Claude's native Plan/Explore roles and Codex's native explorer/worker before adding wrappers. Supply applicable repo rules when a built-in role omits them. See P3 and P4.
- A read-only role must use actual host restrictions. A prompt saying “read-only” does not constrain unrestricted shell or connector tools. Check effective parent permission overrides.
- Keep host-specific manifests thin. Reuse one role contract; avoid hand-maintained copies of its full prompt in each host.

## TDD draft — disabled

| Stage | Future contract | Required evidence |
|---|---|---|
| Activation | Enable explicitly for a repository and task after its test policy permits it | Named existing test command and allowed test files |
| Red | Test the requested failure through an existing public boundary; change no production code | Failure caused by the reported behavior, not syntax, fixture setup or a missing dependency |
| Green | Return implementation ownership to the main session | The same case passes without weakening assertions |
| Refactor | Simplify only the affected path | Required project checks remain green |
| This repository | Add a failure case to the existing suite/list; follow `AGENTS.md` | `npm run prove` demonstrates failure on archived HEAD and success on the tree |
| Disabled state | Keep this contract in documentation only | No test-author agent file, startup hook, scheduler or new test helper |

## Development to review

| Step | Recommended action | Exit evidence |
|---|---|---|
| 1. Intake | Read effective repo instructions, existing work, dirty files and affected code. Set task acceptance criteria. | Known scope and baseline; unexplained failures remain visible |
| 2. Prepare | Use one task branch or isolated worktree when concurrent work requires it. Plan only substantial changes. | One writer and named base revision |
| 3. Implement | Reproduce a fault, change its shared cause, run affected and required checks. | Patch and command results tied to the current tree |
| 4. Local review | Use the reviewer for substantial or risky changes; fix supported findings. | Findings resolved or explicitly retained with reasons |
| 5. PR | Prepare the PR description with behavior, validation and limits. Have the authorized owner publish it. | Remote branch head and PR URL read back after publication |
| 6. Codex review | Use native automatic review, configured for updates to the PR branch. | Completed review associated with the current head, not just a trigger reaction |
| 7. Fix | Resume the local writer on the same branch. Verify each finding against current code; make the smallest fix. | New local proof and owner-published head |
| 8. Repeat | Re-run checks and obtain review after each reviewable head change. Treat old results as stale. | Latest head checked; actionable threads addressed |
| 9. Merge | Owner verifies required checks, review evidence and unresolved findings, then merges. | Recorded merge result; production release remains a separate owner action |

- Continue until all requested results are verified or the user explicitly authorizes stopping.
- Ask blockers and necessary questions through interactivity; keep them pending and continue independent authorized work.
- Do not finish with failed checks, missing authority or an unanswered required question.

## PR controls

| ID | Recommendation | Why | Verification |
|---|---|---|---|
| R01 | Enable native Codex Automatic review for all PRs; select the trigger after every push. | Avoid a second bot, API key or workflow posting repeated comments. | Reload saved settings; on an authorized test PR, verify reviews at two successive heads without a manual trigger; P8 |
| R02 | Treat “every change” as every new reviewable head. Request review again after a base change or a material acceptance-criteria change when the native trigger does not cover it. | Titles, comments and reactions are not all code-review events. | Record the base/head covered by the last completed review |
| R03 | Require PRs, the existing CI checks, and resolution of review conversations on the protected branch. For teams with another eligible maintainer, require a fresh human approval. | Checks must gate merges; a bot comment is not a human approval. | Read back rules and demonstrate a blocked merge with failing or missing checks; P6 |
| R04 | Keep local Claude/Codex as the default fixer. | Existing tools, credentials and project context are already available. | Reproduce, fix and validate at the current PR head |
| R05 | Use cloud fixes only as an explicitly authorized handoff for a self-contained change. Suspend the local writer until the result is retrieved. | Cloud needs its own environment and may push branch changes. | Inspect cloud patch, new head and CI; re-review before merging; P8 |
| R06 | Reassess after two cycles repeating the same finding or failure. Ask interactively for missing authority or a material decision; continue independent work while waiting. | Bound churn while preserving the session completion contract. | Retain exact failures and current revision; finish only after verification or explicit user permission to stop |

- If native update review is unavailable, use an owner-posted `@codex review` after each published head until a tested replacement exists. Do not claim automatic coverage.
- Do not enable an unbounded comment-triggered fix loop, automatic merge, privileged execution of untrusted PR code, or a second parallel fixer.
- GitHub rules enforce CI and approvals; the owner's completion check covers Codex review freshness unless a real required review check is available and tested.

## Proof and portability

| Level | Demonstrate | Do not infer |
|---|---|---|
| Unit/corpus | Expected results on the named inputs | General reliability, token savings or live installation |
| Native host | Fresh trusted session; expected allow/block behavior; no duplicate context; useful unsupported-feature result | Parity across other hosts |
| Shareable package | Clean install in an unrelated disposable repo; no organisation paths; uninstall restores prior owned state | Installation in one developer's cache proves distribution |
| PR integration | Review and CI complete for a second published head; merge gate rejects failure | Saved settings alone prove event delivery |
| Context cost | Measure the complete native prompt and total task usage, including forced styles and subagents | Character estimates or “tokens kept out” are net savings |

## Primary sources

| ID | Source | Retrieved | Used for |
|---|---|---|---|
| P1 | [Upstream Ponytail](https://github.com/DietrichGebert/ponytail) | 2026-10-12 | Existing coding and change-review workflow |
| P2 | [Claude hooks](https://code.claude.com/docs/en/hooks) | Repository reference; recheck before implementation | Hook contracts; see `CLAUDE_CODE_FACTS.md` |
| P3 | [Claude subagents](https://code.claude.com/docs/en/sub-agents) | 2026-10-12 | Native roles, tools, inheritance, plugin limitations |
| P4 | [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | 2026-10-12 | Native roles, TOML agent files, effective permissions |
| P5 | [OpenAI plugins](https://learn.chatgpt.com/docs/plugins) | 2026-10-12 | Native hooks, trust and cloud limitations |
| P6 | [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) | 2026-10-12 | Required checks, PRs, fresh approvals, resolved conversations |
| P7 | [Agent Skills specification](https://agentskills.io/specification) | 2026-10-12 | Progressive loading and reusable skill structure |
| P8 | [Codex GitHub review](https://learn.chatgpt.com/docs/third-party/github) | 2026-10-12 | Automatic review settings and explicit cloud fixes |
| P9 | [Claude skills](https://code.claude.com/docs/en/skills) | 2026-10-12 | Host extensions beyond portable skill frontmatter |
| P10 | [Codex hooks](https://learn.chatgpt.com/docs/hooks) · [Native plugin layout](https://developers.openai.com/plugins/build/plugins) | 2026-10-12 | Native manifest, shell normalization, trust and supported events |
