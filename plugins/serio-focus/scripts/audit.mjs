import { appendFileSync, mkdirSync } from 'node:fs';
import { sessionOf } from './lib/ledger.mjs';

const FIELDS = ['ts', 'session', 'actor', 'action', 'target', 'rule', 'result'];

export function entry(payload, reason) {
  const tool = String(payload.tool_name || '');
  if (!tool) return null;
  const input = payload.tool_input || {};
  const [rule, ...rest] = String(reason).trim().split(': ');
  return {
    session: sessionOf(payload),
    actor: payload.agent_type || 'main',
    action: tool,
    target: String(input.file_path || input.notebook_path || input.path
      || (typeof input.command === 'string' ? input.command : '') || input.description || input.scriptPath
      || (String(input.script ?? '').match(/\bname:\s*['"`]([^'"`]+)/) || [])[1] || '').slice(0, 120),
    rule,
    result: rest.join(': '),
  };
}

export function append(root, values) {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const record = Object.fromEntries(FIELDS.map((key) => [key, values[key] ?? '']));
  record.ts = values.ts || now.toISOString();
  try {
    mkdirSync(`${root}/audit`, { recursive: true });
    appendFileSync(`${root}/audit/${month}.jsonl`, `${JSON.stringify(record)}\n`, 'utf8');
  } catch { }
}
