import { appendFileSync, mkdirSync } from 'node:fs';
import { sessionOf, version } from './lib/runtime.mjs';

const FIELDS = ['ts', 'v', 'session', 'actor', 'agent', 'call', 'action', 'rule', 'result'];

export function entry(payload, reason, result) {
  return {
    session: sessionOf(payload),
    actor: payload.agent_type || 'main',
    agent: payload.agent_id || '',
    call: payload.tool_use_id || '',
    action: String(payload.tool_name || 'unknown'),
    rule: String(reason).split(':', 1)[0],
    result,
  };
}

export function append(root, values) {
  const now = new Date();
  const record = Object.fromEntries(FIELDS.map((key) => [key, values[key] ?? '']));
  record.ts = now.toISOString();
  try {
    record.v = version();
    mkdirSync(`${root}/audit`, { recursive: true });
    appendFileSync(`${root}/audit/${record.ts.slice(0, 7)}.jsonl`, `${JSON.stringify(record)}\n`, 'utf8');
  } catch { process.stderr.write('SERIO AUDIT: could not persist denial\n'); }
}
