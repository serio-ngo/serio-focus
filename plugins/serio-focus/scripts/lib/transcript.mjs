import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { load, projectOf, rootOf, save, sessionOf } from './ledger.mjs';

const WRITERS = /^(?:Write|Edit|MultiEdit|NotebookEdit)$/;

function scan(file) {
  const out = { fresh: 0, cacheRead: 0, turns: 0, writes: [] };
  let lines = [];
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/); } catch { return out; }
  const seen = new Set();
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = entry?.type === 'assistant' ? entry.message : null;
    if (!message) continue;
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const target = WRITERS.test(part.name) && (part.input?.file_path || part.input?.notebook_path);
      if (typeof target === 'string') out.writes.push(target);
    }
    const u = message.usage;
    if (!u || seen.has(message.id)) continue;
    if (message.id) seen.add(message.id);
    out.turns += 1;
    out.fresh += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
    out.cacheRead += u.cache_read_input_tokens || 0;
  }
  return out;
}

export function usage(file) {
  const { fresh, cacheRead, turns } = scan(file);
  return { fresh, cacheRead, turns };
}

const norm = (value) => path.resolve(value).replace(/\\/g, '/').toLowerCase();
const inside = (file, root) => norm(file) === norm(root) || norm(file).startsWith(`${norm(root)}/`);

export function sessionSpend(file, project) {
  const main = String(file || '').replace(/[\\/]subagents[\\/].*$/, '.jsonl');
  if (!main || !existsSync(main)) return null;
  const dir = path.join(main.replace(/\.jsonl$/i, ''), 'subagents');
  let names = [];
  try { names = readdirSync(dir, { recursive: true }).map(String).filter((name) => /agent-[^\\/]*\.jsonl$/.test(name)); } catch { }
  const all = [scan(main), ...names.map((name) => scan(path.join(dir, name)))];
  return {
    fresh: all.reduce((sum, s) => sum + s.fresh, 0),
    outside: [...new Set(all.flatMap((s) => s.writes))].filter((w) => !inside(w, project)),
  };
}

function tree(project) {
  try {
    const names = execFileSync('git', ['-C', project, 'ls-files', '-m', '-o', '--exclude-standard', '-z'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
    const marks = names.map((name) => { try { const s = statSync(path.join(project, name)); return `${name}:${s.mtimeMs}:${s.size}`; } catch { return name; } });
    return createHash('sha1').update(marks.join('\n')).digest('hex');
  } catch { return null; }
}

export function stall(payload = {}) {
  const project = projectOf(payload);
  const print = tree(project);
  if (!print) return 0;
  const fresh = sessionSpend(payload.transcript_path, project)?.fresh || 0;
  const root = rootOf(payload);
  const session = sessionOf(payload);
  const state = load(root, session);
  if (state.progress?.print !== print) {
    state.progress = { print, at: fresh };
    save(root, session, state);
  }
  return Math.max(0, fresh - state.progress.at);
}
