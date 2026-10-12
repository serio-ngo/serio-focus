# AGENTS.md

| Scope | Rule |
|---|---|
| Code | hooks and scripts only |
| Data | never organisation data, secrets or identifiers |

## Rules

1. Each fact has one home. Do not duplicate facts between files.
2. Never send, publish, pay or submit.
3. Use deterministic scripts first. Let the host and user select models and native roles.
4. Write in tables and short imperative sentences. Continue until the requested result is verified or the user explicitly authorizes stopping. Use interactivity for blockers and necessary questions; continue independent work while waiting.
5. No comments in code. No runtime dependencies. The fewest lines and branches that pass the suite.
6. Nothing model-, price- or plan-specific in shipped files.
7. Max 300 lines per file in `plugins/`. Must-ship helpers live in `plugins/serio-focus/scripts/lib/`. Analysis-only code lives in `tooling/`.
8. The suite is one file, `tooling/test/guard.test.mjs`. Do not add a test file or a test helper. Assertions are blocking and failure cases only. A new guard rule adds one case to an existing list, not a new `describe`.
9. Prove every fix with `npm run prove`: the new case fails on `git archive HEAD` and passes on the tree.
10. Before working with Claude Code identifiers (hooks, permissions, plugin layout), read [docs/CLAUDE_CODE_FACTS.md](docs/CLAUDE_CODE_FACTS.md).
11. Docs carry data, not prose. `README.md` is the only exception.
12. Never hand-edit generated blocks between `<!-- name -->` markers.

> Every other `*.md`: tables, lists, commands, data-comment lines only.
> No paragraphs. No history. No decision narratives. No elaboration.
> Keep names self-explanatory; one short comment per section max.

Layout, commands, releases: [CONTRIBUTING.md](CONTRIBUTING.md).

## Code Review Rules

- Trace changed guards through their callers and native host payloads.
- Block permission bypasses, unsafe delete exceptions, missing failure proof and unsupported host claims.
- Preserve explicit model/role choices and complete instruction access.
- Verify the current PR head; retain unresolved findings and failed checks.
