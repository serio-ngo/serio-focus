#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { append, entry } from './audit.mjs';
import { Blocked } from './lib/blocked.mjs';
import { fanOutCap } from './lib/fan-out.mjs';
import { rootOf } from './lib/runtime.mjs';
import { judgeShell } from './lib/shell-danger.mjs';

export const SPAWN_TOOLS = ['Agent', 'Task', 'spawn_agent'];
export { Blocked };

export function judge(payload) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  if (SPAWN_TOOLS.includes(tool)) fanOutCap(payload);
  if (tool !== 'Bash' && tool !== 'PowerShell') return;
  if (typeof (input.command ?? '') !== 'string') throw new Blocked('GIT WRITE: shell command must be a string');
  const verdict = judgeShell(input.command || '', 0, payload.cwd);
  if (verdict) throw new Blocked(`${/recursive delete|git wipe/.test(verdict) ? 'DELETE LOCK' : 'GIT WRITE'}: ${verdict}`);
}

function deny(payload, error) {
  if (!(error instanceof Blocked)) throw error;
  append(rootOf(payload), entry(payload, error.message));
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: error.message, additionalContext: error.message,
  } }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = readFileSync(0, 'utf8');
  let payload = null;
  try { payload = JSON.parse(raw); } catch {
    const tool = /"tool_name"\s*:\s*"(Bash|PowerShell|Agent|Task|spawn_agent)"/.exec(raw)?.[1];
    if (tool) deny({ tool_name: tool }, new Blocked('BLOCKED: tool payload could not be parsed'));
  }
  if (payload && typeof payload === 'object') try { judge(payload); } catch (error) { deny(payload, error); }
}
