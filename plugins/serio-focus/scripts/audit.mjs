import { appendFileSync, mkdirSync } from 'node:fs';
import { version } from './lib/runtime.mjs';

const FIELDS = ['ts', 'v', 'session', 'actor', 'agent', 'call', 'action', 'rule', 'result'];

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
