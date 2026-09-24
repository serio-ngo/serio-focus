import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ledgerPath, projectOf, rootOf, stateDir } from './runtime.mjs';

export const COUNTERS = ['agents', 'blocked', 'rereads', 'slices', 'rewrites',
  'bytes', 'deferred', 'trimmed', 'offload', 'read', 'scouts', 'runners',
  'waves', 'agentsCapped', 'redirects'];

export const KEPT = ['bytes', 'deferred', 'trimmed'];
export const BYTE_COUNTERS = [...KEPT, 'offload'];

export const zero = () => Object.fromEntries(COUNTERS.map((key) => [key, 0]));
const EMPTY = () => ({ reads: {}, saved: zero() });

export { projectOf, rootOf };

export const sessionOf = (payload = {}) => String(payload.session_id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '');

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE = [[/\.lock$/, 60 * 1000], [/^\.wave-/, DAY_MS], [/^\.session-/, 30 * DAY_MS]];

const LOCK_TRIES = 60;
const LOCK_NAP_MS = 8;
const nap = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { } };

function withLock(root, session, fn) {
  const file = `${ledgerPath(root, session)}.lock`;
  try { mkdirSync(path.dirname(file), { recursive: true }); } catch { return fn(); }
  for (let n = 0; n < LOCK_TRIES; n += 1) {
    let fd = null;
    try { fd = openSync(file, 'wx'); } catch { nap(LOCK_NAP_MS); continue; }
    try { return fn(); } finally {
      try { closeSync(fd); } catch { }
      rmSync(file, { force: true });
    }
  }
  rmSync(file, { force: true });
  return fn();
}

export function sweep(root) {
  const dir = stateDir(root);
  let names = [];
  try { names = readdirSync(dir); } catch { return 0; }
  let swept = 0;
  for (const name of names) {
    const age = (STALE.find(([rx]) => rx.test(name)) || [])[1];
    if (age === undefined) continue;
    try {
      if (Date.now() - statSync(path.join(dir, name)).mtimeMs < age) continue;
      rmSync(path.join(dir, name), { recursive: true, force: true });
      swept += 1;
    } catch { }
  }
  return swept;
}

export function load(root, session) {
  const blank = EMPTY();
  try {
    const stored = JSON.parse(readFileSync(ledgerPath(root, session), 'utf8'));
    return { ...blank, ...stored, reads: { ...stored.reads }, saved: { ...blank.saved, ...stored.saved } };
  } catch {
    return blank;
  }
}

export function save(root, session, state) {
  const file = ledgerPath(root, session);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.${process.pid}`, JSON.stringify(state), 'utf8');
    renameSync(`${file}.${process.pid}`, file);
    return true;
  } catch {
    return false;
  }
}

export function update(root, session, fn) {
  return withLock(root, session, () => {
    const state = load(root, session);
    try { return fn(state); } finally { save(root, session, state); }
  });
}

export const bumpAll = (root, session, deltas) => update(root, session, (state) => {
  for (const [field, amount] of Object.entries(deltas)) state.saved[field] = (state.saved[field] || 0) + amount;
  return state;
});

export function bump(payload, field, amount = 1) {
  return bumpAll(rootOf(payload), sessionOf(payload), { [field]: amount });
}

export function fold(base, add = {}) {
  const out = { ...zero(), ...(base || {}) };
  for (const key of COUNTERS) out[key] += Number(add[key] || 0);
  return out;
}

export const savings = (state) => {
  const hit = COUNTERS.filter((key) => state.saved[key]);
  return hit.length ? Object.fromEntries(hit.map((key) => [key, state.saved[key]])) : null;
};

export function bank(state) {
  state.session = fold(state.session, state.saved);
}
