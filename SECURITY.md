# Security

| Review before install | Command |
|---|---|
| Hooks | `cat plugins/serio-focus/hooks/hooks.json` |
| Scripts | `cat plugins/serio-focus/scripts/*.mjs plugins/serio-focus/scripts/lib/*.mjs` |
| Suite | `npm test` |

| Plugin review question | Answer |
|---|---|
| Hook events | `SessionStart` card, `PreToolUse` guard on edit, spawn and mail-send tools, `Stop` receipt |
| Network egress | none; no model call, API key or runtime dependency |
| Files written | `audit/YYYY-MM.jsonl` receipts only, under `SERIO_OS_DIR`, the plugin data directory, else `~/.serio-focus` |
| Data kept | receipt counts and edited paths |
| Permissions shipped | none; a plugin cannot ship them; `.claude/settings.json` holds the repository baseline |
| Removal | `node tooling/cli/serio.mjs uninstall` or `claude plugin uninstall serio-focus@serio-ngo` |

| Report | Rule |
|---|---|
| Channel | GitHub private vulnerability reporting (Security, then Report a vulnerability) |
| Ban | no public issue; no live credentials |
| First response | within 7 days |

| Not covered | Left to |
|---|---|
| Shell commands, deletes, pushes, issue creation | the host's permission mode |
| Non-mail connector sends | the host's permission mode |
| Mail sends by a tool whose name lacks a mail word and a send verb | the host's permission mode; the mail rule matches tool names only |
