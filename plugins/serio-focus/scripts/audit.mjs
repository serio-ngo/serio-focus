import { appendFileSync, mkdirSync } from 'node:fs';
import { sessionOf, version } from './lib/runtime.mjs';

const FIELDS = ['ts', 'v', 'session', 'actor', 'agent', 'call', 'action', 'target', 'rule', 'result'];

export function entry(payload, reason) {
  const tool = String(payload.tool_name || '');
  if (!tool) return null;
  const input = payload.tool_input || {};
  const [rule, ...rest] = String(reason).trim().split(': ');
  return {
    session: sessionOf(payload),
    actor: payload.agent_type || 'main',
    agent: payload.agent_id || '',
    call: payload.tool_use_id || '',
    action: tool,
    target: String((typeof input.command === 'string' && input.command) || input.description || '').slice(0, 120),
    rule,
    result: rest.join(': '),
  };
}

export function append(root, values) {
  if (!values) return;
  const now = new Date();
  const record = Object.fromEntries(FIELDS.map((key) => [key, values[key] ?? '']));
  record.ts = now.toISOString();
  try {
    record.v = version();
    mkdirSync(`${root}/audit`, { recursive: true });
    appendFileSync(`${root}/audit/${record.ts.slice(0, 7)}.jsonl`, `${JSON.stringify(record)}\n`, 'utf8');
  } catch { }
}
