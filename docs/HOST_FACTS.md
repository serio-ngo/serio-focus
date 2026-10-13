# Reference — host identifiers

<sub><b>Answers</b> · which hook, permission, plugin, skill and review identifiers Claude Code and Codex accept · <a href="../README.md">README</a></sub>

<!-- verified against `code.claude.com/docs` on 2026-09-04, hooks re-verified 2026-10-13; source per section -->

## Hooks

<details open>
<summary>Hook facts · 35 rows</summary>

| Fact | Value |
|---|---|
| File | `<plugin-root>/hooks/hooks.json`, same object shape as the settings `hooks` key |
| `matcher` tools | PreToolUse, PostToolUse, PermissionRequest, PermissionDenied (tool name); SessionStart (reason); SubagentStart/Stop (agent type) |
| No `matcher` | everything else |
| `"*"` / omitted | all |
| Exact / pipe-list chars | letters, digits, `_`, `-`, space, comma, pipe |
| Any other char | unanchored JS RegExp (`Edit.*` matches `NotebookEdit`) |
| Stdout reaches context | `UserPromptSubmit`, `SessionStart`, `PostModelSwitch` only |
| SessionStart stdout size | capped at 10,000 characters; longer output is saved to a file and replaced by its path and a 2,000-character preview |
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
| PreToolUse `ask` | native prompt in default and auto modes; `claude -p` with no prompt host turns it into deny and Claude reads the reason; cloud sessions wait for approval in the session UI; under `bypassPermissions` undocumented |
| Critical paths | a hook `allow` never approves `rm` or `rmdir` of a critical path such as `/` or `~` |
| PreToolUse `additionalContext` | string added to Claude's context alongside the tool result — the only rewrite field the model sees |
| PostToolUse `hookSpecificOutput.updatedToolOutput` | replaces the tool result Claude sees; must match the tool's output shape; the tool has already run |
| PostToolUse `updatedMCPToolOutput` | MCP tools only; prefer `updatedToolOutput` |
| `systemMessage` | universal field: warning text shown to the **user**, not model context; Stop honours it |
| Env | `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` (plugin hooks only, persistent across updates) |
| Host markers | env `CLAUDECODE=1`, `CLAUDE_CODE_REMOTE=true` in cloud sessions; stdin `permission_mode` |
| Kill switch | `"disableAllHooks": true` |

</details>

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash|Edit|Write",
  "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs\"" } ] } ] } }
```

- Source: <https://code.claude.com/docs/en/hooks.md>, <https://code.claude.com/docs/en/permission-modes.md>, <https://code.claude.com/docs/en/headless.md>, <https://code.claude.com/docs/en/env-vars.md>, retrieved 2026-10-13; `CLAUDE_PLUGIN_DATA` read in the 2.1.296 binary

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
| Registry entry | `claude plugin install` / `update` write `version` and `gitCommitSha` to `installed_plugins.json`; an update is skipped while the computed `version` equals the recorded one |
| Auto-update | after the first message plus a random delay up to 10 min; refreshes marketplaces with `autoUpdate`, updates their plugins on disk; the next start loads them |
| Auto-update gate | `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` switch the whole pass off unless `FORCE_AUTOUPDATE_PLUGINS=1`; the desktop app launches Claude Code with `DISABLE_AUTOUPDATER=1`; settings `env` reaches the gate (observed 2026-09-26, 2.1.281) |
| `autoUpdate` | settings `extraKnownMarketplaces.<name>.autoUpdate` first, then `known_marketplaces.json`; third-party default off; `claude plugin marketplace add` rewrites the settings entry without it (observed 2026-09-26) |
| Fresh machine | a marketplace declared only in settings is unknown to `claude plugin` until `claude plugin marketplace add` (observed 2026-09-26) |
| Skill | `<plugin-root>/skills/<name>/SKILL.md` → `/<plugin>:<skill>` |
| Portable skill frontmatter | `name` `description` `license` `compatibility` `metadata` `allowed-tools`; host extensions are separate |
| Claude skill extensions | `disable-model-invocation: true` keeps the description out of context and allows `/` use only; `context: fork` with `agent: <type>` runs the skill in that subagent; `background` defaults to true with `fork` |
| Local marketplace version | Native `plugin list --json` reports `readFromFolder` and `folderVersion` when a local source supplies current content; cached registry metadata may retain an older version (observed 2026-10-12) |
| Skill context | name and description at start, cut at 1,536 chars each; body on invocation only |
| Subagent | `<plugin-root>/agents/<name>.md` → `<plugin>:<agent>` |
| Plugin subagents ignore | `hooks`, `mcpServers`, `permissionMode`, `initialPrompt` — block with `deny: ["Agent(name)"]` |
| Cloud sessions | do not install plugins from `enabledPlugins`, so plugin hooks do not run; hooks committed in the repo's `.claude/settings.json` do |
| Output styles | plugin `output-styles/`; frontmatter `name`, `description`, `keep-coding-instructions`, `force-for-plugin` (applies the style while the plugin is enabled) |

- Source: <https://code.claude.com/docs/en/plugins/loading.md>, retrieved 2026-09-26; gate and settings `env` filter read in the 2.1.281 binary
- Skill extensions: <https://code.claude.com/docs/en/skills>; portable fields: <https://agentskills.io/specification>; retrieved 2026-10-12
- Cloud and output styles: <https://code.claude.com/docs/en/cloud-environments.md>, <https://code.claude.com/docs/en/output-styles.md>, retrieved 2026-10-13

## Auth

| Precedence, highest first | Bill |
|---|---|
| `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` · `ANTHROPIC_AUTH_TOKEN` · `ANTHROPIC_API_KEY` · `apiKeyHelper` · `CLAUDE_CODE_OAUTH_TOKEN` · `/login` subscription OAuth, **last** | any of the above wins, metered credits |

| Check | Value |
|---|---|
| Config | `"forceLoginMethod": "claudeai"` |
| Status | `/status` |

- Source: <https://code.claude.com/docs/en/authentication.md>

## Subagents and limits

| Fact | Value |
|---|---|
| Built-in read-only subagents | `Plan` and `Explore` have no Edit, Write or Agent tool; `Explore` skips `CLAUDE.md` |
| Subagent with no `model` | inherits the session model |
| Usage-limit resume | `autoContinueAtUsageLimit` managed setting, Claude Code 2.1.234+: waits for the reset, then continues the interrupted task |
| Usage percent | only the status line stdin: `rate_limits.five_hour` / `.seven_day` → `used_percentage`, `resets_at` (epoch s); no hook stdin carries it |
| Plugin `settings` | only `agent` and `subagentStatusLine` take effect — a plugin cannot set `statusLine` |
| Read dedup | an unchanged re-read returns "File unchanged since last read"; `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` caps one read (2.1.296 binary, 2026-10-12) |

- Source: <https://code.claude.com/docs/en/sub-agents>, <https://code.claude.com/docs/en/statusline.md>, <https://code.claude.com/docs/en/plugins-reference.md>, retrieved 2026-10-12

## PR automation

| Fact | Value |
|---|---|
| Claude desktop | after a PR opens, the CI status bar offers "Auto-fix CI & address comments" (wakes the local session on CI failures and on review comments from collaborators or GitHub Apps) and "Auto-merge when ready"; needs an authenticated `gh` |
| Claude on the web | `/autofix-pr` subscribes a cloud session to PR events and pushes clear fixes; needs the Claude GitHub App |
| `anthropics/claude-code-action@v1` | pushes to same-repo PR branches; auth `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`; commits made with `GITHUB_TOKEN` start no new workflow runs |
| Codex review triggers | PR opened, draft marked ready, `@codex review` comment; the repo "Review trigger" setting is not in the docs (UNVERIFIED) |
| Codex review rules | the closest `AGENTS.md` section `## Code Review Rules`; findings carry P0, P1 or P2 |
| Codex fix | any other `@codex` PR comment starts a cloud task that "can push a fix back to the branch" (UNVERIFIED in practice) |
| `openai/codex-action@v1` | OpenAI API key only; no push input; official autofix opens a new PR |
| `openai/codex-plugin-cc` | `/codex:review`, `/codex:adversarial-review`, `/codex:rescue` inside Claude Code through the local Codex CLI and ChatGPT sign-in |

- Source: <https://code.claude.com/docs/en/desktop>, <https://code.claude.com/docs/en/claude-code-on-the-web>, <https://code.claude.com/docs/en/github-actions>, <https://learn.chatgpt.com/docs/third-party/github>, <https://github.com/openai/codex-action>, <https://github.com/openai/codex-plugin-cc>, retrieved 2026-10-12

## Codex

| Fact | Value |
|---|---|
| Plugin manifest | `.codex-plugin/plugin.json`: `name`, `version`, `description`, `skills`, `hooks`, `mcpServers`, `apps`, `interface`; paths start `./` |
| Marketplace | `<repo>/.agents/plugins/marketplace.json`; `codex plugin marketplace add <path>`, `codex plugin add <name>@<marketplace>` |
| Agents | a plugin cannot ship agents; roles live in `~/.codex/agents/*.toml` or `<repo>/.codex/agents/*.toml` with `name`, `description`, `developer_instructions` |
| Skills | parser keeps `name`, `description`, `metadata` and ignores other keys; `agents/openai.yaml` `policy.allow_implicit_invocation: false` allows explicit `$skill` use only |
| Hook events | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`, `SessionEnd` |
| `PreToolUse` coverage | shell (matches `Bash`), `apply_patch`, MCP tools, `spawn_agent` (also matches `Agent`); not hosted web search |
| Deny | `permissionDecision: "deny"` with a non-empty reason, legacy `decision: "block"`, or exit 2 with stderr; the model reads the reason |
| Fail open | `ask`, `approve`, an empty deny reason, `continue: false`, unparsable JSON, a timeout or any other exit: the tool runs |
| PreToolUse stdin | `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`; `agent_id`, `agent_type` in subagents; `turn_id` marks Codex |
| SessionStart | stdout becomes developer context; about 2,500 tokens per handler unless `additionalContextLimit` overrides |
| Cloud tasks | plugin hooks not documented to run; treat as absent |
| Trust | non-managed hooks need per-hash trust in `/hooks`; a changed hook asks again |
| Env | `PLUGIN_ROOT`, `PLUGIN_DATA` and the aliases `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, plugin hooks only |
| Local review | `codex review --base <branch>` or `/review`; reports only |

- Source: <https://developers.openai.com/plugins/build/plugins>, <https://learn.chatgpt.com/docs/hooks>, <https://learn.chatgpt.com/docs/build-skills>, <https://learn.chatgpt.com/docs/agent-configuration/subagents>, <https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/manifest.rs>, retrieved 2026-10-12
- Hook output and stdin: <https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/output_parser.rs>, <https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/pre-tool-use.command.input.schema.json>, <https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs>, <https://learn.chatgpt.com/docs/plugins.md>, retrieved 2026-10-13
