import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { update } from './ledger.mjs';
import { configDir, rootOf } from './runtime.mjs';
import { compact } from './stats.mjs';

const WINDOW = { five_hour: 5 * 36e5, seven_day: 7 * 864e5 };
const SLOT = 6e5;
const RESCAN = 6e4;
const SCAN_MS = 3e3;
export const NEAR = 80;

const spent = (slots, from, to) => Object.entries(slots)
  .reduce((sum, [slot, n]) => (slot >= Math.floor(from / SLOT) && slot * SLOT <= to ? sum + n : sum), 0);

function windowStart(state, type, now) {
  const slots = Object.keys(state.slots).map(Number).sort((a, b) => a - b);
  let start = state.reset[type] - WINDOW[type];
  while (start + WINDOW[type] <= now) start = SLOT * (slots.find((slot) => slot * SLOT >= start + WINDOW[type]) ?? now / SLOT);
  return start;
}

function grow(state, now) {
  const root = path.join(configDir(), 'projects');
  const started = Date.now();
  let names = [];
  try { names = readdirSync(root, { recursive: true }).map(String).filter((name) => name.endsWith('.jsonl')); } catch { }
  for (const file of names.map((name) => path.join(root, name))) {
    if (Date.now() - started > SCAN_MS) return;
    let [from, last] = state.files[file] || [0, ''];
    let buf;
    try {
      const stats = statSync(file);
      if (stats.mtimeMs < now - WINDOW.seven_day) { delete state.files[file]; continue; }
      buf = Buffer.alloc(Math.max(0, stats.size - from));
      const fd = openSync(file, 'r');
      readSync(fd, buf, 0, buf.length, from);
      closeSync(fd);
    } catch { continue; }
    const end = buf.lastIndexOf(10) + 1;
    for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.includes('"usage"') && !line.includes('"quotaLimits"')) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const at = Date.parse(row.timestamp);
      const { status, rateLimitType: type, resetsAt } = row.quotaLimits || {};
      if (status === 'rejected' && WINDOW[type] && at > now - WINDOW.seven_day) state.hits.push([at, type, resetsAt * 1000]);
      const u = row.type === 'assistant' && !row.isApiErrorMessage && row.message?.id !== last ? row.message?.usage : null;
      if (!u) continue;
      last = row.message.id;
      const slot = Math.floor(at / SLOT);
      state.slots[slot] = (state.slots[slot] || 0) + (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    state.files[file] = [from + end, last];
  }
  for (const [at, type, reset] of state.hits.sort((a, b) => a[0] - b[0])) {
    if (state.reset[type] === reset) continue;
    state.reset[type] = reset;
    state.caps[type] = [...(state.caps[type] || []), spent(state.slots, reset - WINDOW[type], at)].slice(-3);
  }
  state.hits = [];
  state.noted = Object.fromEntries(Object.entries(state.noted).filter(([, start]) => start > now - WINDOW.seven_day));
  state.slots = Object.fromEntries(Object.entries(state.slots).filter(([slot]) => slot * SLOT > now - WINDOW.seven_day));
  state.at = now;
}

export function nearLimit(payload = {}, now = Date.now()) {
  if (payload.agent_id) return '';
  return update(rootOf(payload), 'quota', (state) => {
    for (const key of ['files', 'slots', 'reset', 'caps', 'noted']) state[key] ||= {};
    state.hits ||= [];
    if (!(now - state.at < RESCAN)) grow(state, now);
    for (const type of Object.keys(state.caps)) {
      const start = windowStart(state, type, now);
      const cap = Math.min(...state.caps[type]);
      const pct = Math.round((100 * spent(state.slots, start, now)) / Math.max(1, cap));
      const key = `${payload.session_id}|${type}`;
      if (pct < NEAR || state.caps[type].length < 2 || state.noted[key] === start) continue;
      state.noted[key] = start;
      return `LIMIT NEAR: ${pct}% of the ${type} usage window spent, cap ${compact(cap)} tok from the last limit hits. Next: document all work now as the environment and project instructions require`;
    }
    return '';
  });
}
