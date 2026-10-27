#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { append, entry } from './audit.mjs';
import { Blocked } from './lib/blocked.mjs';
import { fanOutCap } from './lib/fan-out.mjs';
import { rootOf } from './lib/runtime.mjs';
import { judgeShell } from './lib/shell-danger.mjs';

export const SPAWN_TOOLS = ['Agent', 'spawn_agent'];

function judge(payload) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  if (SPAWN_TOOLS.includes(tool)) fanOutCap(payload);
  if (tool !== 'Bash' && tool !== 'PowerShell') return;
  if (typeof (input.command ?? '') !== 'string') throw new Blocked('BLOCKED: shell command must be a string');
  const verdict = judgeShell(input.command || '', 0, payload.cwd);
  if (verdict) throw new Blocked(verdict, true);
}

const reasonOf = (error, decision) => (error.ask
  ? `${error.message}. ${decision === 'ask' ? 'Allow only if you asked for it.' : 'Held: give the user the exact command.'}`
  : error.message);

function hold(payload, error) {
  if (!(error instanceof Blocked)) throw error;
  const decision = error.ask && !('turn_id' in payload) && payload.permission_mode !== 'bypassPermissions' ? 'ask' : 'deny';
  const reason = reasonOf(error, decision);
  append(rootOf(), entry(payload, reason, decision));
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason,
  } }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = readFileSync(0, 'utf8');
  let payload = null;
  try { payload = JSON.parse(raw); } catch {
    const tool = /"tool_name"\s*:\s*"(Bash|PowerShell|Agent|spawn_agent)"/.exec(raw)?.[1];
    if (tool) hold({ tool_name: tool }, new Blocked('BLOCKED: tool payload could not be parsed'));
  }
  if (payload && typeof payload === 'object') try { judge(payload); } catch (error) { hold(payload, error); }
}
