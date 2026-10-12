# serio-focus

Optional deterministic guards for local Claude Code and Codex workflows. Repository instructions,
native roles and upstream Ponytail remain in control. No runtime dependencies, model calls or API keys.

<!-- serio-demo -->
<img src="docs/demo.svg" width="872" alt="serio-focus session: Agent · fourth direct call → FAN-OUT CAP: subagent 4 held. Next: wait one wave · Read src/big.js · 35 KB → READ CAP: big.js 35KB. Kept first 384 lines · Bash · git commit → GIT WRITE: &quot;git commit -m wip&quot; commit and push stays manual — draft the exact command and list it in the final state, do not run it · SERIO FOCUS · 2,816 tok kept out · 3 guard actions">
<!-- /serio-demo -->

## Setup

Use Node.js 22 or newer and the native host CLI. Clone this repository, then run:

```powershell
npm run setup -- --host codex
npm run doctor -- --host codex
```

In Codex, open `/hooks` and review the three Serio hooks before trusting them. Start a fresh session.
Installation, trust and successful invocation are separate checks. Setup uses the native plugin
commands and this local marketplace; it does not change authentication, model choices or permissions.

For Claude Code, select `--host claude`. The native CLI must be installed and signed in for a runtime
smoke test. The local marketplace reads this checkout; `folderVersion` can differ from cached registry metadata.
Install upstream Ponytail through its own marketplace and keep Full mode as your coding workflow.

| Command | Effect |
|---|---|
| `npm run setup -- --host codex` | Register this local marketplace and install the Codex plugin |
| `npm run setup -- --host claude` | Register this local marketplace and install the Claude plugin |
| `npm run doctor -- --host codex` | Check native installation and deterministic script probes; does not prove hook trust |
| `node tooling/cli/serio.mjs uninstall --host codex` | Remove this plugin through the native CLI; leave other plugins and user configuration alone |
| `npm run sync -- --scope project` | Apply the optional Claude permissions policy only when explicitly requested |
| `npm run upkeep` | Regenerate manifests, figures and marked blocks |
| `npm run upkeep:check` | Fail when generation changes saved artifacts; existing unrelated diffs are allowed |

## Guards

| Control | Behavior |
|---|---|
| Direct-agent wave cap | Hold the fourth direct Agent/Task/spawn_agent call in a wave; preserve its model, role and prompt. Opaque Workflow scripts are not parsed. |
| Read budget | Trim ordinary whole-file Read calls over 24 KB; hold recognized oversized shell reads and duplicate reads. Required instruction files and skill resources stay whole. |
| Shell gate | Hold commit, push, git wipes and unsafe recursive deletes. `SERIO_GIT_WRITE=1` enables commit/push only. |
| Scratch cleanup | Require resolved targets inside a verified temporary root or the project. Protect tracked paths and symlink escapes. Standard disposable project paths must be ignored; set `SERIO_SCRATCH_DIR` explicitly for another disposable project folder. |
| Web cap | Limit direct subagent web calls; keep main-session research open. |
| Receipt | Record local guard activity. Byte-based context estimates are not billing or measured net savings. |
| Claude recovery | Preserve recoverable work after native API failures. Quota notes require two observed limit hits; Codex does not use Claude transcript quota inference. |

Shell matching is supplementary, not a sandbox or complete security boundary. Review effective native
permissions. Unsupported events are omitted from the generated Codex manifest. Cloud orchestration
and OpenCode subagent parity are not covered by local hook proof.

## Workflow and proof

Use the [development workflow](docs/WORKFLOW.md): native planning, one writer, an on-demand reviewer,
existing project checks, then PR review at the current head. The TDD role remains a disabled draft.

```powershell
npm test
npm run prove
npm run benchmark:eval
npm run upkeep:check
```

The suite and corpus prove their named inputs. Native sessions prove installation and callback behavior.
PR review settings still need delivery evidence at the reviewed revision. Never infer universal reliability
or token savings from corpus scores.

[Session plan](docs/sessions/session-02-minimal-workflow.md) · [Manifest](docs/MANIFEST.md) ·
[Benchmark method](docs/BENCHMARK.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
[Apache-2.0](LICENSE)
