#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Blocked } from './lib/blocked.mjs';
import { append, entry } from './audit.mjs';
import { bump, rootOf } from './lib/ledger.mjs';
import { fanOutCap } from './lib/fan-out.mjs';
import { judgeShell } from './lib/shell-danger.mjs';
import { kb, polled, readBudget, shellReadBudget, webBudget } from './lib/read-budget.mjs';
import { nearLimit } from './lib/quota.mjs';

export const SPAWN_TOOLS = ['Agent', 'Task', 'spawn_agent'];
const WEB_TOOLS = ['WebSearch', 'WebFetch'];
export { Blocked };
let current = {};

const deny = (reason, label = 'BLOCKED') => {
  bump(current, 'blocked');
  throw new Blocked(`${label}: ${reason}\n`);
};

export function judge(raw = {}) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  current = payload;
  if (tool === 'Read') {
    const trim = readBudget(payload, input, true);
    return trim ? { updatedInput: { ...input, offset: 1, limit: trim.lines },
      reason: `READ CAP: ${trim.name} ${kb(trim.size)}. Kept first ${trim.lines} lines` } : null;
  }
  if (SPAWN_TOOLS.includes(tool)) {
    fanOutCap(payload);
    bump(payload, 'agents');
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    if ('command' in input && typeof input.command !== 'string') deny('shell command must be a string', 'GIT WRITE');
    const verdict = judgeShell(input.command || '', 0, payload.cwd);
    if (verdict) deny(verdict, /recursive delete|git wipe/.test(verdict) ? 'DELETE LOCK' : 'GIT WRITE');
    return shellReadBudget(payload, input);
  }
  if (WEB_TOOLS.includes(tool)) return webBudget(payload, tool);
  return null;
}

const refuse = (error) => {
  if (!(error instanceof Blocked)) throw error;
  const reason = error.message.trim();
  append(rootOf(current), entry(current, reason));
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason, additionalContext: reason,
  } }));
};

function main() {
  const raw = readFileSync(0, 'utf8');
  let payload;
  try { payload = JSON.parse(raw); } catch {
    if (/"tool_name"\s*:\s*"(?:Bash|PowerShell|Agent|Task|spawn_agent)"/.test(raw)) {
      try { deny('tool payload could not be parsed'); } catch (error) { refuse(error); }
    }
    return;
  }
  let rewrite;
  try { rewrite = judge(payload); } catch (error) { refuse(error); return; }
  const note = (!process.env.PLUGIN_ROOT && nearLimit(payload)) || polled(payload);
  if (note) append(rootOf(payload), entry(payload, note));
  if (rewrite || note) process.stdout.write(JSON.stringify({
    ...(note && { systemMessage: note }),
    hookSpecificOutput: { hookEventName: 'PreToolUse',
      ...(rewrite?.updatedInput && { permissionDecision: 'allow', permissionDecisionReason: rewrite.reason, updatedInput: rewrite.updatedInput }),
      additionalContext: [rewrite?.reason, note].filter(Boolean).join('\n'),
    },
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
