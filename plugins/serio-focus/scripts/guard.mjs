#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WRITERS = /^(?:Write|Edit|MultiEdit|NotebookEdit)$/;
const CHOICE = { Agent: ['model', 'effort'], spawn_agent: ['model', 'reasoning_effort'], Workflow: [] };
const scriptOf = (input) => { try { return input.script ?? (input.scriptPath == null ? '' : readFileSync(input.scriptPath, 'utf8')); } catch { return 'agent('; } };
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

const MAIL = /(?:^|[_-])(?:gmail|outlook|email|mail)(?:[_-]|$)/i;
const VERB = /(?:^|[_-])(?:send|reply|forward)(?:[_-]|$)/i;
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: {
  hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
} }));

function judge(payload) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  if (WRITERS.test(tool)) {
    if (process.env.SERIO_ORCHESTRATE === '1' && !payload.agent_id) return 'ORCHESTRATE: the main session plans and dispatches. Send this edit to the tester or coder agent';
    return;
  }
  const missing = (CHOICE[tool] || []).filter((key) => !String(input[key] ?? '').trim());
  if (tool === 'Workflow' && bareFlow(input)) missing.push('model', 'effort');
  if (missing.length) return `MODEL CHOICE: name ${missing.join(' and ')} in the subagent call`;
  if (tool.startsWith('mcp__') && MAIL.test(tool) && VERB.test(tool)) return `OUTWARD: "${tool}" sends email`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = readFileSync(0, 'utf8');
  let payload = null;
  try { payload = JSON.parse(raw); } catch {
    if (/"tool_name"\s*:\s*"[^"]+"/.test(raw)) deny('BLOCKED: tool payload could not be parsed');
  }
  if (payload && typeof payload === 'object') {
    const reason = judge(payload);
    if (reason) deny(reason);
  }
}
