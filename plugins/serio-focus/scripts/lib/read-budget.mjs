import { closeSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { BASH_OUTPUT_CAP, BIG_FILE_BYTES, delegateOn, webCap } from './limits.mjs';
import { rootOf, sessionOf, update } from './ledger.mjs';
import { Blocked } from './blocked.mjs';
import { shellReads } from './shell-reads.mjs';

const MEDIA = /\.(?:png|jpe?g|gif|webp|bmp|ico|pdf)$/i;
const SAMPLE_BYTES = 64 * 1024;
const SAMPLE_LINES = 200;

export const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;
const transact = (payload, fn) => update(rootOf(payload), sessionOf(payload), fn);
const actorOf = (payload = {}) => [payload.agent_type || 'main', payload.agent_id].filter(Boolean).join('#').replace(/[:|]/g, '');

export function webBudget(payload, tool) {
  const actor = actorOf(payload);
  if (actor === 'main') return null;
  const used = transact(payload, (state) => {
    state.reads[`${actor}|web`] = Number(state.reads[`${actor}|web`] || 0) + 1;
    return state.reads[`${actor}|web`];
  });
  if (used > webCap()) throw new Blocked(`WEB BUDGET: ${tool} call ${used} is over the ${webCap()}-call subagent cap. Next: return what you have\n`);
  return null;
}

function averageLineLength(file, size) {
  if (!size) return 0;
  const buffer = Buffer.alloc(Math.min(size, SAMPLE_BYTES));
  let n = 0;
  try {
    const fd = openSync(file, 'r');
    n = readSync(fd, buffer, 0, buffer.length, 0);
    closeSync(fd);
  } catch { return size; }
  let lines = 0;
  let end = 0;
  for (let i = 0; i < n && lines < SAMPLE_LINES; i += 1) {
    if (buffer[i] === 10) { lines += 1; end = i + 1; }
  }
  return lines ? end / lines : n;
}

function sliceBytes(file, size, { from = 0, lines, bytes }) {
  if (bytes !== undefined) return Math.min(bytes, size);
  const avg = averageLineLength(file, size);
  if (!avg) return 0;
  const total = size / avg;
  const start = Math.min(from, total);
  const count = lines === undefined ? total - start : Math.min(lines, total - start);
  return Math.max(0, Math.min(size, Math.round(count * avg)));
}

const statFile = (file) => {
  try {
    const stats = statSync(file);
    return stats.isFile() ? stats : null;
  } catch { return null; }
};

function bookSlice(state, payload, file, spec, { shell = false } = {}) {
  const stats = statFile(file);
  if (!stats) return;
  let bytes = spec.whole ? stats.size : sliceBytes(file, stats.size, spec);
  if (shell) bytes = Math.min(bytes, BASH_OUTPUT_CAP);
  if (actorOf(payload) !== 'main') state.saved.offload += bytes;
  else state.saved.read += bytes;
}

function judgeRead(state, payload, input, rewritable) {
  const file = String(input.file_path || '');
  if (!file || MEDIA.test(file)) return null;
  if (input.offset !== undefined || input.limit !== undefined || input.pages !== undefined) {
    bookSlice(state, payload, file, {
      from: Math.max(0, Number(input.offset || 0) - 1),
      lines: input.limit === undefined ? undefined : Number(input.limit),
    });
    return null;
  }
  const stats = statFile(file);
  if (!stats) return null;

  const actor = actorOf(payload);
  const main = actor === 'main';
  const resolved = path.resolve(file);
  const key = `${actor}|${resolved}`;
  const fingerprint = `${stats.mtimeMs}:${stats.size}`;
  const name = path.basename(file);

  const refuse = (action, bucket, credit, tag, message) => {
    const stamp = `${fingerprint}:${tag}`;
    if (state.reads[`${actor}|x:${resolved}`] !== stamp) {
      state.reads[`${actor}|x:${resolved}`] = stamp;
      state.saved[action] += 1;
      state.saved[bucket] += credit;
    }
    throw new Blocked(`READ BUDGET: ${message}${main && delegateOn() ? ' — read the lines you need with offset and limit, or delegate the read to a scout subagent' : ''}\n`);
  };

  const seen = String(state.reads[key] ?? '');
  if (seen === fingerprint || seen.startsWith(`${fingerprint}:`)) {
    const before = Number(seen.slice(fingerprint.length + 1));
    refuse('rereads', 'bytes', before || Math.min(stats.size, BIG_FILE_BYTES), 'r',
      `${name} is unchanged and already in context${stats.size > BIG_FILE_BYTES ? ` (its first ${kb(BIG_FILE_BYTES)})` : ''}`);
  }

  let bytes = stats.size;
  let trim = null;
  if (stats.size > BIG_FILE_BYTES) {
    if (!rewritable) {
      refuse('slices', 'deferred', stats.size, 's',
        `${name} is ${kb(stats.size)}, over the ${kb(BIG_FILE_BYTES)} whole-file limit`);
    }
    const avg = averageLineLength(resolved, stats.size);
    const lines = Math.max(1, Math.floor(BIG_FILE_BYTES / (avg || stats.size)));
    const admitted = Math.min(stats.size, Math.round(lines * avg));
    if (admitted < stats.size) {
      trim = { lines, admitted, size: stats.size, name };
      bytes = admitted;
      state.saved.rewrites += 1;
      state.saved.trimmed += stats.size - admitted;
    }
  }

  state.reads[key] = `${fingerprint}:${bytes}`;
  if (main) state.saved.read += bytes;
  else state.saved.offload += bytes;
  return trim;
}

export const readBudget = (payload, input, rewritable = false) => transact(payload, (state) => judgeRead(state, payload, input, rewritable));

export function shellReadBudget(payload, input) {
  const command = typeof input.command === 'string' ? input.command : '';
  return transact(payload, (state) => {
    const before = { reads: { ...state.reads }, read: state.saved.read, offload: state.saved.offload };
    try {
      for (const read of shellReads(command)) {
        if (read.unjudged) continue;
        const file = path.resolve(typeof payload.cwd === 'string' ? payload.cwd : process.cwd(), read.file);
        if (!read.whole || read.piped) bookSlice(state, payload, file, read.whole ? { whole: true } : read, { shell: true });
        else judgeRead(state, payload, { file_path: file }, false);
      }
    } catch (error) {
      if (error instanceof Blocked) {
        for (const key of Object.keys(state.reads)) if (!(key in before.reads) && !key.includes('|x:')) delete state.reads[key];
        Object.assign(state.saved, { read: before.read, offload: before.offload });
      }
      throw error;
    }
    return null;
  });
}
