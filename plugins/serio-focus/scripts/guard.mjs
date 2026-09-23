#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Blocked } from './lib/blocked.mjs';
import { append, entry } from './audit.mjs';
import { bump } from './lib/ledger.mjs';
import { agentsRequested, bookRedirect, costBudget, dispatchBudget, withScript } from './lib/dispatch.mjs';
import { fanOutCap } from './lib/fan-out.mjs';
import { judgeShell } from './lib/shell-danger.mjs';
import { kb, readBudget, shellReadBudget, webBudget } from './lib/read-budget.mjs';
import { stallHold } from './lib/limits.mjs';
import { compact } from './lib/stats.mjs';
import { stall } from './lib/transcript.mjs';

export const SPAWN_TOOLS = ['Agent', 'Task', 'Workflow'];
const WEB_TOOLS = ['WebSearch', 'WebFetch'];
export { Blocked };

let current = {};

const deny = (reason, label = 'BLOCKED') => {
  bump(current, 'blocked');
  const error = new Blocked(`${label}: ${reason}\n`);
  error.rule = label;
  throw error;
};

function judgeRead(payload, input) {
  const trim = readBudget(payload, input, 'read');
  return trim ? {
    updatedInput: { ...input, offset: 0, limit: trim.lines },
    reason: `READ CAP: ${trim.name} ${kb(trim.size)}. Kept first ${trim.lines} lines`,
  } : null;
}

function judgeSpawn(payload, raw, tool) {
  const input = withScript(raw, tool, payload.cwd);
  const verdicts = [dispatchBudget(input, payload.cwd, tool), costBudget(input, tool)].filter(Boolean);
  if (verdicts.length) {
    if (verdicts[0].tier) bookRedirect(payload, verdicts[0].tier);
    deny(verdicts.map((v) => v.reason).join('; '), 'DISPATCH BUDGET');
  }
  const { wave, total } = agentsRequested(input, tool);
  fanOutCap(payload, wave);

  bump(payload, 'agents', total);
  const kind = String(input.subagent_type || '');
  if (/scout/i.test(kind)) bump(payload, 'scouts', total);
  else if (/runner/i.test(kind)) bump(payload, 'runners', total);
  return null;
}

function judgeShellCall(payload, input) {
  if ('command' in input && typeof input.command !== 'string') {
    deny('blocked a shell call whose command was not a string', 'GIT WRITE');
  }
  const command = typeof input.command === 'string' ? input.command : '';
  const verdict = judgeShell(command);
  if (verdict) deny(verdict, /recursive delete|git wipe/.test(verdict) ? 'DELETE LOCK' : 'GIT WRITE');

  return shellReadBudget(payload, input);
}

function judgeStall(payload, tool) {
  const main = !payload.agent_id;
  const hold = stallHold();
  if (!hold || (main && !SPAWN_TOOLS.includes(tool) && !WEB_TOOLS.includes(tool))) return;
  const tokens = stall(payload);
  if (tokens >= hold) {
    deny(`${compact(tokens)} tok since the last repo change. Next: ${main
      ? 'write the deliverable into the repo; dispatch and web reopen when the tree changes'
      : 'return your findings now'}`, 'STALL HOLD');
  }
}

export function judge(raw = {}) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  current = payload;
  judgeStall(payload, tool);

  if (tool === 'Read') return judgeRead(payload, input);
  if (SPAWN_TOOLS.includes(tool)) return judgeSpawn(payload, input, tool);
  if (tool === 'Bash' || tool === 'PowerShell') return judgeShellCall(payload, input);
  if (WEB_TOOLS.includes(tool)) return webBudget(payload, tool);
  return null;
}

const refuse = (error) => {
  if (!(error instanceof Blocked)) throw error;
  const reason = error.message.trim();
  try {
    const root = process.env.HANDOFF_OS_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const project = process.env.CLAUDE_PROJECT_DIR || current.cwd || process.cwd();
    const values = entry(current, project);
    if (values) {
      values.result = `blocked: ${reason}`;
      values.rule = error.rule || reason.split('\n')[0].split(':')[0].trim();
      append(root, values);
    }
  } catch { }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
      additionalContext: reason,
    },
  }));
  process.exit(0);
};

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { raw = ''; }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    const spawnOrShell = new RegExp(`"tool_name"\\s*:\\s*"(?:Bash|PowerShell|${SPAWN_TOOLS.join('|')})"`);
    if (spawnOrShell.test(raw)) {
      current = {};
      try { deny('blocked a subagent or shell call whose payload could not be parsed'); } catch (error) { refuse(error); }
    }
    process.exit(0);
  }

  let rewrite = null;
  try { rewrite = judge(payload); } catch (error) { refuse(error); }

  if (rewrite) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: rewrite.reason,
        updatedInput: rewrite.updatedInput,
        additionalContext: rewrite.reason,
      },
    }));
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
