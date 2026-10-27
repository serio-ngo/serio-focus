#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { append, entry } from './audit.mjs';
import { Blocked } from './lib/blocked.mjs';
import { fanOutCap } from './lib/fan-out.mjs';
import { rootOf } from './lib/runtime.mjs';
import { judgeShell } from './lib/shell-danger.mjs';

export const SPAWN_TOOLS = ['Agent', 'spawn_agent'];
const CHOICE = { Agent: ['model', 'effort'], spawn_agent: ['model', 'reasoning_effort'], Workflow: [] };
const scriptOf = (input) => { try { return input.script ?? readFileSync(input.scriptPath, 'utf8'); } catch { return 'agent('; } };
const code = (src) => String(src).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, (hit, quote) => (quote ? '""' : ' '));

function optionKeys(src, from) {
  let depth = 1;
  let arg = 0;
  let own = '';
  for (let i = from; i < src.length && depth; i += 1) {
    if ('([{'.includes(src[i])) depth += 1;
    else if (')]}'.includes(src[i])) depth -= 1;
    else if (src[i] === ',' && depth === 1) arg += 1;
    else if (arg === 1 && depth === 2) own += src[i];
  }
  return own.split(',').map((entry) => entry.split(':')[0].trim());
}

function bareFlow(input) {
  const src = code(scriptOf(input));
  return [...src.matchAll(/\bagent\s*\(/g)].some((hit) => {
    const keys = optionKeys(src, hit.index + hit[0].length);
    return !keys.includes('model') || !keys.includes('effort');
  });
}

function judge(payload) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  const missing = (CHOICE[tool] || []).filter((key) => !String(input[key] ?? '').trim());
  if (tool === 'Workflow' && bareFlow(input)) missing.push('model', 'effort');
  if (missing.length) throw new Blocked(`MODEL CHOICE: name ${missing.join(' and ')} in the subagent call`);
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
  const decision = error.ask && !('turn_id' in payload) ? 'ask' : 'deny';
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
    const tool = /"tool_name"\s*:\s*"(Bash|PowerShell|Agent|spawn_agent|Workflow)"/.exec(raw)?.[1];
    if (tool) hold({ tool_name: tool }, new Blocked('BLOCKED: tool payload could not be parsed'));
  }
  if (payload && typeof payload === 'object') try { judge(payload); } catch (error) { hold(payload, error); }
}
