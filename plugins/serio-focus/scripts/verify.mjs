#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { append, entry } from './audit.mjs';
import { COUNTERS, bank, fold, projectOf, rootOf, savings, sessionOf, update } from './lib/ledger.mjs';
import { heldCount, kept, sessionLine } from './lib/stats.mjs';
import { stallWarn } from './lib/limits.mjs';
import { stall, usage } from './lib/transcript.mjs';

export function report(payload) {
  const tokens = stall(payload);
  const root = rootOf(payload);
  const session = sessionOf(payload);
  const { denied, ...real } = usage(payload.transcript_path, projectOf(payload));
  return update(root, session, (state) => {
    const fresh = denied.slice(state.denied || 0);
    for (const call of fresh) append(root, entry({ session_id: session, tool_name: call.name, tool_input: call.input, tool_use_id: call.id }, 'SETTINGS DENY: a permission rule denied the call'));
    state.denied = denied.length;
    const total = savings(state);
    if (total || fresh.length) {
      append(root, { session, actor: 'main', action: 'session', target: total || {}, result: { ...real, denied: denied.length } });
      bank(state);
      for (const key of COUNTERS) state.saved[key] = 0;
    }
    const stalled = tokens >= stallWarn() ? tokens : 0;
    const s = fold(state.session, state.saved);
    const stamp = JSON.stringify([kept(s), heldCount(s), Math.floor(stalled / stallWarn())]);
    if (stamp === state.printed) return null;
    state.printed = stamp;
    return sessionLine(state, stalled, real.context) || null;
  });
}

function announce(stats) {
  if (stats) {
    process.stdout.write(JSON.stringify({ systemMessage: stats, hookSpecificOutput: { hookEventName: 'Stop' } }));
  }
  process.exit(0);
}

function gate() {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  announce(report(payload));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) gate();
