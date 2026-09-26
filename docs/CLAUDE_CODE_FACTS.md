# Reference — Claude Code identifiers

<sub><b>Answers</b> · which hook, permission, plugin and auth identifiers Claude Code accepts · <a href="../README.md">README</a></sub>

<!-- verified against `code.claude.com/docs` on 2026-09-04, hooks re-verified 2026-09-23; source per section -->

## Hooks

<details open>
<summary>Hook facts · 31 rows</summary>

| Fact | Value |
|---|---|
| File | `<plugin-root>/hooks/hooks.json`, same object shape as the settings `hooks` key |
| `matcher` tools | PreToolUse, PostToolUse, PermissionRequest, PermissionDenied (tool name); SessionStart (reason); SubagentStart/Stop (agent type) |
| No `matcher` | everything else |
| `"*"` / omitted | all |
| Exact / pipe-list chars | letters, digits, `_`, `-`, space, comma, pipe |
| Any other char | unanchored JS RegExp (`Edit.*` matches `NotebookEdit`) |
| Stdout reaches context | `UserPromptSubmit`, `SessionStart`, `PostModelSwitch` only |
| Stdin, every event | `session_id` `transcript_path` `cwd` `hook_event_name` |
| Stdin, tool events add | `tool_name` `tool_input`; `agent_id` and `agent_type` inside a subagent, workflow subagents included; both absent on main |
| Subagent session | reuses parent `session_id`; parallel siblings share `agent_type` (`workflow-subagent`, observed) — key per-agent state on `agent_id` |
| UserPromptSubmit | `user_prompt` (**not** `prompt`) |
| Stop / SubagentStop | `last_assistant_message`, **may be absent** — fall back to transcript JSONL; SubagentStop adds `agent_transcript_path` |
| StopFailure | turn ended on an API error; matcher on `error`: `rate_limit` `billing_error` `overloaded` `server_error` `max_output_tokens` `unknown` …; stdin adds `error` `error_details` `last_assistant_message`; cannot block, all output ignored |
| PreCompact / PostCompact | matcher `manual` or `auto`; PreCompact can block; stdout never reaches context |
| Project instructions | `AGENTS.md` read natively from v2.1.277; any `CLAUDE.md` in the same tree wins and `AGENTS.md` is ignored |
| Transcript JSONL | one row per content block; rows of one reply share `message.id` and repeat `usage` — count once per id (observed 2026-09-23) |
| Never use | `tool_response`, `stop_hook_active` |
| Exit `2` blocks | PreToolUse, UserPromptSubmit, Stop, SubagentStop; no retry cap documented, so a block reason names a remedy |
| PostToolUse | cannot block |
| `stderr` | exit-2 block reason only |
| Exit `0` | stdout parsed as JSON when it starts `{`, ends `}` |
| JSON output | exit `0`, stdout holds only the JSON object; exit `2` keeps blocking and the JSON fields are still read |
| PreToolUse `hookSpecificOutput.updatedInput` | **replaces the entire `tool_input`** — include unchanged fields; pair with `permissionDecision: "allow"` (auto-approve) or `"ask"` (show the rewritten input); deny/ask permission rules re-evaluate against the returned input |
| PreToolUse `permissionDecisionReason` | `allow` / `ask`: shown to the user, not Claude; `deny`: shown to Claude |
| PreToolUse `additionalContext` | string added to Claude's context alongside the tool result — the only rewrite field the model sees |
| PostToolUse `hookSpecificOutput.updatedToolOutput` | replaces the tool result Claude sees; must match the tool's output shape; the tool has already run |
| PostToolUse `updatedMCPToolOutput` | MCP tools only; prefer `updatedToolOutput` |
| `systemMessage` | universal field: warning text shown to the **user**, not model context; Stop honours it |
| Env | `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` |
| Kill switch | `"disableAllHooks": true` |

</details>

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash|Edit|Write",
  "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs\"" } ] } ] } }
```

- Source: <https://code.claude.com/docs/en/hooks.md>

## Permissions

| Order | Rule |
|---|---|
| Match | **`deny` → `ask` → `allow`; first match wins, specificity irrelevant** |
| Exception | a broad `deny` carries no `allow` exception |

| Rule | Correct form |
|---|---|
| Bash | `Bash(git push *)` — `:*` only at the end |
| Read / Edit | `Read(//c/Users/<you>/repo/.env)` |
| WebFetch | `WebFetch(domain:example.com)` |
| MCP | `mcp__gmail` · `mcp__gmail__send_email` · `mcp__gmail__*` — never with `(` |

| Windows / scope | Rule |
|---|---|
| Paths | POSIX (`C:\Users\<you>` → `/c/Users/<you>`); one leading `/` anchors at the settings file's directory — `//` for absolute |
| Trust dialog | `deny` and `ask` apply before it; `allow` does not |
| Hooks | hook decisions never bypass permission rules |

- Source: <https://code.claude.com/docs/en/permissions.md>

## Plugins, skills, subagents

| Fact | Value |
|---|---|
| Layout | plugin root holds `skills/`, `agents/`, `commands/`, `hooks/hooks.json` |
| `plugin.json` | inside `.claude-plugin/` only; `marketplace.json` at `<repo>/.claude-plugin/` |
| Install path | `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, keyed by `plugin.json` `version` — **content without a `version` bump is a no-op** |
| Skill | `<plugin-root>/skills/<name>/SKILL.md` → `/<plugin>:<skill>` |
| Skill frontmatter | `name` `description` `license` `compatibility` `metadata` `allowed-tools` — **nothing else**, hard upload error |
| Skill context | description always in; body on invocation only |
| Subagent | `<plugin-root>/agents/<name>.md` → `<plugin>:<agent>` |
| Plugin subagents ignore | `hooks`, `mcpServers`, `permissionMode` — block with `deny: ["Agent(name)"]` |

## Auth

| Precedence, highest first | Bill |
|---|---|
| `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` · `ANTHROPIC_AUTH_TOKEN` · `ANTHROPIC_API_KEY` · `apiKeyHelper` · `CLAUDE_CODE_OAUTH_TOKEN` · `/login` subscription OAuth, **last** | any of the above wins, metered credits |

| Check | Value |
|---|---|
| Config | `"forceLoginMethod": "claudeai"` |
| Status | `/status` |

- Source: <https://code.claude.com/docs/en/authentication.md>

## Subagent tier and usage limits

| Fact | Value |
|---|---|
| Subagent with no `model` | inherits the session model |
| Usage-limit resume | `autoContinueAtUsageLimit` managed setting, Claude Code 2.1.234+: waits for the reset, then continues the interrupted task |
| Limit messages | "session limit" / "weekly limit" = plan window, all models; "monthly spend limit" = usage credits cap |
| Usage percent | only the status line stdin: `rate_limits.five_hour` / `.seven_day` → `used_percentage`, `resets_at` (epoch s); no hook stdin carries it |
| Plugin `settings` | only `agent` and `subagentStatusLine` take effect — a plugin cannot set `statusLine` |
| Quota notifications | `Notification` `notification_type`: `quota_auto_resume_fired`, `_stale`, `_disabled`; no event fires before a limit |
| Limit row in transcript | the `isApiErrorMessage` row (`error: "rate_limit"`, `apiErrorStatus: 429`) carries `quotaLimits: {status: "rejected", rateLimitType: "five_hour" \| "seven_day", resetsAt}` (epoch s); no row carries it before the hit (observed 2026-09-26) |
| Workflow `agent({agentType})` | looks up the Agent tool's `activeAgents`, plugin agents included; an unknown type throws; with `schema`, the structured-output tool is added to a restricted `tools` list (2.1.281 binary, 2026-09-26) |
| Subagent first-turn prompt | median `workflow-subagent` 65k tok, `general-purpose` 60k, `serio-focus:scout` 8k — every connector schema loads unless `tools` restricts it (observed 2026-09-26, 857 transcripts) |

- Source: <https://code.claude.com/docs/en/costs.md>, retrieved 2026-09-23; <https://code.claude.com/docs/en/statusline.md>, <https://code.claude.com/docs/en/hooks.md>, <https://code.claude.com/docs/en/plugins-reference.md>, retrieved 2026-09-26
